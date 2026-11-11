// SERVICE ZONES (parity tier 3, field service — ServiceTitan's zones; feature service_zones, not ready). The business names the
// areas it works in by their ZIP codes (company settings serviceZones: [{ id, name, zips, color }]); a job is in the zone its ZIP
// is in. The Dispatch Board shows each job's zone and can show one zone at a time (web DispatchBoard.tsx).
//
//   GET /api/service-zones     jobs:read          the zones
//   PUT /api/service-zones     company:update     { zones: [{ id?, name, zips, color? }] } — replaces them; a ZIP in two zones is refused
import { Hono } from 'hono'
import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

/** techIds: the people whose home zone it is (person keys: a login's id or a roster member's); dailyLimit: at most this many jobs a day. */
export interface ServiceZone { id: string; name: string; zips: string[]; color: string; techIds: string[]; dailyLimit: number | null }
export const ZONE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#4b5563']
/** A ZIP as written on a job ("53703-1234" → "53703"), so a ZIP+4 is in its five-digit zone. */
export const zipKey = (zip: unknown) => String(zip ?? '').trim().toUpperCase().replace(/^(\d{5})-\d{4}$/, '$1')

const settingsOf = (raw: unknown): any => (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) || {}
export function zonesOf(settings: unknown): ServiceZone[] {
  const list = settingsOf(settings).serviceZones
  return Array.isArray(list) ? list.filter((z: any) => z && z.id && z.name).map((z: any, i: number) => ({ id: String(z.id), name: String(z.name), zips: Array.isArray(z.zips) ? z.zips.map(zipKey).filter(Boolean) : [], color: String(z.color || ZONE_COLORS[i % ZONE_COLORS.length]), techIds: Array.isArray(z.techIds) ? z.techIds.map(String) : [], dailyLimit: Number.isInteger(z.dailyLimit) && z.dailyLimit > 0 ? z.dailyLimit : null })) : []
}
/** The zone a ZIP is in, or null. */
export const zoneOfZip = (zones: ServiceZone[], zip: unknown): ServiceZone | null => { const k = zipKey(zip); return k ? zones.find((z) => z.zips.includes(k)) ?? null : null }

const body = z.object({
  zones: z.array(z.object({
    id: z.string().max(40).optional(),
    name: z.string({ error: 'Name the zone' }).trim().min(1, 'Name the zone').max(60, 'At most 60 characters'),
    zips: z.array(z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/, 'A ZIP like 53703')).min(1, 'Give the zone at least one ZIP').max(500, 'At most 500 ZIPs a zone'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    techIds: z.array(z.string().min(1).max(40)).max(200).optional(),
    dailyLimit: z.number().int('A whole number of jobs').min(1, 'At least 1 job a day').max(500).nullable().optional(),
  })).max(50, 'At most 50 zones'),
})

export function createServiceZoneRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, { zones: zonesOf(co?.settings) })
  })

  app.put('/', requirePermission('company:update'), async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const seen = new Map<string, string>()
    for (const zn of parsed.data.zones) for (const zip of zn.zips.map(zipKey)) {
      const other = seen.get(zip)
      if (other && other !== zn.name) return fail(c, 400, `ZIP ${zip} is in both ${other} and ${zn.name}. A ZIP belongs to one zone.`)
      seen.set(zip, zn.name)
    }
    const zones: ServiceZone[] = parsed.data.zones.map((zn, i) => ({ id: zn.id || createId(), name: zn.name, zips: [...new Set(zn.zips.map(zipKey))], color: zn.color || ZONE_COLORS[i % ZONE_COLORS.length], techIds: [...new Set(zn.techIds || [])], dailyLimit: zn.dailyLimit ?? null }))
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...settingsOf(co?.settings), serviceZones: zones }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { serviceZones: zones.map((z) => ({ name: z.name, zips: z.zips.length })) }, req: c })
    return one(c, { zones })
  })

  return app
}
