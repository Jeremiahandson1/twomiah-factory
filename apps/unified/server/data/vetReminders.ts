// The veterinary recall engine's SQL (moved from templates/crm-vet/backend/src/routes/reminders.ts): the lapsed-client
// query and the per-shot reminder count.
import { sql, eq, and, inArray } from 'drizzle-orm'
import { patient, contact, visit, vaccination } from '../db/schema/index.ts'

/**
 * Living patients who haven't been in since `cutoffIso`: a last visit older than the cutoff, OR never visited AND
 * registered before it — a pet registered long ago that never came is a win-back; one registered days ago is just new.
 * (VET-17/VET-12)
 */
export async function lapsedPatients(db: any, companyId: string, cutoffIso: string) {
  return db.select({
    patientId: patient.id, patientName: patient.name, species: patient.species,
    ownerId: contact.id, ownerName: contact.name, ownerEmail: contact.email, ownerPhone: contact.phone, ownerMobile: contact.mobile,
    lastRemindedAt: contact.lastRemindedAt,
    lastVisit: sql<string | null>`max(${visit.visitDate})`,
  })
    .from(patient)
    .leftJoin(visit, eq(visit.patientId, patient.id))
    .leftJoin(contact, eq(patient.ownerId, contact.id))
    .where(and(eq(patient.companyId, companyId), eq(patient.deceased, false)))
    .groupBy(patient.id, contact.id)
    .having(sql`max(${visit.visitDate}) < ${cutoffIso} OR (max(${visit.visitDate}) IS NULL AND min(${patient.createdAt}) < ${cutoffIso})`)
}

/** Stamp these vaccinations as reminded now, counting one more reminder on each. (Vet T12 M9) */
export async function stampVaccinationsReminded(db: any, companyId: string, ids: string[], now: Date): Promise<void> {
  await db.update(vaccination)
    .set({ lastRemindedAt: now, reminderCount: sql`${vaccination.reminderCount} + 1`, updatedAt: now })
    .where(and(eq(vaccination.companyId, companyId), inArray(vaccination.id, ids)))
}
