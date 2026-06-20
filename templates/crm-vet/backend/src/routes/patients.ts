import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { patient, contact, visit, vaccination, prescription, labResult } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

// GET /patients — list with owner info, ?ownerId= and ?search= (patient name + owner name)
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const ownerId = c.req.query('ownerId')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(patient.companyId, currentUser.companyId)]
  if (ownerId) conditions.push(eq(patient.ownerId, ownerId))
  if (search) {
    conditions.push(or(ilike(patient.name, `%${search}%`), ilike(contact.name, `%${search}%`))!)
  }

  const where = and(...conditions)

  const data = await db.select({
    patient,
    ownerName: contact.name,
    ownerPhone: contact.phone,
    ownerEmail: contact.email,
  })
    .from(patient)
    .leftJoin(contact, eq(patient.ownerId, contact.id))
    .where(where)
    .orderBy(desc(patient.createdAt))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() })
    .from(patient)
    .leftJoin(contact, eq(patient.ownerId, contact.id))
    .where(where)

  // Flatten the joined patient + owner fields to one row level so list
  // consumers can read `row.name` / `row.id` / `row.ownerName` directly.
  const rows = data.map((r: any) => ({ ...r.patient, ownerName: r.ownerName, ownerPhone: r.ownerPhone, ownerEmail: r.ownerEmail }))
  return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /patients/:id — full chart
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [pat] = await db.select().from(patient)
    .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
    .limit(1)
  if (!pat) return c.json({ error: 'Patient not found' }, 404)

  const [owner] = pat.ownerId
    ? await db.select().from(contact).where(eq(contact.id, pat.ownerId)).limit(1)
    : [null]

  const visits = await db.select().from(visit)
    .where(and(eq(visit.patientId, id), eq(visit.companyId, currentUser.companyId)))
    .orderBy(desc(visit.visitDate))
    .limit(20)

  const vaccinations = await db.select().from(vaccination)
    .where(and(eq(vaccination.patientId, id), eq(vaccination.companyId, currentUser.companyId)))
    .orderBy(desc(vaccination.givenDate))

  const prescriptions = await db.select().from(prescription)
    .where(and(eq(prescription.patientId, id), eq(prescription.companyId, currentUser.companyId)))
    .orderBy(desc(prescription.prescribedDate))

  const labResults = await db.select().from(labResult)
    .where(and(eq(labResult.patientId, id), eq(labResult.companyId, currentUser.companyId)))
    .orderBy(desc(labResult.resultDate))

  return c.json({ patient: pat, owner: owner || null, visits, vaccinations, prescriptions, labResults })
})

// POST /patients
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const [created] = await db.insert(patient).values({
    id: createId(),
    ownerId: body.ownerId,
    name: body.name,
    species: body.species || 'dog',
    breed: body.breed || null,
    sex: body.sex || null,
    spayedNeutered: body.spayedNeutered ?? false,
    dob: body.dob || null,
    weightLb: body.weightLb ?? null,
    color: body.color || null,
    microchip: body.microchip || null,
    bloodType: body.bloodType || null,
    insuranceProvider: body.insuranceProvider || null,
    insurancePolicy: body.insurancePolicy || null,
    allergies: body.allergies || null,
    alerts: body.alerts || null,
    rabiesTag: body.rabiesTag || null,
    photo: body.photo || null,
    deceased: body.deceased ?? false,
    deceasedDate: body.deceasedDate || null,
    notes: body.notes || null,
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'patient', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'patient' })
  return c.json(created, 201)
})

// PUT /patients/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(patient)
    .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Patient not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['ownerId', 'name', 'species', 'breed', 'sex', 'spayedNeutered', 'dob', 'weightLb', 'color', 'microchip', 'bloodType', 'insuranceProvider', 'insurancePolicy', 'allergies', 'alerts', 'rabiesTag', 'photo', 'deceased', 'deceasedDate', 'notes'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]

  const [updated] = await db.update(patient).set(updates).where(eq(patient.id, id)).returning()
  await audit.log({ action: 'update', entity: 'patient', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'patient' })
  return c.json(updated)
})

// DELETE /patients/:id
app.delete('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(patient)
    .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Patient not found' }, 404)

  await db.delete(patient).where(eq(patient.id, id))
  await audit.log({ action: 'delete', entity: 'patient', entityId: id, metadata: existing, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'patient' })
  return c.json({ success: true })
})

export default app
