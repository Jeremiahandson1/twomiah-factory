import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission, invalidateExtraPermissions } from '../middleware/permissions.ts'

import { getFeaturesForTemplate } from '../shared/featureRegistry.ts'
import { CRM_TEMPLATE } from '../config/template.ts'

const app = new Hono()
// Never serialize provider secrets to the client (VET-41 / F-26): GET & PUT /api/company
// returned the whole company row — including the Twilio auth token, account SID and Stripe
// customer id — to any authenticated user, regardless of role.
const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword'] as const
function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  return clone
}

app.use('*', authenticate)

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const [result] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(sanitizeCompany(result))
})

app.put('/', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(), website: z.string().optional(), licenseNumber: z.string().optional(), taxRate: z.union([z.string(), z.number()]).optional(), localTaxRate: z.union([z.string(), z.number()]).optional(), exciseTaxRate: z.union([z.string(), z.number()]).optional(), purchaseLimitOz: z.union([z.string(), z.number()]).optional(), settings: z.record(z.any()).optional() })
  // .catch: a missing or malformed body must not throw past validation into a
  // 500 — the caller gets a 400 that names the problem instead.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  const data = schema.parse(body) as any
  // tax_rate is a text column — the Settings form saved it but the schema dropped
  // it, so Settings/company/POS disagreed on the rate. Persist it as a string.
  if (data.taxRate !== undefined) data.taxRate = String(data.taxRate)
  if (data.localTaxRate !== undefined) data.localTaxRate = String(data.localTaxRate)
  if (data.exciseTaxRate !== undefined) data.exciseTaxRate = String(data.exciseTaxRate)
  if (data.purchaseLimitOz !== undefined) {
    const n = Number(data.purchaseLimitOz)
    if (!Number.isFinite(n) || n <= 0 || n > 16) return c.json({ error: 'purchaseLimitOz must be a number between 0 and 16 (oz flower-equivalent per transaction)' }, 400)
    data.purchaseLimitOz = String(n)
  }
  const [result] = await db.update(company).set({ ...data, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(sanitizeCompany(result))
})

// The Features page renders THIS — the registry entries offered to this template — never a local
// catalog with its own ids ("Quoting 0/7 on" while quotes worked: Wrench QA W-9). Any signed-in user
// may read it; only admins write (below).
app.get('/features/catalog', async (c) => {
  const features = getFeaturesForTemplate(CRM_TEMPLATE)
    .filter(f => !f.hidden)
    .map(({ id, name, description, category, core }) => ({ id, name, description, category, core }))
  return c.json({ template: CRM_TEMPLATE, features })
})

app.put('/features', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  // Guard the body: null and malformed both used to throw on the destructure
  // and surface as a 500. Then REQUIRE a string array — previously any shape was
  // written through, and `undefined` made drizzle skip the column entirely, so a
  // malformed save silently did nothing and still returned 200.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const { features } = body as { features?: unknown }
  if (!Array.isArray(features) || features.some((f: unknown) => typeof f !== 'string')) {
    return c.json({ error: 'features must be an array of feature ids' }, 400)
  }
  // Only ids this template offers may be switched on — the registry is the one vocabulary. Ids the
  // Factory already enabled stay (it may grant beyond the catalog); anything else is a 400, not a
  // silent write of a name nothing reads. Core features are always kept on.
  const [current] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const offered = getFeaturesForTemplate(CRM_TEMPLATE)
  const allowed = new Set<string>([...offered.map(f => f.id), ...((current?.enabledFeatures || []) as string[])])
  const unknown = (features as string[]).filter(f => !allowed.has(f))
  if (unknown.length) return c.json({ error: `Unknown feature ids for this product: ${unknown.join(', ')}` }, 400)
  const next = [...new Set([...offered.filter(f => f.core).map(f => f.id), ...(features as string[])])]
  const [result] = await db.update(company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(sanitizeCompany(result))
})

// User management (roster carries emails/roles) — require team:read.
// Who may see the login-user list: the OWNER, plus anyone the owner grants 'users:read' to
// (Settings › Users). Managers used to get it through team:read. (Wrench QA decision)
app.get('/users', requirePermission('users:read'), async (c) => {
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
    extraPermissions: (user as any).extraPermissions,
  }).from(user).where(eq(user.companyId, currentUser.companyId))
  return c.json(users)
})

app.post('/users', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).default('user') })
  // .catch: a missing or malformed body must not throw past validation into a
  // 500 — the caller gets a 400 that names the problem instead.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  // safeParse, not parse: a ZodError carries no status, so the global
  // errorHandler turned every bad field into a 500 that production masked as
  // "Internal server error" — a typo'd email looked like a crash to the owner
  // adding a teammate.
  const parsed = schema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  const data = parsed.data

  // Hash before opening the transaction — bcrypt takes ~100ms and must not be
  // done while holding a row lock.
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  const { password, ...rest } = data

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
  //
  // The count and the insert MUST happen together under a lock. A plain
  // transaction is not enough: at READ COMMITTED two concurrent adds would each
  // count the same 9 and both insert. Locking the company row first makes every
  // competing add for this company queue behind us.
  const outcome = await db.transaction(async (tx) => {
    const [companyRow] = await tx.select().from(company)
      .where(eq(company.id, currentUser.companyId)).limit(1).for('update')

    const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
    const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
    // Fallback to the recorded plan's MAX seats (starter 10 / pro 25 / business 50 /
    // enterprise unlimited) when no explicit SEAT_LIMIT/settings.seatLimit is set, so the
    // sold seat cap is actually enforced. An UNKNOWN plan still means no cap (fail-open — we
    // never refuse a paying customer whose plan we didn't record). (retest#14)
    const PLAN_SEAT_MAX: Record<string, number | null> = { starter: 10, pro: 25, business: 50, enterprise: null }
    const planKey = String((companyRow as any)?.subscriptionTier || (companyRow?.settings as any)?.plan || '').toLowerCase()
    const planMax = planKey in PLAN_SEAT_MAX ? PLAN_SEAT_MAX[planKey] : undefined
    const seatLimit = Number.isInteger(envSeats) && envSeats > 0
      ? envSeats
      : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : (planMax !== undefined ? planMax : null))

    if (seatLimit) {
      // Count the seats that can actually sign in — deactivated users free a seat.
      const activeSeats = await tx.select({ id: user.id }).from(user)
        .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
      if (activeSeats.length >= seatLimit) {
        return { status: 403 as const, body: {
          error: `Your plan allows up to ${seatLimit} seat${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
          seatLimit,
          activeSeats: activeSeats.length,
        } }
      }
    }

    const [existing] = await tx.select().from(user)
      .where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId))).limit(1)
    if (existing) return { status: 409 as const, body: { error: 'Email already exists' } }

    const [newUser] = await tx.insert(user).values({
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
    return { status: 201 as const, body: newUser }
  })

  return c.json(outcome.body as any, outcome.status)
})

app.put('/users/:id', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).optional(), extraPermissions: z.array(z.enum(['users:read'])).optional(), isActive: z.boolean().optional() })
  // safeParse, not parse — a ZodError has no .status and the global handler
  // turns it into a 500 that production masks as "Internal server error".
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data
  // Grants are the owner's alone to give — an admin cannot widen their own or anyone's access.
  if (data.extraPermissions !== undefined && currentUser.role !== 'owner') return c.json({ error: 'Only the owner can grant or revoke permissions.' }, 403)

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

  if (data.extraPermissions !== undefined) invalidateExtraPermissions(id)
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
