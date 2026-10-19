// Which clients a caregiver may see — ONE rule for every caregiver read of client records (the client list,
// medications / MAR / vitals, care plans, geofences, …) and every caregiver write to a client's care record
// (careWriteRefusal). Moved from templates/crm-homecare/backend/src/helpers/caregiverAccess.ts; the SQL rule (servedBy)
// is in server/data/homecareCore.ts.
//
// A caregiver serves a client when they have an active pattern for them (recurring, or one-time — a pattern that
// ended more than 14 days ago no longer counts), cover one of the client's days through a 'modified' exception in the
// last 14 days or later, or hold an active assignment. Anyone else who holds care-clients:read sees every client.
//
// One change: "every client" is every client OF THE OFFICE'S COMPANY. The template's database held one agency, so any
// client id was the agency's; here a client id from another company is refused to the office as well.
import { and, eq } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { clients } from '../../../db/schema/index.ts'
import { caregiverServesClient } from '../../../data/homecareCore.ts'
import { fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

// WHOSE RECORDS — the one rule for every home-care route that narrows a caregiver to their own (2026-10-19).
//
// A caregiver is the field seat: stored 'field' (a new agency) or 'caregiver' (a moved one; the vertical's roleMapping),
// and a caregiver is always narrowed to themselves — their own shifts, pay, records, and the clients they serve. Anyone
// else reaches EVERYONE's record in an area when they hold that area's permission for the act: care-hr:read to read a
// caregiver's file, care-schedule:update to change someone's availability, care-payroll:read to see their rates.
//
// It was two rules. Here "the office" was a list of roles (owner, admin, manager), so a seat an owner grants read access
// to (a bookkeeper, an auditor) was treated as a caregiver and refused every caregiver's file; and the scheduling and
// visits routes asked only "not a caregiver?", so the same seat — holding nothing but care-schedule:read — could assign
// an open shift, file or answer anyone's shift swap, and resolve visit change requests. A rank is not a permission.
export const isCaregiverSeat = (d: Pick<CrmDeps, 'permissions'>, user: any): boolean =>
  !!user && d.permissions.normalizeRole(user.role) === 'field'
export const userIdOf = (user: any): string => user?.userId || user?.id

/** May this person act on ANYONE's record with `permission`? Never a caregiver; anyone else who holds it (role or grant). */
export async function actsForAnyone(d: Pick<CrmDeps, 'permissions'>, user: any, permission: string): Promise<boolean> {
  if (!user || isCaregiverSeat(d, user)) return false
  return d.permissions.hasPermission(user.role, permission, await d.permissions.getExtraPermissions(userIdOf(user)))
}

// WRITES use the same rule. A caregiver records care — a dose on the MAR, vitals, an ADL, a checklist task, a visit
// note or photo, a form — only for a client they serve; naming their own visit is not enough.
export const CARE_WRITE_REFUSAL = 'You can only record care for the clients you care for.'

export function createCaregiverAccess(d: CrmDeps) {
  /** May this user read this client's records? Whoever reads clients for the agency: any client of its company; a caregiver only a client they serve. */
  async function maySeeClient(user: any, clientId: string | null | undefined): Promise<boolean> {
    if (!user || !clientId || !user.companyId) return false
    if (await actsForAnyone(d, user, 'care-clients:read')) {
      const [c] = await d.db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.companyId, user.companyId))).limit(1)
      return !!c
    }
    return caregiverServesClient(d.db, user.companyId, userIdOf(user), clientId)
  }

  /** Route guard for `/:clientId` paths (param name configurable): 403 for a client the caregiver does not serve. */
  const requireClientAccess = (param = 'clientId') => async (c: Context, next: Next) => {
    if (!(await maySeeClient(c.get('user' as never), c.req.param(param)))) return fail(c, 403, 'You can only see the clients you care for.')
    await next()
  }

  /** null when this user may write to this client's care record; otherwise the 403 to return. */
  async function careWriteRefusal(c: Context, clientId: string | null | undefined): Promise<Response | null> {
    if (await maySeeClient(c.get('user' as never), clientId)) return null
    return fail(c, 403, CARE_WRITE_REFUSAL)
  }

  return { maySeeClient, requireClientAccess, careWriteRefusal }
}

export type CaregiverAccess = ReturnType<typeof createCaregiverAccess>
