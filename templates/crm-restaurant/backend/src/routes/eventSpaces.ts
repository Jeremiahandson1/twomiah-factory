import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { eventSpace } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * Event spaces — the rooms you can sell, with the two numbers every enquiry
 * starts with: how many it holds, and what it has to spend.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /event-spaces — ?includeInactive=1
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const includeInactive = c.req.query('includeInactive') === '1'

  const conditions = [eq(eventSpace.companyId, currentUser.companyId)]
  if (!includeInactive) conditions.push(eq(eventSpace.active, true))

  const data = await db.select().from(eventSpace)
    .where(and(...conditions))
    .orderBy(asc(eventSpace.name))

  return c.json({ data })
})

// POST /event-spaces
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const [created] = await db.insert(eventSpace).values({
    id: createId(),
    name: body.name.trim(),
    description: body.description || null,
    seatedCapacity: body.seatedCapacity ?? null,
    standingCapacity: body.standingCapacity ?? null,
    minimumSpend: body.minimumSpend ?? null,
    hireFee: body.hireFee ?? null,
    amenities: Array.isArray(body.amenities) ? body.amenities : [],
    photo: body.photo || null,
    active: body.active ?? true,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'event_space', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event_space' })
  return c.json(created, 201)
})

// PUT /event-spaces/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(eventSpace)
    .where(and(eq(eventSpace.id, id), eq(eventSpace.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Space not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'description', 'seatedCapacity', 'standingCapacity', 'minimumSpend', 'hireFee', 'amenities', 'photo', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(eventSpace).set(updates).where(eq(eventSpace.id, id)).returning()
  await audit.log({ action: 'update', entity: 'event_space', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event_space' })
  return c.json(updated)
})

// DELETE /event-spaces/:id — soft delete. Past events reference the space, so a
// hard delete would blank the room out of the history.
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(eventSpace)
    .where(and(eq(eventSpace.id, id), eq(eventSpace.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Space not found' }, 404)

  const [updated] = await db.update(eventSpace)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(eventSpace.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'event_space', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'event_space' })
  return c.json({ success: true, space: updated })
})

export default app
