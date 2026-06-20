import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { visit, user } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /visits — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(visit.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(visit.patientId, patientId))

  const data = await db.select({
    visit,
    providerFirstName: user.firstName,
    providerLastName: user.lastName,
  })
    .from(visit)
    .leftJoin(user, eq(visit.providerId, user.id))
    .where(and(...conditions))
    .orderBy(desc(visit.visitDate))

  // Flatten the joined visit + provider fields to one row level so list
  // consumers can read `row.id` / `row.visitDate` / `row.providerFirstName` directly.
  const rows = data.map((r: any) => ({ ...r.visit, providerFirstName: r.providerFirstName, providerLastName: r.providerLastName }))
  return c.json({ data: rows })
})

// GET /visits/:id
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [row] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Visit not found' }, 404)

  return c.json(row)
})

// POST /visits
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(visit).values({
    id: createId(),
    patientId: body.patientId,
    appointmentId: body.appointmentId || null,
    providerId: body.providerId || null,
    visitDate: body.visitDate ? new Date(body.visitDate) : new Date(),
    reason: body.reason || null,
    weightLb: body.weightLb ?? null,
    temperatureF: body.temperatureF ?? null,
    heartRate: body.heartRate ?? null,
    respRate: body.respRate ?? null,
    subjective: body.subjective || null,
    objective: body.objective || null,
    assessment: body.assessment || null,
    plan: body.plan || null,
    diagnoses: body.diagnoses || [],
    treatments: body.treatments || null,
    notes: body.notes || null,
    total: body.total ?? null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'visit', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
  return c.json(created, 201)
})

// PUT /visits/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Visit not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'appointmentId', 'providerId', 'visitDate', 'reason', 'weightLb', 'temperatureF', 'heartRate', 'respRate', 'subjective', 'objective', 'assessment', 'plan', 'diagnoses', 'treatments', 'notes', 'total'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('visitDate' in updates && updates.visitDate) updates.visitDate = new Date(updates.visitDate)

  const [updated] = await db.update(visit).set(updates).where(eq(visit.id, id)).returning()
  await audit.log({ action: 'update', entity: 'visit', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
  return c.json(updated)
})

// DELETE /visits/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(visit)
    .where(and(eq(visit.id, id), eq(visit.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Visit not found' }, 404)

  await db.delete(visit).where(eq(visit.id, id))
  await audit.log({ action: 'delete', entity: 'visit', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'visit' })
  return c.json({ success: true })
})

export default app
