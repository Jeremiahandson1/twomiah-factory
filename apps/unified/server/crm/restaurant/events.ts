// Events — the booking, and everything hanging off it. Moved from templates/crm-restaurant/backend/src/routes/events.ts
// (templates/crm-bar has the same file). The registry signs the person in and applies the 'event_bookings' gate; each
// action keeps the template's permission.
//
//   GET  /events                    pipeline / calendar list
//   GET  /events/:id                the full file: menu, run of show, payments
//   POST /events                    new enquiry
//   PUT  /events/:id                update (double-books rejected)
//   DELETE /events/:id              cancel (the row stays, so win/loss stays measurable)
//   POST /events/:id/menu           add a line;  PUT/DELETE /events/:id/menu/:lineId
//   POST /events/:id/timeline       add a BEO line;  PUT/DELETE /events/:id/timeline/:lineId
//   POST /events/:id/payments       schedule a deposit / balance;  PUT/DELETE /events/:id/payments/:paymentId
//   GET  /events/:id/beo            printable banquet event order (HTML)
//
// A space can only host one live event per date (HELD); enquiries deliberately do not hold it. Money lives on the
// event's invoice (eventLedger.ts): these routes keep the schedule and keep the invoice in step with the menu;
// payments, refunds and voids are recorded on the invoice itself (/api/invoices/:id/...).
//
// Replies changed to the rulebook's shapes: GET / is a list ({ data, pagination }; the template's `moneyWithheld` on
// the list is not sent — the rows simply carry no quote or deposit, and no screen read the flag there); a space clash
// is `{ error, code: 'space_held' }` (the template added `conflictId`, which no screen read).
import { Hono } from 'hono'
import { eq, and, gte, lte, or, ilike, asc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { deriveStatus, round2, withoutPortalCredential } from '@twomiah/tenant-backend'
import { event, eventSpace, eventMenuItem, eventTimeline, eventPayment, menuPackage, contact, company, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { lockEventBook } from '../../data/restaurantEvents.ts'
import { LedgerError, loadEventLedger, ensureEventInvoice, syncEventInvoice, closeEventInvoice } from './eventLedger.ts'
import {
  EXIT_STATUSES, HELD, DATE_RE, SpaceClash, findClash, clashMessage, eventDayWords, eventCodeWords, syncHireLine, createEvent, validateEventInput, validateTimelineInput,
  coordinatorRefusal, eventWarnings, moneyRefusal, quantityRefusal, auditName,
} from './eventBooking.ts'

// A package minimum is a billing floor, not an entry limit: fewer guests than the minimum are billed at the minimum
// and the line says so. A quantity at or above the minimum, a flat line, or a package without one is left as typed.
// (T16 M9)
const FLOOR_NOTE = /^Billed at the \d+-guest package minimum \(\d+ entered\)( — )?/
function packageFloor(pkg: any, perPerson: boolean, quantity: any, notes: string | null): { quantity: any; notes: string | null } {
  const min = Number(pkg?.minGuests || 0), q = Number(quantity)
  const rest = (notes || '').replace(FLOOR_NOTE, '')
  if (!(min > 0) || !perPerson || !Number.isFinite(q) || !(q < min)) return { quantity, notes: rest || null }
  return { quantity: min, notes: [`Billed at the ${min}-guest package minimum (${q} entered)`, rest].filter(Boolean).join(' — ') }
}

// Line total: per-head lines multiply by the head count on the line.
function lineTotal(l: { quantity: number; unitPrice: string | null }): number {
  return Number(l.unitPrice || 0) * Number(l.quantity || 0)
}

/**
 * WHAT AN EVENT IS PRICED AT IS THE BOOKS. (T62) The quote and the deposit on the event row and the room's minimum
 * spend and hire fee are invoices:read, on every response that carries them. Absent, not zero, so the screen leaves the
 * money out rather than working a shortfall out of nothing.
 */
const EVENT_MONEY_KEYS = ['quotedTotal', 'depositRequired'] as const
const SPACE_MONEY_KEYS = ['minimumSpend', 'hireFee'] as const
const without = (row: any, keys: readonly string[]) => { if (!row) return row; const out = { ...row }; for (const k of keys) delete out[k]; return out }

/** A figure a coordinator has to read: separated thousands, never "$12000.00". (T41) */
const money = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * THE SAME RULE, FROM THE OTHER SIDE. (T41) A payment may not push the schedule past the invoice total; a write that
 * LOWERS the total (delete a menu line, edit one down, lower the quote) may not leave the schedule above it either. An
 * event with nothing scheduled is never refused.
 */
function menuChangeBreaksSchedule(synced: any): string | null {
  const schedule: any[] = synced?.schedule || []
  const scheduled = round2(schedule.reduce((s: number, p: any) => s + Number(p.amount || 0), 0))
  if (scheduled <= 0.005) return null
  const total = round2(Number(synced?.inv?.total || 0))
  if (scheduled > total + 0.005) {
    return `That change would leave ${money(scheduled)} of scheduled payments against an invoice total of ${money(total)}. Change the payment schedule first.`
  }
  return null
}

// The schedule can't promise more than the invoice bills. Checked after the invoice is in step with the menu/quote,
// inside the same transaction.
function scheduleExceedsInvoice(inv: any, schedule: any[], ignoreId: string | null | undefined, amount: number): string | null {
  const total = round2(Number(inv.total))
  if (total <= 0.005) return 'Add menu lines or a quoted total before scheduling payments — there is nothing to bill yet.'
  const scheduled = round2(schedule.filter((p: any) => p.id !== ignoreId).reduce((s: number, p: any) => s + Number(p.amount || 0), 0) + amount)
  if (scheduled > total + 0.005) return `Scheduled payments would total ${money(scheduled)} — more than the event's invoice total of ${money(total)}.`
  return null
}

export function createEventRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const { emitToCompany } = d.realtime
  const REFRESH = d.realtime.EVENTS.REFRESH
  const maySeeEventMoney = async (u: any) => hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

  // A ledger rule refused the write (it rolled back): answer with its message and status.
  const refusal = (c: any, e: unknown) => (e instanceof LedgerError ? fail(c, e.status, e.message) : null)
  const clash = (c: any, e: unknown) => (e instanceof SpaceClash ? fail(c, 409, e.message, 'space_held') : null)

  // Every child route re-checks the parent event belongs to this company, so a guessed eventId from another tenant
  // can't reach these rows.
  async function ownEvent(companyId: string, eventId: string | undefined) {
    if (!eventId) return null
    const [ev] = await db.select().from(event).where(and(eq(event.id, eventId), eq(event.companyId, companyId))).limit(1)
    return ev || null
  }

  const app = new Hono<AppEnv>()

  // GET /events — ?from=&to= on eventDate, ?status=, ?spaceId=, ?search=
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const from = c.req.query('from')
    const to = c.req.query('to')
    const status = c.req.query('status')
    const spaceId = c.req.query('spaceId')
    const search = c.req.query('search')

    const conditions = [eq(event.companyId, currentUser.companyId)]
    if (from) conditions.push(gte(event.eventDate, from))
    if (to) conditions.push(lte(event.eventDate, to))
    if (status) conditions.push(eq(event.status, status))
    if (spaceId) conditions.push(eq(event.spaceId, spaceId))
    if (search) conditions.push(or(ilike(event.name, `%${search}%`), ilike(contact.name, `%${search}%`))!)

    const data = await db.select({
      event,
      clientName: contact.name,
      clientPhone: contact.phone,
      clientEmail: contact.email,
      spaceName: eventSpace.name,
      coordinatorFirstName: user.firstName,
      coordinatorLastName: user.lastName,
    })
      .from(event)
      .leftJoin(contact, eq(event.contactId, contact.id))
      .leftJoin(eventSpace, eq(event.spaceId, eventSpace.id))
      .leftJoin(user, eq(event.coordinatorId, user.id))
      .where(and(...conditions))
      .orderBy(asc(event.eventDate))

    const rows = data.map((r: any) => ({
      ...r.event,
      clientName: r.clientName, clientPhone: r.clientPhone, clientEmail: r.clientEmail,
      spaceName: r.spaceName,
      coordinatorFirstName: r.coordinatorFirstName, coordinatorLastName: r.coordinatorLastName,
    }))
    const shown = (await maySeeEventMoney(currentUser)) ? rows : rows.map((r: any) => without(r, EVENT_MONEY_KEYS))
    return listAll(c, shown)
  })

  // GET /events/:id — the full file
  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [ev] = await db.select().from(event).where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId))).limit(1)
    if (!ev) return fail(c, 404, 'Event not found')

    const [client] = ev.contactId ? await db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
    const [space] = ev.spaceId ? await db.select().from(eventSpace).where(eq(eventSpace.id, ev.spaceId)).limit(1) : [null]
    const timeline = await db.select().from(eventTimeline)
      .where(and(eq(eventTimeline.eventId, id), eq(eventTimeline.companyId, currentUser.companyId)))
      .orderBy(asc(eventTimeline.sortOrder), asc(eventTimeline.time))

    const ledger = await loadEventLedger(db, currentUser.companyId, id)
    const inv: any = ledger?.invoice

    /**
     * THE SAME RULE ON THE EVENT PAGE. (T41) The event itself stays — who, when, which room, how many covers, the menu
     * lines and the run of show. What goes is the money: the schedule, the invoice card, the totals, and the per-line
     * prices (the kitchen needs "120 × plated dinner", not what it is charged at).
     */
    const maySeeMoney = await maySeeEventMoney(currentUser)
    const menuRows = ledger?.menu || []
    return one(c, {
      event: maySeeMoney ? ev : without(ev, EVENT_MONEY_KEYS),
      // the customer's portal credential never travels with their record (T42)
      client: client ? withoutPortalCredential(client) : null,
      space: (maySeeMoney ? space : without(space, SPACE_MONEY_KEYS)) || null,
      menu: maySeeMoney ? menuRows : menuRows.map(({ unitPrice: _price, ...rest }: any) => rest),
      timeline,
      ...(maySeeMoney ? {
        payments: ledger?.payments || [],
        invoice: inv ? { id: inv.id, number: inv.number, status: deriveStatus(inv), dueDate: inv.dueDate, total: inv.total, taxAmount: inv.taxAmount, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded, sentAt: inv.sentAt } : null,
        totals: ledger?.totals,
      } : { payments: [], invoice: null, moneyWithheld: true }),
    })
  })

  // POST /events
  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const vErr = validateEventInput(body)
    if (vErr) return fail(c, 400, vErr)
    const cErr = await coordinatorRefusal(db, currentUser.companyId, body.coordinatorId)
    if (cErr) return fail(c, 400, cErr)

    let created: any
    try {
      created = await db.transaction((tx: any) => createEvent(tx, currentUser.companyId, body))
    } catch (e: unknown) {
      const refused = clash(c, e)
      if (refused) return refused
      throw e
    }

    await audit.log({ action: 'create', entity: 'event', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    // Saved as asked; a past date or an over-capacity room is reported, not refused (T17 L1/L2).
    const warnings = await eventWarnings(db, currentUser.companyId, created, { date: true, capacity: true })
    return one(c, { ...((await maySeeEventMoney(currentUser)) ? created : without(created, EVENT_MONEY_KEYS)), warnings }, 201)
  })

  // PUT /events/:id
  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(event).where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Event not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['contactId', 'spaceId', 'coordinatorId', 'name', 'eventType', 'status', 'eventDate',
      'startTime', 'endTime', 'guestCount', 'guestCountFinal', 'quotedTotal', 'depositRequired',
      'source', 'lostReason', 'dietaryRequirements', 'setupNotes', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    // The quote and the deposit are set by a seat that may see them; anyone else's form never held the figures, so
    // whatever it posts back for them is dropped, not saved over the real ones. (T62)
    const editorSeesMoney = await maySeeEventMoney(currentUser)
    if (!editorSeesMoney) for (const k of EVENT_MONEY_KEYS) delete updates[k]

    // The same rules as a create, against the effective values, so editing one of start/end re-checks the pair.
    const vErr = validateEventInput(updates, existing)
    if (vErr) return fail(c, 400, vErr)
    if ('coordinatorId' in updates) {
      const cErr = await coordinatorRefusal(db, currentUser.companyId, updates.coordinatorId)
      if (cErr) return fail(c, 400, cErr)
    }

    // Moving the date, changing the room, or promoting an enquiry can all create a double-book; re-check on any.
    const nextSpace = 'spaceId' in updates ? updates.spaceId : existing.spaceId
    const nextDate = updates.eventDate ?? existing.eventDate
    const nextStatus = 'status' in updates ? updates.status : existing.status
    let updated: any
    try {
      updated = await db.transaction(async (tx: any) => {
        await lockEventBook(tx, currentUser.companyId)
        if (nextSpace && HELD.includes(nextStatus)) {
          const held = await findClash(tx, currentUser.companyId, nextSpace, nextDate, id)
          if (held) throw new SpaceClash(clashMessage(nextDate, held), held.id)
        }
        const [row] = await tx.update(event).set(updates).where(eq(event.id, id)).returning()
        if ((existing.spaceId || null) !== (row.spaceId || null)) await syncHireLine(tx, currentUser.companyId, row)
        // Leaving the book closes the invoice (void, or deposit retained — body.keepDeposit); anything else keeps the
        // invoice in step with the event (quote, room, client, due date).
        if (EXIT_STATUSES.includes(row.status) && !EXIT_STATUSES.includes(existing.status)) {
          await closeEventInvoice(tx, currentUser.companyId, id, body.keepDeposit === true)
        } else {
          const synced = await syncEventInvoice(tx, currentUser.companyId, id)
          if (synced?.inv && synced.inv.status !== 'void' && !row.contactId) {
            throw new LedgerError(`This event is billed on invoice ${synced.inv.number}, which needs a client. Choose a client instead of removing it.`)
          }
          // Lowering the quote lowers the invoice — the third way to get under a schedule already set. (T41)
          const broken = menuChangeBreaksSchedule(synced)
          if (broken) throw new LedgerError(broken)
        }
        return row
      })
    } catch (e: unknown) {
      const refused = clash(c, e) || refusal(c, e)
      if (refused) return refused
      throw e
    }
    await audit.log({ action: 'update', entity: 'event', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    // Only what this edit changed is warned about, so re-saving a past event for another reason is quiet.
    const changed = (k: string) => k in updates && String(updates[k] ?? '') !== String((existing as any)[k] ?? '')
    const warnings = await eventWarnings(db, currentUser.companyId, updated, { date: changed('eventDate'), capacity: changed('spaceId') || changed('guestCount') || changed('guestCountFinal') })
    return one(c, { ...(editorSeesMoney ? updated : without(updated, EVENT_MONEY_KEYS)), warnings })
  })

  // DELETE /events/:id — cancel, keeping the row so win/loss stays measurable. ?keepDeposit=1 closes the invoice at
  // what was collected; with money collected and no choice made, 409 (refund it first).
  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(event).where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Event not found')

    let updated: any
    try {
      updated = await db.transaction(async (tx: any) => {
        const [row] = await tx.update(event).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(event.id, id)).returning()
        if (!EXIT_STATUSES.includes(existing.status)) await closeEventInvoice(tx, currentUser.companyId, id, c.req.query('keepDeposit') === '1')
        return row
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }

    await audit.log({ action: 'update', entity: 'event', entityId: id, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, { success: true, event: updated })
  })

  // POST /events/:id/menu — a package fills in name + price; a free line doesn't.
  app.post('/:id/menu', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const ev = await ownEvent(currentUser.companyId, eventId)
    if (!ev) return fail(c, 404, 'Event not found')

    let name = typeof body.name === 'string' ? body.name.trim() : ''
    let unitPrice = body.unitPrice ?? null
    let perPerson = body.perPerson ?? true

    let pkg: any = null
    if (body.packageId) {
      ;[pkg] = await db.select().from(menuPackage).where(and(eq(menuPackage.id, body.packageId), eq(menuPackage.companyId, currentUser.companyId))).limit(1)
      if (!pkg) return fail(c, 404, 'Package not found')
      if (!name) name = pkg.name
      if (unitPrice === null || unitPrice === undefined) unitPrice = pkg.pricePerPerson
      if (!('perPerson' in body) || typeof body.perPerson !== 'boolean') perPerson = true
    }
    if (!name) return fail(c, 400, 'name or packageId is required')

    // No negative money or quantities (H-01); a sub-cent price and a quantity of nought are refused, a complimentary
    // $0 line is not (T51).
    const mErr = moneyRefusal(unitPrice, 'Unit price') || quantityRefusal(body.quantity)
    if (mErr) return fail(c, 400, mErr)

    // Per-head lines default to the event's head count; a package's minimum is then the billing floor.
    const { quantity, notes } = packageFloor(pkg, perPerson, body.quantity ?? (perPerson ? (ev.guestCountFinal ?? ev.guestCount ?? 1) : 1), body.notes || null)

    let created: any
    try {
      created = await db.transaction(async (tx: any) => {
        const [row] = await tx.insert(eventMenuItem).values({
          id: createId(), eventId, packageId: body.packageId || null, name, perPerson, quantity, unitPrice, notes,
          companyId: currentUser.companyId,
        }).returning()
        await syncEventInvoice(tx, currentUser.companyId, eventId)
        return row
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }

    await audit.log({ action: 'create', entity: 'event_menu_item', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, created, 201)
  })

  // PUT /events/:id/menu/:lineId
  app.put('/:id/menu/:lineId', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const lineId = c.req.param('lineId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(eventMenuItem)
      .where(and(eq(eventMenuItem.id, lineId), eq(eventMenuItem.eventId, eventId), eq(eventMenuItem.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Menu line not found')

    const EDITABLE = ['name', 'perPerson', 'quantity', 'unitPrice', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    // The same rule on the edit, where a price gets corrected and re-mistyped. (H-01, T16 L5, T51)
    const mErr = ('unitPrice' in updates ? moneyRefusal(updates.unitPrice, 'Unit price') : null)
      || ('quantity' in updates ? quantityRefusal(updates.quantity) : null)
    if (mErr) return fail(c, 400, mErr)
    // The billing floor holds on edit too. (T16 M9)
    if (existing.packageId && ('quantity' in updates || 'perPerson' in updates || 'notes' in updates)) {
      const [pkg] = await db.select().from(menuPackage).where(and(eq(menuPackage.id, existing.packageId), eq(menuPackage.companyId, currentUser.companyId))).limit(1)
      const floored = packageFloor(pkg, 'perPerson' in updates ? updates.perPerson !== false : existing.perPerson, updates.quantity ?? existing.quantity, 'notes' in updates ? updates.notes || null : existing.notes)
      updates.quantity = floored.quantity
      updates.notes = floored.notes
    }

    let updated: any
    try {
      updated = await db.transaction(async (tx: any) => {
        const [row] = await tx.update(eventMenuItem).set(updates).where(eq(eventMenuItem.id, lineId)).returning()
        // Editing a line DOWN lowers the invoice just as deleting it does. (T41)
        const synced = await syncEventInvoice(tx, currentUser.companyId, eventId)
        const broken = menuChangeBreaksSchedule(synced)
        if (broken) throw new LedgerError(broken)
        return row
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }
    await audit.log({ action: 'update', entity: 'event_menu_item', entityId: lineId, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, updated)
  })

  // DELETE /events/:id/menu/:lineId
  app.delete('/:id/menu/:lineId', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const lineId = c.req.param('lineId')

    const [existing] = await db.select().from(eventMenuItem)
      .where(and(eq(eventMenuItem.id, lineId), eq(eventMenuItem.eventId, eventId), eq(eventMenuItem.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Menu line not found')

    try {
      await db.transaction(async (tx: any) => {
        await tx.delete(eventMenuItem).where(eq(eventMenuItem.id, lineId))
        // Removing a line lowers the invoice; if that leaves the schedule above it, the throw rolls the delete back. (T41)
        const synced = await syncEventInvoice(tx, currentUser.companyId, eventId)
        const broken = menuChangeBreaksSchedule(synced)
        if (broken) throw new LedgerError(broken)
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }
    await audit.log({ action: 'delete', entity: 'event_menu_item', entityId: lineId, entityName: auditName(existing), metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return done(c)
  })

  // POST /events/:id/timeline
  app.post('/:id/timeline', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const ev = await ownEvent(currentUser.companyId, eventId)
    if (!ev) return fail(c, 404, 'Event not found')
    // A real HH:MM time, a title, a department from the list. (T16 M3)
    const vErr = validateTimelineInput(body)
    if (vErr) return fail(c, 400, vErr)

    const [created] = await db.insert(eventTimeline).values({
      id: createId(), eventId, time: body.time.trim(), title: body.title.trim(), department: body.department || 'floor',
      details: body.details || null, sortOrder: body.sortOrder ?? 0, companyId: currentUser.companyId,
    }).returning()

    await audit.log({ action: 'create', entity: 'event_timeline', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, created, 201)
  })

  // PUT /events/:id/timeline/:lineId
  app.put('/:id/timeline/:lineId', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const lineId = c.req.param('lineId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(eventTimeline)
      .where(and(eq(eventTimeline.id, lineId), eq(eventTimeline.eventId, eventId), eq(eventTimeline.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Timeline line not found')
    const vErr = validateTimelineInput(body, existing)
    if (vErr) return fail(c, 400, vErr)

    const EDITABLE = ['time', 'title', 'department', 'details', 'sortOrder'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    const [updated] = await db.update(eventTimeline).set(updates).where(eq(eventTimeline.id, lineId)).returning()
    await audit.log({ action: 'update', entity: 'event_timeline', entityId: lineId, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, updated)
  })

  // DELETE /events/:id/timeline/:lineId
  app.delete('/:id/timeline/:lineId', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const lineId = c.req.param('lineId')

    const [existing] = await db.select().from(eventTimeline)
      .where(and(eq(eventTimeline.id, lineId), eq(eventTimeline.eventId, eventId), eq(eventTimeline.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Timeline line not found')

    await db.delete(eventTimeline).where(eq(eventTimeline.id, lineId))
    await audit.log({ action: 'delete', entity: 'event_timeline', entityId: lineId, entityName: auditName(existing), metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return done(c)
  })

  // POST /events/:id/payments — schedule an installment. Raises the event's invoice on the first one. Recording that it
  // was PAID happens on the invoice (POST /api/invoices/:id/payments).
  app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const ev = await ownEvent(currentUser.companyId, eventId)
    if (!ev) return fail(c, 404, 'Event not found')
    if (body.amount === undefined || body.amount === null || body.amount === '') return fail(c, 400, 'amount is required')
    // An instalment of nothing is never meant (zeroAllowed: false), and the message must not suggest entering 0.
    // (H-01, T51, T58 follow-up)
    const amt = Number(body.amount)
    const mErr = moneyRefusal(body.amount, 'Amount', { zeroAllowed: false })
    if (mErr) return fail(c, 400, mErr)
    if (!Number.isFinite(amt) || round2(amt) <= 0) return fail(c, 400, 'Amount must be more than $0.00.')
    if (body.dueDate && !DATE_RE.test(body.dueDate)) return fail(c, 400, 'dueDate must be YYYY-MM-DD')

    let created: any
    try {
      created = await db.transaction(async (tx: any) => {
        await ensureEventInvoice(tx, currentUser.companyId, eventId)
        const synced = await syncEventInvoice(tx, currentUser.companyId, eventId)
        const tooMuch = scheduleExceedsInvoice(synced!.inv, synced!.schedule, null, amt)
        if (tooMuch) throw new LedgerError(tooMuch)
        const [row] = await tx.insert(eventPayment).values({
          id: createId(), eventId,
          label: (typeof body.label === 'string' && body.label.trim()) || 'Payment',
          amount: round2(amt).toString(), dueDate: body.dueDate || null, notes: body.notes || null,
          companyId: currentUser.companyId,
        }).returning()
        await syncEventInvoice(tx, currentUser.companyId, eventId, { linesToo: false })
        return row
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }

    await audit.log({ action: 'create', entity: 'event_payment', entityId: created.id, entityName: auditName(created), metadata: created, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, created, 201)
  })

  // PUT /events/:id/payments/:paymentId — change an installment's label, amount or due date.
  app.put('/:id/payments/:paymentId', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const paymentId = c.req.param('paymentId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(eventPayment)
      .where(and(eq(eventPayment.id, paymentId), eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Payment not found')

    // The schedule only: whether it is paid comes from the invoice, so paidAt/method/reference are not editable.
    const EDITABLE = ['label', 'amount', 'dueDate', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    if ('amount' in updates) {
      const mErr = moneyRefusal(updates.amount, 'Amount', { zeroAllowed: false })
      if (mErr) return fail(c, 400, mErr)
      const amt = Number(updates.amount)
      if (updates.amount === null || updates.amount === '' || !Number.isFinite(amt) || round2(amt) <= 0) return fail(c, 400, 'Amount must be more than $0.00.')
      updates.amount = round2(amt).toString()
    }
    if (updates.dueDate && !DATE_RE.test(updates.dueDate)) return fail(c, 400, 'dueDate must be YYYY-MM-DD')
    if ('label' in updates && !(typeof updates.label === 'string' && updates.label.trim())) return fail(c, 400, 'label is required')
    // Money already recorded against this installment can't be edited away. (T16 L7)
    if ('amount' in updates) {
      const covered = (await loadEventLedger(db, currentUser.companyId, eventId))?.payments.find((p: any) => p.id === paymentId)
      if (covered && Number(updates.amount) < covered.paidAmount - 0.005) return fail(c, 409, `"${existing.label}" already has ${money(covered.paidAmount)} recorded against it — the amount can't go below that. Refund on the invoice first.`)
    }

    let updated: any
    try {
      updated = await db.transaction(async (tx: any) => {
        if ('amount' in updates) {
          const synced = await syncEventInvoice(tx, currentUser.companyId, eventId)
          if (synced?.inv) {
            const tooMuch = scheduleExceedsInvoice(synced.inv, synced.schedule, paymentId, Number(updates.amount))
            if (tooMuch) throw new LedgerError(tooMuch)
          }
        }
        const [row] = await tx.update(eventPayment).set(updates).where(eq(eventPayment.id, paymentId)).returning()
        await syncEventInvoice(tx, currentUser.companyId, eventId, { linesToo: false })
        return row
      })
    } catch (e: unknown) {
      const refused = refusal(c, e)
      if (refused) return refused
      throw e
    }
    await audit.log({ action: 'update', entity: 'event_payment', entityId: paymentId, entityName: auditName(updated), changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return one(c, updated)
  })

  // DELETE /events/:id/payments/:paymentId — drop an installment from the schedule. Money already collected stays on
  // the invoice; only the due date moves. A covered installment stays until that money is refunded. (T16 L7)
  app.delete('/:id/payments/:paymentId', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const eventId = c.req.param('id')
    const paymentId = c.req.param('paymentId')

    const [existing] = await db.select().from(eventPayment)
      .where(and(eq(eventPayment.id, paymentId), eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Payment not found')
    const covered = (await loadEventLedger(db, currentUser.companyId, eventId))?.payments.find((p: any) => p.id === paymentId)
    if (covered && covered.paidAmount > 0.005) return fail(c, 409, `"${existing.label}" already has ${money(covered.paidAmount)} recorded against it — refund it on the invoice before removing it from the schedule.`)

    await db.transaction(async (tx: any) => {
      await tx.delete(eventPayment).where(eq(eventPayment.id, paymentId))
      await syncEventInvoice(tx, currentUser.companyId, eventId, { linesToo: false })
    })
    await audit.log({ action: 'delete', entity: 'event_payment', entityId: paymentId, entityName: auditName(existing), metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, REFRESH, { entity: 'event' })
    return done(c)
  })

  // GET /events/:id/beo — the banquet event order, printable: the sheet that goes on the pass and behind the bar. HTML,
  // so it prints from any device without a PDF toolchain.
  app.get('/:id/beo', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const id = c.req.param('id')
    const [ev] = await db.select().from(event).where(and(eq(event.id, id), eq(event.companyId, u.companyId))).limit(1)
    if (!ev) return fail(c, 404, 'Event not found')

    const [client] = ev.contactId ? await db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null as any]
    const [space] = ev.spaceId ? await db.select().from(eventSpace).where(eq(eventSpace.id, ev.spaceId)).limit(1) : [null as any]
    const [venue] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    const [coordinator] = ev.coordinatorId ? await db.select().from(user).where(eq(user.id, ev.coordinatorId)).limit(1) : [null as any]

    const timeline: any[] = await db.select().from(eventTimeline)
      .where(and(eq(eventTimeline.eventId, id), eq(eventTimeline.companyId, u.companyId)))
      .orderBy(asc(eventTimeline.sortOrder), asc(eventTimeline.time))
    const ledger = await loadEventLedger(db, u.companyId, id)
    const menu: any[] = ledger?.menu || []
    const payments = ledger?.payments || []
    const { menuTotal, fbTotal, paid, outstanding } = ledger!.totals
    const STATE_LABEL: Record<string, string> = { paid: 'Paid', part_paid: 'Part paid', unpaid: 'Due', refunded: 'Refunded', void: 'Void' }

    /**
     * THE KITCHEN/FLOOR BEO. (T41) The kitchen needs the items, the basis, the QUANTITIES and the run of show; never the
     * unit price, the F&B total or the payment schedule. Printed without the money for a seat without invoices:read,
     * rather than refused: a service team with no BEO cannot run the event.
     */
    const beoMoney = hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

    const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
    const cash = (n: any) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const row = (label: string, val: string) => val ? `<tr><td class="l">${label}</td><td class="v">${esc(val)}</td></tr>` : ''
    const heads = ev.guestCountFinal ?? ev.guestCount ?? 0

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BEO — ${esc(ev.name)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;max-width:760px;margin:32px auto;padding:0 24px;}
  .head{text-align:center;border-bottom:3px double #1a1a1a;padding-bottom:12px;margin-bottom:20px;}
  .head h1{margin:0;font-size:22px;letter-spacing:.04em;text-transform:uppercase;}
  .head p{margin:4px 0 0;font-size:13px;color:#555;}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px;margin:22px 0 8px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  td.l{width:34%;color:#666;padding:5px 8px 5px 0;vertical-align:top;}
  td.v{font-weight:600;padding:5px 0;}
  table.grid td,table.grid th{border-bottom:1px solid #eee;padding:6px 4px;text-align:left;vertical-align:top;}
  .detail{display:block;font-size:13px;color:#444;font-weight:400;}
  table.grid th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:600;}
  td.num{text-align:right;}
  .dept{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;}
  .alert{background:#fff4f4;border:1px solid #f0c9c9;padding:10px 12px;border-radius:4px;margin-top:8px;font-size:13px;}
  .note{margin-top:28px;font-size:11px;color:#888;text-align:center;}
  @media print{body{margin:0;}}
</style></head><body>
  <div class="head">
    <h1>Banquet Event Order</h1>
    <p>${esc(venue?.name || '')}${venue?.phone ? ' · ' + esc(venue.phone) : ''}</p>
  </div>

  <h2>Event</h2>
  <table>
    ${row('Event', ev.name)}
    ${row('Date', eventDayWords(ev.eventDate))}
    ${row('Time', [ev.startTime, ev.endTime].filter(Boolean).join(' – '))}
    ${row('Space', space?.name || '')}
    ${row('Type', eventCodeWords(ev.eventType))}
    ${row('Guests', heads ? String(heads) + (ev.guestCountFinal ? ' (guaranteed)' : ' (estimated)') : '')}
    ${row('Coordinator', [coordinator?.firstName, coordinator?.lastName].filter(Boolean).join(' '))}
    ${row('Status', eventCodeWords(ev.status))}
  </table>

  <h2>Client</h2>
  <table>
    ${row('Name', client?.name || '')}
    ${row('Phone', client?.mobile || client?.phone || '')}
    ${row('Email', client?.email || '')}
  </table>

  ${ev.dietaryRequirements ? `<div class="alert"><strong>Dietary requirements:</strong> ${esc(ev.dietaryRequirements)}</div>` : ''}

  <h2>Food &amp; Beverage</h2>
  ${menu.length ? (beoMoney ? `<table class="grid">
    <tr><th>Item</th><th>Basis</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr>
    ${menu.map((l) => `<tr><td>${esc(l.name)}${l.notes ? `<br><span class="dept">${esc(l.notes)}</span>` : ''}</td><td>${l.perPerson ? 'per person' : 'flat'}</td><td class="num">${l.quantity}</td><td class="num">${cash(l.unitPrice)}</td><td class="num">${cash(lineTotal(l))}</td></tr>`).join('')}
    <tr><td colspan="4" class="num"><strong>Food &amp; beverage total</strong></td><td class="num"><strong>${cash(fbTotal)}</strong></td></tr>${menuTotal > fbTotal + 0.005 ? `
    <tr><td colspan="4" class="num">Room hire</td><td class="num">${cash(menuTotal - fbTotal)}</td></tr>
    <tr><td colspan="4" class="num"><strong>Menu total</strong></td><td class="num"><strong>${cash(menuTotal)}</strong></td></tr>` : ''}
  </table>` : `<table class="grid">
    <tr><th>Item</th><th>Basis</th><th class="num">Qty</th></tr>
    ${menu.map((l) => `<tr><td>${esc(l.name)}${l.notes ? `<br><span class="dept">${esc(l.notes)}</span>` : ''}</td><td>${l.perPerson ? 'per person' : 'flat'}</td><td class="num">${l.quantity}</td></tr>`).join('')}
  </table>`) : '<p style="color:#888;font-size:13px;">No menu lines recorded.</p>'}

  <h2>Run of Show</h2>
  ${timeline.length ? `<table class="grid">
    <tr><th style="width:80px">Time</th><th>What</th><th style="width:90px">Dept</th></tr>
    ${timeline.map((t) => `<tr><td>${esc(t.time)}</td><td><strong>${esc(t.title)}</strong>${t.details ? `<span class="detail">${esc(t.details)}</span>` : ''}</td><td class="dept">${esc(eventCodeWords(t.department))}</td></tr>`).join('')}
  </table>` : '<p style="color:#888;font-size:13px;">No run of show recorded.</p>'}

  ${ev.setupNotes ? `<h2>Setup</h2><p style="font-size:14px;white-space:pre-wrap;">${esc(ev.setupNotes)}</p>` : ''}

  ${beoMoney ? `<h2>Payments</h2>
  ${payments.length ? `<table class="grid">
    <tr><th>Stage</th><th>Due</th><th>Status</th><th class="num">Amount</th></tr>
    ${payments.map((p) => `<tr><td>${esc(p.label)}</td><td>${esc(p.dueDate ? eventDayWords(p.dueDate) : '—')}</td><td>${esc(STATE_LABEL[p.state] || p.state)}${p.state === 'part_paid' ? ` (${cash(p.paidAmount)})` : ''}</td><td class="num">${cash(p.amount)}</td></tr>`).join('')}
    <tr><td colspan="3" class="num"><strong>Paid to date</strong></td><td class="num"><strong>${cash(paid)}</strong></td></tr>
    <tr><td colspan="3" class="num"><strong>Outstanding</strong></td><td class="num"><strong>${cash(outstanding)}</strong></td></tr>
  </table>` : '<p style="color:#888;font-size:13px;">No payment schedule recorded.</p>'}` : ''}

  ${ev.notes ? `<h2>Notes</h2><p style="font-size:14px;white-space:pre-wrap;">${esc(ev.notes)}</p>` : ''}

  <p class="note">Generated from ${esc(venue?.name || 'the venue')}'s event records. Confirm final guest numbers before service.</p>
</body></html>`

    return c.html(html)
  })

  return app
}
