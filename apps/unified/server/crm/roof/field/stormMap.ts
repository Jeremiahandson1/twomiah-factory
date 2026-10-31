// The storm map at /api/storm-map (storm_customer_map — not ready): which PAST CUSTOMERS a storm hit, by where they are,
// and the owner's "check NOAA now". The AccuLynx hail-map idea over our own customers (docs/parity/roof-storms-canvass.md).
//
//   · GET  /events/:id/customers  storms:read    past customers inside the storm's drawn path (or its zips), each marked
//                                                  placed by their pin or by zip only, with the counts and what is missing;
//   · PUT  /events/:id/path       storms:update  draw (or clear) the storm's path: a polygon or a circle;
//   · POST /noaa-check            storms:update  "check NOAA now" — the owner, an admin or a manager (owner, 2026-10-30) fetches
//                                                  the feed once, for this company, on this request. (The daily check is a
//                                                  separate timer in stormData.ts, behind this same hidden switch.)
//
// The leads themselves are made by the storm board's own POST /api/storms/events/:id/generate-leads, which now reads the
// event's path (stormData.ts): this module only draws the path and shows who is in it.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { stormEvent } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { allPagination, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { customersInArea } from './customerGeo.ts'
import { parsePath, pathOf, zipSet } from './geo.ts'
import { createStormData, type StormData } from './stormData.ts'

const SHOWN = 500

const eventView = (e: any) => ({
  id: e.id, eventDate: e.eventDate, eventType: e.eventType, hailSizeInches: e.hailSizeInches, windSpeedMph: e.windSpeedMph,
  description: e.description, affectedZipCodes: e.affectedZipCodes, status: e.status, source: e.source, path: pathOf(e.path),
})

export function createStormMapRoutes(d: CrmDeps, storms: StormData = createStormData(d)) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const eventOf = async (companyId: string, id: string) =>
    (await db.select().from(stormEvent).where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId))).limit(1))[0] || null

  app.get('/events/:id/customers', requirePermission('storms:read'), async (c) => {
    const { companyId } = c.get('user')
    const event = await eventOf(companyId, c.req.param('id'))
    if (!event) return fail(c, 404, 'Event not found')
    const scope = c.req.query('scope') === 'all' ? 'all' : 'past'
    const path = pathOf(event.path)
    const found = await customersInArea(db, companyId, { path, zips: zipSet(event.affectedZipCodes) }, { scope })
    const inPath = found.customers.filter((x) => x.by === 'path').length
    const byZip = found.customers.length - inPath
    const rows = found.customers.slice(0, SHOWN)
    return one(c, {
      event: eventView(event),
      data: rows,
      pagination: { ...allPagination(c, rows.length), total: found.customers.length, pages: 1 },
      summary: {
        scope,
        matching: path ? 'path' : 'zip',
        matched: found.customers.length, inPath, byZipOnly: byZip,
        customersLooked: found.considered, onTheMap: found.located, notOnTheMap: found.unlocated,
        truncated: found.customers.length > rows.length,
        // Said plainly: without a pin a customer can only be placed by zip. A geocoding service turns addresses into pins.
        note: !path
          ? 'No area is drawn for this storm, so customers are matched by zip. Draw the storm’s path to match by where they are.'
          : found.unlocated > 0
            ? `${found.unlocated} customer${found.unlocated === 1 ? ' has' : 's have'} no pin on the map, so ${found.unlocated === 1 ? 'it matches' : 'they match'} by zip only. Pins come from a job’s address once it is looked up, or from a door knocked with the phone.`
            : 'Every customer has a pin; all were placed by where they are.',
      },
    })
  })

  app.put('/events/:id/path', requirePermission('storms:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = ((await c.req.json().catch(() => null)) ?? {}) as any
    if (!('path' in b)) return fail(c, 400, 'Send { path } — the shape, or null to clear it.')
    let path: unknown = null
    if (b.path !== null) {
      const parsed = parsePath(b.path)
      if ('error' in parsed) return fail(c, 400, parsed.error, 'validation_failed', { path: parsed.error })
      path = parsed.path
    }
    const [updated] = await db.update(stormEvent).set({ path } as any)
      .where(and(eq(stormEvent.id, c.req.param('id')), eq(stormEvent.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Event not found')
    return one(c, eventView(updated))
  })

  app.post('/noaa-check', requirePermission('storms:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = ((await c.req.json().catch(() => null)) ?? {}) as any
    const days = b.days === undefined ? 2 : Number(b.days)
    if (!Number.isInteger(days) || days < 1 || days > 14) return fail(c, 400, 'days is a whole number from 1 to 14.', 'validation_failed', { days: 'Pick 1 to 14 days.' })
    const r = await storms.runStormCheck(companyId, days)
    if (r.skipped === 'no_service_area') return fail(c, 400, 'Set your service area zips first — the check looks for storms there.', 'no_service_area')
    if (!r.reached) return fail(c, 502, 'The government storm feed did not answer. Nothing was added; try again later.', 'feed_unreachable')
    return one(c, {
      fetched: r.events.length, events: r.events.map(eventView), days,
      message: r.events.length
        ? `${r.events.length} storm${r.events.length === 1 ? '' : 's'} added to the storm board, each for your whole service area. Draw each storm’s path to narrow it to where it fell.`
        : 'The feed answered and had no hail, wind or tornado reports for those days.',
    })
  })

  return app
}
