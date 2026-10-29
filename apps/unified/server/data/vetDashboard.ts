// The veterinary practice dashboard's SQL (moved from templates/crm-vet/backend/src/routes/dashboard.ts): living
// patients by species, and the vaccinations overdue or due within 30 days.
import { sql, eq, and, count } from 'drizzle-orm'
import { patient, vaccination } from '../db/schema/index.ts'
import { dueVaccinationCondition, activePatientCondition } from '../crm/vet/tileConditions.ts'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'

/** Living patients per species, the species lower-cased. */
export async function livingPatientsBySpecies(db: any, companyId: string): Promise<{ species: string; c: number }[]> {
  return db.select({ species: sql<string>`lower(${patient.species})`, c: count() })
    .from(patient)
    .where(and(eq(patient.companyId, companyId), activePatientCondition(patient)))
    .groupBy(sql`lower(${patient.species})`)
}

/**
 * THE SAME QUESTION THE REMINDERS LIST ANSWERS (T51): only the LATEST administration per (patient, vaccine), living
 * patients only — the dashboard said 11 overdue while Reminders said 9, because renewed shots' old rows were counted.
 * The condition is written once (../crm/vet/tileConditions.ts) and `GET /api/reminders/due` calls it too.
 * `when` is 'overdue' (due before today) or 'soon' (due today up to 30 days on).
 */
export async function latestVaccinationsDue(db: any, companyId: string, when: 'overdue' | 'soon'): Promise<number> {
  // The clinic's today — the database's CURRENT_DATE was UTC's day, a day ahead every evening (2026-10-23).
  const today = storeDateString(new Date(), await companyTimeZone(db, companyId))
  const [row] = await db.select({ value: count() }).from(vaccination).where(dueVaccinationCondition(vaccination, companyId, today, when === 'soon' ? 'due_soon' : 'overdue'))
  return Number(row?.value ?? 0)
}
