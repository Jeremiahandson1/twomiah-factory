// Storm Radar: a pluggable weather-event provider (NOAA, Tomorrow.io, AccuWeather) and matching an event to the
// contacts in its zip. Moved from templates/crm-roof/backend/src/services/stormRadar.ts.
//
// Every provider is still a stub there and here: each throws StormRadarNotConfiguredError until it is written, so a
// sync never reaches the network. To go live (the template's instructions): pick a provider, set STORM_RADAR_PROVIDER
// and its key (TOMORROW_IO_API_KEY, ACCUWEATHER_API_KEY, or NOAA_API_BASE), and fill in its fetchEvents* below to return
// NormalizedStormEvent[]. Scheduling a sync is a timer the template never had (its header's step 4); it would be
// registered with d.services.addJob, not started here.
//
// Changes from the template:
//   · the provider is read when it is asked for, not once at import;
//   · a sync and a match no longer write duplicates. Both said "dedup" with onConflictDoNothing, but storm_radar_event
//     and storm_event_match have no unique index (templates/crm-roof db/schema.ts, carried as is), so nothing
//     conflicted: matching an event twice put every contact on the list twice. An event already held (same provider
//     and provider id) and a contact already matched to the event are skipped;
//   · the providers can be handed in (tests stub them); the stubs never reach the network.
import { and, eq } from 'drizzle-orm'
import { contact, stormRadarEvent, stormRadarEventMatch } from '../../../db/schema/index.ts'
import { notFound } from '../../../http/errors.ts'
import type { CrmDeps } from '../../deps.ts'

export type Provider = 'noaa' | 'tomorrow_io' | 'accuweather'

/** The shape every provider maps to before it reaches the database. */
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

const envVarName = (p: Provider) => (p === 'noaa' ? 'NOAA_API_BASE' : p === 'tomorrow_io' ? 'TOMORROW_IO_API_KEY' : 'ACCUWEATHER_API_KEY')
const cap = (s: string) => s.replace(/(^|_)(.)/g, (_, __, ch) => ch.toUpperCase())

export class StormRadarNotConfiguredError extends Error {
  constructor(provider: Provider) {
    super(`Storm Radar provider "${provider}" is not configured. See server/crm/roof/field/stormRadarService.ts for setup instructions — ` +
      `you need to set ${envVarName(provider)} and implement fetchEvents${cap(provider)}.`)
  }
}

export type StormFetchers = {
  noaa: (p: { state?: string; sinceDays?: number }) => Promise<NormalizedStormEvent[]>
  tomorrow_io: (p: { lat: number; lng: number; radiusMiles: number }) => Promise<NormalizedStormEvent[]>
  accuweather: (p: { state: string; sinceDays: number }) => Promise<NormalizedStormEvent[]>
}

// The providers — all stubs, as in the template. Fill one in to go live.
const STUB_FETCHERS: StormFetchers = {
  // NOAA Storm Events Database (https://www.ncei.noaa.gov/access/services/data/v1): CSV, free, historical only.
  noaa: async () => { throw new StormRadarNotConfiguredError('noaa') },
  // Tomorrow.io (https://api.tomorrow.io/v4/weather/events): real time, needs TOMORROW_IO_API_KEY.
  tomorrow_io: async () => { throw new StormRadarNotConfiguredError('tomorrow_io') },
  // AccuWeather Enterprise (https://developer.accuweather.com/apis): needs ACCUWEATHER_API_KEY.
  accuweather: async () => { throw new StormRadarNotConfiguredError('accuweather') },
}

export function createStormRadar(d: CrmDeps, opts: { fetchers?: Partial<StormFetchers>; env?: Record<string, string | undefined> } = {}) {
  const { db } = d
  const env = () => opts.env ?? process.env
  const fetchers: StormFetchers = { ...STUB_FETCHERS, ...(opts.fetchers || {}) }
  const currentProvider = (): Provider => (env().STORM_RADAR_PROVIDER as Provider) || 'noaa'
  const isConfigured = (): boolean => {
    const p = currentProvider()
    if (p === 'noaa') return !!env().NOAA_API_BASE
    if (p === 'tomorrow_io') return !!env().TOMORROW_IO_API_KEY
    if (p === 'accuweather') return !!env().ACCUWEATHER_API_KEY
    return false
  }

  /** New events from the configured provider, kept once each (provider + its event id). */
  async function syncStormEvents(companyId: string, o: { state?: string; lat?: number; lng?: number; radiusMiles?: number; sinceDays?: number } = {}) {
    const provider = currentProvider()
    let events: NormalizedStormEvent[] = []
    if (provider === 'noaa') events = await fetchers.noaa({ state: o.state, sinceDays: o.sinceDays || 7 })
    else if (provider === 'tomorrow_io') {
      if (o.lat === undefined || o.lng === undefined) throw new Error('tomorrow_io provider requires lat + lng for sync')
      events = await fetchers.tomorrow_io({ lat: o.lat, lng: o.lng, radiusMiles: o.radiusMiles || 50 })
    } else if (provider === 'accuweather') events = await fetchers.accuweather({ state: o.state || '', sinceDays: o.sinceDays || 7 })

    const inserted: any[] = []
    for (const e of events) {
      const [held] = await db.select({ id: stormRadarEvent.id }).from(stormRadarEvent).where(and(
        eq(stormRadarEvent.companyId, companyId), eq(stormRadarEvent.provider, provider), eq(stormRadarEvent.providerEventId, e.providerEventId),
      )).limit(1)
      if (held) continue
      const [row] = await db.insert(stormRadarEvent).values({
        companyId, provider, providerEventId: e.providerEventId, eventType: e.eventType, severity: e.severity,
        hailSizeInches: e.hailSizeInches !== undefined ? String(e.hailSizeInches) : null,
        windSpeedMph: e.windSpeedMph, description: e.description, lat: e.lat, lng: e.lng,
        radiusMiles: e.radiusMiles !== undefined ? String(e.radiusMiles) : null,
        state: e.state, city: e.city, zip: e.zip, startedAt: e.startedAt, endedAt: e.endedAt, rawPayload: e.rawPayload,
      } as any).returning()
      if (row) inserted.push(row)
    }
    return { fetchedCount: events.length, insertedCount: inserted.length, events: inserted }
  }

  /**
   * The contacts in an event's zip become its matches (a zip match for now; a radius with PostGIS later). A contact
   * already matched to the event is not matched again; matchedCount is every contact in the zip, as the template counted.
   */
  async function matchEventsToContacts(companyId: string, eventId: string) {
    const [evt] = await db.select().from(stormRadarEvent).where(and(eq(stormRadarEvent.id, eventId), eq(stormRadarEvent.companyId, companyId))).limit(1)
    if (!evt) throw notFound('Storm event not found')
    if (!evt.zip) return { matchedCount: 0 }
    const contacts = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, companyId), eq(contact.zip, evt.zip)))
    const already = new Set((await db.select({ contactId: stormRadarEventMatch.contactId }).from(stormRadarEventMatch)
      .where(and(eq(stormRadarEventMatch.companyId, companyId), eq(stormRadarEventMatch.stormRadarEventId, eventId)))).map((r: any) => r.contactId))
    const fresh = contacts.filter((c: any) => !already.has(c.id))
    if (fresh.length) {
      await db.insert(stormRadarEventMatch).values(fresh.map((c: any) => ({ companyId, stormRadarEventId: eventId, contactId: c.id, distanceMiles: null, status: 'new' })) as any)
    }
    return { matchedCount: contacts.length }
  }

  return { syncStormEvents, matchEventsToContacts, isConfigured, currentProvider }
}

export type StormRadar = ReturnType<typeof createStormRadar>
