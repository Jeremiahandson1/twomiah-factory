// The SQL of the medication reminders (core/medicationReminders.ts): which visits are open or just ended, the medicines
// with dose times a client takes, whether a dose has been recorded, and the claim row that makes each reminder or alert
// send once. Every read is the company's; each returns camelCase.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** The companies with an active, scheduled (not as-needed) medicine that has dose times. */
export async function companiesWithDoseTimes(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM medications
    WHERE status = 'active' AND is_prn = false AND dose_times IS NOT NULL AND dose_times::text <> '[]' AND dose_times::text <> 'null'`)).map((r) => String(r.company_id))
}

/**
 * The company's visits that were open at some point in [fromIso, toIso]: still open (open = true), or ended inside it.
 * `startIso` / `endIso` are UTC instants (time_entries holds UTC wall time).
 */
export async function visitsInWindow(q: Q, companyId: string, fromIso: string, toIso: string, which: 'open' | 'ended'): Promise<{
  id: string; caregiverId: string; clientId: string; startIso: string; endIso: string | null; clientFirst: string; clientLast: string
}[]> {
  const iso = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)
  return camelRows(await q.execute(which === 'open'
    ? sql`SELECT te.id, te.caregiver_id, te.client_id, ${iso('te.start_time')} AS start_iso, NULL AS end_iso, c.first_name AS client_first, c.last_name AS client_last
            FROM time_entries te JOIN clients c ON c.id = te.client_id AND c.company_id = ${companyId}
           WHERE te.company_id = ${companyId} AND te.end_time IS NULL AND te.start_time >= ${fromIso}::timestamp AND te.start_time <= ${toIso}::timestamp`
    : sql`SELECT te.id, te.caregiver_id, te.client_id, ${iso('te.start_time')} AS start_iso, ${iso('te.end_time')} AS end_iso, c.first_name AS client_first, c.last_name AS client_last
            FROM time_entries te JOIN clients c ON c.id = te.client_id AND c.company_id = ${companyId}
           WHERE te.company_id = ${companyId} AND te.end_time IS NOT NULL AND te.end_time >= ${fromIso}::timestamp AND te.end_time <= ${toIso}::timestamp`))
}

/** The active, scheduled medicines of these clients that have dose times. */
export async function scheduledMedicines(q: Q, companyId: string, clientIds: string[]): Promise<{
  id: string; clientId: string; name: string; dosage: string | null; doseTimes: unknown; startDate: string | null; endDate: string | null
}[]> {
  if (!clientIds.length) return []
  return camelRows(await q.execute(sql`SELECT id, client_id, name, dosage, dose_times,
      to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
    FROM medications
   WHERE company_id = ${companyId} AND status = 'active' AND is_prn = false AND dose_times IS NOT NULL
     AND client_id IN (${sql.join(clientIds.map((x) => sql`${x}`), sql`, `)})`))
}

/**
 * Has this dose been recorded — in any way (given, refused, held, missed: each is the caregiver's answer)? A record counts when it
 * names this due time, or was made (administered_at is the time the caregiver tapped, even for a save sent later from
 * a phone without signal) within `windowMinutes` of it.
 */
export async function doseRecorded(q: Q, companyId: string, medicationId: string, dueIso: string, windowMinutes: number): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT 1 FROM medication_logs
   WHERE company_id = ${companyId} AND medication_id = ${medicationId}
     AND (scheduled_time = ${dueIso}::timestamp
          OR administered_at BETWEEN (${dueIso}::timestamp - (${windowMinutes}::int * INTERVAL '1 minute')) AND (${dueIso}::timestamp + (${windowMinutes}::int * INTERVAL '1 minute')))
   LIMIT 1`))
  return r.length > 0
}

/** Claim the reminder (kind 'due') or the office alert (kind 'missed') for one dose of one visit: true only for the scan that inserted the row. */
export async function claimDoseReminder(q: Q, companyId: string, medicationId: string, timeEntryId: string, dueIso: string, kind: 'due' | 'missed'): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`INSERT INTO medication_dose_reminder (id, company_id, medication_id, time_entry_id, due_at, kind, created_at)
    VALUES (${createId()}, ${companyId}, ${medicationId}, ${timeEntryId}, ${dueIso}::timestamp, ${kind}, NOW())
    ON CONFLICT (medication_id, time_entry_id, due_at, kind) DO NOTHING RETURNING id`))
  return r.length > 0
}
