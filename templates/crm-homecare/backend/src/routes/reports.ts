// Reports & Analytics — ported from CVHC routes/reports.js (b2456a2).
//
// The business rules, as CVHC settled them:
//   · SCHEDULED hours come from the shared schedule engine (services/scheduleOccurrences.ts) — actual
//     occurrences in the range, respecting effective/end dates, bi-weekly, cancellations, suspensions.
//   · DELIVERED hours ("worked") = payroll-reviewed shifts (verified / approved / manual_entry — what
//     actually gets paid, including staff who never clock in) PLUS clock entries no approved review
//     covers yet. Clock data alone held a third of the real hours at CVHC.
//   · REVENUE = invoices (private pay) + claims (payers). Claims are dated by service date. Revenue
//     reports never invent a $/hr: hours with no rate on file count $0 and are reported as unvalued.
//   · Days are the agency's calendar days (services/agencyTime.ts), never the UTC server's.
//
// Template mappings (the template's own columns win): clients.referred_by_id for CVHC's
// referral_source_id, claims.billed_amount for charge_amount, the `incidents` table (date,
// reported_by_id) for incident_reports, `medications` / `adl_requirements` / `client_documents`
// for client_medications / client_adl_requirements / documents, expenses.date for expense_date.
//
// Every route here is the office's: revenue, payroll and client records. requireAdmin throughout.
import { Hono } from 'hono'
import { sql, type SQL } from 'drizzle-orm'
import PDFDocument from 'pdfkit'
import { db } from '../../db/index.ts'
import { auditLogs } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import {
  agencyTimezone, agencyToday, addDays, isYmd, localDate, localTs, dayStartUtc, dayEndUtc,
} from '../services/agencyTime.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows || []
const one = async (q: SQL): Promise<any> => (await rows(q))[0] || {}
const num = (v: any) => parseFloat(v) || 0

async function agencyName(): Promise<string> {
  const r = await one(sql`SELECT name FROM agencies ORDER BY created_at LIMIT 1`)
  return r.name || 'Home Care Agency'
}

/** Body/query dates: given → must be real YYYY-MM-DD; missing → the default range. */
function parseRange(start: unknown, end: unknown, defStart: string, defEnd: string): { startDate: string; endDate: string } | { error: string } {
  const s = start == null || start === '' ? defStart : start
  const e = end == null || end === '' ? defEnd : end
  if (!isYmd(s) || !isYmd(e)) return { error: 'startDate and endDate must be YYYY-MM-DD dates' }
  if (s > e) return { error: 'startDate must be on or before endDate' }
  return { startDate: s, endDate: e }
}
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function postBody(c: any): Promise<any> {
  try { return (await c.req.json()) || {} } catch { return {} }
}

// Default report window = the screen's default: one month back through today.
async function defaultRange(tz: string) {
  const today = await agencyToday(tz)
  const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1)
  return { defStart: d.toISOString().slice(0, 10), defEnd: today }
}

// Delivered work for a date range on the agency's calendar (see header).
function deliveredCte(start: string, end: string, tz: string): SQL {
  return sql`delivered AS (
    SELECT psr.caregiver_id, psr.client_id, psr.shift_date AS work_date,
           psr.payable_minutes AS mins
    FROM payroll_shift_reviews psr
    WHERE psr.status IN ('verified', 'approved', 'manual_entry')
      AND psr.payable_minutes > 0
      AND psr.shift_date BETWEEN (${start})::date AND (${end})::date
    UNION ALL
    SELECT te.caregiver_id, te.client_id,
           ${localDate(sql`te.start_time`, tz)},
           COALESCE(te.billable_minutes, te.duration_minutes)
    FROM time_entries te
    WHERE te.end_time IS NOT NULL
      AND te.start_time >= ${dayStartUtc(start, tz)}
      AND te.start_time <  ${dayEndUtc(end, tz)}
      AND NOT EXISTS (SELECT 1 FROM payroll_shift_reviews p2
                       WHERE p2.time_entry_id = te.id
                         AND p2.status IN ('verified', 'approved', 'manual_entry'))
  )`
}

// The payer's hourly rate for a client on a date: the referral source's rate for the client's care
// type effective that day (a '15min' rate × 4). LATERAL fragment; `c` = clients, dateExpr = the day.
const payerRateLateral = (dateExpr: SQL) => sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
    FROM referral_source_rates r
    WHERE r.referral_source_id = c.referred_by_id AND r.care_type_id = c.care_type_id
      AND r.is_active = true
      AND (r.effective_date IS NULL OR r.effective_date <= ${dateExpr})
      AND (r.end_date IS NULL OR r.end_date >= ${dateExpr})
    ORDER BY r.effective_date DESC NULLS LAST LIMIT 1
  ) prate ON true`

// A performance rating's calendar day.
const ratedOn = (tz: string) => localDate(sql`pr.created_at`, tz)

// ==================== OVERVIEW ====================
app.post('/overview', async (c) => {
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range
  const caregiverId = idOrNull(body.caregiverId)
  const clientId = idOrNull(body.clientId)

  const occFilter = sql`${caregiverId ? sql` AND occ.caregiver_id = ${caregiverId}` : sql``}${clientId ? sql` AND occ.client_id = ${clientId}` : sql``}`

  const [summary, worked, satisfaction, revenue, topCaregivers, topClients] = await Promise.all([
    one(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT COALESCE(SUM(occ.hours), 0) AS "totalHours", COUNT(*)::int AS "totalShifts"
      FROM occ WHERE 1=1 ${occFilter}`),
    one(sql`WITH ${deliveredCte(startDate, endDate, tz)}
      SELECT COALESCE(SUM(mins), 0) / 60.0 AS worked FROM delivered
      WHERE (${caregiverId}::text IS NULL OR caregiver_id = ${caregiverId})
        AND (${clientId}::text IS NULL OR client_id = ${clientId})`),
    one(sql`SELECT COALESCE(AVG(pr.satisfaction_score), 0) AS "avgSatisfaction"
      FROM performance_ratings pr
      WHERE ${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date`),
    // Revenue billed in the period — invoices + claims, the same as the Revenue tab.
    one(sql`SELECT COALESCE(SUM(billed), 0) AS "totalRevenue" FROM (
        SELECT i.total AS billed FROM invoices i
        WHERE i.billing_period_start >= (${startDate})::date AND i.billing_period_end <= (${endDate})::date
          AND (${clientId}::text IS NULL OR i.client_id = ${clientId})
        UNION ALL
        SELECT cl.billed_amount FROM claims cl
        WHERE cl.service_date BETWEEN (${startDate})::date AND (${endDate})::date
          AND COALESCE(cl.status, '') <> 'voided' AND cl.invoice_id IS NULL
          AND (${clientId}::text IS NULL OR cl.client_id = ${clientId})
      ) u`),
    // Top caregivers by SCHEDULED hours; labour COST (hours × pay rate), not revenue.
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT u.id, u.first_name, u.last_name,
        COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id AND (${clientId}::text IS NULL OR o.client_id = ${clientId})), 0) AS total_hours,
        COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id AND (${clientId}::text IS NULL OR o.client_id = ${clientId})), 0) * COALESCE(u.default_pay_rate, 0) AS est_labor_cost,
        COALESCE(AVG(pr.satisfaction_score), 0) AS avg_satisfaction,
        COALESCE((SELECT COUNT(DISTINCT o.client_id) FROM occ o WHERE o.caregiver_id = u.id AND (${clientId}::text IS NULL OR o.client_id = ${clientId})), 0)::int AS clients_served
      FROM users u
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id
        AND ${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND (${caregiverId}::text IS NULL OR u.id = ${caregiverId})
      GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
      ORDER BY total_hours DESC
      LIMIT 10`),
    // Top clients — scheduled hours + REAL invoiced revenue.
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT c.id, c.first_name, c.last_name, c.service_type,
        COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.client_id = c.id AND (${caregiverId}::text IS NULL OR o.caregiver_id = ${caregiverId})), 0) AS total_hours,
        COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.client_id = c.id
                  AND i.billing_period_start >= (${startDate})::date AND i.billing_period_end <= (${endDate})::date), 0) AS revenue,
        COALESCE((SELECT COUNT(DISTINCT o.caregiver_id) FROM occ o WHERE o.client_id = c.id AND (${caregiverId}::text IS NULL OR o.caregiver_id = ${caregiverId})), 0)::int AS caregiver_count
      FROM clients c
      WHERE c.is_active = true
        AND (${clientId}::text IS NULL OR c.id = ${clientId})
      ORDER BY total_hours DESC
      LIMIT 10`),
  ])

  const schedHours = num(summary.totalHours)
  const workedHours = num(worked.worked)
  return c.json({
    summary: {
      totalHours: schedHours,
      workedHours,
      deliveredPct: schedHours > 0 ? Math.round((workedHours / schedHours) * 100) : null,
      totalRevenue: num(revenue.totalRevenue),
      totalShifts: parseInt(summary.totalShifts) || 0,
      avgSatisfaction: num(satisfaction.avgSatisfaction) || null,
    },
    topCaregivers,
    topClients,
  })
})

// ==================== HOURS ====================
app.post('/hours', async (c) => {
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range
  const caregiverId = idOrNull(body.caregiverId)
  const clientId = idOrNull(body.clientId)
  const occFilter = sql`${caregiverId ? sql` AND occ.caregiver_id = ${caregiverId}` : sql``}${clientId ? sql` AND occ.client_id = ${clientId}` : sql``}`

  const [hoursByWeek, hoursByType, caregiverBreakdown, workedByCg] = await Promise.all([
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT to_char(DATE_TRUNC('week', occ.occ_date), 'YYYY-MM-DD') AS week_start, COALESCE(SUM(occ.hours), 0) AS hours
      FROM occ WHERE 1=1 ${occFilter}
      GROUP BY 1 ORDER BY 1`),
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT COALESCE(c.service_type, 'unspecified') AS service_type, COALESCE(SUM(occ.hours), 0) AS hours
      FROM occ JOIN clients c ON c.id = occ.client_id
      WHERE 1=1 ${occFilter}
      GROUP BY 1 ORDER BY 2 DESC`),
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT u.id, u.first_name, u.last_name,
        COALESCE(SUM(occ.hours), 0) AS total_hours,
        COUNT(DISTINCT occ.client_id)::int AS client_count,
        COALESCE(AVG(occ.hours), 0) AS avg_shift_hours
      FROM users u JOIN occ ON occ.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true ${occFilter}
      GROUP BY u.id, u.first_name, u.last_name
      HAVING SUM(occ.hours) > 0
      ORDER BY total_hours DESC`),
    rows(sql`WITH ${deliveredCte(startDate, endDate, tz)}
      SELECT caregiver_id, ROUND(SUM(mins) / 60.0, 2) AS worked_hours
      FROM delivered
      WHERE (${caregiverId}::text IS NULL OR caregiver_id = ${caregiverId})
        AND (${clientId}::text IS NULL OR client_id = ${clientId})
      GROUP BY caregiver_id`),
  ])
  const worked = Object.fromEntries(workedByCg.map((r: any) => [r.caregiver_id, num(r.worked_hours)]))
  const totalHours = hoursByType.reduce((s: number, r: any) => s + num(r.hours), 0)

  return c.json({
    hoursByWeek,
    hoursByType: hoursByType.map((r: any) => ({
      ...r,
      percentage: totalHours > 0 ? ((num(r.hours) / totalHours) * 100).toFixed(1) : 0,
    })),
    caregiverBreakdown: caregiverBreakdown.map((r: any) => ({ ...r, worked_hours: worked[r.id] ?? 0 })),
    totalHours,
  })
})

// ==================== PERFORMANCE ====================
app.post('/performance', async (c) => {
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range
  const caregiverId = idOrNull(body.caregiverId)

  const [performance, ratingDistribution, punctuality, delivery, gps] = await Promise.all([
    rows(sql`WITH ${occurrencesCte(startDate, endDate)}
      SELECT u.id, u.first_name, u.last_name,
        COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating,
        COUNT(DISTINCT pr.id)::int AS rating_count,
        COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id), 0) AS total_hours,
        COALESCE((SELECT COUNT(DISTINCT o.client_id) FROM occ o WHERE o.caregiver_id = u.id), 0)::int AS clients_served,
        COALESCE((SELECT COUNT(*) FROM incidents i WHERE i.reported_by_id = u.id
                   AND i.date BETWEEN (${startDate})::date AND (${endDate})::date), 0)::int AS incident_count
      FROM users u
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id
        AND ${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date
      WHERE u.role = 'caregiver' AND u.is_active = true
        AND (${caregiverId}::text IS NULL OR u.id = ${caregiverId})
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY avg_rating DESC, total_hours DESC`),
    rows(sql`SELECT pr.satisfaction_score AS rating, COUNT(*)::int AS count
      FROM performance_ratings pr
      WHERE ${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date
      GROUP BY 1 ORDER BY 1 DESC`),
    // Punctuality — clock-in on the agency clock vs the scheduled start, 5 minutes' grace.
    rows(sql`SELECT u.id, u.first_name, u.last_name,
        COUNT(te.id)::int AS total_shifts,
        COUNT(CASE WHEN (${localTs(sql`te.start_time`, tz)})::time <= sch.start_time::time + INTERVAL '5 minutes' THEN 1 END)::int AS on_time_count
      FROM users u
      LEFT JOIN time_entries te ON te.caregiver_id = u.id
        AND te.start_time >= ${dayStartUtc(startDate, tz)}
        AND te.start_time < ${dayEndUtc(endDate, tz)}
        AND te.end_time IS NOT NULL
      LEFT JOIN schedules sch ON te.schedule_id = sch.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name
      HAVING COUNT(te.id) > 0
      ORDER BY (COUNT(CASE WHEN (${localTs(sql`te.start_time`, tz)})::time <= sch.start_time::time + INTERVAL '5 minutes' THEN 1 END)::float / NULLIF(COUNT(te.id), 0)) DESC`),
    rows(sql`WITH ${deliveredCte(startDate, endDate, tz)}
      SELECT caregiver_id, ROUND(SUM(mins) / 60.0, 1) AS worked_hours
      FROM delivered GROUP BY caregiver_id`),
    // GPS capture stays clock-based — it only applies to app users' entries.
    rows(sql`SELECT te.caregiver_id,
        ROUND(100.0 * COUNT(te.clock_in_location) / COUNT(*), 0) AS gps_capture_pct
      FROM time_entries te
      WHERE te.end_time IS NOT NULL
        AND te.start_time >= ${dayStartUtc(startDate, tz)}
        AND te.start_time < ${dayEndUtc(endDate, tz)}
      GROUP BY te.caregiver_id`),
  ])
  const deliveryByCg = Object.fromEntries(delivery.map((r: any) => [r.caregiver_id, r]))
  const gpsByCg = Object.fromEntries(gps.map((r: any) => [r.caregiver_id, r.gps_capture_pct]))

  return c.json({
    caregiverPerformance: performance.map((r: any) => ({
      ...r,
      worked_hours: num(deliveryByCg[r.id]?.worked_hours ?? 0),
      gps_capture_pct: gpsByCg[r.id] ?? null,
    })),
    ratingDistribution,
    punctuality: punctuality.map((r: any) => ({
      ...r,
      on_time_percentage: r.total_shifts > 0 ? ((r.on_time_count / r.total_shifts) * 100).toFixed(1) : 0,
    })),
  })
})

// ==================== SATISFACTION ====================
app.post('/satisfaction', async (c) => {
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range
  const caregiverId = idOrNull(body.caregiverId)
  const inRange = sql`${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date`

  const [overall, trend, byClient, themes] = await Promise.all([
    one(sql`SELECT COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating,
        COUNT(pr.id)::int AS total_ratings,
        COUNT(CASE WHEN pr.satisfaction_score >= 4 THEN 1 END)::int AS positive_count,
        COUNT(CASE WHEN pr.satisfaction_score = 3 THEN 1 END)::int AS neutral_count,
        COUNT(CASE WHEN pr.satisfaction_score < 3 THEN 1 END)::int AS negative_count
      FROM performance_ratings pr
      WHERE ${inRange} ${caregiverId ? sql`AND pr.caregiver_id = ${caregiverId}` : sql``}`),
    rows(sql`SELECT to_char(DATE_TRUNC('week', ${localTs(sql`pr.created_at`, tz)}), 'YYYY-MM-DD') AS week_start,
        COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(*)::int AS count
      FROM performance_ratings pr
      WHERE ${inRange}
      GROUP BY 1 ORDER BY 1`),
    rows(sql`SELECT c.id, c.first_name, c.last_name,
        COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(pr.id)::int AS rating_count
      FROM clients c
      LEFT JOIN performance_ratings pr ON pr.client_id = c.id AND ${inRange}
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name
      HAVING COUNT(pr.id) > 0
      ORDER BY avg_rating DESC`),
    rows(sql`SELECT
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
      WHERE ${inRange} AND pr.comments IS NOT NULL AND pr.comments <> ''
      GROUP BY 1 ORDER BY 2 DESC
      LIMIT 6`),
  ])
  const total = parseInt(overall.total_ratings) || 0
  const pct = (n: any) => (total > 0 ? ((num(n) / total) * 100).toFixed(1) : 0)
  return c.json({
    satisfaction: {
      avg_rating: num(overall.avg_rating),
      total_ratings: total,
      positive_percentage: pct(overall.positive_count),
      neutral_percentage: pct(overall.neutral_count),
      negative_percentage: pct(overall.negative_count),
      trend,
      feedback_themes: themes,
    },
    byClient,
  })
})

// ==================== REVENUE ====================
// Two billing tracks: private pay bills via INVOICES (by billing period), payers via CLAIMS
// (billed_amount billed, paid_amount collected, by service date). Revenue unions both.
app.post('/revenue', async (c) => {
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range
  const clientId = idOrNull(body.clientId)
  const today = await agencyToday(tz)
  const invF = clientId ? sql`AND i.client_id = ${clientId}` : sql``
  const clmF = clientId ? sql`AND cl.client_id = ${clientId}` : sql``
  const invIn = sql`i.billing_period_start >= (${startDate})::date AND i.billing_period_end <= (${endDate})::date`
  // A claim made FROM an invoice (claims.invoice_id) bills the same money as that invoice: the
  // invoice already counts it, so such claims are left out everywhere invoices are counted too.
  const clmIn = sql`cl.service_date BETWEEN (${startDate})::date AND (${endDate})::date AND COALESCE(cl.status, '') <> 'voided' AND cl.invoice_id IS NULL`

  const [inv, clm, hours, byServiceType, byPayer, aging, byClient] = await Promise.all([
    // Outstanding is net of adjustments/write-offs, matching the Billing Dashboard.
    one(sql`SELECT COALESCE(SUM(i.total), 0) AS total, COALESCE(SUM(i.amount_paid), 0) AS collected,
        COALESCE(SUM(i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)), 0) AS outstanding,
        COUNT(i.id)::int AS invoice_count
      FROM invoices i WHERE ${invIn} ${invF}`),
    one(sql`SELECT COALESCE(SUM(cl.billed_amount), 0) AS total, COALESCE(SUM(cl.paid_amount), 0) AS collected,
        COALESCE(SUM(COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)), 0) AS outstanding,
        COUNT(cl.id)::int AS claim_count
      FROM claims cl WHERE ${clmIn} ${clmF}`),
    // Scheduled hours (context only — NOT billed hours)
    one(sql`WITH ${occurrencesCte(startDate, endDate)} SELECT COALESCE(SUM(occ.hours), 0) AS scheduled_hours FROM occ`),
    rows(sql`SELECT service_type, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(collected), 0) AS collected FROM (
        SELECT COALESCE(c.service_type, 'unspecified') AS service_type, i.total AS revenue, COALESCE(i.amount_paid, 0) AS collected
        FROM invoices i JOIN clients c ON c.id = i.client_id WHERE ${invIn} ${invF}
        UNION ALL
        SELECT COALESCE(c.service_type, 'unspecified'), cl.billed_amount, COALESCE(cl.paid_amount, 0)
        FROM claims cl JOIN clients c ON c.id = cl.client_id WHERE ${clmIn} ${clmF}
      ) u GROUP BY service_type ORDER BY revenue DESC`),
    rows(sql`SELECT payer, COALESCE(SUM(billed), 0) AS billed, COALESCE(SUM(collected), 0) AS collected,
        COALESCE(SUM(billed - collected), 0) AS outstanding FROM (
        SELECT COALESCE(rs.name, CASE WHEN c.is_private_pay THEN 'Private Pay' ELSE 'Unknown' END) AS payer,
          i.total AS billed, COALESCE(i.amount_paid, 0) AS collected
        FROM invoices i JOIN clients c ON c.id = i.client_id
        LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id
        WHERE ${invIn} ${invF}
        UNION ALL
        SELECT COALESCE(rs.name, 'Unknown Payer'), cl.billed_amount, COALESCE(cl.paid_amount, 0)
        FROM claims cl LEFT JOIN referral_sources rs ON rs.id = cl.payer_id
        WHERE ${clmIn} ${clmF}
      ) u GROUP BY payer ORDER BY billed DESC`),
    // AR aging — a CURRENT snapshot of unpaid balances by days past due (invoices + unpaid claims,
    // as of the agency's today). Claim due = submission/service date + the payer's expected_pay_days.
    one(sql`SELECT
        COALESCE(SUM(bal) FILTER (WHERE due >= (${today})::date), 0) AS current_not_due,
        COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 1 AND 30), 0) AS d1_30,
        COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 31 AND 60), 0) AS d31_60,
        COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due BETWEEN 61 AND 90), 0) AS d61_90,
        COALESCE(SUM(bal) FILTER (WHERE (${today})::date - due > 90), 0) AS d90_plus,
        COALESCE(SUM(bal), 0) AS total_outstanding
      FROM (
        SELECT (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) AS bal,
               COALESCE(i.payment_due_date, i.billing_period_end + 30) AS due
        FROM invoices i
        WHERE (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) > 0.005 ${invF}
        UNION ALL
        SELECT (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)),
               (COALESCE(cl.submission_date, cl.service_date) + COALESCE(rs.expected_pay_days, 30))
        FROM claims cl LEFT JOIN referral_sources rs ON rs.id = cl.payer_id
        WHERE (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0)) > 0.005
          AND COALESCE(cl.status, '') NOT IN ('voided', 'draft') AND cl.invoice_id IS NULL ${clmF}
      ) t`),
    rows(sql`SELECT id, first_name, last_name, COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(outstanding), 0) AS outstanding FROM (
        SELECT c.id, c.first_name, c.last_name, i.total AS revenue,
          (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) AS outstanding
        FROM clients c JOIN invoices i ON i.client_id = c.id AND ${invIn}
        WHERE (${clientId}::text IS NULL OR c.id = ${clientId})
        UNION ALL
        SELECT c.id, c.first_name, c.last_name, cl.billed_amount,
          (COALESCE(cl.billed_amount, 0) - COALESCE(cl.paid_amount, 0))
        FROM clients c JOIN claims cl ON cl.client_id = c.id AND ${clmIn}
        WHERE (${clientId}::text IS NULL OR c.id = ${clientId})
      ) u GROUP BY id, first_name, last_name HAVING SUM(revenue) > 0 ORDER BY revenue DESC LIMIT 15`),
  ])

  const totalRevenue = num(inv.total) + num(clm.total)
  const scheduledHours = num(hours.scheduled_hours)
  return c.json({
    revenue: {
      total: totalRevenue,
      collected: num(inv.collected) + num(clm.collected),
      outstanding: num(inv.outstanding) + num(clm.outstanding),
      invoiceCount: (parseInt(inv.invoice_count) || 0) + (parseInt(clm.claim_count) || 0),
      avgPerScheduledHour: scheduledHours > 0 ? (totalRevenue / scheduledHours).toFixed(2) : 0,
      scheduledHours,
    },
    ar: aging,
    byPayer,
    byServiceType,
    byClient,
  })
})

// ==================== PROFIT & LOSS ====================
// Earned basis on delivered work. Invoices count by OVERLAP with the range, PRORATED by days
// (private pay bills bi-weekly, so a week view otherwise showed $0 billed). Payroll = delivered
// minutes × pay rate ($15/h when none is on file, CVHC's figure) + 7.65% est. employer tax; earned
// revenue = delivered minutes × the client's contract rate (private-pay rate, or the payer rate
// effective on the service date). Hours with no rate count $0 and are reported as unvalued.
app.get('/pnl', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const monthStart = `${today.slice(0, 8)}01`
  const range = parseRange(c.req.query('startDate'), c.req.query('endDate'), monthStart, today)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate: start, endDate: end } = range

  const frac = sql`GREATEST(0, LEAST(i.billing_period_end, (${end})::date) - GREATEST(i.billing_period_start, (${start})::date) + 1)::numeric
            / NULLIF(i.billing_period_end - i.billing_period_start + 1, 0)`
  const [revenue, revenueByPayer, expenses, d] = await Promise.all([
    one(sql`SELECT COALESCE(SUM(billed), 0) AS total_billed, COALESCE(SUM(collected), 0) AS total_collected,
        COALESCE(SUM(billed) - SUM(collected), 0) AS outstanding FROM (
        SELECT i.total * ${frac} AS billed, COALESCE(i.amount_paid, 0) * ${frac} AS collected
        FROM invoices i WHERE i.billing_period_end >= (${start})::date AND i.billing_period_start <= (${end})::date
        UNION ALL
        SELECT COALESCE(cl.billed_amount, 0), COALESCE(cl.paid_amount, 0)
        FROM claims cl WHERE cl.service_date BETWEEN (${start})::date AND (${end})::date AND COALESCE(cl.status, '') <> 'voided'
          AND cl.invoice_id IS NULL
      ) u`),
    rows(sql`SELECT payer_name, SUM(cnt)::int AS invoice_count, COALESCE(SUM(billed), 0) AS billed, COALESCE(SUM(collected), 0) AS collected FROM (
        SELECT COALESCE(rs.name, 'Private Pay') AS payer_name, 1 AS cnt,
          i.total * ${frac} AS billed, COALESCE(i.amount_paid, 0) * ${frac} AS collected
        FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
        WHERE i.billing_period_end >= (${start})::date AND i.billing_period_start <= (${end})::date
        UNION ALL
        SELECT COALESCE(rs.name, 'Unknown Payer'), 1, cl.billed_amount, COALESCE(cl.paid_amount, 0)
        FROM claims cl LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
        WHERE cl.service_date BETWEEN (${start})::date AND (${end})::date AND COALESCE(cl.status, '') <> 'voided'
          AND cl.invoice_id IS NULL
      ) u GROUP BY payer_name ORDER BY billed DESC`),
    rows(sql`SELECT category, COALESCE(SUM(amount), 0) AS category_total
      FROM expenses WHERE date >= (${start})::date AND date <= (${end})::date
      GROUP BY category ORDER BY category_total DESC`),
    one(sql`WITH ${deliveredCte(start, end, tz)}
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
      LEFT JOIN users u ON u.id = d.caregiver_id
      LEFT JOIN clients c ON c.id = d.client_id
      ${payerRateLateral(sql`d.work_date`)}`),
  ])

  const totalExpenses = expenses.reduce((s: number, e: any) => s + num(e.category_total), 0)
  const totalBilled = num(revenue.total_billed)
  const totalCollected = num(revenue.total_collected)
  const grossPayroll = num(d.gross_payroll)
  const ppEarned = num(d.pp_earned)
  const payerEarned = num(d.payer_earned)
  const earnedRevenue = ppEarned + payerEarned
  const unbilledEst = Math.max(0, earnedRevenue - totalBilled)
  // Net subtracts payroll INCLUDING est. employer taxes — the number the summary table shows.
  const payrollTotal = grossPayroll * 1.0765
  const netIncome = earnedRevenue - totalExpenses - payrollTotal
  const netIncomeCash = totalCollected - totalExpenses - payrollTotal

  return c.json({
    period: { start, end },
    revenue,
    revenueByPayer,
    expenses: { total: totalExpenses, byCategory: expenses },
    payroll: { gross: grossPayroll, estimated_taxes: grossPayroll * 0.0765, total: payrollTotal },
    delivered: {
      hours: num(d.delivered_hours),
      private_pay_hours: num(d.pp_hours),
      private_pay_earned: ppEarned,
      payer_hours: num(d.payer_hours),
      payer_earned: payerEarned,
      unvalued_hours: num(d.unvalued_hours),
    },
    unbilledEst,
    earnedRevenue,
    netIncome,
    netIncomeCash,
    margin: earnedRevenue > 0 ? ((netIncome / earnedRevenue) * 100).toFixed(2) : 0,
  })
})

// ==================== CAREGIVER PRODUCTIVITY ====================
app.get('/caregiver-productivity', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const range = parseRange(c.req.query('startDate'), c.req.query('endDate'), addDays(today, -30), today)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const result = await rows(sql`WITH ${occurrencesCte(range.startDate, range.endDate)}
    SELECT u.id, u.first_name, u.last_name,
      COUNT(occ.schedule_id)::int AS visit_count,
      COUNT(DISTINCT occ.client_id)::int AS client_count,
      COALESCE(SUM(occ.hours), 0) AS total_hours,
      COALESCE(AVG(occ.hours), 0) AS avg_hours_per_visit,
      u.default_pay_rate AS hourly_rate,
      COALESCE(SUM(occ.hours), 0) * COALESCE(u.default_pay_rate, 0) AS total_pay
    FROM users u
    LEFT JOIN occ ON occ.caregiver_id = u.id
    WHERE u.role = 'caregiver' AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate
    ORDER BY total_hours DESC`)
  return c.json(result)
})

// ==================== CSV helpers ====================
const csvCell = (v: any) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
type Col = { key: string; label: string }
const toCSV = (data: any[], columns: Col[]) =>
  columns.map((c) => csvCell(c.label)).join(',') + '\n' +
  data.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\n') + '\n'
const csvResponse = (filename: string, body: string) => new Response(body, {
  status: 200,
  headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
})
const pdfResponse = (filename: string, buf: Buffer) => new Response(buf, {
  status: 200,
  headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
})
function renderPdf(build: (doc: PDFKit.PDFDocument) => void, opts: any = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', ...opts })
    const chunks: Buffer[] = []
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { build(doc); doc.end() } catch (e) { reject(e) }
  })
}
const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agency'

// ==================== DRILL-DOWN REPORTS (GET, ?format=csv) ====================
async function requireRange(c: any): Promise<{ startDate: string; endDate: string; tz: string } | Response> {
  const s = c.req.query('startDate'), e = c.req.query('endDate')
  if (!s || !e) return c.json({ error: 'startDate + endDate required' }, 400)
  const r = parseRange(s, e, s, e)
  if ('error' in r) return c.json({ error: r.error }, 400)
  return { ...r, tz: await agencyTimezone() }
}

// Hours by payer — clocked (capped) hours per referral source over a range.
app.get('/hours-by-payer', async (c) => {
  const r = await requireRange(c); if (r instanceof Response) return r
  const { startDate, endDate, tz } = r
  const result = await rows(sql`WITH labeled AS (
      SELECT
        COALESCE(rs.id::text, CASE WHEN c.is_private_pay THEN 'private' ELSE 'unknown' END) AS payer_key,
        COALESCE(rs.name, CASE WHEN c.is_private_pay THEN 'Private Pay' ELSE 'Unknown' END) AS payer_name,
        COALESCE(rs.payer_type, CASE WHEN c.is_private_pay THEN 'private_pay' ELSE 'unknown' END) AS payer_type,
        c.id AS client_id, te.id AS te_id, te.duration_minutes, te.billable_minutes,
        ${localDate(sql`te.start_time`, tz)} AS work_day
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
      WHERE te.is_complete = true
        AND te.start_time >= ${dayStartUtc(startDate, tz)}
        AND te.start_time <  ${dayEndUtc(endDate, tz)}
    )
    SELECT payer_key, payer_name, payer_type,
      COUNT(DISTINCT client_id)::int AS active_clients,
      COUNT(te_id)::int AS visits,
      ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS total_hours,
      ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS billable_hours,
      ROUND(AVG(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS avg_visit_hours,
      to_char(MIN(work_day), 'YYYY-MM-DD') AS first_visit,
      to_char(MAX(work_day), 'YYYY-MM-DD') AS last_visit
    FROM labeled
    GROUP BY payer_key, payer_name, payer_type
    ORDER BY billable_hours DESC NULLS LAST`)
  if (c.req.query('format') === 'csv') {
    return csvResponse(`hours-by-payer-${startDate}-to-${endDate}.csv`, toCSV(result, [
      { key: 'payer_name', label: 'Payer' }, { key: 'payer_type', label: 'Type' },
      { key: 'active_clients', label: 'Clients' }, { key: 'visits', label: 'Visits' },
      { key: 'total_hours', label: 'Total Hours' }, { key: 'billable_hours', label: 'Billable Hours' },
      { key: 'avg_visit_hours', label: 'Avg Visit Hours' },
      { key: 'first_visit', label: 'First Visit' }, { key: 'last_visit', label: 'Last Visit' },
    ]))
  }
  return c.json({ rows: result, period: { startDate, endDate } })
})

// Caregiver utilization — actual hours vs capacity (max hours/week × fractional weeks in the period).
app.get('/caregiver-utilization', async (c) => {
  const r = await requireRange(c); if (r instanceof Response) return r
  const { startDate, endDate, tz } = r
  const result = await rows(sql`WITH actuals AS (
      SELECT caregiver_id,
        ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 2) AS actual_hours,
        COUNT(*)::int AS visits
      FROM time_entries
      WHERE is_complete = true
        AND start_time >= ${dayStartUtc(startDate, tz)}
        AND start_time <  ${dayEndUtc(endDate, tz)}
      GROUP BY caregiver_id
    ),
    weeks AS (
      SELECT GREATEST(((${endDate})::date - (${startDate})::date + 1)::numeric / 7, 0.1) AS n
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
    FROM users u
    LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id
    LEFT JOIN actuals a ON a.caregiver_id = u.id
    WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY utilization_pct DESC NULLS LAST, u.last_name`)
  if (c.req.query('format') === 'csv') {
    return csvResponse(`caregiver-utilization-${startDate}-to-${endDate}.csv`, toCSV(result, [
      { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
      { key: 'max_hours_per_week', label: 'Max Hrs/Week' },
      { key: 'capacity_hours', label: 'Period Capacity (hrs)' },
      { key: 'actual_hours', label: 'Actual (hrs)' },
      { key: 'visits', label: 'Visits' },
      { key: 'utilization_pct', label: 'Utilization %' },
    ]))
  }
  return c.json({ rows: result, period: { startDate, endDate } })
})

// Client incident history — incidents rolled up per client over a range.
app.get('/client-incidents', async (c) => {
  const r = await requireRange(c); if (r instanceof Response) return r
  const { startDate, endDate } = r
  const clientId = idOrNull(c.req.query('clientId'))
  const result = await rows(sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      COUNT(*)::int AS incident_count,
      COUNT(*) FILTER (WHERE ir.severity = 'critical')::int AS critical_count,
      COUNT(*) FILTER (WHERE ir.severity = 'severe')::int AS severe_count,
      COUNT(*) FILTER (WHERE ir.severity = 'moderate')::int AS moderate_count,
      COUNT(*) FILTER (WHERE ir.severity = 'minor')::int AS minor_count,
      COUNT(*) FILTER (WHERE ir.follow_up_required = true)::int AS followup_count,
      to_char(MIN(ir.date), 'YYYY-MM-DD') AS earliest,
      to_char(MAX(ir.date), 'YYYY-MM-DD') AS latest
    FROM incidents ir
    JOIN clients c ON ir.client_id = c.id
    WHERE ir.date BETWEEN (${startDate})::date AND (${endDate})::date
      ${clientId ? sql`AND ir.client_id = ${clientId}` : sql``}
    GROUP BY c.id, c.first_name, c.last_name
    ORDER BY incident_count DESC`)
  if (c.req.query('format') === 'csv') {
    return csvResponse(`client-incidents-${startDate}-to-${endDate}.csv`, toCSV(result, [
      { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
      { key: 'incident_count', label: 'Incidents' },
      { key: 'critical_count', label: 'Critical' }, { key: 'severe_count', label: 'Severe' },
      { key: 'moderate_count', label: 'Moderate' }, { key: 'minor_count', label: 'Minor' },
      { key: 'followup_count', label: 'Needs Follow-up' },
      { key: 'earliest', label: 'Earliest' }, { key: 'latest', label: 'Latest' },
    ]))
  }
  return c.json({ rows: result, period: { startDate, endDate } })
})

// Client revenue by month — per-client invoice totals, collected vs outstanding, by billing month.
app.get('/client-revenue-by-month', async (c) => {
  const r = await requireRange(c); if (r instanceof Response) return r
  const { startDate, endDate, tz } = r
  const today = await agencyToday(tz)
  const result = await rows(sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      TO_CHAR(date_trunc('month', i.billing_period_start), 'YYYY-MM') AS month,
      COUNT(i.id)::int AS invoice_count,
      ROUND(SUM(i.total)::numeric, 2) AS total_billed,
      ROUND(SUM(COALESCE(i.amount_paid, 0))::numeric, 2) AS total_paid,
      ROUND(SUM(i.total - COALESCE(i.amount_paid, 0))::numeric, 2) AS outstanding,
      COUNT(*) FILTER (WHERE i.payment_status = 'paid')::int AS paid_count,
      COUNT(*) FILTER (WHERE i.payment_status = 'pending' AND i.payment_due_date < (${today})::date)::int AS overdue_count,
      to_char(MAX(i.billing_period_end), 'YYYY-MM-DD') AS last_billed
    FROM invoices i
    JOIN clients c ON i.client_id = c.id
    WHERE i.billing_period_start >= (${startDate})::date AND i.billing_period_start <= (${endDate})::date
    GROUP BY c.id, c.first_name, c.last_name, 4
    ORDER BY month DESC, total_billed DESC`)
  if (c.req.query('format') === 'csv') {
    return csvResponse(`client-revenue-by-month-${startDate}-to-${endDate}.csv`, toCSV(result, [
      { key: 'month', label: 'Month' }, { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
      { key: 'invoice_count', label: 'Invoices' }, { key: 'total_billed', label: 'Billed' },
      { key: 'total_paid', label: 'Paid' }, { key: 'outstanding', label: 'Outstanding' },
      { key: 'paid_count', label: 'Paid Invoices' }, { key: 'overdue_count', label: 'Overdue Invoices' },
      { key: 'last_billed', label: 'Last Billed' },
    ]))
  }
  return c.json({ rows: result, period: { startDate, endDate } })
})

// Client visits summary — per-client visit count + hours (invoice prep).
app.get('/client-visits-summary', async (c) => {
  const r = await requireRange(c); if (r instanceof Response) return r
  const { startDate, endDate, tz } = r
  const result = await rows(sql`SELECT c.id AS client_id, c.first_name, c.last_name,
      rs.name AS payer_name, ct.name AS care_type_name,
      COUNT(te.id)::int AS visits,
      COUNT(DISTINCT te.caregiver_id)::int AS distinct_caregivers,
      ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 2) AS total_hours,
      ROUND(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 2) AS billable_hours,
      to_char(MIN(${localDate(sql`te.start_time`, tz)}), 'YYYY-MM-DD') AS first_visit,
      to_char(MAX(${localDate(sql`te.start_time`, tz)}), 'YYYY-MM-DD') AS last_visit
    FROM clients c
    LEFT JOIN time_entries te ON te.client_id = c.id AND te.is_complete = true
      AND te.start_time >= ${dayStartUtc(startDate, tz)}
      AND te.start_time <  ${dayEndUtc(endDate, tz)}
    LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
    LEFT JOIN care_types ct ON c.care_type_id = ct.id
    WHERE c.is_active = true
    GROUP BY c.id, c.first_name, c.last_name, rs.name, ct.name
    HAVING COUNT(te.id) > 0
    ORDER BY total_hours DESC NULLS LAST`)
  if (c.req.query('format') === 'csv') {
    return csvResponse(`client-visits-summary-${startDate}-to-${endDate}.csv`, toCSV(result, [
      { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
      { key: 'payer_name', label: 'Payer' }, { key: 'care_type_name', label: 'Care Type' },
      { key: 'visits', label: 'Visits' }, { key: 'distinct_caregivers', label: 'Distinct Caregivers' },
      { key: 'total_hours', label: 'Total Hours' }, { key: 'billable_hours', label: 'Billable Hours' },
      { key: 'first_visit', label: 'First Visit' }, { key: 'last_visit', label: 'Last Visit' },
    ]))
  }
  return c.json({ rows: result, period: { startDate, endDate } })
})

// ==================== CLIENT HOURS BY WEEK ====================
// Who was at each client, and when, for one Sunday–Saturday week: every scheduled visit beside the
// clock-in/out that belongs to it, clock-ins with no visit on the schedule, and visits cancelled
// with a reason. Built for entering hours into an insurer's portal. Read-only — corrections are made
// in Payroll → Shift Review and shown here.
//
// A punch pairs with a visit the way payroll pairs them: same caregiver + client + local date,
// nearest scheduled start. Minutes are shown as 15-minute units (minutes ÷ 15, two decimals) — the
// claims engine's unit.
app.get('/client-week', async (c) => {
  const weekStart = String(c.req.query('weekStart') || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return c.json({ error: 'weekStart (YYYY-MM-DD) required' }, 400)
  const start = new Date(`${weekStart}T12:00:00Z`)
  if (isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== weekStart || start.getUTCDay() !== 0) {
    return c.json({ error: 'weekStart must be a Sunday' }, 400)
  }
  const weekEnd = addDays(weekStart, 6)
  const cid = idOrNull(c.req.query('clientId'))
  const tz = await agencyTimezone()
  const punchDay = localDate(sql`te.start_time`, tz)

  const [occ, punches, cancelled, reviews] = await Promise.all([
    rows(sql`WITH ${occurrencesCte(weekStart, weekEnd)}
      SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS day, occ.client_id, occ.caregiver_id,
             to_char(occ.start_time, 'HH24:MI:SS') AS sched_start, to_char(occ.end_time, 'HH24:MI:SS') AS sched_end,
             occ.minutes AS sched_minutes,
             COALESCE(s.is_training, false) AS is_training,
             u.first_name || ' ' || u.last_name AS caregiver_name
        FROM occ
        JOIN schedules s ON s.id = occ.schedule_id
        JOIN users u ON u.id = occ.caregiver_id
       WHERE (${cid}::text IS NULL OR occ.client_id = ${cid})
       ORDER BY occ.occ_date, occ.start_time`),
    rows(sql`SELECT te.id, te.client_id, te.caregiver_id,
             to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time,
             to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_time,
             te.approval_reason,
             to_char(${punchDay}, 'YYYY-MM-DD') AS day,
             to_char(${localTs(sql`te.start_time`, tz)}, 'HH24:MI') AS start_hm,
             CASE WHEN te.end_time IS NOT NULL
                  THEN ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::int END AS clocked_minutes,
             u.first_name || ' ' || u.last_name AS caregiver_name
        FROM time_entries te
        JOIN users u ON u.id = te.caregiver_id
       WHERE ${punchDay} BETWEEN (${weekStart})::date AND (${weekEnd})::date
         AND (${cid}::text IS NULL OR te.client_id = ${cid})
       ORDER BY te.start_time`),
    rows(sql`SELECT to_char(se.exception_date, 'YYYY-MM-DD') AS day, COALESCE(se.override_client_id, s.client_id) AS client_id,
             to_char(s.start_time::time, 'HH24:MI:SS') AS sched_start, to_char(s.end_time::time, 'HH24:MI:SS') AS sched_end,
             se.cancel_reason,
             u.first_name || ' ' || u.last_name AS caregiver_name
        FROM schedule_exceptions se
        JOIN schedules s ON s.id = se.schedule_id
        LEFT JOIN users u ON u.id = s.caregiver_id
       WHERE se.exception_type = 'cancelled' AND se.cancel_reason IS NOT NULL
         AND se.exception_date BETWEEN (${weekStart})::date AND (${weekEnd})::date
         AND (${cid}::text IS NULL OR COALESCE(se.override_client_id, s.client_id) = ${cid})`),
    // Payroll's decisions on these shifts (Payroll → Shift Review).
    rows(sql`SELECT psr.caregiver_id, psr.schedule_id, psr.time_entry_id, to_char(psr.shift_date, 'YYYY-MM-DD') AS day,
             psr.status, psr.payable_minutes, psr.scheduled_minutes, psr.actual_minutes, psr.resolution_notes,
             to_char(COALESCE(psr.reviewed_at, psr.updated_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS decided_at
        FROM payroll_shift_reviews psr
       WHERE psr.shift_date BETWEEN (${weekStart})::date AND (${weekEnd})::date
         AND (${cid}::text IS NULL OR psr.client_id = ${cid})`),
  ])

  const result = buildClientWeek({ occ, punches, cancelled, reviews })
  const ids = [...new Set(result.map((r) => r.client_id))]
  const names = ids.length
    ? await rows(sql`SELECT id, first_name, last_name, is_private_pay FROM clients WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    : []
  const byId = new Map(names.map((n: any) => [n.id, n]))
  const sortKey = (r: any) => `${r.day} ${r.sched_start || r.clock_in || ''}`
  const clients = ids.map((id) => {
    const cl: any = byId.get(id) || {}
    const clientRows = result.filter((r) => r.client_id === id).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    return {
      client_id: id,
      name: `${cl.first_name || ''} ${cl.last_name || ''}`.trim(),
      is_private_pay: !!cl.is_private_pay,
      rows: clientRows,
      scheduled_minutes: clientRows.reduce((s, r) => s + (r.type === 'visit' ? r.sched_minutes || 0 : 0), 0),
      clocked_minutes: clientRows.reduce((s, r) => s + (r.clocked_minutes || 0), 0),
      missing_clock_ins: clientRows.filter((r) => r.type === 'visit' && !r.clock_in).length,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  return c.json({ weekStart, weekEnd, timezone: tz, clients })
})

// Pure pairing + payroll-note logic for Client Hours by Week, exported for the tests.
export function buildClientWeek({ occ, punches, cancelled, reviews }: { occ: any[]; punches: any[]; cancelled: any[]; reviews: any[] }) {
  // One payroll decision per shift. Old overlapping pay periods left some shifts with several review
  // rows: a correction beats a plain approval, then the newest decision wins.
  const RANK: Record<string, number> = { manual_entry: 3, excused: 3, approved: 2 }
  const better = (a: any, b: any) => !a ? b
    : ((RANK[b.status] || 0) - (RANK[a.status] || 0)
      || (new Date(b.decided_at || 0).getTime() - new Date(a.decided_at || 0).getTime())) > 0 ? b : a
  const reviewByEntry = new Map<string, any>(), reviewBySlot = new Map<string, any>()
  for (const r of reviews) {
    if (r.time_entry_id) reviewByEntry.set(r.time_entry_id, better(reviewByEntry.get(r.time_entry_id), r))
    if (r.schedule_id) {
      const k = `${r.caregiver_id}|${r.day}|${r.schedule_id}`
      reviewBySlot.set(k, better(reviewBySlot.get(k), r))
    }
  }
  // Only what the office should see: corrections, and visits paid with no clock-in. Routine
  // "Bulk approved at scheduled hours" rows add nothing and are left out.
  const payrollNote = (rev: any) => {
    if (!rev) return null
    const note = rev.resolution_notes && !/^Bulk approved/.test(rev.resolution_notes) ? String(rev.resolution_notes).trim() : null
    if (rev.status === 'manual_entry') return { kind: 'manual', payable_minutes: rev.payable_minutes, note }
    if (rev.status === 'excused') return { kind: 'excused', payable_minutes: 0, note }
    if (rev.status === 'approved' && !rev.time_entry_id) return { kind: 'paid_no_clock_in', payable_minutes: rev.payable_minutes, note }
    if (rev.status === 'approved' && rev.payable_minutes != null
        && rev.payable_minutes !== rev.scheduled_minutes && rev.payable_minutes !== rev.actual_minutes) {
      return { kind: 'adjusted', payable_minutes: rev.payable_minutes, note }
    }
    return note ? { kind: 'note', payable_minutes: rev.payable_minutes, note } : null
  }
  const flagsOf = (p: any) => p && p.approval_reason ? String(p.approval_reason).split(',').map((s) => s.trim()).filter(Boolean) : []
  const hmToMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }

  const unmatched = [...punches]
  const visits = occ.map((v) => {
    const cands = unmatched.filter((p) => p.caregiver_id === v.caregiver_id && p.client_id === v.client_id && p.day === v.day)
    cands.sort((a, b) => Math.abs(hmToMin(a.start_hm) - hmToMin(v.sched_start)) - Math.abs(hmToMin(b.start_hm) - hmToMin(v.sched_start)))
    const p = cands[0] || null
    if (p) unmatched.splice(unmatched.indexOf(p), 1)
    const n = payrollNote((p && reviewByEntry.get(p.id)) || reviewBySlot.get(`${v.caregiver_id}|${v.day}|${v.schedule_id}`))
    return {
      type: 'visit', day: v.day, client_id: v.client_id, caregiver_name: v.caregiver_name, is_training: !!v.is_training,
      sched_start: v.sched_start, sched_end: v.sched_end, sched_minutes: v.sched_minutes,
      clock_in: p ? p.start_time : null, clock_out: p ? p.end_time : null,
      clocked_minutes: p ? p.clocked_minutes : null, time_entry_id: p ? p.id : null,
      flags: flagsOf(p),
      // Never say "no clock-in" beside a visit that shows one.
      payroll: n && n.kind === 'paid_no_clock_in' && p ? null : n,
    }
  })
  const extra = unmatched.map((p) => ({
    type: 'unscheduled', day: p.day, client_id: p.client_id, caregiver_name: p.caregiver_name, is_training: false,
    sched_start: null, sched_end: null, sched_minutes: null,
    clock_in: p.start_time, clock_out: p.end_time, clocked_minutes: p.clocked_minutes, time_entry_id: p.id,
    flags: flagsOf(p),
    payroll: payrollNote(reviewByEntry.get(p.id)),
  }))
  const cancels = cancelled.map((x) => ({
    type: 'cancelled', day: x.day, client_id: x.client_id, caregiver_name: x.caregiver_name || '', cancel_reason: x.cancel_reason,
    is_training: false,
    sched_start: x.sched_start, sched_end: x.sched_end, sched_minutes: null,
    clock_in: null, clock_out: null, clocked_minutes: null, time_entry_id: null, flags: [] as string[], payroll: null,
  }))
  return [...visits, ...extra, ...cancels] as any[]
}

// ==================== CLIENT COMPREHENSIVE REPORT ====================
// Every record tied to a client within a date range — one source for audits, surveyor visits,
// family requests, incident investigations and legal requests. Generating it is audit-logged.
const ALL_CLIENT_REPORT_SECTIONS = [
  'demographics', 'care_plan', 'medications', 'adls',
  'visits', 'incidents', 'communications', 'documents',
  'authorizations', 'billing', 'audit',
]

async function fetchClientReportData(clientId: string, from: string, to: string, sections: string[], tz: string) {
  const wants = new Set(sections)
  const client = await one(sql`SELECT c.*, rs.name AS referral_source_name, ct.name AS care_type_name
    FROM clients c
    LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
    LEFT JOIN care_types ct ON ct.id = c.care_type_id
    WHERE c.id = ${clientId}`)
  if (!client.id) return null
  // Never put the portal credential or SSN into a report.
  for (const k of ['ssn_encrypted', 'portal_token', 'portal_token_exp', 'portal_password_hash']) delete client[k]
  const data: any = { clientId, period: { from, to }, sections: [...wants], timezone: tz, client }

  const fromTs = dayStartUtc(from, tz), toTs = dayEndUtc(to, tz)
  const [ec, onboard, assign] = await Promise.all([
    rows(sql`SELECT name, relationship, phone, email, is_primary FROM client_emergency_contacts WHERE client_id = ${clientId} ORDER BY is_primary DESC, name`),
    rows(sql`SELECT * FROM client_onboarding WHERE client_id = ${clientId}`),
    rows(sql`SELECT ca.*, u.first_name || ' ' || u.last_name AS caregiver_name
      FROM client_assignments ca LEFT JOIN users u ON u.id = ca.caregiver_id
      WHERE ca.client_id = ${clientId}
      ORDER BY ca.status = 'active' DESC, ca.assignment_date DESC`),
  ])
  data.emergencyContacts = ec
  data.onboarding = onboard[0] || null
  data.assignments = assign

  if (wants.has('care_plan')) {
    const [plans, adlReq] = await Promise.all([
      rows(sql`SELECT * FROM care_plans WHERE client_id = ${clientId} ORDER BY start_date DESC NULLS LAST, created_at DESC`),
      rows(sql`SELECT * FROM adl_requirements WHERE client_id = ${clientId} ORDER BY adl_category`),
    ])
    data.carePlans = plans
    data.adlRequirements = adlReq
  }
  if (wants.has('medications')) {
    const [meds, logs] = await Promise.all([
      rows(sql`SELECT m.*, m.name AS medication_name, m.prescribed_by AS prescriber, (m.status = 'active') AS is_active
        FROM medications m WHERE m.client_id = ${clientId} ORDER BY (m.status = 'active') DESC, m.name`),
      rows(sql`SELECT ml.*, ml.administered_at AS administered_time, m.name AS medication_name,
          u.first_name || ' ' || u.last_name AS caregiver_name
        FROM medication_logs ml
        LEFT JOIN medications m ON m.id = ml.medication_id
        LEFT JOIN users u ON u.id = ml.caregiver_id
        WHERE ml.client_id = ${clientId} AND ml.administered_at >= ${fromTs} AND ml.administered_at < ${toTs}
        ORDER BY ml.administered_at DESC`),
    ])
    data.medications = meds
    data.medicationLogs = logs
  }
  if (wants.has('adls')) {
    data.adlLogs = await rows(sql`SELECT al.*, u.first_name || ' ' || u.last_name AS caregiver_name
      FROM adl_logs al LEFT JOIN users u ON u.id = al.caregiver_id
      WHERE al.client_id = ${clientId} AND al.performed_at >= ${fromTs} AND al.performed_at < ${toTs}
      ORDER BY al.performed_at DESC`)
  }
  if (wants.has('visits')) {
    data.visits = await rows(sql`SELECT te.id, te.start_time, te.end_time, te.duration_minutes,
        te.clock_in_location, te.clock_out_location, te.notes, te.is_complete,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        ev.service_code, ev.modifier, ev.units_of_service, ev.sandata_status, ev.sandata_visit_id,
        ev.gps_in_lat, ev.gps_in_lng, ev.gps_out_lat, ev.gps_out_lng,
        ev.is_verified AS evv_verified, ev.sandata_exception_code, ev.sandata_exception_desc
      FROM time_entries te
      LEFT JOIN users u ON u.id = te.caregiver_id
      LEFT JOIN evv_visits ev ON ev.time_entry_id = te.id
      WHERE te.client_id = ${clientId} AND te.start_time >= ${fromTs} AND te.start_time < ${toTs}
      ORDER BY te.start_time DESC`)
  }
  if (wants.has('incidents')) {
    data.incidents = await rows(sql`SELECT ir.*, ir.date AS incident_date, ir.action_taken AS actions_taken,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        rb.first_name || ' ' || rb.last_name AS reported_by
      FROM incidents ir
      LEFT JOIN users u ON u.id = ir.caregiver_id
      LEFT JOIN users rb ON rb.id = ir.reported_by_id
      WHERE ir.client_id = ${clientId}
        AND COALESCE(ir.date, ${localDate(sql`ir.created_at`, tz)}) BETWEEN (${from})::date AND (${to})::date
      ORDER BY ir.date DESC NULLS LAST, ir.created_at DESC`)
  }
  if (wants.has('communications')) {
    data.communications = await rows(sql`SELECT cl.* FROM communication_log cl
      WHERE ((cl.entity_type = 'client' AND cl.entity_id = ${clientId}) OR cl.client_id = ${clientId})
        AND cl.created_at >= ${fromTs} AND cl.created_at < ${toTs}
      ORDER BY cl.is_pinned DESC, cl.created_at DESC`)
  }
  if (wants.has('documents')) {
    data.documents = await rows(sql`SELECT id, document_key AS document_type, title AS name, status,
        sent_at, signed_at, declined_at, voided_at, created_at
      FROM client_documents WHERE client_id = ${clientId} ORDER BY created_at DESC`)
  }
  if (wants.has('authorizations')) {
    data.authorizations = await rows(sql`SELECT a.id, a.auth_number, a.midas_auth_id, a.procedure_code, a.modifier,
        a.authorized_units, a.used_units, (a.authorized_units - COALESCE(a.used_units, 0)) AS remaining_units,
        a.unit_type, a.start_date, a.end_date, a.status, rs.name AS payer_name
      FROM authorizations a LEFT JOIN referral_sources rs ON rs.id = a.payer_id
      WHERE a.client_id = ${clientId}
      ORDER BY a.end_date DESC NULLS LAST`)
  }
  if (wants.has('billing')) {
    data.invoices = await rows(sql`SELECT id, invoice_number, billing_period_start, billing_period_end,
        subtotal, tax, total, payment_status, payment_due_date, payment_date, payment_method
      FROM invoices
      WHERE client_id = ${clientId} AND billing_period_end >= (${from})::date AND billing_period_start <= (${to})::date
      ORDER BY billing_period_start DESC`)
  }
  if (wants.has('audit')) {
    // audit_logs records reads of and changes to the client row itself (record_id = clientId).
    data.auditLog = await rows(sql`SELECT al.action, al.table_name, al.timestamp, al.ip_address,
        u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email
      FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
      WHERE al.record_id = ${clientId} AND al.timestamp >= ${fromTs} AND al.timestamp < ${toTs}
      ORDER BY al.timestamp DESC
      LIMIT 500`)
  }
  return data
}

async function parseClientReportParams(c: any, tz: string): Promise<{ from: string; to: string; sections: string[] } | { error: string }> {
  const today = await agencyToday(tz)
  const from = c.req.query('from') || addDays(today, -90)
  const to = c.req.query('to') || today
  if (!isYmd(from) || !isYmd(to)) return { error: 'from and to must be YYYY-MM-DD dates' }
  if (from > to) return { error: 'from must be on or before to' }
  const sectionsParam = String(c.req.query('sections') || '').trim()
  const sections = sectionsParam
    ? sectionsParam.split(',').map((s) => s.trim()).filter((s) => ALL_CLIENT_REPORT_SECTIONS.includes(s))
    : ALL_CLIENT_REPORT_SECTIONS
  return { from, to, sections }
}

async function logReportGeneration(userId: string, clientId: string, from: string, to: string, sections: string[], format: string) {
  try {
    await db.insert(auditLogs).values({
      userId, action: `REPORT_GENERATED_${format.toUpperCase()}`, tableName: 'clients', recordId: clientId,
      newData: { from, to, sections },
    })
  } catch (e: any) {
    // Never block the report on an audit-log write failure.
    console.error('Failed to log report generation:', e?.message)
  }
}

// GET /api/reports/client/:id — JSON preview (counts) for the report dialog
app.get('/client/:id', async (c) => {
  const tz = await agencyTimezone()
  const p = await parseClientReportParams(c, tz)
  if ('error' in p) return c.json({ error: p.error }, 400)
  const data = await fetchClientReportData(c.req.param('id'), p.from, p.to, p.sections, tz)
  if (!data) return c.json({ error: 'Client not found' }, 404)
  await logReportGeneration((c.get('user') as any)?.userId || (c.get('user') as any)?.id, c.req.param('id'), p.from, p.to, p.sections, 'json')
  return c.json(data)
})

// GET /api/reports/client/:id/pdf — the downloadable report
app.get('/client/:id/pdf', async (c) => {
  const tz = await agencyTimezone()
  const p = await parseClientReportParams(c, tz)
  if ('error' in p) return c.json({ error: p.error }, 400)
  const data = await fetchClientReportData(c.req.param('id'), p.from, p.to, p.sections, tz)
  if (!data) return c.json({ error: 'Client not found' }, 404)
  await logReportGeneration((c.get('user') as any)?.userId || (c.get('user') as any)?.id, c.req.param('id'), p.from, p.to, p.sections, 'pdf')
  const brand = await one(sql`SELECT name, primary_color FROM agencies ORDER BY created_at LIMIT 1`)
  const name = `${data.client.first_name}-${data.client.last_name}`.replace(/[^A-Za-z0-9-]/g, '')
  const buf = await renderPdf((doc) => renderClientReportPdf(doc, data, brand.name || 'Home Care Agency', brandColor(brand.primary_color)), { bufferPages: true })
  return pdfResponse(`client-report-${name}-${p.from}-to-${p.to}.pdf`, buf)
})

const brandColor = (v: any) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#0F766E')

function renderClientReportPdf(doc: PDFKit.PDFDocument, data: any, agency: string, ACCENT: string) {
  const INK = '#111827', MUTED = '#6B7280', RULE = '#E5E7EB'
  const tz = data.timezone
  const fmtDate = (v: any) => {
    if (!v) return '—'
    const s = String(v)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC' })
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { timeZone: tz })
  }
  const fmtDateTime = (v: any) => {
    if (!v) return '—'
    const s = String(v)
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
    return isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { timeZone: tz })
  }
  const fmtMoney = (v: any) => {
    const n = parseFloat(v)
    return isNaN(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const safe = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v)
  const minutesToHours = (m: any) => (m == null) ? '—' : (Number(m) / 60).toFixed(2) + ' h'
  const list = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.trim().startsWith('[') ? (() => { try { return JSON.parse(v) } catch { return [] } })() : [])
  const ensureSpace = (needed: number) => { if (doc.y + needed > doc.page.height - 60) doc.addPage() }
  const sectionHeader = (title: string) => {
    ensureSpace(40)
    doc.moveDown(0.75)
    doc.fillColor(ACCENT).fontSize(13).font('Helvetica-Bold').text(title, 50, doc.y, { paragraphGap: 2 })
    const y = doc.y
    doc.moveTo(50, y).lineTo(562, y).strokeColor(ACCENT).lineWidth(1.2).stroke()
    doc.moveDown(0.4)
    doc.fillColor(INK).fontSize(10).font('Helvetica')
  }
  const kv = (label: string, value: any) => {
    ensureSpace(14)
    doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(label, 50, doc.y, { width: 140, continued: true })
    doc.fillColor(INK).font('Helvetica').text(safe(value), { width: 370 })
  }
  const paragraph = (text: any) => {
    ensureSpace(20)
    doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(text), 50, doc.y, { width: 512 })
    doc.moveDown(0.3)
  }
  const emptyNote = (msg: string) => {
    doc.fontSize(10).fillColor(MUTED).font('Helvetica-Oblique').text(msg, 50, doc.y)
    doc.fillColor(INK).font('Helvetica')
  }
  type TCol = { label: string; w: number; key?: string; get?: (r: any) => any }
  const renderTable = (columns: TCol[], data: any[]) => {
    if (!data || data.length === 0) { emptyNote('No records in this period.'); return }
    const totalWidth = 512
    const colWidths = columns.map((c) => Math.floor(totalWidth * c.w))
    const startX = 50
    ensureSpace(24)
    let y = doc.y
    doc.rect(startX, y, totalWidth, 18).fill(ACCENT)
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
    let x = startX
    columns.forEach((c, i) => { doc.text(c.label, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true }); x += colWidths[i] })
    doc.fillColor(INK).font('Helvetica')
    y += 18
    doc.y = y
    data.forEach((row, idx) => {
      const cellTexts = columns.map((c) => safe(typeof c.get === 'function' ? c.get(row) : row[c.key as string]))
      doc.fontSize(8.5).font('Helvetica')
      let maxH = 12
      cellTexts.forEach((t, i) => { const h = doc.heightOfString(t, { width: colWidths[i] - 8 }); if (h > maxH) maxH = h })
      const rowH = maxH + 6
      ensureSpace(rowH + 2)
      y = doc.y
      if (idx % 2 === 0) doc.rect(startX, y, totalWidth, rowH).fill('#F9FAFB')
      doc.fillColor(INK)
      x = startX
      cellTexts.forEach((t, i) => { doc.text(t, x + 4, y + 3, { width: colWidths[i] - 8, height: rowH }); x += colWidths[i] })
      doc.moveTo(startX, y + rowH).lineTo(startX + totalWidth, y + rowH).strokeColor(RULE).lineWidth(0.5).stroke()
      doc.y = y + rowH
    })
    doc.moveDown(0.3)
  }

  // Header
  doc.rect(0, 0, doc.page.width, 72).fill(ACCENT)
  doc.fillColor('#fff').fontSize(18).font('Helvetica-Bold').text(agency, 50, 18)
  doc.fontSize(12).font('Helvetica').text('Client Comprehensive Report', 50, 42)
  doc.fillColor(INK)
  doc.y = 90
  const c = data.client
  doc.fontSize(20).font('Helvetica-Bold').text(`${c.first_name} ${c.last_name}`, 50, doc.y)
  doc.moveDown(0.2)
  doc.fontSize(10).fillColor(MUTED).font('Helvetica').text(`Report Period: ${fmtDate(data.period.from)} – ${fmtDate(data.period.to)}`)
  doc.fillColor(INK)
  doc.moveDown(0.8)

  sectionHeader('Client Information')
  kv('Date of Birth', c.date_of_birth ? fmtDate(c.date_of_birth) : null)
  kv('Gender', c.gender)
  kv('Phone', c.phone)
  kv('Email', c.email)
  kv('Address', [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '))
  kv('Service Start', c.start_date ? fmtDate(c.start_date) : null)
  kv('Service Type', c.service_type)
  kv('Care Type', c.care_type_name)
  kv('Referral Source', c.referral_source_name)
  kv('Status', c.is_active ? 'Active' : 'Inactive')

  sectionHeader('Insurance & Identifiers')
  kv('Primary Insurance', c.insurance_provider)
  kv('Insurance ID', c.insurance_id)
  kv('Medicaid ID', c.medicaid_id)
  kv('MCO Member ID', c.mco_member_id)
  kv('Primary Diagnosis', c.primary_diagnosis_code)
  kv('Secondary Diagnosis', c.secondary_diagnosis_code)
  if (c.is_private_pay) kv('Private Pay Rate', c.private_pay_rate ? `$${c.private_pay_rate} / ${c.private_pay_rate_type || 'hourly'}` : null)

  const conditions = list(c.medical_conditions), allergies = list(c.allergies), medsSummary = list(c.medications)
  if (conditions.length || allergies.length || medsSummary.length) {
    sectionHeader('Medical Overview')
    if (conditions.length) kv('Conditions', conditions.join(', '))
    if (allergies.length) kv('Allergies', allergies.join(', '))
    if (medsSummary.length) kv('Medications (summary)', medsSummary.join(', '))
  }

  sectionHeader('Emergency Contacts')
  if (data.emergencyContacts.length === 0) emptyNote('No emergency contacts on file.')
  else renderTable([
    { label: 'Name', w: 0.28, key: 'name' }, { label: 'Relationship', w: 0.20, key: 'relationship' },
    { label: 'Phone', w: 0.22, key: 'phone' }, { label: 'Email', w: 0.22, key: 'email' },
    { label: 'Primary', w: 0.08, get: (r) => r.is_primary ? 'Yes' : '' },
  ], data.emergencyContacts)

  sectionHeader('Caregiver Assignments')
  if (data.assignments.length === 0) emptyNote('No caregiver assignments on record.')
  else renderTable([
    { label: 'Caregiver', w: 0.32, key: 'caregiver_name' }, { label: 'Assigned', w: 0.18, get: (r) => fmtDate(r.assignment_date) },
    { label: 'Hrs/Wk', w: 0.12, key: 'hours_per_week' }, { label: 'Status', w: 0.18, key: 'status' },
    { label: 'Notes', w: 0.20, key: 'notes' },
  ], data.assignments)

  if (data.carePlans) {
    sectionHeader('Care Plan')
    if (data.carePlans.length === 0) emptyNote('No care plan on file.')
    data.carePlans.forEach((cp: any) => {
      ensureSpace(60)
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(`${safe(cp.service_type)} — ${fmtDate(cp.start_date)} to ${fmtDate(cp.end_date)}`, 50, doc.y)
      doc.font('Helvetica').fontSize(9)
      if (cp.service_description) paragraph(`Service: ${cp.service_description}`)
      if (cp.frequency) paragraph(`Frequency: ${cp.frequency}`)
      if (cp.care_goals) paragraph(`Goals: ${cp.care_goals}`)
      if (cp.special_instructions) paragraph(`Special Instructions: ${cp.special_instructions}`)
      if (cp.precautions) paragraph(`Precautions: ${cp.precautions}`)
      if (cp.medication_notes) paragraph(`Medication Notes: ${cp.medication_notes}`)
      if (cp.mobility_notes) paragraph(`Mobility: ${cp.mobility_notes}`)
      if (cp.dietary_notes) paragraph(`Diet: ${cp.dietary_notes}`)
      if (cp.communication_notes) paragraph(`Communication: ${cp.communication_notes}`)
      doc.moveDown(0.3)
    })
    if (data.adlRequirements?.length) {
      doc.moveDown(0.2)
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('ADL Requirements', 50, doc.y)
      doc.moveDown(0.2)
      renderTable([
        { label: 'Category', w: 0.22, key: 'adl_category' }, { label: 'Assistance', w: 0.18, key: 'assistance_level' },
        { label: 'Frequency', w: 0.18, key: 'frequency' }, { label: 'Instructions', w: 0.42, key: 'special_instructions' },
      ], data.adlRequirements)
    }
  }

  if (data.medications) {
    sectionHeader('Medications')
    if (data.medications.length === 0) emptyNote('No medications on file.')
    else renderTable([
      { label: 'Medication', w: 0.26, key: 'medication_name' }, { label: 'Dosage', w: 0.12, key: 'dosage' },
      { label: 'Frequency', w: 0.15, key: 'frequency' }, { label: 'Route', w: 0.10, key: 'route' },
      { label: 'Prescriber', w: 0.20, key: 'prescriber' }, { label: 'Active', w: 0.09, get: (r) => r.is_active ? 'Yes' : 'No' },
      { label: 'PRN', w: 0.08, get: (r) => r.is_prn ? 'Yes' : '' },
    ], data.medications)
    if (data.medicationLogs) {
      doc.moveDown(0.3)
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Medication Administration (period)', 50, doc.y)
      doc.moveDown(0.2)
      renderTable([
        { label: 'Administered', w: 0.24, get: (r) => fmtDateTime(r.administered_time) },
        { label: 'Medication', w: 0.24, key: 'medication_name' }, { label: 'Status', w: 0.14, key: 'status' },
        { label: 'Caregiver', w: 0.20, key: 'caregiver_name' }, { label: 'Notes', w: 0.18, key: 'notes' },
      ], data.medicationLogs)
    }
  }

  if (data.adlLogs) {
    sectionHeader('ADL Activity Log')
    renderTable([
      { label: 'When', w: 0.20, get: (r) => fmtDateTime(r.performed_at) }, { label: 'Category', w: 0.20, key: 'adl_category' },
      { label: 'Status', w: 0.12, key: 'status' }, { label: 'Assistance', w: 0.15, key: 'assistance_level' },
      { label: 'Caregiver', w: 0.18, key: 'caregiver_name' }, { label: 'Notes', w: 0.15, key: 'notes' },
    ], data.adlLogs)
  }

  if (data.visits) {
    const visits = data.visits
    const totalMinutes = visits.reduce((s: number, v: any) => s + (v.duration_minutes || 0), 0)
    sectionHeader(`Visit / EVV History  (${visits.length} visits • ${(totalMinutes / 60).toFixed(2)} hours)`)
    const loc = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
    renderTable([
      { label: 'Start', w: 0.16, get: (r) => fmtDateTime(r.start_time) },
      { label: 'End', w: 0.16, get: (r) => fmtDateTime(r.end_time) },
      { label: 'Dur.', w: 0.08, get: (r) => minutesToHours(r.duration_minutes) },
      { label: 'Caregiver', w: 0.18, key: 'caregiver_name' },
      { label: 'EVV / Sandata', w: 0.20, get: (r) => r.sandata_status ? `${r.sandata_status}${r.sandata_visit_id ? ' #' + r.sandata_visit_id : ''}` : (r.is_complete ? 'complete' : 'open') },
      { label: 'Service', w: 0.10, get: (r) => [r.service_code, r.modifier].filter(Boolean).join(' ') },
      { label: 'GPS', w: 0.12, get: (r) => {
        if (r.gps_in_lat) return `${Number(r.gps_in_lat).toFixed(4)},${Number(r.gps_in_lng).toFixed(4)}`
        const l = loc(r.clock_in_location)
        return l && l.lat ? `${Number(l.lat).toFixed(4)},${Number(l.lng).toFixed(4)}` : '—'
      } },
    ], visits)
  }

  if (data.incidents) {
    sectionHeader(`Incident Reports (${data.incidents.length})`)
    if (data.incidents.length === 0) emptyNote('No incidents reported in this period.')
    data.incidents.forEach((ir: any) => {
      ensureSpace(80)
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(`${safe(ir.incident_type).replace(/_/g, ' ').toUpperCase()} — ${fmtDate(ir.incident_date)}`, 50, doc.y)
      doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(`Severity: ${safe(ir.severity)}    Caregiver: ${safe(ir.caregiver_name)}    Reported by: ${safe(ir.reported_by)}`)
      doc.fillColor(INK).fontSize(10)
      if (ir.description) paragraph(`Description: ${ir.description}`)
      if (ir.witnesses) paragraph(`Witnesses: ${ir.witnesses}`)
      if (ir.injuries_or_damage) paragraph(`Injuries/Damage: ${ir.injuries_or_damage}`)
      if (ir.actions_taken) paragraph(`Actions Taken: ${ir.actions_taken}`)
      if (ir.follow_up_required) paragraph(`Follow-up: ${safe(ir.follow_up_notes)}`)
      doc.moveDown(0.2)
    })
  }

  if (data.communications) {
    sectionHeader(`Communication Log (${data.communications.length})`)
    if (data.communications.length === 0) emptyNote('No communications logged in this period.')
    data.communications.forEach((cm: any) => {
      ensureSpace(36)
      const tag = [cm.log_type, cm.direction, cm.is_pinned ? 'pinned' : null].filter(Boolean).join(' • ')
      doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(`${fmtDateTime(cm.created_at)} — ${tag} — by ${safe(cm.logged_by_name)}`, 50, doc.y)
      if (cm.subject) doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(safe(cm.subject), { width: 512 })
      doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(cm.body), { width: 512 })
      if (cm.follow_up_date) doc.fontSize(9).fillColor(MUTED).text(`Follow-up by ${fmtDate(cm.follow_up_date)} — ${cm.follow_up_done ? 'done' : 'open'}`)
      doc.fillColor(INK)
      doc.moveDown(0.3)
    })
  }

  if (data.documents) {
    sectionHeader(`Documents on File (${data.documents.length})`)
    if (data.documents.length === 0) emptyNote('No documents on file.')
    else renderTable([
      { label: 'Name', w: 0.34, key: 'name' }, { label: 'Type', w: 0.18, key: 'document_type' },
      { label: 'Sent', w: 0.16, get: (r) => fmtDate(r.sent_at) }, { label: 'Status', w: 0.14, key: 'status' },
      { label: 'Signed', w: 0.18, get: (r) => r.signed_at ? fmtDate(r.signed_at) : '—' },
    ], data.documents)
  }

  if (data.authorizations) {
    sectionHeader(`Authorizations (${data.authorizations.length})`)
    if (data.authorizations.length === 0) emptyNote('No authorizations on file.')
    else renderTable([
      { label: 'Auth #', w: 0.14, key: 'auth_number' }, { label: 'Payer', w: 0.18, key: 'payer_name' },
      { label: 'Code', w: 0.10, get: (r) => [r.procedure_code, r.modifier].filter(Boolean).join(' ') },
      { label: 'Period', w: 0.20, get: (r) => `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}` },
      { label: 'Authorized', w: 0.10, key: 'authorized_units' }, { label: 'Used', w: 0.08, key: 'used_units' },
      { label: 'Remaining', w: 0.10, key: 'remaining_units' }, { label: 'Status', w: 0.10, key: 'status' },
    ], data.authorizations)
  }

  if (data.invoices) {
    const total = data.invoices.reduce((s: number, i: any) => s + (parseFloat(i.total) || 0), 0)
    sectionHeader(`Invoices in Period (${data.invoices.length} • ${fmtMoney(total)} total)`)
    if (data.invoices.length === 0) emptyNote('No invoices in this period.')
    else renderTable([
      { label: 'Invoice #', w: 0.18, key: 'invoice_number' },
      { label: 'Period', w: 0.26, get: (r) => `${fmtDate(r.billing_period_start)} – ${fmtDate(r.billing_period_end)}` },
      { label: 'Total', w: 0.14, get: (r) => fmtMoney(r.total) }, { label: 'Status', w: 0.14, key: 'payment_status' },
      { label: 'Due', w: 0.14, get: (r) => fmtDate(r.payment_due_date) }, { label: 'Paid', w: 0.14, get: (r) => fmtDate(r.payment_date) },
    ], data.invoices)
  }

  if (data.auditLog) {
    sectionHeader(`Access / Change Audit Trail (${data.auditLog.length})`)
    if (data.auditLog.length === 0) emptyNote('No audit events in this period.')
    else renderTable([
      { label: 'When', w: 0.26, get: (r) => fmtDateTime(r.timestamp) }, { label: 'User', w: 0.26, key: 'user_name' },
      { label: 'Action', w: 0.26, key: 'action' }, { label: 'Table', w: 0.14, key: 'table_name' },
      { label: 'IP', w: 0.08, key: 'ip_address' },
    ], data.auditLog)
  }

  // Footer — page numbers
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(
      `${agency} • Confidential Client Record • Page ${i + 1} of ${range.count}`,
      50, doc.page.height - 40, { width: 512, align: 'center', lineBreak: false },
    )
  }
}

// ==================== EXPORTS ====================
// POST /api/reports/:type/export  { startDate, endDate, format: 'csv' | 'pdf' } — tabular export.
app.post('/:type/export', async (c) => {
  const type = c.req.param('type')
  const body = await postBody(c)
  const format = body.format || 'csv'
  if (format !== 'csv' && format !== 'pdf') return c.json({ error: `Unsupported format: ${format}` }, 400)
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const range = parseRange(body.startDate, body.endDate, `${today.slice(0, 8)}01`, today)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate: sd, endDate: ed } = range
  const inRange = sql`te.start_time >= ${dayStartUtc(sd, tz)} AND te.start_time < ${dayEndUtc(ed, tz)} AND te.is_complete = true`

  let data: any[]
  if (type === 'overview' || type === 'caregiver_hours' || type === 'caregiver-hours') {
    // Capped/cleaned minutes, not raw duration: raw is inflated by every missed clock-out.
    data = await rows(sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
        COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 0) AS actual_hours,
        COUNT(te.id)::int AS shifts, COUNT(DISTINCT te.client_id)::int AS unique_clients
      FROM users u LEFT JOIN time_entries te ON te.caregiver_id = u.id AND ${inRange}
      WHERE u.role = 'caregiver'
      GROUP BY u.id, u.first_name, u.last_name ORDER BY actual_hours DESC`)
  } else if (type === 'billing' || type === 'revenue') {
    data = await rows(sql`SELECT c.first_name || ' ' || c.last_name AS client,
        i.invoice_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS billing_period_start,
        to_char(i.billing_period_end, 'YYYY-MM-DD') AS billing_period_end,
        i.total, i.amount_paid, i.payment_status, COALESCE(rs.name, 'Private Pay') AS payer
      FROM invoices i JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
      WHERE i.billing_period_start >= (${sd})::date AND i.billing_period_end <= (${ed})::date
      ORDER BY i.billing_period_start DESC, c.last_name`)
  } else if (type === 'compliance') {
    data = await rows(sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
        bc.status AS background_check_status,
        to_char(bc.initiated_date, 'YYYY-MM-DD') AS initiated_date, to_char(bc.expiration_date, 'YYYY-MM-DD') AS expiration_date,
        CASE WHEN bc.expiration_date < (${today})::date THEN 'EXPIRED'
             WHEN bc.expiration_date < (${today})::date + 60 THEN 'Expiring Soon'
             WHEN bc.expiration_date IS NULL THEN 'No Check on File'
             ELSE 'Current' END AS expiry_status,
        u.certifications
      FROM users u
      LEFT JOIN background_checks bc ON bc.caregiver_id = u.id
        AND bc.id = (SELECT id FROM background_checks bc2 WHERE bc2.caregiver_id = u.id ORDER BY initiated_date DESC NULLS LAST LIMIT 1)
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY bc.expiration_date ASC NULLS FIRST, u.last_name`)
  } else if (type === 'clients') {
    data = await rows(sql`SELECT c.first_name || ' ' || c.last_name AS client,
        c.email, c.phone, c.city, c.state, c.service_type,
        CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END AS status,
        to_char(${localDate(sql`c.created_at`, tz)}, 'YYYY-MM-DD') AS enrolled_date,
        COALESCE(rs.name, 'Unknown') AS referral_source,
        COUNT(DISTINCT s.caregiver_id)::int AS assigned_caregivers
      FROM clients c
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
      LEFT JOIN schedules s ON s.client_id = c.id AND s.is_active = true
      WHERE c.is_active = true
      GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, c.city, c.state, c.service_type, c.is_active, c.created_at, rs.name
      ORDER BY c.last_name`)
  } else if (type === 'payroll') {
    // An ESTIMATE from capped clocked minutes × pay rate ($18/h when none is on file, CVHC's figure).
    // True pay comes from the payroll run.
    data = await rows(sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
        COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 0) AS hours_worked,
        COALESCE(u.default_pay_rate, 18.00) AS hourly_rate,
        COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0 * COALESCE(u.default_pay_rate, 18.00), 0) AS gross_pay,
        COUNT(te.id)::int AS shifts
      FROM users u LEFT JOIN time_entries te ON te.caregiver_id = u.id AND ${inRange}
      WHERE u.role = 'caregiver'
      GROUP BY u.id, u.first_name, u.last_name, u.default_pay_rate ORDER BY gross_pay DESC`)
  } else {
    data = await rows(sql`SELECT u.first_name || ' ' || u.last_name AS caregiver,
        COALESCE(SUM(COALESCE(te.billable_minutes, te.duration_minutes)) / 60.0, 0) AS hours
      FROM users u LEFT JOIN time_entries te ON te.caregiver_id = u.id AND ${inRange}
      WHERE u.role = 'caregiver'
      GROUP BY u.id, u.first_name, u.last_name ORDER BY hours DESC`)
  }

  const agency = await agencyName()
  const filename = `${slug(agency)}-${type}-report-${sd}-to-${ed}`
  if (format === 'csv') {
    const keys = data.length ? Object.keys(data[0]) : []
    return csvResponse(`${filename}.csv`, toCSV(data, keys.map((k) => ({ key: k, label: k }))))
  }
  const buf = await renderPdf((doc) => {
    doc.fontSize(18).fillColor('#0F766E').text(agency, 50, 50)
    doc.fontSize(13).fillColor('#333').text(`${type.replace(/[_-]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())} Report`, 50, 75)
    doc.fontSize(10).fillColor('#666').text(`Period: ${sd} – ${ed}`, 50, 95)
    doc.moveTo(50, 130).lineTo(562, 130).strokeColor('#0F766E').stroke()
    if (data.length === 0) {
      doc.fontSize(12).fillColor('#666').text('No data found for the selected period.', 50, 150)
      return
    }
    const keys = Object.keys(data[0])
    const colWidth = Math.min(Math.floor(512 / keys.length), 120)
    let y = 150
    doc.fontSize(9).fillColor('#fff')
    doc.rect(50, y, 512, 18).fill('#0F766E')
    keys.forEach((key, i) => { doc.fillColor('#fff').text(key.replace(/_/g, ' ').toUpperCase(), 53 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true }) })
    y += 20
    data.forEach((row, rowIdx) => {
      if (y > 700) { doc.addPage(); y = 50 }
      if (rowIdx % 2 === 0) doc.rect(50, y, 512, 16).fill('#F9FAFB')
      doc.fontSize(8).fillColor('#333')
      keys.forEach((key, i) => {
        const val = row[key] !== null && row[key] !== undefined ? (typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])) : '—'
        doc.text(val, 53 + i * colWidth, y + 3, { width: colWidth - 4, ellipsis: true, lineBreak: false })
      })
      y += 18
    })
    doc.fontSize(10).fillColor('#333').text(`Total Records: ${data.length}`, 50, y + 10)
  })
  return pdfResponse(`${filename}.pdf`, buf)
})

// POST /api/reports/:type/export-pdf  { startDate, endDate } — the summary PDF for the tab on screen.
app.post('/:type/export-pdf', async (c) => {
  const type = c.req.param('type')
  const body = await postBody(c)
  const tz = await agencyTimezone()
  const { defStart, defEnd } = await defaultRange(tz)
  const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
  if ('error' in range) return c.json({ error: range.error }, 400)
  const { startDate, endDate } = range

  let reportData: any = {}
  if (type === 'overview' || type === 'hours') {
    const [summary, caregivers] = await Promise.all([
      one(sql`WITH ${occurrencesCte(startDate, endDate)} SELECT COALESCE(SUM(occ.hours), 0) AS total_hours, COUNT(*)::int AS total_shifts FROM occ`),
      rows(sql`WITH ${occurrencesCte(startDate, endDate)}
        SELECT u.first_name || ' ' || u.last_name AS name, COALESCE(SUM(occ.hours), 0) AS hours, COUNT(DISTINCT occ.client_id)::int AS clients
        FROM users u LEFT JOIN occ ON occ.caregiver_id = u.id
        WHERE u.role = 'caregiver' AND u.is_active = true
        GROUP BY u.id, u.first_name, u.last_name ORDER BY hours DESC LIMIT 20`),
    ])
    reportData = { summary, caregivers }
  } else if (type === 'performance') {
    reportData = { caregivers: await rows(sql`SELECT u.first_name || ' ' || u.last_name AS name,
        COALESCE(AVG(pr.satisfaction_score), 0) AS avg_rating, COUNT(DISTINCT pr.id)::int AS ratings,
        COUNT(DISTINCT s.client_id)::int AS clients
      FROM users u
      LEFT JOIN performance_ratings pr ON pr.caregiver_id = u.id AND ${ratedOn(tz)} BETWEEN (${startDate})::date AND (${endDate})::date
      LEFT JOIN schedules s ON s.caregiver_id = u.id AND s.is_active = true
      WHERE u.role = 'caregiver' AND u.is_active = true
      GROUP BY u.id, u.first_name, u.last_name ORDER BY avg_rating DESC`) }
  } else if (type === 'revenue') {
    reportData = { revenue: await one(sql`SELECT COALESCE(SUM(total), 0) AS total_billed, COALESCE(SUM(amount_paid), 0) AS collected,
        COUNT(*)::int AS invoice_count
      FROM invoices WHERE billing_period_start >= (${startDate})::date AND billing_period_end <= (${endDate})::date`) }
  }

  const agency = await agencyName()
  const buf = await renderPdf((doc) => {
    doc.rect(0, 0, doc.page.width, 80).fill('#0F766E')
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text(agency, 50, 22)
    doc.fontSize(12).font('Helvetica').text(`${type.charAt(0).toUpperCase() + type.slice(1)} Report  •  ${startDate} to ${endDate}`, 50, 50)
    doc.fillColor('#111827')
    doc.y = 110
    if (type === 'overview' || type === 'hours') {
      const { summary, caregivers } = reportData
      doc.fontSize(16).font('Helvetica-Bold').text('Summary', 50, doc.y, { underline: true })
      doc.moveDown(0.5)
      doc.fontSize(12).font('Helvetica')
      doc.text(`Total Scheduled Hours: ${num(summary?.total_hours).toFixed(2)}`)
      doc.text(`Total Shifts: ${summary?.total_shifts || 0}`)
      doc.moveDown(1.5)
      doc.fontSize(14).font('Helvetica-Bold').text('Caregiver Breakdown', { underline: true })
      doc.moveDown(0.5)
      doc.fontSize(10).font('Helvetica-Bold')
      let y = doc.y
      doc.text('Caregiver', 50, y, { width: 200 }); doc.text('Hours', 250, y, { width: 80 }); doc.text('Clients', 330, y, { width: 80 })
      doc.moveTo(50, y + 14).lineTo(480, y + 14).stroke('#E5E7EB')
      doc.font('Helvetica').fontSize(10)
      y += 20
      for (const cg of caregivers || []) {
        if (y > 700) { doc.addPage(); y = 50 }
        doc.fillColor('#111827')
        doc.text(String(cg.name), 50, y, { width: 200 }); doc.text(num(cg.hours).toFixed(2), 250, y, { width: 80 }); doc.text(String(cg.clients || 0), 330, y, { width: 80 })
        y += 16
      }
    } else if (type === 'performance') {
      doc.fontSize(16).font('Helvetica-Bold').text('Caregiver Performance', 50, doc.y, { underline: true })
      doc.moveDown(0.5)
      doc.fontSize(10).font('Helvetica-Bold')
      let y = doc.y
      doc.text('Caregiver', 50, y, { width: 200 }); doc.text('Avg Rating', 250, y, { width: 100 }); doc.text('Reviews', 350, y, { width: 80 })
      doc.moveTo(50, y + 14).lineTo(480, y + 14).stroke('#E5E7EB')
      doc.font('Helvetica')
      y += 20
      for (const cg of reportData.caregivers || []) {
        if (y > 700) { doc.addPage(); y = 50 }
        doc.text(String(cg.name), 50, y, { width: 200 }); doc.text(num(cg.avg_rating).toFixed(1) + ' / 5', 250, y, { width: 100 }); doc.text(String(cg.ratings || 0), 350, y, { width: 80 })
        y += 16
      }
    } else if (type === 'revenue') {
      const { revenue } = reportData
      const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      doc.fontSize(16).font('Helvetica-Bold').text('Revenue Summary', 50, doc.y, { underline: true })
      doc.moveDown(0.5)
      doc.fontSize(12).font('Helvetica')
      doc.text(`Total Billed: ${money(num(revenue?.total_billed))}`)
      doc.text(`Total Collected: ${money(num(revenue?.collected))}`)
      doc.text(`Total Invoices: ${revenue?.invoice_count || 0}`)
      doc.text(`Outstanding: ${money(num(revenue?.total_billed) - num(revenue?.collected))}`)
    } else {
      doc.fontSize(12).font('Helvetica').text('This report has no PDF summary — use the CSV export.', 50, doc.y)
    }
  })
  return pdfResponse(`${slug(agency)}-${type}-report-${startDate}-to-${endDate}.pdf`, buf)
})

export default app
