// "View As" is read-only on the server. Moved from templates/crm-homecare/backend/src/middleware/viewAsReadOnly.ts.
// Pure (it verifies the token itself; no database).
//
// Home care's POST /api/auth/impersonate/:userId gives an admin a session AS another staff member (the token carries
// `impersonation: true`). Any request that is not a read made with such a token is refused 403 here, before any route
// runs — the same rule the client portal's admin preview has. Signing out is the one write allowed.
//
// In the template it was mounted on /api/* above every route. Here it runs inside the app's one sign-in check for a
// home-care tenant (office/signIn.ts withHomecareSessions), before every signed-in route. The token is read the way
// the app's sign-in reads it (the header, the View As cookie, or the session cookie).
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { requestToken } from '@twomiah/tenant-backend'
import { fail } from '../../../http/reply.ts'

export const VIEW_AS_READ_ONLY = 'View As is read-only — nothing can be changed while viewing as someone else. Exit View As to make changes.'
export const PORTAL_PREVIEW_READ_ONLY = 'Portal preview is read-only'
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** The writes a View As session may still make. */
export const VIEW_AS_ALLOWED_WRITES = new Set(['/api/auth/logout'])

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
  if (VIEW_AS_ALLOWED_WRITES.has(c.req.path.replace(/\/+$/, ''))) return next()
  return fail(c, 403, decoded.role === 'client' ? PORTAL_PREVIEW_READ_ONLY : VIEW_AS_READ_ONLY, 'view_as_read_only')
}
