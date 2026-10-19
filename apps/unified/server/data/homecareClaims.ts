// Home care's claims SQL: the claims engine's reads and its authorization burn-down. Moved from
// templates/crm-homecare/backend/src/services/claimsEngine.ts (raw SQL lives in server/data/, RULEBOOK §2). Every
// query is the company's; the reads return camelCase.
import { sql } from 'drizzle-orm'
import { camelRows, camelFirst } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** The EVV visit a claim is made from, with its client's payer and the punch's minutes, or null. */
export async function evvVisitForClaim(q: Q, companyId: string, evvVisitId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ev.*, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date_text,
           c.referred_by_id, c.care_type_id, c.primary_diagnosis_code,
           te.billable_minutes, te.duration_minutes, COALESCE(ts.is_training, false) AS is_training,
           rs.name AS payer_name, rs.payer_type, rs.payer_id_number, rs.submission_method, rs.claim_portal
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN "user" u ON ev.caregiver_id = u.id
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
      LEFT JOIN time_entries te ON te.id = ev.time_entry_id
      LEFT JOIN schedules ts ON ts.id = te.schedule_id
     WHERE ev.id = ${evvVisitId} AND ev.company_id = ${companyId}`)) ?? null
}

/**
 * The company's claimable EVV visits in a date range, oldest first: the time entry is complete with billable time, not
 * a training shift, the client's payer is a claim payer (not private pay), and the visit is not already claimed.
 */
export async function claimableEvvVisitIds(q: Q, companyId: string, startDate: string, endDate: string): Promise<string[]> {
  return camelRows(await q.execute(sql`
    SELECT ev.id
      FROM evv_visits ev
      JOIN time_entries te ON te.id = ev.time_entry_id
      JOIN clients c ON c.id = ev.client_id
      JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN claims cl ON cl.evv_visit_id = ev.id
      LEFT JOIN schedules ts ON ts.id = te.schedule_id
     WHERE ev.company_id = ${companyId}
       AND ev.service_date BETWEEN ${startDate}::date AND ${endDate}::date
       AND te.is_complete = true
       AND ts.is_training IS NOT TRUE
       AND COALESCE(te.billable_minutes, te.duration_minutes) > 0
       AND COALESCE(c.is_private_pay, false) = false
       AND rs.payer_type IS NOT NULL
       AND rs.payer_type <> 'private_pay'
       AND cl.id IS NULL
     ORDER BY ev.service_date ASC`)).map((r: any) => r.id as string)
}

/** What one claim covers: its 15-minute units, its source, its day span and (for an invoice claim) its visits and days. */
export async function claimUsageFacts(q: Q, companyId: string, claimId: string): Promise<{
  unitsBilled: string | null; evvVisitId: string | null; invoiceId: string | null; spanDays: number | null; invoiceVisits: number | null; invoiceDays: number | null
} | null> {
  return camelFirst(await q.execute(sql`
    SELECT cl.units_billed, cl.evv_visit_id, cl.invoice_id,
           COALESCE(cl.service_date_to, cl.service_date, cl.service_date_from) - COALESCE(cl.service_date_from, cl.service_date, cl.service_date_to) + 1 AS span_days,
           (SELECT COUNT(DISTINCT (ili.service_date, ili.start_time, ili.caregiver_id))::int FROM invoice_line_items ili
             WHERE cl.invoice_id IS NOT NULL AND ili.invoice_id = cl.invoice_id AND ili.service_date IS NOT NULL) AS invoice_visits,
           (SELECT COUNT(DISTINCT ili.service_date)::int FROM invoice_line_items ili
             WHERE cl.invoice_id IS NOT NULL AND ili.invoice_id = cl.invoice_id AND ili.service_date IS NOT NULL) AS invoice_days
      FROM claims cl WHERE cl.id = ${claimId} AND cl.company_id = ${companyId}`)) ?? null
}

/** A claim and the authorization it is linked to (left join: the authorization may be absent), or null. */
export async function claimAuthorizationFacts(q: Q, companyId: string, claimId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT cl.authorization_id, cl.units_billed, a.authorized_units, a.used_units, a.unit_type,
           to_char(a.end_date, 'YYYY-MM-DD') AS end_date, a.status AS auth_status
      FROM claims cl LEFT JOIN authorizations a ON cl.authorization_id = a.id
     WHERE cl.id = ${claimId} AND cl.company_id = ${companyId}`)) ?? null
}

/** A claim with its authorization (inner join), for the deduction, or null. */
export async function claimDeductionFacts(q: Q, companyId: string, claimId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT cl.units_billed, cl.authorization_id, cl.client_id, cl.units_deducted_at,
           a.authorized_units, a.used_units, a.low_units_alert_threshold, a.auth_number, a.unit_type,
           to_char(a.end_date, 'YYYY-MM-DD') AS end_date
      FROM claims cl JOIN authorizations a ON cl.authorization_id = a.id
     WHERE cl.id = ${claimId} AND cl.company_id = ${companyId}`)) ?? null
}

/** Claim the claim's deduction: true only for the one call that stamps units_deducted_at. */
export async function stampUnitsDeducted(q: Q, companyId: string, claimId: string): Promise<boolean> {
  return camelRows(await q.execute(sql`
    UPDATE claims SET units_deducted_at = NOW() WHERE id = ${claimId} AND company_id = ${companyId} AND units_deducted_at IS NULL RETURNING id`)).length > 0
}

/** Add units to an authorization's used units; it becomes 'exhausted' when they reach the authorized units. */
export async function addAuthorizationUsedUnits(q: Q, companyId: string, authorizationId: string, units: number): Promise<void> {
  await q.execute(sql`
    UPDATE authorizations SET
      used_units = used_units + ${units},
      status = CASE WHEN used_units + ${units} >= authorized_units THEN 'exhausted' ELSE status END,
      updated_at = NOW()
    WHERE id = ${authorizationId} AND company_id = ${companyId}`)
}
