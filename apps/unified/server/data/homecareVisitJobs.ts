// The SQL of home care's two visit scans (moved from templates/crm-homecare/backend/src/jobs/shiftReminders.ts and
// jobs/overtimeAlerts.ts): which shifts start in about an hour, which caregivers are still clocked in past their visit,
// and the claim rows that make each send happen once. Each returns camelCase. The template's database held one agency;
// the scans now run company by company (core/visitJobs.ts), so every read is the company's and every claim row carries
// it.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import { occurrencesCte, type Q } from './homecareCore.ts'

/** The companies that have an active schedule (the ones a shift reminder could be for). */
export async function companiesWithActiveSchedules(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM schedules WHERE is_active = true`)).map((r) => String(r.company_id))
}

/**
 * The company's visits on `date` starting 55–65 minutes after `time` (both the agency's wall clock). After 22:55 the
 * window wraps past midnight, and TIME arithmetic would then match an early-morning visit of TODAY that is already
 * over; those reminders are skipped instead.
 */
export async function shiftsStartingInAnHour(q: Q, companyId: string, date: string, time: string): Promise<{
  id: string; caregiverId: string | null; startHm: string; endHm: string; clientFirst: string; clientLast: string
}[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, to_char(occ.start_time, 'HH24:MI') AS start_hm, to_char(occ.end_time, 'HH24:MI') AS end_hm,
           c.first_name AS client_first, c.last_name AS client_last
      FROM occ JOIN clients c ON c.id = occ.client_id AND c.company_id = ${companyId}
     WHERE occ.start_time >= (${time}::time + INTERVAL '55 minutes')::time
       AND occ.start_time <= (${time}::time + INTERVAL '65 minutes')::time
       AND ${time}::time < '22:55'::time`))
}

/** Claim the reminder for one (schedule, day): true only for the scan that inserted the row. */
export async function claimShiftReminder(q: Q, companyId: string, scheduleId: string, date: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`INSERT INTO shift_reminder_log (id, company_id, schedule_id, shift_date, sent_at)
    VALUES (${createId()}, ${companyId}, ${scheduleId}, ${date}::date, NOW())
    ON CONFLICT (schedule_id, shift_date) DO NOTHING RETURNING schedule_id`))
  return r.length > 0
}

/** The companies with a punch still open (the ones an over-visit text could be for). */
export async function companiesWithOpenPunches(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM time_entries WHERE end_time IS NULL AND allotted_minutes > 0`)).map((r) => String(r.company_id))
}

/**
 * The company's open punches more than `firstThreshold` minutes past their scheduled length (measured from the
 * clock-in) and less than `staleHours` past it, with the highest threshold already alerted.
 */
export async function punchesPastTheirVisit(q: Q, companyId: string, nowIso: string, firstThreshold: number, staleHours: number): Promise<{
  id: string; caregiverId: string; allottedMinutes: number; startIso: string; minutesOver: number
  cgFirst: string; cgLast: string; cgPhone: string | null; clFirst: string; clLast: string; lastThreshold: number
}[]> {
  return camelRows(await q.execute(sql`
    SELECT te.id, te.caregiver_id, te.allotted_minutes, to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
           (FLOOR(EXTRACT(EPOCH FROM (${nowIso}::timestamp - te.start_time)) / 60)::int - te.allotted_minutes) AS minutes_over,
           u.first_name AS cg_first, u.last_name AS cg_last, u.phone AS cg_phone,
           c.first_name AS cl_first, c.last_name AS cl_last,
           COALESCE((SELECT MAX(l.threshold_min) FROM overtime_alert_log l WHERE l.time_entry_id = te.id), 0) AS last_threshold
      FROM time_entries te
      JOIN "user" u ON u.id = te.caregiver_id
      JOIN clients c ON c.id = te.client_id
     WHERE te.company_id = ${companyId}
       AND te.end_time IS NULL AND te.allotted_minutes > 0
       AND ${nowIso}::timestamp > te.start_time + (te.allotted_minutes + ${firstThreshold}) * INTERVAL '1 minute'
       AND ${nowIso}::timestamp < te.start_time + te.allotted_minutes * INTERVAL '1 minute' + ${staleHours} * INTERVAL '1 hour'`))
}

/** Record one threshold of one punch; true only when this call inserted it (a claim). */
export async function claimOvertimeThreshold(q: Q, companyId: string, timeEntryId: string, thresholdMin: number, sent: boolean): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`INSERT INTO overtime_alert_log (id, company_id, time_entry_id, threshold_min, sent, created_at)
    VALUES (${createId()}, ${companyId}, ${timeEntryId}, ${thresholdMin}, ${sent}, NOW())
    ON CONFLICT (time_entry_id, threshold_min) DO NOTHING RETURNING time_entry_id`))
  return r.length > 0
}
