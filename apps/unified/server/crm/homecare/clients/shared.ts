// What the clients group's routers share: who the person is, the one rule for which clients a caregiver may read or
// record care for, and the list reply for a whole (unpaged) list.
//
// "The office" in the template was owner or admin (helpers/careAudit.ts isOffice): everyone who was not a caregiver.
// The unified seats add a manager, who holds every care-clients permission (packages/tenant-backend auth/permissions.ts),
// so the question the routes really ask is "is this a caregiver?" — the scheduling group's isCaregiver, the field rung,
// whatever the stored role says ('caregiver' on a moved tenant, 'field' on a new one). Anyone else acts for the
// company and sees all of its clients; a caregiver goes through core/caregiverAccess.ts (the clients they serve).
import type { Context, Next } from 'hono'
import { and, eq } from 'drizzle-orm'
import { clients, user as userTable } from '../../../db/schema/index.ts'
import { fail, list } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { CARE_WRITE_REFUSAL } from '../core/caregiverAccess.ts'
import { isCaregiver, userIdOf } from '../scheduling/shared.ts'

export { isCaregiver, userIdOf }

export const NOT_YOUR_CLIENT = 'You can only see the clients you care for.'

/** The signed-in person, their company and their id. */
export function who(c: Context): { user: any; companyId: string; me: string } {
  const user = c.get('user' as never) as any
  return { user, companyId: user.companyId, me: userIdOf(user) }
}

/** A whole list as a list reply (RULEBOOK §3): one page holding every row. */
export const whole = <T>(c: Context, rows: T[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

/** A typed body, or {} when it is not JSON. */
export const body = async (c: Context): Promise<any> => (await c.req.json().catch(() => ({}))) ?? {}

export function createClientAccess(core: HomecareCore, d: CrmDeps) {
  const office = (user: any) => !!user && !isCaregiver(d, user)

  /** Is this one of the company's clients? */
  async function clientInCompany(companyId: string, clientId: string | null | undefined): Promise<boolean> {
    if (!clientId || !companyId) return false
    const [row] = await d.db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    return !!row
  }

  /** May this person read this client's records? Anyone above a caregiver: any client of the company; a caregiver: a client they serve. */
  async function maySeeClient(user: any, clientId: string | null | undefined): Promise<boolean> {
    if (!user?.companyId || !clientId) return false
    if (office(user)) return clientInCompany(user.companyId, clientId)
    return core.access.maySeeClient(user, clientId)
  }

  /** Route guard for `/:clientId` paths: 403 for a client this person may not read. */
  const requireClientAccess = (param = 'clientId') => async (c: Context, next: Next) => {
    if (!(await maySeeClient(c.get('user' as never), c.req.param(param)))) return fail(c, 403, NOT_YOUR_CLIENT)
    await next()
  }

  /** null when this person may record care for this client; otherwise the 403 to return. */
  async function careWriteRefusal(c: Context, clientId: string | null | undefined): Promise<Response | null> {
    if (await maySeeClient(c.get('user' as never), clientId)) return null
    return fail(c, 403, CARE_WRITE_REFUSAL)
  }

  /** One of the company's people by id (a caregiver a record is attributed to), or null. */
  async function personInCompany(companyId: string, id: string): Promise<{ id: string; firstName: string; lastName: string } | null> {
    const [row] = await d.db.select({ id: userTable.id, firstName: userTable.firstName, lastName: userTable.lastName }).from(userTable)
      .where(and(eq(userTable.id, id), eq(userTable.companyId, companyId))).limit(1)
    return row ?? null
  }

  return { office, clientInCompany, maySeeClient, requireClientAccess, careWriteRefusal, personInCompany }
}

export type ClientAccess = ReturnType<typeof createClientAccess>
