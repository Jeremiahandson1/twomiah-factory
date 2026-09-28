// SANDBOX COPY for crm-homecare only. Picked up by runSuite because it is named for the template.
//
// The default stub cannot be used here, and the reasons are all shape, not preference:
//   · homecare's authenticate never touches the database — it jwt.verify()s and sets the decoded
//     payload as the context. There is no user lookup to bridge.
//   · its schema exports `users`, while the default stub imports `user`.
//   · `users` has no companyId column, so there is nothing for the default stub to select.
//   · its auth.ts also exports logAuthEvent, which routes/auth.ts imports.
//
// So this mirrors homecare's own auth.ts exactly, with one addition: the x-test-user bridge. The
// REAL jwt path is still constructed and still used when no such header is present, and the context
// object is identical either way — the decoded-token shape, built from headers instead of a token.
import type { Context, Next } from 'hono'
import jwt from 'jsonwebtoken'

export const authenticate = async (c: Context, next: Next) => {
  const testUser = c.req.header('x-test-user')
  if (testUser) {
    c.set('user', {
      userId: testUser,
      id: testUser,
      agencyId: c.req.header('x-test-agency') || undefined,
      companyId: c.req.header('x-test-company') || undefined,
      email: c.req.header('x-test-email') || `${testUser}@test.local`,
      role: c.req.header('x-test-role') || 'caregiver',
    })
    await next()
    return
  }

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

// Byte-for-byte the rule from the template: admin or owner, else 403. This is homecare's ENTIRE
// authorisation model — 69 route-level uses — so it is the thing the suite is really exercising and
// it is deliberately not softened for tests.
export const requireAdmin = async (c: Context, next: Next) => {
  const user = c.get('user') as any
  if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
    return c.json({ error: 'Admin access required' }, 403)
  }
  await next()
}

// routes/auth.ts imports this. Writing login rows is not what these tests are about, and the real
// one inserts into loginActivity, so it is a no-op here rather than a second implementation.
export const logAuthEvent = async (_data: unknown) => {}

export default authenticate
