import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Reading the company record is open to anyone signed in — `company:read` is in the field role on
// every template. WRITING it is admin/owner, which is what `company:update` is in the shared matrix
// and what roof's own PUT /api/company/features already uses.
//
// This router had `authenticate` and nothing else, so any signed-in user — a field tech included —
// could rewrite the company name, phone, email and address, and the branding. Proven live on
// rooftest: role=user got `200 Saved`. Roof is the only template with a settings router; the other
// eight put this behind PUT /api/company, which refuses staff with 403. (T27, found by the fleet
// permission probe)

// Get company settings
app.get('/company', async (c) => {
  const currentUser = c.get('user') as any
  const [comp] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  return c.json(comp)
})

// Update company info
app.put('/company', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  const body = await c.req.json()

  // L1: zod strips unknown keys, so sending enabledFeatures here returned 200 having changed nothing.
  // A caller who believes they just saved their feature list is worse off than one who got an error,
  // so say where that actually lives. Features are admin-only (company.ts PUT /features) — quietly
  // accepting them on a non-admin route would also have been a privilege hole.
  if (body && typeof body === 'object' && 'enabledFeatures' in body) {
    return c.json({ error: 'Features are not changed here. Use PUT /api/company/features (admins only).' }, 400)
  }

  const data = schema.parse(body)
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
})

// Update branding
app.put('/branding', requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({
    primaryColor: z.string().optional(),
  })
  const data = schema.parse(await c.req.json())
  await db.update(company).set({ ...data, updatedAt: new Date() })
    .where(eq(company.id, currentUser.companyId))
  return c.json({ message: 'Saved' })
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
