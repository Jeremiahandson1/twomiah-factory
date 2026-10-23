// Storm Radar at /api/storm-radar (storm_radar_overlay): the provider's status, cached events, a sync, matching an event
// to contacts, and the matches' follow-up. Moved from templates/crm-roof/backend/src/routes/stormRadar.ts. The registry
// signs the person in and applies the gate.
//
// Changes from the template:
//   · lists are { data, pagination }: /events and /matches (were { data } alone);
//   · a failed sync is the rulebook's error: { error: <the sentence>, code: 'not_configured' | 'sync_failed' } — the
//     template put the code in `error` and the sentence in `message`. The detail still goes only to the log (M10);
//   · a match's status, when sent, is one of the follow-up's stages (new → contacted → quoted → booked /
//     not_interested): an unknown one was written as given, and null 500'd on the NOT NULL column;
//   · matching an event twice no longer lists every contact twice (stormRadarService.ts).
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { contact, stormRadarEvent, stormRadarEventMatch } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createStormRadar, StormRadarNotConfiguredError, type StormRadar } from './stormRadarService.ts'

export const MATCH_STATUSES = ['new', 'contacted', 'quoted', 'booked', 'not_interested'] as const

export function createStormRadarRoutes(d: CrmDeps, radar: StormRadar = createStormRadar(d)) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // Provider configuration status
  app.get('/status', (c) => {
    const configured = radar.isConfigured()
    return one(c, {
      provider: radar.currentProvider(),
      configured,
      message: configured
        ? `Storm Radar is active using ${radar.currentProvider()}`
        : `Storm Radar isn't enabled on this account yet. Contact support to turn on live storm tracking.`,
    })
  })

  // GET /events — the cached events, newest first.
  app.get('/events', async (c) => {
    const { companyId } = c.get('user')
    const state = c.req.query('state')
    const eventType = c.req.query('eventType')
    const limit = Math.max(parseInt(c.req.query('limit') || '100') || 100, 1)
    const conditions: any[] = [eq(stormRadarEvent.companyId, companyId)]
    if (state) conditions.push(eq(stormRadarEvent.state, state))
    if (eventType) conditions.push(eq(stormRadarEvent.eventType, eventType))
    const events = await db.select().from(stormRadarEvent).where(and(...conditions)).orderBy(desc(stormRadarEvent.startedAt), desc(stormRadarEvent.id)).limit(limit)
    return list(c, events, { page: 1, limit, total: events.length })
  })

  // POST /sync — fresh events from the configured provider.
  app.post('/sync', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const b = (await c.req.json().catch(() => null)) ?? {}
    try {
      const result = await radar.syncStormEvents(companyId, b)
      return one(c, { success: true, ...result })
    } catch (e: any) {
      // M10: the message names the source file and the environment variables — the log's, never the caller's.
      logger.error('Storm Radar sync failed', { message: e?.message, stack: e?.stack, companyId })
      if (e instanceof StormRadarNotConfiguredError) return fail(c, 503, 'Storm Radar is not connected yet. Add it in Settings › Integrations.', 'not_configured')
      return fail(c, 500, 'Could not sync storm events. Please try again shortly.', 'sync_failed')
    }
  })

  // POST /events/:id/match — the event's contacts become its matches.
  app.post('/events/:id/match', requirePermission('storms:create'), async (c) => {
    const result = await radar.matchEventsToContacts(c.get('user').companyId, c.req.param('id'))
    return one(c, { success: true, ...result })
  })

  // GET /matches — the leads storm events made.
  app.get('/matches', async (c) => {
    const { companyId } = c.get('user')
    const status = c.req.query('status')
    const conditions: any[] = [eq(stormRadarEventMatch.companyId, companyId)]
    if (status) conditions.push(eq(stormRadarEventMatch.status, status))
    // With the contact's name, so a match reads as who it is (it carried the id alone).
    const rows = await db.select({ match: stormRadarEventMatch, contactName: contact.name }).from(stormRadarEventMatch)
      .leftJoin(contact, and(eq(contact.id, stormRadarEventMatch.contactId), eq(contact.companyId, companyId)))
      .where(and(...conditions)).orderBy(desc(stormRadarEventMatch.createdAt), desc(stormRadarEventMatch.id))
    const matches = rows.map((r: any) => ({ ...r.match, contactName: r.contactName ?? null }))
    return listAll(c, matches)
  })

  // POST /matches/:id/status — the follow-up (new → contacted → quoted → booked / not_interested), the caller's company only.
  app.post('/matches/:id/status', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const { status, notes } = ((await c.req.json().catch(() => null)) ?? {}) as any
    if (status !== undefined && !(MATCH_STATUSES as readonly string[]).includes(status)) return fail(c, 400, `status must be one of: ${MATCH_STATUSES.join(', ')}`, 'validation_failed', { status: 'Invalid status' })
    const updateData: any = { updatedAt: new Date() }
    if (status !== undefined) updateData.status = status
    if (status === 'contacted') updateData.contactedAt = new Date()
    if (notes !== undefined) updateData.notes = notes
    const [updated] = await db.update(stormRadarEventMatch).set(updateData)
      .where(and(eq(stormRadarEventMatch.id, c.req.param('id')), eq(stormRadarEventMatch.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Storm match not found')
    return one(c, updated)
  })

  return app
}
