// The week's weather for a landscaping business (parity row 17; Yardbook's weather report beside the schedule, then "Reschedule
// Jobs"; row 30 reads its snowfall). The US National Weather Service's free forecast (api.weather.gov — no key, a User-Agent
// is all it asks): /points/{lat},{lng} names the forecast grid, /gridpoints/… gives the hourly figures, which are folded into
// one line per day on the business's clock: the chance of rain or snow, the rain and the snowfall in inches, and its words.
//
// Where: the business's jobs carry a map point when one was found for the address; the most recent one is used, else the
// business's own address through Google's geocoder (the server key). The US only — the Weather Service covers no other country.
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { company, job } from '../db/schema/index.ts'
import { googleGeocode } from '../crm/field/googleGeocode.ts'

const NWS = 'https://api.weather.gov'
const HEADERS = { 'User-Agent': 'Twomiah CRM (support@twomiah.com)', Accept: 'application/geo+json' }

export interface ForecastDay { date: string; summary: string; precipChance: number; rainInches: number; snowInches: number; wet: boolean }
type Fetch = typeof fetch

/** Where the business works: a recent job's map point, else its own address, geocoded. Null when neither is known. */
export async function businessPoint(db: any, companyId: string): Promise<{ lat: number; lng: number } | null> {
  const [j] = await db.select({ lat: job.lat, lng: job.lng }).from(job).where(and(eq(job.companyId, companyId), isNotNull(job.lat), isNotNull(job.lng))).orderBy(desc(job.createdAt)).limit(1)
  if (j?.lat != null && j?.lng != null) return { lat: Number(j.lat), lng: Number(j.lng) }
  const [co] = await db.select({ address: company.address, city: company.city, state: company.state, zip: company.zip }).from(company).where(eq(company.id, companyId)).limit(1)
  const where = [co?.address, co?.city, co?.state, co?.zip].filter(Boolean).join(', ')
  if (!where) return null
  const g = await googleGeocode(where).catch(() => null)
  return g ? { lat: g.lat, lng: g.lng } : null
}

/** ISO-8601 "start/duration" (PT1H, P1DT6H) → [start ms, end ms]. */
export function validSpan(validTime: string): [number, number] | null {
  const [start, dur] = String(validTime).split('/')
  const t = Date.parse(start)
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur || '')
  if (!Number.isFinite(t) || !m) return null
  const ms = ((+(m[1] || 0) * 24 + +(m[2] || 0)) * 60 + +(m[3] || 0)) * 60_000
  return [t, t + ms]
}

/** The calendar day an instant falls on, on the business's clock. */
const dayIn = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

/**
 * Fold the grid's hourly values into days: the highest chance of precipitation in the day, rain and snowfall summed (each value
 * spread over its hours, split across midnight where it straddles), in inches. A day is "wet" from a 60% chance or a tenth of an
 * inch of rain, or any measurable snow — the rain-out line landscapers use.
 */
export function foldDays(grid: any, tz: string, days: number, from: number = Date.now()): Omit<ForecastDay, 'summary'>[] {
  const out = new Map<string, { precipChance: number; rainMm: number; snowMm: number }>()
  const first = dayIn(from, tz)
  const spread = (values: any[], add: (day: string, share: number) => void) => {
    for (const v of values || []) {
      const span = validSpan(v.validTime); if (!span || v.value == null) continue
      const hours = Math.max(1, Math.round((span[1] - span[0]) / 3_600_000))
      for (let h = 0; h < hours; h++) { const d = dayIn(span[0] + h * 3_600_000 + 1, tz); if (d >= first) add(d, Number(v.value) / hours) }
    }
  }
  const at = (d: string) => { if (!out.has(d)) out.set(d, { precipChance: 0, rainMm: 0, snowMm: 0 }); return out.get(d)! }
  for (const v of grid?.properties?.probabilityOfPrecipitation?.values || []) {
    const span = validSpan(v.validTime); if (!span || v.value == null) continue
    for (let t = span[0]; t < span[1]; t += 3_600_000) { const d = dayIn(t + 1, tz); if (d >= first) at(d).precipChance = Math.max(at(d).precipChance, Number(v.value)) }
  }
  spread(grid?.properties?.quantitativePrecipitation?.values, (d, mm) => { at(d).rainMm += mm })
  spread(grid?.properties?.snowfallAmount?.values, (d, mm) => { at(d).snowMm += mm })
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, days).map(([date, v]) => {
    const rainInches = Math.round((v.rainMm / 25.4) * 100) / 100, snowInches = Math.round((v.snowMm / 25.4) * 10) / 10
    return { date, precipChance: Math.round(v.precipChance), rainInches, snowInches, wet: v.precipChance >= 60 || rainInches >= 0.1 || snowInches >= 0.1 }
  })
}

/** The Weather Service's words for each day (the daytime period's short forecast). */
async function dayWords(forecastUrl: string, tz: string, f: Fetch): Promise<Map<string, string>> {
  const res = await f(forecastUrl, { headers: HEADERS, signal: AbortSignal.timeout(10_000) }).catch(() => null)
  const words = new Map<string, string>()
  if (!res?.ok) return words
  for (const p of ((await res.json().catch(() => null)) as any)?.properties?.periods || []) {
    const d = dayIn(Date.parse(p.startTime) + 1, tz)
    if (p.isDaytime || !words.has(d)) words.set(d, String(p.shortForecast || ''))
  }
  return words
}

/** The next `days` days' weather at a point, or the reason there is none. */
export async function forecastAt(point: { lat: number; lng: number }, tz: string, days = 7, f: Fetch = fetch): Promise<{ days: ForecastDay[] } | { error: string }> {
  const at = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`
  const p = await f(`${NWS}/points/${at}`, { headers: HEADERS, signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!p?.ok) return { error: p?.status === 404 ? 'The US Weather Service has no forecast for this place (it covers the United States only).' : 'The weather forecast could not be reached. Try again in a few minutes.' }
  const props = ((await p.json().catch(() => null)) as any)?.properties
  if (!props?.forecastGridData) return { error: 'The weather forecast could not be read.' }
  const g = await f(props.forecastGridData, { headers: HEADERS, signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!g?.ok) return { error: 'The weather forecast could not be reached. Try again in a few minutes.' }
  const folded = foldDays(await g.json(), tz, days)
  const words = props.forecast ? await dayWords(props.forecast, tz, f) : new Map<string, string>()
  return { days: folded.map((d) => ({ ...d, summary: words.get(d.date) || (d.snowInches >= 0.1 ? 'Snow' : d.wet ? 'Rain likely' : 'Mostly dry') })) }
}
