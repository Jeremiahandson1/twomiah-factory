import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { agencies, users } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// Never serialize provider secrets to the client (VET-41 / F-26 pattern): GET & PUT
// /api/company returned the whole agency row — Twilio auth token, account SID, Stripe
// customer id — to any authenticated user. PHI app, so this matters more here.
const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword'] as const
function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  return clone
}

// GET /
app.get('/', async (c) => {
  const [agency] = await db.select().from(agencies).limit(1)
  return c.json(sanitizeCompany(agency || {}))
})

// PUT /
app.put('/', requireAdmin, async (c) => {
  const body = await c.req.json()
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
  const [existing] = await db.select().from(agencies).limit(1)
  if (!existing) return c.json({ error: 'Agency not found' }, 404)
  let settings = existing.settings || {}
  if (typeof settings === 'string') { try { settings = JSON.parse(settings) } catch { settings = {} } }
  const [agency] = await db
    .update(agencies)
    .set({ enabledFeatures: features, settings: { ...settings, enabledFeatures: features }, updatedAt: new Date() })
    .where(eq(agencies.id, existing.id))
    .returning()
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
