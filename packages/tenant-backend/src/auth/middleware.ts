// Bearer-token authentication + role gates — one implementation for every CRM.
// The template injects its Drizzle db + user table; the JWT secret comes from JWT_SECRET.
// `authenticate` sets c.var.user = { userId, companyId, email, role } for every downstream route.
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'

export interface AuthMiddlewareDeps {
  db: any
  tables: { user: any }
}

export interface AuthUserContext { userId: string; companyId: string; email: string; role: string }

export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
  const { db, tables: { user } } = deps

  const authenticate = async (c: Context, next: Next) => {
    const authHeader = c.req.header('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'No token provided' }, 401)
    }
    const token = authHeader.split(' ')[1]
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
    }).from(user).where(eq(user.id, decoded.userId)).limit(1)
    if (!found || !found.isActive) {
      return c.json({ error: 'User not found or inactive' }, 401)
    }
    c.set('user', { userId: found.id, companyId: found.companyId, email: found.email, role: found.role } as AuthUserContext)
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
