// A service zone's daily job limit and its home techs (parity tier 3, service_zones — ServiceTitan's zone capacity and technician
// zones): how many jobs the zone already has on a day, by the jobs' ZIPs, so booking one more past the limit is a "check before you
// book" warning (modules/crm.ts availability); and, for Find a time, the zone's techs and the days it is already full.
import { and, eq, gte, lt, ne, notInArray } from 'drizzle-orm'
import { company, job } from '../db/schema/index.ts'
import { zoneOfZip, zipKey, zonesOf } from '../crm/field/serviceZones.ts'
import type { Unavailable } from './techAvailability.ts'
import type { ServiceZone } from '../crm/field/serviceZones.ts'

const DAY = 86_400_000
const dayWords = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export async function zoneLimitCheck(exec: any, companyId: string, zip: unknown, scheduledDate: unknown, excludeJobId?: string | null): Promise<Unavailable | null> {
  if (!zipKey(zip) || !scheduledDate) return null
  const day = new Date(scheduledDate as any)
  if (isNaN(day.getTime())) return null
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const zones = zonesOf(co?.settings)
  const zone = zoneOfZip(zones, zip)
  if (!zone || !zone.dailyLimit) return null
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()))
  const booked = (await bookedByDay(exec, companyId, zones, zone, start, start, excludeJobId)).get(start.toISOString().slice(0, 10)) ?? 0
  if (booked < zone.dailyLimit) return null
  const short = `${zone.name} is full on ${dayWords(start)}: ${booked} of ${zone.dailyLimit} jobs already booked there.`
  return { code: 'unavailable', message: `${short} Book anyway, or pick another day.`, short, personId: '', reason: 'zone_full' }
}

/** The zone's jobs (not cancelled) on each day from `first` to `last` (day markers), by their ZIPs: YYYY-MM-DD → count. */
async function bookedByDay(exec: any, companyId: string, zones: ServiceZone[], zone: ServiceZone, first: Date, last: Date, excludeJobId?: string | null): Promise<Map<string, number>> {
  const rows = await exec.select({ zip: job.zip, on: job.scheduledDate }).from(job).where(and(eq(job.companyId, companyId), gte(job.scheduledDate, first), lt(job.scheduledDate, new Date(last.getTime() + DAY)),
    notInArray(job.status, ['cancelled']), excludeJobId ? ne(job.id, excludeJobId) : undefined))
  const out = new Map<string, number>()
  for (const r of rows as any[]) if (r.on && zoneOfZip(zones, r.zip)?.id === zone.id) { const k = new Date(r.on).toISOString().slice(0, 10); out.set(k, (out.get(k) ?? 0) + 1) }
  return out
}

/**
 * For Find a time: the zone a ZIP is in, its home techs (the people offered when the office has not picked one), and the days
 * from `from` (YYYY-MM-DD) for `days` on which it is already at its daily limit (no slot offered then). Null when not in a zone.
 */
export async function zoneForFind(exec: any, companyId: string, zip: unknown, from: string, days: number): Promise<{ id: string; name: string; techIds: string[]; full: string[] } | null> {
  if (!zipKey(zip)) return null
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const zones = zonesOf(co?.settings)
  const zone = zoneOfZip(zones, zip)
  if (!zone) return null
  let full: string[] = []
  if (zone.dailyLimit) {
    const first = new Date(`${from}T00:00:00Z`)
    const counts = await bookedByDay(exec, companyId, zones, zone, first, new Date(first.getTime() + (days - 1) * DAY))
    full = [...counts].filter(([, n]) => n >= (zone.dailyLimit as number)).map(([k]) => k).sort()
  }
  return { id: zone.id, name: zone.name, techIds: zone.techIds, full }
}
