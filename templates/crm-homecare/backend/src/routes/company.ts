import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { isValidTimezone, resolveTimezone } from '../services/agencyTime.ts'
import { parseMileageRate, MILEAGE_RATE_REFUSAL } from '../services/mileageRate.ts'
import { setAgencyFeatures } from '../services/agencyFeatures.ts'

const app = new Hono()
app.use('*', authenticate)

// Never serialize provider secrets to the client (VET-41 / F-26 pattern): GET & PUT
// /api/company returned the whole agency row — Twilio auth token, account SID, Stripe
// customer id — to any authenticated user. PHI app, so this matters more here.
const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword', 'sandataPasswordEncrypted', 'callrailSigningKey'] as const
function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  return clone
}

// GET /
app.get('/', async (c) => {
  const [agency] = await db.select().from(agencies).limit(1)
  // effectiveTimezone: the zone reports actually count days on — the agency's own setting, or the
  // one derived from its state when none is set (services/agencyTime.ts).
  return c.json({ ...sanitizeCompany(agency || {}), effectiveTimezone: resolveTimezone(agency || null) })
})

// PUT /
app.put('/', requireAdmin, async (c) => {
  const body = await c.req.json()
  // The Sandata password is written only through PUT /api/sandata/settings, which encrypts it.
  delete body.sandataPasswordEncrypted
  // Every report counts days on this zone (services/agencyTime.ts) and passes it to Postgres'
  // AT TIME ZONE — a zone Postgres does not know would fail every report, so refuse it here.
  if (body.timezone !== undefined && body.timezone !== null && body.timezone !== '' && !isValidTimezone(body.timezone)) {
    return c.json({ error: `"${String(body.timezone).slice(0, 64)}" is not a time zone — use an IANA name such as America/Chicago` }, 400)
  }
  if (body.timezone === '') body.timezone = null
  // The agency's mileage rate (what every caregiver trip is paid at — routes/mileage.ts).
  if (body.mileageRate !== undefined) {
    const n = parseMileageRate(body.mileageRate)
    if (n === null) return c.json({ error: MILEAGE_RATE_REFUSAL }, 400)
    body.mileageRate = String(n)
  }
  const [existing] = await db.select().from(agencies).limit(1)

  let agency
  if (existing) {
    ;[agency] = await db
      .update(agencies)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(agencies.id, existing.id))
      .returning()
  } else {
    const slug = (body.name || 'agency').toLowerCase().replace(/[^a-z0-9]/g, '-')
    ;[agency] = await db.insert(agencies).values({ ...body, slug }).returning()
  }

  return c.json(sanitizeCompany(agency))
})

// PUT /features — self-serve feature toggles (Settings → Features).
// Writes BOTH the enabledFeatures column AND settings.enabledFeatures: the
// frontend hasFeature() falls back to the settings blob (factory sync writes
// there), so updating only the column could never turn a blob-seeded feature off.
app.put('/features', requireAdmin, async (c) => {
  const { features } = await c.req.json()
  if (!Array.isArray(features) || features.some((f) => typeof f !== 'string')) {
    return c.json({ error: 'features must be an array of feature ids' }, 400)
  }
  // The one writer (services/agencyFeatures.ts): both fields, and the API gate's cache dropped.
  const agency = await setAgencyFeatures(null, features)
  if (!agency) return c.json({ error: 'Agency not found' }, 404)
  return c.json(sanitizeCompany(agency))
})

// GET /users - User management (all staff)
app.get('/users', requireAdmin, async (c) => {
  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      isActive: users.isActive,
      lastLogin: users.lastLogin,
    })
    .from(users)
    .orderBy(asc(users.role), asc(users.lastName))

  return c.json(userList)
})

export default app
