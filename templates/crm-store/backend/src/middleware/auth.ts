import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { db } from '../../db/index.ts'
import { users, storeSettings } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { refuseWhileLocked } from '../shared/index.ts'

// Tenant-staff JWT auth. crm-store is single-tenant-per-deployment, so there is
// no companyId — the whole DB IS the tenant. We attach the authenticated user to
// the request context for the admin routes.
export const authenticate = async (c: Context, next: Next) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No token provided' }, 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

    const [found] = await db.select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    }).from(users).where(eq(users.id, decoded.userId)).limit(1)

    if (!found || !found.isActive) {
      return c.json({ error: 'User not found or inactive' }, 401)
    }

    c.set('user', { userId: found.id, email: found.email, role: found.role })
    // A store the Factory has locked keeps only sign-in and billing (shared auth/accountLock.ts). The store keeps the
    // Factory's summary in store_settings.subscription — it has no company row. (10/14)
    const locked = await refuseWhileLocked(c, db, storeSettings, storeSettings.subscription)
    if (locked) return locked
    await next()
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return c.json({ error: 'Token expired' }, 401)
    }
    return c.json({ error: 'Invalid token' }, 401)
  }
}

// Who may do what is ./permissions.ts (requirePermission), the fleet's matrix. The rank gates that used
// to live here — requireRole('owner'), requireOwner — are gone: a rank is not a permission, and they
// are why the store could only ever have an owner and everybody else.

export default authenticate
