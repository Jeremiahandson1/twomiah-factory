// Over-visit-length texts — a caregiver still clocked in past the LENGTH of their scheduled visit,
// measured from when they actually clocked in (in at 9:05 for a 1-hour visit → "over" at 10:05).
// Ported from the CVHC home care CRM (jobs/overtimeAlerts.js).
//
//   +5 min  → text the caregiver
//   +30 min → text the caregiver again
//   +60 min → text the caregiver AND the office (admins' phones + an in-app notification)
//
// A text, not a push: push reaches nobody who never subscribed, and this works with the app closed.
// The scheduled length is time_entries.allotted_minutes (set at clock-in from the matched visit);
// unscheduled entries have nothing to measure against and are skipped. Each threshold fires at most
// once per entry (overtime_alert_log primary key); a delayed scan that finds several crossed sends
// only the highest and marks the lower ones done. Entries more than 12 hours past their scheduled end
// are stuck punches that need Force Clock Out, not a text.
import { sql } from 'drizzle-orm'
import { rows } from '../helpers/scheduleRows.ts'
import { agencyNow, fmtClock } from '../helpers/agencyTime.ts'
import { sendCaregiverAlert, notifyAdmins, agencyShortName } from '../services/visitNotify.ts'

export const THRESHOLDS = [5, 30, 60]
export const OFFICE_THRESHOLD = 60
export const STALE_HOURS = 12

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60), m = min % 60
  if (h && m) return `${h} hr ${m} min`
  return h ? `${h} hr` : `${m} min`
}

export async function scanOvertimeAlerts(at: Date = new Date()): Promise<number> {
  const nowIso = at.toISOString()
  const open = await rows<any>(sql`
    SELECT te.id, te.caregiver_id, te.allotted_minutes, to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
           (FLOOR(EXTRACT(EPOCH FROM (${nowIso}::timestamp - te.start_time)) / 60)::int - te.allotted_minutes) AS minutes_over,
           u.first_name AS cg_first, u.last_name AS cg_last, u.phone AS cg_phone,
           c.first_name AS cl_first, c.last_name AS cl_last,
           COALESCE((SELECT MAX(l.threshold_min) FROM overtime_alert_log l WHERE l.time_entry_id = te.id), 0) AS last_threshold
      FROM time_entries te
      JOIN users u ON u.id = te.caregiver_id
      JOIN clients c ON c.id = te.client_id
     WHERE te.end_time IS NULL AND te.allotted_minutes > 0
       AND ${nowIso}::timestamp > te.start_time + (te.allotted_minutes + ${THRESHOLDS[0]}) * INTERVAL '1 minute'
       AND ${nowIso}::timestamp < te.start_time + te.allotted_minutes * INTERVAL '1 minute' + ${STALE_HOURS} * INTERVAL '1 hour'`)
  if (!open.length) return 0
  const { tz } = await agencyNow(at)
  const prefix = await agencyShortName()
  let sent = 0
  for (const e of open) {
    try {
      const over = Number(e.minutes_over)
      const crossed = THRESHOLDS.filter((t) => over >= t)
      const top = crossed[crossed.length - 1]
      if (!top || top <= Number(e.last_threshold)) continue
      // Claim the threshold atomically — if another scan already did, stop.
      const claim = await rows(sql`INSERT INTO overtime_alert_log (time_entry_id, threshold_min, sent, created_at)
        VALUES (${e.id}, ${top}, true, NOW()) ON CONFLICT DO NOTHING RETURNING time_entry_id`)
      if (!claim.length) continue
      for (const t of crossed.slice(0, -1)) {
        await rows(sql`INSERT INTO overtime_alert_log (time_entry_id, threshold_min, sent, created_at)
          VALUES (${e.id}, ${t}, false, NOW()) ON CONFLICT DO NOTHING`)
      }
      // start_time holds UTC wall-clock (see timeTracking.ts), so it is read back as UTC.
      const clockIn = fmtClock(new Date(e.start_iso), tz)
      const client = `${e.cl_first} ${String(e.cl_last || '').charAt(0)}.`.trim()
      const scheduled = fmtDuration(Number(e.allotted_minutes))
      const overTxt = fmtDuration(over)
      if (await sendCaregiverAlert({ userId: e.caregiver_id, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: e.cg_phone, body: `${prefix ? prefix + ': ' : ''}You're still clocked in with ${client} — ${overTxt} past your ${scheduled} visit (clocked in ${clockIn}). Please clock out if you're done.` })) sent++
      if (top === OFFICE_THRESHOLD) {
        const msg = `${e.cg_first} ${e.cg_last} is still clocked in with ${client} — ${overTxt} past a ${scheduled} visit (clocked in ${clockIn}).`
        const admins = await notifyAdmins('overtime_alert', 'Still clocked in past scheduled time', msg)
        for (const a of admins) {
          if (a.phone && await sendCaregiverAlert({ userId: a.id, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: a.phone, body: `${prefix ? prefix + ': ' : ''}${msg}` })) sent++
        }
      }
    } catch (err: any) { console.error('[overtime-alerts] one entry:', err?.message) }
  }
  return sent
}
