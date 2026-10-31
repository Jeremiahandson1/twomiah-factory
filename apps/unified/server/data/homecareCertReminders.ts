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
  id: string; caregiverId: string; certificationType: string; expiryDate: string; daysLeft: number; firstName: string; lastName: string; email: string | null
}[]> {
  return camelRows(await q.execute(sql`
    SELECT cr.id, cr.caregiver_id, cr.certification_type, to_char(cr.expiry_date, 'YYYY-MM-DD') AS expiry_date,
           (cr.expiry_date - ${today}::date)::int AS days_left, u.first_name, u.last_name, u.email
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

/** The active office people's email addresses (admins and owners) — who a credential reminder is emailed to. */
export async function officeEmails(q: Q, companyId: string): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT email FROM "user" WHERE company_id = ${companyId} AND role IN ('admin', 'owner') AND is_active = true AND email IS NOT NULL AND email <> ''`))
    .map((r) => String(r.email))
}

/** Companies with an active client credential on file. */
export async function companiesWithClientCredentials(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM client_credential WHERE status = 'active' AND expiry_date IS NOT NULL`)).map((r) => String(r.company_id))
}

/** The company's active client credentials that expire within `windowDays` of `today`, or lapsed up to `graceDays` ago, of active clients. */
export async function clientCredentialsNearExpiry(q: Q, companyId: string, today: string, windowDays: number, graceDays: number): Promise<{
  id: string; clientId: string; credentialType: string; expiryDate: string; daysLeft: number; firstName: string; lastName: string
}[]> {
  return camelRows(await q.execute(sql`
    SELECT cc.id, cc.client_id, cc.credential_type, to_char(cc.expiry_date, 'YYYY-MM-DD') AS expiry_date,
           (cc.expiry_date - ${today}::date)::int AS days_left, c.first_name, c.last_name
      FROM client_credential cc JOIN clients c ON c.id = cc.client_id AND c.company_id = ${companyId}
     WHERE cc.company_id = ${companyId} AND cc.status = 'active' AND cc.expiry_date IS NOT NULL AND c.is_active = true
       AND cc.expiry_date <= (${today}::date + ${windowDays}::int) AND cc.expiry_date >= (${today}::date - ${graceDays}::int)
     ORDER BY cc.expiry_date, cc.id`))
}

/** Claim the reminder for one (client credential, expiry date, stage): true only for the scan that inserted the row. */
export async function claimClientCredentialReminder(q: Q, companyId: string, clientCredentialId: string, expiryDate: string, stage: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`INSERT INTO client_credential_reminder (id, company_id, client_credential_id, stage, expiry_date, sent_at)
    VALUES (${createId()}, ${companyId}, ${clientCredentialId}, ${stage}, ${expiryDate}::date, NOW())
    ON CONFLICT (client_credential_id, expiry_date, stage) DO NOTHING RETURNING id`))
  return r.length > 0
}

/**
 * The old office "certification alerts" list, filled from the same scan: one active alert per (credential, expiry date),
 * its days-left and kind kept current. Returns true when the alert is new.
 */
export async function upsertCertAlert(q: Q, companyId: string, a: { caregiverId: string; certificationRecordId: string; certificationType: string; expiryDate: string; daysLeft: number }): Promise<boolean> {
  const alertType = a.daysLeft < 0 ? 'expired' : a.daysLeft === 0 ? 'expires_today' : 'expiring_soon'
  const updated = rowsOf(await q.execute(sql`UPDATE certification_alerts SET days_until_expiry = ${a.daysLeft}, alert_type = ${alertType}
    WHERE company_id = ${companyId} AND certification_record_id = ${a.certificationRecordId} AND expiry_date = ${a.expiryDate}::date AND status = 'active' RETURNING id`))
  if (updated.length) return false
  const already = rowsOf(await q.execute(sql`SELECT id FROM certification_alerts WHERE company_id = ${companyId} AND certification_record_id = ${a.certificationRecordId} AND expiry_date = ${a.expiryDate}::date LIMIT 1`))
  if (already.length) return false // acknowledged or resolved: not raised again
  await q.execute(sql`INSERT INTO certification_alerts (id, company_id, caregiver_id, certification_record_id, certification_type, expiry_date, alert_type, days_until_expiry, status)
    VALUES (${createId()}, ${companyId}, ${a.caregiverId}, ${a.certificationRecordId}, ${a.certificationType}, ${a.expiryDate}::date, ${alertType}, ${a.daysLeft}, 'active')`)
  return true
}

/** An alert whose credential was renewed (a new expiry date) or is no longer active is resolved, so the list stays true. */
export async function resolveStaleCertAlerts(q: Q, companyId: string): Promise<void> {
  await q.execute(sql`UPDATE certification_alerts a SET status = 'resolved'
    WHERE a.company_id = ${companyId} AND a.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM certification_records cr WHERE cr.id = a.certification_record_id AND cr.status = 'active' AND cr.expiry_date = a.expiry_date)`)
}

/**
 * The credential search: every caregiver's credentials, filtered by type (contains), caregiver, expired, or expiring within
 * N days of `today`. Soonest expiry first. `daysLeft` is whole days (negative: expired).
 */
export async function searchCredentials(q: Q, companyId: string, today: string, f: { type?: string; caregiverId?: string; expired?: boolean; withinDays?: number; status?: string; limit: number; offset: number }): Promise<{ rows: any[]; total: number }> {
  const where = sql`cr.company_id = ${companyId}
    ${f.type ? sql`AND cr.certification_type ILIKE ${'%' + f.type.replace(/[%_]/g, (m) => '\\' + m) + '%'}` : sql``}
    ${f.caregiverId ? sql`AND cr.caregiver_id = ${f.caregiverId}` : sql``}
    ${f.status ? sql`AND cr.status = ${f.status}` : sql`AND cr.status = 'active'`}
    ${f.expired ? sql`AND cr.expiry_date IS NOT NULL AND cr.expiry_date < ${today}::date` : sql``}
    ${f.withinDays != null ? sql`AND cr.expiry_date IS NOT NULL AND cr.expiry_date >= ${today}::date AND cr.expiry_date <= (${today}::date + ${f.withinDays}::int)` : sql``}`
  const total = Number(rowsOf(await q.execute(sql`SELECT COUNT(*)::int AS n FROM certification_records cr WHERE ${where}`))[0]?.n ?? 0)
  const rows = camelRows(await q.execute(sql`
    SELECT cr.id, cr.caregiver_id, cr.certification_type, cr.issuing_body, to_char(cr.expiry_date, 'YYYY-MM-DD') AS expiry_date, cr.status,
           CASE WHEN cr.expiry_date IS NULL THEN NULL ELSE (cr.expiry_date - ${today}::date)::int END AS days_left,
           u.first_name, u.last_name
      FROM certification_records cr JOIN "user" u ON u.id = cr.caregiver_id AND u.company_id = ${companyId}
     WHERE ${where}
     ORDER BY cr.expiry_date ASC NULLS LAST, cr.id LIMIT ${f.limit} OFFSET ${f.offset}`))
  return { rows, total }
}
