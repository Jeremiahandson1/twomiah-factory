// What this group's routers share: who is a caregiver, the signed-in person, and the office's EVV permission.
import type { Context } from 'hono'
import type { CrmDeps } from '../../deps.ts'
import { and, eq } from 'drizzle-orm'
import { clients, referralSources } from '../../../db/schema/index.ts'
import { isCaregiverSeat } from '../core/caregiverAccess.ts'

/**
 * The office's side of visits: the evv permission a caregiver does not hold. A caregiver holds evv:read, evv:create
 * and evv:update (they clock in and out, record GPS, photos and notes on their own visits —
 * verticals/homecare/settings.ts); what the template kept to `requireAdmin` (the approval queue, force clock-out,
 * corrections, the EVV list, Sandata, visit documentation) needs this one. Owner, admin and manager hold it (evv:*).
 */
export const OFFICE_EVV = 'evv:delete'

/**
 * "Is this person a caregiver?" — the question the template asked with `!isOffice(user)` where it narrowed a read or a
 * write to the caregiver's own rows. The one rule is core/caregiverAccess.ts; every route here that uses it to let
 * someone act on another's visit also asks an evv permission a caregiver holds only for their own (evv:create / update
 * on their own entries) — so "not a caregiver" there is the office.
 */
export const isCaregiver = (d: CrmDeps, user: any): boolean => isCaregiverSeat(d, user)

/** The signed-in user's id. */
export const userIdOf = (user: any): string => user?.userId || user?.id

/** The signed-in user, their company and their id. */
export function who(c: Context): { user: any; companyId: string; me: string } {
  const user = c.get('user' as never) as any
  return { user, companyId: user?.companyId, me: userIdOf(user) }
}

/** A positive whole number from a query value, else the fallback. */
export function intParam(v: string | undefined, fallback: number): number {
  const n = parseInt(v || '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Private pay bills the clock; every other payer bills the schedule (core/punchRules.ts decideBilling). */
export const isPrivatePayer = (p: any): boolean => p?.isPrivatePay === true || p?.payerType === 'private_pay'

/** The client's payer, which decides the billing rule of a visit's clock-out — by the app or by phone. */
export async function payerOf(db: any, companyId: string, clientId: string) {
  const [p] = await db.select({
    isPrivatePay: clients.isPrivatePay, firstName: clients.firstName, lastName: clients.lastName,
    payerType: referralSources.payerType, payerName: referralSources.name,
  }).from(clients).leftJoin(referralSources, eq(referralSources.id, clients.referredById))
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
  return p ?? null
}
