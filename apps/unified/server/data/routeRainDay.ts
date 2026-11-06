// Rain day: push a day's open jobs (all of them, or one route's) forward a day, a week, or any number of days up to two weeks,
// and tell the customers — the way Yardbook's "push out multiple jobs at once" does, plus the text. Jobber's and Aspire's bulk
// moves send no notice (docs/parity/landscaping-rain-day.md). Nothing is re-ordered: each job keeps its time, so a route's
// stop order is the same on the new day. Raw SQL stays here (RULEBOOK §2).
import { and, desc, eq, gte, inArray, lt, sql, notInArray } from 'drizzle-orm'
import { job, contact, company, site, recurringRouteStop, scheduledText, landscapingSetting, rainDayRun } from '../db/schema/index.ts'
import { tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'

export const RAIN_SHIFT_MAX = 14
/** A rain day can cover a run of days ("this day through Friday", Yardbook shift by week): up to two weeks of days at once. */
export const RAIN_RANGE_MAX = 14
/** A push bigger than this runs in the background and emails the person when it is done (Yardbook). */
export const BACKGROUND_FROM = 150
/** Jobs the crew has not started: the ones a rain day can move. Started, done and cancelled jobs stay where they are. */
export const MOVABLE = ['scheduled', 'pending', 'confirmed', 'dispatched']
/** Texts go out between 8:00 and 20:00 on the business's clock; outside it they wait for the morning. */
export const TEXT_FROM = 8 * 60
export const TEXT_BEFORE = 20 * 60
/** A short pause before a text goes: the office can still cancel it from the contact's scheduled texts. */
export const TEXT_GRACE_MS = 2 * 60_000

const DAY_MS = 86_400_000
const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
const ymdOf = (d: Date) => d.toISOString().slice(0, 10)
const words = (ymd: string) => dayStart(ymd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

export interface RainDayOptions {
  date: string; shiftDays: number; routeId?: string | null; excludeJobIds?: string[]
  /** Land on Monday instead of a Sunday (the business setting; default on). Not applied to a push TO a chosen date. */
  skipSundays?: boolean
  /** The last day of a run of days to push, each by the same shift: "this day through Friday". */
  throughDate?: string | null
  /** Push the day's visits TO this date (Jobber's Move Visits: a source day and a target day), instead of by a number of days. */
  toDate?: string | null
}

/** The business's rain day switches. No saved row means the defaults: skip Sundays ON. */
export async function getRainDaySettings(db: any, companyId: string): Promise<{ skipSundays: boolean }> {
  const [row] = await db.select().from(landscapingSetting).where(eq(landscapingSetting.companyId, companyId)).limit(1)
  return { skipSundays: row ? row.rainDaySkipSundays : true }
}

export async function setRainDaySkipSundays(db: any, companyId: string, skipSundays: boolean): Promise<{ skipSundays: boolean }> {
  await db.insert(landscapingSetting).values({ companyId, rainDaySkipSundays: skipSundays })
    .onConflictDoUpdate({ target: landscapingSetting.companyId, set: { rainDaySkipSundays: skipSundays, updatedAt: new Date() } })
  return { skipSundays }
}

/** The days to push: what was asked for, plus one more when that would land on a Sunday and the business skips them. */
export function effectiveShift(date: string, shiftDays: number, skipSundays: boolean): { shiftDays: number; skippedSunday: boolean } {
  const lands = new Date(dayStart(date).getTime() + shiftDays * DAY_MS)
  return skipSundays && lands.getUTCDay() === 0 ? { shiftDays: shiftDays + 1, skippedSunday: true } : { shiftDays, skippedSunday: false }
}

/** The days a rain day covers: the one day, or each day from `date` through `throughDate`. */
export function rainDays(date: string, throughDate?: string | null): string[] {
  if (!throughDate || throughDate <= date) return [date]
  const out: string[] = []
  for (let t = dayStart(date).getTime(); t <= dayStart(throughDate).getTime() && out.length < RAIN_RANGE_MAX; t += DAY_MS) out.push(ymdOf(new Date(t)))
  return out
}

/** Where each day's visits land: a chosen date (exactly, as Jobber moves), or the day plus the shift (a Sunday skipped where set). */
export function landingFor(day: string, opts: RainDayOptions): { to: string; skippedSunday: boolean } {
  if (opts.toDate) return { to: opts.toDate, skippedSunday: false }
  const { shiftDays, skippedSunday } = effectiveShift(day, opts.shiftDays, opts.skipSundays === true)
  return { to: ymdOf(new Date(dayStart(day).getTime() + shiftDays * DAY_MS)), skippedSunday }
}

/**
 * Work out what a rain day would do — and, when `apply` is set, do it, in one transaction under the job lock, and keep a record
 * of it to undo (rain_day_run). Every day of the run is read at once and each visit moves by its own day's landing, so a week
 * pushed by a day moves Monday to Tuesday AND Tuesday to Wednesday, never Monday's twice.
 */
export async function rainDay(db: any, companyId: string, opts: RainDayOptions, apply: boolean, userId: string | null = null) {
  const days = opts.toDate ? [opts.date] : rainDays(opts.date, opts.throughDate)
  const landing = new Map(days.map((d) => [d, landingFor(d, opts)]))
  const skippedSunday = [...landing.values()].some((l) => l.skippedSunday)
  const firstTo = landing.get(days[0])!.to
  return db.transaction(async (tx: any) => {
    if (apply) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
    const from = dayStart(days[0]), until = new Date(dayStart(days[days.length - 1]).getTime() + DAY_MS)
    const where = [eq(job.companyId, companyId), inArray(job.status, MOVABLE), gte(job.scheduledDate, from), lt(job.scheduledDate, until)]
    if (opts.routeId) {
      const stops: string[] = (await tx.select({ id: recurringRouteStop.id }).from(recurringRouteStop)
        .where(and(eq(recurringRouteStop.recurringRouteId, opts.routeId), eq(recurringRouteStop.companyId, companyId)))).map((s: any) => s.id)
      if (!stops.length) return { moves: [], blocked: [], overlaps: [], moved: 0, toDate: firstTo, skippedSunday, runId: null }
      where.push(inArray(job.recurringRouteStopId, stops))
    }
    if (opts.excludeJobIds?.length) where.push(notInArray(job.id, opts.excludeJobIds))
    const rows: any[] = await tx.select({
      id: job.id, number: job.number, title: job.title, status: job.status, scheduledDate: job.scheduledDate, scheduledEndDate: job.scheduledEndDate,
      scheduledTime: job.scheduledTime, assignedToId: job.assignedToId, contactId: job.contactId, stopId: job.recurringRouteStopId, siteName: site.name,
    }).from(job).leftJoin(site, eq(job.siteId, site.id)).where(and(...where))
      .orderBy(job.scheduledDate, job.scheduledTime, job.number)
    const planned = rows.map((r) => {
      const day = ymdOf(new Date(r.scheduledDate))
      const to = (landing.get(day) ?? landing.get(days[0])!).to
      return { ...r, from: day, to, shiftMs: dayStart(to).getTime() - dayStart(day).getTime() }
    })
    const moving = new Set(planned.map((m) => m.id))
    const targets = [...new Set(planned.map((m) => m.to))]
    const span = () => ({ lo: dayStart(targets.reduce((a, b) => (a < b ? a : b))), hi: new Date(dayStart(targets.reduce((a, b) => (a > b ? a : b))).getTime() + DAY_MS) })
    // A route visit cannot land on a day its stop already has a visit (one visit per stop per day) — unless that visit is moving
    // away in the same push. Those stay, and are listed.
    const stopIds = [...new Set(planned.map((r) => r.stopId).filter(Boolean))] as string[]
    const taken = new Set<string>()
    if (stopIds.length && targets.length) {
      const { lo, hi } = span()
      const there: any[] = await tx.select({ id: job.id, stopId: job.recurringRouteStopId, day: job.scheduledDate }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.recurringRouteStopId, stopIds), sql`${job.status} <> 'cancelled'`, gte(job.scheduledDate, lo), lt(job.scheduledDate, hi)))
      for (const t of there) if (!moving.has(t.id)) taken.add(`${t.stopId}|${ymdOf(new Date(t.day))}`)
    }
    const moves: any[] = [], blocked: any[] = []
    for (const r of planned) {
      if (r.stopId && taken.has(`${r.stopId}|${r.to}`)) { blocked.push({ id: r.id, number: r.number, title: r.title, reason: `Already has a visit on ${words(r.to)}.` }); continue }
      moves.push(r)
    }
    // Not stopped, only warned: a person who already has something at that time on the new day.
    const overlaps: any[] = []
    const people = [...new Set(moves.map((m) => m.assignedToId).filter(Boolean))] as string[]
    if (people.length && targets.length) {
      const { lo, hi } = span()
      const there: any[] = await tx.select({ id: job.id, number: job.number, assignedToId: job.assignedToId, scheduledTime: job.scheduledTime, day: job.scheduledDate }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.status, MOVABLE), inArray(job.assignedToId, people), gte(job.scheduledDate, lo), lt(job.scheduledDate, hi)))
      for (const m of moves) {
        const clash = there.find((o) => !moving.has(o.id) && o.assignedToId === m.assignedToId && o.scheduledTime && o.scheduledTime === m.scheduledTime && ymdOf(new Date(o.day)) === m.to)
        if (clash) overlaps.push({ id: m.id, number: m.number, title: m.title, other: clash.number, time: m.scheduledTime })
      }
    }
    let moved = 0
    let runId: string | null = null
    if (apply) {
      const record: any[] = []
      for (const m of moves) {
        const toAt = new Date(new Date(m.scheduledDate).getTime() + m.shiftMs)
        const toEndAt = m.scheduledEndDate ? new Date(new Date(m.scheduledEndDate).getTime() + m.shiftMs) : null
        await tx.update(job).set({ scheduledDate: toAt, ...(toEndAt ? { scheduledEndDate: toEndAt } : {}), updatedAt: new Date() }).where(and(eq(job.id, m.id), eq(job.companyId, companyId)))
        record.push({ jobId: m.id, number: m.number, title: m.title, from: m.from, to: m.to, fromAt: new Date(m.scheduledDate).toISOString(), toAt: toAt.toISOString(), fromEndAt: m.scheduledEndDate ? new Date(m.scheduledEndDate).toISOString() : null, toEndAt: toEndAt ? toEndAt.toISOString() : null })
        moved++
      }
      const [run] = await tx.insert(rainDayRun).values({ companyId, userId, status: 'done', fromDate: days[0], throughDate: days.length > 1 ? days[days.length - 1] : null, toDate: opts.toDate ?? null, shiftDays: opts.toDate ? null : opts.shiftDays, routeId: opts.routeId ?? null, moves: record, moved, finishedAt: new Date() }).returning()
      runId = run.id
    }
    return { moves, blocked, overlaps, moved, toDate: firstTo, skippedSunday, runId }
  })
}

/** Keep the texts a run queued, so its undo can cancel the ones not yet sent. */
export async function noteRunTexts(db: any, companyId: string, runId: string, textIds: string[]) {
  await db.update(rainDayRun).set({ textIds }).where(and(eq(rainDayRun.id, runId), eq(rainDayRun.companyId, companyId)))
}

/** The business's recent rain days, newest first: what moved, whether it can still be undone. */
export async function rainDayRuns(db: any, companyId: string, limit = 20) {
  return db.select().from(rainDayRun).where(eq(rainDayRun.companyId, companyId)).orderBy(desc(rainDayRun.createdAt)).limit(limit)
}

/**
 * Undo a rain day: each visit still exactly where the push put it, and not started, goes back to where it was; a visit moved
 * again since, or started, stays and is listed. Its texts not yet sent are cancelled (the customers were not told). Once only.
 */
export async function undoRainDay(db: any, companyId: string, runId: string, userId: string | null) {
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
    const [run] = await tx.select().from(rainDayRun).where(and(eq(rainDayRun.id, runId), eq(rainDayRun.companyId, companyId))).limit(1).for('update')
    if (!run) return { error: 404 as const, why: 'Rain day not found' }
    if (run.status === 'undone') return { error: 409 as const, why: 'This rain day was undone already.' }
    if (run.status !== 'done') return { error: 409 as const, why: 'This rain day is still running. Undo it once it is done.' }
    const moves: any[] = Array.isArray(run.moves) ? run.moves : []
    const now: any[] = moves.length ? await tx.select({ id: job.id, status: job.status, scheduledDate: job.scheduledDate }).from(job).where(and(eq(job.companyId, companyId), inArray(job.id, moves.map((m) => m.jobId)))) : []
    const byId = new Map(now.map((j) => [j.id, j]))
    let back = 0
    const stayed: Array<{ number: string; title: string; reason: string }> = []
    for (const m of moves) {
      const j = byId.get(m.jobId)
      if (!j) { stayed.push({ number: m.number, title: m.title, reason: 'It was deleted.' }); continue }
      if (!MOVABLE.includes(j.status)) { stayed.push({ number: m.number, title: m.title, reason: 'It has been started or finished since.' }); continue }
      if (new Date(j.scheduledDate).toISOString() !== m.toAt) { stayed.push({ number: m.number, title: m.title, reason: 'It has been moved again since.' }); continue }
      await tx.update(job).set({ scheduledDate: new Date(m.fromAt), ...(m.fromEndAt ? { scheduledEndDate: new Date(m.fromEndAt) } : {}), updatedAt: new Date() }).where(and(eq(job.id, m.jobId), eq(job.companyId, companyId)))
      back++
    }
    const ids: string[] = Array.isArray(run.textIds) ? run.textIds : []
    const cancelled: any[] = ids.length ? await tx.update(scheduledText).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledText.companyId, companyId), inArray(scheduledText.id, ids), eq(scheduledText.status, 'scheduled'))).returning({ id: scheduledText.id }) : []
    await tx.update(rainDayRun).set({ status: 'undone', undoneAt: new Date(), undoneById: userId }).where(eq(rainDayRun.id, run.id))
    return { back, stayed, textsCancelled: cancelled.length, textsAlreadySent: ids.length - cancelled.length }
  })
}

/** A background run (a big push, Yardbook-style): its row first, `running`; the work's own record folded into it when done. */
export async function startRun(db: any, companyId: string, userId: string | null, opts: RainDayOptions) {
  const [run] = await db.insert(rainDayRun).values({ companyId, userId, status: 'running', fromDate: opts.date, throughDate: opts.throughDate ?? null, toDate: opts.toDate ?? null, shiftDays: opts.toDate ? null : opts.shiftDays, routeId: opts.routeId ?? null, moves: [] }).returning()
  return run
}
export async function finishRun(db: any, companyId: string, runId: string, done: { madeRun?: string | null; error?: string | null }) {
  if (done.error) { await db.update(rainDayRun).set({ status: 'failed', error: done.error, finishedAt: new Date() }).where(and(eq(rainDayRun.id, runId), eq(rainDayRun.companyId, companyId))); return }
  const [made] = done.madeRun ? await db.select().from(rainDayRun).where(eq(rainDayRun.id, done.madeRun)).limit(1) : []
  await db.update(rainDayRun).set({ status: 'done', moves: made?.moves ?? [], moved: made?.moved ?? 0, textIds: made?.textIds ?? null, finishedAt: new Date() }).where(and(eq(rainDayRun.id, runId), eq(rainDayRun.companyId, companyId)))
  if (made) await db.delete(rainDayRun).where(eq(rainDayRun.id, made.id))
}

/** When a text queued at `now` goes: after the grace, inside 8:00–20:00 on the business's clock, else the next 8:00. */
export function textTime(now: Date, timeZone: string): Date {
  const soon = new Date(now.getTime() + TEXT_GRACE_MS)
  const p = tzParts(soon, timeZone)
  if (p.minutes >= TEXT_FROM && p.minutes < TEXT_BEFORE) return soon
  const day = p.minutes < TEXT_FROM ? p.date : ymdOf(new Date(dayStart(p.date).getTime() + DAY_MS))
  return zonedWallTimeToUtc(day, '08:00', timeZone)
}

export const DEFAULT_RAIN_TEXT = "Hi {firstName}, this is {company}. Rain is keeping our crews off the job on {oldDay}, so we've moved {visits} to {newDay}. Reply here if that doesn't work for you."

const fill = (template: string, v: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m))

/** One text per customer for what moved, in their words. Nobody is texted twice; a customer with no phone or who opted out is listed, not texted. */
export async function rainDayTexts(db: any, companyId: string, moves: Array<{ contactId: string | null; title: string; from: string; to: string }>, template: string | null, now: Date, timeZone: string) {
  const by = new Map<string, typeof moves>()
  for (const m of moves) if (m.contactId) by.set(m.contactId, [...(by.get(m.contactId) ?? []), m])
  const noContact = moves.filter((m) => !m.contactId).length
  const texts: Array<{ contactId: string; name: string; toPhone: string; body: string; sendAt: Date }> = []
  const skipped: Array<{ contactId: string; name: string; reason: 'no_phone' | 'opted_out' }> = []
  if (!by.size) return { texts, skipped, noContact }
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const people: any[] = await db.select({ id: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile, optedOutSms: contact.optedOutSms })
    .from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, [...by.keys()])))
  const sendAt = textTime(now, timeZone)
  for (const p of people) {
    const phone = p.mobile || p.phone
    if (p.optedOutSms) { skipped.push({ contactId: p.id, name: p.name, reason: 'opted_out' }); continue }
    if (!phone) { skipped.push({ contactId: p.id, name: p.name, reason: 'no_phone' }); continue }
    const mine = by.get(p.id)!
    const visits = [...new Set(mine.map((m) => m.title.replace(' — ', ' at ')))]
    const list = visits.length <= 1 ? visits.join('') : `${visits.slice(0, -1).join(', ')} and ${visits[visits.length - 1]}`
    const body = fill(template?.trim() || DEFAULT_RAIN_TEXT, {
      firstName: String(p.name || '').trim().split(/\s+/)[0] || 'there', company: co?.name || 'your lawn crew',
      oldDay: words(mine[0].from), newDay: words(mine[0].to), visits: list,
    })
    texts.push({ contactId: p.id, name: p.name, toPhone: phone, body, sendAt })
  }
  return { texts, skipped, noContact }
}

/** Queue the texts as scheduled texts: the business's own number, the contact's opt-out and the usage wallet decide when they go (comms/scheduledTexts.ts). */
export async function queueRainDayTexts(db: any, companyId: string, userId: string | null, texts: Array<{ contactId: string; toPhone: string; body: string; sendAt: Date }>): Promise<string[]> {
  if (!texts.length) return []
  const rows: any[] = await db.insert(scheduledText).values(texts.map((t) => ({ companyId, contactId: t.contactId, toPhone: t.toPhone, body: t.body, sendAt: t.sendAt, createdById: userId }))).returning({ id: scheduledText.id })
  return rows.map((r) => r.id)
}

/** How many open visits each day from `first` through `last` holds (calendar-day markers) — what a rain-out would move. */
export async function openVisitsByDay(db: any, companyId: string, first: string, last: string): Promise<Map<string, number>> {
  const rows: any[] = await db.select({ day: sql<string>`to_char(${job.scheduledDate}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` }).from(job)
    .where(and(eq(job.companyId, companyId), inArray(job.status, MOVABLE), gte(job.scheduledDate, dayStart(first)), lt(job.scheduledDate, new Date(dayStart(last).getTime() + DAY_MS))))
    .groupBy(sql`to_char(${job.scheduledDate}, 'YYYY-MM-DD')`)
  return new Map(rows.map((r) => [r.day, Number(r.n)]))
}
