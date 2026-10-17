// The bar's LIVE STATE — the one object that answers "should I go there right now?": kitchen and bar open
// or closed (with the countdown), how busy, the bartender's note, tonight's special, the game, what's on
// tap. Built here from the bar tables and the hours engine (services/barHours.ts), served to the website at
// GET /api/public/bar/live (routes/barPublic.ts) and shown to staff on the Tonight console. Nothing else may
// compute any of this on its own. Shape: scratchpad contract BAR_CONTRACT.md, the same LiveState the bar's
// website rendered on its own before the CRM became its database.
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { barSettings, barStatus, barTap, barSpecial, barGame, company } from '../../db/schema.ts'
import { companyRowTimeZone } from '../shared/index.ts'
import {
  describe, evaluate, formatCountdown, formatTime, isHoursConfig, localDateString, EMPTY_HOURS,
  type DateOverride, type DepartmentStatus, type HoursConfig, type ManualOverride,
} from './barHours.ts'
import { formatPrice } from './barMenuSizes.ts'

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

/** The hours config for a company, with its timezone filled in (configured, else the one its state implies). */
export async function hoursFor(companyId: string): Promise<HoursConfig> {
  const [s] = await db.select().from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const base: HoursConfig = isHoursConfig(s?.hours) ? JSON.parse(JSON.stringify(s!.hours)) : JSON.parse(JSON.stringify(EMPTY_HOURS))
  base.timezone = base.timezone && base.timezone.trim() ? base.timezone : companyRowTimeZone(co)
  // No configured zone and no state to infer one from: Central, the product's home default (home care's
  // agencyTime uses the same), rather than UTC, which would put a 2 AM close at 9 PM on the board.
  if (base.timezone === 'UTC' && !(s?.hours as any)?.timezone) base.timezone = 'America/Chicago'
  return base
}

/** Build the live state for one company. `now` is injectable for tests. */
export async function buildLiveState(companyId: string, now: Date = new Date()): Promise<LiveState> {
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
  const specialRows = await db.select().from(barSpecial)
    .where(and(eq(barSpecial.companyId, companyId), lte(barSpecial.startsAt, windowEnd), or(isNull(barSpecial.endsAt), gte(barSpecial.endsAt, now))))
    .orderBy(desc(barSpecial.startsAt)).limit(20)
  const dow = weekdayCode(now, tz)
  const special = specialRows.find((sp) => {
    if (sp.isRecurring) return sp.startsAt.getTime() <= now.getTime() && (!sp.recurrenceDays || sp.recurrenceDays.split(',').map((d) => d.trim().toUpperCase()).includes(dow))
    return sp.startsAt.getTime() <= now.getTime() && (!sp.endsAt || sp.endsAt.getTime() >= now.getTime())
  }) || null

  const tapRows = await db.select().from(barTap)
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

/**
 * When a console override lapses: the end of the bar's business day (4 AM local after the night it was set),
 * so a Friday-night "kitchen closed" can never leave the board wrong on Saturday.
 */
export function endOfBusinessDay(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  let ymd = `${get('year')}-${get('month')}-${get('day')}`
  const hour = Number(get('hour'))
  // Before 4 AM still belongs to last night: it lapses at 4 AM today. From 4 AM on, at 4 AM tomorrow.
  if (hour >= 4) {
    const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); ymd = d.toISOString().slice(0, 10)
  }
  // 04:00 local on `ymd`, found by stepping the offset (DST-safe: Intl decides the offset at that instant).
  const guess = new Date(`${ymd}T04:00:00Z`)
  const off = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value)
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - d.getTime()
  }
  return new Date(guess.getTime() - off(guess))
}
