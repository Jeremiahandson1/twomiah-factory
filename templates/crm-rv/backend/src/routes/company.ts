import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const [result] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(result)
})

app.put('/', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(), website: z.string().optional(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional() })
  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  const data = schema.parse(body)
  const [result] = await db.update(company).set({ ...data, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(result)
})

app.put('/features', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const { features } = await c.req.json()
  const [result] = await db.update(company).set({ enabledFeatures: features, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(result)
})

// User management
app.get('/users', async (c) => {
  const currentUser = c.get('user') as any
  const users = await db.select({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  }).from(user).where(eq(user.companyId, currentUser.companyId))
  return c.json(users)
})

app.post('/users', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).default('user') })
  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  // safeParse, not parse: a ZodError carries no status, so the global
  // errorHandler turned every bad field into a 500 that production masked as
  // "Internal server error" — a typo'd email looked like a crash to the owner
  // adding a teammate.
  const parsed = schema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  const data = parsed.data

  // Seat cap. These plans are sold by the seat (10 / 25 / 50), so the software
  // has to hold that line — but only where a limit is actually configured.
  // SEAT_LIMIT (env, written by the factory at deploy) wins; settings.seatLimit
  // lets staff set or change it without a redeploy. Neither set => no cap, on
  // purpose: refusing a paying customer's teammate because we never recorded
  // their plan is a worse failure than a missed cap.
  //
  // NOT checkUsageLimits() from featureGate.ts — that demands a valid
  // subscription row (nothing ever inserts one, so every tenant would get 402)
  // and enforces the v1 PLAN_LIMITS ladder where starter = 2 users.
  const [companyRow] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
  const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
  const seatLimit = Number.isInteger(envSeats) && envSeats > 0
    ? envSeats
    : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)

  if (seatLimit) {
    // Count the seats that can actually sign in — deactivated users free a seat.
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

  const [existing] = await db.select().from(user).where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId))).limit(1)
  if (existing) return c.json({ error: 'Email already exists' }, 409)

  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  const { password, ...rest } = data
  const [newUser] = await db.insert(user).values({
    ...rest,
    passwordHash,
    companyId: currentUser.companyId,
  }).returning({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  })
  return c.json(newUser, 201)
})

app.put('/users/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).optional(), isActive: z.boolean().optional() })
  // safeParse, not parse — a ZodError has no .status and the global handler
  // turns it into a 500 that production masks as "Internal server error".
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data

  // Scope the lookup to this company. The original updated by id alone, so a
  // well-formed request could reach a row this admin has no claim to.
  const [target] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  // Guards against locking the company out of its own CRM. Losing the last
  // administrator is unrecoverable from inside the product — there is no
  // self-serve path back, it needs a database edit.
  const losingAccess = data.isActive === false
  const losingAdmin = losingAccess || (data.role !== undefined && data.role !== 'admin' && (target.role === 'admin' || target.role === 'owner'))
  if (losingAccess && id === currentUser.userId) {
    return c.json({ error: "You can't remove your own access." }, 400)
  }
  if (losingAdmin && (target.role === 'admin' || target.role === 'owner')) {
    const activeUsers = await db.select({ id: user.id, role: user.role }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
    const admins = activeUsers.filter(u => u.role === 'admin' || u.role === 'owner')
    if (admins.length <= 1) {
      return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    }
  }

  const [result] = await db.update(user).set({ ...data, updatedAt: new Date() })
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).returning({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
  })
  return c.json(result)
})

app.delete('/users/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  if (id === currentUser.userId) return c.json({ error: 'Cannot delete yourself' }, 400)
  await db.delete(user).where(eq(user.id, id))
  return c.json(null, 204)
})

// Update estimator settings
app.put('/estimator', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    estimatorEnabled: z.boolean(),
    pricePerSquareLow: z.string(),
    pricePerSquareHigh: z.string(),
    estimatorHeadline: z.string(),
    estimatorDisclaimer: z.string(),
  })
  const data = schema.parse(await c.req.json())
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
})

export default app
