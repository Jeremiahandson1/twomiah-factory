import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { db } from '../../db/index.ts'
import { loginActivity } from '../../db/schema.ts'

export const authenticate = async (c: Context, next: Next) => {
  const authHeader = c.req.header('authorization')
  const token = authHeader?.split(' ')[1]
  if (!token) return c.json({ error: 'Access token required' }, 401)

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    c.set('user', decoded)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

export const requireAdmin = async (c: Context, next: Next) => {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403)
  }
  await next()
}

export const logAuthEvent = async (data: {
  email: string
  userId?: string
  success: boolean
  ipAddress?: string
  userAgent?: string
  failReason?: string
}) => {
  try {
    await db.insert(loginActivity).values({
      email: data.email,
      userId: data.userId,
      success: data.success,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      failReason: data.failReason,
    })
  } catch {
    // Don't fail the request if logging fails
  }
}

export default authenticate
