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
  // Guard the body — null/malformed threw on the destructure and became a 500.
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const { features } = body as { features?: unknown }
  if (!Array.isArray(features) || features.some((f) => typeof f !== 'string')) {
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

export default app
