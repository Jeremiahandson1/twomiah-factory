// Which clients a caregiver may see — ONE rule for every caregiver read of client records (the
// client list, medications / MAR / vitals, care plans, geofences, …) and every caregiver write to a
// client's care record (careWriteRefusal, below).
//
// A caregiver serves a client when they have an active pattern for them (recurring, or a one-time
// visit — a pattern that ended more than 14 days ago no longer counts), cover one of the client's
// days through a 'modified' exception in the last 14 days or later, or hold an active assignment.
// The office (admin / owner) sees every client.
import { sql, type SQL } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { db } from '../../db/index.ts'

const OFFICE = new Set(['admin', 'owner'])
export const isOfficeUser = (user: any) => !!user && OFFICE.has(user.role)
export const userIdOf = (user: any): string => user?.userId || user?.id

/** SQL true when `caregiverId` serves the client whose id is `clientCol` (e.g. sql`c.id`). */
export const servedBy = (caregiverId: string, clientCol: SQL = sql.raw('c.id')): SQL => sql`(
  EXISTS (SELECT 1 FROM schedules s WHERE s.client_id = ${clientCol} AND s.caregiver_id = ${caregiverId} AND s.is_active = true
          AND (s.day_of_week IS NULL OR s.end_date IS NULL OR s.end_date >= CURRENT_DATE - 14))
  OR EXISTS (SELECT 1 FROM schedule_exceptions se JOIN schedules s2 ON s2.id = se.schedule_id
          WHERE COALESCE(se.override_client_id, s2.client_id) = ${clientCol} AND se.override_caregiver_id = ${caregiverId}
            AND se.exception_type = 'modified' AND se.exception_date >= CURRENT_DATE - 14)
  OR EXISTS (SELECT 1 FROM client_assignments a WHERE a.client_id = ${clientCol} AND a.caregiver_id = ${caregiverId} AND a.status = 'active'))`

/** May this user read this client's records? The office always; a caregiver only for a client they serve. */
export async function maySeeClient(user: any, clientId: string | null | undefined): Promise<boolean> {
  if (isOfficeUser(user)) return true
  if (!user || !clientId) return false
  const r: any = await db.execute(sql`SELECT ${servedBy(userIdOf(user), sql`${clientId}`)} AS ok`)
  return (r?.rows ?? r)[0]?.ok === true
}

/** Route guard for `/:clientId` paths (param name configurable): 403 for a client the caregiver does not serve. */
export const requireClientAccess = (param = 'clientId') => async (c: Context, next: Next) => {
  if (!(await maySeeClient(c.get('user' as any), c.req.param(param)))) return c.json({ error: 'You can only see the clients you care for.' }, 403)
  await next()
}

// WRITES use the same rule. A caregiver records care — a dose on the MAR, vitals, an ADL, a checklist
// task, a visit note or photo, a form — only for a client they serve; naming their own visit is not
// enough (a clock-in is never refused, so an unscheduled punch must not open someone's chart).
export const CARE_WRITE_REFUSAL = 'You can only record care for the clients you care for.'

/** null when this user may write to this client's care record; otherwise the 403 to return. */
export async function careWriteRefusal(c: Context, clientId: string | null | undefined): Promise<Response | null> {
  if (await maySeeClient(c.get('user' as any), clientId)) return null
  return c.json({ error: CARE_WRITE_REFUSAL }, 403)
}
