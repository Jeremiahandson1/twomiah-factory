// The bar's LIVE STATE — the one object that answers "should I go there right now?": kitchen and bar open
// or closed (with the countdown), how busy, the bartender's note, tonight's special, the game, what's on
// tap. Built here from the bar tables and the hours engine (barHours.ts), served to the website at
// GET /api/public/bar/live (barPublic.ts) and shown to staff on the Tonight console. Nothing else may
// compute any of this on its own.
//
// Moved from templates/crm-bar/backend/src/services/barLive.ts: the arithmetic unchanged; the two functions that read
// the database are made with the app's database (createBarLive).
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { barSettings, barStatus, barTap, barSpecial, barGame, company } from '../../db/schema/index.ts'
import {
  addDays, describe, evaluate, formatCountdown, formatTime, isHoursConfig, localDateString, localToUtc, EMPTY_HOURS,
  type DateOverride, type DepartmentStatus, type HoursConfig, type ManualOverride,
} from './barHours.ts'
import { formatPrice } from './barMenuSizes.ts'
import type { BarDb } from './db.ts'

export type RoomStatus = 'quiet' | 'filling' | 'packed'
export const ROOM_STATUSES: RoomStatus[] = ['quiet', 'filling', 'packed']
export const ROOM_LABEL: Record<RoomStatus, string> = { quiet: 'Plenty of seats', filling: 'Filling up', packed: 'Packed' }
/** What the public may see of a tap. 'blown' lines are not listed at all. */
export const PUBLIC_TAP_STATUSES = ['pouring', 'just_tapped', 'last_keg'] as const
export const TAP_STATUSES = [...PUBLIC_TAP_STATUSES, 'blown'] as const

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
  /** Online pickup ordering is a later phase; the site keeps its slot so nothing changes shape when it arrives. */
  ordering: { available: false; reason: string; prepMinutes: number; lastCallAt: null }
  speakeasy: { enabled: boolean }
  updatedAt: string | null
  updatedBy: string | null
}

// The bar's one price formatter lives with the menu sizes; re-exported so callers of the live state keep it.
export { formatPrice } from './barMenuSizes.ts'

function dept(status: DepartmentStatus, now: Date, tz: string, noun: string): LiveDepartment {
  const countdown = status.msUntilChange !== null ? formatCountdown(status.msUntilChange) : null
  let short: string
  if (status.isOpen && status.closesAt) short = `closes ${formatTime(status.closesAt, tz)}`
  else if (status.isOpen) short = 'open'
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
  if (open === true) return { open: true, closesAt, until, note }   // the console's "Open now" (Bar Run 1: it had no such button)
  if (closesAt) return { closesAt, until, note }
  return null
}

function gameLabel(startsAt: Date, now: Date, tz: string): string {
  const today = localDateString(startsAt, tz) === localDateString(now, tz)
  const dow = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(startsAt)
  return `${today ? 'Tonight' : dow} ${formatTime(startsAt, tz)}`
}

const DOW_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
/** Two-letter weekday code of an instant on the bar's clock. */
export function weekdayCode(now: Date, tz: string): string {
  const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now) // 'Mon'
  return DOW_CODES[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short)] || ''
}

/** The two readers of the live state, made with the app's database. */
export function createBarLive(db: BarDb) {
  /** The hours config for a company, with its timezone filled in (configured, else the one its state implies). */
  async function hoursFor(companyId: string): Promise<HoursConfig> {
    const [s] = await db.select().from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const base: HoursConfig = isHoursConfig(s?.hours) ? JSON.parse(JSON.stringify(s!.hours)) : JSON.parse(JSON.stringify(EMPTY_HOURS))
    // The bar's clock IS the company's (2026-10-23). The saved hours carried a zone of their own — a copy of the
    // Chicago default that no screen shows or edits — and it outranked the company's, so a Honolulu bar closed early
    // on Chicago's night and counted its nights on Chicago's days.
    const zone = companyRowTimeZone(co)
    // No zone and no state to infer one from: Central, the product's home default (home care's agencyTime uses the
    // same), rather than UTC, which would put a 2 AM close at 9 PM on the board.
    base.timezone = zone === 'UTC' && co?.timezone !== 'UTC' ? 'America/Chicago' : zone
    return base
  }

  /** Build the live state for one company. `now` is injectable for tests. */
  async function buildLiveState(companyId: string, now: Date = new Date()): Promise<LiveState> {
    const hours = await hoursFor(companyId)
    const tz = hours.timezone!
    const [settings] = await db.select().from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    const [status] = await db.select().from(barStatus).where(eq(barStatus.companyId, companyId)).limit(1)

    // Featured game in the next 24 h, or one that started within the last 4 h.
    const windowStart = new Date(now.getTime() - 4 * 3600000)
    const windowEnd = new Date(now.getTime() + 24 * 3600000)
    const [game] = await db.select().from(barGame)
      .where(and(eq(barGame.companyId, companyId), eq(barGame.isFeatured, true), gte(barGame.startsAt, windowStart), lte(barGame.startsAt, windowEnd)))
      .orderBy(asc(barGame.startsAt)).limit(1)

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

    // Tonight's special: an active one-off, or a weekly one whose weekday is today on the bar's clock.
    const specialRows: Array<typeof barSpecial.$inferSelect> = await db.select().from(barSpecial)
      .where(and(eq(barSpecial.companyId, companyId), lte(barSpecial.startsAt, windowEnd), or(isNull(barSpecial.endsAt), gte(barSpecial.endsAt, now))))
      .orderBy(desc(barSpecial.startsAt)).limit(20)
    const dow = weekdayCode(now, tz)
    const special = specialRows.find((sp) => {
      if (sp.isRecurring) return sp.startsAt.getTime() <= now.getTime() && (!sp.recurrenceDays || sp.recurrenceDays.split(',').map((d) => d.trim().toUpperCase()).includes(dow))
      return sp.startsAt.getTime() <= now.getTime() && (!sp.endsAt || sp.endsAt.getTime() >= now.getTime())
    }) || null

    const tapRows: Array<typeof barTap.$inferSelect> = await db.select().from(barTap)
      .where(and(eq(barTap.companyId, companyId), eq(barTap.isActive, true)))
      .orderBy(asc(barTap.sortOrder), asc(barTap.lineNumber))
    const pouring = tapRows.filter((t) => t.status !== 'blown')
    const tapsUpdated = tapRows.reduce<Date | null>((m, t) => (!m || t.updatedAt > m ? t.updatedAt : m), null)

    const room: RoomStatus = status?.roomStatus === 'filling' || status?.roomStatus === 'packed' ? status.roomStatus : 'quiet'
    // The note lapses with the override it came with; a note set without one stays until changed.
    const noteLive = !status?.overrideUntil || status.overrideUntil.getTime() > now.getTime()

    return {
      generatedAt: now.toISOString(),
      timezone: tz,
      localDate: h.localDate,
      kitchen: dept(h.kitchen, now, tz, 'kitchen'),
      bar: dept(h.bar, now, tz, 'bar'),
      room: { status: room, label: ROOM_LABEL[room] },
      note: noteLive ? (status?.note || null) : null,
      special: special ? { title: special.title, description: special.description, price: formatPrice(special.priceCents) } : null,
      game: game ? {
        league: game.league, home: game.home, away: game.away,
        startsAt: game.startsAt.toISOString(), startsAtLabel: gameLabel(game.startsAt, now, tz),
        note: game.note, isToday: localDateString(game.startsAt, tz) === h.localDate,
      } : null,
      taps: {
        count: pouring.length,
        featured: pouring.slice(0, 4).map((t) => ({ name: t.beerName, brewery: t.brewery, style: t.style, status: t.status, badge: t.badge })),
        updatedAt: tapsUpdated ? tapsUpdated.toISOString() : null,
      },
      ordering: { available: false, reason: 'Online ordering is not open yet.', prepMinutes: 20, lastCallAt: null },
      speakeasy: { enabled: !!settings?.speakeasyPasswordHash },
      updatedAt: status?.updatedAt ? status.updatedAt.toISOString() : null,
      updatedBy: status?.updatedByName || null,
    }
  }

  return { hoursFor, buildLiveState }
}
export type BarLive = ReturnType<typeof createBarLive>

/**
 * The bar's business day: 4 AM local to 4 AM local, so a 1 AM close still counts toward tonight. ONE rule for
 * everything that asks "which night is this?": a console override lapses at its end (endOfBusinessDay), the
 * register's recent checks and the close-out read its window (barReports.ts).
 */
export const BUSINESS_DAY_STARTS = '04:00'

/** The night a moment belongs to, as YYYY-MM-DD: before 4 AM counts toward the night before. */
export function businessDayOf(now: Date, tz: string): string {
  const today = localDateString(now, tz)
  return now.getTime() >= localToUtc(today, BUSINESS_DAY_STARTS, tz).getTime() ? today : addDays(today, -1)
}

/** The instants a night runs between (DST-safe: localToUtc decides each offset at its own instant). */
export function businessDayWindow(day: string, tz: string): { from: Date; to: Date } {
  return { from: localToUtc(day, BUSINESS_DAY_STARTS, tz), to: localToUtc(addDays(day, 1), BUSINESS_DAY_STARTS, tz) }
}

/**
 * When a console override lapses: the end of the bar's business day (4 AM local after the night it was set),
 * so a Friday-night "kitchen closed" can never leave the board wrong on Saturday.
 */
export function endOfBusinessDay(now: Date, tz: string): Date {
  return businessDayWindow(businessDayOf(now, tz), tz).to
}
