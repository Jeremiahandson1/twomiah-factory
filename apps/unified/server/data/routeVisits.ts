// Route visits: the Route Board's stops made into dated jobs, so a route IS the crew's day (landscaping; the way Jobber,
// Service Autopilot and Yardbook run a weekly route). A visit is an ordinary job row — it shows on the Schedule, Crew View
// and the phone, is started and completed like any job, and keeps the stop it came from (job.recurring_route_stop_id).
// Raw SQL lives here (RULEBOOK §2); every function returns camelCase objects.
import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import { nextNumber } from '@twomiah/tenant-backend'
import { job, site, recurringRoute, recurringRouteStop } from '../db/schema/index.ts'

/** The most weeks one call makes: half a mowing season, so a mistake is quick to undo and the calendar stays readable. */
export const MAX_VISIT_WEEKS = 26

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const hhmmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The date every visit is stored on: UTC midnight, as the job routes store a scheduled day. */
const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
export const todayUtc = () => new Date().toISOString().slice(0, 10)

/** 'mulch_install' → 'Mulch install'. The stop's service, said the way the crew reads a job title. */
const serviceWords = (serviceType: string) => {
  const s = String(serviceType || 'mowing').replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The dates a route runs on, from `from`: the first one on or after it that falls on the route's weekday, then every week,
 * `weeks` of them. A route on Monday asked from a Wednesday starts the Monday after.
 */
export function routeDates(dayOfWeek: number, from: string, weeks: number): string[] {
  if (!DAY.test(from)) return []
  const start = dayDate(from)
  const ahead = (dayOfWeek - start.getUTCDay() + 7) % 7
  const out: string[] = []
  for (let i = 0; i < weeks; i++) {
    const d = new Date(start.getTime() + (ahead + i * 7) * 86_400_000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * The start time of each stop, in stop order: the first at the route's start time, each next one when the one before is
 * done. A stop with no minutes holds half an hour, as the board does.
 */
export function stopTimes(startTime: string, stops: Array<{ id: string; estimatedMinutes: number | null }>): Map<string, string> {
  const times = new Map<string, string>()
  let at = minutesOf(HHMM.test(startTime) ? startTime : '08:00')
  for (const s of stops) {
    times.set(s.id, hhmmOf(Math.min(at, 23 * 60 + 55)))
    at += s.estimatedMinutes && s.estimatedMinutes > 0 ? s.estimatedMinutes : 30
  }
  return times
}

const stopsInOrder = (db: any, companyId: string, routeId: string) =>
  db.select({ stop: recurringRouteStop, siteName: site.name, siteAddress: site.address, siteCity: site.city, siteState: site.state, siteZip: site.zip, siteContactId: site.contactId })
    .from(recurringRouteStop)
    .innerJoin(site, eq(recurringRouteStop.siteId, site.id))
    .where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId)))
    .orderBy(asc(recurringRouteStop.sortOrder), asc(recurringRouteStop.createdAt))

/**
 * Make the route's visits: for each of the next `weeks` days the route runs, one job per stop, in stop order, timed from
 * the route's start time, led by the route's crew. A stop that already has a visit that day — of any status, so a cancelled
 * one is not brought back — is left alone, so making visits twice adds nothing the second time. One transaction, under the
 * job routes' own lock, so the numbers are the ones every other job gets.
 */
export async function makeRouteVisits(
  db: any, companyId: string, userId: string | null,
  route: { id: string; dayOfWeek: number; startTime: string; assignedToId: string | null },
  opts: { from: string; weeks: number; until?: string },
) {
  const rows: any[] = await stopsInOrder(db, companyId, route.id)
  const dates = routeDates(route.dayOfWeek, opts.from, opts.weeks).filter((d) => !opts.until || d <= opts.until)
  if (!rows.length || !dates.length) return { made: [] as any[], alreadyThere: 0, dates }
  const times = stopTimes(route.startTime, rows.map((r) => r.stop))
  const stopIds = rows.map((r) => r.stop.id)

  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
    const have: Array<{ stopId: string | null; day: Date | null }> = await tx.select({ stopId: job.recurringRouteStopId, day: job.scheduledDate })
      .from(job)
      .where(and(eq(job.companyId, companyId), inArray(job.recurringRouteStopId, stopIds), inArray(job.scheduledDate, dates.map(dayDate))))
    const taken = new Set(have.map((h) => `${h.stopId}|${h.day ? h.day.toISOString().slice(0, 10) : ''}`))
    const made: any[] = []
    let alreadyThere = 0
    for (const date of dates) {
      for (const { stop, siteName, siteAddress, siteCity, siteState, siteZip, siteContactId } of rows) {
        if (taken.has(`${stop.id}|${date}`)) { alreadyThere++; continue }
        const number = await nextNumber(tx, job, job.number, job.companyId, companyId, { prefix: 'JOB', pad: 5 })
        const price = Number(stop.pricePerVisit)
        const [row] = await tx.insert(job).values({
          companyId, createdById: userId, number,
          title: `${serviceWords(stop.serviceType)} — ${siteName}`,
          status: 'scheduled',
          scheduledDate: dayDate(date),
          scheduledTime: times.get(stop.id),
          estimatedHours: String(Math.round(((stop.estimatedMinutes || 30) / 60) * 100) / 100),
          // What the stop earns per visit is what the visit is worth — the figure a bill and the job's profit start from.
          estimatedValue: price > 0 ? String(price) : null,
          contactId: stop.contactId ?? siteContactId,
          siteId: stop.siteId,
          address: siteAddress, city: siteCity, state: siteState, zip: siteZip,
          assignedToId: route.assignedToId,
          recurringRouteStopId: stop.id,
        }).returning()
        made.push(row)
      }
    }
    return { made, alreadyThere, dates }
  })
}

/**
 * Put a route's still-to-do visits back in the stop order and times the route now has — after a drag, a new start time or
 * a changed length. Only visits that are still just scheduled, today or later: a visit the crew has dispatched, started or
 * finished, and every one in the past, stays as it was.
 */
export async function retimeRouteVisits(db: any, companyId: string, routeId: string): Promise<number> {
  const [route] = await db.select().from(recurringRoute).where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, companyId))).limit(1)
  if (!route) return 0
  const rows: any[] = await stopsInOrder(db, companyId, routeId)
  if (!rows.length) return 0
  const times = stopTimes(route.startTime, rows.map((r) => r.stop))
  const open: any[] = await db.select({ id: job.id, stopId: job.recurringRouteStopId, time: job.scheduledTime }).from(job)
    .where(and(
      eq(job.companyId, companyId), eq(job.status, 'scheduled'),
      inArray(job.recurringRouteStopId, rows.map((r) => r.stop.id)),
      gte(job.scheduledDate, dayDate(todayUtc())),
    ))
  let changed = 0
  for (const v of open) {
    const time = times.get(v.stopId)
    if (!time || time === v.time) continue
    await db.update(job).set({ scheduledTime: time, updatedAt: new Date() }).where(and(eq(job.id, v.id), eq(job.companyId, companyId)))
    changed++
  }
  return changed
}

/**
 * A stop (or a whole route) that is taken off the board stops being visited: its visits still just scheduled, today or
 * later, are cancelled — kept and greyed on the calendar, not deleted, the way a stopped series is. Done and past ones stay.
 */
export async function cancelOpenVisits(db: any, companyId: string, stopIds: string[]): Promise<number> {
  if (!stopIds.length) return 0
  const gone = await db.update(job).set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(
      eq(job.companyId, companyId), eq(job.status, 'scheduled'),
      inArray(job.recurringRouteStopId, stopIds),
      gte(job.scheduledDate, dayDate(todayUtc())),
    )).returning({ id: job.id })
  return gone.length
}

/** A route's visits between two days, in day then stop order, with the stop's property. */
export async function visitsOfRoute(db: any, companyId: string, routeId: string, from: string, to: string) {
  const stopIds: string[] = (await db.select({ id: recurringRouteStop.id }).from(recurringRouteStop)
    .where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId)))).map((s: any) => s.id)
  if (!stopIds.length) return []
  return db.select({
    id: job.id, number: job.number, title: job.title, status: job.status, scheduledDate: job.scheduledDate, scheduledTime: job.scheduledTime,
    estimatedHours: job.estimatedHours, actualHours: job.actualHours, estimatedValue: job.estimatedValue, completedAt: job.completedAt,
    siteId: job.siteId, stopId: job.recurringRouteStopId, contactId: job.contactId,
  }).from(job)
    .where(and(
      eq(job.companyId, companyId), isNotNull(job.recurringRouteStopId), inArray(job.recurringRouteStopId, stopIds),
      gte(job.scheduledDate, dayDate(from)), sql`${job.scheduledDate} <= ${dayDate(to)}`,
    ))
    .orderBy(asc(job.scheduledDate), asc(job.scheduledTime))
}

/** How far ahead the daily top-up keeps a route's visits on the calendar: four weeks, as Yardbook and Jobber show. */
export const TOP_UP_DAYS = 28

/**
 * The rolling top-up: every active route that already has visits is extended so its visits reach `horizonDays` ahead. It
 * continues AFTER the route's last visit (never before), so a visit the owner deleted by hand is not made again, and a
 * route nobody has pressed "Make visits" on is left alone — the owner opts a route in by making its first visits. Safe to
 * run any number of times: a stop already visited that day is skipped by makeRouteVisits and by the database index.
 */
export async function topUpRouteVisits(
  db: any, opts: { now?: Date; horizonDays?: number; enabled?: (companyId: string) => Promise<boolean> } = {},
) {
  const now = opts.now ?? new Date()
  const horizonDays = opts.horizonDays ?? TOP_UP_DAYS
  const today = now.toISOString().slice(0, 10)
  const end = new Date(dayDate(today).getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10)
  const routes: any[] = await db.select().from(recurringRoute).where(eq(recurringRoute.status, 'active'))
  const out: Array<{ routeId: string; companyId: string; made: number }> = []
  const on = new Map<string, boolean>()
  for (const route of routes) {
    if (opts.enabled) {
      if (!on.has(route.companyId)) on.set(route.companyId, await opts.enabled(route.companyId))
      if (!on.get(route.companyId)) continue
    }
    const [last] = await db.select({ day: sql<Date | null>`max(${job.scheduledDate})`, by: sql<string | null>`max(${job.createdById})` }).from(job)
      .innerJoin(recurringRouteStop, eq(job.recurringRouteStopId, recurringRouteStop.id))
      .where(and(eq(recurringRouteStop.recurringRouteId, route.id), eq(job.companyId, route.companyId)))
    if (!last?.day) continue
    const lastDay = new Date(last.day).toISOString().slice(0, 10)
    const next = new Date(dayDate(lastDay).getTime() + 86_400_000).toISOString().slice(0, 10)
    const from = next > today ? next : today
    if (from > end) continue
    const weeks = Math.min(MAX_VISIT_WEEKS, Math.ceil((dayDate(end).getTime() - dayDate(from).getTime()) / (7 * 86_400_000)) + 1)
    const r = await makeRouteVisits(db, route.companyId, last.by ?? route.assignedToId ?? null, route, { from, weeks, until: end })
    if (r.made.length) out.push({ routeId: route.id, companyId: route.companyId, made: r.made.length })
  }
  return out
}
