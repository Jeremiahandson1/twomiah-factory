// Supervisory visits (item 11, docs/parity/homecare-supervisory-visits.md): the clients who need one, when it was last
// done, and when the next is due. Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/**
 * Every active client whose rule asks for supervisory visits: the last visit date, the interval in force (the client's own
 * days, else the agency's) and the date it started counting from (the last visit, else the client's start date, else the
 * day they were added). The due date is that plus the interval.
 */
export async function supervisoryRows(q: Q, companyId: string, agencyDays: number): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id AS client_id, c.first_name, c.last_name,
           COALESCE(c.supervisory_interval_days, ${agencyDays})::int AS interval_days,
           to_char(lv.last_visit, 'YYYY-MM-DD') AS last_visit,
           to_char(COALESCE(lv.last_visit, c.start_date, c.created_at::date)
                   + COALESCE(c.supervisory_interval_days, ${agencyDays})::int, 'YYYY-MM-DD') AS due_date,
           (c.supervisory_interval_days IS NOT NULL) AS own_interval
      FROM clients c
      LEFT JOIN LATERAL (
        SELECT MAX(v.visit_date) AS last_visit FROM supervisory_visit v WHERE v.client_id = c.id AND v.company_id = c.company_id
      ) lv ON true
     WHERE c.company_id = ${companyId} AND c.is_active = true
       AND COALESCE(c.supervisory_interval_days, ${agencyDays}) > 0
     ORDER BY due_date, c.last_name, c.first_name`))
}

/** A client's supervisory visits, newest first, with the supervisor's and caregiver's names. */
export async function supervisoryHistory(q: Q, companyId: string, clientId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT v.id, v.client_id, to_char(v.visit_date, 'YYYY-MM-DD') AS visit_date, v.visit_type, v.client_feedback, v.care_plan_followed,
           v.caregiver_feedback, v.concerns, v.follow_up_notes, v.supervisor_id, v.caregiver_id, v.created_at,
           TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS supervisor_name,
           TRIM(COALESCE(cg.first_name, '') || ' ' || COALESCE(cg.last_name, '')) AS caregiver_name
      FROM supervisory_visit v
      LEFT JOIN "user" s ON s.id = v.supervisor_id
      LEFT JOIN "user" cg ON cg.id = v.caregiver_id
     WHERE v.company_id = ${companyId} AND v.client_id = ${clientId}
     ORDER BY v.visit_date DESC, v.created_at DESC`))
}
