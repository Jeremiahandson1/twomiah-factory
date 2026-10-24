// Home care's one exception to View As (core/viewAs.ts): viewing as a CAREGIVER is read-only. Moved from
// templates/crm-homecare/backend/src/middleware/viewAsReadOnly.ts, where every View As was read-only.
// Pure (it verifies the token itself; no database).
//
// Everywhere else a View As writes as the viewed person would, attributed to both people in the audit log, so a tester
// sees the person's real refusals. A caregiver is different: every write a caregiver can make is a first-hand record — a
// clock-in at the client's door that Medicaid pays on (EVV), vitals and a medication on the MAR, a visit note or photo,
// an incident they witnessed, their own mileage and time off. Made by the office under the caregiver's name, it is a
// false record, and an audit row saying who really made it does not repair a clinical or EVV record. So a write made
// with a View As token for a caregiver seat (the roles that normalise to the field rung: field, caregiver, user) is
// refused 403 here, before any route runs; Return (signing out of the View As) is the one write allowed. Viewing as an
// office seat (admin, office manager, viewer) is the app's ordinary View As. The client portal's admin preview is
// read-only too, under its own message.
//
// It runs inside home care's sign-in check (office/signIn.ts withHomecareSessions), before every signed-in route. The
// token is read the way the app's sign-in reads it (the header, the View As cookie, or the session cookie).
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { requestToken } from '@twomiah/tenant-backend'
import { fail } from '../../../http/reply.ts'

export const VIEW_AS_READ_ONLY = 'Viewing as a caregiver is read-only — their clock-ins, visit notes and care records are theirs alone to make. Return to your own account to make changes.'
export const PORTAL_PREVIEW_READ_ONLY = 'Portal preview is read-only'
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** The writes a read-only View As may still make. */
export const VIEW_AS_ALLOWED_WRITES = new Set(['/api/auth/logout'])
/** The stored roles that are the caregiver seat (caregiverAccess.ts isCaregiverSeat: what normalises to the field rung). */
export const CAREGIVER_ROLES = new Set(['field', 'caregiver', 'user'])

export const refuseViewAsWrites = async (c: Context, next: Next) => {
  if (READS.has(c.req.method)) return next()
  const presented: any = requestToken(c)
  const token = presented && 'token' in presented ? presented.token : null
  if (!token) return next()
  let decoded: any
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!)
  } catch {
    return next()
  }
  if (!decoded?.impersonation) return next()
  if (decoded.role !== 'client' && !CAREGIVER_ROLES.has(String(decoded.role))) return next()
  if (VIEW_AS_ALLOWED_WRITES.has(c.req.path.replace(/\/+$/, ''))) return next()
  return fail(c, 403, decoded.role === 'client' ? PORTAL_PREVIEW_READ_ONLY : VIEW_AS_READ_ONLY, 'view_as_read_only')
}
