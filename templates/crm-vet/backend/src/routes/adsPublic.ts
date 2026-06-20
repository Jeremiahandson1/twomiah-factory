/**
 * Twomiah Ads — public visitor tracking endpoints.
 *
 * Called by JS on the tenant's public website to assign visitors to
 * variants and record conversions. Unauthenticated by design — the
 * data is anonymous visitor IDs + variant assignments. Mounted in
 * index.ts BEFORE the rate limiter that targets /api/*, but inside
 * a less-strict rate limit appropriate for high public traffic.
 */
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { adsExperiment, adsExperimentAssignment, adsExperimentConversion } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'

const app = new Hono()

// Pick a sticky variant for a visitor on a given path.
app.post('/assign', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { path?: string; visitorId?: string }
  const path = String(body.path || '')
  const visitorId = String(body.visitorId || '')
  if (!path || !visitorId) return c.json({ variant: null })

  const exps = await db.select().from(adsExperiment).where(eq(adsExperiment.status, 'running'))
  const match = exps.find(e => e.path === path)
  if (!match) return c.json({ variant: null })

  const existing = await db.select().from(adsExperimentAssignment).where(
    and(eq(adsExperimentAssignment.experimentId, match.id), eq(adsExperimentAssignment.visitorId, visitorId))
  ).limit(1)
  if (existing[0]) return c.json({ experimentId: match.id, variant: existing[0].variantKey })

  const variants = (match.variants as any[]) || []
  if (variants.length === 0) return c.json({ variant: null })
  const total = variants.reduce((s, v) => s + (v.trafficPercent || 0), 0) || 100
  let pick = Math.random() * total
  let chosen = variants[0]
  for (const v of variants) { pick -= (v.trafficPercent || 0); if (pick <= 0) { chosen = v; break } }

  try {
    await db.insert(adsExperimentAssignment).values({
      experimentId: match.id, variantKey: chosen.key, visitorId,
    })
  } catch { /* race — visitor just assigned, fine */ }
  return c.json({ experimentId: match.id, variant: chosen.key })
})

app.post('/convert', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { experimentId?: string; visitorId?: string; eventType?: string; targetId?: string }
  if (!body.experimentId || !body.visitorId) return c.json({ ok: false })
  const ass = await db.select().from(adsExperimentAssignment).where(
    and(eq(adsExperimentAssignment.experimentId, body.experimentId), eq(adsExperimentAssignment.visitorId, body.visitorId))
  ).limit(1)
  if (!ass[0]) return c.json({ ok: false })
  await db.insert(adsExperimentConversion).values({
    experimentId: body.experimentId,
    variantKey: ass[0].variantKey,
    visitorId: body.visitorId,
    eventType: body.eventType || 'lead',
    targetId: body.targetId || null,
  })
  return c.json({ ok: true })
})

export default app
