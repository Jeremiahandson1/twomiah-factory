import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { event, eventSpace, eventMenuItem, eventTimeline, eventPayment, menuPackage, contact, company, user } from '../../db/schema.ts'
import { eq, and, gte, lte, ne, or, ilike, desc, asc, inArray, isNotNull, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'
import { deriveStatus, round2 } from '../shared/index.ts'
import { LedgerError, EXIT_STATUSES, loadEventLedger, ensureEventInvoice, syncEventInvoice, closeEventInvoice, backfillEventInvoices } from '../services/eventLedger.ts'
// What an event may hold and how a booking is written — shared with the CSV importer (#162).
import { HELD, DATE_RE, SpaceClash, eventLock, findClash, syncHireLine, createEvent, validateEventInput, validateTimelineInput } from '../services/eventBooking.ts'

/**
 * Events — the booking, and everything hanging off it.
 *
 *   GET  /events                    pipeline / calendar list
 *   GET  /events/:id                the full file: menu, run of show, payments
 *   POST /events                    new enquiry
 *   PUT  /events/:id                update (double-books rejected)
 *   POST /events/:id/menu           add a line
 *   PUT/DELETE /events/:id/menu/:lineId
 *   POST /events/:id/timeline       add a BEO line
 *   PUT/DELETE /events/:id/timeline/:lineId
 *   POST /events/:id/payments       schedule a deposit / balance
 *   PUT/DELETE /events/:id/payments/:paymentId
 *   GET  /events/:id/beo            printable banquet event order (HTML)
 *
 * A space can only host one live event per date. HELD lists the statuses that
 * hold the room; enquiries deliberately do NOT, because two people asking
 * about the same Saturday is normal and must not block either of them.
 *
 * Money lives on the event's invoice (services/eventLedger.ts): these routes keep
 * the schedule and keep the invoice in step with the menu; payments, refunds and
 * voids are recorded on the invoice itself (/api/invoices/:id/...).
 */

const app = new Hono()
// Move any payments recorded on event_payment before the ledger lived on invoices. Once per process,
// idempotent, fire-and-forget so it can never delay or fail startup.
void backfillEventInvoices().catch((err) => console.error('[events] invoice backfill failed', err))
app.use('*', authenticate)

// Line total: per-head lines multiply by the head count on the line.
function lineTotal(l: { perPerson: boolean; quantity: number; unitPrice: string | null }): number {
  return Number(l.unitPrice || 0) * Number(l.quantity || 0)
}

// A ledger rule refused the write (it rolled back): answer with its message and status.
const ledgerError = (c: any, e: unknown) => (e instanceof LedgerError ? c.json({ error: e.message }, e.status) : null)

// ─── Events ──────────────────────────────────────────────────────────────────

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
  return c.json({ data: rows })
})

// GET /events/:id — the full file
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  if (!id) return c.json({ error: 'Event not found' }, 404)

  const [ev] = await db.select().from(event)
    .where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId)))
    .limit(1)
  if (!ev) return c.json({ error: 'Event not found' }, 404)

  const [client] = ev.contactId
    ? await db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1)
    : [null]
  const [space] = ev.spaceId
    ? await db.select().from(eventSpace).where(eq(eventSpace.id, ev.spaceId)).limit(1)
    : [null]

  const timeline = await db.select().from(eventTimeline)
    .where(and(eq(eventTimeline.eventId, id), eq(eventTimeline.companyId, currentUser.companyId)))
    .orderBy(asc(eventTimeline.sortOrder), asc(eventTimeline.time))

  const ledger = await loadEventLedger(currentUser.companyId, id)
  const inv: any = ledger?.invoice

  return c.json({
    event: ev,
    client: client || null,
    space: space || null,
    menu: ledger?.menu || [],
    timeline,
    // The schedule, each installment with what the invoice has covered of it (state/paidAmount).
    payments: ledger?.payments || [],
    invoice: inv ? { id: inv.id, number: inv.number, status: deriveStatus(inv), dueDate: inv.dueDate, total: inv.total, taxAmount: inv.taxAmount, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded, sentAt: inv.sentAt } : null,
    totals: ledger?.totals,
  })
})

// POST /events
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const vErr = validateEventInput(body)
  if (vErr) return c.json({ error: vErr }, 400)

  let created
  try {
    created = await db.transaction((tx: any) => createEvent(tx, currentUser.companyId, body))
  } catch (e: any) {
    if (e instanceof SpaceClash) return c.json(e.payload, 409)
    throw e
  }

  await audit.log({ action: 'create', entity: 'event', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(created, 201)
})

// PUT /events/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(event)
    .where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Event not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['contactId', 'spaceId', 'coordinatorId', 'name', 'eventType', 'status', 'eventDate',
    'startTime', 'endTime', 'guestCount', 'guestCountFinal', 'quotedTotal', 'depositRequired',
    'source', 'lostReason', 'dietaryRequirements', 'setupNotes', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  // The same rules as a create, against the effective values (incoming update falling back to existing),
  // so editing just one of start/end still re-checks the pair. (F5, #162)
  const vErr = validateEventInput(updates, existing)
  if (vErr) return c.json({ error: vErr }, 400)

  // Moving the date, changing the room, or promoting an enquiry to tentative
  // can all create a double-book, so re-check on any of them.
  const nextSpace = 'spaceId' in updates ? updates.spaceId : existing.spaceId
  const nextDate = updates.eventDate ?? existing.eventDate
  const nextStatus = 'status' in updates ? updates.status : existing.status
  let updated
  try {
    updated = await db.transaction(async (tx: any) => {
      await eventLock(tx, currentUser.companyId)
      if (nextSpace && HELD.includes(nextStatus)) {
        const clash = await findClash(tx, currentUser.companyId, nextSpace, nextDate, id)
        if (clash) throw new SpaceClash({ error: `That space is already held on ${nextDate} by "${clash.name}"`, conflictId: clash.id })
      }
      const [row] = await tx.update(event).set(updates).where(eq(event.id, id)).returning()
      if ((existing.spaceId || null) !== (row.spaceId || null)) await syncHireLine(tx, currentUser.companyId, row)
      // Leaving the book closes the invoice (void, or deposit retained — body.keepDeposit); anything else
      // keeps the invoice in step with the event (quote, room, client, due date).
      if (EXIT_STATUSES.includes(row.status) && !EXIT_STATUSES.includes(existing.status)) {
        await closeEventInvoice(tx, currentUser.companyId, id, body.keepDeposit === true)
      } else {
        const synced = await syncEventInvoice(tx, currentUser.companyId, id)
        if (synced?.inv && synced.inv.status !== 'void' && !row.contactId) {
          throw new LedgerError(`This event is billed on invoice ${synced.inv.number}, which needs a client. Choose a client instead of removing it.`)
        }
      }
      return row
    })
  } catch (e: any) {
    if (e instanceof SpaceClash) return c.json(e.payload, 409)
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }
  await audit.log({ action: 'update', entity: 'event', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(updated)
})

// DELETE /events/:id — cancel, keeping the row so win/loss stays measurable. ?keepDeposit=1 closes the
// invoice at what was collected; with money collected and no choice made, 409 (refund it first).
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(event)
    .where(and(eq(event.id, id), eq(event.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Event not found' }, 404)

  let updated
  try {
    updated = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(event)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(event.id, id))
        .returning()
      if (!EXIT_STATUSES.includes(existing.status)) await closeEventInvoice(tx, currentUser.companyId, id, c.req.query('keepDeposit') === '1')
      return row
    })
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }

  await audit.log({ action: 'update', entity: 'event', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json({ success: true, event: updated })
})

// ─── Child collections ───────────────────────────────────────────────────────
// Every child route re-checks the parent event belongs to this company, so a
// guessed eventId from another tenant can't reach these rows.

async function ownEvent(companyId: string, eventId: string | undefined) {
  if (!eventId) return null
  const [ev] = await db.select().from(event)
    .where(and(eq(event.id, eventId), eq(event.companyId, companyId)))
    .limit(1)
  return ev || null
}

// POST /events/:id/menu — a package fills in name + price; a free line doesn't.
app.post('/:id/menu', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const ev = await ownEvent(currentUser.companyId, eventId)
  if (!ev) return c.json({ error: 'Event not found' }, 404)

  let name = typeof body.name === 'string' ? body.name.trim() : ''
  let unitPrice = body.unitPrice ?? null
  let perPerson = body.perPerson ?? true

  if (body.packageId) {
    const [pkg] = await db.select().from(menuPackage)
      .where(and(eq(menuPackage.id, body.packageId), eq(menuPackage.companyId, currentUser.companyId)))
      .limit(1)
    if (!pkg) return c.json({ error: 'Package not found' }, 404)
    if (!name) name = pkg.name
    if (unitPrice === null || unitPrice === undefined) unitPrice = pkg.pricePerPerson
    if (!('perPerson' in body)) perPerson = true
    // The package minimum is advisory, not a hard wall: a coordinator must be able
    // to add the line at the quantity they actually typed (it was rejecting any
    // number below the minimum — e.g. 5 on a min-25 package — and blocking the
    // package entirely on any event smaller than the minimum). The below-minimum
    // state is surfaced as a warning banner on the event instead of a 400.
  }
  if (!name) return c.json({ error: 'name or packageId is required' }, 400)

  // Reject negative money/quantities — a -$50 line was accepted and subtracted
  // from the total (H-01).
  // Say which it is: "abc" is not a number, -50 is negative (T16 L5).
  if (unitPrice !== null && unitPrice !== undefined && !Number.isFinite(Number(unitPrice))) return c.json({ error: 'Unit price must be a number' }, 400)
  if (unitPrice !== null && unitPrice !== undefined && Number(unitPrice) < 0) return c.json({ error: 'Unit price cannot be negative' }, 400)
  if (body.quantity !== undefined && body.quantity !== null && !Number.isFinite(Number(body.quantity))) return c.json({ error: 'Quantity must be a number' }, 400)
  if (body.quantity !== undefined && body.quantity !== null && Number(body.quantity) < 0) return c.json({ error: 'Quantity cannot be negative' }, 400)

  let created
  try {
    created = await db.transaction(async (tx: any) => {
      const [row] = await tx.insert(eventMenuItem).values({
        id: createId(),
        eventId,
        packageId: body.packageId || null,
        name,
        perPerson,
        // Per-head lines default to the event's head count so the quote follows the
        // guest number instead of being re-typed every time it moves.
        quantity: body.quantity ?? (perPerson ? (ev.guestCountFinal ?? ev.guestCount ?? 1) : 1),
        unitPrice,
        notes: body.notes || null,
        companyId: currentUser.companyId,
      }).returning()
      await syncEventInvoice(tx, currentUser.companyId, eventId)
      return row
    })
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }

  await audit.log({ action: 'create', entity: 'event_menu_item', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(created, 201)
})

// PUT /events/:id/menu/:lineId
app.put('/:id/menu/:lineId', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const lineId = c.req.param('lineId')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(eventMenuItem)
    .where(and(eq(eventMenuItem.id, lineId), eq(eventMenuItem.eventId, eventId), eq(eventMenuItem.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Menu line not found' }, 404)

  const EDITABLE = ['name', 'perPerson', 'quantity', 'unitPrice', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  // Same guard as POST — the edit path let a line go negative after it was added (H-01); "abc" is not a number (T16 L5).
  if (updates.unitPrice !== null && updates.unitPrice !== undefined && !Number.isFinite(Number(updates.unitPrice))) return c.json({ error: 'Unit price must be a number' }, 400)
  if (updates.unitPrice !== null && updates.unitPrice !== undefined && Number(updates.unitPrice) < 0) return c.json({ error: 'Unit price cannot be negative' }, 400)
  if (updates.quantity !== undefined && updates.quantity !== null && !Number.isFinite(Number(updates.quantity))) return c.json({ error: 'Quantity must be a number' }, 400)
  if (updates.quantity !== undefined && updates.quantity !== null && Number(updates.quantity) < 0) return c.json({ error: 'Quantity cannot be negative' }, 400)

  let updated
  try {
    updated = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(eventMenuItem).set(updates).where(eq(eventMenuItem.id, lineId)).returning()
      await syncEventInvoice(tx, currentUser.companyId, eventId)
      return row
    })
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }
  await audit.log({ action: 'update', entity: 'event_menu_item', entityId: lineId, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(updated)
})

// DELETE /events/:id/menu/:lineId
app.delete('/:id/menu/:lineId', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const lineId = c.req.param('lineId')

  const [existing] = await db.select().from(eventMenuItem)
    .where(and(eq(eventMenuItem.id, lineId), eq(eventMenuItem.eventId, eventId), eq(eventMenuItem.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Menu line not found' }, 404)

  try {
    await db.transaction(async (tx: any) => {
      await tx.delete(eventMenuItem).where(eq(eventMenuItem.id, lineId))
      await syncEventInvoice(tx, currentUser.companyId, eventId)
    })
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }
  await audit.log({ action: 'delete', entity: 'event_menu_item', entityId: lineId, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json({ success: true })
})

// POST /events/:id/timeline
app.post('/:id/timeline', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const ev = await ownEvent(currentUser.companyId, eventId)
  if (!ev) return c.json({ error: 'Event not found' }, 404)
  // The same rules as the edit: a real HH:MM time, a title, a department from the list. (T16 M3)
  const vErr = validateTimelineInput(body)
  if (vErr) return c.json({ error: vErr }, 400)

  const [created] = await db.insert(eventTimeline).values({
    id: createId(),
    eventId,
    time: body.time.trim(),
    title: body.title.trim(),
    department: body.department || 'floor',
    details: body.details || null,
    sortOrder: body.sortOrder ?? 0,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'event_timeline', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(created, 201)
})

// PUT /events/:id/timeline/:lineId
app.put('/:id/timeline/:lineId', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const lineId = c.req.param('lineId')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(eventTimeline)
    .where(and(eq(eventTimeline.id, lineId), eq(eventTimeline.eventId, eventId), eq(eventTimeline.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Timeline line not found' }, 404)
  const vErr = validateTimelineInput(body, existing)
  if (vErr) return c.json({ error: vErr }, 400)

  const EDITABLE = ['time', 'title', 'department', 'details', 'sortOrder'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(eventTimeline).set(updates).where(eq(eventTimeline.id, lineId)).returning()
  await audit.log({ action: 'update', entity: 'event_timeline', entityId: lineId, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(updated)
})

// DELETE /events/:id/timeline/:lineId
app.delete('/:id/timeline/:lineId', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const lineId = c.req.param('lineId')

  const [existing] = await db.select().from(eventTimeline)
    .where(and(eq(eventTimeline.id, lineId), eq(eventTimeline.eventId, eventId), eq(eventTimeline.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Timeline line not found' }, 404)

  await db.delete(eventTimeline).where(eq(eventTimeline.id, lineId))
  await audit.log({ action: 'delete', entity: 'event_timeline', entityId: lineId, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json({ success: true })
})

// The schedule can't promise more than the invoice bills. Checked after the invoice is in step with the
// menu/quote, inside the same transaction.
function scheduleExceedsInvoice(inv: any, schedule: any[], ignoreId: string | null | undefined, amount: number): string | null {
  const total = round2(Number(inv.total))
  if (total <= 0.005) return 'Add menu lines or a quoted total before scheduling payments — there is nothing to bill yet.'
  const scheduled = round2(schedule.filter((p: any) => p.id !== ignoreId).reduce((s: number, p: any) => s + Number(p.amount || 0), 0) + amount)
  if (scheduled > total + 0.005) return `Scheduled payments would total $${scheduled.toFixed(2)} — more than the event's invoice total of $${total.toFixed(2)}.`
  return null
}

// POST /events/:id/payments — schedule an installment. Raises the event's invoice on the first one.
// Recording that it was PAID happens on the invoice (POST /api/invoices/:id/payments).
app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const ev = await ownEvent(currentUser.companyId, eventId)
  if (!ev) return c.json({ error: 'Event not found' }, 404)
  if (body.amount === undefined || body.amount === null || body.amount === '') {
    return c.json({ error: 'amount is required' }, 400)
  }
  // Money must be a positive number (H-01); the schedule total is checked against the invoice below.
  const amt = Number(body.amount)
  if (!Number.isFinite(amt) || amt <= 0) {
    return c.json({ error: 'Amount must be a positive number' }, 400)
  }
  if (body.dueDate && !DATE_RE.test(body.dueDate)) return c.json({ error: 'dueDate must be YYYY-MM-DD' }, 400)

  let created
  try {
    created = await db.transaction(async (tx: any) => {
      await ensureEventInvoice(tx, currentUser.companyId, eventId)
      const synced = await syncEventInvoice(tx, currentUser.companyId, eventId)
      const tooMuch = scheduleExceedsInvoice(synced!.inv, synced!.schedule, null, amt)
      if (tooMuch) throw new LedgerError(tooMuch)
      const [row] = await tx.insert(eventPayment).values({
        id: createId(),
        eventId,
        label: (typeof body.label === 'string' && body.label.trim()) || 'Payment',
        amount: round2(amt).toString(),
        dueDate: body.dueDate || null,
        notes: body.notes || null,
        companyId: currentUser.companyId,
      }).returning()
      await syncEventInvoice(tx, currentUser.companyId, eventId, { linesToo: false })
      return row
    })
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }

  await audit.log({ action: 'create', entity: 'event_payment', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(created, 201)
})

// PUT /events/:id/payments/:paymentId — change an installment's label, amount or due date.
app.put('/:id/payments/:paymentId', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const paymentId = c.req.param('paymentId')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(eventPayment)
    .where(and(eq(eventPayment.id, paymentId), eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Payment not found' }, 404)

  // The schedule only: whether it is paid comes from the invoice, so paidAt/method/reference are not editable.
  const EDITABLE = ['label', 'amount', 'dueDate', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  // Same guard as POST — editing a scheduled payment could set a zero/negative amount.
  if ('amount' in updates) {
    const amt = Number(updates.amount)
    if (updates.amount === null || updates.amount === '' || !Number.isFinite(amt) || amt <= 0) {
      return c.json({ error: 'Amount must be a positive number' }, 400)
    }
    updates.amount = round2(amt).toString()
  }
  if (updates.dueDate && !DATE_RE.test(updates.dueDate)) return c.json({ error: 'dueDate must be YYYY-MM-DD' }, 400)
  if ('label' in updates && !(typeof updates.label === 'string' && updates.label.trim())) return c.json({ error: 'label is required' }, 400)
  // Money already recorded against this installment can't be edited away — the amount stays at or above
  // what the invoice has covered of it. (T16 L7)
  if ('amount' in updates) {
    const covered = (await loadEventLedger(currentUser.companyId, eventId))?.payments.find((p: any) => p.id === paymentId)
    if (covered && Number(updates.amount) < covered.paidAmount - 0.005) return c.json({ error: `"${existing.label}" already has $${covered.paidAmount.toFixed(2)} recorded against it — the amount can't go below that. Refund on the invoice first.` }, 409)
  }

  let updated
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
  } catch (e: any) {
    const refused = ledgerError(c, e)
    if (refused) return refused
    throw e
  }
  await audit.log({ action: 'update', entity: 'event_payment', entityId: paymentId, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json(updated)
})

// DELETE /events/:id/payments/:paymentId — drop an installment from the schedule. Money already collected
// stays on the invoice; only the due date moves.
app.delete('/:id/payments/:paymentId', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const eventId = c.req.param('id')
  const paymentId = c.req.param('paymentId')

  const [existing] = await db.select().from(eventPayment)
    .where(and(eq(eventPayment.id, paymentId), eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Payment not found' }, 404)
  // An installment the invoice has already covered (in part or in full) stays on the schedule until that
  // money is refunded — deleting it used to answer 200 and silently re-spread the payment. (T16 L7)
  const covered = (await loadEventLedger(currentUser.companyId, eventId))?.payments.find((p: any) => p.id === paymentId)
  if (covered && covered.paidAmount > 0.005) return c.json({ error: `"${existing.label}" already has $${covered.paidAmount.toFixed(2)} recorded against it — refund it on the invoice before removing it from the schedule.` }, 409)

  await db.transaction(async (tx: any) => {
    await tx.delete(eventPayment).where(eq(eventPayment.id, paymentId))
    await syncEventInvoice(tx, currentUser.companyId, eventId, { linesToo: false })
  })
  await audit.log({ action: 'delete', entity: 'event_payment', entityId: paymentId, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event' })
  return c.json({ success: true })
})

// GET /events/:id/beo — the banquet event order, printable. This is the sheet
// that goes on the pass and behind the bar; it is HTML so it prints from any
// device without a PDF toolchain.
app.get('/:id/beo', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')

  if (!id) return c.json({ error: 'Event not found' }, 404)

  const [ev] = await db.select().from(event)
    .where(and(eq(event.id, id), eq(event.companyId, u.companyId)))
    .limit(1)
  if (!ev) return c.json({ error: 'Event not found' }, 404)

  const [client] = ev.contactId ? await db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null as any]
  const [space] = ev.spaceId ? await db.select().from(eventSpace).where(eq(eventSpace.id, ev.spaceId)).limit(1) : [null as any]
  const [venue] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
  const [coordinator] = ev.coordinatorId ? await db.select().from(user).where(eq(user.id, ev.coordinatorId)).limit(1) : [null as any]

  const timeline = await db.select().from(eventTimeline)
    .where(and(eq(eventTimeline.eventId, id), eq(eventTimeline.companyId, u.companyId)))
    .orderBy(asc(eventTimeline.sortOrder), asc(eventTimeline.time))
  const ledger = await loadEventLedger(u.companyId, id)
  const menu: any[] = ledger?.menu || []
  const payments = ledger?.payments || []
  const { menuTotal, fbTotal, paid, outstanding } = ledger!.totals
  const STATE_LABEL: Record<string, string> = { paid: 'Paid', part_paid: 'Part paid', unpaid: 'Due', refunded: 'Refunded', void: 'Void' }

  const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
  const money = (n: any) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
  table.grid td,table.grid th{border-bottom:1px solid #eee;padding:6px 4px;text-align:left;}
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
    ${row('Date', ev.eventDate)}
    ${row('Time', [ev.startTime, ev.endTime].filter(Boolean).join(' – '))}
    ${row('Space', space?.name || '')}
    ${row('Type', String(ev.eventType || '').replace(/_/g, ' '))}
    ${row('Guests', heads ? String(heads) + (ev.guestCountFinal ? ' (guaranteed)' : ' (estimated)') : '')}
    ${row('Coordinator', [coordinator?.firstName, coordinator?.lastName].filter(Boolean).join(' '))}
    ${row('Status', String(ev.status || ''))}
  </table>

  <h2>Client</h2>
  <table>
    ${row('Name', client?.name || '')}
    ${row('Phone', client?.mobile || client?.phone || '')}
    ${row('Email', client?.email || '')}
  </table>

  ${ev.dietaryRequirements ? `<div class="alert"><strong>Dietary requirements:</strong> ${esc(ev.dietaryRequirements)}</div>` : ''}

  <h2>Food &amp; Beverage</h2>
  ${menu.length ? `<table class="grid">
    <tr><th>Item</th><th>Basis</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr>
    ${menu.map(l => `<tr><td>${esc(l.name)}${l.notes ? `<br><span class="dept">${esc(l.notes)}</span>` : ''}</td><td>${l.perPerson ? 'per person' : 'flat'}</td><td class="num">${l.quantity}</td><td class="num">${money(l.unitPrice)}</td><td class="num">${money(lineTotal(l as any))}</td></tr>`).join('')}
    <tr><td colspan="4" class="num"><strong>Food &amp; beverage total</strong></td><td class="num"><strong>${money(fbTotal)}</strong></td></tr>${menuTotal > fbTotal + 0.005 ? `
    <tr><td colspan="4" class="num">Room hire</td><td class="num">${money(menuTotal - fbTotal)}</td></tr>
    <tr><td colspan="4" class="num"><strong>Menu total</strong></td><td class="num"><strong>${money(menuTotal)}</strong></td></tr>` : ''}
  </table>` : '<p style="color:#888;font-size:13px;">No menu lines recorded.</p>'}

  <h2>Run of Show</h2>
  ${timeline.length ? `<table class="grid">
    <tr><th style="width:80px">Time</th><th>What</th><th style="width:90px">Dept</th></tr>
    ${timeline.map(t => `<tr><td>${esc(t.time)}</td><td><strong>${esc(t.title)}</strong>${t.details ? `<br>${esc(t.details)}` : ''}</td><td class="dept">${esc(t.department)}</td></tr>`).join('')}
  </table>` : '<p style="color:#888;font-size:13px;">No run of show recorded.</p>'}

  ${ev.setupNotes ? `<h2>Setup</h2><p style="font-size:14px;white-space:pre-wrap;">${esc(ev.setupNotes)}</p>` : ''}

  <h2>Payments</h2>
  ${payments.length ? `<table class="grid">
    <tr><th>Stage</th><th>Due</th><th>Status</th><th class="num">Amount</th></tr>
    ${payments.map(p => `<tr><td>${esc(p.label)}</td><td>${esc(p.dueDate || '—')}</td><td>${esc(STATE_LABEL[p.state] || p.state)}${p.state === 'part_paid' ? ` (${money(p.paidAmount)})` : ''}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}
    <tr><td colspan="3" class="num"><strong>Paid to date</strong></td><td class="num"><strong>${money(paid)}</strong></td></tr>
    <tr><td colspan="3" class="num"><strong>Outstanding</strong></td><td class="num"><strong>${money(outstanding)}</strong></td></tr>
  </table>` : '<p style="color:#888;font-size:13px;">No payment schedule recorded.</p>'}

  ${ev.notes ? `<h2>Notes</h2><p style="font-size:14px;white-space:pre-wrap;">${esc(ev.notes)}</p>` : ''}

  <p class="note">Generated from ${esc(venue?.name || 'the venue')}'s event records. Confirm final guest numbers before service.</p>
</body></html>`

  return c.html(html)
})

export default app
