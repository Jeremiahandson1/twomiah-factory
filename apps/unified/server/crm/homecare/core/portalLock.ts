// A cancelled agency's portals are paused too. (Run 4, blocker 3, 10/16.) Moved from
// templates/crm-homecare/backend/src/helpers/portalLock.ts.
//
// The staff lock lives in the app's sign-in (d.authenticate → shared auth/accountLock.ts). The family portal and the
// client portal sign their people in on paths of their own and never pass through it, so each portal's own sign-in
// asks the same lock, after it knows who is asking, and refuses with the same 402 ACCOUNT_LOCKED — in words for a
// family, who do not hold the subscription.
//
// One change: the lock read is THIS company's (the portal person's company id is passed in). The template read its
// database's only agency through currentAccountLock, whose cache holds one answer per process.
import { eq } from 'drizzle-orm'
import { accountLockOf } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

export const PORTAL_PAUSED_MESSAGE = "This agency's account is paused, so the portal is unavailable for now. Please contact the agency."

export function createPortalLock(d: CrmDeps) {
  /** The 402 to send a portal request while the company is locked, or null to go on. */
  async function refusePortalWhileLocked(c: any, companyId: string): Promise<Response | null> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const lock = accountLockOf(row?.settings ?? null)
    if (!lock) return null
    // The template's reply carried the lock kind as `lock`; the rulebook's error is { error, code } (RULEBOOK §3).
    return fail(c, 402, PORTAL_PAUSED_MESSAGE, 'ACCOUNT_LOCKED')
  }
  return { refusePortalWhileLocked }
}
