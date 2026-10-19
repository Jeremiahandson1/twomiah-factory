// Home care's planning SQL: the dashboard, the reports and the three optimizers (route, schedule, roster). Moved from
// templates/crm-homecare/backend/src/routes/{dashboard,reports,optimizer,scheduleOptimizer,rosterOptimizer}.ts — raw SQL
// lives in server/data/ (RULEBOOK §2), one named function per query, every result camelCase.
//
// Two changes from the template, both for one reason — its database held ONE agency; the unified one holds the business
// as `company` with `company_id` on every home-care table:
//   · every query is the company's: each home-care table it reads is filtered on company_id (`companyId` comes first);
//   · `users` is `"user"`, `agencies` is `company`, and a caregiver is the role 'caregiver' (a moved tenant) or 'field'
//     (the unified rung, verticals/homecare/settings.ts roleMapping) — the template asked for role = 'caregiver'.
// The rules the template settled (scheduled hours off the schedule engine, delivered = payroll-reviewed minutes + punches
// no approved review covers, invoices counted whole by their first day of service, the agency's calendar day) are kept
// exactly; see each function.
import { sql, type SQL } from 'drizzle-orm'
import { camelRows, camelFirst } from '@twomiah/tenant-backend'
import { occurrencesCte, localDate, localTs, dayStartUtc, dayEndUtc, nowUtc, inList, wallClock, type Q } from './homecareCore.ts'
import { billedInRangeSql, invoiceBalanceSql, invoiceServiceDateSql, releasedInvoiceSql } from './homecareBilling.ts'

const all = async (q: Q, s: SQL): Promise<any[]> => camelRows(await q.execute(s))
const first = async (q: Q, s: SQL): Promise<any> => camelFirst(await q.execute(s)) || {}

/** A caregiver row of "user" (alias `a`): the template's role = 'caregiver', or the unified field rung. */
const isCaregiver = (a = 'u'): SQL => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error(`bad alias: ${a}`)
  return sql.raw(`${a}.role IN ('caregiver', 'field')`)
}

/** A whole number of minutes as a SQL literal (a bound parameter cannot take a unary minus). */
const minutesLiteral = (n: number): SQL => sql.raw(String(Math.trunc(Number(n) || 0)))

// ═══════════════════════════════ The agency ═══════════════════════════════════════════════════

/** The company's name and brand colour (the reports' letterhead). */
export async function companyBrand(q: Q, companyId: string): Promise<{ name: string | null; primaryColor: string | null }> {
  const r = await first(q, sql`SELECT name, primary_color FROM company WHERE id = ${companyId}`)
  return { name: r.name ?? null, primaryColor: r.primaryColor ?? null }
}

// ═══════════════════════════════ Shared fragments ═════════════════════════════════════════════

/**
 * Delivered work for a date range on the agency's calendar: payroll-reviewed shifts (verified / approved / manual_entry
 * — what actually gets paid, including staff who never clock in) PLUS clock entries no approved review covers.
 * `delivered(caregiver_id, client_id, work_date, mins)`.
 */
function deliveredCte(companyId: string, start: string, end: string, tz: string): SQL {
  return sql`delivered AS (
    SELECT psr.caregiver_id, psr.client_id, psr.shift_date AS work_date,
           psr.payable_minutes AS mins
    FROM payroll_shift_reviews psr
    WHERE psr.company_id = ${companyId}
      AND psr.status IN ('verified', 'approved', 'manual_entry')
      AND psr.payable_minutes > 0
      AND psr.shift_date BETWEEN (${start})::date AND (${end})::date
    UNION ALL
    SELECT te.caregiver_id, te.client_id,
           ${localDate(sql`te.start_time`, tz)},
           COALESCE(te.billable_minutes, te.duration_minutes)
    FROM time_entries te
    WHERE te.company_id = ${companyId}
      AND te.end_time IS NOT NULL
      AND te.start_time >= ${dayStartUtc(start, tz)}
      AND te.start_time <  ${dayEndUtc(end, tz)}
      AND NOT EXISTS (SELECT 1 FROM payroll_shift_reviews p2
                       WHERE p2.company_id = ${companyId} AND p2.time_entry_id = te.id
                         AND p2.status IN ('verified', 'approved', 'manual_entry'))
  )`
}

/** Clocked (worked) time: completed punches whose clock-in falls in the range, at their real clocked length. */
function clockedCte(companyId: string, start: string, end: string, tz: string): SQL {
  return sql`clocked AS (
    SELECT te.caregiver_id, te.client_id, ${localDate(sql`te.start_time`, tz)} AS work_date,
           COALESCE(te.duration_minutes, ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int) AS mins
    FROM time_entries te
    WHERE te.company_id = ${companyId}
      AND te.end_time IS NOT NULL
      AND te.start_time >= ${dayStartUtc(start, tz)}
      AND te.start_time <  ${dayEndUtc(end, tz)}
  )`
}

/**
 * A client's service type (alias `c`): the one set on the client, else their care plan's (the active plan, then the
 * newest), else 'unspecified'.
 */
const clientServiceTypeSql = (companyId: string): SQL => sql`COALESCE(NULLIF(c.service_type, ''), (SELECT cp.service_type FROM care_plans cp
    WHERE cp.company_id = ${companyId} AND cp.client_id = c.id AND NULLIF(cp.service_type, '') IS NOT NULL
    ORDER BY (cp.status = 'active') DESC, cp.updated_at DESC LIMIT 1), 'unspecified')`

/** The payer's hourly rate for a client on a date (a '15min' rate × 4). LATERAL fragment; `c` = clients. */
const payerRateLateral = (companyId: string, dateExpr: SQL): SQL => sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
    FROM referral_source_rates r
    WHERE r.company_id = ${companyId}
      AND r.referral_source_id = c.referred_by_id AND r.care_type_id = c.care_type_id
      AND r.is_active = true
      AND (r.effective_date IS NULL OR r.effective_date <= ${dateExpr})
      AND (r.end_date IS NULL OR r.end_date >= ${dateExpr})
    ORDER BY r.effective_date DESC NULLS LAST LIMIT 1
  ) prate ON true`

/** A performance rating's calendar day on the agency's clock. */
const ratedOn = (tz: string): SQL => localDate(sql`pr.created_at`, tz)

/**
 * The punch (`te`) that belongs to today's visit (`occ`): same caregiver and client, clocked in on the visit's agency
 * day, and linked to that visit's schedule when the punch names one. One rule for the live board and "Shifts Remaining".
 */
const punchForOcc = (companyId: string, tz: string): SQL => sql`te.company_id = ${companyId}
      AND te.caregiver_id = occ.caregiver_id
      AND te.client_id = occ.client_id
      AND ${localDate(sql`te.start_time`, tz)} = occ.occ_date
      AND (te.schedule_id IS NULL OR te.schedule_id = occ.schedule_id)`

// ═══════════════════════════════ Dashboard (routes/dashboard.ts) ══════════════════════════════

/** GET /stats: the office's tiles. `in30` = today + 30 days. "Today" is the agency's day. */
export async function dashboardStats(q: Q, companyId: string, today: string, in30: string, tz: string) {
  const startedToday = sql`te.start_time >= ${dayStartUtc(today, tz)} AND te.start_time < ${dayEndUtc(today, tz)}`
  return first(q, sql`SELECT
      (SELECT COUNT(*)::int FROM clients c WHERE c.company_id = ${companyId} AND c.is_active = true) AS active_clients,
      (SELECT COUNT(*)::int FROM "user" u WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true) AS active_caregivers,
      (SELECT COUNT(*)::int FROM open_shifts os WHERE os.company_id = ${companyId} AND os.status = 'open' AND os.date >= (${today})::date) AS open_shifts,
      (SELECT COUNT(*)::int FROM noshow_alerts na WHERE na.company_id = ${companyId} AND na.status = 'open') AS open_noshows,
      (SELECT COUNT(*)::int FROM client_onboarding co WHERE co.company_id = ${companyId} AND co.all_completed = false) AS incomplete_onboarding,
      -- Outstanding = released invoices' open balance; drafts are not owed yet.
      (SELECT COALESCE(SUM(${invoiceBalanceSql()}), 0) FROM invoices i
        WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005) AS outstanding_revenue,
      (SELECT COUNT(*)::int FROM authorizations a WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.end_date <= (${in30})::date) AS auths_expiring_soon,
      (SELECT COUNT(*)::int FROM time_entries te WHERE te.company_id = ${companyId} AND ${startedToday} AND te.is_complete = false) AS shifts_today,
      (SELECT COUNT(DISTINCT te.caregiver_id)::int FROM time_entries te
        WHERE te.company_id = ${companyId} AND ${startedToday} AND te.end_time IS NULL AND te.is_complete = false) AS caregivers_clocked_in`)
}

/** GET /recent-activity: the five newest active clients. */
export async function recentClients(q: Q, companyId: string) {
  return all(q, sql`SELECT c.id, c.first_name, c.last_name, c.service_type, c.created_at
    FROM clients c WHERE c.company_id = ${companyId} AND c.is_active = true ORDER BY c.created_at DESC LIMIT 5`)
}

/** GET /recent-activity: the eight newest punches, with the caregiver's and client's names (null when not on file). */
export async function recentTimeEntries(q: Q, companyId: string) {
  return all(q, sql`SELECT te.id, te.start_time, te.end_time, te.is_complete,
      u.id AS caregiver_found, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
      c.id AS client_found, c.first_name AS client_first_name, c.last_name AS client_last_name
    FROM time_entries te
    LEFT JOIN "user" u ON u.id = te.caregiver_id AND u.company_id = ${companyId}
    LEFT JOIN clients c ON c.id = te.client_id AND c.company_id = ${companyId}
    WHERE te.company_id = ${companyId}
    ORDER BY te.start_time DESC LIMIT 8`)
}

/** GET /recent-activity: the five newest invoices, with the client's name. */
export async function recentInvoices(q: Q, companyId: string) {
  return all(q, sql`SELECT i.id, i.invoice_number, i.total, i.payment_status, i.created_at,
      c.id AS client_found, c.first_name AS client_first_name, c.last_name AS client_last_name
    FROM invoices i LEFT JOIN clients c ON c.id = i.client_id AND c.company_id = ${companyId}
    WHERE i.company_id = ${companyId}
    ORDER BY i.created_at DESC LIMIT 5`)
}

/** GET /recent-activity: absences that need cover nobody has taken, newest first. */
export async function absencesNeedingCover(q: Q, companyId: string) {
  return all(q, sql`SELECT ab.id, ab.date, ab.type,
      u.id AS caregiver_found, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
    FROM absences ab LEFT JOIN "user" u ON u.id = ab.caregiver_id AND u.company_id = ${companyId}
    WHERE ab.company_id = ${companyId} AND ab.coverage_needed = true AND ab.coverage_assigned_to IS NULL
    ORDER BY ab.created_at DESC LIMIT 5`)
}

/** GET /alerts: open no-show alerts (newest ten), with names. */
export async function openNoshowAlerts(q: Q, companyId: string) {
  return all(q, sql`SELECT na.id, na.schedule_id, na.caregiver_id, na.client_id, na.shift_date, na.expected_start,
      na.alerted_at, na.resolved_at, na.resolved_by_id, na.resolution_note, na.status, na.sms_sent, na.created_at,
      u.id AS caregiver_found, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
      c.id AS client_found, c.first_name AS client_first_name, c.last_name AS client_last_name
    FROM noshow_alerts na
    LEFT JOIN "user" u ON u.id = na.caregiver_id AND u.company_id = ${companyId}
    LEFT JOIN clients c ON c.id = na.client_id AND c.company_id = ${companyId}
    WHERE na.company_id = ${companyId} AND na.status = 'open'
    ORDER BY na.created_at DESC LIMIT 10`)
}

/** GET /alerts: active authorizations ending on or before `until`, soonest first (ten), with the client's name. */
export async function authorizationsEndingBy(q: Q, companyId: string, until: string) {
  return all(q, sql`SELECT a.id, a.client_id, a.auth_number, a.procedure_code, a.authorized_units, a.used_units,
      a.start_date, a.end_date, a.status,
      c.id AS client_found, c.first_name AS client_first_name, c.last_name AS client_last_name
    FROM authorizations a LEFT JOIN clients c ON c.id = a.client_id AND c.company_id = ${companyId}
    WHERE a.company_id = ${companyId} AND a.status = 'active' AND a.end_date <= (${until})::date
    ORDER BY a.end_date ASC LIMIT 10`)
}

/** GET /alerts: active caregivers with certification expiry dates on file (ten). */
export async function caregiversWithCertificationExpiry(q: Q, companyId: string) {
  return all(q, sql`SELECT u.id, u.first_name, u.last_name, u.certifications, u.certifications_expiry
    FROM "user" u
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
      AND json_array_length(u.certifications_expiry::json) > 0
    LIMIT 10`)
}

/** GET /summary: the admin dashboard's tiles and "Today" panel, in one read. */
export async function dashboardSummary(q: Q, companyId: string, today: string, tz: string) {
  return first(q, sql`WITH ${occurrencesCte(companyId, today, today)}
    SELECT
      (SELECT COUNT(*)::int FROM clients c WHERE c.company_id = ${companyId} AND c.is_active = true) AS total_clients,
      (SELECT COUNT(*)::int FROM "user" u WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true) AS active_caregivers,
      -- Pending = RELEASED invoices with a balance still owed, at that balance; drafts are counted apart.
      (SELECT COUNT(*)::int FROM invoices i WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005) AS pending_count,
      (SELECT COALESCE(SUM(${invoiceBalanceSql()}), 0) FROM invoices i WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005) AS pending_amount,
      (SELECT COUNT(*)::int FROM invoices d WHERE d.company_id = ${companyId} AND NOT ${releasedInvoiceSql('d')}) AS draft_count,
      (SELECT COALESCE(SUM(d.total), 0) FROM invoices d WHERE d.company_id = ${companyId} AND NOT ${releasedInvoiceSql('d')}) AS draft_amount,
      -- Cash received this calendar month: the payments recorded, by payment date.
      (SELECT COALESCE(SUM(ip.amount), 0) FROM invoice_payments ip WHERE ip.company_id = ${companyId}
         AND ip.payment_date >= date_trunc('month', (${today})::date)
         AND ip.payment_date <  date_trunc('month', (${today})::date) + INTERVAL '1 month') AS this_month_revenue,
      -- Caregivers clocked in right now (an open entry started on the agency's today).
      (SELECT COUNT(DISTINCT te.caregiver_id)::int FROM time_entries te
        WHERE te.company_id = ${companyId} AND te.end_time IS NULL AND ${localDate(sql`te.start_time`, tz)} = (${today})::date) AS clocked_in_now,
      (SELECT COUNT(*)::int FROM occ) AS today_shifts,
      -- Today's shifts not started yet: no punch at all for that visit.
      (SELECT COUNT(*)::int FROM occ WHERE NOT EXISTS (SELECT 1 FROM time_entries te WHERE ${punchForOcc(companyId, tz)})) AS remaining_shifts,
      -- Call-outs still needing a caregiver: the list Emergency Coverage opens on (data/homecareClients.ts openCallOuts),
      -- so the dashboard's "Find Coverage" and that page agree. The template sent a fixed 0, so the alert never showed.
      (SELECT COUNT(*)::int FROM absences a WHERE a.company_id = ${companyId} AND a.type = 'call_out' AND a.coverage_needed = true
         AND a.coverage_assigned_to IS NULL AND a.date >= (${today})::date) AS coverage_gaps`)
}

/** GET /action-items: the office's to-do counts. */
export async function actionItemCounts(q: Q, companyId: string, today: string) {
  return first(q, sql`SELECT
      (SELECT COUNT(*)::int FROM time_entries WHERE company_id = ${companyId} AND needs_approval = true AND is_complete = true) AS pending_approvals,
      (SELECT COUNT(*)::int FROM open_shifts WHERE company_id = ${companyId} AND status = 'open' AND date >= (${today})::date AND date <= (${today})::date + 7) AS open_shifts,
      (SELECT COUNT(*)::int FROM authorizations WHERE company_id = ${companyId} AND status = 'active' AND (authorized_units - used_units) <= low_units_alert_threshold) AS low_auths,
      (SELECT COUNT(*)::int FROM authorizations WHERE company_id = ${companyId} AND status = 'active' AND end_date BETWEEN (${today})::date AND (${today})::date + 14) AS expiring_auths,
      (SELECT COUNT(*)::int FROM certification_records WHERE company_id = ${companyId} AND expiry_date BETWEEN (${today})::date AND (${today})::date + 30) AS expiring_certs,
      (SELECT COUNT(*)::int FROM time_entries WHERE company_id = ${companyId} AND is_complete = false AND start_time < ${nowUtc} - INTERVAL '24 hours') AS stuck_punches,
      (SELECT COUNT(*)::int FROM payroll_shift_reviews WHERE company_id = ${companyId} AND status IN ('pending', 'flagged', 'missing_punch') AND created_at > ${nowUtc} - INTERVAL '30 days') AS pending_payroll_reviews,
      -- Payer/MCO incident responses due within 3 days (or overdue) and not yet sent (GET /api/incidents/responses-due's rule).
      (SELECT COUNT(*)::int FROM incidents
        WHERE company_id = ${companyId} AND COALESCE(investigation_status, 'open') <> 'closed'
          AND response_due_date IS NOT NULL AND response_sent_date IS NULL
          AND response_due_date <= (${today})::date + 3) AS incident_responses_due`)
}

/** GET /referrals: client count and paid revenue per active referral source, aggregated separately. */
export async function referralSourceTotals(q: Q, companyId: string) {
  return all(q, sql`SELECT rs.name, rs.type,
      (SELECT COUNT(*) FROM clients c WHERE c.company_id = ${companyId} AND c.referred_by_id = rs.id)::int AS referral_count,
      COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                 JOIN clients c2 ON c2.id = i.client_id
                WHERE ip.company_id = ${companyId} AND i.company_id = ${companyId} AND c2.referred_by_id = rs.id), 0) AS total_revenue
    FROM referral_sources rs
    WHERE rs.company_id = ${companyId} AND rs.is_active = true
    ORDER BY referral_count DESC`)
}

/** GET /caregiver-hours: completed shifts, capped hours and average rating per active caregiver. */
export async function caregiverHoursAndRatings(q: Q, companyId: string) {
  return all(q, sql`SELECT u.id, u.first_name, u.last_name,
      COALESCE(te.shifts, 0)::int AS shifts,
      COALESCE(te.total_hours, 0) AS total_hours,
      COALESCE(pr.avg_satisfaction, 0) AS avg_satisfaction
    FROM "user" u
    LEFT JOIN (
      SELECT caregiver_id, COUNT(*) AS shifts,
             ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 1) AS total_hours
      FROM time_entries WHERE company_id = ${companyId} AND end_time IS NOT NULL GROUP BY caregiver_id
    ) te ON te.caregiver_id = u.id
    LEFT JOIN (
      SELECT caregiver_id, AVG(satisfaction_score) AS avg_satisfaction
      FROM performance_ratings WHERE company_id = ${companyId} GROUP BY caregiver_id
    ) pr ON pr.caregiver_id = u.id
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    ORDER BY total_hours DESC NULLS LAST`)
}

/** GET /live-board: every visit today with its live clock status, on the agency's clock. */
export async function liveBoardShifts(q: Q, companyId: string, today: string, tz: string) {
  const nowLocal = sql`(NOW() AT TIME ZONE ${tz})::time`
  return all(q, sql`WITH ${occurrencesCte(companyId, today, today)}
    SELECT
      occ.schedule_id, occ.caregiver_id, occ.client_id,
      to_char(occ.start_time, 'HH24:MI:SS') AS scheduled_start,
      to_char(occ.end_time, 'HH24:MI:SS') AS scheduled_end,
      u.first_name AS caregiver_first, u.last_name AS caregiver_last, u.phone AS caregiver_phone,
      u.latitude AS caregiver_lat, u.longitude AS caregiver_lng,
      c.first_name AS client_first, c.last_name AS client_last,
      c.address AS client_address, c.city AS client_city,
      c.latitude AS client_lat, c.longitude AS client_lng,
      te.id AS time_entry_id,
      to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_in_time,
      to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_out_time,
      te.clock_in_location, te.clock_out_location, te.duration_minutes,
      CASE
        WHEN te.end_time IS NOT NULL THEN 'completed'
        WHEN te.start_time IS NOT NULL AND te.end_time IS NULL THEN 'clocked_in'
        WHEN occ.start_time <= ${nowLocal} AND (${nowLocal} - occ.start_time) > INTERVAL '15 minutes' AND te.id IS NULL THEN 'late'
        WHEN occ.start_time <= ${nowLocal} AND te.id IS NULL THEN 'starting'
        ELSE 'upcoming'
      END AS shift_status,
      CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NULL
        THEN ROUND(EXTRACT(EPOCH FROM (${nowUtc} - te.start_time)) / 60) ELSE NULL END AS minutes_elapsed,
      (
        -- Last 20 GPS points, newest first (ORDER BY / LIMIT in an inner subquery: at the aggregate's level it is 42803).
        SELECT json_agg(pt) FROM (
          SELECT json_build_object('lat', gt.latitude, 'lng', gt.longitude, 'ts', to_char(gt.timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS pt
          FROM gps_tracking gt
          WHERE gt.company_id = ${companyId} AND gt.time_entry_id = te.id
          ORDER BY gt.timestamp DESC
          LIMIT 20
        ) recent
      ) AS gps_trail
    FROM occ
    JOIN "user" u  ON u.id = occ.caregiver_id AND u.company_id = ${companyId}
    JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    LEFT JOIN time_entries te ON ${punchForOcc(companyId, tz)}
    WHERE u.is_active = true
    ORDER BY occ.start_time ASC`)
}

/** GET /caregiver-patterns: absences by day of week and type since `since`. */
export async function absencesByWeekday(q: Q, companyId: string, caregiverId: string, since: string) {
  return all(q, sql`SELECT EXTRACT(DOW FROM date)::int AS day_of_week, type, COUNT(*)::int AS count
    FROM absences WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND date >= (${since})::date
    GROUP BY 1, 2 ORDER BY 1`)
}

/** GET /caregiver-patterns: no-shows by day of week since `since`. */
export async function noShowsByWeekday(q: Q, companyId: string, caregiverId: string, since: string) {
  return all(q, sql`SELECT EXTRACT(DOW FROM shift_date)::int AS day_of_week, COUNT(*)::int AS count
    FROM noshow_alerts WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND shift_date >= (${since})::date
    GROUP BY 1 ORDER BY 1`)
}

/** GET /caregiver-patterns: late clock-ins (more than `graceMinutes` after the scheduled start) by day of week. */
export async function lateArrivalsByWeekday(q: Q, companyId: string, caregiverId: string, since: string, tz: string, graceMinutes: number) {
  const teDay = localDate(sql`te.start_time`, tz)
  return all(q, sql`SELECT dow AS day_of_week, COUNT(*)::int AS count, ROUND(AVG(mins_late))::int AS avg_minutes_late FROM (
      SELECT EXTRACT(DOW FROM ${teDay})::int AS dow,
             EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)})::time - s.start_time::time)) / 60 AS mins_late
      FROM time_entries te JOIN schedules s ON te.schedule_id = s.id AND s.company_id = ${companyId}
      WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.is_complete = true AND ${teDay} >= (${since})::date
    ) t WHERE mins_late > ${minutesLiteral(graceMinutes)}
    GROUP BY 1 ORDER BY 1`)
}

/** GET /caregiver-patterns: completed shifts by day of week. */
export async function completedShiftsByWeekday(q: Q, companyId: string, caregiverId: string, since: string, tz: string) {
  const teDay = localDate(sql`te.start_time`, tz)
  return all(q, sql`SELECT dow AS day_of_week, COUNT(*)::int AS count FROM (
      SELECT EXTRACT(DOW FROM ${teDay})::int AS dow
      FROM time_entries te
      WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverId} AND te.is_complete = true AND ${teDay} >= (${since})::date
    ) t GROUP BY 1 ORDER BY 1`)
}

// ═══════════════════════════════ Reports (routes/reports.ts) ══════════════════════════════════

export type ReportFilter = { caregiverId: string | null; clientId: string | null }

const occFilter = (f: ReportFilter): SQL =>
  sql`${f.caregiverId ? sql` AND occ.caregiver_id = ${f.caregiverId}` : sql``}${f.clientId ? sql` AND occ.client_id = ${f.clientId}` : sql``}`

/** Overview: scheduled hours and visits (the engine's occurrences). */
export async function scheduledSummary(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return first(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT COALESCE(SUM(occ.hours), 0) AS total_hours, COUNT(*)::int AS total_shifts
    FROM occ WHERE 1=1 ${occFilter(f)}`)
}

/** Overview: payable (delivered) hours. */
export async function payableHours(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return first(q, sql`WITH ${deliveredCte(companyId, start, end, tz)}
    SELECT COALESCE(SUM(mins), 0) / 60.0 AS payable FROM delivered
    WHERE (${f.caregiverId}::text IS NULL OR caregiver_id = ${f.caregiverId})
      AND (${f.clientId}::text IS NULL OR client_id = ${f.clientId})`)
}

/** Overview: clocked (worked) hours. */
export async function clockedHours(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return first(q, sql`WITH ${clockedCte(companyId, start, end, tz)}
    SELECT COALESCE(SUM(mins), 0) / 60.0 AS clocked FROM clocked
    WHERE (${f.caregiverId}::text IS NULL OR caregiver_id = ${f.caregiverId})
      AND (${f.clientId}::text IS NULL OR client_id = ${f.clientId})`)
}

/** Overview: the average satisfaction of ratings given in the range (the agency's calendar). */
export async function averageSatisfaction(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return first(q, sql`SELECT COALESCE(AVG(pr.satisfaction_score), 0) AS avg_satisfaction
    FROM performance_ratings pr
    WHERE pr.company_id = ${companyId} AND ${ratedOn(tz)} BETWEEN (${start})::date AND (${end})::date
      ${f.caregiverId ? sql`AND pr.caregiver_id = ${f.caregiverId}` : sql``} ${f.clientId ? sql`AND pr.client_id = ${f.clientId}` : sql``}`)
}

/** Overview: revenue billed in the period — released invoices (whole, by first day of service) + claims. */
export async function billedRevenue(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return first(q, sql`SELECT COALESCE(SUM(billed), 0) AS total_revenue FROM (
      SELECT i.total AS billed FROM invoices i
      WHERE i.company_id = ${companyId} AND ${billedInRangeSql(start, end)}
        AND (${clientId}::text IS NULL OR i.client_id = ${clientId})
      UNION ALL
      SELECT cl.billed_amount FROM claims cl
      WHERE cl.company_id = ${companyId} AND cl.service_date BETWEEN (${start})::date AND (${end})::date
        AND COALESCE(cl.status, '') <> 'voided' AND cl.invoice_id IS NULL
        AND (${clientId}::text IS NULL OR cl.client_id = ${clientId})
    ) u`)
}

/** Overview: top caregivers by SCHEDULED hours, with their labour COST (hours × pay rate). */
export async function topCaregivers(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT u.id, u.first_name, u.last_name,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id AND (${f.clientId}::text IS NULL OR o.client_id = ${f.clientId})), 0) AS total_hours,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id AND (${f.clientId}::text IS NULL OR o.client_id = ${f.clientId})), 0) * COALESCE(u.default_pay_rate, 0) AS est_labor_cost,
      COALESCE(AVG(pr.satisfaction_score), 0) AS avg_satisfaction,
      COALESCE((SELECT COUNT(DISTINCT o.client_id) FROM occ o WHERE o.caregiver_id = u.id AND (${f.clientId}::text IS NULL OR o.client_id = ${f.clientId})), 0)::int AS clients_served
    FROM "user" u
    LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id AND pr.company_id = ${companyId}
      AND ${ratedOn(tz)} BETWEEN (${start})::date AND (${end})::date
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
      AND (${f.caregiverId}::text IS NULL OR u.id = ${f.caregiverId})
    GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
    ORDER BY total_hours DESC
    LIMIT 10`)
}

/** Overview: top clients by scheduled hours, with their real billed revenue. */
export async function topClients(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT c.id, c.first_name, c.last_name, ${clientServiceTypeSql(companyId)} AS service_type,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.client_id = c.id AND (${f.caregiverId}::text IS NULL OR o.caregiver_id = ${f.caregiverId})), 0) AS total_hours,
      COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.company_id = ${companyId} AND i.client_id = c.id
                AND ${billedInRangeSql(start, end)}), 0) AS revenue,
      COALESCE((SELECT COUNT(DISTINCT o.caregiver_id) FROM occ o WHERE o.client_id = c.id AND (${f.caregiverId}::text IS NULL OR o.caregiver_id = ${f.caregiverId})), 0)::int AS caregiver_count
    FROM clients c
    WHERE c.company_id = ${companyId} AND c.is_active = true
      AND (${f.clientId}::text IS NULL OR c.id = ${f.clientId})
    ORDER BY total_hours DESC
    LIMIT 10`)
}

/** Hours: scheduled hours by week. */
export async function scheduledHoursByWeek(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT to_char(DATE_TRUNC('week', occ.occ_date), 'YYYY-MM-DD') AS week_start, COALESCE(SUM(occ.hours), 0) AS hours
    FROM occ WHERE 1=1 ${occFilter(f)}
    GROUP BY 1 ORDER BY 1`)
}

/** Hours: scheduled hours by the client's service type. */
export async function scheduledHoursByServiceType(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT ${clientServiceTypeSql(companyId)} AS service_type, COALESCE(SUM(occ.hours), 0) AS hours
    FROM occ JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    WHERE 1=1 ${occFilter(f)}
    GROUP BY 1 ORDER BY 2 DESC`)
}

/** Hours: scheduled hours per caregiver. */
export async function scheduledHoursByCaregiver(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT u.id, u.first_name, u.last_name,
      COALESCE(SUM(occ.hours), 0) AS total_hours,
      COUNT(DISTINCT occ.client_id)::int AS client_count,
      COALESCE(AVG(occ.hours), 0) AS avg_shift_hours
    FROM "user" u JOIN occ ON occ.caregiver_id = u.id
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true ${occFilter(f)}
    GROUP BY u.id, u.first_name, u.last_name
    HAVING SUM(occ.hours) > 0
    ORDER BY total_hours DESC`)
}

/** Hours / performance: payable and worked hours per caregiver (filtered by caregiver and client when given). */
export async function payableAndWorkedByCaregiver(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return all(q, sql`WITH ${deliveredCte(companyId, start, end, tz)}, ${clockedCte(companyId, start, end, tz)}
    SELECT x.caregiver_id, ROUND(SUM(x.pay) / 60.0, 2) AS payable_hours, ROUND(SUM(x.clk) / 60.0, 2) AS worked_hours
    FROM (SELECT caregiver_id, client_id, mins AS pay, 0 AS clk FROM delivered
          UNION ALL SELECT caregiver_id, client_id, 0, mins FROM clocked) x
    WHERE (${f.caregiverId}::text IS NULL OR x.caregiver_id = ${f.caregiverId})
      AND (${f.clientId}::text IS NULL OR x.client_id = ${f.clientId})
    GROUP BY x.caregiver_id`)
}

/** Performance: ratings, scheduled hours, clients served and incidents reported per active caregiver. */
export async function caregiverPerformance(q: Q, companyId: string, start: string, end: string, tz: string, caregiverId: string | null) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT u.id, u.first_name, u.last_name,
      COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating,
      COUNT(DISTINCT pr.id)::int AS rating_count,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id), 0) AS total_hours,
      COALESCE((SELECT COUNT(DISTINCT o.client_id) FROM occ o WHERE o.caregiver_id = u.id), 0)::int AS clients_served,
      COALESCE((SELECT COUNT(*) FROM incidents i WHERE i.company_id = ${companyId} AND i.reported_by_id = u.id
                 AND i.date BETWEEN (${start})::date AND (${end})::date), 0)::int AS incident_count
    FROM "user" u
    LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id AND pr.company_id = ${companyId}
      AND ${ratedOn(tz)} BETWEEN (${start})::date AND (${end})::date
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
      AND (${caregiverId}::text IS NULL OR u.id = ${caregiverId})
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY avg_rating DESC, total_hours DESC`)
}

/** Performance: how many ratings of each score. */
export async function ratingDistribution(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT pr.satisfaction_score AS rating, COUNT(*)::int AS count
    FROM performance_ratings pr
    WHERE pr.company_id = ${companyId} AND ${ratedOn(tz)} BETWEEN (${start})::date AND (${end})::date
    GROUP BY 1 ORDER BY 1 DESC`)
}

/**
 * Performance: punctuality — each completed punch's clock-in on the agency clock against the scheduled start of the
 * visit it matched (that day's occurrence of its schedule, overrides included). On time = within the grace EITHER side;
 * a punch matched to no visit is unscheduled.
 */
export async function punctualityByCaregiver(q: Q, companyId: string, start: string, end: string, tz: string, graceMinutes: number) {
  const grace = minutesLiteral(graceMinutes)
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)},
    p AS (
      SELECT te.caregiver_id,
             EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)}) - (o.occ_date + o.start_time))) / 60.0 AS off_min
        FROM time_entries te
        LEFT JOIN LATERAL (
          SELECT occ.occ_date, occ.start_time FROM occ
           WHERE occ.schedule_id = te.schedule_id AND occ.occ_date = ${localDate(sql`te.start_time`, tz)}
           ORDER BY ABS(EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)}) - (occ.occ_date + occ.start_time))))
           LIMIT 1) o ON true
       WHERE te.company_id = ${companyId}
         AND te.end_time IS NOT NULL
         AND te.start_time >= ${dayStartUtc(start, tz)}
         AND te.start_time < ${dayEndUtc(end, tz)}
    )
    SELECT u.id, u.first_name, u.last_name,
      COUNT(*)::int AS total_shifts,
      COUNT(*) FILTER (WHERE p.off_min IS NOT NULL AND ABS(p.off_min) <= ${grace})::int AS on_time_count,
      COUNT(*) FILTER (WHERE p.off_min < -${grace})::int AS early_count,
      COUNT(*) FILTER (WHERE p.off_min > ${grace})::int AS late_count,
      COUNT(*) FILTER (WHERE p.off_min IS NULL)::int AS unscheduled_count
    FROM "user" u JOIN p ON p.caregiver_id = u.id
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY 5 DESC`)
}

/** Performance: the share of each caregiver's completed punches that captured a clock-in location. */
export async function gpsCaptureByCaregiver(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT te.caregiver_id,
      ROUND(100.0 * COUNT(te.clock_in_location) / COUNT(*), 0) AS gps_capture_pct
    FROM time_entries te
    WHERE te.company_id = ${companyId}
      AND te.end_time IS NOT NULL
      AND te.start_time >= ${dayStartUtc(start, tz)}
      AND te.start_time < ${dayEndUtc(end, tz)}
    GROUP BY te.caregiver_id`)
}

const ratingsInRange = (companyId: string, start: string, end: string, tz: string): SQL =>
  sql`pr.company_id = ${companyId} AND ${ratedOn(tz)} BETWEEN (${start})::date AND (${end})::date`

/** Satisfaction: the overall average and the positive / neutral / negative counts. */
export async function satisfactionOverall(q: Q, companyId: string, start: string, end: string, tz: string, caregiverId: string | null) {
  return first(q, sql`SELECT COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating,
      COUNT(pr.id)::int AS total_ratings,
      COUNT(CASE WHEN pr.satisfaction_score >= 4 THEN 1 END)::int AS positive_count,
      COUNT(CASE WHEN pr.satisfaction_score = 3 THEN 1 END)::int AS neutral_count,
      COUNT(CASE WHEN pr.satisfaction_score < 3 THEN 1 END)::int AS negative_count
    FROM performance_ratings pr
    WHERE ${ratingsInRange(companyId, start, end, tz)} ${caregiverId ? sql`AND pr.caregiver_id = ${caregiverId}` : sql``}`)
}

/** Satisfaction: the weekly trend (the agency's weeks). */
export async function satisfactionTrend(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT to_char(DATE_TRUNC('week', ${localTs(sql`pr.created_at`, tz)}), 'YYYY-MM-DD') AS week_start,
      COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(*)::int AS count
    FROM performance_ratings pr
    WHERE ${ratingsInRange(companyId, start, end, tz)}
    GROUP BY 1 ORDER BY 1`)
}

/** Satisfaction: the average per active client who was rated. */
export async function satisfactionByClient(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT c.id, c.first_name, c.last_name,
      COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(pr.id)::int AS rating_count
    FROM clients c
    LEFT JOIN performance_ratings pr ON pr.client_id = c.id AND ${ratingsInRange(companyId, start, end, tz)}
    WHERE c.company_id = ${companyId} AND c.is_active = true
    GROUP BY c.id, c.first_name, c.last_name
    HAVING COUNT(pr.id) > 0
    ORDER BY avg_rating DESC`)
}

/** Satisfaction: the themes the comments speak of (six). */
export async function satisfactionThemes(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT
      CASE
        WHEN LOWER(pr.comments) LIKE '%excellent%' OR LOWER(pr.comments) LIKE '%great%' OR LOWER(pr.comments) LIKE '%amazing%' THEN 'Excellent Service'
        WHEN LOWER(pr.comments) LIKE '%punctual%' OR LOWER(pr.comments) LIKE '%on time%' THEN 'Punctuality'
        WHEN LOWER(pr.comments) LIKE '%friendly%' OR LOWER(pr.comments) LIKE '%kind%' OR LOWER(pr.comments) LIKE '%caring%' THEN 'Friendly & Caring'
        WHEN LOWER(pr.comments) LIKE '%professional%' THEN 'Professionalism'
        WHEN LOWER(pr.comments) LIKE '%late%' OR LOWER(pr.comments) LIKE '%missed%' THEN 'Timeliness Issues'
        WHEN LOWER(pr.comments) LIKE '%communication%' THEN 'Communication'
        ELSE 'General Feedback'
      END AS theme,
      COUNT(*)::int AS count
    FROM performance_ratings pr
    WHERE ${ratingsInRange(companyId, start, end, tz)} AND pr.comments IS NOT NULL AND pr.comments <> ''
    GROUP BY 1 ORDER BY 2 DESC
    LIMIT 6`)
}

// Revenue: two billing tracks — private pay by released INVOICES (dated by their first day of service, counted whole),
// payers by CLAIMS (billed_amount, paid_amount, by service date). A claim made FROM an invoice bills the invoice's money,
// so it is left out wherever invoices count.
const invoicesIn = (companyId: string, start: string, end: string, clientId: string | null): SQL =>
  sql`i.company_id = ${companyId} AND ${billedInRangeSql(start, end)} ${clientId ? sql`AND i.client_id = ${clientId}` : sql``}`
const claimsIn = (companyId: string, start: string, end: string, clientId: string | null): SQL =>
  sql`cl.company_id = ${companyId} AND cl.service_date BETWEEN (${start})::date AND (${end})::date AND COALESCE(cl.status, '') <> 'voided' AND cl.invoice_id IS NULL ${clientId ? sql`AND cl.client_id = ${clientId}` : sql``}`

/** Revenue: the invoices' billed, collected and outstanding (net of adjustments) totals. */
export async function invoiceRevenueTotals(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return first(q, sql`SELECT COALESCE(SUM(i.total), 0) AS total, COALESCE(SUM(i.amount_paid), 0) AS collected,
      COALESCE(SUM(i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)), 0) AS outstanding,
      COUNT(i.id)::int AS invoice_count
    FROM invoices i WHERE ${invoicesIn(companyId, start, end, clientId)}`)
}

/** Revenue: the claims' billed, collected and outstanding totals. */
export async function claimRevenueTotals(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return first(q, sql`SELECT COALESCE(SUM(cl.billed_amount), 0) AS total, COALESCE(SUM(cl.paid_amount), 0) AS collected,
      COALESCE(SUM(COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)), 0) AS outstanding,
      COUNT(cl.id)::int AS claim_count
    FROM claims cl WHERE ${claimsIn(companyId, start, end, clientId)}`)
}

/** Revenue: billed and collected by the client's service type. */
export async function revenueByServiceType(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return all(q, sql`SELECT service_type, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(collected), 0) AS collected FROM (
      SELECT ${clientServiceTypeSql(companyId)} AS service_type, i.total AS revenue, COALESCE(i.amount_paid, 0) AS collected
      FROM invoices i JOIN clients c ON c.id = i.client_id AND c.company_id = ${companyId} WHERE ${invoicesIn(companyId, start, end, clientId)}
      UNION ALL
      SELECT ${clientServiceTypeSql(companyId)}, cl.billed_amount, COALESCE(cl.paid_amount, 0)
      FROM claims cl JOIN clients c ON c.id = cl.client_id AND c.company_id = ${companyId} WHERE ${claimsIn(companyId, start, end, clientId)}
    ) u GROUP BY service_type ORDER BY revenue DESC`)
}

/** Revenue: billed, collected and outstanding by payer. */
export async function revenueByPayer(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return all(q, sql`SELECT payer, COALESCE(SUM(billed), 0) AS billed, COALESCE(SUM(collected), 0) AS collected,
      COALESCE(SUM(billed - collected - adjusted), 0) AS outstanding FROM (
      SELECT COALESCE(rs.name, CASE WHEN c.is_private_pay THEN 'Private Pay' ELSE 'Unknown' END) AS payer,
        i.total AS billed, COALESCE(i.amount_paid, 0) AS collected, COALESCE(i.amount_adjusted, 0) AS adjusted
      FROM invoices i JOIN clients c ON c.id = i.client_id AND c.company_id = ${companyId}
      LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id AND rs.company_id = ${companyId}
      WHERE ${invoicesIn(companyId, start, end, clientId)}
      UNION ALL
      SELECT COALESCE(rs.name, 'Unknown Payer'), cl.billed_amount, COALESCE(cl.paid_amount, 0), 0
      FROM claims cl LEFT JOIN referral_sources rs ON rs.id = cl.payer_id AND rs.company_id = ${companyId}
      WHERE ${claimsIn(companyId, start, end, clientId)}
    ) u GROUP BY payer ORDER BY billed DESC`)
}

/**
 * Revenue: A/R aging — a CURRENT snapshot of unpaid balances by days past due, as of the agency's today (released
 * invoices + unpaid claims; a claim is due its submission or service date + the payer's expected_pay_days).
 */
export async function receivablesAging(q: Q, companyId: string, today: string, clientId: string | null) {
  return first(q, sql`SELECT
      COALESCE(SUM(bal) FILTER (WHERE due >= (${today})::date), 0) AS current_not_due,
      COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 1 AND 30), 0) AS d1_30,
      COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 31 AND 60), 0) AS d31_60,
      COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 61 AND 90), 0) AS d61_90,
      COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due > 90), 0) AS d90_plus,
      COALESCE(SUM(bal), 0) AS total_outstanding
    FROM (
      SELECT ${invoiceBalanceSql()} AS bal,
             COALESCE(i.payment_due_date, i.billing_period_end + 30) AS due
      FROM invoices i
      WHERE i.company_id = ${companyId} AND ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005
        ${clientId ? sql`AND i.client_id = ${clientId}` : sql``}
      UNION ALL
      SELECT (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)),
             (COALESCE(cl.submission_date, cl.service_date) + COALESCE(rs.expected_pay_days, 30))
      FROM claims cl LEFT JOIN referral_sources rs ON rs.id = cl.payer_id AND rs.company_id = ${companyId}
      WHERE cl.company_id = ${companyId} AND (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)) > 0.005
        AND COALESCE(cl.status, '') NOT IN ('voided', 'draft') AND cl.invoice_id IS NULL
        ${clientId ? sql`AND cl.client_id = ${clientId}` : sql``}
    ) t`)
}

/** Revenue: the fifteen clients with the most billed, with what they still owe. */
export async function revenueByClient(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return all(q, sql`SELECT id, first_name, last_name, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(outstanding), 0) AS outstanding FROM (
      SELECT c.id, c.first_name, c.last_name, i.total AS revenue,
        (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) AS outstanding
      FROM clients c JOIN invoices i ON i.client_id = c.id AND ${invoicesIn(companyId, start, end, null)}
      WHERE c.company_id = ${companyId} AND (${clientId}::text IS NULL OR c.id = ${clientId})
      UNION ALL
      SELECT c.id, c.first_name, c.last_name, cl.billed_amount,
        (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0))
      FROM clients c JOIN claims cl ON cl.client_id = c.id AND ${claimsIn(companyId, start, end, null)}
      WHERE c.company_id = ${companyId} AND (${clientId}::text IS NULL OR c.id = ${clientId})
    ) u GROUP BY id, first_name, last_name HAVING SUM(revenue) > 0 ORDER BY revenue DESC LIMIT 15`)
}

/** P&L: billed and collected (released invoices + claims). */
export async function pnlRevenue(q: Q, companyId: string, start: string, end: string) {
  return first(q, sql`SELECT COALESCE(SUM(billed), 0) AS total_billed, COALESCE(SUM(collected), 0) AS total_collected,
      COALESCE(SUM(billed) - SUM(collected), 0) AS outstanding FROM (
      SELECT i.total AS billed, COALESCE(i.amount_paid, 0) AS collected
      FROM invoices i WHERE ${invoicesIn(companyId, start, end, null)}
      UNION ALL
      SELECT COALESCE(cl.billed_amount, 0), COALESCE(cl.paid_amount, 0)
      FROM claims cl WHERE ${claimsIn(companyId, start, end, null)}
    ) u`)
}

/** P&L: billed and collected by payer. */
export async function pnlRevenueByPayer(q: Q, companyId: string, start: string, end: string) {
  return all(q, sql`SELECT payer_name, SUM(cnt)::int AS invoice_count, COALESCE(SUM(billed), 0) AS billed, COALESCE(SUM(collected), 0) AS collected FROM (
      SELECT COALESCE(rs.name, 'Private Pay') AS payer_name, 1 AS cnt,
        i.total AS billed, COALESCE(i.amount_paid, 0) AS collected
      FROM invoices i
      LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id AND rs.company_id = ${companyId}
      WHERE ${invoicesIn(companyId, start, end, null)}
      UNION ALL
      SELECT COALESCE(rs.name, 'Unknown Payer'), 1, cl.billed_amount, COALESCE(cl.paid_amount, 0)
      FROM claims cl LEFT JOIN referral_sources rs ON cl.payer_id = rs.id AND rs.company_id = ${companyId}
      WHERE ${claimsIn(companyId, start, end, null)}
    ) u GROUP BY payer_name ORDER BY billed DESC`)
}

/** P&L: expenses by category, by expense date. */
export async function expensesByCategory(q: Q, companyId: string, start: string, end: string) {
  return all(q, sql`SELECT category, COALESCE(SUM(amount), 0) AS category_total
    FROM expenses WHERE company_id = ${companyId} AND date >= (${start})::date AND date <= (${end})::date
    GROUP BY category ORDER BY category_total DESC`)
}

/**
 * P&L: delivered hours, gross payroll (delivered minutes × pay rate, $15/h when none is on file) and earned revenue at
 * each client's rate (the private-pay rate, or the payer's rate effective on the day); hours with no rate are unvalued.
 */
export async function deliveredMoney(q: Q, companyId: string, start: string, end: string, tz: string) {
  return first(q, sql`WITH ${deliveredCte(companyId, start, end, tz)}
    SELECT
      COALESCE(SUM(d.mins), 0) / 60.0 AS delivered_hours,
      COALESCE(SUM(d.mins / 60.0 * COALESCE(u.default_pay_rate, 15)), 0) AS gross_payroll,
      COALESCE(SUM(d.mins) FILTER (WHERE c.is_private_pay), 0) / 60.0 AS pp_hours,
      COALESCE(SUM(d.mins / 60.0 * c.private_pay_rate) FILTER (WHERE c.is_private_pay AND c.private_pay_rate IS NOT NULL), 0) AS pp_earned,
      COALESCE(SUM(d.mins) FILTER (WHERE NOT COALESCE(c.is_private_pay, false) AND prate.hourly IS NOT NULL), 0) / 60.0 AS payer_hours,
      COALESCE(SUM(d.mins / 60.0 * prate.hourly) FILTER (WHERE NOT COALESCE(c.is_private_pay, false) AND prate.hourly IS NOT NULL), 0) AS payer_earned,
      COALESCE(SUM(d.mins) FILTER (WHERE c.id IS NULL
        OR (c.is_private_pay AND c.private_pay_rate IS NULL)
        OR (NOT COALESCE(c.is_private_pay, false) AND prate.hourly IS NULL)), 0) / 60.0 AS unvalued_hours
    FROM delivered d
    LEFT JOIN "user" u ON u.id = d.caregiver_id AND u.company_id = ${companyId}
    LEFT JOIN clients c ON c.id = d.client_id AND c.company_id = ${companyId}
    ${payerRateLateral(companyId, sql`d.work_date`)}`)
}

/** Caregiver productivity: scheduled visits, hours and pay per active caregiver. */
export async function caregiverProductivity(q: Q, companyId: string, start: string, end: string) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT u.id, u.first_name, u.last_name,
      COUNT(occ.schedule_id)::int AS visit_count,
      COUNT(DISTINCT occ.client_id)::int AS client_count,
      COALESCE(SUM(occ.hours), 0) AS total_hours,
      COALESCE(AVG(occ.hours), 0) AS avg_hours_per_visit,
      u.default_pay_rate AS hourly_rate,
      COALESCE(SUM(occ.hours), 0) * COALESCE(u.default_pay_rate, 0) AS total_pay
    FROM "user" u
    LEFT JOIN occ ON occ.caregiver_id = u.id
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
    ORDER BY total_hours DESC`)
}

/** Hours by payer: clocked and billable hours per referral source, on the agency's days. */
export async function hoursByPayer(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`WITH labeled AS (
      SELECT
        COALESCE(rs.id::text, CASE WHEN c.is_private_pay THEN 'private' ELSE 'unknown' END) AS payer_key,
        COALESCE(rs.name, CASE WHEN c.is_private_pay THEN 'Private Pay' ELSE 'Unknown' END) AS payer_name,
        COALESCE(rs.payer_type, CASE WHEN c.is_private_pay THEN 'private_pay' ELSE 'unknown' END) AS payer_type,
        c.id AS client_id, te.id AS te_id, te.duration_minutes, te.billable_minutes,
        ${localDate(sql`te.start_time`, tz)} AS work_day
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id AND c.company_id = ${companyId}
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id AND rs.company_id = ${companyId}
      WHERE te.company_id = ${companyId}
        AND te.is_complete = true
        AND te.start_time >= ${dayStartUtc(start, tz)}
        AND te.start_time <  ${dayEndUtc(end, tz)}
    )
    SELECT payer_key, payer_name, payer_type,
      COUNT(DISTINCT client_id)::int AS active_clients,
      COUNT(te_id)::int AS visits,
      ROUND(SUM(duration_minutes) / 60.0, 2) AS total_hours,
      ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS billable_hours,
      ROUND(AVG(duration_minutes) / 60.0, 2) AS avg_visit_hours,
      to_char(MIN(work_day), 'YYYY-MM-DD') AS first_visit,
      to_char(MAX(work_day), 'YYYY-MM-DD') AS last_visit
    FROM labeled
    GROUP BY payer_key, payer_name, payer_type
    ORDER BY billable_hours DESC NULLS LAST`)
}

/** Caregiver utilization: billable hours vs capacity (max hours a week × the weeks in the period). */
export async function caregiverUtilization(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`WITH actuals AS (
      SELECT caregiver_id,
        ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS actual_hours,
        COUNT(*)::int AS visits
      FROM time_entries
      WHERE company_id = ${companyId}
        AND is_complete = true
        AND start_time >= ${dayStartUtc(start, tz)}
        AND start_time <  ${dayEndUtc(end, tz)}
      GROUP BY caregiver_id
    ),
    weeks AS (
      SELECT GREATEST(((${end})::date - (${start})::date + 1)::numeric / 7, 0.1) AS n
    )
    SELECT u.id, u.first_name, u.last_name, u.is_active,
      COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week,
      ROUND((SELECT n FROM weeks), 2) AS weeks_in_period,
      ROUND(COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks), 1) AS capacity_hours,
      COALESCE(a.actual_hours, 0) AS actual_hours,
      COALESCE(a.visits, 0) AS visits,
      CASE WHEN COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks) > 0
        THEN ROUND(COALESCE(a.actual_hours, 0) / (COALESCE(ca.max_hours_per_week, 40) * (SELECT n FROM weeks)) * 100, 1)
        ELSE 0 END AS utilization_pct
    FROM "user" u
    LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id AND ca.company_id = ${companyId}
    LEFT JOIN actuals a ON a.caregiver_id = u.id
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    ORDER BY utilization_pct DESC NULLS LAST, u.last_name`)
}

/** Client incident history: incidents rolled up per client over a range. */
export async function incidentsByClient(q: Q, companyId: string, start: string, end: string, clientId: string | null) {
  return all(q, sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      COUNT(*)::int AS incident_count,
      COUNT(*) FILTER (WHERE ir.severity = 'critical')::int AS critical_count,
      COUNT(*) FILTER (WHERE ir.severity = 'severe')::int AS severe_count,
      COUNT(*) FILTER (WHERE ir.severity = 'moderate')::int AS moderate_count,
      COUNT(*) FILTER (WHERE ir.severity = 'minor')::int AS minor_count,
      COUNT(*) FILTER (WHERE ir.follow_up_required = true)::int AS followup_count,
      to_char(MIN(ir.date), 'YYYY-MM-DD') AS earliest,
      to_char(MAX(ir.date), 'YYYY-MM-DD') AS latest
    FROM incidents ir
    JOIN clients c ON ir.client_id = c.id AND c.company_id = ${companyId}
    WHERE ir.company_id = ${companyId} AND ir.date BETWEEN (${start})::date AND (${end})::date
      ${clientId ? sql`AND ir.client_id = ${clientId}` : sql``}
    GROUP BY c.id, c.first_name, c.last_name
    ORDER BY incident_count DESC`)
}

/** Client revenue by month: per-client released-invoice totals by the month of their first day of service. */
export async function clientRevenueByMonth(q: Q, companyId: string, start: string, end: string, today: string) {
  return all(q, sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      TO_CHAR(date_trunc('month', ${invoiceServiceDateSql()}), 'YYYY-MM') AS month,
      COUNT(i.id)::int AS invoice_count,
      ROUND(SUM(i.total)::numeric, 2) AS total_billed,
      ROUND(SUM(COALESCE(i.amount_paid, 0))::numeric, 2) AS total_paid,
      ROUND(SUM(${invoiceBalanceSql()})::numeric, 2) AS outstanding,
      COUNT(*) FILTER (WHERE i.payment_status = 'paid')::int AS paid_count,
      COUNT(*) FILTER (WHERE i.payment_status = 'pending' AND i.payment_due_date < (${today})::date)::int AS overdue_count,
      to_char(MAX(i.billing_period_end), 'YYYY-MM-DD') AS last_billed
    FROM invoices i
    JOIN clients c ON i.client_id = c.id AND c.company_id = ${companyId}
    WHERE i.company_id = ${companyId} AND ${billedInRangeSql(start, end)}
    GROUP BY c.id, c.first_name, c.last_name, 4
    ORDER BY month DESC, total_billed DESC`)
}

/** Client visits summary: per-client completed punches and hours (invoice prep), on the agency's days. */
export async function clientVisitsSummary(q: Q, companyId: string, start: string, end: string, tz: string) {
  return all(q, sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      rs.name AS payer_name, ct.name AS care_type_name,
      COUNT(te.id)::int AS visits,
      COUNT(DISTINCT te.caregiver_id)::int AS distinct_caregivers,
      ROUND(SUM(te.duration_minutes) / 60.0, 2) AS total_hours,
      ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 2) AS billable_hours,
      to_char(MIN(${localDate(sql`te.start_time`, tz)}), 'YYYY-MM-DD') AS first_visit,
      to_char(MAX(${localDate(sql`te.start_time`, tz)}), 'YYYY-MM-DD') AS last_visit
    FROM clients c
    LEFT JOIN time_entries te ON te.client_id = c.id AND te.company_id = ${companyId} AND te.is_complete = true
      AND te.start_time >= ${dayStartUtc(start, tz)}
      AND te.start_time <  ${dayEndUtc(end, tz)}
    LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id AND rs.company_id = ${companyId}
    LEFT JOIN care_types ct ON c.care_type_id = ct.id AND ct.company_id = ${companyId}
    WHERE c.company_id = ${companyId} AND c.is_active = true
    GROUP BY c.id, c.first_name, c.last_name, rs.name, ct.name
    HAVING COUNT(te.id) > 0
    ORDER BY total_hours DESC NULLS LAST`)
}

// ── Client Hours by Week ────────────────────────────────────────────────────────────────────────

/** Client week: the visits of the week (the engine's occurrences), with the caregiver's name. */
export async function weekVisits(q: Q, companyId: string, weekStart: string, weekEnd: string, clientId: string | null) {
  return all(q, sql`WITH ${occurrencesCte(companyId, weekStart, weekEnd)}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS day, occ.client_id, occ.caregiver_id,
           to_char(occ.start_time, 'HH24:MI:SS') AS sched_start, to_char(occ.end_time, 'HH24:MI:SS') AS sched_end,
           occ.minutes AS sched_minutes,
           COALESCE(s.is_training, false) AS is_training,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id AND s.company_id = ${companyId}
      JOIN "user" u ON u.id = occ.caregiver_id AND u.company_id = ${companyId}
     WHERE (${clientId}::text IS NULL OR occ.client_id = ${clientId})
     ORDER BY occ.occ_date, occ.start_time`)
}

/** Client week: every punch whose clock-in falls in the week on the agency's calendar. */
export async function weekPunches(q: Q, companyId: string, weekStart: string, weekEnd: string, tz: string, clientId: string | null) {
  const punchDay = localDate(sql`te.start_time`, tz)
  return all(q, sql`SELECT te.id, te.client_id, te.caregiver_id,
           to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
           to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
           te.approval_reason,
           to_char(${punchDay}, 'YYYY-MM-DD') AS day,
           to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI') AS start_hm,
           CASE WHEN te.end_time IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int END AS clocked_minutes,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM time_entries te
      JOIN "user" u ON u.id = te.caregiver_id AND u.company_id = ${companyId}
     WHERE te.company_id = ${companyId}
       AND ${punchDay} BETWEEN (${weekStart})::date AND (${weekEnd})::date
       AND (${clientId}::text IS NULL OR te.client_id = ${clientId})
     ORDER BY te.start_time`)
}

/** Client week: visits cancelled with a reason. */
export async function weekCancellations(q: Q, companyId: string, weekStart: string, weekEnd: string, clientId: string | null) {
  return all(q, sql`SELECT to_char(se.exception_date, 'YYYY-MM-DD') AS day, COALESCE(se.override_client_id, s.client_id) AS client_id,
           to_char(s.start_time::time, 'HH24:MI:SS') AS sched_start, to_char(s.end_time::time, 'HH24:MI:SS') AS sched_end,
           se.cancel_reason,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM schedule_exceptions se
      JOIN schedules s ON s.id = se.schedule_id AND s.company_id = ${companyId}
      LEFT JOIN "user" u ON u.id = s.caregiver_id AND u.company_id = ${companyId}
     WHERE se.company_id = ${companyId}
       AND se.exception_type = 'cancelled' AND se.cancel_reason IS NOT NULL
       AND se.exception_date BETWEEN (${weekStart})::date AND (${weekEnd})::date
       AND (${clientId}::text IS NULL OR COALESCE(se.override_client_id, s.client_id) = ${clientId})`)
}

/** Client week: payroll's decisions on the week's shifts (Payroll → Shift Review). */
export async function weekPayrollReviews(q: Q, companyId: string, weekStart: string, weekEnd: string, clientId: string | null) {
  return all(q, sql`SELECT psr.caregiver_id, psr.schedule_id, psr.time_entry_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS day,
           psr.status, psr.payable_minutes, psr.scheduled_minutes, psr.actual_minutes, psr.resolution_notes,
           to_char(COALESCE(psr.reviewed_at, psr.updated_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS decided_at
      FROM payroll_shift_reviews psr
     WHERE psr.company_id = ${companyId}
       AND psr.shift_date BETWEEN (${weekStart})::date AND (${weekEnd})::date
       AND (${clientId}::text IS NULL OR psr.client_id = ${clientId})`)
}

/** These clients' names and whether they pay privately. */
export async function clientNames(q: Q, companyId: string, ids: string[]) {
  if (!ids.length) return []
  return all(q, sql`SELECT id, first_name, last_name, is_private_pay FROM clients WHERE company_id = ${companyId} AND id IN (${inList(ids)})`)
}

// ── The client comprehensive report ─────────────────────────────────────────────────────────────

/** The client row with its payer's and care type's names (null when the company has no such client). */
export async function reportClient(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT c.*, rs.name AS referral_source_name, ct.name AS care_type_name
    FROM clients c
    LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id AND rs.company_id = ${companyId}
    LEFT JOIN care_types ct ON ct.id = c.care_type_id AND ct.company_id = ${companyId}
    WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

export async function reportEmergencyContacts(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT name, relationship, phone, email, is_primary FROM client_emergency_contacts
    WHERE company_id = ${companyId} AND client_id = ${clientId} ORDER BY is_primary DESC, name`)
}

export async function reportOnboarding(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT * FROM client_onboarding WHERE company_id = ${companyId} AND client_id = ${clientId}`)
}

export async function reportAssignments(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT ca.*, u.first_name || ' ' || u.last_name AS caregiver_name
    FROM client_assignments ca LEFT JOIN "user" u ON u.id = ca.caregiver_id AND u.company_id = ${companyId}
    WHERE ca.company_id = ${companyId} AND ca.client_id = ${clientId}
    ORDER BY ca.status = 'active' DESC, ca.assignment_date DESC`)
}

export async function reportCarePlans(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT * FROM care_plans WHERE company_id = ${companyId} AND client_id = ${clientId} ORDER BY start_date DESC NULLS LAST, created_at DESC`)
}

export async function reportAdlRequirements(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT * FROM adl_requirements WHERE company_id = ${companyId} AND client_id = ${clientId} ORDER BY adl_category`)
}

export async function reportMedications(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT m.*, m.name AS medication_name, m.prescribed_by AS prescriber, (m.status = 'active') AS is_active
    FROM medications m WHERE m.company_id = ${companyId} AND m.client_id = ${clientId} ORDER BY (m.status = 'active') DESC, m.name`)
}

/** Medication administrations in [fromTs, toTs) (naive-UTC bounds). */
export async function reportMedicationLogs(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT ml.*, ml.administered_at AS administered_time, m.name AS medication_name,
      u.first_name || ' ' || u.last_name AS caregiver_name
    FROM medication_logs ml
    LEFT JOIN medications m ON m.id = ml.medication_id AND m.company_id = ${companyId}
    LEFT JOIN "user" u ON u.id = ml.caregiver_id AND u.company_id = ${companyId}
    WHERE ml.company_id = ${companyId} AND ml.client_id = ${clientId}
      AND ml.administered_at >= ${dayStartUtc(from, tz)} AND ml.administered_at < ${dayEndUtc(to, tz)}
    ORDER BY ml.administered_at DESC`)
}

export async function reportAdlLogs(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT al.*, u.first_name || ' ' || u.last_name AS caregiver_name
    FROM adl_logs al LEFT JOIN "user" u ON u.id = al.caregiver_id AND u.company_id = ${companyId}
    WHERE al.company_id = ${companyId} AND al.client_id = ${clientId}
      AND al.performed_at >= ${dayStartUtc(from, tz)} AND al.performed_at < ${dayEndUtc(to, tz)}
    ORDER BY al.performed_at DESC`)
}

export async function reportVisits(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT te.id, te.start_time, te.end_time, te.duration_minutes,
      te.clock_in_location, te.clock_out_location, te.notes, te.is_complete,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      ev.service_code, ev.modifier, ev.units_of_service, ev.sandata_status, ev.sandata_visit_id,
      ev.gps_in_lat, ev.gps_in_lng, ev.gps_out_lat, ev.gps_out_lng,
      ev.is_verified AS evv_verified, ev.sandata_exception_code, ev.sandata_exception_desc
    FROM time_entries te
    LEFT JOIN "user" u ON u.id = te.caregiver_id AND u.company_id = ${companyId}
    LEFT JOIN evv_visits ev ON ev.time_entry_id = te.id AND ev.company_id = ${companyId}
    WHERE te.company_id = ${companyId} AND te.client_id = ${clientId}
      AND te.start_time >= ${dayStartUtc(from, tz)} AND te.start_time < ${dayEndUtc(to, tz)}
    ORDER BY te.start_time DESC`)
}

export async function reportIncidents(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT ir.*, ir.date AS incident_date, ir.action_taken AS actions_taken,
      u.first_name || ' ' || u.last_name AS caregiver_name,
      rb.first_name || ' ' || rb.last_name AS reported_by
    FROM incidents ir
    LEFT JOIN "user" u ON u.id = ir.caregiver_id AND u.company_id = ${companyId}
    LEFT JOIN "user" rb ON rb.id = ir.reported_by_id AND rb.company_id = ${companyId}
    WHERE ir.company_id = ${companyId} AND ir.client_id = ${clientId}
      AND COALESCE(ir.date, ${localDate(sql`ir.created_at`, tz)}) BETWEEN (${from})::date AND (${to})::date
    ORDER BY ir.date DESC NULLS LAST, ir.created_at DESC`)
}

export async function reportCommunications(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT cl.* FROM communication_log cl
    WHERE cl.company_id = ${companyId}
      AND ((cl.entity_type = 'client' AND cl.entity_id = ${clientId}) OR cl.client_id = ${clientId})
      AND cl.created_at >= ${dayStartUtc(from, tz)} AND cl.created_at < ${dayEndUtc(to, tz)}
    ORDER BY cl.is_pinned DESC, cl.created_at DESC`)
}

export async function reportDocuments(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT id, document_key AS document_type, title AS name, status,
      sent_at, signed_at, declined_at, voided_at, created_at
    FROM client_documents WHERE company_id = ${companyId} AND client_id = ${clientId} ORDER BY created_at DESC`)
}

export async function reportAuthorizations(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT a.id, a.auth_number, a.midas_auth_id, a.procedure_code, a.modifier,
      a.authorized_units, a.used_units, (a.authorized_units - COALESCE(a.used_units, 0)) AS remaining_units,
      a.unit_type, a.start_date, a.end_date, a.status, rs.name AS payer_name
    FROM authorizations a LEFT JOIN referral_sources rs ON rs.id = a.payer_id AND rs.company_id = ${companyId}
    WHERE a.company_id = ${companyId} AND a.client_id = ${clientId}
    ORDER BY a.end_date DESC NULLS LAST`)
}

/** Every invoice whose billing period overlaps the range; `released` says whether it counts as billed. */
export async function reportInvoices(q: Q, companyId: string, clientId: string, from: string, to: string) {
  return all(q, sql`SELECT i.id, i.invoice_number, i.billing_period_start, i.billing_period_end,
      i.subtotal, i.tax, i.total, i.payment_status, i.payment_due_date, i.payment_date, i.payment_method,
      ${releasedInvoiceSql('i')} AS released
    FROM invoices i
    WHERE i.company_id = ${companyId} AND i.client_id = ${clientId}
      AND i.billing_period_end >= (${from})::date AND i.billing_period_start <= (${to})::date
    ORDER BY i.billing_period_start DESC`)
}

/** The clinical audit trail of the client row itself (record_id = the client), newest 500. */
export async function reportAuditTrail(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string) {
  return all(q, sql`SELECT al.action, al.table_name, al.timestamp, al.ip_address,
      u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email
    FROM audit_logs al LEFT JOIN "user" u ON u.id = al.user_id AND u.company_id = ${companyId}
    WHERE al.company_id = ${companyId} AND al.record_id = ${clientId}
      AND al.timestamp >= ${dayStartUtc(from, tz)} AND al.timestamp < ${dayEndUtc(to, tz)}
    ORDER BY al.timestamp DESC
    LIMIT 500`)
}

// ── Exports ─────────────────────────────────────────────────────────────────────────────────────

// Every export takes the report's filter (the screen's caregiver and client pickers), so the file matches the report
// on screen: they were ignored, and a CSV of one client's report held every client's rows (fixed 2026-10-19).
const completedIn = (companyId: string, start: string, end: string, tz: string, f: ReportFilter): SQL =>
  sql`te.company_id = ${companyId} AND te.start_time >= ${dayStartUtc(start, tz)} AND te.start_time < ${dayEndUtc(end, tz)} AND te.is_complete = true${f.clientId ? sql` AND te.client_id = ${f.clientId}` : sql``}`
/** The caregiver filter on the "user" rows an export lists. */
const onlyCaregiver = (f: ReportFilter): SQL => (f.caregiverId ? sql` AND u.id = ${f.caregiverId}` : sql``)

/** Export: clocked and payable hours per caregiver (capped minutes, not raw duration). */
export async function exportCaregiverHours(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return all(q, sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
      COALESCE(SUM(te.duration_minutes) / 60.0, 0) AS clocked_hours,
      COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 0) AS payable_hours,
      COUNT(te.id)::int AS shifts, COUNT(DISTINCT te.client_id)::int AS unique_clients
    FROM "user" u LEFT JOIN time_entries te ON te.caregiver_id = u.id AND ${completedIn(companyId, start, end, tz, f)}
    WHERE u.company_id = ${companyId} AND ${isCaregiver()}${onlyCaregiver(f)}
    GROUP BY u.id, u.first_name, u.last_name ORDER BY payable_hours DESC`)
}

/** Export: released invoices in the range. */
export async function exportBilling(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`SELECT c.first_name || ' ' || c.last_name AS client,
      i.invoice_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS billing_period_start,
      to_char(i.billing_period_end, 'YYYY-MM-DD') AS billing_period_end,
      i.total, i.amount_paid, i.payment_status, COALESCE(rs.name, 'Private Pay') AS payer
    FROM invoices i JOIN clients c ON i.client_id = c.id AND c.company_id = ${companyId}
    LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id AND rs.company_id = ${companyId}
    WHERE ${invoicesIn(companyId, start, end, f.clientId)}
    ORDER BY i.billing_period_start DESC, c.last_name`)
}

/** Export: each active caregiver's latest background check and its expiry status. */
export async function exportCompliance(q: Q, companyId: string, today: string, f: ReportFilter) {
  return all(q, sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
      bc.status AS background_check_status,
      to_char(bc.initiated_date, 'YYYY-MM-DD') AS initiated_date, to_char(bc.expiration_date, 'YYYY-MM-DD') AS expiration_date,
      CASE WHEN bc.expiration_date < (${today})::date THEN 'EXPIRED'
           WHEN bc.expiration_date < (${today})::date + 60 THEN 'Expiring Soon'
           WHEN bc.expiration_date IS NULL THEN 'No Check on File'
           ELSE 'Current' END AS expiry_status,
      u.certifications
    FROM "user" u
    LEFT JOIN background_checks bc ON bc.caregiver_id = u.id AND bc.company_id = ${companyId}
      AND bc.id = (SELECT id FROM background_checks bc2 WHERE bc2.company_id = ${companyId} AND bc2.caregiver_id = u.id ORDER BY initiated_date DESC NULLS LAST LIMIT 1)
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true${onlyCaregiver(f)}
    ORDER BY bc.expiration_date ASC NULLS FIRST, u.last_name`)
}

/** Export: the active clients, with their payer and how many caregivers are scheduled to them. */
export async function exportClients(q: Q, companyId: string, tz: string, f: ReportFilter) {
  return all(q, sql`SELECT c.first_name || ' ' || c.last_name AS client,
      c.email, c.phone, c.city, c.state, ${clientServiceTypeSql(companyId)} AS service_type,
      CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END AS status,
      to_char(${localDate(sql`c.created_at`, tz)}, 'YYYY-MM-DD') AS enrolled_date,
      COALESCE(rs.name, 'Unknown') AS referral_source,
      COUNT(DISTINCT s.caregiver_id)::int AS assigned_caregivers
    FROM clients c
    LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id AND rs.company_id = ${companyId}
    LEFT JOIN schedules s ON s.client_id = c.id AND s.company_id = ${companyId} AND s.is_active = true
    WHERE c.company_id = ${companyId} AND c.is_active = true${f.clientId ? sql` AND c.id = ${f.clientId}` : sql``}
    GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.city, c.state, c.service_type, c.is_active, c.created_at, rs.name
    ORDER BY c.last_name`)
}

/** Export: payable hours per caregiver (any other report type). */
export async function exportHours(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return all(q, sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
      COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 0) AS hours
    FROM "user" u LEFT JOIN time_entries te ON te.caregiver_id = u.id AND ${completedIn(companyId, start, end, tz, f)}
    WHERE u.company_id = ${companyId} AND ${isCaregiver()}${onlyCaregiver(f)}
    GROUP BY u.id, u.first_name, u.last_name ORDER BY hours DESC`)
}

/** Export PDF (overview / hours): scheduled hours and clients per active caregiver (twenty). */
export async function scheduledHoursPerCaregiver(q: Q, companyId: string, start: string, end: string, f: ReportFilter) {
  return all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT u.first_name || ' ' || u.last_name AS name, COALESCE(SUM(occ.hours), 0) AS hours, COUNT(DISTINCT occ.client_id)::int AS clients
    FROM "user" u LEFT JOIN occ ON occ.caregiver_id = u.id${f.clientId ? sql` AND occ.client_id = ${f.clientId}` : sql``}
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true${onlyCaregiver(f)}
    GROUP BY u.id, u.first_name, u.last_name ORDER BY hours DESC LIMIT 20`)
}

/** Export PDF (performance): each active caregiver's rating in the range and the clients they are scheduled to. */
export async function ratingsPerCaregiver(q: Q, companyId: string, start: string, end: string, tz: string, f: ReportFilter) {
  return all(q, sql`SELECT u.first_name || ' ' || u.last_name AS name,
      COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(DISTINCT pr.id)::int AS ratings,
      COUNT(DISTINCT s.client_id)::int AS clients
    FROM "user" u
    LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id AND ${ratingsInRange(companyId, start, end, tz)}
    LEFT JOIN schedules s ON s.caregiver_id = u.id AND s.company_id = ${companyId} AND s.is_active = true
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true${onlyCaregiver(f)}
    GROUP BY u.id, u.first_name, u.last_name ORDER BY avg_rating DESC`)
}

// ═══════════════════════════════ Route optimizer (routes/optimizer.ts) ════════════════════════

/** An active-or-not caregiver of this company with their home position. null when not a caregiver of the company. */
export async function routeCaregiver(q: Q, companyId: string, caregiverId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT u.id, u.first_name, u.last_name, u.latitude, u.longitude, u.address, u.city, u.state, u.zip
    FROM "user" u WHERE u.id = ${caregiverId} AND u.company_id = ${companyId} AND ${isCaregiver()}`)) ?? null
}

/** These clients' positions and addresses. */
export async function routeClients(q: Q, companyId: string, ids: string[]) {
  if (!ids.length) return []
  return all(q, sql`SELECT id, first_name, last_name, latitude, longitude, address, city, state, zip, weekly_authorized_units
    FROM clients WHERE company_id = ${companyId} AND id IN (${inList(ids)})`)
}

export type RouteStopInput = {
  stopOrder: number; clientId: string | null; arrival: string | null; departure: string | null; serviceUnits: number | null
  miles: number | null; driveMinutes: number | null; latitude: number | null; longitude: number | null; address: string | null; notes: string | null
}

/**
 * One plan per caregiver per day: a re-save replaces it. In one transaction: the old plan goes, the new one and its stops
 * are written (each stop's times are the plan's date + HH:MM). Returns the plan row (camelCase).
 */
export async function replaceRoutePlan(db: any, companyId: string, p: {
  id: string; caregiverId: string; date: string; totalMiles: number | null; totalDriveMinutes: number | null; totalServiceMinutes: number | null
  status: string; notes: string | null; createdById: string | null; stops: (RouteStopInput & { id: string })[]
}): Promise<any> {
  const ts = (hm: string | null) => (hm ? sql`(${`${p.date} ${hm}`})::timestamp` : sql`NULL`)
  return db.transaction(async (tx: Q) => {
    await tx.execute(sql`DELETE FROM route_plans WHERE company_id = ${companyId} AND caregiver_id = ${p.caregiverId} AND date = (${p.date})::date`)
    const plan = camelFirst(await tx.execute(sql`INSERT INTO route_plans
        (id, company_id, caregiver_id, date, total_distance_miles, total_duration_minutes, total_service_minutes, stop_count, status, notes, created_by_id, optimized_at)
      VALUES (${p.id}, ${companyId}, ${p.caregiverId}, (${p.date})::date, ${p.totalMiles}, ${p.totalDriveMinutes},
              ${p.totalServiceMinutes}, ${p.stops.length}, ${p.status}, ${p.notes}, ${p.createdById}, NOW())
      RETURNING *`))
    for (const s of p.stops) {
      await tx.execute(sql`INSERT INTO route_plan_stops
          (id, company_id, route_plan_id, stop_order, client_id, arrival_time, departure_time, service_units,
           distance_from_prev_miles, duration_from_prev_minutes, latitude, longitude, address, notes)
        VALUES (${s.id}, ${companyId}, ${p.id}, ${s.stopOrder}, ${s.clientId}, ${ts(s.arrival)}, ${ts(s.departure)},
                ${s.serviceUnits}, ${s.miles}, ${s.driveMinutes}, ${s.latitude}, ${s.longitude}, ${s.address}, ${s.notes})`)
    }
    return plan
  })
}

// The plan columns under CVHC's names (route_date, total_miles …), so the screen reads them as before (now camelCase).
const PLAN_COLS = sql.raw(`rp.id, rp.caregiver_id, to_char(rp.date, 'YYYY-MM-DD') AS route_date,
  rp.total_distance_miles AS total_miles, rp.total_duration_minutes AS total_drive_minutes,
  rp.total_service_minutes, rp.stop_count, rp.status, rp.notes, rp.created_by_id AS created_by,
  rp.optimized_at, rp.created_at, rp.updated_at`)
const STOP_COLS = sql.raw(`rps.id, rps.route_plan_id, rps.stop_order, rps.client_id,
  to_char(rps.arrival_time, 'HH24:MI') AS arrival_time, to_char(rps.departure_time, 'HH24:MI') AS departure_time,
  rps.service_units, rps.distance_from_prev_miles AS miles_from_previous,
  rps.duration_from_prev_minutes AS drive_minutes_from_previous,
  rps.latitude, rps.longitude, rps.address, rps.notes, rps.status, rps.actual_arrival, rps.actual_departure`)

/** GET /plans: saved plans (optionally of one date and/or caregiver), newest date first, with the caregiver's home. */
export async function routePlans(q: Q, companyId: string, date: string | null, caregiverId: string | null) {
  return all(q, sql`SELECT ${PLAN_COLS},
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
      u.latitude AS cg_lat, u.longitude AS cg_lng, u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip
    FROM route_plans rp JOIN "user" u ON rp.caregiver_id = u.id AND u.company_id = ${companyId}
    WHERE rp.company_id = ${companyId} ${date ? sql`AND rp.date = (${date})::date` : sql``} ${caregiverId ? sql`AND rp.caregiver_id = ${caregiverId}` : sql``}
    ORDER BY rp.date DESC, u.first_name`)
}

/** A plan's stops in order, with the client's name, phone and weekly units. */
export async function routePlanStops(q: Q, companyId: string, planId: string) {
  return all(q, sql`SELECT ${STOP_COLS}, c.first_name AS client_first_name, c.last_name AS client_last_name,
      c.phone AS client_phone, c.weekly_authorized_units
    FROM route_plan_stops rps JOIN clients c ON rps.client_id = c.id AND c.company_id = ${companyId}
    WHERE rps.company_id = ${companyId} AND rps.route_plan_id = ${planId} ORDER BY rps.stop_order`)
}

/** Deletes a plan (its stops go with it); the deleted row, or null. */
export async function deleteRoutePlan(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`DELETE FROM route_plans WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

/**
 * GET /hours-summary: each active caregiver's week — scheduled (the engine's occurrences, recurring included), clocked,
 * the open shift, and planned miles.
 */
export async function caregiverWeekSummary(q: Q, companyId: string, weekStart: string, weekEnd: string, tz: string) {
  return all(q, sql`WITH ${occurrencesCte(companyId, weekStart, weekEnd)}
    SELECT u.id, u.first_name, u.last_name, u.phone,
      COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id), 0) AS scheduled_hours,
      COALESCE((SELECT SUM(o.minutes) / 15.0 FROM occ o WHERE o.caregiver_id = u.id), 0) AS scheduled_units,
      COALESCE((SELECT COUNT(*) FROM occ o WHERE o.caregiver_id = u.id), 0)::int AS scheduled_visits,
      COALESCE((SELECT SUM(te.duration_minutes) / 60.0 FROM time_entries te
                WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.is_complete = true
                  AND te.start_time >= ${dayStartUtc(weekStart, tz)} AND te.start_time < ${dayEndUtc(weekEnd, tz)}), 0) AS clocked_hours,
      COALESCE((SELECT COUNT(*) FROM time_entries te
                WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.is_complete = true
                  AND te.start_time >= ${dayStartUtc(weekStart, tz)} AND te.start_time < ${dayEndUtc(weekEnd, tz)}), 0)::int AS completed_visits,
      (SELECT json_build_object('id', te.id, 'clientId', te.client_id,
                'startTime', to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'clientName', cl.first_name || ' ' || cl.last_name)
         FROM time_entries te LEFT JOIN clients cl ON te.client_id = cl.id AND cl.company_id = ${companyId}
        WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.is_complete = false AND te.end_time IS NULL
        ORDER BY te.start_time DESC LIMIT 1) AS active_shift,
      COALESCE((SELECT SUM(rp.total_distance_miles) FROM route_plans rp
                WHERE rp.company_id = ${companyId} AND rp.caregiver_id = u.id AND rp.date >= (${weekStart})::date AND rp.date <= (${weekEnd})::date), 0) AS total_miles
    FROM "user" u
    LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id AND ca.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    ORDER BY u.first_name, u.last_name`)
}

/** GET /daily/:date: every visit that day (the engine's), with the caregiver's home and the client's position. */
export async function dayVisitsWithPositions(q: Q, companyId: string, date: string) {
  return all(q, sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, occ.client_id,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           u.first_name AS cg_first, u.last_name AS cg_last, u.latitude AS cg_lat, u.longitude AS cg_lng,
           u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip,
           c.first_name AS cl_first, c.last_name AS cl_last, c.latitude AS cl_lat, c.longitude AS cl_lng,
           c.address AS cl_address, c.city AS cl_city, c.state AS cl_state, c.zip AS cl_zip,
           c.weekly_authorized_units
    FROM occ
    JOIN "user" u  ON u.id = occ.caregiver_id AND u.company_id = ${companyId}
    JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    ORDER BY u.first_name, occ.start_time`)
}

/** GET /geofence: the active clients' geofences. */
export async function clientGeofences(q: Q, companyId: string) {
  return all(q, sql`SELECT gs.*, c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.latitude, c.longitude
    FROM geofence_settings gs JOIN clients c ON gs.client_id = c.id AND c.company_id = ${companyId}
    WHERE gs.company_id = ${companyId} AND c.is_active = true ORDER BY c.first_name`)
}

/** Is this a person of the company? */
export async function personOnFile(q: Q, companyId: string, userId: string): Promise<boolean> {
  return !!camelFirst(await q.execute(sql`SELECT 1 AS ok FROM "user" WHERE id = ${userId} AND company_id = ${companyId}`))
}

/** Is this the company's client? */
export async function clientOnFile(q: Q, companyId: string, clientId: string): Promise<boolean> {
  return !!camelFirst(await q.execute(sql`SELECT 1 AS ok FROM clients WHERE id = ${clientId} AND company_id = ${companyId}`))
}

/** POST /geofence: sets the client's geofence (one per client). Returns the row. */
export async function upsertGeofence(q: Q, companyId: string, g: {
  id: string; clientId: string; radiusFeet: number; autoClockIn: boolean; autoClockOut: boolean; requireGps: boolean; notifyAdminOnOverride: boolean
}) {
  return first(q, sql`INSERT INTO geofence_settings (id, company_id, client_id, radius_feet, auto_clock_in, auto_clock_out, require_gps, notify_admin_on_override)
    VALUES (${g.id}, ${companyId}, ${g.clientId}, ${g.radiusFeet}, ${g.autoClockIn}, ${g.autoClockOut}, ${g.requireGps}, ${g.notifyAdminOnOverride})
    ON CONFLICT (client_id) DO UPDATE SET
      radius_feet = EXCLUDED.radius_feet, auto_clock_in = EXCLUDED.auto_clock_in, auto_clock_out = EXCLUDED.auto_clock_out,
      require_gps = EXCLUDED.require_gps, notify_admin_on_override = EXCLUDED.notify_admin_on_override, updated_at = NOW()
    WHERE geofence_settings.company_id = ${companyId}
    RETURNING *`)
}

/** POST /geofence/check: the client's position and fence (a 300 ft default). null when the company has no such client. */
export async function clientFence(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT c.latitude, c.longitude, c.first_name, c.last_name,
      COALESCE(gs.radius_feet, 300) AS radius_feet, COALESCE(gs.auto_clock_in, true) AS auto_clock_in, COALESCE(gs.auto_clock_out, true) AS auto_clock_out
    FROM clients c LEFT JOIN geofence_settings gs ON c.id = gs.client_id AND gs.company_id = ${companyId}
    WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/** Geocoding: sets a client's or a person's position (the company's only). */
export async function setPosition(q: Q, companyId: string, entity: 'client' | 'user', id: string, latitude: number, longitude: number) {
  if (entity === 'client') {
    await q.execute(sql`UPDATE clients SET latitude = ${String(latitude)}, longitude = ${String(longitude)}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
  } else {
    await q.execute(sql`UPDATE "user" SET latitude = ${String(latitude)}, longitude = ${String(longitude)}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
  }
}

/** Geocode-all: the active caregivers, or the active clients, with an address and no position. */
export async function unplacedAddresses(q: Q, companyId: string, caregivers: boolean) {
  return caregivers
    ? all(q, sql`SELECT u.id, u.address, u.city, u.state, u.zip FROM "user" u
        WHERE u.company_id = ${companyId} AND (u.latitude IS NULL OR u.longitude IS NULL) AND u.address IS NOT NULL AND ${isCaregiver()} AND u.is_active = true`)
    : all(q, sql`SELECT id, address, city, state, zip FROM clients
        WHERE company_id = ${companyId} AND (latitude IS NULL OR longitude IS NULL) AND address IS NOT NULL AND is_active = true`)
}

/** PUT /stops/:stopId/status: a stop's live status (arrived / completed stamp their time). The row, or null. */
export async function setStopStatus(q: Q, companyId: string, stopId: string, status: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`UPDATE route_plan_stops SET status = ${status}
      ${status === 'arrived' ? sql`, actual_arrival = NOW()` : status === 'completed' ? sql`, actual_departure = NOW()` : sql``}
    WHERE id = ${stopId} AND company_id = ${companyId} RETURNING *`)) ?? null
}

/** GET /load-schedule: the caregiver's visits that day (the engine's RESOLVED caregiver: covers in, handed-off days out). */
export async function caregiverDayStops(q: Q, companyId: string, caregiverId: string, date: string) {
  return all(q, sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id AS id, occ.client_id,
           to_char(occ.start_time, 'HH24:MI') AS start_time, to_char(occ.end_time, 'HH24:MI') AS end_time,
           c.first_name, c.last_name, c.latitude, c.longitude, c.address, c.city, c.state, c.zip, c.weekly_authorized_units
    FROM occ JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
    WHERE occ.caregiver_id = ${caregiverId}
    ORDER BY occ.start_time`)
}

/** GET /load-schedule: the caregiver's saved plan for that day, if any. */
export async function savedPlanFor(q: Q, companyId: string, caregiverId: string, date: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT id, status, total_distance_miles AS total_miles, total_duration_minutes AS total_drive_minutes,
      total_service_minutes, stop_count, created_at, notes
    FROM route_plans WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId} AND date = (${date})::date
    ORDER BY created_at DESC LIMIT 1`)) ?? null
}

/** GET /plans/:id/full: the plan with the caregiver's home. null when the company has no such plan. */
export async function routePlanWithHome(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT ${PLAN_COLS},
      u.first_name AS cg_first, u.last_name AS cg_last, u.latitude AS cg_lat, u.longitude AS cg_lng,
      u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip
    FROM route_plans rp JOIN "user" u ON rp.caregiver_id = u.id AND u.company_id = ${companyId}
    WHERE rp.id = ${id} AND rp.company_id = ${companyId}`)) ?? null
}

/** GET /plans/:id/full: its stops, with the client's name, phone and weekly units. */
export async function routePlanFullStops(q: Q, companyId: string, id: string) {
  return all(q, sql`SELECT ${STOP_COLS}, c.first_name, c.last_name, c.phone, c.weekly_authorized_units
    FROM route_plan_stops rps JOIN clients c ON rps.client_id = c.id AND c.company_id = ${companyId}
    WHERE rps.company_id = ${companyId} AND rps.route_plan_id = ${id} ORDER BY rps.stop_order`)
}

export type SavedRouteFilter = { status?: string; caregiverId?: string; startDate?: string; endDate?: string }
const savedRouteWhere = (companyId: string, f: SavedRouteFilter): SQL => sql`WHERE rp.company_id = ${companyId}
    ${f.status ? sql`AND rp.status = ${f.status}` : sql``}
    ${f.caregiverId ? sql`AND rp.caregiver_id = ${f.caregiverId}` : sql``}
    ${f.startDate ? sql`AND rp.date >= (${f.startDate})::date` : sql``}
    ${f.endDate ? sql`AND rp.date <= (${f.endDate})::date` : sql``}`

/** GET /saved-routes: how many plans match. */
export async function savedRouteCount(q: Q, companyId: string, f: SavedRouteFilter): Promise<number> {
  return Number((await first(q, sql`SELECT COUNT(*)::int AS n FROM route_plans rp ${savedRouteWhere(companyId, f)}`)).n) || 0
}

/** GET /saved-routes: a page of matching plans, newest date first. */
export async function savedRoutePage(q: Q, companyId: string, f: SavedRouteFilter, limit: number, offset: number) {
  return all(q, sql`SELECT ${PLAN_COLS}, u.first_name AS cg_first, u.last_name AS cg_last,
      (SELECT COUNT(*)::int FROM route_plan_stops rps WHERE rps.company_id = ${companyId} AND rps.route_plan_id = rp.id) AS actual_stop_count
    FROM route_plans rp JOIN "user" u ON rp.caregiver_id = u.id AND u.company_id = ${companyId}
    ${savedRouteWhere(companyId, f)}
    ORDER BY rp.date DESC, u.first_name LIMIT ${limit} OFFSET ${offset}`)
}

/** GET /company: active clients with their active assignments' caregivers (one row per assignment, or one with none). */
export async function activeClientAssignments(q: Q, companyId: string) {
  return all(q, sql`SELECT c.id AS client_id, c.first_name AS client_first_name, c.last_name AS client_last_name,
      ca.id AS assignment_id, ca.caregiver_id, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
    FROM clients c
    LEFT JOIN client_assignments ca ON ca.client_id = c.id AND ca.company_id = ${companyId} AND ca.status = 'active'
    LEFT JOIN "user" u ON u.id = ca.caregiver_id AND u.company_id = ${companyId}
    WHERE c.company_id = ${companyId} AND c.is_active = true`)
}

/** GET /company: completed minutes per caregiver over the last seven days. */
export async function completedMinutesLastWeek(q: Q, companyId: string) {
  return all(q, sql`SELECT caregiver_id, SUM(duration_minutes) AS total_minutes
    FROM time_entries WHERE company_id = ${companyId} AND start_time >= ${nowUtc} - INTERVAL '7 days' AND is_complete = true
    GROUP BY caregiver_id`)
}

/** GET /routes: the clients of active assignments (one caregiver's when named). */
export async function assignedClientStops(q: Q, companyId: string, caregiverId: string | null) {
  return all(q, sql`SELECT c.first_name, c.last_name, c.address, c.city, c.latitude, c.longitude
    FROM client_assignments ca JOIN clients c ON ca.client_id = c.id AND c.company_id = ${companyId}
    WHERE ca.company_id = ${companyId} AND ca.status = 'active' ${caregiverId ? sql`AND ca.caregiver_id = ${caregiverId}` : sql``}`)
}

/** GET /stats: active clients and caregivers, and the visits today and over the last week (the engine's). */
export async function optimizerStats(q: Q, companyId: string, today: string, weekAgo: string) {
  const counts = await first(q, sql`SELECT
      (SELECT COUNT(*)::int FROM clients WHERE company_id = ${companyId} AND is_active = true) AS active_clients,
      (SELECT COUNT(*)::int FROM "user" u WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true) AS active_caregivers`)
  const t = await first(q, sql`WITH ${occurrencesCte(companyId, today, today)} SELECT COUNT(*)::int AS n FROM occ`)
  const w = await first(q, sql`WITH ${occurrencesCte(companyId, weekAgo, today)} SELECT COUNT(*)::int AS n FROM occ`)
  return { activeClients: counts.activeClients, activeCaregivers: counts.activeCaregivers, todayShifts: t.n, weekShifts: w.n }
}

// ═══════════════════════════════ Schedule and roster optimizers ═══════════════════════════════

/** client-data: the client's scheduling facts. null when the company has no such client. */
export async function optimizerClient(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers, service_type,
           weekly_authorized_units, service_days_per_week, service_allowed_days
    FROM clients WHERE id = ${clientId} AND company_id = ${companyId}`)) ?? null
}

/** client-data: the client's current active authorization (ending soonest). */
export async function currentAuthorization(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT authorized_units, used_units, unit_type, start_date, end_date,
           authorized_units - used_units AS remaining_units
    FROM authorizations
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND status = 'active'
      AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
    ORDER BY end_date ASC LIMIT 1`)) ?? null
}

/** client-data: the client's active recurring patterns, with the caregiver's name. */
export async function clientRecurringPatterns(q: Q, companyId: string, clientId: string) {
  return all(q, sql`SELECT s.day_of_week, to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time, s.caregiver_id,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last
    FROM schedules s
    JOIN "user" u ON s.caregiver_id = u.id AND u.company_id = ${companyId}
    WHERE s.company_id = ${companyId} AND s.client_id = ${clientId} AND s.is_active = true
      AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
    ORDER BY s.day_of_week, s.start_time`)
}

/** run: these caregivers' active recurring patterns, with both names. */
export async function caregiversRecurringPatterns(q: Q, companyId: string, caregiverIds: string[]) {
  if (!caregiverIds.length) return []
  return all(q, sql`SELECT s.id, s.caregiver_id, s.client_id, s.day_of_week,
           to_char(s.start_time, 'HH24:MI') AS start_time, to_char(s.end_time, 'HH24:MI') AS end_time,
           s.schedule_type, s.frequency,
           u.first_name AS cg_first, u.last_name AS cg_last,
           c.first_name AS cl_first, c.last_name AS cl_last
    FROM schedules s
    JOIN "user" u ON s.caregiver_id = u.id AND u.company_id = ${companyId}
    JOIN clients c ON s.client_id = c.id AND c.company_id = ${companyId}
    WHERE s.company_id = ${companyId} AND s.caregiver_id IN (${inList(caregiverIds)}) AND s.is_active = true
      AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
    ORDER BY s.caregiver_id, s.day_of_week, s.start_time`)
}

/** run: these clients' caregiver preferences. */
export async function clientsCaregiverPreferences(q: Q, companyId: string, clientIds: string[]) {
  if (!clientIds.length) return []
  return all(q, sql`SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers
    FROM clients WHERE company_id = ${companyId} AND id IN (${inList(clientIds)})`)
}

/** run: these people's names and weekly availability (camelCase: mondayAvailable, mondayStartTime, mondayPreferredStart …). */
export async function caregiversAvailability(q: Q, companyId: string, caregiverIds: string[]) {
  if (!caregiverIds.length) return []
  return all(q, sql`SELECT u.id, u.first_name, u.last_name,
           a.monday_available, a.tuesday_available, a.wednesday_available,
           a.thursday_available, a.friday_available, a.saturday_available, a.sunday_available,
           a.monday_start_time, a.tuesday_start_time, a.wednesday_start_time,
           a.thursday_start_time, a.friday_start_time, a.saturday_start_time, a.sunday_start_time,
           a.monday_end_time, a.tuesday_end_time, a.wednesday_end_time,
           a.thursday_end_time, a.friday_end_time, a.saturday_end_time, a.sunday_end_time,
           a.monday_preferred_start, a.tuesday_preferred_start, a.wednesday_preferred_start,
           a.thursday_preferred_start, a.friday_preferred_start, a.saturday_preferred_start, a.sunday_preferred_start,
           a.monday_preferred_end, a.tuesday_preferred_end, a.wednesday_preferred_end,
           a.thursday_preferred_end, a.friday_preferred_end, a.saturday_preferred_end, a.sunday_preferred_end
    FROM "user" u
    LEFT JOIN caregiver_availability a ON a.caregiver_id = u.id AND a.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND u.id IN (${inList(caregiverIds)})`)
}

/**
 * apply: one recurring pattern the optimizer proposed. Its times are wall-clock HH:MM written onto `date` (wallClock),
 * which throws on a time that is not HH:MM — the caller reports that proposal and goes on.
 */
export async function insertOptimizerPattern(q: Q, companyId: string, p: {
  id: string; caregiverId: string; clientId: string; dayOfWeek: number; date: string; startTime: unknown; endTime: unknown; notes: string
}) {
  const start = wallClock(p.date, p.startTime), end = wallClock(p.date, p.endTime)
  await q.execute(sql`INSERT INTO schedules
      (id, company_id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, is_active)
    VALUES (${p.id}, ${companyId}, ${p.caregiverId}, ${p.clientId}, 'recurring', ${p.dayOfWeek}, ${start}, ${end}, ${p.notes}, true)`)
}

/** roster: the active caregivers, their weekly cap and how many clients they have patterns for. */
export async function rosterCaregivers(q: Q, companyId: string) {
  return all(q, sql`SELECT
      u.id, u.first_name, u.last_name, u.phone, u.hire_date,
      COALESCE(cs.max_hours_per_week, 40) AS max_hours_per_week,
      COALESCE((SELECT COUNT(DISTINCT client_id) FROM schedules WHERE company_id = ${companyId} AND caregiver_id = u.id AND is_active = true), 0) AS active_client_count
    FROM "user" u
    LEFT JOIN caregiver_availability cs ON cs.caregiver_id = u.id AND cs.company_id = ${companyId}
    WHERE u.company_id = ${companyId} AND ${isCaregiver()} AND u.is_active = true
    ORDER BY u.first_name, u.last_name`)
}

/** roster: the active clients, their weekly hours, scheduled days and current caregivers. */
export async function rosterClients(q: Q, companyId: string) {
  return all(q, sql`SELECT
      c.id, c.first_name, c.last_name, c.service_type, c.address, c.city,
      c.preferred_caregivers, c.do_not_use_caregivers,
      COALESCE(c.weekly_authorized_units, 0) AS assigned_hours_per_week,
      c.service_days_per_week, c.service_allowed_days,
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT day_of_week ORDER BY day_of_week)
        FROM schedules WHERE company_id = ${companyId} AND client_id = c.id AND is_active = true AND schedule_type = 'recurring' AND day_of_week IS NOT NULL
      ), '{}') AS scheduled_days,
      COALESCE((SELECT ARRAY_AGG(DISTINCT caregiver_id) FROM schedules WHERE company_id = ${companyId} AND client_id = c.id AND is_active = true), '{}') AS current_caregivers
    FROM clients c WHERE c.company_id = ${companyId} AND c.is_active = true ORDER BY c.last_name, c.first_name`)
}

/** roster: each caregiver's scheduled hours in ONE week, through the schedule engine (one-time, covers, cancellations). */
export async function weekHoursByCaregiver(q: Q, companyId: string, start: string, end: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const r of await all(q, sql`WITH ${occurrencesCte(companyId, start, end)}
    SELECT caregiver_id, ROUND(SUM(hours)::numeric, 2) AS hours FROM occ GROUP BY caregiver_id`)) {
    if (r.caregiverId) out[r.caregiverId] = Number(r.hours) || 0
  }
  return out
}
