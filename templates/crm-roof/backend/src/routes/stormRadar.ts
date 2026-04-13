/**
 * Storm Radar routes — Storm tier feature
 *
 * Exposes the stormRadar service. Once a weather provider is configured
 * (see services/stormRadar.ts header), the /sync endpoint pulls fresh
 * events and the /match endpoint joins them to affected contacts.
 */
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { stormEvent, stormEventMatch, contact } from '../../db/schema.ts'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import stormRadar, { StormRadarNotConfiguredError } from '../services/stormRadar.ts'

const app = new Hono()
app.use('*', authenticate)

// Provider configuration status
app.get('/status', (c) => {
  return c.json({
    provider: stormRadar.currentProvider(),
    configured: stormRadar.isConfigured(),
    message: stormRadar.isConfigured()
      ? `Storm Radar is active using ${stormRadar.currentProvider()}`
      : `Storm Radar provider "${stormRadar.currentProvider()}" is not configured. See services/stormRadar.ts for setup instructions.`,
  })
})

// List all cached storm events
app.get('/events', async (c) => {
  const currentUser = c.get('user') as any
  const state = c.req.query('state')
  const eventType = c.req.query('eventType')
  const limit = Number(c.req.query('limit') || '100')

  const conditions = [eq(stormEvent.companyId, currentUser.companyId)]
  if (state) conditions.push(eq(stormEvent.state, state))
  if (eventType) conditions.push(eq(stormEvent.eventType, eventType))

  const events = await db.select().from(stormEvent).where(and(...conditions)).orderBy(desc(stormEvent.startedAt)).limit(limit)
  return c.json({ data: events })
})

// Trigger a sync from the configured provider
app.post('/sync', async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await stormRadar.syncStormEvents(currentUser.companyId, body)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    if (e instanceof StormRadarNotConfiguredError) {
      return c.json({ error: 'not_configured', message: e.message }, 503)
    }
    return c.json({ error: 'sync_failed', message: e.message }, 500)
  }
})

// After a sync, run match-to-contacts for a specific event
app.post('/events/:id/match', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const result = await stormRadar.matchEventsToContacts(currentUser.companyId, id)
  return c.json({ success: true, ...result })
})

// List matches (leads generated from storm events)
app.get('/matches', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const conditions = [eq(stormEventMatch.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(stormEventMatch.status, status))
  const matches = await db.select().from(stormEventMatch).where(and(...conditions)).orderBy(desc(stormEventMatch.createdAt))
  return c.json({ data: matches })
})

// Update match status (new → contacted → quoted → booked / not_interested)
app.post('/matches/:id/status', async (c) => {
  const id = c.req.param('id')
  const { status, notes } = await c.req.json()
  const updateData: any = { status, updatedAt: new Date() }
  if (status === 'contacted') updateData.contactedAt = new Date()
  if (notes !== undefined) updateData.notes = notes
  const [updated] = await db.update(stormEventMatch).set(updateData).where(eq(stormEventMatch.id, id)).returning()
  return c.json(updated)
})

export default app
