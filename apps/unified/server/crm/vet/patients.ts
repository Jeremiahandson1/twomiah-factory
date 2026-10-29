// Patients: the animals on an owner's record, and each one's chart. Moved from
// templates/crm-vet/backend/src/routes/patients.ts. The registry signs the person in and applies the
// 'patient_records' gate (the template's sidebar gate; its index.ts mounted it ungated).
import { Hono } from 'hono'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { withoutPortalCredential, checkFilter } from '@twomiah/tenant-backend'
import { PATIENT_TILES, activePatientCondition } from './tileConditions.ts'
import { patient, contact, visit, vaccination, prescription, labResult, appointment, user } from '../../db/schema/index.ts'
import { SPECIES } from './species.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

/**
 * Sanity on create/update: a blank name, a future birth date or a negative weight all saved and broke the chart
 * later. Returns the complaint, or null when the (partial) body is acceptable.
 */
function validatePatient(body: any, partial = false): string | null {
  if (!partial || 'name' in body) {
    if (!body.name || !String(body.name).trim()) return 'A patient name is required'
  }
  if (body.species != null && body.species !== '' && !(SPECIES as readonly string[]).includes(body.species)) {
    return `Invalid species. Expected one of: ${SPECIES.join(', ')}`
  }
  if (body.weightLb != null && body.weightLb !== '') {
    const w = Number(body.weightLb)
    if (isNaN(w) || w < 0 || w > 5000) return 'Weight must be a number between 0 and 5000 lb'
  }
  if (body.dob) {
    const d = new Date(body.dob)
    if (isNaN(d.getTime())) return 'Invalid date of birth'
    if (d.getTime() > Date.now()) return 'Date of birth cannot be in the future'
  }
  return null
}

/**
 * The visit history on a chart is bounded, because a chart is one request and a fifteen-year-old patient can carry
 * a long history — but the count comes back beside it so the tab says when it is not showing everything. A bare
 * limit of 20 used to drop the oldest visits and label the tab "Visits 20". (Vet T58)
 */
const VISIT_CAP = 200

export function createPatientRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()

  // GET /patients — with owner info, ?ownerId= and ?search= (patient name + owner name)
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const ownerId = c.req.query('ownerId')
    const search = c.req.query('search')
    // ?tile=active is the home screen's "Active patients": the living ones (./tileConditions.ts — the dashboard counts the same).
    const badTile = checkFilter(c, 'tile', c.req.query('tile'), PATIENT_TILES)
    if (badTile) return badTile
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '50')

    const conditions = [eq(patient.companyId, currentUser.companyId)]
    if (ownerId) conditions.push(eq(patient.ownerId, ownerId))
    if (c.req.query('tile') === 'active') conditions.push(activePatientCondition(patient))
    if (search) conditions.push(or(ilike(patient.name, `%${search}%`), ilike(contact.name, `%${search}%`))!)
    const where = and(...conditions)

    const data = await db.select({ patient, ownerName: contact.name, ownerPhone: contact.phone, ownerEmail: contact.email })
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

    // The patient and owner fields at one level, so a list reads row.name / row.ownerName directly.
    const rows = data.map((r: any) => ({ ...r.patient, ownerName: r.ownerName, ownerPhone: r.ownerPhone, ownerEmail: r.ownerEmail }))
    return list(c, rows, { page, limit, total: Number(total) })
  })

  // GET /patients/:id — the full chart
  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [pat] = await db.select().from(patient)
      .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
      .limit(1)
    if (!pat) return fail(c, 404, 'Patient not found')

    const [owner] = pat.ownerId ? await db.select().from(contact).where(eq(contact.id, pat.ownerId)).limit(1) : [null]

    const visits = await db.select().from(visit)
      .where(and(eq(visit.patientId, id), eq(visit.companyId, currentUser.companyId)))
      .orderBy(desc(visit.visitDate))
      .limit(VISIT_CAP)
    const [{ value: visitsTotal }] = await db.select({ value: count() }).from(visit)
      .where(and(eq(visit.patientId, id), eq(visit.companyId, currentUser.companyId)))

    const vaccinations = await db.select().from(vaccination)
      .where(and(eq(vaccination.patientId, id), eq(vaccination.companyId, currentUser.companyId)))
      .orderBy(desc(vaccination.givenDate))

    // Who wrote each script travels with it — the chart is where that question gets asked. (Vet T12 M7)
    const rxRows = await db.select({ rx: prescription, prescriber: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } })
      .from(prescription)
      .leftJoin(user, eq(user.id, prescription.prescriberId))
      .where(and(eq(prescription.patientId, id), eq(prescription.companyId, currentUser.companyId)))
      .orderBy(desc(prescription.prescribedDate))
    const prescriptions = rxRows.map((r: any) => ({
      ...r.rx,
      prescriber: r.prescriber?.id ? { ...r.prescriber, name: [r.prescriber.firstName, r.prescriber.lastName].filter(Boolean).join(' ') || r.prescriber.email } : null,
    }))

    const labResults = await db.select().from(labResult)
      .where(and(eq(labResult.patientId, id), eq(labResult.companyId, currentUser.companyId)))
      .orderBy(desc(labResult.resultDate))

    // A switched-off Prescriptions or Lab Results is not on the chart either (the tabs follow the same switches).
    const [rxOn, labsOn] = await Promise.all([d.features.isFeatureEnabled(currentUser.companyId, 'prescriptions'), d.features.isFeatureEnabled(currentUser.companyId, 'lab_results')])
    return one(c, {
      patient: pat,
      owner: owner ? withoutPortalCredential(owner) : null,
      visits,
      // How many there really are, so the chart labels the tab with the truth and says when the list is capped.
      visitsTotal: Number(visitsTotal) || 0,
      visitsCap: VISIT_CAP,
      vaccinations,
      prescriptions: rxOn ? prescriptions : [],
      labResults: labsOn ? labResults : [],
    })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const invalid = validatePatient(body)
    if (invalid) return fail(c, 400, invalid)

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
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(patient)
      .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Patient not found')

    const invalid = validatePatient(body, true)
    if (invalid) return fail(c, 400, invalid)

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['ownerId', 'name', 'species', 'breed', 'sex', 'spayedNeutered', 'dob', 'weightLb', 'color', 'microchip', 'bloodType', 'insuranceProvider', 'insurancePolicy', 'allergies', 'alerts', 'rabiesTag', 'photo', 'deceased', 'deceasedDate', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]

    const [updated] = await db.update(patient).set(updates).where(eq(patient.id, id)).returning()
    await audit.log({ action: 'update', entity: 'patient', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'patient' })
    return one(c, updated)
  })

  /**
   * Deleting a patient would cascade-wipe its medical record (visits, vaccinations, prescriptions, lab results), so a
   * patient with any clinical history cannot be deleted at all, whoever asks: it is retired by marking it deceased.
   * Only an empty record (a pet created by mistake) is removed, and that asks the DELETE right, which the
   * receptionist's contacts:update grant does not include. (T41)
   */
  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db.select().from(patient)
      .where(and(eq(patient.id, id), eq(patient.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Patient not found')

    const [{ value: visitCount }] = await db.select({ value: count() }).from(visit).where(eq(visit.patientId, id))
    const [{ value: vaxCount }] = await db.select({ value: count() }).from(vaccination).where(eq(vaccination.patientId, id))
    const [{ value: rxCount }] = await db.select({ value: count() }).from(prescription).where(eq(prescription.patientId, id))
    const [{ value: labCount }] = await db.select({ value: count() }).from(labResult).where(eq(labResult.patientId, id))
    if (Number(visitCount) + Number(vaxCount) + Number(rxCount) + Number(labCount) > 0) {
      return fail(c, 409, 'This patient has medical history and cannot be deleted. Mark it deceased to retire the record while keeping its history.')
    }

    // No clinical history: safe to remove. Its appointments go first so none are left with a null patient.
    await db.delete(appointment).where(eq(appointment.patientId, id))
    await db.delete(patient).where(eq(patient.id, id))
    await audit.log({ action: 'delete', entity: 'patient', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'patient' })
    return done(c)
  })

  return app
}
