/**
 * Storm Radar Service — Storm tier feature
 *
 * Pluggable weather event provider abstraction. Currently supports three
 * providers; only stubs are implemented. To enable a provider, set the
 * relevant env vars and flip PROVIDER below.
 *
 * ──────────────────────────────────────────────────────────────────────
 * TO GO LIVE:
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1) Choose a provider:
 *    - NOAA Storm Events Database — FREE. Historical only (~1 week delay).
 *      Good for "storms that hit this area last week" reporting.
 *      https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
 *    - Tomorrow.io — paid (~$0.001/call). Real-time + forecasts + radar.
 *      Best for active storm tracking. https://docs.tomorrow.io/
 *    - AccuWeather Enterprise — paid. Real-time severe weather alerts.
 *      https://developer.accuweather.com/
 *
 * 2) Add env vars to your .env:
 *    STORM_RADAR_PROVIDER=tomorrow_io
 *    TOMORROW_IO_API_KEY=<your key>
 *    # or NOAA_API_BASE=https://www.ncei.noaa.gov/access/services/data/v1
 *    # or ACCUWEATHER_API_KEY=<your key>
 *
 * 3) Fill in the `fetchEvents*` methods below — each returns a normalized
 *    StormEvent[] that maps to the storm_event table.
 *
 * 4) Schedule `syncStormEvents(companyId)` to run daily/hourly via cron
 *    or a scheduled worker.
 *
 * 5) After events land, call `matchEventsToContacts(companyId, eventId)`
 *    to populate storm_event_match rows for affected customers.
 *
 * Until the provider is configured, /api/storm-radar/sync returns a
 * "not configured" error and the UI shows an empty state with a link
 * to this file's instructions.
 */

import { db } from '../../db/index.ts'
import { stormRadarEvent, stormRadarEventMatch, contact } from '../../db/schema.ts'
import { and, eq, sql } from 'drizzle-orm'

type Provider = 'noaa' | 'tomorrow_io' | 'accuweather'

const PROVIDER: Provider = (process.env.STORM_RADAR_PROVIDER as Provider) || 'noaa'

// Normalized shape that all providers map to before hitting the DB.
export interface NormalizedStormEvent {
  providerEventId: string
  eventType: 'hail' | 'wind' | 'tornado' | 'severe_thunderstorm' | 'other'
  severity?: 'minor' | 'moderate' | 'severe' | 'extreme'
  hailSizeInches?: number
  windSpeedMph?: number
  description?: string
  lat: number
  lng: number
  radiusMiles?: number
  state?: string
  city?: string
  zip?: string
  startedAt: Date
  endedAt?: Date
  rawPayload: any
}

export class StormRadarNotConfiguredError extends Error {
  constructor(provider: Provider) {
    super(
      `Storm Radar provider "${provider}" is not configured. ` +
      `See services/stormRadar.ts header for setup instructions — ` +
      `you need to set ${getEnvVarName(provider)} and implement fetchEvents${cap(provider)}.`
    )
  }
}

function getEnvVarName(p: Provider): string {
  if (p === 'noaa') return 'NOAA_API_BASE'
  if (p === 'tomorrow_io') return 'TOMORROW_IO_API_KEY'
  return 'ACCUWEATHER_API_KEY'
}
function cap(s: string) { return s.replace(/(^|_)(.)/g, (_, __, c) => c.toUpperCase()) }

// ─────────────────────────────────────────────────────────────
// PROVIDER IMPLEMENTATIONS — all stubs. Fill one in to go live.
// ─────────────────────────────────────────────────────────────

async function fetchEventsNoaa(params: {
  state?: string
  sinceDays?: number
}): Promise<NormalizedStormEvent[]> {
  // TODO: Implement NOAA Storm Events Database fetch.
  // API: https://www.ncei.noaa.gov/access/services/data/v1
  // Returns CSV — parse, filter by state + since, normalize.
  // Free, but historical only. Good for "what hit this area last week".
  throw new StormRadarNotConfiguredError('noaa')
}

async function fetchEventsTomorrowIo(params: {
  lat: number
  lng: number
  radiusMiles: number
}): Promise<NormalizedStormEvent[]> {
  // TODO: Implement Tomorrow.io severe weather fetch.
  // API: https://api.tomorrow.io/v4/weather/events?...
  // Requires TOMORROW_IO_API_KEY. Real-time events + forecasts.
  // Normalize the response shape to NormalizedStormEvent[].
  const key = process.env.TOMORROW_IO_API_KEY
  if (!key) throw new StormRadarNotConfiguredError('tomorrow_io')

  // Skeleton:
  // const res = await fetch(`https://api.tomorrow.io/v4/weather/events?location=${params.lat},${params.lng}&apikey=${key}`)
  // const json = await res.json()
  // return json.data.events.map((e: any) => ({ ... }))
  throw new StormRadarNotConfiguredError('tomorrow_io')
}

async function fetchEventsAccuweather(params: {
  state: string
  sinceDays: number
}): Promise<NormalizedStormEvent[]> {
  // TODO: Implement AccuWeather Enterprise severe weather fetch.
  // API: https://developer.accuweather.com/apis
  // Requires ACCUWEATHER_API_KEY.
  const key = process.env.ACCUWEATHER_API_KEY
  if (!key) throw new StormRadarNotConfiguredError('accuweather')
  throw new StormRadarNotConfiguredError('accuweather')
}

// ─────────────────────────────────────────────────────────────
// PUBLIC API — called by routes/stormRadar.ts
// ─────────────────────────────────────────────────────────────

/** Fetch new events from the configured provider and persist to storm_event. */
export async function syncStormEvents(companyId: string, opts: { state?: string; lat?: number; lng?: number; radiusMiles?: number; sinceDays?: number } = {}) {
  let events: NormalizedStormEvent[] = []

  if (PROVIDER === 'noaa') {
    events = await fetchEventsNoaa({ state: opts.state, sinceDays: opts.sinceDays || 7 })
  } else if (PROVIDER === 'tomorrow_io') {
    if (opts.lat === undefined || opts.lng === undefined) {
      throw new Error('tomorrow_io provider requires lat + lng for sync')
    }
    events = await fetchEventsTomorrowIo({ lat: opts.lat, lng: opts.lng, radiusMiles: opts.radiusMiles || 50 })
  } else if (PROVIDER === 'accuweather') {
    events = await fetchEventsAccuweather({ state: opts.state || '', sinceDays: opts.sinceDays || 7 })
  }

  // Upsert each into storm_event (dedup by provider_event_id)
  const inserted: any[] = []
  for (const e of events) {
    const [row] = await db
      .insert(stormRadarEvent)
      .values({
        companyId,
        provider: PROVIDER,
        providerEventId: e.providerEventId,
        eventType: e.eventType,
        severity: e.severity,
        hailSizeInches: e.hailSizeInches !== undefined ? String(e.hailSizeInches) : null,
        windSpeedMph: e.windSpeedMph,
        description: e.description,
        lat: e.lat,
        lng: e.lng,
        radiusMiles: e.radiusMiles !== undefined ? String(e.radiusMiles) : null,
        state: e.state,
        city: e.city,
        zip: e.zip,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        rawPayload: e.rawPayload,
      } as any)
      .onConflictDoNothing()
      .returning()
    if (row) inserted.push(row)
  }
  return { fetchedCount: events.length, insertedCount: inserted.length, events: inserted }
}

/**
 * After a new storm event lands, match it against existing contacts whose
 * addresses fall within the event's affected area. Populates storm_event_match.
 */
export async function matchEventsToContacts(companyId: string, eventId: string) {
  const [evt] = await db.select().from(stormRadarEvent).where(and(eq(stormRadarEvent.id, eventId), eq(stormRadarEvent.companyId, companyId))).limit(1)
  if (!evt) throw new Error('Storm event not found')

  // Simple zip-code match for now. Upgrade to lat/lng radius with PostGIS later.
  if (!evt.zip) return { matchedCount: 0 }

  const contacts = await db
    .select({ id: contact.id, zip: (contact as any).zip })
    .from(contact)
    .where(and(eq(contact.companyId, companyId), eq((contact as any).zip, evt.zip)))

  let matched = 0
  for (const c of contacts) {
    await db
      .insert(stormRadarEventMatch)
      .values({
        companyId,
        stormRadarEventId: eventId,
        contactId: c.id,
        distanceMiles: null,
        status: 'new',
      } as any)
      .onConflictDoNothing()
    matched++
  }
  return { matchedCount: matched }
}

export const isConfigured = (): boolean => {
  if (PROVIDER === 'noaa') return !!process.env.NOAA_API_BASE
  if (PROVIDER === 'tomorrow_io') return !!process.env.TOMORROW_IO_API_KEY
  if (PROVIDER === 'accuweather') return !!process.env.ACCUWEATHER_API_KEY
  return false
}

export const currentProvider = () => PROVIDER

export default { syncStormEvents, matchEventsToContacts, isConfigured, currentProvider }
