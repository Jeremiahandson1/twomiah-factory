// Row 13 (docs/parity/homecare-margin-turnover.md): caregiver satisfaction surveys and the retention risk — the raw SQL (RULEBOOK §2).
// Every result is camelCase.
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import { localDate, type Q } from './homecareCore.ts'

const all = async (q: Q, s: any): Promise<any[]> => camelRows(await q.execute(s))
const isCaregiver = sql.raw(`u.role IN ('caregiver', 'field')`)

/** Every active caregiver with when they were hired and where they sit (branch, team, manager), for the survey triggers and the risk. */
export async function activeCaregivers(q: Q, companyId: string): Promise<any[]> {
  return all(q, sql`SELECT u.id, u.first_name, u.last_name, u.email, to_char(COALESCE(u.hire_date, u.created_at::date), 'YYYY-MM-DD') AS hired,
           cp.branch_id, sl.name AS branch_name, cp.team, cp.manager_user_id, m.first_name AS manager_first, m.last_name AS manager_last
      FROM "user" u
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = cp.branch_id
      LEFT JOIN "user" m ON m.id = cp.manager_user_id
     WHERE u.company_id = ${companyId} AND ${isCaregiver} AND u.is_active = true AND (cp.left_on IS NULL OR cp.left_on > CURRENT_DATE)
     ORDER BY u.last_name, u.first_name`)
}

/** The first completed visit of each (caregiver, client) pair whose first visit was on or after `since` (agency days). */
export async function firstVisitsWithClients(q: Q, companyId: string, since: string, tz: string): Promise<any[]> {
  const day = localDate(sql`te.start_time`, tz)
  return all(q, sql`SELECT te.caregiver_id, te.client_id, MIN(${day}) AS first_visit, c.first_name AS client_first, c.last_name AS client_last
      FROM time_entries te JOIN clients c ON c.id = te.client_id JOIN "user" u ON u.id = te.caregiver_id
     WHERE te.company_id = ${companyId} AND te.end_time IS NOT NULL AND ${isCaregiver} AND u.is_active = true
     GROUP BY te.caregiver_id, te.client_id, c.first_name, c.last_name
    HAVING MIN(${day}) >= ${since}::date`)
}

/**
 * The retention signals per active caregiver, as of `today`: hours a week over the last 4 weeks and over the 8 before, call-outs and
 * missed visits in the last 60 days, the latest survey score and when, surveys asked and never answered, days since the last visit.
 */
export async function riskSignals(q: Q, companyId: string, today: string, tz: string): Promise<any[]> {
  const day = localDate(sql`te.start_time`, tz)
  const minutes = sql`COALESCE(te.duration_minutes, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)`
  return all(q, sql`SELECT u.id,
      (SELECT COALESCE(SUM(${minutes}), 0) / 60.0 FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.end_time IS NOT NULL
         AND ${day} > ${today}::date - 28 AND ${day} <= ${today}::date) AS hours_last_4_weeks,
      (SELECT COALESCE(SUM(${minutes}), 0) / 60.0 FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.end_time IS NOT NULL
         AND ${day} > ${today}::date - 84 AND ${day} <= ${today}::date - 28) AS hours_previous_8_weeks,
      (SELECT MAX(${day}) FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.end_time IS NOT NULL) AS last_visit,
      (SELECT COUNT(*)::int FROM absences a WHERE a.company_id = ${companyId} AND a.caregiver_id = u.id AND a.date > ${today}::date - 60 AND a.date <= ${today}::date)
        + (SELECT COUNT(*)::int FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id WHERE se.company_id = ${companyId} AND s.caregiver_id = u.id
             AND se.exception_type = 'cancelled' AND se.cancel_reason = 'caregiver_callout' AND se.exception_date > ${today}::date - 60 AND se.exception_date <= ${today}::date) AS callouts_sixty_days,
      (SELECT COUNT(*)::int FROM noshow_alerts n WHERE n.company_id = ${companyId} AND n.caregiver_id = u.id AND n.shift_date > ${today}::date - 60 AND n.shift_date <= ${today}::date) AS missed_sixty_days,
      (SELECT r.score FROM caregiver_survey_request r WHERE r.company_id = ${companyId} AND r.caregiver_id = u.id AND r.answered_at IS NOT NULL ORDER BY r.answered_at DESC LIMIT 1) AS latest_score,
      (SELECT to_char(r.answered_at, 'YYYY-MM-DD') FROM caregiver_survey_request r WHERE r.company_id = ${companyId} AND r.caregiver_id = u.id AND r.answered_at IS NOT NULL ORDER BY r.answered_at DESC LIMIT 1) AS latest_score_on,
      (SELECT COUNT(*)::int FROM caregiver_survey_request r WHERE r.company_id = ${companyId} AND r.caregiver_id = u.id AND r.answered_at IS NULL AND r.sent_at IS NOT NULL AND r.sent_at < NOW() - INTERVAL '14 days') AS unanswered_surveys,
      (SELECT ca.hours_wanted FROM caregiver_availability ca WHERE ca.caregiver_id = u.id LIMIT 1) AS hours_wanted
      FROM "user" u
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE u.company_id = ${companyId} AND ${isCaregiver} AND u.is_active = true AND (cp.left_on IS NULL OR cp.left_on > ${today}::date)`)
}

/** The answered surveys in the window with where each caregiver sits, for results by branch / manager / caregiver and the trend. */
export async function surveyAnswers(q: Q, companyId: string, start: string, end: string): Promise<any[]> {
  return all(q, sql`SELECT r.id, r.survey_id, s.name AS survey_name, r.caregiver_id, u.first_name, u.last_name, r.client_id, r.reason, to_char(r.answered_at, 'YYYY-MM-DD') AS answered_on,
           r.score, r.answers, r.comment, r.alerted_at IS NOT NULL AS alerted,
           cp.branch_id, sl.name AS branch_name, cp.team, cp.manager_user_id, m.first_name AS manager_first, m.last_name AS manager_last
      FROM caregiver_survey_request r JOIN caregiver_survey s ON s.id = r.survey_id JOIN "user" u ON u.id = r.caregiver_id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN service_locations sl ON sl.id = cp.branch_id
      LEFT JOIN "user" m ON m.id = cp.manager_user_id
     WHERE r.company_id = ${companyId} AND r.answered_at IS NOT NULL AND r.answered_at::date BETWEEN ${start}::date AND ${end}::date
     ORDER BY r.answered_at DESC`)
}

/** How many surveys were sent and answered in the window (the response rate). */
export async function surveyCounts(q: Q, companyId: string, start: string, end: string): Promise<{ sent: number; answered: number; pushed: number }> {
  const r = await all(q, sql`SELECT COUNT(*) FILTER (WHERE r.sent_at IS NOT NULL)::int AS sent, COUNT(*) FILTER (WHERE r.answered_at IS NOT NULL)::int AS answered, COUNT(*) FILTER (WHERE r.pushed)::int AS pushed
      FROM caregiver_survey_request r WHERE r.company_id = ${companyId} AND r.due_on BETWEEN ${start}::date AND ${end}::date`)
  return { sent: Number(r[0]?.sent) || 0, answered: Number(r[0]?.answered) || 0, pushed: Number(r[0]?.pushed) || 0 }
}

/** The risk snapshots since a day — the trend, per caregiver or for everyone (the daily average and the count at risk). */
export async function riskHistory(q: Q, companyId: string, since: string, caregiverId: string | null): Promise<any[]> {
  return all(q, sql`SELECT to_char(rs.as_of, 'YYYY-MM-DD') AS as_of, rs.caregiver_id, rs.score, rs.band
      FROM caregiver_risk_snapshot rs WHERE rs.company_id = ${companyId} AND rs.as_of >= ${since}::date ${caregiverId ? sql`AND rs.caregiver_id = ${caregiverId}` : sql``}
     ORDER BY rs.as_of`)
}
