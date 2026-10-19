// The incident case file's SQL (moved from templates/crm-homecare/backend/src/services/incidentPdf.ts loadIncidentCase,
// which ran it as raw SQL against its one-agency database). Every read is scoped to the company and returns camelCase;
// DATE columns are still selected as text (to_char) so no server time zone can shift a day.
//
// One fix: the training acknowledgement's signing date was read as `training_ack_signed_at AT TIME ZONE <tz>`, which
// reads a naive-UTC timestamp AS IF it were agency-local time (a 7pm Central signature printed as the next day's
// date, and the shift went the wrong way). It is read the way every other naive-UTC column is (localDate).
import { sql } from 'drizzle-orm'
import { camelFirst, camelRows } from '@twomiah/tenant-backend'
import { localDate, occurrencesCte, type Q } from './homecareCore.ts'

/** One of the company's incidents with its member, payer, caregiver and reporter, dates as text; null when absent. */
export async function incidentForCase(q: Q, companyId: string, incidentId: string, tz: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.*,
           to_char(i.date, 'YYYY-MM-DD')                    AS incident_date_s,
           to_char(i.incident_time, 'FMHH12:MI AM')         AS incident_time_s,
           to_char(i.reported_date, 'YYYY-MM-DD')           AS reported_date_s,
           to_char(i.response_due_date, 'YYYY-MM-DD')       AS response_due_date_s,
           to_char(i.response_sent_date, 'YYYY-MM-DD')      AS response_sent_date_s,
           to_char(i.resolved_at, 'YYYY-MM-DD')             AS closed_date_s,
           to_char(i.caregiver_removed_from, 'YYYY-MM-DD')  AS caregiver_removed_from_s,
           to_char(i.caregiver_returned_on, 'YYYY-MM-DD')   AS caregiver_returned_on_s,
           to_char(${localDate(sql`i.training_ack_signed_at`, tz)}, 'YYYY-MM-DD') AS training_ack_signed_s,
           c.first_name AS client_first, c.last_name AS client_last,
           to_char(c.date_of_birth, 'MM/DD/YYYY') AS client_dob,
           c.medicaid_id, c.mco_member_id, c.is_private_pay, c.referred_by_id AS client_payer_id,
           c.address AS client_address, c.city AS client_city, c.state AS client_state, c.zip AS client_zip,
           rs.name AS payer_name,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last,
           ru.first_name AS entered_by_first, ru.last_name AS entered_by_last,
           to_char((NOW() AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS today_s
      FROM incidents i
      LEFT JOIN clients c ON c.id = i.client_id AND c.company_id = i.company_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id AND rs.company_id = i.company_id
      LEFT JOIN "user" u  ON u.id  = i.caregiver_id
      LEFT JOIN "user" ru ON ru.id = i.reported_by_id
     WHERE i.id = ${incidentId} AND i.company_id = ${companyId}`)) ?? null
}

/** The incident's investigation entries, oldest first, with who wrote each. */
export async function incidentInvestigationEntries(q: Q, companyId: string, incidentId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT n.id, n.entry_type, n.summary, to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_s,
           u.first_name, u.last_name
      FROM incident_investigation_notes n
      LEFT JOIN "user" u ON u.id = n.created_by_id
     WHERE n.incident_id = ${incidentId} AND n.company_id = ${companyId}
     ORDER BY n.entry_date, n.created_at`))
}

/** The incident's attachments (no file data), oldest first. */
export async function incidentAttachmentIndex(q: Q, companyId: string, incidentId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT id, category, file_name, mime_type, file_size, description
      FROM incident_attachments WHERE incident_id = ${incidentId} AND company_id = ${companyId} ORDER BY created_at`))
}

/**
 * Scheduled visits at the member's home between two dates (cancelled visits excluded; one-day changes of time or
 * caregiver applied), through the shared schedule engine.
 */
export async function memberScheduledVisits(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)}
    SELECT to_char(occ.occ_date, 'Dy YYYY-MM-DD') AS day_s,
           to_char(occ.start_time, 'FMHH12:MI AM') AS start_s,
           to_char(occ.end_time, 'FMHH12:MI AM')   AS end_s,
           u.first_name AS cg_first, u.last_name AS cg_last
      FROM occ
      LEFT JOIN "user" u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${clientId}
     ORDER BY occ.occ_date, occ.start_time`))
}

/** The caregiver's background checks, most recent first. */
export async function caregiverBackgroundCheckHistory(q: Q, companyId: string, caregiverId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT check_type, provider, status, findings,
           to_char(initiated_date, 'YYYY-MM-DD') AS initiated_s,
           to_char(expiration_date, 'YYYY-MM-DD') AS expires_s,
           COALESCE(worcs_reference_number, reference_number) AS reference
      FROM background_checks
     WHERE caregiver_id = ${caregiverId} AND company_id = ${companyId}
     ORDER BY initiated_date DESC NULLS LAST, created_at DESC`))
}

/** The caregiver's training records, most recently completed first. */
export async function caregiverTrainingHistory(q: Q, companyId: string, caregiverId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT training_name, provider, status,
           to_char(completed_date, 'YYYY-MM-DD') AS completed_s,
           to_char(expiry_date, 'YYYY-MM-DD') AS expires_s
      FROM training_records
     WHERE caregiver_id = ${caregiverId} AND company_id = ${companyId}
     ORDER BY completed_date DESC NULLS LAST, created_at DESC`))
}

/** The agency date (YYYY-MM-DD) of the caregiver's last clock-in at this client, or null. */
export async function lastCaregiverClockInDate(q: Q, companyId: string, clientId: string, caregiverId: string, tz: string): Promise<string | null> {
  const r = camelFirst(await q.execute(sql`
    SELECT to_char(MAX(${localDate(sql`start_time`, tz)}), 'YYYY-MM-DD') AS d
      FROM time_entries WHERE client_id = ${clientId} AND caregiver_id = ${caregiverId} AND company_id = ${companyId}`))
  return r?.d ?? null
}

/**
 * Other members of the SAME payer (by referral source / payer, or by the payer on their authorizations) the caregiver
 * served between `from` and `to`. Counts scheduled visits AND clock-ins, because a visit worked without clocking in
 * still happened.
 */
export async function otherMembersServedByCaregiver(q: Q, companyId: string, o: { caregiverId: string; clientId: string; from: string; to: string; tz: string }): Promise<any[]> {
  const { caregiverId, clientId, from, to, tz } = o
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to)},
    sched AS (
      SELECT occ.client_id, COUNT(*)::int AS n, MIN(occ.occ_date) AS first_d, MAX(occ.occ_date) AS last_d
        FROM occ WHERE occ.caregiver_id = ${caregiverId} GROUP BY 1),
    punched AS (
      SELECT t.client_id, COUNT(*)::int AS n,
             MIN(${localDate(sql`t.start_time`, tz)}) AS first_d,
             MAX(${localDate(sql`t.start_time`, tz)}) AS last_d
        FROM time_entries t
       WHERE t.company_id = ${companyId}
         AND t.caregiver_id = ${caregiverId}
         AND ${localDate(sql`t.start_time`, tz)} BETWEEN ${from}::date AND ${to}::date
       GROUP BY 1)
    SELECT c.first_name, c.last_name, rs.name AS payer,
           COALESCE(s.n, 0) AS scheduled_visits, COALESCE(p.n, 0) AS clock_ins,
           to_char(LEAST(COALESCE(s.first_d, p.first_d), COALESCE(p.first_d, s.first_d)), 'MM/DD/YYYY') AS first_s,
           to_char(GREATEST(COALESCE(s.last_d, p.last_d), COALESCE(p.last_d, s.last_d)), 'MM/DD/YYYY') AS last_s
      FROM clients c
      LEFT JOIN sched s   ON s.client_id = c.id
      LEFT JOIN punched p ON p.client_id = c.id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.company_id = ${companyId}
       AND c.id <> ${clientId}
       AND (s.client_id IS NOT NULL OR p.client_id IS NOT NULL)
       AND (
         c.referred_by_id = (SELECT referred_by_id FROM clients WHERE id = ${clientId} AND company_id = ${companyId})
         OR EXISTS (SELECT 1 FROM authorizations a
                     WHERE a.client_id = c.id AND a.company_id = ${companyId}
                       AND a.payer_id = (SELECT referred_by_id FROM clients WHERE id = ${clientId} AND company_id = ${companyId}))
       )
     ORDER BY c.last_name, c.first_name`))
}
