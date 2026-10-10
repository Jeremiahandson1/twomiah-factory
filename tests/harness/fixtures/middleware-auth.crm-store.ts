// SANDBOX COPY of crm-store's src/middleware/auth.ts — the x-test-user bridge is the only addition.
//
// crm-store needs its own fixture rather than the generic one because its auth is nothing like the
// contractor lineage's: the table is `users` (not `user`), there is NO companyId at all — the whole
// database IS the tenant, it is single-tenant per deployment. Who may do what is the REAL
// src/middleware/permissions.ts, which the sandbox does not replace. The generic fixture imports `user` and `companyId` and would not even
// load here.
//
// The real JWT path below is preserved verbatim, so a test that sends no x-test-user header still
// exercises the actual middleware, and the context object is identical either way.
import { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

export const authenticate = async (c: Context, next: Next) => {
  const testUser = c.req.header('x-test-user')
  if (testUser) {
    const [found] = await db.select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
      .from(users).where(eq(users.id, testUser)).limit(1)
    if (!found || !found.isActive) return c.json({ error: 'User not found or inactive' }, 401)
    c.set('user', { userId: found.id, email: found.email, role: found.role })
    return next()
  }

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
    await next()
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return c.json({ error: 'Token expired' }, 401)
    }
    return c.json({ error: 'Invalid token' }, 401)
  }
}

export default authenticate
