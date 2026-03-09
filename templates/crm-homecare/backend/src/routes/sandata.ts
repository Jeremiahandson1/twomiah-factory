import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { evvVisits, agencies } from '../../db/schema.ts'
import { sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// GET /api/sandata/config
app.get('/config', async (c) => {
  const [agency] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
  const settings = (agency?.settings as any) || {}
  return c.json({
    sandataAgencyId: settings.sandataAgencyId || null,
    sandataUsername: settings.sandataUsername ? '****' : null,
    configured: !!(settings.sandataAgencyId && settings.sandataUsername),
  })
})

// GET /api/sandata/status
app.get('/status', async (c) => {
  const rows = await db
    .select({
      status: evvVisits.sandataStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(evvVisits)
    .groupBy(evvVisits.sandataStatus)

  const summary: Record<string, number> = {}
  for (const r of rows) {
    summary[r.status] = r.count
  }

  return c.json({
    summary,
    total: Object.values(summary).reduce((a, b) => a + b, 0),
  })
})

// POST /api/sandata/submit
app.post('/submit', async (c) => {
  const [agency] = await db.select({ settings: agencies.settings }).from(agencies).limit(1)
  const settings = (agency?.settings as any) || {}
  if (!settings.sandataAgencyId || !settings.sandataUsername) {
    return c.json({ success: false, message: 'Sandata integration is not configured. Set credentials in agency settings.' }, 400)
  }
  return c.json({ success: false, message: 'Sandata API submission not yet implemented. Configure API credentials and enable the integration.' })
})

export default app
