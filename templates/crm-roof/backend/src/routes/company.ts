import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

// Tenant-facing company endpoints. Until now roof had NO /api/company mount —
// the frontend's api.company.get()/updateFeatures() calls 404'd, and the only
// feature writer was the internal factory sync. This powers the self-serve
// Settings → Features page (every feature free to toggle, admin/owner only).
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

app.put('/features', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  // Guard the body — null/malformed threw on the destructure and became a 500.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const { features } = body as { features?: unknown }
  if (!Array.isArray(features) || features.some((f) => typeof f !== 'string')) {
    return c.json({ error: 'features must be an array of feature ids' }, 400)
  }
  const [result] = await db.update(company).set({ enabledFeatures: features, updatedAt: new Date() }).where(eq(company.id, currentUser.companyId)).returning()
  if (!result) return c.json({ error: 'Company not found' }, 404)
  return c.json(sanitizeCompany(result))
})

export default app
