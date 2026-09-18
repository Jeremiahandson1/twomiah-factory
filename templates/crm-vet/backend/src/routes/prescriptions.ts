import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { prescription, patient, user } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { allergyConflict, allergyWarning } from '../config/drugClasses.ts'
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

  // Who wrote it travels with the record — a script whose prescriber is a bare id tells nobody anything.
  const rows = await db.select({ rx: prescription, prescriber: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } })
    .from(prescription)
    .leftJoin(user, eq(user.id, prescription.prescriberId))
    .where(and(...conditions))
    .orderBy(desc(prescription.prescribedDate))

  const data = rows.map((r: any) => ({
    ...r.rx,
    prescriber: r.prescriber?.id ? { ...r.prescriber, name: [r.prescriber.firstName, r.prescriber.lastName].filter(Boolean).join(' ') || r.prescriber.email } : null,
  }))
  return c.json({ data })
})

// POST /prescriptions
// A refill count is how many times the script may be filled again: a whole number, never negative. "-6" saved
// without complaint, which is not a dispensing instruction anybody can act on. 12 is the usual legal ceiling for
// a non-controlled drug, and a controlled one gets none of this leeway anyway. (Vet T12 M8)
const MAX_REFILLS = 12
function refillsError(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) return 'Refills must be a whole number, and cannot be negative'
  if (n > MAX_REFILLS) return `Refills cannot exceed ${MAX_REFILLS}`
  return null
}

// The prescriber is a user of this clinic, never an id handed in from outside it.
async function resolvePrescriber(companyId: string, prescriberId: unknown, fallbackUserId: string) {
  const wanted = String(prescriberId || '').trim()
  if (!wanted) return { prescriberId: fallbackUserId }
  const [u] = await db.select().from(user).where(and(eq(user.id, wanted), eq(user.companyId, companyId))).limit(1)
  if (!u) return { error: 'That prescriber is not on your team.' }
  return { prescriberId: u.id }
}

// A documented allergy is checked before the script is written, not after the drug is dispensed. The vet can
// still go ahead — they know things the chart does not — but they have to say so, and the override goes into
// the audit trail. (Vet T12 M7)
async function checkAllergy(companyId: string, patientId: unknown, drug: unknown) {
  const id = String(patientId || '').trim()
  if (!id || !drug) return null
  const [p] = await db.select().from(patient).where(and(eq(patient.id, id), eq(patient.companyId, companyId))).limit(1)
  if (!p) return null
  const hit = allergyConflict(p.allergies, drug)
  return hit ? { hit, patientName: p.name } : null
}
const allergyRefusal = (found: { hit: any; patientName: string }, drug: unknown) => ({
  error: allergyWarning(found.patientName, String(drug), found.hit),
  allergy: { documented: found.hit.allergy, matched: found.hit.matched, drugClass: found.hit.drugClass },
  acknowledgeWith: 'acknowledgeAllergy',
})

app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const badRefills = refillsError(body.refills)
  if (badRefills) return c.json({ error: badRefills }, 400)

  const who = await resolvePrescriber(currentUser.companyId, body.prescriberId, currentUser.userId)
  if (who.error) return c.json({ error: who.error }, 400)

  const found = await checkAllergy(currentUser.companyId, body.patientId, body.drug)
  if (found && body.acknowledgeAllergy !== true) return c.json(allergyRefusal(found, body.drug), 409)

  const [created] = await db.insert(prescription).values({
    id: createId(),
    patientId: body.patientId,
    visitId: body.visitId || null,
    prescriberId: who.prescriberId,
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

  // A script written over a documented allergy is a clinical decision — it belongs in the record, not only
  // in the moment the clinician clicked past the warning.
  await audit.log({
    action: 'create', entity: 'prescription', entityId: created.id,
    metadata: found ? { ...created, allergyOverride: { documented: found.hit.allergy, matched: found.hit.matched, drugClass: found.hit.drugClass } } : created,
    req: { user: currentUser },
  })
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
  if ('refills' in updates) { const bad = refillsError(updates.refills); if (bad) return c.json({ error: bad }, 400) }
  if ('prescriberId' in updates) {
    const who = await resolvePrescriber(currentUser.companyId, updates.prescriberId, currentUser.userId)
    if (who.error) return c.json({ error: who.error }, 400)
    updates.prescriberId = who.prescriberId
  }
  // Changing the drug — or moving the script to another patient — is a new prescribing decision, so it is
  // checked again against whichever chart it lands on.
  let found: Awaited<ReturnType<typeof checkAllergy>> = null
  if ('drug' in updates || 'patientId' in updates) {
    found = await checkAllergy(currentUser.companyId, updates.patientId ?? existing.patientId, updates.drug ?? existing.drug)
    if (found && body.acknowledgeAllergy !== true) return c.json(allergyRefusal(found, updates.drug ?? existing.drug), 409)
  }

  const [updated] = await db.update(prescription).set(updates).where(eq(prescription.id, id)).returning()
  await audit.log({
    action: 'update', entity: 'prescription', entityId: id, changes: audit.diff(existing, updated),
    ...(found ? { metadata: { allergyOverride: { documented: found.hit.allergy, matched: found.hit.matched, drugClass: found.hit.drugClass } } } : {}),
    req: { user: currentUser },
  })
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
