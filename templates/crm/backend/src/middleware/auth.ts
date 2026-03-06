import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'

export const authenticate = async (c: Context, next: Next) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No token provided' }, 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

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

    c.set('user', { userId: found.id, companyId: found.companyId, email: found.email, role: found.role })
    await next()
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return c.json({ error: 'Token expired' }, 401)
    }
    return c.json({ error: 'Invalid token' }, 401)
  }
}

export const requireRole = (...roles: string[]) => async (c: Context, next: Next) => {
  const u = c.get('user')
  if (!u) return c.json({ error: 'Not authenticated' }, 401)
  if (!roles.includes(u.role)) return c.json({ error: 'Insufficient permissions' }, 403)
  await next()
}

export const requireAdmin = requireRole('admin')
export const requireManager = requireRole('admin', 'manager')

export default authenticate
