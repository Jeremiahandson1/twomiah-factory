// The veterinary practice dashboard's SQL (moved from templates/crm-vet/backend/src/routes/dashboard.ts): living
// patients by species, and the vaccinations overdue or due within 30 days.
import { sql, eq, and, count } from 'drizzle-orm'
import { patient } from '../db/schema/index.ts'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

/** Living patients per species, the species lower-cased. */
export async function livingPatientsBySpecies(db: any, companyId: string): Promise<{ species: string; c: number }[]> {
  return db.select({ species: sql<string>`lower(${patient.species})`, c: count() })
    .from(patient)
    .where(and(eq(patient.companyId, companyId), eq(patient.deceased, false)))
    .groupBy(sql`lower(${patient.species})`)
}

/**
 * THE SAME QUESTION THE REMINDERS LIST ANSWERS (T51): only the LATEST administration per (patient, vaccine), living
 * patients only — the dashboard said 11 overdue while Reminders said 9, because renewed shots' old rows were counted.
 * DISTINCT ON has no builder form. `when` is 'overdue' (due before today) or 'soon' (due in the next 30 days).
 */
export async function latestVaccinationsDue(db: any, companyId: string, when: 'overdue' | 'soon'): Promise<number> {
  // The clinic's today — the database's CURRENT_DATE was UTC's day, a day ahead every evening (2026-10-23).
  const today = storeDateString(new Date(), await companyTimeZone(db, companyId))
  const window = when === 'overdue'
    ? sql`latest.due_date < ${today}::date`
    : sql`latest.due_date >= ${today}::date AND latest.due_date < ${today}::date + INTERVAL '30 days'`
  const r = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS value FROM (
      SELECT DISTINCT ON (v.patient_id, lower(v.vaccine)) v.due_date
      FROM vaccination v
      JOIN patient p ON p.id = v.patient_id
      WHERE v.company_id = ${companyId} AND v.due_date IS NOT NULL AND p.deceased = false
      ORDER BY v.patient_id, lower(v.vaccine), v.given_date DESC NULLS LAST
    ) latest
    WHERE ${window}
  `))
  return Number(r[0]?.value ?? 0)
}
