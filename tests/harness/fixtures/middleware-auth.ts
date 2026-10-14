// SANDBOX COPY — see scratchpad/refresh-saltest.ts. The only difference from the generated file is the
// x-test-user bridge below; the real middleware is still constructed and still used when no such header
// is present, and the context object is identical either way.
import { createAuthMiddleware, refuseWhileLocked } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { user, company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

const real = createAuthMiddleware({ db, tables: { user, company } })

export const authenticate = async (c: any, next: any) => {
  const id = c.req.header('x-test-user')
  if (!id) return real.authenticate(c, next)
  const [found] = await db.select({ id: user.id, companyId: user.companyId, email: user.email, role: user.role, isActive: user.isActive })
    .from(user).where(eq(user.id, id)).limit(1)
  if (!found || !found.isActive) return c.json({ error: 'User not found or inactive' }, 401)
  c.set('user', { userId: found.id, companyId: found.companyId, email: found.email, role: found.role })
  // The bridge keeps the real middleware's lock, or no suite would ever see a locked company.
  const locked = await refuseWhileLocked(c, db, company)
  if (locked) return locked
  await next()
}

export const { requireRole, requireAdmin, requireManager } = real

export default authenticate
