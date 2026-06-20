import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { prescription } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /prescriptions — ?patientId=
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const patientId = c.req.query('patientId')

  const conditions = [eq(prescription.companyId, currentUser.companyId)]
  if (patientId) conditions.push(eq(prescription.patientId, patientId))

  const data = await db.select().from(prescription)
    .where(and(...conditions))
    .orderBy(desc(prescription.prescribedDate))

  return c.json({ data })
})

// POST /prescriptions
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(prescription).values({
    id: createId(),
    patientId: body.patientId,
    visitId: body.visitId || null,
    prescriberId: body.prescriberId || null,
    drug: body.drug,
    strength: body.strength || null,
    form: body.form || null,
    sig: body.sig || null,
    quantity: body.quantity || null,
    refills: body.refills ?? 0,
    isControlled: body.isControlled ?? false,
    prescribedDate: body.prescribedDate ? new Date(body.prescribedDate) : new Date(),
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'prescription', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
  return c.json(created, 201)
})

// PUT /prescriptions/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(prescription)
    .where(and(eq(prescription.id, id), eq(prescription.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Prescription not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['patientId', 'visitId', 'prescriberId', 'drug', 'strength', 'form', 'sig', 'quantity', 'refills', 'isControlled', 'prescribedDate', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('prescribedDate' in updates && updates.prescribedDate) updates.prescribedDate = new Date(updates.prescribedDate)

  const [updated] = await db.update(prescription).set(updates).where(eq(prescription.id, id)).returning()
  await audit.log({ action: 'update', entity: 'prescription', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
  return c.json(updated)
})

// DELETE /prescriptions/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(prescription)
    .where(and(eq(prescription.id, id), eq(prescription.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Prescription not found' }, 404)

  await db.delete(prescription).where(eq(prescription.id, id))
  await audit.log({ action: 'delete', entity: 'prescription', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
  return c.json({ success: true })
})

export default app
