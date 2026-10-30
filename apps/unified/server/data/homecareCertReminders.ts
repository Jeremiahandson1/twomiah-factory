// The SQL of the credential-expiry reminders (core/certReminders.ts): which active credentials are 30, 14 or 0 days from
// expiring (or just expired), the claim row that makes each reminder send once, and which caregivers hold an expired
// credential on a given day (the scheduling screens flag them). Every read is the company's; each returns camelCase.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** The companies with an active credential on file (the ones a reminder could be for). */
export async function companiesWithCredentials(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM certification_records WHERE status = 'active' AND expiry_date IS NOT NULL`)).map((r) => String(r.company_id))
}

/**
 * The company's active credentials that expire within `windowDays` of `today`, or expired up to `graceDays` ago (a scan
 * that was down on the day still says so, but a record that lapsed long ago is not announced out of the blue), of
 * caregivers still working. `daysLeft` is whole calendar days (negative: already expired).
 */
export async function credentialsNearExpiry(q: Q, companyId: string, today: string, windowDays: number, graceDays: number): Promise<{
  id: string; caregiverId: string; certificationType: string; expiryDate: string; daysLeft: number; firstName: string; lastName: string
}[]> {
  return camelRows(await q.execute(sql`
    SELECT cr.id, cr.caregiver_id, cr.certification_type, to_char(cr.expiry_date, 'YYYY-MM-DD') AS expiry_date,
           (cr.expiry_date - ${today}::date)::int AS days_left, u.first_name, u.last_name
      FROM certification_records cr JOIN "user" u ON u.id = cr.caregiver_id AND u.company_id = ${companyId}
     WHERE cr.company_id = ${companyId} AND cr.status = 'active' AND cr.expiry_date IS NOT NULL AND u.is_active = true
       AND cr.expiry_date <= (${today}::date + ${windowDays}::int) AND cr.expiry_date >= (${today}::date - ${graceDays}::int)
     ORDER BY cr.expiry_date, cr.id`))
}

/** Claim the reminder for one (credential, expiry date, stage): true only for the scan that inserted the row. */
export async function claimCertReminder(q: Q, companyId: string, certificationRecordId: string, caregiverId: string, expiryDate: string, stage: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`INSERT INTO certification_reminder (id, company_id, certification_record_id, caregiver_id, stage, expiry_date, sent_at)
    VALUES (${createId()}, ${companyId}, ${certificationRecordId}, ${caregiverId}, ${stage}, ${expiryDate}::date, NOW())
    ON CONFLICT (certification_record_id, expiry_date, stage) DO NOTHING RETURNING id`))
  return r.length > 0
}

/** The credentials of these caregivers that have expired on or before `day`: { caregiverId: ['CPR (expired 2026-10-01)', …] }. */
export async function expiredCredentialsOn(q: Q, companyId: string, caregiverIds: string[], day: string): Promise<Record<string, string[]>> {
  if (!caregiverIds.length) return {}
  const rows = camelRows(await q.execute(sql`
    SELECT caregiver_id, certification_type, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date
      FROM certification_records
     WHERE company_id = ${companyId} AND status = 'active' AND expiry_date IS NOT NULL AND expiry_date < ${day}::date
       AND caregiver_id IN (${sql.join(caregiverIds.map((id) => sql`${id}`), sql`, `)})
     ORDER BY expiry_date`))
  const out: Record<string, string[]> = {}
  for (const r of rows) (out[r.caregiverId] ||= []).push(`${r.certificationType} (expired ${r.expiryDate})`)
  return out
}
