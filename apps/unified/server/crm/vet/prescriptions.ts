// Prescriptions: the script, who wrote it, refills, a controlled-substance flag, checked against the patient's
// documented allergies. Moved from templates/crm-vet/backend/src/routes/prescriptions.ts. The registry signs the
// person in and applies the 'patient_records' gate: the template mounted it ungated, and scripts are written on the
// patient's chart, whose menu item is 'patient_records'.
import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { prescription, patient, user } from '../../db/schema/index.ts'
import { allergyConflict, allergyWarning, type AllergyHit } from './drugClasses.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'

/**
 * A refill count is a whole number, never negative, at most 12 (the usual legal ceiling for a non-controlled drug).
 * "-6" saved without complaint. (Vet T12 M8)
 */
const MAX_REFILLS = 12
function refillsError(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) return 'Refills must be a whole number, and cannot be negative'
  if (n > MAX_REFILLS) return `Refills cannot exceed ${MAX_REFILLS}`
  return null
}

const overrideOf = (hit: AllergyHit) => ({ documented: hit.allergy, matched: hit.matched, drugClass: hit.drugClass })

export function createPrescriptionRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const { emitToCompany, EVENTS } = d.realtime
  const app = new Hono<AppEnv>()

  /** The prescriber is a user of this clinic, never an id handed in from outside it. */
  async function resolvePrescriber(companyId: string, prescriberId: unknown, fallbackUserId: string): Promise<{ prescriberId?: string; error?: string }> {
    const wanted = String(prescriberId || '').trim()
    if (!wanted) return { prescriberId: fallbackUserId }
    const [u] = await db.select().from(user).where(and(eq(user.id, wanted), eq(user.companyId, companyId))).limit(1)
    if (!u) return { error: 'That prescriber is not on your team.' }
    return { prescriberId: u.id }
  }

  /**
   * A documented allergy is checked before the script is written. The vet can still go ahead — they know things the
   * chart does not — but they have to say so (acknowledgeAllergy), and the override goes into the audit trail.
   * (Vet T12 M7)
   */
  async function checkAllergy(companyId: string, patientId: unknown, drug: unknown): Promise<{ hit: AllergyHit; patientName: string } | null> {
    const id = String(patientId || '').trim()
    if (!id || !drug) return null
    const [p] = await db.select().from(patient).where(and(eq(patient.id, id), eq(patient.companyId, companyId))).limit(1)
    if (!p) return null
    const hit = allergyConflict(p.allergies, drug)
    return hit ? { hit, patientName: p.name } : null
  }

  /**
   * The refusal names the allergy in its sentence, with code allergy_conflict (RULEBOOK §3). The template's also
   * carried `allergy: { documented, matched, drugClass }` and `acknowledgeWith: 'acknowledgeAllergy'`; the chart
   * (crm/pages/vet/PatientDetailPage.tsx) now reads the code, shows the sentence and resends with acknowledgeAllergy.
   */
  const allergyRefusal = (c: any, found: { hit: AllergyHit; patientName: string }, drug: unknown) =>
    fail(c, 409, allergyWarning(found.patientName, String(drug), found.hit), 'allergy_conflict')

  // GET /prescriptions — ?patientId=. A list reply (the template: { data } alone).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const patientId = c.req.query('patientId')
    const conditions = [eq(prescription.companyId, currentUser.companyId)]
    if (patientId) conditions.push(eq(prescription.patientId, patientId))

    // Who wrote it travels with the record.
    const rows = await db.select({ rx: prescription, prescriber: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } })
      .from(prescription)
      .leftJoin(user, eq(user.id, prescription.prescriberId))
      .where(and(...conditions))
      .orderBy(desc(prescription.prescribedDate))

    const data = rows.map((r: any) => ({
      ...r.rx,
      prescriber: r.prescriber?.id ? { ...r.prescriber, name: [r.prescriber.firstName, r.prescriber.lastName].filter(Boolean).join(' ') || r.prescriber.email } : null,
    }))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json()

    const badRefills = refillsError(body.refills)
    if (badRefills) return fail(c, 400, badRefills)

    const who = await resolvePrescriber(currentUser.companyId, body.prescriberId, currentUser.userId)
    if (who.error) return fail(c, 400, who.error)

    const found = await checkAllergy(currentUser.companyId, body.patientId, body.drug)
    if (found && body.acknowledgeAllergy !== true) return allergyRefusal(c, found, body.drug)

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

    // A script written over a documented allergy is a clinical decision — it belongs in the record.
    await audit.log({
      action: 'create', entity: 'prescription', entityId: created.id,
      metadata: found ? { ...created, allergyOverride: overrideOf(found.hit) } : created,
      req: { user: currentUser },
    })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const [existing] = await db.select().from(prescription)
      .where(and(eq(prescription.id, id), eq(prescription.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Prescription not found')

    // Whitelist editable columns — never let companyId/id be reassigned from the body.
    const EDITABLE = ['patientId', 'visitId', 'prescriberId', 'drug', 'strength', 'form', 'sig', 'quantity', 'refills', 'isControlled', 'prescribedDate', 'notes'] as const
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k]
    if ('prescribedDate' in updates && updates.prescribedDate) updates.prescribedDate = new Date(updates.prescribedDate)
    if ('refills' in updates) { const bad = refillsError(updates.refills); if (bad) return fail(c, 400, bad) }
    if ('prescriberId' in updates) {
      const who = await resolvePrescriber(currentUser.companyId, updates.prescriberId, currentUser.userId)
      if (who.error) return fail(c, 400, who.error)
      updates.prescriberId = who.prescriberId
    }
    // Changing the drug — or moving the script to another patient — is a new prescribing decision, checked again
    // against whichever chart it lands on.
    let found: { hit: AllergyHit; patientName: string } | null = null
    if ('drug' in updates || 'patientId' in updates) {
      found = await checkAllergy(currentUser.companyId, updates.patientId ?? existing.patientId, updates.drug ?? existing.drug)
      if (found && body.acknowledgeAllergy !== true) return allergyRefusal(c, found, updates.drug ?? existing.drug)
    }

    const [updated] = await db.update(prescription).set(updates).where(eq(prescription.id, id)).returning()
    await audit.log({
      action: 'update', entity: 'prescription', entityId: id, changes: audit.diff(existing, updated),
      ...(found ? { metadata: { allergyOverride: overrideOf(found.hit) } } : {}),
      req: { user: currentUser },
    })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(prescription)
      .where(and(eq(prescription.id, id), eq(prescription.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Prescription not found')

    await db.delete(prescription).where(eq(prescription.id, id))
    await audit.log({ action: 'delete', entity: 'prescription', entityId: id, metadata: existing, req: { user: currentUser } })
    emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'prescription' })
    return done(c)
  })

  return app
}
