import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET / — list company users (for dropdowns: assign rep, assign crew lead, etc.)
//
// Active-only by DEFAULT, because that is what the assignment dropdowns want.
// Pass ?includeInactive=1 for the Settings list, which has to show revoked
// people so they can be reactivated — otherwise deactivating someone hides them
// forever and the action is one-way.
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const includeInactive = c.req.query('includeInactive') === '1'
  const where = includeInactive
    ? eq(user.companyId, currentUser.companyId)
    : and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true))
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
    .where(where)

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

  // Seat cap — same contract as the crm-family templates. SEAT_LIMIT (env,
  // written by the factory at deploy) wins; company.settings.seatLimit lets
  // staff change it without a redeploy. Neither set => no cap, on purpose:
  // refusing a paying customer's teammate because we never recorded their plan
  // is a worse failure than a missed cap.
  const [companyRow] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
  const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
  const seatLimit = Number.isInteger(envSeats) && envSeats > 0
    ? envSeats
    : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)

  if (seatLimit) {
    // Deactivated users free a seat, so count only those who can sign in.
    const activeSeats = await db.select({ id: user.id }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
    if (activeSeats.length >= seatLimit) {
      return c.json({
        error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
        seatLimit,
        activeSeats: activeSeats.length,
      }, 403)
    }
  }

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

// PUT /:id — change a teammate's role, or revoke their access.
//
// Revoking is a deactivation, not a delete: jobs, quotes and audit rows point at
// this user, and the seat count is of ACTIVE users, so isActive=false is what
// actually frees a seat. Before this route existed there was no way to remove
// someone's access at all — a fired employee kept their login until somebody
// edited the database by hand.
app.put('/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional(),
    role: z.enum(['admin', 'manager', 'user']).optional(),
    isActive: z.boolean().optional(),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data

  const [target] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  // Losing the last administrator is unrecoverable from inside the product.
  const losingAccess = data.isActive === false
  const demoting = data.role !== undefined && data.role !== 'admin' && (target.role === 'admin' || target.role === 'owner')
  if (losingAccess && id === currentUser.userId) {
    return c.json({ error: "You can't remove your own access." }, 400)
  }
  if ((losingAccess || demoting) && (target.role === 'admin' || target.role === 'owner')) {
    const activeUsers = await db.select({ id: user.id, role: user.role }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
    const admins = activeUsers.filter(u => u.role === 'admin' || u.role === 'owner')
    if (admins.length <= 1) {
      return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    }
  }

  const [updated] = await db.update(user).set({ ...data, updatedAt: new Date() })
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId)))
    .returning({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isActive: user.isActive,
    })

  return c.json(updated)
})

export default app
