// Per-client margin and caregiver turnover (item 10, docs/parity/homecare-margin-turnover.md). Raw SQL lives here (RULEBOOK).
// Row 11 added: who sits where (branch, team, department, manager, leaving date), the client's payer and referral source,
// hours actually invoiced, and the hiring, reliability and payroll-accuracy figures the turnover report shows.
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import { inList, type Q } from './homecareCore.ts'

const quoted = (vals: readonly string[]) => sql.raw(vals.map((s) => `'${s.replace(/'/g, "''")}'`).join(', '))

/** The payable shift reviews in the range that name a client, in the order they were worked (date, then scheduled start). */
export async function payableReviewsWithClient(q: Q, companyId: string, start: string, end: string, payable: readonly string[]): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT psr.id, psr.caregiver_id, psr.client_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS shift_date, psr.payable_minutes,
           psr.scheduled_start::text AS scheduled_start, psr.scheduled_end::text AS scheduled_end
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
       AND psr.status IN (${quoted(payable)}) AND psr.payable_minutes > 0
     ORDER BY psr.caregiver_id, psr.shift_date, psr.scheduled_start NULLS LAST, psr.created_at, psr.id`))
}

/** Payable minutes in the range with no client on the review (so they cannot be put on a client's margin). */
export async function payableMinutesWithoutClient(q: Q, companyId: string, start: string, end: string, payable: readonly string[]): Promise<number> {
  const r = camelRows(await q.execute(sql`
    SELECT COALESCE(SUM(payable_minutes), 0)::int AS minutes FROM payroll_shift_reviews
     WHERE company_id = ${companyId} AND client_id IS NULL AND shift_date BETWEEN ${start}::date AND ${end}::date
       AND status IN (${quoted(payable)}) AND payable_minutes > 0`))
  return Number(r[0]?.minutes) || 0
}

/** Mileage paid per client in the range (trips recorded against a client). */
export async function mileagePaidByClient(q: Q, companyId: string, start: string, end: string): Promise<Record<string, number>> {
  const rows = camelRows(await q.execute(sql`
    SELECT client_id, COALESCE(SUM(amount), 0)::float AS paid FROM mileage_entries
     WHERE company_id = ${companyId} AND client_id IS NOT NULL AND date BETWEEN ${start}::date AND ${end}::date GROUP BY client_id`))
  return Object.fromEntries(rows.map((r: any) => [String(r.clientId), Number(r.paid) || 0]))
}

/**
 * The companies' clients with what the billing rule reads, for these ids — and, for the margin groupings (row 11), the branch,
 * the care type (the report's "department"), the referral source and the payer (the payer of the client's newest active
 * authorization; a private-pay client has none).
 */
export async function marginClients(q: Q, companyId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return []
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.referred_by_id, c.care_type_id, c.is_private_pay, c.private_pay_rate, c.private_pay_rate_type,
           c.branch_id, sl.name AS branch_name, ct.name AS care_type_name, rs.name AS referral_source_name,
           pay.payer_id, pay.payer_name
      FROM clients c
      LEFT JOIN service_locations sl ON sl.id = c.branch_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN LATERAL (
        SELECT a.payer_id, p.name AS payer_name FROM authorizations a JOIN referral_sources p ON p.id = a.payer_id
         WHERE a.client_id = c.id AND a.company_id = ${companyId} AND a.status = 'active' AND a.payer_id IS NOT NULL
         ORDER BY a.end_date DESC LIMIT 1) pay ON true
     WHERE c.company_id = ${companyId} AND c.id IN (${inList(ids)})`))
}

/** Where each of these caregivers sits (row 11): branch, team, department, manager. */
export async function caregiverGroups(q: Q, companyId: string, ids: string[]): Promise<any[]> {
  if (!ids.length) return []
  return camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, cp.branch_id, sl.name AS branch_name, cp.team, cp.department, cp.manager_user_id,
           m.first_name AS manager_first_name, m.last_name AS manager_last_name
      FROM "user" u
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = cp.branch_id
      LEFT JOIN "user" m ON m.id = cp.manager_user_id
     WHERE u.company_id = ${companyId} AND u.id IN (${inList(ids)})`))
}

/** Hours actually invoiced per client, by the line's service date (row 11: "hours billed" beside hours worked). */
export async function invoicedHoursByClient(q: Q, companyId: string, start: string, end: string): Promise<Record<string, number>> {
  const rows = camelRows(await q.execute(sql`
    SELECT i.client_id, COALESCE(SUM(li.hours), 0)::float AS hours
      FROM invoice_line_items li JOIN invoices i ON i.id = li.invoice_id
     WHERE li.company_id = ${companyId} AND li.service_date BETWEEN ${start}::date AND ${end}::date
     GROUP BY i.client_id`))
  return Object.fromEntries(rows.map((r: any) => [String(r.clientId), Number(r.hours) || 0]))
}

/**
 * Every caregiver of the company, current or gone: when they were hired (hire date, else the day the record was made),
 * whether they are still active, the leaving date the office stored (row 11) and the last day they worked a visit. Without
 * a stored leaving date, a caregiver who is no longer active left on the last day they worked (or, if they never worked,
 * the day their record last changed).
 */
export async function caregiverTenure(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.is_active,
           to_char(COALESCE(u.hire_date, u.created_at::date), 'YYYY-MM-DD') AS hired,
           to_char((SELECT MAX(te.start_time)::date FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id), 'YYYY-MM-DD') AS last_worked,
           to_char((SELECT MIN(te.start_time)::date FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id), 'YYYY-MM-DD') AS first_worked,
           to_char(u.updated_at::date, 'YYYY-MM-DD') AS record_changed,
           to_char(cp.left_on, 'YYYY-MM-DD') AS left_on, cp.left_reason, cp.branch_id, sl.name AS branch_name, cp.team, cp.department, cp.manager_user_id,
           m.first_name AS manager_first_name, m.last_name AS manager_last_name
      FROM "user" u
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = cp.branch_id
      LEFT JOIN "user" m ON m.id = cp.manager_user_id
     WHERE u.company_id = ${companyId} AND u.role IN ('caregiver', 'field')
     ORDER BY u.last_name, u.first_name`))
}

/** Applicants in the window (by the day they applied) and how many of them were hired (row 11: applicant-to-hire ratio). */
export async function applicantCounts(q: Q, companyId: string, start: string, end: string): Promise<{ applicants: number; hired: number }> {
  const r = camelRows(await q.execute(sql`
    SELECT COUNT(*)::int AS applicants,
           COUNT(*) FILTER (WHERE a.hired_user_id IS NOT NULL OR a.status = 'hired')::int AS hired
      FROM applications a
     WHERE a.company_id = ${companyId} AND a.created_at::date BETWEEN ${start}::date AND ${end}::date`))
  return { applicants: Number(r[0]?.applicants) || 0, hired: Number(r[0]?.hired) || 0 }
}

/** The categories an expense is filed under that count as the cost of hiring (row 11: cost per hire). */
export const HIRING_EXPENSE_CATEGORIES = ['hiring', 'recruiting', 'recruitment', 'onboarding', 'background_checks', 'background checks', 'job_ads', 'job ads'] as const

/** What the agency spent on hiring in the window, in cents (approved or paid expenses in the hiring categories). */
export async function hiringSpendCents(q: Q, companyId: string, start: string, end: string): Promise<number> {
  const r = camelRows(await q.execute(sql`
    SELECT COALESCE(SUM(ROUND(e.amount * 100)), 0)::bigint AS cents FROM expenses e
     WHERE e.company_id = ${companyId} AND e.date BETWEEN ${start}::date AND ${end}::date AND e.status <> 'rejected'
       AND LOWER(COALESCE(e.category, '')) IN (${quoted(HIRING_EXPENSE_CATEGORIES)})`))
  return Number(r[0]?.cents) || 0
}

/**
 * Per caregiver in the window (row 11): call-outs (an absence reported, or a visit cancelled as "caregiver called out") and
 * missed visits (no-show alerts raised). Only caregivers with at least one of either are listed.
 */
export async function caregiverReliability(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH callouts AS (
      SELECT caregiver_id, COUNT(*)::int AS n FROM absences
       WHERE company_id = ${companyId} AND date BETWEEN ${start}::date AND ${end}::date GROUP BY caregiver_id
    ), cancels AS (
      SELECT s.caregiver_id, COUNT(*)::int AS n FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
       WHERE se.company_id = ${companyId} AND se.exception_type = 'cancelled' AND se.cancel_reason = 'caregiver_callout'
         AND se.exception_date BETWEEN ${start}::date AND ${end}::date AND s.caregiver_id IS NOT NULL GROUP BY s.caregiver_id
    ), missed AS (
      SELECT caregiver_id, COUNT(*)::int AS n FROM noshow_alerts
       WHERE company_id = ${companyId} AND shift_date BETWEEN ${start}::date AND ${end}::date AND caregiver_id IS NOT NULL GROUP BY caregiver_id
    )
    SELECT u.id AS caregiver_id, u.first_name, u.last_name,
           COALESCE(co.n, 0) AS absences, COALESCE(ca.n, 0) AS cancelled_visits, COALESCE(mi.n, 0) AS missed_visits
      FROM "user" u
      LEFT JOIN callouts co ON co.caregiver_id = u.id
      LEFT JOIN cancels ca ON ca.caregiver_id = u.id
      LEFT JOIN missed mi ON mi.caregiver_id = u.id
     WHERE u.company_id = ${companyId} AND u.role IN ('caregiver', 'field') AND (co.n IS NOT NULL OR ca.n IS NOT NULL OR mi.n IS NOT NULL)
     ORDER BY (COALESCE(co.n, 0) + COALESCE(ca.n, 0) + COALESCE(mi.n, 0)) DESC, u.last_name, u.first_name`))
}

/**
 * Payroll accuracy over the window (row 11): of the shifts payroll reviewed, how many were paid as recorded and how many the
 * office had to correct (a manual entry, an excusal, or an approved shift whose payable minutes match neither the schedule
 * nor the clock), and how many pay periods a caregiver disputed.
 */
export async function payrollAccuracy(q: Q, companyId: string, start: string, end: string): Promise<{ reviewed: number; corrected: number; disputed: number; verified: number }> {
  const r = camelRows(await q.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM payroll_shift_reviews psr WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date AND psr.status <> 'pending') AS reviewed,
      (SELECT COUNT(*)::int FROM payroll_shift_reviews psr WHERE psr.company_id = ${companyId} AND psr.shift_date BETWEEN ${start}::date AND ${end}::date
         AND (psr.status IN ('manual_entry', 'excused')
              OR (psr.status = 'approved' AND psr.payable_minutes IS NOT NULL AND psr.payable_minutes <> COALESCE(psr.scheduled_minutes, -1) AND psr.payable_minutes <> COALESCE(psr.actual_minutes, -1)))) AS corrected,
      (SELECT COUNT(*)::int FROM payroll_period_verifications v WHERE v.company_id = ${companyId} AND v.disputed_at IS NOT NULL AND v.pay_period_end >= ${start}::date AND v.pay_period_start <= ${end}::date) AS disputed,
      (SELECT COUNT(*)::int FROM payroll_period_verifications v WHERE v.company_id = ${companyId} AND v.verified_at IS NOT NULL AND v.pay_period_end >= ${start}::date AND v.pay_period_start <= ${end}::date) AS verified`))
  return { reviewed: Number(r[0]?.reviewed) || 0, corrected: Number(r[0]?.corrected) || 0, disputed: Number(r[0]?.disputed) || 0, verified: Number(r[0]?.verified) || 0 }
}

/** The agency's branches (service locations), for the filter lists. */
export async function branches(q: Q, companyId: string): Promise<{ id: string; name: string }[]> {
  return camelRows(await q.execute(sql`SELECT id, name FROM service_locations WHERE company_id = ${companyId} AND is_active = true ORDER BY name`))
}
