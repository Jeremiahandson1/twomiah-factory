import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list company users (for dropdowns: assign rep, assign crew lead, etc.)
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
    })
    .from(user)
    .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))

  return c.json({ data: users })
})

// POST / — add a teammate (a real login seat).
//
// This is what makes the seat-based plan deliverable: without it an owner could
// see the Users list but had no way to add anyone, so every account was a
// one-person account no matter which tier they paid for. The Settings page used
// to POST /api/users/invite, which was never implemented and 404'd.
//
// The admin sets the teammate's first password and passes it on. We deliberately
// do NOT email an invite link: tenant outbound mail isn't proven on every tenant,
// and a mailed invite that silently never arrives looks identical to a broken
// product. `role` is limited to the roles this app actually checks
// (requireAdmin = admin|owner, requireManager adds manager) — 'owner' is not
// creatable here because signup mints the single owner.
app.post('/', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().optional(),
    role: z.enum(['admin', 'manager', 'user']).default('user'),
  })

  const body = await c.req.json()
  if (typeof body.email === 'string') body.email = body.email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

  // Scoped to the company: the same address may legitimately exist in another tenant.
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId)))
    .limit(1)
  if (existing) return c.json({ error: 'That email already has an account here' }, 409)

  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  const { password: _password, ...rest } = data

  const [created] = await db
    .insert(user)
    .values({ ...rest, passwordHash, companyId: currentUser.companyId })
    .returning({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
    })

  return c.json(created, 201)
})

export default app
