import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { menuPackage } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

/**
 * Catering packages — priced per head, which is how every banquet quote is
 * built. `courses` is the structured menu ([{course, options:[...]}]) so the
 * BEO and the client-facing quote can both render it without re-typing.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /menu-packages — ?category=, ?includeInactive=1
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const includeInactive = c.req.query('includeInactive') === '1'

  const conditions = [eq(menuPackage.companyId, currentUser.companyId)]
  if (category) conditions.push(eq(menuPackage.category, category))
  if (!includeInactive) conditions.push(eq(menuPackage.active, true))

  const data = await db.select().from(menuPackage)
    .where(and(...conditions))
    .orderBy(asc(menuPackage.category), asc(menuPackage.name))

  return c.json({ data })
})

// POST /menu-packages
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400)
  }

  const [created] = await db.insert(menuPackage).values({
    id: createId(),
    name: body.name.trim(),
    description: body.description || null,
    category: body.category || 'dinner',
    pricePerPerson: body.pricePerPerson ?? null,
    minGuests: body.minGuests ?? null,
    courses: Array.isArray(body.courses) ? body.courses : [],
    dietaryNotes: body.dietaryNotes || null,
    active: body.active ?? true,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'menu_package', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json(created, 201)
})

// PUT /menu-packages/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [existing] = await db.select().from(menuPackage)
    .where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Package not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['name', 'description', 'category', 'pricePerPerson', 'minGuests', 'courses', 'dietaryNotes', 'active'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(menuPackage).set(updates).where(eq(menuPackage.id, id)).returning()
  await audit.log({ action: 'update', entity: 'menu_package', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json(updated)
})

// DELETE /menu-packages/:id — retire, so booked events keep their package name.
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(menuPackage)
    .where(and(eq(menuPackage.id, id), eq(menuPackage.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Package not found' }, 404)

  const [updated] = await db.update(menuPackage)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(menuPackage.id, id))
    .returning()

  await audit.log({ action: 'update', entity: 'menu_package', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'menu_package' })
  return c.json({ success: true, package: updated })
})

export default app
