// Revenue forecasting — ported from CVHC routes/forecastRoutes.js (b2456a2).
//
// Projections come off the shared schedule engine, so the forecast matches what payroll and billing
// see (the old queries had no effective/end date bound, no cancellations, and expanded bi-weekly
// shifts every week). Dollar values use each client's REAL rate — the private-pay rate, or the
// payer's contracted rate for the client's care type effective that day. The weekly projection and
// the caregiver view fall back to $18.50/h only where no rate is on file (CVHC's figure, stated on
// the screen); the authorization view never invents one.
import { Hono } from 'hono'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { agencyTimezone, agencyToday, addDays } from '../services/agencyTime.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows || []

const FALLBACK_HOURLY = 18.5

const payerRateLateral = (dateExpr: SQL) => sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN r.rate_type = '15min' THEN r.rate_amount * 4 ELSE r.rate_amount END AS hourly
    FROM referral_source_rates r
    WHERE r.referral_source_id = c.referred_by_id AND r.care_type_id = c.care_type_id
      AND r.is_active = true
      AND (r.effective_date IS NULL OR r.effective_date <= ${dateExpr})
      AND (r.end_date IS NULL OR r.end_date >= ${dateExpr})
    ORDER BY r.effective_date DESC NULLS LAST LIMIT 1
  ) prate ON true`

// GET /api/forecast/revenue?months=3
app.get('/revenue', async (c) => {
  const months = Math.max(1, Math.min(36, parseInt(c.req.query('months') || '3', 10) || 3))
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const since = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10) })()

  const [actual, projected, weekly, topClients] = await Promise.all([
    // Actual billed revenue by month — claims, dated by service date (the same date Reports uses, so
    // a claim shows up in both or in neither). Voided and rejected claims are out.
    rows(sql`SELECT to_char(DATE_TRUNC('month', cl.service_date), 'YYYY-MM-DD') AS period,
        SUM(cl.billed_amount) AS billed, SUM(cl.paid_amount) AS collected, COUNT(*)::int AS claim_count
      FROM claims cl
      WHERE cl.service_date >= (${since})::date AND COALESCE(cl.status, '') NOT IN ('voided', 'rejected')
      GROUP BY 1 ORDER BY 1`),
    // Weekly authorization vs schedule, per client. Authorized units are WEEKLY hours ('15min' units
    // ÷ 4); a client with an active schedule is live, whatever the paper auth dates say.
    rows(sql`WITH ${occurrencesCte('occ', today, addDays(today, 6))},
      sched AS (SELECT client_id, SUM(hours) AS hrs FROM occ GROUP BY client_id),
      auths AS (
        SELECT client_id,
          SUM(CASE WHEN unit_type = '15min' THEN COALESCE(authorized_units, 0) / 4.0 ELSE COALESCE(authorized_units, 0) END) AS weekly_hours,
          MAX(end_date) AS end_date
        FROM authorizations WHERE status = 'active'
        GROUP BY client_id
      )
      SELECT c.id AS client_id, c.first_name || ' ' || c.last_name AS client_name,
        c.service_type,
        a.weekly_hours AS authorized_hours,
        COALESCE(s.hrs, 0) AS used_hours,
        GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0) AS remaining_hours,
        CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END AS hourly_rate,
        GREATEST(a.weekly_hours - COALESCE(s.hrs, 0), 0)
          * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, 0) AS projected_remaining_revenue,
        to_char(a.end_date, 'YYYY-MM-DD') AS end_date
      FROM auths a
      JOIN clients c ON c.id = a.client_id AND c.is_active = true
      LEFT JOIN sched s ON s.client_id = c.id
      ${payerRateLateral(sql`(${today})::date`)}
      ORDER BY projected_remaining_revenue DESC, authorized_hours DESC`),
    // Scheduled hours and estimated revenue, this week and the next three.
    rows(sql`WITH ${occurrencesCte('occ', today, addDays(today, 27))}
      SELECT to_char(DATE_TRUNC('week', occ.occ_date), 'YYYY-MM-DD') AS week_start,
        COUNT(DISTINCT occ.caregiver_id)::int AS caregiver_count,
        COUNT(*)::int AS shift_count,
        SUM(occ.hours) AS scheduled_hours,
        SUM(occ.hours * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, ${FALLBACK_HOURLY})) AS estimated_revenue
      FROM occ
      JOIN clients c ON c.id = occ.client_id
      ${payerRateLateral(sql`occ.occ_date`)}
      GROUP BY 1 ORDER BY 1`),
    // Top clients by billed claims, last 90 days.
    rows(sql`SELECT cl.client_id, c.first_name || ' ' || c.last_name AS client_name,
        SUM(cl.billed_amount) AS total_billed, SUM(cl.paid_amount) AS total_collected,
        COUNT(*)::int AS claim_count, AVG(cl.billed_amount) AS avg_claim
      FROM claims cl JOIN clients c ON cl.client_id = c.id
      WHERE cl.service_date >= (${addDays(today, -90)})::date AND COALESCE(cl.status, '') NOT IN ('voided', 'rejected')
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`),
  ])

  // KPI tiles derive from the per-client rows above, so they can never disagree with the table.
  const totAuth = projected.reduce((s, r) => s + (parseFloat(r.authorized_hours) || 0), 0)
  const totSched = projected.reduce((s, r) => s + (parseFloat(r.used_hours) || 0), 0)
  const authSummary = {
    total_active_auths: projected.length,
    total_auth_hours: totAuth,
    total_used_hours: totSched,
    avg_utilization_pct: totAuth > 0 ? Math.round((totSched / totAuth) * 1000) / 10 : 0,
    total_projected_remaining: projected.reduce((s, r) => s + (parseFloat(r.projected_remaining_revenue) || 0), 0),
    unvalued_clients: projected.filter((r) => r.hourly_rate == null && parseFloat(r.remaining_hours) > 0).length,
  }

  return c.json({ actual, projected, weekly, topClients, authSummary })
})

// GET /api/forecast/caregiver-utilization — each caregiver's scheduled hours over the next 7 days.
app.get('/caregiver-utilization', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const result = await rows(sql`WITH ${occurrencesCte('occ', today, addDays(today, 6))}
    SELECT u.id, u.first_name || ' ' || u.last_name AS caregiver_name,
      COUNT(DISTINCT occ.client_id)::int AS client_count,
      COALESCE(SUM(occ.hours), 0) AS weekly_hours,
      COALESCE(SUM(occ.hours * COALESCE(CASE WHEN c.is_private_pay THEN c.private_pay_rate ELSE prate.hourly END, ${FALLBACK_HOURLY})), 0) AS weekly_revenue
    FROM users u
    LEFT JOIN occ ON occ.caregiver_id = u.id
    LEFT JOIN clients c ON c.id = occ.client_id
    ${payerRateLateral(sql`occ.occ_date`)}
    WHERE u.role = 'caregiver' AND u.is_active = true
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY weekly_hours DESC NULLS LAST`)
  return c.json(result)
})

export default app
