// Home care's sign-in, on the app's shared one. Moved from templates/crm-homecare/backend/src/routes/auth.ts and
// middleware/{auth,viewAsReadOnly}.ts.
//
// The shared sign-in (packages/tenant-backend auth.ts, mounted at /api/auth by server/app.ts) serves login, the MFA
// step, refresh, logout, /me, the password routes. View As — which began here as the template's admin impersonation — is
// now every vertical's (server/core/viewAs.ts: POST/GET /api/auth/impersonate, Return, the rules, the audit). What home
// care keeps on top of it is here:
//
//   · withHomecareSessions — wraps the app's authenticate for the home-care vertical only (server/app.ts), inside the
//     View As wrapper:
//       – viewing as a CAREGIVER is read-only: any write made with a View As token for a caregiver seat is refused 403
//         before any route runs, Return being the one exception (core/viewAsReadOnly.ts says why). The template mounted
//         it on /api/*; every signed-in path passes through authenticate here, so it stands in the same place;
//       – signing out is server-side: a staff token issued before the person's last sign-out is refused on every
//         device (core/tokenRevocation.ts) — a View As of that person included, which then ends — and a successful
//         POST /api/auth/logout stamps user.last_logout_at. Return from a View As never gets here (core/viewAs.ts
//         answers it), so it never ends the viewed person's own sessions.
//   · GET /api/auth/users — the staff list the header's View As picker offers (office/ImpersonationModal.tsx);
//   · the clinical trail's ADMIN_IMPERSONATE row when a View As starts (viewAsCareTrail, handed to core/viewAs.ts).
//
// Permissions: the picker is users:read, which the owner and admins hold (the people list is theirs).
import { Hono, type MiddlewareHandler } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { clearViewAsCookie, requestToken } from '@twomiah/tenant-backend'
import { auditLogs, user } from '../../../db/schema/index.ts'
import { fail, listAll } from '../../../http/reply.ts'
import type { AppEnv } from '../../../http/env.ts'
import type { CrmDeps } from '../../deps.ts'
import { createTokenRevocation } from '../core/tokenRevocation.ts'
import { refuseViewAsWrites } from '../core/viewAsReadOnly.ts'

export const SESSION_ENDED = 'Invalid or expired token'
const LOGOUT = '/api/auth/logout'

/** The verified token this request carries (header or a cookie), or null. Never throws. */
function verifiedToken(c: any): any | null {
  const presented: any = requestToken(c)
  const token = presented && 'token' in presented ? presented.token : null
  if (!token) return null
  try { return jwt.verify(token, process.env.JWT_SECRET!) } catch { return null }
}

/** Did this request come in on the View As cookie? */
const onViewAsCookie = (c: any): boolean => { const p: any = requestToken(c); return !!p && p.via === 'view-as' }

/**
 * The app's sign-in check for a home-care tenant: viewing as a caregiver is read-only, a token from before the person's
 * last sign-out is refused, and signing out ends every session. `real` is the shared authenticate.
 */
export function withHomecareSessions(real: MiddlewareHandler, deps: Pick<CrmDeps, 'db' | 'logger'>): MiddlewareHandler {
  const tokens = createTokenRevocation(deps)
  return async (c, next) => {
    const decoded = verifiedToken(c)
    // A View As of someone who has since signed out everywhere has ended: the cookie is dropped and the request refused
    // as signed out, so the screens' client refreshes the office's own session and asks again — as the office.
    if (onViewAsCookie(c) && (!decoded?.impersonation || await tokens.isStaffTokenRevoked(decoded))) {
      clearViewAsCookie(c)
      return fail(c, 401, SESSION_ENDED)
    }
    if (decoded?.impersonation) {
      let through = false
      const refused = await refuseViewAsWrites(c, async () => { through = true })
      if (!through) return refused as Response
    }
    if (decoded && await tokens.isStaffTokenRevoked(decoded)) return fail(c, 401, SESSION_ENDED)
    return real(c, async () => {
      await next()
      if (c.req.method === 'POST' && c.req.path.replace(/\/+$/, '') === LOGOUT && c.res.status === 200 && decoded && !decoded.impersonation) {
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
    return listAll(c, rows)
  })
  return app
}

/**
 * The clinical trail's row for a View As (audit_logs ADMIN_IMPERSONATE — the template's, kept beside the app's own
 * view_as_start row). core/viewAs.ts writes it before the View As opens: no row, no View As.
 */
export const viewAsCareTrail = (db: any) => async (r: { companyId: string; actorId: string; actorEmail: string; targetId: string; targetEmail: string }) => {
  await db.insert(auditLogs).values({
    companyId: r.companyId, userId: r.actorId, action: 'ADMIN_IMPERSONATE', tableName: 'users', recordId: r.targetId,
    newData: { impersonating: r.targetEmail, impersonatedBy: r.actorEmail } as any,
  } as any)
}
