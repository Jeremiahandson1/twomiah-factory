/**
 * lib/staff/rota.ts — the schedule against the database.
 *
 * Weeks are the payroll workweek (settings.payroll.weekStart), so scheduled
 * overtime and paid overtime are counted the same way. Staff only ever see a
 * published copy. Time-off requests come from the bar screens (the person
 * types their own PIN) and the owner approves or denies them.
 */
import bcrypt from 'bcryptjs'
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { checks, scheduleShifts, scheduleWeeks, settings as settingsTbl, staffPins, timeOffRequests, timeShifts } from '../../db/schema'
import { addDays, isHoursConfig, localToUtc, EMPTY_HOURS, type HoursConfig } from '../hours'
import { barTimezone, businessDayOf } from '../register/reports'
import { workweekStart } from './hours'
import { loadPayrollConfig } from './timeclock'
import { TIME, closeOn, coverageGaps, hoursOf, openOn, overlaps, weekPlan, type Planned } from './schedule'

export class RotaError extends Error { constructor(message: string, public status = 400) { super(message) } }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const clean = (v: unknown, n: number) => { const s = String(v ?? '').trim().slice(0, n); return s || null }

async function hoursConfig(db: typeof DB): Promise<HoursConfig> {
  const [s] = await db.select({ hours: settingsTbl.hours }).from(settingsTbl).limit(1)
  return isHoursConfig(s?.hours) ? (s!.hours as HoursConfig) : EMPTY_HOURS
}

export async function weekFor(db: typeof DB, day?: string | null) {
  const cfg = await loadPayrollConfig(db)
  const tz = await barTimezone(db)
  const d = day && DAY.test(day) ? day : businessDayOf(new Date(), tz)
  const start = workweekStart(d, cfg.weekStart)
  return { start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), tz }
}

async function touch(db: typeof DB, day: string) {
  const { start } = await weekFor(db, day)
  await db.insert(scheduleWeeks).values({ weekStart: start, changedAt: new Date() }).onConflictDoUpdate({ target: scheduleWeeks.weekStart, set: { changedAt: new Date() } })
}

/** Average food & drink sales for each day, from the same weekday over the last four weeks. */
async function forecast(db: typeof DB, days: string[], tz: string): Promise<Record<string, number | null>> {
  const from = localToUtc(addDays(days[0], -28), '06:00', tz), to = localToUtc(days[0], '06:00', tz)
  const rows = await db.select({ closedAt: checks.closedAt, sub: checks.subtotalCents,
    cards: sql<number>`coalesce((select sum(i.qty * i.unit_price_cents) from check_items i where i.check_id = "checks"."id" and i.kind = 'giftcard' and i.state <> 'void'), 0)::int` })
    .from(checks).where(and(eq(checks.status, 'paid'), gte(checks.closedAt, from), lt(checks.closedAt, to)))
  const byDay = new Map<string, number>()
  for (const r of rows) { if (!r.closedAt) continue; const d = businessDayOf(r.closedAt, tz); byDay.set(d, (byDay.get(d) || 0) + (r.sub || 0) - r.cards) }
  const out: Record<string, number | null> = {}
  for (const d of days) {
    const past = [1, 2, 3, 4].map(k => addDays(d, -7 * k)).filter(x => x < days[0])
    const seen = past.filter(x => byDay.has(x))
    out[d] = seen.length ? Math.round(seen.reduce((n, x) => n + byDay.get(x)!, 0) / seen.length) : null
  }
  return out
}

/** Everything the owner's week grid needs. */
export async function loadWeek(db: typeof DB, day?: string | null, now = new Date()) {
  const { start, days, tz } = await weekFor(db, day)
  const [hours, shifts, pins, week, timeOff, worked] = await Promise.all([
    hoursConfig(db),
    db.select().from(scheduleShifts).where(inArray(scheduleShifts.day, days)).orderBy(asc(scheduleShifts.day), asc(scheduleShifts.start)),
    db.select({ id: staffPins.id, label: staffPins.label, clocksIn: staffPins.clocksIn, isActive: staffPins.isActive, hourlyCents: staffPins.hourlyCents }).from(staffPins).orderBy(asc(staffPins.label)),
    db.select().from(scheduleWeeks).where(eq(scheduleWeeks.weekStart, start)).limit(1).then(r => r[0] || null),
    db.select().from(timeOffRequests).where(inArray(timeOffRequests.day, days)),
    db.select().from(timeShifts).where(and(isNull(timeShifts.voidedAt), gte(timeShifts.startAt, localToUtc(days[0], '00:00', tz)), lt(timeShifts.startAt, localToUtc(addDays(days[6], 1), '06:00', tz)))),
  ])
  const sales = await forecast(db, days, tz)
  const rates = new Map(pins.map(p => [p.id, p.hourlyCents]))
  const plan = weekPlan(shifts, tz, rates)
  const names = new Map(pins.map(p => [p.id, p.label]))
  const approvedOff = new Set(timeOff.filter(t => t.status === 'approved').map(t => t.pinId + '|' + t.day))
  // Labor % needs history for every day the bar is open that week; a partial forecast
  // against a full week of wages would say 1,300%. Closed days need none.
  const openDays = days.filter(d => closeOn(hours, d) !== null)
  const knownOpen = openDays.filter(d => sales[d] !== null)
  const forecastComplete = openDays.length > 0 && knownOpen.length === openDays.length
  const salesTotal = forecastComplete ? knownOpen.reduce((n, d) => n + (sales[d] as number), 0) : null
  // What was actually worked, per person per day (by the day the shift started, 6 AM business day).
  const actual: Record<string, number> = {}
  for (const w of worked) {
    const d = businessDayOf(w.startAt, tz)
    const h = ((w.endAt ? w.endAt.getTime() : now.getTime()) - w.startAt.getTime()) / 3600000
    actual[w.pinId + '|' + d] = Math.round(((actual[w.pinId + '|' + d] || 0) + h) * 100) / 100
  }
  return {
    weekStart: start, days, tz,
    bar: Object.fromEntries(days.map(d => [d, { open: openOn(hours, d), close: closeOn(hours, d) }])),
    people: pins.filter(p => (p.isActive && p.clocksIn) || shifts.some(s => s.pinId === p.id)).map(p => ({ ...(plan.people.find(x => x.pinId === p.id) || { hours: 0, overtime: 0, wagesCents: p.hourlyCents === null ? null : 0 }), pinId: p.id, name: p.label, hourlyCents: p.hourlyCents, isActive: p.isActive })),
    shifts: shifts.map(s => ({ ...s, name: names.get(s.pinId) || '?', hours: hoursOf(s, tz), onTimeOff: approvedOff.has(s.pinId + '|' + s.day) })),
    timeOff: timeOff.map(t => ({ ...t, name: names.get(t.pinId) || '?' })),
    gaps: coverageGaps(hours, days, shifts, tz),
    overlaps: overlaps(shifts, tz).map(([a, b]) => ({ name: names.get(a.pinId) || '?', day: b.day, a: (a as any).id, b: (b as any).id })),
    wagesCents: plan.wagesCents, salesForecast: sales, salesForecastCents: salesTotal, forecastDays: { known: knownOpen.length, open: openDays.length },
    laborPct: plan.wagesCents === null || !salesTotal ? null : Math.round((plan.wagesCents / salesTotal) * 1000) / 10,
    actual,
    published: week?.publishedAt ? { at: week.publishedAt, by: week.publishedBy } : null,
    unpublishedChanges: !!week?.changedAt && (!week.publishedAt || week.changedAt > week.publishedAt),
  }
}

function checkTimes(hours: HoursConfig, day: string, startIn: unknown, endIn: unknown) {
  let start = String(startIn || '').trim().toLowerCase(), end = String(endIn || '').trim().toLowerCase()
  if (start === 'open') { const o = openOn(hours, day); if (!o) throw new RotaError('The bar is closed that day.'); start = o }
  if (end === 'close') { const c = closeOn(hours, day); if (!c) throw new RotaError('The bar is closed that day; give an end time.'); end = c }
  if (!TIME.test(start) || !TIME.test(end)) throw new RotaError('Times look like 16:00.')
  if (start === end) throw new RotaError('A shift has to be longer than that.')
  return { start: start.padStart(5, '0'), end: end.padStart(5, '0') }
}

export async function addScheduled(db: typeof DB, b: Record<string, unknown>, by: string) {
  const day = String(b.day || '')
  if (!DAY.test(day)) throw new RotaError('Which day?')
  const [p] = await db.select().from(staffPins).where(eq(staffPins.id, String(b.pinId || '00000000-0000-0000-0000-000000000000'))).limit(1)
  if (!p || !p.isActive) throw new RotaError('Who is working it?', 404)
  const t = checkTimes(await hoursConfig(db), day, b.start, b.end)
  const tz = await barTimezone(db)
  if (hoursOf({ pinId: p.id, day, ...t }, tz) > 16) throw new RotaError('Over 16 hours is almost surely a mistake.')
  const [row] = await db.insert(scheduleShifts).values({ pinId: p.id, day, ...t, position: clean(b.position, 30), note: clean(b.note, 120), createdBy: by }).returning()
  await touch(db, day)
  return row
}

export async function updateScheduled(db: typeof DB, id: string, b: Record<string, unknown>) {
  const [s] = await db.select().from(scheduleShifts).where(eq(scheduleShifts.id, id)).limit(1)
  if (!s) throw new RotaError('That shift is gone.', 404)
  const day = b.day !== undefined ? String(b.day) : s.day
  if (!DAY.test(day)) throw new RotaError('Which day?')
  const t = checkTimes(await hoursConfig(db), day, b.start ?? s.start, b.end ?? s.end)
  let pinId = s.pinId
  if (b.pinId !== undefined) {
    const [p] = await db.select().from(staffPins).where(eq(staffPins.id, String(b.pinId))).limit(1)
    if (!p || !p.isActive) throw new RotaError('Who is working it?', 404)
    pinId = p.id
  }
  const [row] = await db.update(scheduleShifts).set({ pinId, day, ...t, position: b.position !== undefined ? clean(b.position, 30) : s.position, note: b.note !== undefined ? clean(b.note, 120) : s.note, updatedAt: new Date() }).where(eq(scheduleShifts.id, id)).returning()
  await touch(db, s.day); if (day !== s.day) await touch(db, day)
  return row
}

export async function deleteScheduled(db: typeof DB, id: string) {
  const [s] = await db.delete(scheduleShifts).where(eq(scheduleShifts.id, id)).returning()
  if (!s) throw new RotaError('That shift is gone.', 404)
  await touch(db, s.day)
}

/** Copy one week's shifts onto another (same weekday, same times). Refuses to pile onto a week that has shifts unless told to replace. */
export async function copyWeek(db: typeof DB, fromDay: string, toDay: string, replace: boolean, by: string) {
  const from = await weekFor(db, fromDay), to = await weekFor(db, toDay)
  if (from.start === to.start) throw new RotaError('Pick a different week to copy from.')
  const src = await db.select().from(scheduleShifts).where(inArray(scheduleShifts.day, from.days))
  if (!src.length) throw new RotaError('That week has no shifts to copy.')
  const existing = await db.select({ id: scheduleShifts.id }).from(scheduleShifts).where(inArray(scheduleShifts.day, to.days))
  if (existing.length && !replace) throw new RotaError('This week already has shifts. Replace them?', 409)
  const active = new Set((await db.select({ id: staffPins.id }).from(staffPins).where(eq(staffPins.isActive, true))).map(p => p.id))
  const offset = Math.round((new Date(to.start + 'T12:00:00Z').getTime() - new Date(from.start + 'T12:00:00Z').getTime()) / 86400000)
  await db.transaction(async (tx) => {
    if (existing.length) await tx.delete(scheduleShifts).where(inArray(scheduleShifts.day, to.days))
    const rows = src.filter(s => active.has(s.pinId)).map(s => ({ pinId: s.pinId, day: addDays(s.day, offset), start: s.start, end: s.end, position: s.position, note: s.note, createdBy: by }))
    if (rows.length) await tx.insert(scheduleShifts).values(rows)
  })
  await touch(db, to.start)
  return (await db.select({ id: scheduleShifts.id }).from(scheduleShifts).where(inArray(scheduleShifts.day, to.days))).length
}

export async function publishWeek(db: typeof DB, day: string, by: string) {
  const w = await loadWeek(db, day)
  const snapshot = w.shifts.map(s => ({ name: s.name, pinId: s.pinId, day: s.day, start: s.start, end: s.end, position: s.position, note: s.note }))
  const now = new Date()
  await db.insert(scheduleWeeks).values({ weekStart: w.weekStart, publishedAt: now, publishedBy: by, snapshot, changedAt: now })
    .onConflictDoUpdate({ target: scheduleWeeks.weekStart, set: { publishedAt: now, publishedBy: by, snapshot, changedAt: now } })
  return { weekStart: w.weekStart, shifts: snapshot.length, gaps: w.gaps.length }
}

/** What staff see: the published copy of this week and next. */
export async function publishedWeeks(db: typeof DB, day?: string | null) {
  const cur = await weekFor(db, day)
  const next = await weekFor(db, addDays(cur.start, 7))
  const rows = await db.select().from(scheduleWeeks).where(inArray(scheduleWeeks.weekStart, [cur.start, next.start]))
  const one = (w: { start: string; days: string[] }) => {
    const r = rows.find(x => x.weekStart === w.start)
    return { weekStart: w.start, days: w.days, published: !!r?.publishedAt, publishedAt: r?.publishedAt || null, shifts: (r?.snapshot as any[]) || [] }
  }
  return { tz: cur.tz, weeks: [one(cur), one(next)] }
}

// ─── Time off ───────────────────────────────────────────────────────────────
const attempts = new Map<string, number[]>()
export async function requestTimeOff(db: typeof DB, rawPin: unknown, day: unknown, note: unknown, screen: { sessionId: string }) {
  const d = String(day || '')
  if (!DAY.test(d)) throw new RotaError('Which day?')
  const tz = await barTimezone(db)
  if (d < businessDayOf(new Date(), tz)) throw new RotaError("That day's already gone.")
  const pin = String(rawPin ?? '').replace(/\D/g, '')
  if (pin.length < 4) throw new RotaError('Type your PIN.')
  const t = Date.now()
  const tries = (attempts.get(screen.sessionId) || []).filter(x => t - x < 600000)
  if (tries.length >= 5) throw new RotaError('Too many wrong PINs. Wait a few minutes.', 429)
  const rows = await db.select().from(staffPins).where(and(eq(staffPins.isActive, true), eq(staffPins.clocksIn, true)))
  let who: typeof staffPins.$inferSelect | null = null
  for (const r of rows) if (await bcrypt.compare(pin, r.pinHash)) { who = r; break }
  if (!who) { tries.push(t); attempts.set(screen.sessionId, tries); throw new RotaError("That PIN didn't match anyone on the schedule.") }
  const [dupe] = await db.select({ id: timeOffRequests.id }).from(timeOffRequests).where(and(eq(timeOffRequests.pinId, who.id), eq(timeOffRequests.day, d), inArray(timeOffRequests.status, ['pending', 'approved']))).limit(1)
  if (dupe) throw new RotaError('You already asked for that day.', 409)
  const [row] = await db.insert(timeOffRequests).values({ pinId: who.id, day: d, note: clean(note, 200) }).returning()
  return { ...row, name: who.label }
}

export async function decideTimeOff(db: typeof DB, id: string, status: unknown, by: string) {
  if (status !== 'approved' && status !== 'denied') throw new RotaError('Approve or deny?')
  const [row] = await db.update(timeOffRequests).set({ status, decidedBy: by, decidedAt: new Date() }).where(eq(timeOffRequests.id, id)).returning()
  if (!row) throw new RotaError('That request is gone.', 404)
  return row
}

export async function pendingTimeOff(db: typeof DB) {
  const tz = await barTimezone(db)
  const today = businessDayOf(new Date(), tz)
  return db.select({ id: timeOffRequests.id, day: timeOffRequests.day, note: timeOffRequests.note, status: timeOffRequests.status, name: staffPins.label, createdAt: timeOffRequests.createdAt })
    .from(timeOffRequests).innerJoin(staffPins, eq(staffPins.id, timeOffRequests.pinId))
    .where(and(eq(timeOffRequests.status, 'pending'), gte(timeOffRequests.day, today))).orderBy(asc(timeOffRequests.day))
}
