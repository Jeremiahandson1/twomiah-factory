// Row 11 / 12 (docs/parity/homecare-margin-turnover.md): the filter lists of the margin reports, the visit rows the report builder
// runs over, and the figures the dashboards, the daily manager report, the workforce analytics and the caregiver performance report
// read. Raw SQL lives here (RULEBOOK §2); every result is camelCase.
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import { occurrencesCte, localDate, localTs, dayStartUtc, dayEndUtc, type Q } from './homecareCore.ts'
import { releasedInvoiceSql } from './homecareBilling.ts'

const all = async (q: Q, s: any): Promise<any[]> => camelRows(await q.execute(s))
const isCaregiver = sql.raw(`u.role IN ('caregiver', 'field')`)

/** The lists the filter boxes show: active clients, active caregivers, branches, referral sources and payers. */
export async function marginFilterLists(q: Q, companyId: string) {
  const [clients, caregivers, branches, sources] = await Promise.all([
    all(q, sql`SELECT id, first_name, last_name FROM clients WHERE company_id = ${companyId} AND is_active = true ORDER BY last_name, first_name`),
    all(q, sql`SELECT u.id, u.first_name, u.last_name FROM "user" u WHERE u.company_id = ${companyId} AND ${isCaregiver} AND u.is_active = true ORDER BY u.last_name, u.first_name`),
    all(q, sql`SELECT id, name FROM service_locations WHERE company_id = ${companyId} AND is_active = true ORDER BY name`),
    all(q, sql`SELECT id, name, is_active_payer FROM referral_sources WHERE company_id = ${companyId} AND is_active = true ORDER BY name`),
  ])
  const name = (r: any) => `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim()
  return {
    clients: clients.map((r) => ({ id: String(r.id), name: name(r) })),
    caregivers: caregivers.map((r) => ({ id: String(r.id), name: name(r) })),
    branches: branches.map((r) => ({ id: String(r.id), name: String(r.name) })),
    referralSources: sources.map((r) => ({ id: String(r.id), name: String(r.name) })),
    payers: sources.filter((r) => r.isActivePayer).map((r) => ({ id: String(r.id), name: String(r.name) })),
  }
}

/**
 * The report builder's source (row 12): one row per visit worked in the window (a completed clock-in/out, by the agency's day), with
 * everything the office might report on — who, where, the schedule it matched, the clock, what payroll pays, what the invoice
 * carried, the signature, tasks, forms, ADLs and the client's rating. Capped so a huge window cannot exhaust the server.
 */
export async function visitRows(q: Q, companyId: string, start: string, end: string, tz: string, cap = 20000): Promise<any[]> {
  const day = localDate(sql`te.start_time`, tz)
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT te.id AS visit_id, ${day} AS date, te.client_id, c.first_name AS client_first, c.last_name AS client_last,
           te.caregiver_id, u.first_name AS caregiver_first, u.last_name AS caregiver_last,
           sl.name AS branch_name, csl.name AS caregiver_branch_name, cp.team, cp.department AS caregiver_department, ct.name AS care_type_name,
           rs.name AS referral_source_name, pay.payer_name,
           to_char(o.occ_date + o.start_time, 'HH24:MI') AS scheduled_start, to_char(o.occ_date + o.end_time, 'HH24:MI') AS scheduled_end, o.minutes AS scheduled_minutes,
           to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI') AS clock_in, to_char(${localTs(sql`te.end_time`, tz)}, 'HH24:MI') AS clock_out,
           COALESCE(te.duration_minutes, ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60))::int AS clocked_minutes,
           CASE WHEN o.occ_date IS NULL THEN NULL ELSE ROUND(EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)}) - (o.occ_date + o.start_time))) / 60)::int END AS minutes_late_in,
           CASE WHEN o.occ_date IS NULL OR te.end_time IS NULL THEN NULL ELSE ROUND(EXTRACT(EPOCH FROM ((${localTs(sql`te.end_time`, tz)}) - (o.occ_date + o.end_time))) / 60)::int END AS minutes_late_out,
           psr.payable_minutes, psr.status AS payroll_status,
           li.amount AS billed_amount, li.hours AS billed_hours,
           (vs.id IS NOT NULL AND vs.signature_image IS NOT NULL) AS signed, vs.reason_code AS unsigned_reason,
           (SELECT COUNT(*) FROM shift_task_completions stc WHERE stc.time_entry_id = te.id AND stc.status = 'completed')::int AS tasks_done,
           (SELECT COUNT(*) FROM shift_task_completions stc WHERE stc.time_entry_id = te.id AND stc.status IN ('skipped', 'refused', 'not_applicable'))::int AS tasks_skipped,
           (SELECT COUNT(*) FROM visit_item_log vil JOIN visit_item vi ON vi.id = vil.item_id WHERE vil.time_entry_id = te.id AND vi.kind = 'form' AND vil.status = 'done')::int AS forms_done,
           (SELECT COUNT(*) FROM visit_item_log vil JOIN visit_item vi ON vi.id = vil.item_id WHERE vil.time_entry_id = te.id AND vi.kind = 'form' AND vil.status <> 'done')::int AS forms_missed,
           (SELECT COUNT(*) FROM adl_logs al WHERE al.time_entry_id = te.id)::int AS adls_recorded,
           (SELECT ROUND(AVG(pr.satisfaction_score), 1) FROM performance_ratings pr WHERE pr.company_id = ${companyId} AND pr.caregiver_id = te.caregiver_id AND pr.client_id = te.client_id AND pr.rating_date = ${day}) AS client_rating,
           te.needs_approval, te.approval_reason, COALESCE(o.is_training, false) AS is_training, te.notes AS visit_note
      FROM time_entries te
      JOIN clients c ON c.id = te.client_id
      JOIN "user" u ON u.id = te.caregiver_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = c.branch_id
      LEFT JOIN service_locations csl ON csl.id = cp.branch_id
      LEFT JOIN care_types ct ON ct.id = c.care_type_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN LATERAL (SELECT p.name AS payer_name FROM authorizations a JOIN referral_sources p ON p.id = a.payer_id
                          WHERE a.client_id = c.id AND a.company_id = ${companyId} AND a.status = 'active' ORDER BY a.end_date DESC LIMIT 1) pay ON true
      LEFT JOIN LATERAL (SELECT occ.occ_date, occ.start_time, occ.end_time, occ.minutes, occ.is_training FROM occ
                          WHERE occ.schedule_id = te.schedule_id AND occ.occ_date = ${day}
                          ORDER BY ABS(EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)}) - (occ.occ_date + occ.start_time)))) LIMIT 1) o ON true
      LEFT JOIN LATERAL (SELECT r.payable_minutes, r.status FROM payroll_shift_reviews r WHERE r.time_entry_id = te.id ORDER BY r.updated_at DESC LIMIT 1) psr ON true
      LEFT JOIN LATERAL (SELECT l.amount, l.hours FROM invoice_line_items l WHERE l.time_entry_id = te.id ORDER BY l.created_at DESC LIMIT 1) li ON true
      LEFT JOIN visit_signature vs ON vs.time_entry_id = te.id
     WHERE te.company_id = ${companyId} AND te.end_time IS NOT NULL
       AND te.start_time >= ${dayStartUtc(start, tz)} AND te.start_time < ${dayEndUtc(end, tz)}
     ORDER BY te.start_time, c.last_name
     LIMIT ${cap}`)
}

/** Visits cancelled in the window (row 12: the performance report's "cancelled" and the cancellation trend), with the reason and who. */
export async function cancelledVisits(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return all(q, sql`SELECT to_char(se.exception_date, 'YYYY-MM-DD') AS date, se.cancel_reason, s.caregiver_id, s.client_id,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last, c.first_name AS client_first, c.last_name AS client_last
      FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
      LEFT JOIN "user" u ON u.id = s.caregiver_id LEFT JOIN clients c ON c.id = s.client_id
     WHERE se.company_id = ${companyId} AND se.exception_type = 'cancelled' AND se.exception_date BETWEEN ${start}::date AND ${end}::date
     ORDER BY se.exception_date`)
}

/** Missed visits (no-show alerts) in the window, per caregiver. */
export async function missedVisits(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return all(q, sql`SELECT caregiver_id, COUNT(*)::int AS missed FROM noshow_alerts
     WHERE company_id = ${companyId} AND shift_date BETWEEN ${start}::date AND ${end}::date AND caregiver_id IS NOT NULL GROUP BY caregiver_id`)
}

/** Scheduled visits per caregiver in the window (the occurrences), for the performance and workload figures. */
export async function scheduledByCaregiver(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT occ.caregiver_id, COUNT(*)::int AS visits, ROUND(SUM(occ.hours)::numeric, 2) AS hours FROM occ WHERE occ.caregiver_id IS NOT NULL GROUP BY occ.caregiver_id`)
}

/** Every active caregiver with the hours they want and the most they will do (row 12: workload and underused staff). */
export async function caregiverCapacity(q: Q, companyId: string): Promise<any[]> {
  return all(q, sql`SELECT u.id, u.first_name, u.last_name, ca.hours_wanted, ca.max_hours_per_week, cp.team, sl.name AS branch_name, cp.manager_user_id,
           m.first_name AS manager_first, m.last_name AS manager_last, to_char(COALESCE(u.hire_date, u.created_at::date), 'YYYY-MM-DD') AS hired
      FROM "user" u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = cp.branch_id
      LEFT JOIN "user" m ON m.id = cp.manager_user_id
     WHERE u.company_id = ${companyId} AND ${isCaregiver} AND u.is_active = true AND cp.left_on IS NULL
     ORDER BY u.last_name, u.first_name`)
}

/** Hours clocked per caregiver per week (Sunday) in the window, for workload and the hours-drop signal. */
export async function clockedHoursByCaregiverWeek(q: Q, companyId: string, start: string, end: string, tz: string): Promise<any[]> {
  const day = localDate(sql`te.start_time`, tz)
  return all(q, sql`SELECT te.caregiver_id, to_char(${day} - EXTRACT(DOW FROM ${day})::int, 'YYYY-MM-DD') AS week_start,
           ROUND(SUM(COALESCE(te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)) / 60.0, 2) AS hours, COUNT(*)::int AS visits
      FROM time_entries te
     WHERE te.company_id = ${companyId} AND te.end_time IS NOT NULL AND te.start_time >= ${dayStartUtc(start, tz)} AND te.start_time < ${dayEndUtc(end, tz)}
     GROUP BY te.caregiver_id, 2 ORDER BY 2`)
}

/** Authorization utilisation (row 12): every active authorization with what was used, by its own counter and by the visits in its window. */
export async function authorizationUtilisation(q: Q, companyId: string, today: string): Promise<any[]> {
  return all(q, sql`SELECT a.id, a.client_id, c.first_name AS client_first, c.last_name AS client_last, p.name AS payer_name, a.auth_number, a.procedure_code,
           a.authorized_units, a.used_units, a.unit_type, to_char(a.start_date, 'YYYY-MM-DD') AS start_date, to_char(a.end_date, 'YYYY-MM-DD') AS end_date, a.status,
           (a.end_date - ${today}::date)::int AS days_left, (${today}::date - a.start_date)::int AS days_in,
           (SELECT COALESCE(SUM(psr.payable_minutes), 0)::int FROM payroll_shift_reviews psr WHERE psr.company_id = ${companyId} AND psr.client_id = a.client_id
              AND psr.shift_date BETWEEN a.start_date AND a.end_date AND psr.status IN ('verified', 'approved', 'manual_entry')) AS payable_minutes_in_window
      FROM authorizations a JOIN clients c ON c.id = a.client_id LEFT JOIN referral_sources p ON p.id = a.payer_id
     WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.end_date >= ${today}::date - 30
     ORDER BY a.end_date`)
}

/** The daily manager report's counts for one agency day (row 12). */
export async function dayCounts(q: Q, companyId: string, date: string, tz: string, graceMinutes: number) {
  const day = localDate(sql`te.start_time`, tz)
  const r = await all(q, sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT
      (SELECT COUNT(*)::int FROM occ) AS scheduled,
      (SELECT COALESCE(ROUND(SUM(occ.hours)::numeric, 2), 0) FROM occ) AS scheduled_hours,
      (SELECT COUNT(*)::int FROM occ WHERE occ.caregiver_id IS NULL) AS unassigned,
      (SELECT COUNT(*)::int FROM time_entries te WHERE te.company_id = ${companyId} AND ${day} = ${date}::date AND te.end_time IS NOT NULL) AS completed,
      (SELECT COUNT(*)::int FROM time_entries te WHERE te.company_id = ${companyId} AND ${day} = ${date}::date AND te.end_time IS NULL) AS in_progress,
      (SELECT COALESCE(ROUND(SUM(COALESCE(te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)) / 60.0, 2), 0) FROM time_entries te WHERE te.company_id = ${companyId} AND ${day} = ${date}::date AND te.end_time IS NOT NULL) AS clocked_hours,
      (SELECT COUNT(*)::int FROM time_entries te JOIN occ ON occ.schedule_id = te.schedule_id AND occ.occ_date = ${day}
         WHERE te.company_id = ${companyId} AND ${day} = ${date}::date
           AND EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)}) - (occ.occ_date + occ.start_time))) / 60 > ${sql.raw(String(Math.trunc(graceMinutes)))}) AS late_clock_ins,
      (SELECT COUNT(*)::int FROM noshow_alerts n WHERE n.company_id = ${companyId} AND n.shift_date = ${date}::date) AS missed,
      (SELECT COUNT(*)::int FROM noshow_alerts n WHERE n.company_id = ${companyId} AND n.shift_date = ${date}::date AND n.status = 'open') AS missed_open,
      (SELECT COUNT(*)::int FROM schedule_exceptions se WHERE se.company_id = ${companyId} AND se.exception_type = 'cancelled' AND se.exception_date = ${date}::date) AS cancelled,
      (SELECT COUNT(*)::int FROM schedule_exceptions se WHERE se.company_id = ${companyId} AND se.exception_type = 'cancelled' AND se.exception_date = ${date}::date AND se.cancel_reason = 'caregiver_callout') AS caregiver_callouts,
      (SELECT COUNT(*)::int FROM open_shifts os WHERE os.company_id = ${companyId} AND os.date >= ${date}::date AND os.status = 'open') AS open_shifts_unfilled,
      (SELECT COUNT(*)::int FROM incidents i WHERE i.company_id = ${companyId} AND i.date = ${date}::date) AS incidents,
      (SELECT COUNT(*)::int FROM applications a WHERE a.company_id = ${companyId} AND a.created_at::date = ${date}::date) AS new_applicants,
      (SELECT COUNT(*)::int FROM family_request fr WHERE fr.company_id = ${companyId} AND fr.status = 'open') AS family_requests_open,
      (SELECT COUNT(*)::int FROM time_entries te WHERE te.company_id = ${companyId} AND te.needs_approval = true AND te.approved_at IS NULL) AS punches_awaiting_approval,
      (SELECT COUNT(*)::int FROM authorizations a WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.end_date BETWEEN ${date}::date AND ${date}::date + 14) AS authorizations_ending_in_14_days,
      (SELECT COUNT(*)::int FROM certification_records cr JOIN "user" u ON u.id = cr.caregiver_id WHERE cr.company_id = ${companyId} AND u.is_active = true AND cr.expiry_date BETWEEN ${date}::date AND ${date}::date + 14) AS credentials_expiring_in_14_days`)
  return r[0] ?? {}
}

/** The visits of one day that were not clocked at all (scheduled, assigned, no clock-in), for the daily manager report's list. */
export async function dayUnclocked(q: Q, companyId: string, date: string, tz: string): Promise<any[]> {
  const day = localDate(sql`te.start_time`, tz)
  return all(q, sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id, occ.caregiver_id, occ.client_id, to_char(occ.occ_date + occ.start_time, 'HH24:MI') AS start, to_char(occ.occ_date + occ.end_time, 'HH24:MI') AS "end",
           u.first_name AS caregiver_first, u.last_name AS caregiver_last, c.first_name AS client_first, c.last_name AS client_last
      FROM occ LEFT JOIN "user" u ON u.id = occ.caregiver_id LEFT JOIN clients c ON c.id = occ.client_id
     WHERE NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.company_id = ${companyId} AND te.schedule_id = occ.schedule_id AND ${day} = occ.occ_date)
       AND (occ.occ_date + occ.end_time) < (${localTs(sql`now()`, tz)})
     ORDER BY occ.start_time`)
}

/** Billed and paid per month for the financial dashboard: released invoices by their first service day, payroll by pay period end. */
export async function moneyByMonth(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return all(q, sql`SELECT m.month,
      COALESCE((SELECT SUM(ROUND(i.total * 100)) FROM invoices i WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql('i')} AND to_char(i.billing_period_start, 'YYYY-MM') = m.month), 0)::bigint AS invoiced_cents,
      COALESCE((SELECT SUM(ROUND(i.amount_paid * 100)) FROM invoices i WHERE i.company_id = ${companyId} AND to_char(COALESCE(i.payment_date, i.billing_period_start), 'YYYY-MM') = m.month), 0)::bigint AS collected_cents,
      COALESCE((SELECT SUM(ROUND(p.gross_pay * 100)) FROM payroll_records p WHERE p.company_id = ${companyId} AND to_char(p.period_end, 'YYYY-MM') = m.month), 0)::bigint AS payroll_cents
    FROM (SELECT to_char(d, 'YYYY-MM') AS month FROM generate_series(date_trunc('month', ${start}::date), date_trunc('month', ${end}::date), '1 month') d) m ORDER BY m.month`)
}

/** Outstanding receivables now: invoices not paid, by age. */
export async function receivablesNow(q: Q, companyId: string, today: string) {
  const r = await all(q, sql`SELECT
      COALESCE(SUM(ROUND((i.total - COALESCE(i.amount_paid, 0)) * 100)) FILTER (WHERE i.payment_due_date IS NULL OR i.payment_due_date >= ${today}::date), 0)::bigint AS current_cents,
      COALESCE(SUM(ROUND((i.total - COALESCE(i.amount_paid, 0)) * 100)) FILTER (WHERE i.payment_due_date < ${today}::date AND i.payment_due_date >= ${today}::date - 30), 0)::bigint AS over_cents,
      COALESCE(SUM(ROUND((i.total - COALESCE(i.amount_paid, 0)) * 100)) FILTER (WHERE i.payment_due_date < ${today}::date - 30), 0)::bigint AS over30_cents,
      COUNT(*)::int AS open_invoices
    FROM invoices i WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql('i')} AND i.payment_status NOT IN ('paid', 'void', 'written_off') AND (i.total - COALESCE(i.amount_paid, 0)) > 0`)
  return r[0] ?? { currentCents: 0, overCents: 0, over30Cents: 0, openInvoices: 0 }
}
