import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { vaccination } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /vaccinations — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(vaccination.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(vaccination.patientId, patientId))

  const data = await db.select().from(vaccination)
    .where(and(...conditions))
    .orderBy(desc(vaccination.givenDate))

  return c.json({ data })
})

// POST /vaccinations
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(vaccination).values({
    id: createId(),
    patientId: body.patientId,
    visitId: body.visitId || null,
    providerId: body.providerId || null,
    vaccine: body.vaccine,
    manufacturer: body.manufacturer || null,
    lotNumber: body.lotNumber || null,
    serialNumber: body.serialNumber || null,
    site: body.site || null,
    route: body.route || null,
    givenDate: body.givenDate,
    dueDate: body.dueDate || null,
    isRabies: body.isRabies ?? false,
    rabiesTag: body.rabiesTag || null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'vaccination', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json(created, 201)
})

// PUT /vaccinations/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(vaccination)
    .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Vaccination not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'visitId', 'providerId', 'vaccine', 'manufacturer', 'lotNumber', 'serialNumber', 'site', 'route', 'givenDate', 'dueDate', 'isRabies', 'rabiesTag', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(vaccination).set(updates).where(eq(vaccination.id, id)).returning()
  await audit.log({ action: 'update', entity: 'vaccination', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json(updated)
})

// DELETE /vaccinations/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(vaccination)
    .where(and(eq(vaccination.id, id), eq(vaccination.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Vaccination not found' }, 404)

  await db.delete(vaccination).where(eq(vaccination.id, id))
  await audit.log({ action: 'delete', entity: 'vaccination', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vaccination' })
  return c.json({ success: true })
})

export default app
