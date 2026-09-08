/**
 * lib/live.ts — builds the LIVE STATE: the single object that answers
 * "should I go to the bar right now?". Served raw at /api/live, rendered
 * server-side into the Tonight Board, read by the voice agent, and handed
 * to every section partial as `site.live`.
 *
 * No section, route, or agent may compute any of this on its own.
 */
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'
import type { db as DB } from '../db'
import { games, serviceStatus, settings as settingsTbl, specials, taps } from '../db/schema'
import { describe, evaluate, formatCountdown, formatTime, isHoursConfig, localDateString, EMPTY_HOURS, type DateOverride, type DepartmentStatus, type HoursConfig, type ManualOverride } from './hours'

export type RoomStatus = 'quiet' | 'filling' | 'packed'

export interface LiveDepartment {
  isOpen: boolean
  closesAt: string | null
  opensAt: string | null
  /** "Kitchen open — closes 9 PM (2h 14m)" */
  line: string
  /** "closes 9 PM" / "opens tomorrow at 11 AM" */
  short: string
  countdown: string | null
  source: string
  note: string | null
}

export interface LiveState {
  generatedAt: string
  timezone: string
  localDate: string
  kitchen: LiveDepartment
  bar: LiveDepartment
  room: { status: RoomStatus; label: string }
  note: string | null
  special: { title: string; description: string | null; price: string | null } | null
  game: { league: string; home: string; away: string; startsAt: string; startsAtLabel: string; note: string | null; isToday: boolean } | null
  taps: { count: number; featured: Array<{ name: string; brewery: string | null; style: string | null; status: string; badge: string | null }>; updatedAt: string | null }
  updatedAt: string | null
  updatedBy: string | null
}

const ROOM_LABEL: Record<RoomStatus, string> = {
  quiet: 'Plenty of seats',
  filling: 'Filling up',
  packed: 'Packed',
}

export function formatPrice(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}

function dept(status: DepartmentStatus, now: Date, tz: string, noun: string): LiveDepartment {
  const countdown = status.msUntilChange !== null ? formatCountdown(status.msUntilChange) : null
  let short: string
  if (status.isOpen && status.closesAt) short = `closes ${formatTime(status.closesAt, tz)}`
  else if (status.opensAt) {
    const sameDay = localDateString(status.opensAt, tz) === localDateString(now, tz)
    short = sameDay ? `opens ${formatTime(status.opensAt, tz)}` : describe(status, now, tz, noun).replace(/^.*— /, '')
  } else short = 'closed'
  return {
    isOpen: status.isOpen,
    closesAt: status.closesAt ? status.closesAt.toISOString() : null,
    opensAt: status.opensAt ? status.opensAt.toISOString() : null,
    line: describe(status, now, tz, noun),
    short,
    countdown,
    source: status.source,
    note: status.note,
  }
}

function toManual(open: boolean | null, closesAt: Date | null, until: Date | null, note: string | null): ManualOverride | null {
  if (open === null && !closesAt) return null
  if (open === false) return { closed: true, until, note }
  if (closesAt) return { closesAt, until, note }
  return null
}

function gameLabel(startsAt: Date, now: Date, tz: string): string {
  const day = localDateString(startsAt, tz) === localDateString(now, tz) ? 'Tonight' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(startsAt).getDay()]
  return `${day} ${formatTime(startsAt, tz)}`
}

/**
 * Build the live state from Postgres. `now` is injectable for tests.
 * Queries are small and indexed; callers cache for ~20 s.
 */
export async function buildLiveState(db: typeof DB, now: Date = new Date()): Promise<LiveState> {
  const [settingsRow] = await db.select().from(settingsTbl).limit(1)
  const [status] = await db.select().from(serviceStatus).limit(1)
  const hours: HoursConfig = isHoursConfig(settingsRow?.hours) ? (settingsRow!.hours as HoursConfig) : EMPTY_HOURS
  const tz = hours.timezone || settingsRow?.timezone || 'America/Chicago'
  hours.timezone = tz

  // Featured game in the next 24h (or the one in progress within the last 4h).
  const windowStart = new Date(now.getTime() - 4 * 3600000)
  const windowEnd = new Date(now.getTime() + 24 * 3600000)
  const [game] = await db.select().from(games)
    .where(and(eq(games.isFeatured, true), gte(games.startsAt, windowStart), lte(games.startsAt, windowEnd)))
    .orderBy(asc(games.startsAt)).limit(1)

  const gameDays: DateOverride[] = []
  if (game && (game.barHours || game.kitchenHours)) {
    gameDays.push({
      date: localDateString(game.startsAt, tz),
      label: game.note || `${game.away} at ${game.home}`,
      ...(game.barHours ? { bar: game.barHours as any } : {}),
      ...(game.kitchenHours ? { kitchen: game.kitchenHours as any } : {}),
    })
  }

  const manual = status ? {
    kitchen: toManual(status.kitchenOpen, status.kitchenClosesAt, status.overrideUntil, status.note),
    bar: toManual(status.barOpen, status.barClosesAt, status.overrideUntil, status.note),
  } : undefined

  const h = evaluate(hours, { now, gameDays, manual })

  // Today's special: active window, or a recurring one whose weekday matches.
  const specialRows = await db.select().from(specials)
    .where(and(lte(specials.startsAt, windowEnd), or(isNull(specials.endsAt), gte(specials.endsAt, now))))
    .orderBy(desc(specials.startsAt)).limit(10)
  const dow = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay()]
  const special = specialRows.find(sp => {
    if (sp.isRecurring) return !sp.recurrenceRule || sp.recurrenceRule.includes(dow)
    return sp.startsAt.getTime() <= now.getTime() && (!sp.endsAt || sp.endsAt.getTime() >= now.getTime())
  }) || null

  const tapRows = await db.select().from(taps).where(eq(taps.isActive, true)).orderBy(asc(taps.sortOrder), asc(taps.lineNumber))
  const pouring = tapRows.filter(t => t.status !== 'blown')
  const tapsUpdated = tapRows.reduce<Date | null>((m, t) => (!m || t.updatedAt > m ? t.updatedAt : m), null)

  const room = (status?.roomStatus === 'filling' || status?.roomStatus === 'packed') ? status.roomStatus : 'quiet'
  const overrideLive = !!status?.overrideUntil && status.overrideUntil.getTime() > now.getTime()

  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    localDate: h.localDate,
    kitchen: dept(h.kitchen, now, tz, 'kitchen'),
    bar: dept(h.bar, now, tz, 'bar'),
    room: { status: room, label: ROOM_LABEL[room] },
    note: overrideLive || !status?.overrideUntil ? (status?.note || null) : null,
    special: special ? { title: special.title, description: special.description, price: formatPrice(special.priceCents) } : null,
    game: game ? {
      league: game.league, home: game.home, away: game.away,
      startsAt: game.startsAt.toISOString(), startsAtLabel: gameLabel(game.startsAt, now, tz),
      note: game.note, isToday: localDateString(game.startsAt, tz) === h.localDate,
    } : null,
    taps: {
      count: pouring.length,
      featured: pouring.slice(0, 4).map(t => ({ name: t.beerName, brewery: t.brewery, style: t.style, status: t.status, badge: t.badge })),
      updatedAt: tapsUpdated ? tapsUpdated.toISOString() : null,
    },
    updatedAt: status?.updatedAt ? status.updatedAt.toISOString() : null,
    updatedBy: status?.updatedBy || null,
  }
}

/** A live state with no database — for the static renderer and for tests. */
export function liveStateFromHours(hours: HoursConfig, now: Date = new Date(), extras: Partial<LiveState> = {}): LiveState {
  const tz = hours.timezone || 'America/Chicago'
  const h = evaluate(hours, { now })
  return {
    generatedAt: now.toISOString(), timezone: tz, localDate: h.localDate,
    kitchen: dept(h.kitchen, now, tz, 'kitchen'), bar: dept(h.bar, now, tz, 'bar'),
    room: { status: 'quiet', label: ROOM_LABEL.quiet }, note: null, special: null, game: null,
    taps: { count: 0, featured: [], updatedAt: null }, updatedAt: null, updatedBy: null,
    ...extras,
  }
}

// Keep the unused-import linter honest: sql is used by callers that extend this module.
void sql
