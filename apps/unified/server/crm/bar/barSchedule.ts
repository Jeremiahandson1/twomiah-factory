// The schedule against the database (routes/barSchedule.ts; the arithmetic is barSchedulePlan.ts), and the time
// clock on the bar tablet.
//
// · People are the company's active login users; a pay rate is their Team card's (the same lookup the timesheet
//   values hours with — shared createTimeClock ratesByUserId), so a projected wage and a paid one agree.
// · Staff only ever see a PUBLISHED copy of a week. Time off is asked for by the person signed in, and a manager
//   approves or denies it.
// · Clocking in on the bar tablet: the person types their own till PIN, and they — not whoever the tablet is signed
//   in as — are clocked in or out through the CRM's own clock (createTimeClock), into the same time_entry rows the
//   Time page, approvals and the pay run read. One clock, one rule. Ported from website-premium-bar's
//   lib/staff/rota.ts and timeclock.ts (Amber Inn, 9/29).
//
// Moved from templates/crm-bar/backend/src/services/barSchedule.ts; made with the app's database, audit and live hours.
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { createTimeClock } from '@twomiah/tenant-backend'
import { barCheck, barCheckItem, barScheduleShift, barScheduleWeek, barTimeOff, teamMember, timeEntry, user } from '../../db/schema/index.ts'
import { pendingTimeOffCondition } from './tileConditions.ts'
import { addDays, localToUtc } from './barHours.ts'
import { businessDayOf, type BarLive } from './barLive.ts'
import { TIME, closeOn, coverageGaps, hoursOf, openOn, overlaps, weekPlan, workweekStart } from './barSchedulePlan.ts'
import type { Actor } from './barManagers.ts'
import type { BarDb } from './db.ts'

export class RotaError extends Error { constructor(message: string, public status = 400) { super(message) } }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const clean = (v: unknown, n: number) => { const s = String(v ?? '').trim().slice(0, n); return s || null }
const nameOf = (u: { firstName: string; lastName: string; email: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email

export function createBarSchedule(db: BarDb,audit: any, live: BarLive) {
const { hoursFor } = live
const clock = createTimeClock({ db, tables: { timeEntry, user, teamMember }, audit } as any)

async function weekFor(companyId: string, day?: string | null) {
  const tz = (await hoursFor(companyId)).timezone!   // hoursFor always fills the zone in
  const d = day && DAY.test(day) ? day : businessDayOf(new Date(), tz)
  const start = workweekStart(d)
  return { start, days: Array.from({ length: 7 }, (_, i) => addDays(start, i)), tz }
}

async function touch(companyId: string, day: string) {
  const { start } = await weekFor(companyId, day)
  await db.insert(barScheduleWeek).values({ weekStart: start, changedAt: new Date(), companyId })
    .onConflictDoUpdate({ target: [barScheduleWeek.companyId, barScheduleWeek.weekStart], set: { changedAt: new Date() } })
}

async function people(companyId: string) {
  return db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, isActive: user.isActive })
    .from(user).where(eq(user.companyId, companyId)).orderBy(asc(user.firstName), asc(user.lastName))
}

/** Average food & drink sales for each day, from the same weekday over the last four weeks (null with no history). */
async function forecast(companyId: string, days: string[], tz: string): Promise<Record<string, number | null>> {
  const from = localToUtc(addDays(days[0], -28), '04:00', tz), to = localToUtc(days[0], '04:00', tz)
  const rows = await db.select({ id: barCheck.id, closedAt: barCheck.closedAt, sub: barCheck.subtotalCents }).from(barCheck)
    .where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), gte(barCheck.closedAt, from), lt(barCheck.closedAt, to)))
  const cards = rows.length ? await db.select({ checkId: barCheckItem.checkId, qty: barCheckItem.qty, unit: barCheckItem.unitPriceCents, state: barCheckItem.state })
    .from(barCheckItem).where(and(eq(barCheckItem.companyId, companyId), eq(barCheckItem.kind, 'giftcard'), inArray(barCheckItem.checkId, rows.map(r => r.id)))) : []
  const cardOf = new Map<string, number>()
  for (const c of cards) if (c.state !== 'void') cardOf.set(c.checkId, (cardOf.get(c.checkId) || 0) + c.qty * c.unit)
  const byDay = new Map<string, number>()
  for (const r of rows) { if (!r.closedAt) continue; const d = businessDayOf(r.closedAt, tz); byDay.set(d, (byDay.get(d) || 0) + (r.sub || 0) - (cardOf.get(r.id) || 0)) }
  const out: Record<string, number | null> = {}
  for (const d of days) {
    const seen = [1, 2, 3, 4].map(k => addDays(d, -7 * k)).filter(x => x < days[0] && byDay.has(x))
    out[d] = seen.length ? Math.round(seen.reduce((n, x) => n + byDay.get(x)!, 0) / seen.length) : null
  }
  return out
}

/** Everything the manager's week grid needs. */
async function loadWeek(companyId: string, day?: string | null, now = new Date()) {
  const { start, days, tz } = await weekFor(companyId, day)
  const hours = await hoursFor(companyId)
  const [shifts, users, week, timeOff, worked] = await Promise.all([
    db.select().from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, days))).orderBy(asc(barScheduleShift.day), asc(barScheduleShift.start)),
    people(companyId),
    db.select().from(barScheduleWeek).where(and(eq(barScheduleWeek.companyId, companyId), eq(barScheduleWeek.weekStart, start))).limit(1).then(r => r[0] || null),
    db.select().from(barTimeOff).where(and(eq(barTimeOff.companyId, companyId), inArray(barTimeOff.day, days))),
    db.select({ userId: timeEntry.userId, clockIn: timeEntry.clockIn, clockOut: timeEntry.clockOut }).from(timeEntry)
      .where(and(eq(timeEntry.companyId, companyId), isNotNull(timeEntry.clockIn), gte(timeEntry.clockIn, localToUtc(days[0], '00:00', tz)), lt(timeEntry.clockIn, localToUtc(addDays(days[6], 1), '04:00', tz)))),
  ])
  const sales = await forecast(companyId, days, tz)
  const dollars = await clock.ratesByUserId(companyId, users.map(u => u.id))
  const rates = new Map<string, number | null>(users.map(u => [u.id, dollars[u.id] != null ? Math.round(dollars[u.id] * 100) : null]))
  const plan = weekPlan(shifts, tz, rates)
  const names = new Map(users.map(u => [u.id, nameOf(u)]))
  const approvedOff = new Set(timeOff.filter(t => t.status === 'approved').map(t => t.userId + '|' + t.day))
  // Labor % needs history for every day the bar is open that week; a partial forecast against a full week of
  // wages would say 1,300%. Closed days need none.
  const openDays = days.filter(d => closeOn(hours, d) !== null)
  const knownOpen = openDays.filter(d => sales[d] !== null)
  const forecastComplete = openDays.length > 0 && knownOpen.length === openDays.length
  const salesTotal = forecastComplete ? knownOpen.reduce((n, d) => n + (sales[d] as number), 0) : null
  // What was actually worked (the time clock), per person per business day.
  const actual: Record<string, number> = {}
  for (const w of worked) {
    if (!w.userId || !w.clockIn) continue
    const d = businessDayOf(w.clockIn, tz)
    const h = ((w.clockOut ? w.clockOut.getTime() : now.getTime()) - w.clockIn.getTime()) / 3600000
    actual[w.userId + '|' + d] = Math.round(((actual[w.userId + '|' + d] || 0) + h) * 100) / 100
  }
  return {
    weekStart: start, days, tz,
    bar: Object.fromEntries(days.map(d => [d, { open: openOn(hours, d), close: closeOn(hours, d) }])),
    people: users.filter(u => u.isActive || shifts.some(s => s.userId === u.id)).map(u => ({
      ...(plan.people.find(x => x.userId === u.id) || { hours: 0, overtime: 0, wagesCents: rates.get(u.id) === null ? null : 0 }),
      userId: u.id, name: nameOf(u), hourlyCents: rates.get(u.id) ?? null, isActive: u.isActive,
    })),
    shifts: shifts.map(s => ({ ...s, name: names.get(s.userId) || '?', hours: hoursOf(s, tz), onTimeOff: approvedOff.has(s.userId + '|' + s.day) })),
    timeOff: timeOff.map(t => ({ ...t, name: names.get(t.userId) || '?' })),
    gaps: coverageGaps(hours, days, shifts, tz),
    overlaps: overlaps(shifts, tz).map(([a, b]) => ({ name: names.get(a.userId) || '?', day: b.day, a: (a as any).id, b: (b as any).id })),
    wagesCents: plan.wagesCents, salesForecast: sales, salesForecastCents: salesTotal, forecastDays: { known: knownOpen.length, open: openDays.length },
    laborPct: plan.wagesCents === null || !salesTotal ? null : Math.round((plan.wagesCents / salesTotal) * 1000) / 10,
    actual,
    published: week?.publishedAt ? { at: week.publishedAt, by: week.publishedByName } : null,
    unpublishedChanges: !!week?.changedAt && (!week.publishedAt || week.changedAt > week.publishedAt),
  }
}

async function checkTimes(companyId: string, day: string, startIn: unknown, endIn: unknown) {
  const hours = await hoursFor(companyId)
  let start = String(startIn || '').trim().toLowerCase(), end = String(endIn || '').trim().toLowerCase()
  if (start === 'open') { const o = openOn(hours, day); if (!o) throw new RotaError('The bar is closed that day.'); start = o }
  if (end === 'close') { const c = closeOn(hours, day); if (!c) throw new RotaError('The bar is closed that day; give an end time.'); end = c }
  if (!TIME.test(start) || !TIME.test(end)) throw new RotaError('Times look like 16:00.')
  if (start === end) throw new RotaError('A shift has to be longer than that.')
  return { start: start.padStart(5, '0'), end: end.padStart(5, '0') }
}

async function activePerson(companyId: string, userId: unknown) {
  const [u] = await db.select({ id: user.id, isActive: user.isActive }).from(user).where(and(eq(user.id, String(userId || '')), eq(user.companyId, companyId))).limit(1)
  if (!u || !u.isActive) throw new RotaError('Who is working it?', 404)
  return u.id
}

async function addScheduled(actor: Actor, b: Record<string, unknown>) {
  const day = String(b.day || '')
  if (!DAY.test(day)) throw new RotaError('Which day?')
  const userId = await activePerson(actor.companyId, b.userId)
  const t = await checkTimes(actor.companyId, day, b.start, b.end)
  const { tz } = await weekFor(actor.companyId, day)
  if (hoursOf({ userId, day, ...t }, tz) > 16) throw new RotaError('Over 16 hours is almost surely a mistake.')
  const [row] = await db.insert(barScheduleShift).values({ userId, day, ...t, position: clean(b.position, 30), note: clean(b.note, 120), createdByName: actor.name, companyId: actor.companyId }).returning()
  await touch(actor.companyId, day)
  return row
}

async function updateScheduled(actor: Actor, id: string, b: Record<string, unknown>) {
  const [s] = await db.select().from(barScheduleShift).where(and(eq(barScheduleShift.id, id), eq(barScheduleShift.companyId, actor.companyId))).limit(1)
  if (!s) throw new RotaError('That shift is gone.', 404)
  const day = b.day !== undefined ? String(b.day) : s.day
  if (!DAY.test(day)) throw new RotaError('Which day?')
  const t = await checkTimes(actor.companyId, day, b.start ?? s.start, b.end ?? s.end)
  const userId = b.userId !== undefined ? await activePerson(actor.companyId, b.userId) : s.userId
  const [row] = await db.update(barScheduleShift).set({ userId, day, ...t, position: b.position !== undefined ? clean(b.position, 30) : s.position, note: b.note !== undefined ? clean(b.note, 120) : s.note, updatedAt: new Date() })
    .where(eq(barScheduleShift.id, id)).returning()
  await touch(actor.companyId, s.day); if (day !== s.day) await touch(actor.companyId, day)
  return row
}

async function deleteScheduled(actor: Actor, id: string) {
  const [s] = await db.delete(barScheduleShift).where(and(eq(barScheduleShift.id, id), eq(barScheduleShift.companyId, actor.companyId))).returning()
  if (!s) throw new RotaError('That shift is gone.', 404)
  await touch(actor.companyId, s.day)
}

/** Copy one week's shifts onto another (same weekday, same times). Refuses to pile onto a week with shifts unless told to replace. */
async function copyWeek(actor: Actor, fromDay: string, toDay: string, replace: boolean) {
  const companyId = actor.companyId
  const from = await weekFor(companyId, fromDay), to = await weekFor(companyId, toDay)
  if (from.start === to.start) throw new RotaError('Pick a different week to copy from.')
  const src = await db.select().from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, from.days)))
  if (!src.length) throw new RotaError('That week has no shifts to copy.')
  const existing = await db.select({ id: barScheduleShift.id }).from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, to.days)))
  if (existing.length && !replace) throw new RotaError('This week already has shifts. Replace them?', 409)
  const active = new Set((await people(companyId)).filter(p => p.isActive).map(p => p.id))
  const offset = Math.round((new Date(to.start + 'T12:00:00Z').getTime() - new Date(from.start + 'T12:00:00Z').getTime()) / 86400000)
  await db.transaction(async (tx: any) => {
    if (existing.length) await tx.delete(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, to.days)))
    const rows = src.filter(s => active.has(s.userId)).map(s => ({ userId: s.userId, day: addDays(s.day, offset), start: s.start, end: s.end, position: s.position, note: s.note, createdByName: actor.name, companyId }))
    if (rows.length) await tx.insert(barScheduleShift).values(rows)
  })
  await touch(companyId, to.start)
  return (await db.select({ id: barScheduleShift.id }).from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), inArray(barScheduleShift.day, to.days)))).length
}

async function publishWeek(actor: Actor, day: string) {
  const w = await loadWeek(actor.companyId, day)
  const snapshot = w.shifts.map(s => ({ userId: s.userId, name: s.name, day: s.day, start: s.start, end: s.end, position: s.position, note: s.note }))
  const now = new Date()
  await db.insert(barScheduleWeek).values({ weekStart: w.weekStart, publishedAt: now, publishedByName: actor.name, snapshot, changedAt: now, companyId: actor.companyId })
    .onConflictDoUpdate({ target: [barScheduleWeek.companyId, barScheduleWeek.weekStart], set: { publishedAt: now, publishedByName: actor.name, snapshot, changedAt: now } })
  return { weekStart: w.weekStart, shifts: snapshot.length, gaps: w.gaps.length }
}

/** What staff see: the published copy of this week and next. */
async function publishedWeeks(companyId: string, day?: string | null) {
  const cur = await weekFor(companyId, day)
  const next = await weekFor(companyId, addDays(cur.start, 7))
  const rows = await db.select().from(barScheduleWeek).where(and(eq(barScheduleWeek.companyId, companyId), inArray(barScheduleWeek.weekStart, [cur.start, next.start])))
  const one = (w: { start: string; days: string[] }) => {
    const r = rows.find(x => x.weekStart === w.start)
    return { weekStart: w.start, days: w.days, published: !!r?.publishedAt, publishedAt: r?.publishedAt || null, shifts: (r?.snapshot as any[]) || [] }
  }
  return { tz: cur.tz, today: businessDayOf(new Date(), cur.tz), weeks: [one(cur), one(next)] }
}

// ─── Time off ───────────────────────────────────────────────────────────────
async function requestTimeOff(actor: Actor, dayIn: unknown, note: unknown) {
  const d = String(dayIn || '')
  if (!DAY.test(d)) throw new RotaError('Which day?')
  const { tz } = await weekFor(actor.companyId)
  if (d < businessDayOf(new Date(), tz)) throw new RotaError("That day's already gone.")
  const [dupe] = await db.select({ id: barTimeOff.id }).from(barTimeOff)
    .where(and(eq(barTimeOff.companyId, actor.companyId), eq(barTimeOff.userId, actor.id), eq(barTimeOff.day, d), inArray(barTimeOff.status, ['pending', 'approved']))).limit(1)
  if (dupe) throw new RotaError('You already asked for that day.', 409)
  const [row] = await db.insert(barTimeOff).values({ userId: actor.id, day: d, note: clean(note, 200), companyId: actor.companyId }).returning()
  return row
}

async function decideTimeOff(actor: Actor, id: string, status: unknown) {
  if (status !== 'approved' && status !== 'denied') throw new RotaError('Approve or deny?')
  const [row] = await db.update(barTimeOff).set({ status, decidedByName: actor.name, decidedAt: new Date() })
    .where(and(eq(barTimeOff.id, id), eq(barTimeOff.companyId, actor.companyId))).returning()
  if (!row) throw new RotaError('That request is gone.', 404)
  return row
}

/** The team's requests, newest day first; `onlyPending` is the home screen's "Time off to decide" (tileConditions.ts). */
async function timeOffRequests(companyId: string, onlyPending: boolean) {
  const rows = await db.select({ request: barTimeOff, firstName: user.firstName, lastName: user.lastName }).from(barTimeOff)
    .leftJoin(user, eq(barTimeOff.userId, user.id))
    .where(and(eq(barTimeOff.companyId, companyId), onlyPending ? pendingTimeOffCondition(barTimeOff) : undefined))
    .orderBy(asc(barTimeOff.day))
  return rows.map((r: any) => ({ ...r.request, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || '?' }))
}

async function myTimeOff(actor: Actor) {
  return db.select().from(barTimeOff).where(and(eq(barTimeOff.companyId, actor.companyId), eq(barTimeOff.userId, actor.id))).orderBy(asc(barTimeOff.day))
}

// ─── The time clock on the bar tablet ──────────────────────────────────────
// Five wrong PINs per signed-in tablet session per ten minutes.
const attempts = new Map<string, number[]>()
const WINDOW = 10 * 60 * 1000

/** Clock in or out the person whose till PIN this is (not whoever the tablet is signed in as). */
async function punchByPin(actor: Actor, rawPin: unknown) {
  const pin = String(rawPin ?? '').replace(/\D/g, '')
  if (pin.length < 4) throw new RotaError('Type your PIN.')
  const now = Date.now()
  const tries = (attempts.get(actor.id) || []).filter(x => now - x < WINDOW)
  if (tries.length >= 5) throw new RotaError('Too many wrong PINs. Wait a few minutes.', 429)
  const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, pinHash: user.pinHash })
    .from(user).where(and(eq(user.companyId, actor.companyId), eq(user.isActive, true), isNotNull(user.pinHash)))
  let who: (typeof rows)[number] | null = null
  for (const r of rows) if (r.pinHash && await Bun.password.verify(pin, r.pinHash)) { who = r; break }
  if (!who) { tries.push(now); attempts.set(actor.id, tries); throw new RotaError("That PIN didn't match anyone.") }
  const person = { userId: who.id, companyId: actor.companyId }
  const open = await clock.activeEntry(who.id, actor.companyId)
  const r = open ? await clock.clockOut(person) : await clock.clockIn(person, { description: 'Bar tablet' })
  if (!r.ok) throw new RotaError(r.error, r.status)
  if (r.discarded) return { name: nameOf(who), action: 'discarded' as const, message: r.message }
  return { name: nameOf(who), action: open ? 'out' as const : 'in' as const, hours: open ? Number(r.entry.hours) : 0 }
}

/** Who is on the clock right now (anyone past 16 hours probably forgot to clock out). */
async function onTheClock(companyId: string, now = new Date()) {
  const rows = await db.select({ userId: timeEntry.userId, clockIn: timeEntry.clockIn, firstName: user.firstName, lastName: user.lastName, email: user.email })
    .from(timeEntry).innerJoin(user, eq(user.id, timeEntry.userId))
    .where(and(eq(timeEntry.companyId, companyId), isNotNull(timeEntry.clockIn), isNull(timeEntry.clockOut))).orderBy(asc(timeEntry.clockIn))
  return rows.map((r: { clockIn: Date | null; firstName: string; lastName: string; email: string }) => ({ name: nameOf(r), since: r.clockIn, forgotten: now.getTime() - (r.clockIn as Date).getTime() > 16 * 3600000 }))
}

return {
  weekFor, loadWeek, addScheduled, updateScheduled, deleteScheduled, copyWeek, publishWeek, publishedWeeks, requestTimeOff, decideTimeOff, timeOffRequests,
  myTimeOff, punchByPin, onTheClock,
}
}
export type BarSchedule = ReturnType<typeof createBarSchedule>
