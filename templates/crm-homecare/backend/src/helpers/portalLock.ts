// A cancelled agency's portals are paused too. (Run 4, blocker 3, 10/16)
//
//   Tester: "After the cancel, the family member's schedule, medications and messages calls still returned 200 and
//   rendered. Owner and caregiver were locked correctly (402 ACCOUNT_LOCKED)."
//
// The staff lock lives in middleware/auth.ts `authenticate` (shared auth/accountLock.ts). The family portal
// (familyPortal.ts familyAuth) and the client portal (portal.ts portalAuth, which portalVisits.ts shares) sign their
// people in on paths of their own and never pass through it, so a cancelled agency kept serving its clients' schedules,
// medications and messages. Each portal's auth now asks the same lock, after it knows who is asking, and refuses with
// the same 402 ACCOUNT_LOCKED — in words for a family, who do not hold the subscription.
// Signing in stays open (the screens show "paused" on the first data call); so does nothing else.
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { currentAccountLock } from '../shared/index.ts'

export const PORTAL_PAUSED_MESSAGE = "This agency's account is paused, so the portal is unavailable for now. Please contact the agency."

/** The 402 to send a portal request while the agency is locked, or null to go on. */
export async function refusePortalWhileLocked(c: any): Promise<Response | null> {
  const lock = await currentAccountLock(db, agencies)
  if (!lock) return null
  return c.json({ error: PORTAL_PAUSED_MESSAGE, code: 'ACCOUNT_LOCKED', lock }, 402)
}
