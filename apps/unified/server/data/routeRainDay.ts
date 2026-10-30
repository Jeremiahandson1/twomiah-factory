// Rain day: push a day's open jobs (all of them, or one route's) forward a day, a week, or any number of days up to two weeks,
// and tell the customers — the way Yardbook's "push out multiple jobs at once" does, plus the text. Jobber's and Aspire's bulk
// moves send no notice (docs/parity/landscaping-rain-day.md). Nothing is re-ordered: each job keeps its time, so a route's
// stop order is the same on the new day. Raw SQL stays here (RULEBOOK §2).
import { and, eq, gte, inArray, lt, sql, notInArray } from 'drizzle-orm'
import { job, contact, company, site, recurringRouteStop, scheduledText } from '../db/schema/index.ts'
import { tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'

export const RAIN_SHIFT_MAX = 14
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

export interface RainDayOptions { date: string; shiftDays: number; routeId?: string | null; excludeJobIds?: string[] }

/** Work out what a rain day would do — and, when `apply` is set, do it, in one transaction under the job lock. */
export async function rainDay(db: any, companyId: string, opts: RainDayOptions, apply: boolean) {
  return db.transaction(async (tx: any) => {
    if (apply) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
    const from = dayStart(opts.date)
    const where = [eq(job.companyId, companyId), inArray(job.status, MOVABLE), gte(job.scheduledDate, from), lt(job.scheduledDate, new Date(from.getTime() + DAY_MS))]
    if (opts.routeId) {
      const stops: string[] = (await tx.select({ id: recurringRouteStop.id }).from(recurringRouteStop)
        .where(and(eq(recurringRouteStop.recurringRouteId, opts.routeId), eq(recurringRouteStop.companyId, companyId)))).map((s: any) => s.id)
      if (!stops.length) return { moves: [], blocked: [], overlaps: [], moved: 0, toDate: ymdOf(new Date(from.getTime() + opts.shiftDays * DAY_MS)) }
      where.push(inArray(job.recurringRouteStopId, stops))
    }
    if (opts.excludeJobIds?.length) where.push(notInArray(job.id, opts.excludeJobIds))
    const rows: any[] = await tx.select({
      id: job.id, number: job.number, title: job.title, status: job.status, scheduledDate: job.scheduledDate, scheduledEndDate: job.scheduledEndDate,
      scheduledTime: job.scheduledTime, assignedToId: job.assignedToId, contactId: job.contactId, stopId: job.recurringRouteStopId, siteName: site.name,
    }).from(job).leftJoin(site, eq(job.siteId, site.id)).where(and(...where))
      .orderBy(job.scheduledTime, job.number)

    const shiftMs = opts.shiftDays * DAY_MS
    const toDate = ymdOf(new Date(from.getTime() + shiftMs))
    // A route visit cannot land on a day its stop already has a visit (one visit per stop per day): the next week's mow is
    // already there, so a week's push of Monday's would double it. Those stay, and are listed.
    const stopIds = [...new Set(rows.map((r) => r.stopId).filter(Boolean))] as string[]
    const taken = new Set<string>()
    if (stopIds.length) {
      const there: any[] = await tx.select({ stopId: job.recurringRouteStopId, day: job.scheduledDate }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.recurringRouteStopId, stopIds), gte(job.scheduledDate, dayStart(toDate)), lt(job.scheduledDate, new Date(dayStart(toDate).getTime() + DAY_MS))))
      for (const t of there) taken.add(t.stopId)
    }
    const moves: any[] = [], blocked: any[] = []
    for (const r of rows) {
      if (r.stopId && taken.has(r.stopId)) { blocked.push({ id: r.id, number: r.number, title: r.title, reason: `Already has a visit on ${words(toDate)}.` }); continue }
      moves.push({ ...r, from: opts.date, to: toDate })
    }
    // Not stopped, only warned: a person who already has something at that time on the new day.
    const overlaps: any[] = []
    const people = [...new Set(moves.map((m) => m.assignedToId).filter(Boolean))] as string[]
    if (people.length) {
      const moving = new Set(moves.map((m) => m.id))
      const there: any[] = await tx.select({ id: job.id, number: job.number, assignedToId: job.assignedToId, scheduledTime: job.scheduledTime }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.status, MOVABLE), inArray(job.assignedToId, people), gte(job.scheduledDate, dayStart(toDate)), lt(job.scheduledDate, new Date(dayStart(toDate).getTime() + DAY_MS))))
      for (const m of moves) {
        const clash = there.find((o) => !moving.has(o.id) && o.assignedToId === m.assignedToId && o.scheduledTime && o.scheduledTime === m.scheduledTime)
        if (clash) overlaps.push({ id: m.id, number: m.number, title: m.title, other: clash.number, time: m.scheduledTime })
      }
    }
    let moved = 0
    if (apply) {
      for (const m of moves) {
        await tx.update(job).set({
          scheduledDate: new Date(new Date(m.scheduledDate).getTime() + shiftMs),
          ...(m.scheduledEndDate ? { scheduledEndDate: new Date(new Date(m.scheduledEndDate).getTime() + shiftMs) } : {}),
          updatedAt: new Date(),
        }).where(and(eq(job.id, m.id), eq(job.companyId, companyId)))
        moved++
      }
    }
    return { moves, blocked, overlaps, moved, toDate }
  })
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
export async function queueRainDayTexts(db: any, companyId: string, userId: string | null, texts: Array<{ contactId: string; toPhone: string; body: string; sendAt: Date }>) {
  if (!texts.length) return 0
  await db.insert(scheduledText).values(texts.map((t) => ({ companyId, contactId: t.contactId, toPhone: t.toPhone, body: t.body, sendAt: t.sendAt, createdById: userId })))
  return texts.length
}
