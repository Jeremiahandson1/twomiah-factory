// The service menu — what the salon sells, how long it takes, what it costs, and (the retention lever) how many days
// until the client is due back. Moved from templates/crm-salon/backend/src/routes/serviceMenu.ts.
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { serviceMenu } from '../../db/schema/index.ts'
import { serviceNamedOnMenu } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const CATEGORIES = ['hair', 'colour', 'color', 'nails', 'skin', 'massage', 'waxing', 'barber', 'lashes', 'brows', 'makeup', 'other']
const EDITABLE = ['name', 'category', 'description', 'durationMin', 'price', 'priceIsFrom', 'rebookIntervalDays', 'requiresPatchTest', 'bookableOnline', 'active'] as const

export function createServiceMenuRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const refresh = (companyId: string) => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'service_menu' })
  const app = new Hono<AppEnv>()

  // GET /service-menu — ?category=, ?includeInactive=1
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const category = c.req.query('category')
    const includeInactive = c.req.query('includeInactive') === '1'
    const conditions = [eq(serviceMenu.companyId, currentUser.companyId)]
    if (category) conditions.push(eq(serviceMenu.category, category))
    if (!includeInactive) conditions.push(eq(serviceMenu.active, true))
    const data = await db.select().from(serviceMenu).where(and(...conditions)).orderBy(asc(serviceMenu.category), asc(serviceMenu.name))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
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

    const [created] = await db.insert(serviceMenu).values({
      id: createId(),
      name: body.name.trim(),
      category: body.category || 'hair',
      description: body.description || null,
      durationMin: body.durationMin ?? 60,
      price: body.price ?? null,
      priceIsFrom: body.priceIsFrom ?? false,
      rebookIntervalDays: body.rebookIntervalDays ?? null,
      requiresPatchTest: body.requiresPatchTest ?? false,
      bookableOnline: body.bookableOnline ?? false,
      active: body.active ?? true,
      companyId: currentUser.companyId,
    }).returning()

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

    const [updated] = await db.update(serviceMenu).set(updates).where(eq(serviceMenu.id, id)).returning()
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

    const [updated] = await db.update(serviceMenu).set({ active: false, updatedAt: new Date() }).where(eq(serviceMenu.id, id)).returning()
    await audit.log({ action: 'update', entity: 'service_menu', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    refresh(currentUser.companyId)
    return one(c, { success: true, service: updated })
  })

  return app
}
