// Supervisory visits (item 11 + row 24, docs/parity/homecare-supervisory-visits.md): the clients who need one, when it
// was last done, when the next is due, and the visits planned on the calendar. Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/**
 * Every active client whose rule asks for supervisory visits: the last DONE visit, the interval in force and where it came
 * from — the client's own days, else the shortest cycle among the service codes the client is authorised for today, else
 * the agency's rule — the date it counts from (the last visit, else the client's start date, else the day they were
 * added), and the next planned visit, if any.
 */
export async function supervisoryRows(q: Q, companyId: string, agencyDays: number, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH base AS (
      SELECT c.id AS client_id, c.first_name, c.last_name, c.start_date, c.created_at, c.supervisory_interval_days AS own_days,
             (SELECT MIN(sc.supervisory_interval_days) FROM authorizations a
                JOIN service_codes sc ON sc.company_id = a.company_id AND sc.code = a.procedure_code AND sc.is_active = true
               WHERE a.company_id = c.company_id AND a.client_id = c.id AND a.status = 'active'
                 AND a.start_date <= ${today}::date AND a.end_date >= ${today}::date
                 AND sc.supervisory_interval_days IS NOT NULL AND sc.supervisory_interval_days > 0) AS code_days
        FROM clients c
       WHERE c.company_id = ${companyId} AND c.is_active = true
    )
    SELECT b.client_id, b.first_name, b.last_name,
           COALESCE(b.own_days, b.code_days, ${agencyDays})::int AS interval_days,
           CASE WHEN b.own_days IS NOT NULL THEN 'client' WHEN b.code_days IS NOT NULL THEN 'service_code' ELSE 'agency' END AS interval_source,
           to_char(lv.last_visit, 'YYYY-MM-DD') AS last_visit,
           to_char(COALESCE(lv.last_visit, b.start_date, b.created_at::date) + COALESCE(b.own_days, b.code_days, ${agencyDays})::int, 'YYYY-MM-DD') AS due_date,
           (b.own_days IS NOT NULL) AS own_interval,
           np.id AS planned_id, np.planned_at, to_char(np.visit_date, 'YYYY-MM-DD') AS planned_date,
           NULLIF(TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')), '') AS planned_supervisor_name
      FROM base b
      LEFT JOIN LATERAL (
        SELECT MAX(v.visit_date) AS last_visit FROM supervisory_visit v
         WHERE v.client_id = b.client_id AND v.company_id = ${companyId} AND v.status = 'done'
      ) lv ON true
      LEFT JOIN LATERAL (
        SELECT v.id, v.planned_at, v.visit_date, v.supervisor_id FROM supervisory_visit v
         WHERE v.client_id = b.client_id AND v.company_id = ${companyId} AND v.status = 'planned'
         ORDER BY v.planned_at NULLS LAST, v.visit_date LIMIT 1
      ) np ON true
      LEFT JOIN "user" s ON s.id = np.supervisor_id
     WHERE COALESCE(b.own_days, b.code_days, ${agencyDays}) > 0
     ORDER BY due_date, b.last_name, b.first_name`))
}

const VISIT_COLS = sql`v.id, v.client_id, to_char(v.visit_date, 'YYYY-MM-DD') AS visit_date, v.visit_type, v.status, v.planned_at,
           v.client_feedback, v.care_plan_followed, v.caregiver_feedback, v.concerns, v.follow_up_notes, v.answers,
           v.supervisor_id, v.caregiver_id, v.started_at, v.completed_at, v.signed_at, v.recorded_from, v.client_sign_reason,
           (v.supervisor_signature IS NOT NULL) AS supervisor_signed, (v.client_signature IS NOT NULL) AS client_signed, v.created_at,
           TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS supervisor_name,
           TRIM(COALESCE(cg.first_name, '') || ' ' || COALESCE(cg.last_name, '')) AS caregiver_name`

/** A client's done supervisory visits, newest first, with the supervisor's and caregiver's names. */
export async function supervisoryHistory(q: Q, companyId: string, clientId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${VISIT_COLS}
      FROM supervisory_visit v
      LEFT JOIN "user" s ON s.id = v.supervisor_id
      LEFT JOIN "user" cg ON cg.id = v.caregiver_id
     WHERE v.company_id = ${companyId} AND v.client_id = ${clientId} AND v.status = 'done'
     ORDER BY v.visit_date DESC, v.created_at DESC`))
}

/** One visit with its client's name and address (the phone's visit screen), or null. The signatures come with it. */
export async function supervisoryVisitById(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelRows(await q.execute(sql`
    SELECT ${VISIT_COLS}, v.supervisor_signature, v.client_signature,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.address AS client_address, c.city AS client_city, c.phone AS client_phone
      FROM supervisory_visit v
      JOIN clients c ON c.id = v.client_id
      LEFT JOIN "user" s ON s.id = v.supervisor_id
      LEFT JOIN "user" cg ON cg.id = v.caregiver_id
     WHERE v.company_id = ${companyId} AND v.id = ${id}
     LIMIT 1`))[0] ?? null
}

/** Planned visits on the agency's calendar between two dates (inclusive), with the client's and supervisor's names. */
export async function plannedBetween(q: Q, companyId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${VISIT_COLS}, c.first_name AS client_first_name, c.last_name AS client_last_name
      FROM supervisory_visit v
      JOIN clients c ON c.id = v.client_id
      LEFT JOIN "user" s ON s.id = v.supervisor_id
      LEFT JOIN "user" cg ON cg.id = v.caregiver_id
     WHERE v.company_id = ${companyId} AND v.status = 'planned' AND v.visit_date BETWEEN ${from}::date AND ${to}::date
     ORDER BY v.visit_date, v.planned_at NULLS LAST`))
}

/** The planned visits one supervisor is to do, soonest first (their phone's list). */
export async function plannedForSupervisor(q: Q, companyId: string, supervisorId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${VISIT_COLS}, c.first_name AS client_first_name, c.last_name AS client_last_name, c.address AS client_address, c.city AS client_city
      FROM supervisory_visit v
      JOIN clients c ON c.id = v.client_id
      LEFT JOIN "user" s ON s.id = v.supervisor_id
      LEFT JOIN "user" cg ON cg.id = v.caregiver_id
     WHERE v.company_id = ${companyId} AND v.status = 'planned' AND v.supervisor_id = ${supervisorId}
     ORDER BY v.visit_date, v.planned_at NULLS LAST
     LIMIT 200`))
}

/**
 * Claim the reminders that are due: planned visits starting within the next `withinHours` that have not been reminded.
 * The UPDATE … RETURNING is the claim — two scans, or two instances, never remind twice.
 */
export async function claimDueReminders(q: Q, now: Date, withinHours: number): Promise<any[]> {
  const until = new Date(now.getTime() + withinHours * 3600_000)
  return camelRows(await q.execute(sql`
    UPDATE supervisory_visit v SET reminder_sent_at = ${now}
      FROM clients c
     WHERE c.id = v.client_id AND v.status = 'planned' AND v.reminder_sent_at IS NULL AND v.supervisor_id IS NOT NULL
       AND v.planned_at IS NOT NULL AND v.planned_at > ${now} AND v.planned_at <= ${until}
    RETURNING v.id, v.company_id, v.supervisor_id, v.planned_at, v.visit_type, c.first_name AS client_first_name, c.last_name AS client_last_name`))
}
