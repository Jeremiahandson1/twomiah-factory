// The service menu — what the salon sells, how long it takes, what it costs, and (the retention lever) how many days
// until the client is due back. Moved from templates/crm-salon/backend/src/routes/serviceMenu.ts.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { serviceMenu } from '../../db/schema/index.ts'
import { serviceNamedOnMenu } from '../../data/salon.ts'
import { keepOnlineService } from './onlineBooking.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { processingProblem } from './segments.ts'
import { parseServiceFees } from './cardFees.ts'

const CATEGORIES = ['hair', 'colour', 'color', 'nails', 'skin', 'massage', 'waxing', 'barber', 'lashes', 'brows', 'makeup', 'other']
const EDITABLE = ['name', 'category', 'description', 'durationMin', 'price', 'priceIsFrom', 'rebookIntervalDays', 'requiresPatchTest', 'bookableOnline', 'active'] as const

export function createServiceMenuRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const refresh = (companyId: string) => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'service_menu' })
  const app = new Hono<AppEnv>()

  /**
   * The processing gap in a body (salon "processing time"; feature `processing_time`): the two numbers to store, or the sentence
   * that refuses them. Clearing it (both empty) is always allowed; setting one needs the feature on.
   */
  async function processingIn(companyId: string, body: any, durationMin: number): Promise<{ values: { processingAfterMin: number | null; processingMin: number | null } } | { problem: string; code: string }> {
    const empty = (v: unknown) => v === null || v === undefined || v === ''
    if (empty(body.processingMin) && empty(body.processingAfterMin)) return { values: { processingAfterMin: null, processingMin: null } }
    if (!(await d.features.isFeatureEnabled(companyId, 'processing_time'))) return { problem: 'Processing time is not switched on for this salon.', code: 'FEATURE_OFF' }
    const problem = processingProblem(body.processingAfterMin, body.processingMin, durationMin)
    if (problem) return { problem, code: 'BAD_PROCESSING' }
    return { values: { processingAfterMin: Number(body.processingAfterMin || 0), processingMin: Number(body.processingMin) } }
  }

  /**
   * This service's own no-show / late-cancel fee (salon parity row 4; feature `card_on_file`): the columns to write, or the refusal. Changing a fee
   * a client can be charged is the owner's call (company:update), not the menu editor's; clearing one is always allowed to them too.
   */
  async function feesIn(u: any, body: any): Promise<{ values: Record<string, number | null> } | { refuse: { status: 400 | 403 | 409; message: string; code: string; fields?: Record<string, string> } }> {
    const got = parseServiceFees(body)
    if ('fields' in got) return { refuse: { status: 400, message: 'Check the highlighted boxes.', code: 'VALIDATION', fields: got.fields } }
    if (!got.touched) return { values: {} }
    const extra = await d.permissions.getExtraPermissions(u.userId)
    if (!d.permissions.hasPermission(String(u.role || ''), 'company:update', extra)) return { refuse: { status: 403, message: 'Only the owner or an admin can set the fee a service charges for a no-show or late cancel.', code: 'FEE_NEEDS_OWNER' } }
    if (!(await d.features.isFeatureEnabled(u.companyId, 'card_on_file'))) return { refuse: { status: 409, message: 'Card on file is not switched on for this salon.', code: 'FEATURE_OFF' } }
    return { values: got.values }
  }

  // GET /service-menu — ?category=, ?includeInactive=1
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const category = c.req.query('category')
    const includeInactive = c.req.query('includeInactive') === '1'
    const conditions = [eq(serviceMenu.companyId, currentUser.companyId)]
    if (category) conditions.push(eq(serviceMenu.category, category))
    if (!includeInactive) conditions.push(eq(serviceMenu.active, true))
    const data = await db.select().from(serviceMenu).where(and(...conditions)).orderBy(asc(serviceMenu.category), asc(serviceMenu.name))
    return listAll(c, data)
  })

  app.post('/', requirePermission('pricebook:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.name !== 'string' || !body.name.trim()) return fail(c, 400, 'name is required')
    // A negative price or a 0-minute duration was accepted (CC-18).
    if (body.category != null && body.category !== '' && !CATEGORIES.includes(String(body.category).toLowerCase())) {
      return fail(c, 400, `Category must be one of: ${CATEGORIES.join(', ')}.`)
    }
    // "abc" is not a negative price, it is not a price at all. (T20 L2)
    if (body.price != null && isNaN(Number(body.price))) return fail(c, 400, 'Price must be a number.')
    if (body.price != null && (Number(body.price) < 0 || roundsToNothing(body.price))) return fail(c, 400, 'Price cannot be negative.')
    const feeValues = await feesIn(currentUser, body)
    if ('refuse' in feeValues) return fail(c, feeValues.refuse.status, feeValues.refuse.message, feeValues.refuse.code, feeValues.refuse.fields)
    let processingValues: { processingAfterMin?: number | null; processingMin?: number | null } = {}
    if ('processingMin' in body || 'processingAfterMin' in body) {
      const got = await processingIn(currentUser.companyId, body, Number(body.durationMin ?? 60))
      if ('problem' in got) return fail(c, got.code === 'FEATURE_OFF' ? 409 : 400, got.problem, got.code, { processingMin: got.problem })
      processingValues = got.values
    }
    if (body.durationMin != null && (isNaN(Number(body.durationMin)) || Number(body.durationMin) < 1 || Number(body.durationMin) > 720)) {
      return fail(c, 400, 'Duration must be between 1 and 720 minutes.')
    }
    if (body.rebookIntervalDays != null && body.rebookIntervalDays !== '' && (isNaN(Number(body.rebookIntervalDays)) || Number(body.rebookIntervalDays) < 0 || Number(body.rebookIntervalDays) > 365)) {
      return fail(c, 400, 'Rebook interval must be between 0 and 365 days.')
    }
    // Two "Men's Cut" entries make the book, reports and rebooking ambiguous. (SALON-M5) The template also sent the
    // existing service's id; nothing read it.
    if (!body.allowDuplicate && await serviceNamedOnMenu(db, currentUser.companyId, body.name.trim())) {
      return fail(c, 409, `"${body.name.trim()}" is already on the menu.`, 'DUPLICATE_SERVICE')
    }

    // The item and its online booking service in one write (onlineBooking.ts keepOnlineService): the menu is the one
    // list /book offers.
    const created = await db.transaction(async (tx: any) => {
      const [row] = await tx.insert(serviceMenu).values({
        id: createId(),
        name: body.name.trim(),
        category: body.category || 'hair',
        description: body.description || null,
        durationMin: body.durationMin ?? 60,
        price: body.price ?? null,
        priceIsFrom: body.priceIsFrom ?? false,
        rebookIntervalDays: body.rebookIntervalDays ?? null,
        requiresPatchTest: body.requiresPatchTest ?? false,
        ...processingValues,
        ...feeValues.values,
        bookableOnline: body.bookableOnline ?? false,
        active: body.active ?? true,
        companyId: currentUser.companyId,
      }).returning()
      await keepOnlineService(tx, row)
      return row
    })

    await audit.log({ action: 'create', entity: 'service_menu', entityId: created.id, metadata: created, req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('pricebook:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)

    const [existing] = await db.select().from(serviceMenu)
      .where(and(eq(serviceMenu.id, id), eq(serviceMenu.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Service not found')

    if (body.price != null && isNaN(Number(body.price))) return fail(c, 400, 'Price must be a number.')
    if (body.price != null && (Number(body.price) < 0 || roundsToNothing(body.price))) return fail(c, 400, 'Price cannot be negative.')
    if (body.durationMin != null && (isNaN(Number(body.durationMin)) || Number(body.durationMin) < 1)) return fail(c, 400, 'Duration must be at least 1 minute.')
    if (body.category != null && body.category !== '' && !CATEGORIES.includes(String(body.category).toLowerCase())) {
      return fail(c, 400, `Category must be one of: ${CATEGORIES.join(', ')}.`)
    }
    // Whitelisted — companyId and id are never set from the body.
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    const feeValues = await feesIn(currentUser, body)
    if ('refuse' in feeValues) return fail(c, feeValues.refuse.status, feeValues.refuse.message, feeValues.refuse.code, feeValues.refuse.fields)
    Object.assign(updates, feeValues.values)
    if ('processingMin' in body || 'processingAfterMin' in body || ('durationMin' in body && existing.processingMin)) {
      // A shorter service must still hold its processing gap; changing nothing about the gap re-checks the old one against the new length.
      const source = 'processingMin' in body || 'processingAfterMin' in body ? body : { processingMin: existing.processingMin, processingAfterMin: existing.processingAfterMin }
      const got = await processingIn(currentUser.companyId, source, Number(body.durationMin ?? existing.durationMin))
      if ('problem' in got) return fail(c, got.code === 'FEATURE_OFF' ? 409 : 400, got.problem, got.code, { processingMin: got.problem })
      Object.assign(updates, got.values)
    }

    // Unticked "Bookable online", or taken off the menu: off /book in the same write; a rename, a new length or price:
    // /book shows it at once. Bookings already made keep their time (keepOnlineService).
    const updated = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(serviceMenu).set(updates).where(eq(serviceMenu.id, id)).returning()
      await keepOnlineService(tx, row)
      return row
    })
    await audit.log({ action: 'update', entity: 'service_menu', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, updated)
  })

  // DELETE — a soft delete: service records reference the service for rebook timing.
  app.delete('/:id', requirePermission('pricebook:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(serviceMenu)
      .where(and(eq(serviceMenu.id, id), eq(serviceMenu.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Service not found')

    const updated = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(serviceMenu).set({ active: false, updatedAt: new Date() }).where(eq(serviceMenu.id, id)).returning()
      await keepOnlineService(tx, row)
      return row
    })
    await audit.log({ action: 'update', entity: 'service_menu', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, { success: true, service: updated })
  })

  return app
}
