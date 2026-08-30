import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceMenu } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * The service menu — what the salon sells, how long it takes, what it costs,
 * and (the retention lever) how many days until the client is due back.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /service-menu — ?category=, ?includeInactive=1
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const includeInactive = c.req.query('includeInactive') === '1'

  const conditions = [eq(serviceMenu.companyId, currentUser.companyId)]
  if (category) conditions.push(eq(serviceMenu.category, category))
  if (!includeInactive) conditions.push(eq(serviceMenu.active, true))

  const data = await db.select().from(serviceMenu)
    .where(and(...conditions))
    .orderBy(asc(serviceMenu.category), asc(serviceMenu.name))

  return c.json({ data })
})

// POST /service-menu
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }
  // The payment fields are validated; the service catalog wasn't — a negative price or a
  // 0-minute duration was accepted (and a −$50 service dragged a client's LTV negative). (CC-18)
  if (body.price != null && (isNaN(Number(body.price)) || Number(body.price) < 0)) {
    return c.json({ error: 'Price cannot be negative.' }, 400)
  }
  if (body.durationMin != null && (isNaN(Number(body.durationMin)) || Number(body.durationMin) < 1)) {
    return c.json({ error: 'Duration must be at least 1 minute.' }, 400)
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
    active: body.active ?? true,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'service_menu', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_menu' })
  return c.json(created, 201)
})

// PUT /service-menu/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(serviceMenu)
    .where(and(eq(serviceMenu.id, id), eq(serviceMenu.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service not found' }, 404)

  if (body.price != null && (isNaN(Number(body.price)) || Number(body.price) < 0)) {
    return c.json({ error: 'Price cannot be negative.' }, 400)
  }
  if (body.durationMin != null && (isNaN(Number(body.durationMin)) || Number(body.durationMin) < 1)) {
    return c.json({ error: 'Duration must be at least 1 minute.' }, 400)
  }

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'category', 'description', 'durationMin', 'price', 'priceIsFrom', 'rebookIntervalDays', 'requiresPatchTest', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(serviceMenu).set(updates).where(eq(serviceMenu.id, id)).returning()
  await audit.log({ action: 'update', entity: 'service_menu', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_menu' })
  return c.json(updated)
})

// DELETE /service-menu/:id — soft delete. Service records reference the service
// by id for rebook timing, so a hard delete would orphan the retention math.
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(serviceMenu)
    .where(and(eq(serviceMenu.id, id), eq(serviceMenu.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Service not found' }, 404)

  const [updated] = await db.update(serviceMenu)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(serviceMenu.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'service_menu', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'service_menu' })
  return c.json({ success: true, service: updated })
})

export default app
