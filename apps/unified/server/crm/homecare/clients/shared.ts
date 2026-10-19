// What the clients group's routers share: who the person is, the one rule for which clients a caregiver may read or
// record care for, and the list reply for a whole (unpaged) list.
//
// "The office" in the template was owner or admin (helpers/careAudit.ts isOffice): everyone who was not a caregiver.
// Which clients a person may read is core/caregiverAccess.ts maySeeClient, the one rule: a caregiver, the clients they
// serve; anyone else holding care-clients:read, every client of the company.
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
  /** Is this one of the company's clients? */
  async function clientInCompany(companyId: string, clientId: string | null | undefined): Promise<boolean> {
    if (!clientId || !companyId) return false
    const [row] = await d.db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    return !!row
  }

  /**
   * Not a caregiver — for a route that already asks the act's own permission (care-clients:read on a read; evv:create /
   * update on recording care, which a read-only seat does not hold). An act on another person's record that the route's
   * permission does not cover asks core/caregiverAccess.ts actsForAnyone instead (documents' sign, 2026-10-19).
   */
  const office = (user: any): boolean => !!user && !isCaregiver(d, user)

  /** May this person read this client's records? core/caregiverAccess.ts — the one rule. */
  const maySeeClient = (user: any, clientId: string | null | undefined): Promise<boolean> => core.access.maySeeClient(user, clientId)

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
