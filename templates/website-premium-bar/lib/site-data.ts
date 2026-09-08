/**
 * lib/site-data.ts — one cached bundle of everything a section partial might
 * need beyond its own JSON. Partials are synchronous EJS, so the server
 * gathers this before rendering and passes it as `site`.
 *
 * Cache: ~20 s in memory. Console writes call bustSiteData() so a bartender's
 * tap shows on the next request, and /api/live/fresh bypasses it entirely.
 */
import { and, asc, eq, gte } from 'drizzle-orm'
import { db } from '../db'
import { events, menuItems, menuSections, settings as settingsTbl, taps, timelineEntries } from '../db/schema'
import { buildLiveState, type LiveState } from './live'
import { isHoursConfig, openingHoursSpecification, specialOpeningHours, EMPTY_HOURS, type HoursConfig } from './hours'
import type { HoursSpec } from './schema-org/business'

export interface MenuSectionWithItems {
  id: string; slug: string; name: string; description: string | null; kind: string
  items: Array<typeof menuItems.$inferSelect>
}

export interface SiteData {
  live: LiveState
  hours: HoursConfig
  hoursSchema: HoursSpec
  menu: MenuSectionWithItems[]
  signatureItems: Array<typeof menuItems.$inferSelect>
  taps: Array<typeof taps.$inferSelect>
  timeline: Array<typeof timelineEntries.$inferSelect>
  events: Array<typeof events.$inferSelect>
  loadedAt: number
}

const TTL_MS = 20_000
let cache: SiteData | null = null
let inflight: Promise<SiteData> | null = null

export function bustSiteData(): void { cache = null }

export async function loadSiteData(now: Date = new Date()): Promise<SiteData> {
  if (cache && now.getTime() - cache.loadedAt < TTL_MS) return cache
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await gather(now)
      cache = data
      return data
    } finally {
      inflight = null
    }
  })()
  return inflight
}

async function gather(now: Date): Promise<SiteData> {
  const [settingsRow] = await db.select().from(settingsTbl).limit(1)
  const hours: HoursConfig = isHoursConfig(settingsRow?.hours) ? (settingsRow!.hours as HoursConfig) : EMPTY_HOURS
  const holidays = hours.holidays || []

  const [live, sections, items, tapRows, timeline, eventRows] = await Promise.all([
    buildLiveState(db, now),
    db.select().from(menuSections).where(eq(menuSections.isActive, true)).orderBy(asc(menuSections.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
    db.select().from(taps).where(eq(taps.isActive, true)).orderBy(asc(taps.sortOrder), asc(taps.lineNumber)),
    db.select().from(timelineEntries).where(eq(timelineEntries.isPublished, true)).orderBy(asc(timelineEntries.sortOrder), asc(timelineEntries.yearStart)),
    db.select().from(events).where(and(eq(events.isPublished, true), gte(events.startsAt, new Date(now.getTime() - 6 * 3600000)))).orderBy(asc(events.startsAt)).limit(30),
  ])

  const menu: MenuSectionWithItems[] = sections.map(s => ({
    id: s.id, slug: s.slug, name: s.name, description: s.description, kind: s.kind,
    items: items.filter(i => i.sectionId === s.id),
  }))

  return {
    live,
    hours,
    hoursSchema: {
      bar: [...openingHoursSpecification(hours.bar), ...specialOpeningHours(holidays, 'bar')],
      kitchen: [...openingHoursSpecification(hours.kitchen), ...specialOpeningHours(holidays, 'kitchen')],
    },
    menu,
    signatureItems: items.filter(i => i.isSignature),
    taps: tapRows,
    timeline,
    events: eventRows,
    loadedAt: now.getTime(),
  }
}
