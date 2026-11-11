// "WHERE'S MY TECH" (parity tier 2 #7, 11/10 — ServiceTitan's and Jobber's live technician link; feature tech_tracking, not ready).
// The "on my way" text carries a private link (/on-the-way/<token>) to a page that shows where the tech is while they are on the way.
//   · The link is signed, not stored: the job and the moment it was made, so it needs no table and cannot be guessed. It opens
//     for TRACK_HOURS from then, and only while the job is on the way (dispatched); once the tech starts the job it says they
//     have arrived and shows no position; done, cancelled, moved back or expired, it says the visit is over.
//   · The position is the newest the tech's phone sent (POST /api/geofencing/location — only when the tech switched on "Share my
//     location while working") within FRESH_MINUTES; older, or none, and the page says they are on the way without a map. The lead
//     on the job if they have a login, else the first person on the crew who does (a roster member has no phone to send one).
//   · How far off they are: the drive from the tech's position to the job's map point, the same estimate the schedule uses for
//     travel between jobs (tenant-backend jobs/travel.ts travelMinutes — straight line at 30 mph), shown as "about N minutes".
// Public, no sign-in: the token is the key, and it opens one visit's arrival and nothing else of the customer's.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, isNotNull } from 'drizzle-orm'
import { travelMinutes } from '@twomiah/tenant-backend'
import { company, job, jobAssignee, locationLog, teamMember, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const TRACK_HOURS = 4
export const FRESH_MINUTES = 15
export const trackPathFor = (token: string) => `/on-the-way/${token}`

const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('tech-track-link').digest()
const sign = (body: string) => crypto.createHmac('sha256', key()).update('track|' + body).digest('base64url').slice(0, 24)

/** The link's key for this job, made now (the seconds since 1970, base 36, are part of what is signed). */
export function trackToken(jobId: string, now = new Date()): string {
  const body = `${jobId}.${Math.floor(now.getTime() / 1000).toString(36)}`
  return `${body}.${sign(body)}`
}

/** The job a key opens and when the key was made — or null for a key that is malformed or not ours. */
export function readTrackToken(token: string): { jobId: string; madeAt: Date } | null {
  const m = /^([A-Za-z0-9_-]{10,40})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{24})$/.exec(String(token || ''))
  if (!m) return null
  const a = Buffer.from(sign(`${m[1]}.${m[2]}`)), b = Buffer.from(m[3])
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  return { jobId: m[1], madeAt: new Date(parseInt(m[2], 36) * 1000) }
}

/** The absolute link for a text: the admin app's address (FRONTEND_URL, as a reminder's confirm link) — '' when none is set. */
export function trackUrlFor(jobId: string, now = new Date()): string {
  const base = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
  return base ? `${base}${trackPathFor(trackToken(jobId, now))}` : ''
}

export interface TrackView {
  companyName: string
  techName: string
  /** on_the_way: the tech is driving there; arrived: they started the job; over: done, cancelled, moved back or the link ran out. */
  state: 'on_the_way' | 'arrived' | 'over'
  /** Where the tech is, while on the way and only when their phone sent it lately. */
  tech: { lat: number; lng: number; minutesAgo: number } | null
  /** Where the job is, when it has a map point. */
  destination: { lat: number; lng: number } | null
  /** About how many minutes' drive the tech is from the job (both on the map), else null. */
  etaMinutes: number | null
}

export function createTechTrack(d: CrmDeps) {
  const { db } = d

  const firstName = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''

  /** The person whose phone is followed, and the name the customer is told. */
  async function whoIsComing(j: any): Promise<{ userId: string | null; name: string }> {
    if (j.assignedToId) {
      const [u] = await db.select({ f: user.firstName }).from(user).where(and(eq(user.id, j.assignedToId), eq(user.companyId, j.companyId))).limit(1)
      return { userId: j.assignedToId, name: firstName(u?.f) || 'Your technician' }
    }
    let name = 'Your technician'
    if (j.assignedToMemberId) {
      const [m] = await db.select({ name: teamMember.name }).from(teamMember).where(and(eq(teamMember.id, j.assignedToMemberId), eq(teamMember.companyId, j.companyId))).limit(1)
      name = firstName(m?.name) || name
    }
    const [helper] = await db.select({ userId: jobAssignee.userId }).from(jobAssignee).where(and(eq(jobAssignee.jobId, j.id), isNotNull(jobAssignee.userId))).orderBy(asc(jobAssignee.userId)).limit(1)
    return { userId: helper?.userId ?? null, name }
  }

  async function view(token: string, now = new Date()): Promise<TrackView | null> {
    const read = readTrackToken(token)
    if (!read) return null
    const [j] = await db.select().from(job).where(eq(job.id, read.jobId)).limit(1)
    if (!j) return null
    if (!(await d.features.isFeatureEnabled(j.companyId, 'tech_tracking'))) return null
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, j.companyId)).limit(1)
    const who = await whoIsComing(j)
    const fresh = now.getTime() - read.madeAt.getTime() <= TRACK_HOURS * 3_600_000 && read.madeAt.getTime() <= now.getTime() + 60_000
    const state: TrackView['state'] = !fresh ? 'over' : j.status === 'dispatched' ? 'on_the_way' : j.status === 'in_progress' ? 'arrived' : 'over'
    let tech: TrackView['tech'] = null
    if (state === 'on_the_way' && who.userId) {
      const since = new Date(now.getTime() - FRESH_MINUTES * 60_000)
      const [fix] = await db.select({ lat: locationLog.lat, lng: locationLog.lng, at: locationLog.timestamp }).from(locationLog)
        .where(and(eq(locationLog.companyId, j.companyId), eq(locationLog.userId, who.userId), gte(locationLog.timestamp, since)))
        .orderBy(desc(locationLog.timestamp)).limit(1)
      if (fix) tech = { lat: Number(fix.lat), lng: Number(fix.lng), minutesAgo: Math.max(0, Math.round((now.getTime() - new Date(fix.at).getTime()) / 60_000)) }
    }
    const destination = state !== 'over' && j.lat != null && j.lng != null ? { lat: Number(j.lat), lng: Number(j.lng) } : null
    const etaMinutes = tech && destination ? travelMinutes({ lat: tech.lat, lng: tech.lng }, { lat: destination.lat, lng: destination.lng }) : null
    return { companyName: co?.name || '', techName: who.name, state, tech, destination, etaMinutes }
  }

  /** /api/tech-track/:token — the page's one call (it asks again every 30 seconds while the tech is on the way). */
  const routes = new Hono<AppEnv>()
  routes.get('/:token', async (c) => {
    const v = await view(c.req.param('token'))
    if (!v) return fail(c, 404, 'This link is not valid any more.')
    return one(c, v)
  })

  return { view, routes }
}
