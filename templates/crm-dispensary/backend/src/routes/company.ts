import { Hono } from 'hono'
import { z } from 'zod'

import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission, invalidateExtraPermissions } from '../middleware/permissions.ts'

import { getFeaturesForTemplate } from '../shared/featureRegistry.ts'
import { passwordSchema } from '../shared/index.ts'
import { CRM_TEMPLATE } from '../config/template.ts'
import { loyaltyConfigResponse, LOYALTY_SETTING_KEYS } from '../utils/loyaltyConfig.ts'
import { storeTimeZone, isValidTimeZone } from '../utils/isoTime.ts'
import { forgetFeatures } from '../middleware/enabledFeature.ts'

// The 50 states plus DC and the territories a licence can be issued in. A state code is not cosmetic
// here: it decides the compliance day when no timezone is set, the purchase-limit fallback, and which
// report a regulator is handed. (T29 M6)
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY', 'PR', 'GU', 'VI', 'AS', 'MP',
])

const app = new Hono()
// Never serialize provider secrets to the client (VET-41 / F-26): GET & PUT /api/company
// returned the whole company row — including the Twilio auth token, account SID and Stripe
// customer id — to any authenticated user, regardless of role.
const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword'] as const
function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  // Settings → Loyalty reads these flat keys; they live under settings.loyalty. Without them the
  // screen fell back to its own placeholder numbers and looked like it had loaded a saved config. (T21 M7)
  Object.assign(clone, loyaltyConfigResponse(row))
  // Which clock the shop actually runs on, resolved here rather than in the browser. Settings →
  // General shows this as what "Automatic" resolves to; computing it client-side would mean a second
  // copy of STATE_TIME_ZONES that can drift from the one the compliance day is built on. Read-only —
  // it is derived, so it is not accepted on the way in. (T28 L-e)
  clone.effectiveTimeZone = storeTimeZone(row)
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
  const schema = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(), website: z.string().optional(), licenseNumber: z.string().optional(), taxRate: z.union([z.string(), z.number()]).optional(), localTaxRate: z.union([z.string(), z.number()]).optional(), exciseTaxRate: z.union([z.string(), z.number()]).optional(), purchaseLimitOz: z.union([z.string(), z.number()]).optional(), settings: z.record(z.any()).optional(),
    // store_hours is a real column and the refusal below tells callers to send it top-level — but it
    // had no place in this schema, so zod stripped it and the hours were dropped in silence. Settings
    // → General is the only writer; it sends {mon:{open,close,closed}, …}.
    storeHours: z.record(z.any()).optional(),
    // Settings → Loyalty sends these five. They had no place in this schema, so zod stripped every one
    // and the screen reported a save that never happened. (T21 M7)
    loyaltyPointsPerDollar: z.number().min(0).optional(),
    loyaltyWelcomePoints: z.number().int().min(0).optional(),
    loyaltyBirthdayBonus: z.number().int().min(0).optional(),
    loyaltyEnabled: z.boolean().optional(),
    loyaltyTierThresholds: z.record(z.number()).optional() })
  // .catch: a missing or malformed body must not throw past validation into a
  // 500 — the caller gets a 400 that names the problem instead.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  const data = schema.parse(body) as any
  // tax_rate columns are text — validate the RATE before storing. A negative rate silently zeroed the
  // register (−5% → $22 on a $20 order) and 9999% saved fine; both reach the POS. Reject anything outside
  // 0–100%, and coerce blank → '0'. (dispensary negative/oversized tax)
  for (const k of ['taxRate', 'localTaxRate', 'exciseTaxRate'] as const) {
    if (data[k] !== undefined) {
      const r = Number(data[k])
      if (!Number.isFinite(r) || r < 0 || r > 100) return c.json({ error: 'Tax rates must be between 0 and 100%.' }, 400)
      data[k] = String(r)
    }
  }
  if (data.purchaseLimitOz !== undefined) {
    const n = Number(data.purchaseLimitOz)
    // "between 0 and 16" while refusing 0 sent people looking for a bug that was not there — the
    // limit is a maximum per transaction, and a maximum of nothing would close the shop. Say what is
    // actually allowed. (T29 L7)
    if (!Number.isFinite(n) || n <= 0 || n > 16) return c.json({ error: 'purchaseLimitOz must be a number greater than 0 and no more than 16 (oz flower-equivalent per transaction)' }, 400)
    data.purchaseLimitOz = String(n)
  }
  // MERGE a partial settings object into the stored one — never replace it (see the shared company route:
  // a partial write used to wipe the whole blob). The UI sends the full object; any partial writer must not.
  // These five have a real column, which is where the pricing engine and the register read them, and
  // where they are validated — a rate outside 0–100 is refused above. Writing them into the settings
  // blob as well gave every one of them two homes holding two different answers, and the blob was
  // validated by nobody: {settings:{taxRate:"abc"}} was stored verbatim with a 200. It is only
  // harmless while nothing reads it, which is not a property worth relying on. Refuse the shadow copy
  // and name the field that does the work. (T21 L1, and the root of L2)
  const SHADOWED = ['taxRate', 'localTaxRate', 'exciseTaxRate', 'purchaseLimitOz', 'storeHours'] as const
  if (data.settings && typeof data.settings === 'object') {
    const shadowed = SHADOWED.filter(k => (data.settings as any)[k] !== undefined)
    if (shadowed.length) {
      return c.json({
        error: `${shadowed.join(', ')} ${shadowed.length === 1 ? 'is' : 'are'} stored on the company record, not in settings. Send ${shadowed.length === 1 ? 'it' : 'them'} as a top-level field so the value is validated and there is only one of it.`,
        code: 'SETTING_HAS_A_COLUMN',
        fields: shadowed,
      }, 400)
    }
    // settings.timezone decides which day a sale is reported on — compliance.ts, eod.ts, dashboard.ts
    // and analytics.ts all read it through storeTimeZone(). An unrecognised name there does not throw,
    // it silently falls back to the state, so the store would be told it saved a zone it is not using.
    // Refuse it at the door instead. (T28 L-e)
    const tz = (data.settings as any).timezone
    if (tz !== undefined && tz !== null && tz !== '' && !isValidTimeZone(tz)) {
      return c.json({ error: `"${String(tz).slice(0, 60)}" is not a timezone this system recognises. Use an IANA name such as America/Chicago.`, code: 'BAD_TIME_ZONE' }, 400)
    }
    // Payment terms drive an invoice's due date. −3 days made an invoice overdue the moment it was
    // raised and 400 pushed it past a year; both saved happily. (T29 M6)
    const terms = (data.settings as any).paymentTermsDays
    if (terms !== undefined && terms !== null && terms !== '') {
      const n = Number(terms)
      if (!Number.isInteger(n) || n < 0 || n > 365) {
        return c.json({ error: 'Payment terms must be a whole number of days between 0 and 365.', code: 'BAD_PAYMENT_TERMS' }, 400)
      }
    }
  }

  // A state code drives the compliance day, the purchase limit fallback and which report a regulator
  // is handed — "ZZ" saved without complaint. Two letters, and a real one. (T29 M6)
  if (data.state !== undefined && data.state !== null && String(data.state).trim() !== '') {
    const st = String(data.state).trim().toUpperCase()
    if (!US_STATES.has(st)) {
      return c.json({ error: `"${String(data.state).slice(0, 20)}" is not a US state code. Use a two-letter code such as OH.`, code: 'BAD_STATE' }, 400)
    }
    data.state = st
  }

  // The loyalty ladder has to ascend. silver 5,000 / gold 100 / platinum 1 was accepted, which makes
  // every tier above bronze unreachable or instantly granted — the award engine compares against these
  // in order and cannot do anything sensible with an inverted ladder. (T29 M6)
  if (data.loyaltyTierThresholds && typeof data.loyaltyTierThresholds === 'object') {
    const ladder = ['bronze', 'silver', 'gold', 'platinum'] as const
    const given = ladder.filter(t => (data.loyaltyTierThresholds as any)[t] !== undefined)
    let previous = -Infinity
    let previousName = ''
    for (const tier of given) {
      const v = Number((data.loyaltyTierThresholds as any)[tier])
      if (!Number.isFinite(v) || v < 0) {
        return c.json({ error: `The ${tier} threshold must be zero or more.`, code: 'BAD_TIER_THRESHOLDS' }, 400)
      }
      if (v <= previous) {
        return c.json({
          error: `Loyalty tiers have to climb: ${tier} (${v}) is not above ${previousName} (${previous}). A customer reaches ${previousName} first, so ${tier} must cost more.`,
          code: 'BAD_TIER_THRESHOLDS',
        }, 400)
      }
      previous = v
      previousName = tier
    }
  }

  const updates: any = { ...data, updatedAt: new Date() }
  // The loyalty settings live under settings.loyalty — the one place the award engine reads. Lift them
  // out of the flat body the screen sends and merge them in, leaving the rest of the blob alone. (T21 M7)
  const loyaltyPatch: Record<string, any> = {}
  for (const [bodyKey, settingKey] of Object.entries(LOYALTY_SETTING_KEYS)) {
    if (data[bodyKey] !== undefined) { loyaltyPatch[settingKey] = data[bodyKey]; delete updates[bodyKey] }
  }
  if ((data.settings && typeof data.settings === 'object') || Object.keys(loyaltyPatch).length) {
    const [cur] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
    const base = { ...((cur?.settings as any) || {}), ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) }
    // A merge has no way to say "remove this" — so null means remove. Without it a key could be
    // added and never taken away: the tester's t29Probe could not be cleared off the tenant at all,
    // and every stale key stays in the blob for good. The one exception is settings.timezone, where
    // null is a real stored value meaning "follow the licensed state" (T28 L-e); deleting the key
    // reads the same way to storeTimeZone(), so removal is still the right move. (T29 L6)
    for (const [k, v] of Object.entries(base)) if (v === null) delete (base as any)[k]
    updates.settings = Object.keys(loyaltyPatch).length
      ? { ...base, loyalty: { ...((base as any).loyalty || {}), ...loyaltyPatch } }
      : base
  }
  const [result] = await db.update(company).set(updates).where(eq(company.id, currentUser.companyId)).returning()
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
  forgetFeatures(currentUser.companyId) // so the very next request sees the switch the owner just flipped (M5)
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
  const schema = z.object({ email: z.string().email(), password: passwordSchema, firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).default('user') })
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
