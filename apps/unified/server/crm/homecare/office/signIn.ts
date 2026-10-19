// Home care's sign-in, on the app's shared one. Moved from templates/crm-homecare/backend/src/routes/auth.ts and
// middleware/{auth,viewAsReadOnly}.ts.
//
// The shared sign-in (packages/tenant-backend auth.ts, mounted at /api/auth by server/app.ts) serves login, the MFA
// step, refresh, logout, /me, the password routes. What home care had on top of it is here:
//
//   · withHomecareSessions — wraps the app's authenticate for the home-care vertical only (server/app.ts):
//       – View As is read-only: any write made with a View As token is refused 403 before any route runs, the one
//         exception being signing out (core/viewAsReadOnly.ts). The template mounted it on /api/*; every signed-in
//         path passes through authenticate here, so it stands in the same place;
//       – signing out is server-side: a staff token issued before the person's last sign-out is refused on every
//         device (core/tokenRevocation.ts), and a successful POST /api/auth/logout stamps user.last_logout_at — except
//         from a View As session, which ends only itself, never the viewed person's own sessions.
//   · GET /api/auth/users — the staff list the View As picker offers;
//   · POST /api/auth/impersonate/:userId — View As: a 2-hour token for that person, marked `impersonation`, with no
//     refresh token, audited in the clinical trail (ADMIN_IMPERSONATE). No audit row, no token.
//
// Permissions: both were requireAdmin (owner or admin) → users:read, which exactly those two seats hold (the people
// list is theirs). A View As token carries the viewed person's role, so nobody may view as a person on a higher rung
// than their own (the template's "an admin may not view as an owner", for every rung).
import { Hono, type MiddlewareHandler } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { requestToken } from '@twomiah/tenant-backend'
import { auditLogs, user } from '../../../db/schema/index.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import { createTokenRevocation } from '../core/tokenRevocation.ts'
import { refuseViewAsWrites } from '../core/viewAsReadOnly.ts'

export const IMPERSONATION_HOURS = 2
export const SESSION_ENDED = 'Invalid or expired token'
const LOGOUT = '/api/auth/logout'

/** The verified token this request carries (header or session cookie), or null. Never throws. */
function verifiedToken(c: any): any | null {
  const presented: any = requestToken(c)
  const token = presented && 'token' in presented ? presented.token : null
  if (!token) return null
  try { return jwt.verify(token, process.env.JWT_SECRET!) } catch { return null }
}

/**
 * The app's sign-in check for a home-care tenant: View As is read-only, a token from before the person's last
 * sign-out is refused, and signing out ends every session. `real` is the shared authenticate.
 */
export function withHomecareSessions(real: MiddlewareHandler, deps: Pick<CrmDeps, 'db' | 'logger'>): MiddlewareHandler {
  const tokens = createTokenRevocation(deps as CrmDeps)
  return async (c, next) => {
    const decoded = verifiedToken(c)
    if (decoded?.impersonation) {
      let through = false
      const refused = await refuseViewAsWrites(c, async () => { through = true })
      if (!through) return refused as Response
      // Signing out of View As ends only the View As token (the screen drops it). It never reaches the shared
      // sign-out, which would revoke the viewed person's own refresh tokens.
      if (c.req.method === 'POST' && c.req.path.replace(/\/+$/, '') === LOGOUT) return one(c, { message: 'Logged out' })
    }
    if (decoded && await tokens.isStaffTokenRevoked(decoded)) return fail(c, 401, SESSION_ENDED)
    return real(c, async () => {
      await next()
      if (c.req.method === 'POST' && c.req.path.replace(/\/+$/, '') === LOGOUT && c.res.status === 200 && decoded) {
        const signedIn = c.get('user' as never) as any
        if (signedIn?.userId) await tokens.markUserLoggedOut(signedIn.userId)
      }
    })
  }
}

/** GET /api/auth/users — the people View As can be used on: this company's active staff. */
export function createStaffPickerRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  app.get('/', d.permissions.requirePermission('users:read'), async (c) => {
    const rows = await d.db.select({
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      email: user.email, role: user.role, isActive: user.isActive,
    }).from(user).where(and(eq(user.companyId, c.get('user').companyId), eq(user.isActive, true))).orderBy(asc(user.lastName))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })
  return app
}

/** POST /api/auth/impersonate/:userId — View As (ported to the template from CVHC authRoutes.js). */
export function createViewAsRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission, normalizeRole, ROLE_HIERARCHY } = d.permissions
  const rung = (role: string) => (ROLE_HIERARCHY as string[]).indexOf(normalizeRole(role))

  app.post('/:userId', requirePermission('users:read'), async (c) => {
    const actor = c.get('user')
    const [target] = await d.db.select({
      id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, isActive: user.isActive,
    }).from(user).where(and(eq(user.id, c.req.param('userId')), eq(user.companyId, actor.companyId))).limit(1)
    if (!target) return fail(c, 404, 'User not found')
    if (target.isActive === false) return fail(c, 400, 'This user is deactivated.')
    // The token would carry the target's role: never more than the person asking has.
    if (rung(target.role) > rung(actor.role)) {
      return fail(c, 403, normalizeRole(target.role) === 'owner' ? 'Only an owner can view as an owner.' : 'You can only view as someone at or below your own role.')
    }

    const name = `${target.firstName || ''} ${target.lastName || ''}`.trim()
    try {
      await d.db.insert(auditLogs).values({
        companyId: actor.companyId, userId: actor.userId, action: 'ADMIN_IMPERSONATE', tableName: 'users', recordId: target.id,
        newData: { impersonating: target.email, impersonatedBy: actor.email } as any,
      } as any)
    } catch {
      // The audit row is the point of this route: no row, no token.
      return fail(c, 500, 'Could not record the View As in the audit log — try again.')
    }
    const token = jwt.sign(
      { userId: target.id, email: target.email, role: target.role, companyId: actor.companyId, name, impersonatedBy: actor.email, impersonation: true },
      process.env.JWT_SECRET!,
      { expiresIn: `${IMPERSONATION_HOURS}h` },
    )
    return one(c, {
      token,
      user: { id: target.id, email: target.email, name, firstName: target.firstName, lastName: target.lastName, role: target.role, impersonatedBy: actor.email },
    })
  })
  return app
}
