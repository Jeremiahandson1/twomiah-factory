// /api/day-route: ONE PERSON'S DAY, IN THE BEST ORDER (2026-10-24: route optimise, as Jobber, Housecall Pro and
// ServiceTitan offer it from the schedule and the dispatch board). The optimiser itself is the one that was already
// here and wired to nothing a screen called (routingService.ts: nearest neighbour then 2-opt over the road router, the
// straight line when no router answers); this is its door for the Schedule's lanes and the Dispatch Board.
//
//   GET  /api/day-route?date=YYYY-MM-DD&userId=   the person's stops that day — the jobs they lead or are on
//        (tenant-backend jobs/onJob.ts), open, on the company's day — in the optimised order, with a Google Maps
//        directions link and the start times that order would give. NOTHING IS CHANGED: the screen shows the order and
//        asks before re-timing, which is POST /api/jobs/retime (the job routes' own overlap check, under their lock).
//   POST /api/day-route/locate { date }           puts that day's jobs on the map (the existing geocoding), at most ten
//        a call, so a route and the board's map have points to work with.
//
// Gated as the jobs are: the `jobs` feature, jobs:read to look, jobs:update to locate (it writes the job's point). A seat
// that reads only its own jobs (no jobs:read-all) asks only for its own day.
import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { job, user, teamMember } from '../../db/schema/index.ts'
import { openJobsOnDay } from '../../data/dayJobs.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { createRoutingService } from './routingService.ts'
import { createGeocodingService } from './geocodingService.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^(\d{1,2}):(\d{2})$/
const minutesOf = (hhmm?: string | null) => { const m = HHMM.exec(String(hhmm || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** A job with no estimated length holds an hour, as the double-booking check counts it (tenant-backend jobs.ts). */
const lengthOf = (hours: unknown) => { const h = Number(hours); return Number.isFinite(h) && h > 0 ? Math.max(1, Math.round(h * 60)) : 60 }
/** A day with no booked times starts at 8:00. */
const DEFAULT_START = 8 * 60

export function createDayRouteRoutes(d: CrmDeps) {
  const { db } = d
  const routing = createRoutingService(d)
  const geocoding = createGeocodingService(d)
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  /** Whose day: the asked-for person with jobs:read-all, else only the caller's own (null: refused). */
  const whoseDay = async (c: any): Promise<string | null> => {
    const u = c.get('user')
    const asked = c.req.query('userId') || u.userId
    if (asked === u.userId) return asked
    return (await canSee(u.role, 'jobs:read-all', u.userId)) ? asked : null
  }
  /** The open jobs on a company day, for one person or (null) everyone this seat reads (data/dayJobs.ts). */
  const dayJobs = (companyId: string, date: string, person: string | null, extra: any[] = []) => openJobsOnDay(db, companyId, date, person, extra)
  const nameOf = async (companyId: string, id: string) => {
    const [u] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
    if (u) return `${u.firstName || ''} ${u.lastName || ''}`.trim()
    const [m] = await db.select({ name: teamMember.name }).from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, companyId))).limit(1)
    return m?.name || null
  }

  app.get('/', d.permissions.requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const date = c.req.query('date') || ''
    if (!DAY.test(date)) return fail(c, 400, 'Pick the day to route (YYYY-MM-DD).')
    const person = await whoseDay(c)
    if (!person) return fail(c, 403, "You can route only your own day.")
    const rows: any[] = await dayJobs(u.companyId, date, person)
    // As booked: by start time, untimed last — the order the optimised one is compared with.
    const booked = rows.slice().sort((a, b) => (minutesOf(a.scheduledTime) ?? 1e9) - (minutesOf(b.scheduledTime) ?? 1e9))
    const placed = booked.filter((j) => j.lat != null && j.lng != null)
    const unplaced = booked.filter((j) => j.lat == null || j.lng == null).map((j) => ({ id: j.id, number: j.number, title: j.title, address: j.address, scheduledTime: j.scheduledTime }))
    const stop = (j: any) => ({ id: j.id, number: j.number, title: j.title, address: j.address, lat: Number(j.lat), lng: Number(j.lng), scheduledTime: j.scheduledTime ?? null, estimatedHours: j.estimatedHours ?? null })
    const base = { date, userId: person, name: await nameOf(u.companyId, person), unplaced }
    if (placed.length < 2) {
      return one(c, { ...base, stops: placed.map(stop), order: placed.map((j) => j.id), proposed: [], googleMapsUrl: null, totalMiles: 0, savings: null,
        message: placed.length === 0 ? 'None of this day’s jobs are on the map yet.' : 'Only one job on the map — nothing to reorder.' })
    }
    const result = await routing.optimizeRoute(placed.map(stop))
    const ordered: any[] = result.optimizedOrder
    // The new start times: from the day's first booked start (else 8:00), each stop after the one before plus the drive,
    // rounded up to five minutes. Shown, never saved here.
    const firstStart = Math.min(...placed.map((j) => minutesOf(j.scheduledTime) ?? Infinity))
    let at = Number.isFinite(firstStart) ? firstStart : DEFAULT_START
    const proposed: Array<{ id: string; scheduledTime: string; driveMinutes: number }> = []
    const legMinutes = (i: number) => Math.max(0, Number(result.legs?.[i]?.durationMinutes) || 0)
    ordered.forEach((s, i) => {
      if (i > 0) at = Math.ceil(at / 5) * 5
      proposed.push({ id: s.id, scheduledTime: hhmm(Math.min(at, 23 * 60 + 55)), driveMinutes: i === 0 ? 0 : legMinutes(i - 1) })
      at += lengthOf(s.estimatedHours) + legMinutes(i)
    })
    return one(c, {
      ...base,
      stops: ordered,
      order: ordered.map((s) => s.id),
      proposed,
      googleMapsUrl: routing.generateGoogleMapsUrl(ordered),
      totalMiles: Math.round((result.totalDistanceMiles || 0) * 10) / 10,
      savings: result.savings ? { miles: Math.round((result.savings.distanceMiles || 0) * 10) / 10, minutes: result.savings.timeMinutes || 0 } : null,
    })
  })

  app.post('/locate', d.permissions.requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const body: any = await c.req.json().catch(() => ({}))
    const date = String(body?.date || '')
    if (!DAY.test(date)) return fail(c, 400, 'Pick the day (YYYY-MM-DD).')
    const all = await canSee(u.role, 'jobs:read-all', u.userId)
    const missing: any[] = await dayJobs(u.companyId, date, all ? null : u.userId, [isNull(job.lat)])
    const located: string[] = []
    // Nominatim asks for one request a second; ten a call keeps a click quick, and the next call carries on.
    for (const [i, j] of missing.slice(0, 10).entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1100))
      const done = await geocoding.geocodeJob(j.id, u.companyId).catch(() => null)
      if (done?.lat != null) located.push(j.id)
    }
    return one(c, { located, remaining: Math.max(0, missing.length - located.length) })
  })

  return app
}
