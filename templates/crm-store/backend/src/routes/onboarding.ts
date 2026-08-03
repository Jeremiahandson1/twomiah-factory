// Store-native onboarding completion. The shared createOnboardingRoutes keys
// off user.companyId against a company table — crm-store has neither (single
// store_settings row, users carry no companyId), so this sets the flag on
// that one row directly. Idempotent.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.post('/complete', async (c) => {
  try {
    const [row] = await db.select().from(storeSettings).limit(1)
    if (!row) return c.json({ error: 'Store settings row missing' }, 500)
    const [updated] = await db.update(storeSettings)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(storeSettings.id, row.id))
      .returning()
    return c.json({ success: true, onboardingCompletedAt: updated.onboardingCompletedAt })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default app
