/**
 * lib/staff/timeclock.ts — punches and timesheets against the database.
 *
 * A person clocks in and out on any bar screen by typing their own PIN; the
 * screen stays signed in as whatever it is ("Bar tablet"). Only PINs marked
 * `clocks_in` (a person on payroll) can punch. Fixing a missed punch keeps
 * the original times and records who changed it and why.
 */
import bcrypt from 'bcryptjs'
import { and, asc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { checkPayments, checks, settings as settingsTbl, staffPins, timeShifts } from '../../db/schema'
import { barTimezone } from '../register/reports'
import { localToUtc } from '../hours'
import { estimatedWagesCents, payrollConfig, summarizeHours, type PayrollConfig } from './hours'

export class ClockError extends Error { constructor(message: string, public status = 400) { super(message) } }

export const FORGOTTEN_AFTER_HOURS = 16

// Five wrong PINs per screen per ten minutes.
const attempts = new Map<string, number[]>()
const WINDOW = 10 * 60 * 1000

export async function punch(db: typeof DB, rawPin: unknown, screen: { sessionId: string; label: string }, now = new Date()) {
  const pin = String(rawPin ?? '').replace(/\D/g, '')
  if (pin.length < 4) throw new ClockError('Type your PIN.')
  const t = Date.now()
  const tries = (attempts.get(screen.sessionId) || []).filter(x => t - x < WINDOW)
  if (tries.length >= 5) throw new ClockError('Too many wrong PINs. Wait a few minutes.', 429)
  const rows = await db.select().from(staffPins).where(eq(staffPins.isActive, true))
  let who: typeof staffPins.$inferSelect | null = null
  for (const r of rows) if (await bcrypt.compare(pin, r.pinHash)) { who = r; break }
  if (!who) { tries.push(t); attempts.set(screen.sessionId, tries); throw new ClockError("That PIN didn't match anyone.", 400) }
  if (!who.clocksIn) throw new ClockError(`"${who.label}" isn't set up for the time clock. The owner turns it on under Staff hours.`, 403)
  const [open] = await db.select().from(timeShifts).where(and(eq(timeShifts.pinId, who.id), isNull(timeShifts.endAt), isNull(timeShifts.voidedAt))).limit(1)
  if (open) {
    if (now.getTime() - open.startAt.getTime() < 60_000) throw new ClockError('You just clocked in. Wait a minute if you really mean to clock out.', 409)
    const [s] = await db.update(timeShifts).set({ endAt: now, outAt: screen.label }).where(eq(timeShifts.id, open.id)).returning()
    return { name: who.label, action: 'out' as const, shift: s, hours: Math.round(((now.getTime() - s.startAt.getTime()) / 3600000) * 100) / 100 }
  }
  const [s] = await db.insert(timeShifts).values({ pinId: who.id, startAt: now, inAt: screen.label }).returning()
  return { name: who.label, action: 'in' as const, shift: s, hours: 0 }
}

/** Who's on right now (and anyone who looks like they forgot to clock out). */
export async function onTheClock(db: typeof DB, now = new Date()) {
  const rows = await db.select({ id: timeShifts.id, startAt: timeShifts.startAt, name: staffPins.label }).from(timeShifts)
    .innerJoin(staffPins, eq(staffPins.id, timeShifts.pinId)).where(and(isNull(timeShifts.endAt), isNull(timeShifts.voidedAt))).orderBy(asc(timeShifts.startAt))
  return rows.map(r => ({ ...r, forgotten: now.getTime() - r.startAt.getTime() > FORGOTTEN_AFTER_HOURS * 3600000 }))
}

export async function loadPayrollConfig(db: typeof DB): Promise<PayrollConfig> {
  const [s] = await db.select({ p: settingsTbl.payroll }).from(settingsTbl).limit(1)
  return payrollConfig(s?.p)
}

/** One pay period: hours per person (regular/overtime), tips, estimated wages, sales and labor %. */
export async function timesheet(db: typeof DB, start: string, end: string, now = new Date()) {
  const tz = await barTimezone(db)
  const cfg = await loadPayrollConfig(db)
  const from = localToUtc(start, '00:00', tz), to = localToUtc(end, '00:00', tz)
  const [shifts, pins] = await Promise.all([
    db.select().from(timeShifts).where(and(isNull(timeShifts.voidedAt), lt(timeShifts.startAt, to), or(isNull(timeShifts.endAt), gte(timeShifts.endAt, from)))).orderBy(asc(timeShifts.startAt)),
    db.select({ id: staffPins.id, label: staffPins.label, clocksIn: staffPins.clocksIn, hourlyCents: staffPins.hourlyCents, isActive: staffPins.isActive, role: staffPins.role }).from(staffPins),
  ])
  const hours = summarizeHours(shifts, tz, cfg, start, end, now)
  // Tips per person: payments they took on checks paid in the period.
  const tips = await db.select({ who: checkPayments.takenBy, tender: checkPayments.tender, tip: sql<number>`coalesce(sum(${checkPayments.tipCents}), 0)::int` })
    .from(checkPayments).innerJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(isNull(checkPayments.voidedAt), eq(checks.status, 'paid'), gte(checks.closedAt, from), lt(checks.closedAt, to)))
    .groupBy(checkPayments.takenBy, checkPayments.tender)
  const tipOf = (label: string) => ({
    cash: tips.filter(t => t.who === label && t.tender === 'cash').reduce((n, t) => n + t.tip, 0),
    card: tips.filter(t => t.who === label && t.tender !== 'cash').reduce((n, t) => n + t.tip, 0),
  })
  // Sales for labor %: food and drink, no tax, no gift cards sold.
  const [sales] = await db.select({
    sub: sql<number>`coalesce(sum(${checks.subtotalCents}), 0)::int`,
    cards: sql<number>`coalesce((select sum(i.qty * i.unit_price_cents) from check_items i join checks c2 on c2.id = i.check_id where i.kind = 'giftcard' and i.state <> 'void' and c2.status = 'paid' and c2.closed_at >= ${from} and c2.closed_at < ${to}), 0)::int`,
  }).from(checks).where(and(eq(checks.status, 'paid'), gte(checks.closedAt, from), lt(checks.closedAt, to)))
  const salesCents = (sales?.sub || 0) - (sales?.cards || 0)
  const byPin = new Map(hours.map(h => [h.pinId, h]))
  const people = pins.filter(p => p.clocksIn || byPin.has(p.id)).map((p) => {
    const h = byPin.get(p.id) || { regular: 0, overtime: 0, total: 0, shifts: 0, openShifts: 0, weeks: [] }
    const t = tipOf(p.label)
    return { pinId: p.id, name: p.label, clocksIn: p.clocksIn, isActive: p.isActive, hourlyCents: p.hourlyCents, ...h, cashTipsCents: t.cash, cardTipsCents: t.card, wagesCents: estimatedWagesCents(h, p.hourlyCents) }
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  const wages = people.reduce<number | null>((n, p) => (p.total === 0 ? n : p.wagesCents === null || n === null ? null : n + p.wagesCents), 0)
  const names = new Map(pins.map(p => [p.id, p.label]))
  return {
    start, end, tz, config: cfg, people,
    shifts: shifts.map(s => ({ ...s, name: names.get(s.pinId) || '?', forgotten: !s.endAt && now.getTime() - s.startAt.getTime() > FORGOTTEN_AFTER_HOURS * 3600000 })),
    salesCents, wagesCents: wages, laborPct: wages === null || !salesCents ? null : Math.round((wages / salesCents) * 1000) / 10,
    openShifts: shifts.filter(s => !s.endAt).length,
  }
}

function when(v: unknown, what: string): Date {
  const d = new Date(String(v || ''))
  if (isNaN(d.getTime())) throw new ClockError(`Check the ${what} time.`)
  return d
}

/** Fix a punch. Keeps the first recorded times; a reason is required. */
export async function editShift(db: typeof DB, id: string, b: { startAt?: unknown; endAt?: unknown; note?: unknown }, by: string, now = new Date()) {
  const note = String(b.note || '').trim().slice(0, 200)
  if (!note) throw new ClockError('Say why (for the record).')
  const [s] = await db.select().from(timeShifts).where(eq(timeShifts.id, id)).limit(1)
  if (!s || s.voidedAt) throw new ClockError('That shift is gone.', 404)
  const start = b.startAt !== undefined ? when(b.startAt, 'start') : s.startAt
  const end = b.endAt === null || b.endAt === '' ? null : b.endAt !== undefined ? when(b.endAt, 'end') : s.endAt
  if (end && end <= start) throw new ClockError('The end has to be after the start.')
  if (end && end.getTime() - start.getTime() > 24 * 3600000) throw new ClockError('A shift over 24 hours is almost surely a mistake.')
  if (start > now || (end && end > now)) throw new ClockError("That's in the future.")
  const [row] = await db.update(timeShifts).set({
    startAt: start, endAt: end, originalStartAt: s.originalStartAt ?? s.startAt, originalEndAt: s.originalEndAt ?? s.endAt, editedBy: by, editNote: note,
  }).where(eq(timeShifts.id, id)).returning()
  return row
}

/** Add a shift someone forgot to punch at all. */
export async function addShift(db: typeof DB, b: { pinId?: unknown; startAt?: unknown; endAt?: unknown; note?: unknown }, by: string, now = new Date()) {
  const note = String(b.note || '').trim().slice(0, 200)
  if (!note) throw new ClockError('Say why (for the record).')
  const [p] = await db.select().from(staffPins).where(eq(staffPins.id, String(b.pinId || '00000000-0000-0000-0000-000000000000'))).limit(1)
  if (!p) throw new ClockError('Who worked it?', 404)
  const start = when(b.startAt, 'start'), end = when(b.endAt, 'end')
  if (end <= start) throw new ClockError('The end has to be after the start.')
  if (end.getTime() - start.getTime() > 24 * 3600000) throw new ClockError('A shift over 24 hours is almost surely a mistake.')
  if (end > now) throw new ClockError("That's in the future.")
  const [row] = await db.insert(timeShifts).values({ pinId: p.id, startAt: start, endAt: end, inAt: 'Added by hand', outAt: 'Added by hand', editedBy: by, editNote: note }).returning()
  return row
}

export async function voidShift(db: typeof DB, id: string, note: unknown, by: string) {
  const why = String(note || '').trim().slice(0, 200)
  if (!why) throw new ClockError('Say why (for the record).')
  const [row] = await db.update(timeShifts).set({ voidedAt: new Date(), editedBy: by, editNote: why }).where(and(eq(timeShifts.id, id), isNull(timeShifts.voidedAt))).returning()
  if (!row) throw new ClockError('That shift is gone.', 404)
  return row
}

export async function setPerson(db: typeof DB, pinId: string, b: { clocksIn?: unknown; hourlyCents?: unknown }) {
  const set: Partial<typeof staffPins.$inferInsert> = {}
  if (b.clocksIn !== undefined) set.clocksIn = !!b.clocksIn
  if (b.hourlyCents !== undefined) {
    if (b.hourlyCents === null || String(b.hourlyCents) === '') set.hourlyCents = null
    else {
      const c = Math.round(Number(b.hourlyCents))
      if (!Number.isFinite(c) || c < 0 || c > 20000) throw new ClockError('Check the hourly rate.')
      set.hourlyCents = c
    }
  }
  const [row] = await db.update(staffPins).set(set).where(eq(staffPins.id, pinId)).returning({ id: staffPins.id, label: staffPins.label, clocksIn: staffPins.clocksIn, hourlyCents: staffPins.hourlyCents })
  if (!row) throw new ClockError('That PIN is gone.', 404)
  return row
}

export async function savePayrollConfig(db: typeof DB, b: Record<string, unknown>) {
  const weekStart = Number(b.weekStart)
  if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) throw new ClockError('Pick the day the workweek starts.')
  const periodDays = Number(b.periodDays) === 14 ? 14 : 7
  const anchor = String(b.anchor || '')
  const cfg = payrollConfig({ weekStart, periodDays, anchor })
  if (anchor && cfg.anchor !== anchor) throw new ClockError('The first pay period has to start on the first day of the workweek.')
  const [s] = await db.select({ id: settingsTbl.id }).from(settingsTbl).limit(1)
  if (!s) throw new ClockError('Settings not initialized', 409)
  await db.update(settingsTbl).set({ payroll: cfg, updatedAt: new Date() }).where(eq(settingsTbl.id, s.id))
  return cfg
}


