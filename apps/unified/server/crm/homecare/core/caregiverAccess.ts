// Which clients a caregiver may see — ONE rule for every caregiver read of client records (the client list,
// medications / MAR / vitals, care plans, geofences, …) and every caregiver write to a client's care record
// (careWriteRefusal). Moved from templates/crm-homecare/backend/src/helpers/caregiverAccess.ts; the SQL rule (servedBy)
// is in server/data/homecareCore.ts.
//
// A caregiver serves a client when they have an active pattern for them (recurring, or one-time — a pattern that
// ended more than 14 days ago no longer counts), cover one of the client's days through a 'modified' exception in the
// last 14 days or later, or hold an active assignment. The office (admin / owner) sees every client.
//
// One change: "every client" is every client OF THE OFFICE'S COMPANY. The template's database held one agency, so any
// client id was the agency's; here a client id from another company is refused to the office as well.
import { and, eq } from 'drizzle-orm'
import type { Context, Next } from 'hono'
import { clients } from '../../../db/schema/index.ts'
import { caregiverServesClient } from '../../../data/homecareCore.ts'
import { fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

// The office: the rungs that run the agency. The template had owner and admin only; the unified app's office manager
// (the manager rung) holds the care work too (packages/tenant-backend auth/permissions.ts), so it is office here — a
// caregiver, stored as 'caregiver' (moved tenants) or 'field' (new ones), is not.
const OFFICE = new Set(['admin', 'owner', 'manager'])
export const isOfficeUser = (user: any) => !!user && OFFICE.has(user.role)
export const userIdOf = (user: any): string => user?.userId || user?.id

// WRITES use the same rule. A caregiver records care — a dose on the MAR, vitals, an ADL, a checklist task, a visit
// note or photo, a form — only for a client they serve; naming their own visit is not enough.
export const CARE_WRITE_REFUSAL = 'You can only record care for the clients you care for.'

export function createCaregiverAccess(d: CrmDeps) {
  /** May this user read this client's records? The office for any client of its company; a caregiver only for a client they serve. */
  async function maySeeClient(user: any, clientId: string | null | undefined): Promise<boolean> {
    if (!user || !clientId || !user.companyId) return false
    if (isOfficeUser(user)) {
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
