// /api/lead-map — the enquiries on a map (parity tier 2 #8, Buildertrend's and ServiceTitan's lead map; feature lead_map, not ready).
//
//   GET /   leads:read   the pins: each enquiry this seat reads (the inbox's own rule, ./scope.ts) that has a place on the map
//
// An enquiry's place is its typed `location`, looked up with Google's geocoder (field/googleGeocode.ts — the same key and service
// jobs and projects use) ONCE: lead.geocoded_at is set whether it was found or not, so nothing is ever looked up twice. Looking up
// happens here, when someone opens the map — up to LOOKUPS_PER_OPEN at a time, the newest first — so a business that never turns
// the map on never pays for a lookup. With no Maps key nothing is looked up and nothing is marked, so adding the key later works.
import { Hono } from 'hono'
import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { lead } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { googleGeocode, googleKey } from '../field/googleGeocode.ts'
import { ownLeadsWhere } from './scope.ts'

export const LOOKUPS_PER_OPEN = 25
/** Open enquiries by default; `all` adds converted and lost (never the dismissed spam). */
const OPEN = ['new', 'contacted']
const SHOWN = ['new', 'contacted', 'converted', 'lost']

export interface LeadPin { id: string; name: string; status: string; jobType: string | null; location: string | null; receivedAt: string; lat: number; lng: number }

export function createLeadMapRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /** Look up the newest enquiries not yet placed (the business's, not only this seat's: a place is the enquiry's, whoever reads it). */
  async function placeSome(companyId: string): Promise<number> {
    if (!googleKey()) return 0
    const todo = await db.select({ id: lead.id, location: lead.location }).from(lead)
      .where(and(eq(lead.companyId, companyId), isNull(lead.geocodedAt), isNotNull(lead.location), ne(lead.status, 'dismissed')))
      .orderBy(desc(lead.receivedAt), desc(lead.id)).limit(LOOKUPS_PER_OPEN)
    for (const l of todo as any[]) {
      const where = String(l.location || '').trim()
      const found = where.length >= 3 ? await googleGeocode(where, (m) => logger.warn?.('[lead-map] lookup failed', { error: m })) : null
      await db.update(lead).set({ lat: found?.lat ?? null, lng: found?.lng ?? null, geocodedAt: new Date() } as any).where(eq(lead.id, l.id))
    }
    return todo.length
  }

  app.get('/', requirePermission('leads:read'), async (c) => {
    const me = c.get('user')
    const companyId = me.companyId
    await placeSome(companyId)
    const mine = await ownLeadsWhere(d, me)
    const statuses = c.req.query('show') === 'all' ? SHOWN : OPEN
    const rows = await db.select({
      id: lead.id, name: lead.homeownerName, status: lead.status, jobType: lead.jobType, location: lead.location, receivedAt: lead.receivedAt,
      lat: lead.lat, lng: lead.lng, geocodedAt: lead.geocodedAt,
    }).from(lead).where(and(eq(lead.companyId, companyId), inArray(lead.status, statuses), mine ?? undefined)).orderBy(desc(lead.receivedAt), desc(lead.id))
    const pins: LeadPin[] = []
    let notFound = 0, noPlace = 0, waiting = 0
    for (const r of rows as any[]) {
      if (r.lat != null && r.lng != null) pins.push({ id: r.id, name: r.name, status: r.status, jobType: r.jobType, location: r.location, receivedAt: new Date(r.receivedAt).toISOString(), lat: Number(r.lat), lng: Number(r.lng) })
      else if (!String(r.location || '').trim()) noPlace++
      else if (r.geocodedAt) notFound++
      else waiting++
    }
    // notFound: looked up, no match; noPlace: no location typed; waiting: not looked up yet (the next open places more, or no Maps key).
    return one(c, { pins, notFound, noPlace, waiting, lookups: !!googleKey() })
  })

  return app
}
