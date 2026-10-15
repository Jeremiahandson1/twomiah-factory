// "Your shift starts in 1 hour" — a push to the caregiver, once per visit. Ported from the CVHC home
// care CRM (jobs/shiftReminders.js).
//
// Two bugs the CVHC original had and this keeps fixed: it expands through the shared engine, so a
// CANCELLED visit is never announced and a RESCHEDULED one is announced at its new time; and "now"
// is the agency's own clock, not the server's UTC (UTC made reminders fire hours early, at night).
//
// Window: occurrences starting 55–65 minutes from now. The scan runs every 5 minutes, and the
// shift_reminder_log primary key makes each (schedule, day) send exactly once — across restarts and
// across instances.
import { sql } from 'drizzle-orm'
import { rows } from '../helpers/scheduleRows.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { agencyNow } from '../helpers/agencyTime.ts'
import { sendPush } from '../services/visitNotify.ts'

export async function scanShiftReminders(at: Date = new Date()): Promise<number> {
  const { date, time } = await agencyNow(at)
  const upcoming = await rows<any>(sql`WITH ${occurrencesCte(date, date)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, to_char(occ.start_time, 'HH24:MI') AS start_hm, to_char(occ.end_time, 'HH24:MI') AS end_hm,
           c.first_name AS client_first, c.last_name AS client_last
      FROM occ JOIN clients c ON c.id = occ.client_id
     WHERE occ.start_time >= (${time}::time + INTERVAL '55 minutes')::time
       AND occ.start_time <= (${time}::time + INTERVAL '65 minutes')::time
       -- After 22:55 the window wraps past midnight, and TIME arithmetic would then match an
       -- early-morning visit of TODAY that is already over. Those reminders are skipped instead.
       AND ${time}::time < '22:55'::time`)
  let sent = 0
  for (const s of upcoming) {
    try {
      // Claim it first: only the scan that inserts the row sends.
      const claim = await rows(sql`INSERT INTO shift_reminder_log (schedule_id, shift_date, sent_at) VALUES (${s.id}, ${date}::date, NOW())
        ON CONFLICT (schedule_id, shift_date) DO NOTHING RETURNING schedule_id`)
      if (!claim.length) continue
      await sendPush(s.caregiver_id, {
        title: 'Shift in 1 hour',
        body: `${s.client_first} ${s.client_last} · ${s.start_hm}–${s.end_hm}`,
        tag: `shift-reminder-${s.id}-${date}`,
        data: { type: 'shift_reminder', eventType: 'shift_reminder', urgent: false, scheduleId: s.id },
      })
      sent++
    } catch (e: any) { console.error('[shift-reminders] one shift:', e?.message) }
  }
  return sent
}
