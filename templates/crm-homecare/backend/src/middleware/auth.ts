import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { db } from '../../db/index.ts'
import { loginActivity, agencies } from '../../db/schema.ts'
import { isStaffTokenRevoked } from '../services/tokenRevocation.ts'
import { refuseWhileLocked } from '../shared/index.ts'

export const authenticate = async (c: Context, next: Next) => {
  const authHeader = c.req.header('authorization')
  const token = authHeader?.split(' ')[1]
  if (!token) return c.json({ error: 'Access token required' }, 401)

  let decoded: any
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
  // A token issued before the user's last logout is dead on every device (server-side logout).
  if (await isStaffTokenRevoked(decoded)) return c.json({ error: 'Invalid or expired token' }, 401)
  c.set('user', decoded)
  // A company the Factory has cancelled is LOCKED (shared auth/accountLock.ts): 402 ACCOUNT_LOCKED on everything but
  // signing in and the subscription's own doors. Home care was left out of the 10/14 lock, so "Cancel now" in the
  // Factory left the agency's CRM fully open (Run 3, blocker 2). The agency row is this tenant's company.
  const locked = await refuseWhileLocked(c, db, agencies)
  if (locked) return locked
  await next()
}

export const requireAdmin = async (c: Context, next: Next) => {
  const user = c.get('user')
  if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
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
