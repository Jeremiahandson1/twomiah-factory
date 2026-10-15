// "View As" is read-only on the server.
//
// POST /api/auth/impersonate/:userId gives an admin a session AS another staff member (the token
// carries `impersonation: true`). That session used to be able to write — clock in, record a dose,
// edit a client — as the person being viewed, with nothing in the record saying it was the admin.
// Now any request that is not a read (GET / HEAD / OPTIONS) made with such a token is refused 403
// here, before any route runs — the same rule the client portal's admin preview has always had
// (routes/portal.ts, portalAuth: "Portal preview is read-only"). Signing out is the one write allowed:
// it ends only the View As session (routes/auth.ts, POST /logout).
//
// Mounted on /api/* in src/index.ts ABOVE every route. It verifies the token itself (it cannot rely
// on a route's authenticate, which runs later); a missing or bad token is left for that route's own
// authenticate to refuse.
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'

export const VIEW_AS_READ_ONLY = 'View As is read-only — nothing can be changed while viewing as someone else. Exit View As to make changes.'
export const PORTAL_PREVIEW_READ_ONLY = 'Portal preview is read-only'
const READS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** The writes a View As session may still make. */
export const VIEW_AS_ALLOWED_WRITES = new Set(['/api/auth/logout'])

export const refuseViewAsWrites = async (c: Context, next: Next) => {
  if (READS.has(c.req.method)) return next()
  const token = c.req.header('authorization')?.split(' ')[1]
  if (!token) return next()
  let decoded: any
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!)
  } catch {
    return next()
  }
  if (!decoded?.impersonation) return next()
  if (VIEW_AS_ALLOWED_WRITES.has(c.req.path.replace(/\/+$/, ''))) return next()
  return c.json({ error: decoded.role === 'client' ? PORTAL_PREVIEW_READ_ONLY : VIEW_AS_READ_ONLY, code: 'view_as_read_only' }, 403)
}
