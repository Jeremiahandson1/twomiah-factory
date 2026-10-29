// Bearer-token authentication + role gates — one implementation for every CRM.
// The template injects its Drizzle db + user table; the JWT secret comes from JWT_SECRET.
// `authenticate` sets c.var.user = { userId, companyId, email, role } for every downstream route.
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { refuseWhileLocked } from './accountLock'
import { requestToken } from './cookieSession'

export interface AuthMiddlewareDeps {
  db: any
  /** company is required: authenticate refuses a locked company's requests (auth/accountLock.ts). */
  tables: { user: any; company: any }
}

export interface AuthUserContext { userId: string; companyId: string; email: string; role: string }

// What `authenticate` puts on the request, declared once for every router in this package (Hono's documented way). The
// shared routers are plain `new Hono()`, so without this `c.get('user')` (255 reads) did not type-check from any app that
// compiles them — 150 of the Factory's 264 errors. The unified app's own AppEnv says the same thing for its routers.
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUserContext
  }
}

/**
 * Was this token signed before the account's sessions were ended (a password change or reset)? A JWT's iat is in whole
 * seconds, so the cut-off is compared in whole seconds: the new session given in the same second stays valid.
 */
export function sessionEnded(validFrom: Date | string | null | undefined, iat: number | undefined): boolean {
  if (!validFrom) return false
  const from = Math.floor(new Date(validFrom).getTime() / 1000)
  return !Number.isFinite(from) ? false : typeof iat !== 'number' || iat < from
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  const { db, tables: { user, company } } = deps

  const authenticate = async (c: Context, next: Next) => {
    // The Authorization header (the mobile app, the templates' screens, scripts) or the browser's session cookie
    // (auth/cookieSession.ts); a cookie-signed change must also carry X-Auth-Mode.
    const presented = requestToken(c)
    if (!presented) return c.json({ error: 'No token provided' }, 401)
    if ('refused' in presented) return c.json({ error: presented.refused, code: 'auth_mode_required' }, 403)
    const token = presented.token
    let decoded: any
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!)
    } catch (error: any) {
      if (error?.name === 'TokenExpiredError') return c.json({ error: 'Token expired' }, 401)
      return c.json({ error: 'Invalid token' }, 401)
    }
    // The DB lookup sits outside the verify try/catch: a database error must surface as a 500 through
    // the app's error handler, not masquerade as "Invalid token" and log the user out.
    const [found] = await db.select({
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      // Only where the user table has it (the unified app); a template without the column keeps its old behaviour.
      ...(user.sessionsValidFrom ? { sessionsValidFrom: user.sessionsValidFrom } : {}),
    }).from(user).where(eq(user.id, decoded.userId)).limit(1)
    if (!found || !found.isActive) {
      return c.json({ error: 'User not found or inactive' }, 401)
    }
    // A session signed before the password was changed or reset is over (auth.ts endOtherSessions).
    if (sessionEnded((found as any).sessionsValidFrom, decoded.iat)) {
      return c.json({ error: 'Your password was changed — please sign in again.', code: 'session_ended' }, 401)
    }
    c.set('user', { userId: found.id, companyId: found.companyId, email: found.email, role: found.role } as AuthUserContext)
    const locked = await refuseWhileLocked(c, db, company)
    if (locked) return locked
    await next()
  }

  const requireRole = (...roles: string[]) => async (c: Context, next: Next) => {
    const u = c.get('user') as AuthUserContext | undefined
    if (!u) return c.json({ error: 'Not authenticated' }, 401)
    if (!roles.includes(u.role)) return c.json({ error: 'Insufficient permissions' }, 403)
    await next()
  }

  return {
    authenticate,
    requireRole,
    requireAdmin: requireRole('admin', 'owner'),
    requireManager: requireRole('admin', 'owner', 'manager'),
  }
}
