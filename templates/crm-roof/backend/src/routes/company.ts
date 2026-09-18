import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()

// Self-serve feature toggling. The owner turns optional modules on/off from
// Settings → Features; enabledFeatures drives the sidebar (see AppLayout) and the
// per-page useFeature() guards. All feature code ships regardless, so this only
// changes what's shown — nothing is ever unreachable.
app.put('/features', authenticate, requireAdmin, async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()
  if (!Array.isArray(body.features) || !body.features.every((f: unknown) => typeof f === 'string')) {
    return c.json({ error: 'features must be an array of strings' }, 400)
  }
  const [updated] = await db.update(company)
    .set({ enabledFeatures: body.features })
    .where(eq(company.id, currentUser.companyId))
    .returning()
  if (!updated) return c.json({ error: 'Company not found' }, 404)
  return c.json({ company: updated })
})

export default app
