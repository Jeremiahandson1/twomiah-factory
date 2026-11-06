// Snow from the forecast, and the storm-wide message (landscaping parity rows 25 and 30; snow_tools, not ready). Raw reads here
// (RULEBOOK §2); the routes are crm/landscaping/snowStorm.ts.
//
//   · the next three days' snowfall (the US Weather Service, data/weatherForecast.ts) against the active contracts' trigger depths:
//     a day whose snow reaches a contract's trigger proposes a storm for those contracts, started with one tap ("nobody documents
//     one" — row 30);
//   · it starts ON ITS OWN only where the owner turned that on (landscaping_setting.snow_auto_start, default off), once a day, when
//     today's snowfall reaches a trigger and no storm is going;
//   · the storm-wide message (row 25; Service Autopilot "weather prevents service"): one text per customer on the storm, through the
//     scheduled texts (their opt-out, the 8:00–20:00 hours, the business number), as Rain Day's.
import { and, eq, inArray } from 'drizzle-orm'
import { company, contact, landscapingSetting, scheduledText, site, snowContract, snowStorm, snowStormStop } from '../db/schema/index.ts'
import { businessPoint, forecastAt, type ForecastDay } from './weatherForecast.ts'
import { textTime } from './routeRainDay.ts'
import { startStorm, dispatchStorm } from './snowStorm.ts'

type Forecaster = (point: { lat: number; lng: number }, tz: string, days: number) => Promise<{ days: ForecastDay[] } | { error: string }>

export async function getSnowSettings(db: any, companyId: string): Promise<{ autoStart: boolean }> {
  const [row] = await db.select({ a: landscapingSetting.snowAutoStart }).from(landscapingSetting).where(eq(landscapingSetting.companyId, companyId)).limit(1)
  return { autoStart: !!row?.a }
}
export async function setSnowAutoStart(db: any, companyId: string, on: boolean) {
  await db.insert(landscapingSetting).values({ companyId, snowAutoStart: on }).onConflictDoUpdate({ target: landscapingSetting.companyId, set: { snowAutoStart: on, updatedAt: new Date() } })
  return { autoStart: on }
}

/** The next days' snowfall, each with the active contracts its snow reaches (trigger ≤ snowfall). */
export async function snowProposals(db: any, companyId: string, tz: string, f: Forecaster = forecastAt as any, days = 3) {
  const point = await businessPoint(db, companyId)
  if (!point) return { error: 'Add the business address in Settings (or an address on a job) to see the snow forecast.', code: 'NO_LOCATION' as const }
  const fc = await f(point, tz, days)
  if ('error' in fc) return { error: fc.error, code: 'FORECAST_UNAVAILABLE' as const }
  const contracts: any[] = await db.select({ id: snowContract.id, trigger: snowContract.triggerDepthInches, siteName: site.name }).from(snowContract)
    .innerJoin(site, eq(snowContract.siteId, site.id)).where(and(eq(snowContract.companyId, companyId), eq(snowContract.status, 'active')))
  return {
    days: fc.days.map((d) => {
      const hit = d.snowInches > 0 ? contracts.filter((c) => (Number(c.trigger) || 0) <= d.snowInches) : []
      return { date: d.date, summary: d.summary, snowInches: d.snowInches, precipChance: d.precipChance, contractIds: hit.map((c) => c.id), contracts: hit.length }
    }),
  }
}

/**
 * Row 30, on its own: where the owner turned it on, today's snowfall reaching a trigger starts a storm for those contracts (named
 * for the day, marked as from the forecast) and dispatches them for today — never twice (a storm going, or one already started
 * from the forecast today, stops it). Returns the storm made, or why not.
 */
export async function autoStartFromForecast(db: any, companyId: string, tz: string, today: string, f: Forecaster = forecastAt as any) {
  if (!(await getSnowSettings(db, companyId)).autoStart) return { started: null, why: 'off' }
  const going: any[] = await db.select({ id: snowStorm.id, source: snowStorm.source, startedAt: snowStorm.startedAt }).from(snowStorm).where(and(eq(snowStorm.companyId, companyId), eq(snowStorm.status, 'active')))
  if (going.length) return { started: null, why: 'a storm is going' }
  const p = await snowProposals(db, companyId, tz, f, 1)
  if ('error' in p) return { started: null, why: p.error }
  const day = p.days.find((d) => d.date === today)
  if (!day || !day.contracts) return { started: null, why: 'no snow reaching a trigger today' }
  const storm = await startStorm(db, companyId, null, { name: `Snow ${today} (from the forecast)`, notes: `Started on its own: ${day.snowInches} in forecast.`, source: 'forecast', expectedInches: day.snowInches })
  const r = await dispatchStorm(db, companyId, null, storm, { contractIds: day.contractIds }, { date: today, expectedInches: day.snowInches })
  return { started: storm, made: r.made.length, why: 'started' }
}

export const DEFAULT_STORM_TEXT = "Hi {firstName}, this is {company}. Snow is on the way and our crews are out — {site} is on today's route. We'll let you know if anything changes."
const fill = (template: string, v: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))

/** The storm-wide message (row 25): one text per customer on the storm, queued as scheduled texts. Opted out or no phone: listed. */
export async function stormTexts(db: any, companyId: string, userId: string | null, stormId: string, template: string | null, tz: string, now = new Date(), queue = false) {
  const stops: any[] = await db.select({ contactId: snowContract.contactId, siteContact: site.contactId, siteName: site.name }).from(snowStormStop)
    .innerJoin(snowContract, eq(snowStormStop.snowContractId, snowContract.id)).innerJoin(site, eq(snowStormStop.siteId, site.id))
    .where(and(eq(snowStormStop.stormId, stormId), eq(snowStormStop.companyId, companyId)))
  const by = new Map<string, string[]>()
  for (const s of stops) { const id = s.contactId ?? s.siteContact; if (id) by.set(id, [...(by.get(id) ?? []), s.siteName || 'your property']) }
  const texts: Array<{ contactId: string; name: string; toPhone: string; body: string; sendAt: Date }> = []
  const skipped: Array<{ name: string; reason: 'no_phone' | 'opted_out' }> = []
  if (!by.size) return { texts, skipped, queued: 0 }
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const people: any[] = await db.select({ id: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile, optedOutSms: contact.optedOutSms }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, [...by.keys()])))
  const sendAt = textTime(now, tz)
  for (const p of people) {
    if (p.optedOutSms) { skipped.push({ name: p.name, reason: 'opted_out' }); continue }
    const phone = p.mobile || p.phone
    if (!phone) { skipped.push({ name: p.name, reason: 'no_phone' }); continue }
    const sites = [...new Set(by.get(p.id)!)]
    texts.push({ contactId: p.id, name: p.name, toPhone: phone, sendAt, body: fill(template?.trim() || DEFAULT_STORM_TEXT, { firstName: String(p.name || '').trim().split(/\s+/)[0] || 'there', company: co?.name || 'your snow crew', site: sites.length === 1 ? sites[0] : `${sites.slice(0, -1).join(', ')} and ${sites[sites.length - 1]}` }) })
  }
  let queued = 0
  if (queue && texts.length) { await db.insert(scheduledText).values(texts.map((t) => ({ companyId, contactId: t.contactId, toPhone: t.toPhone, body: t.body, sendAt: t.sendAt, createdById: userId }))); queued = texts.length }
  return { texts, skipped, queued }
}
