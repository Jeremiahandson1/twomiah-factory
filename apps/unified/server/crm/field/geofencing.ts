// /api/geofencing: geofences, the mobile app's location updates (automatic clock in/out), the nearest and containing
// geofence, the person's tracking settings and the location / geofence history. Moved from the CRM template's
// routes/geofencing.ts (templates/crm/backend/src/routes). The registry signs the person in; the template gated no
// feature and no web screen calls it (the mobile app posts /location), so it is ungated. Permissions are the
// template's, action by action.
import { Hono } from 'hono'
import { and, eq, ne } from 'drizzle-orm'
import { geofence, job } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createGeofencingService } from './geofencingService.ts'
import { crewLocations } from '../../data/crewLocations.ts'
import { num, pointProblem } from '../../core/geo.ts'

const all = <T,>(c: any, rows: T[]) => listAll(c, rows)

/**
 * A point on the Earth and a fence around it, by one rule for every door that takes them (create, edit, the phone's
 * location, nearest, check): latitude −90…90, longitude −180…180, radius 25–500 m (the Geofences page's own slider).
 * Latitude 999, radius −5 and radius 99,999,999 were all saved (live test 2026-10-22). Numbers only — "12abc" is not
 * 12 — and 0 is a real latitude (the template's `!lat` refused the equator).
 */
export const GEOFENCE_RADIUS = { min: 25, max: 500 } as const
export function radiusProblem(radius: unknown): string | null {
  const r = num(radius)
  return Number.isInteger(r) && r >= GEOFENCE_RADIUS.min && r <= GEOFENCE_RADIUS.max ? null : `Radius must be a whole number of metres between ${GEOFENCE_RADIUS.min} and ${GEOFENCE_RADIUS.max}.`
}

export function createGeofencingRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const geofencing = createGeofencingService(d)
  const app = new Hono<AppEnv>()

  // ── geofences ──────────────────────────────────────────────────────────────────────────────────

  app.get('/', async (c) => {
    const user = c.get('user')
    const active = c.req.query('active')
    return all(c, await geofencing.getGeofences(user.companyId, { active: active === 'false' ? false : active === 'all' ? null : true }))
  })

  /**
   * A fence may name a job of this company that has no fence yet (geofence.job_id is unique): said plainly, instead
   * of the database's refusal. The template's edit never read the job or the address at all, so changing either on
   * the Geofences screen saved nothing.
   */
  const jobProblem = async (companyId: string, jobId: string, exceptFenceId?: string) => {
    const [j] = await d.db.select({ id: job.id }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!j) return 'That job was not found.'
    const [other] = await d.db.select({ id: geofence.id, name: geofence.name }).from(geofence)
      .where(and(eq(geofence.jobId, jobId), ...(exceptFenceId ? [ne(geofence.id, exceptFenceId)] : []))).limit(1)
    return other ? `That job already has a geofence ("${other.name}"); edit that one instead.` : null
  }

  app.post('/', requirePermission('settings:update'), async (c) => {
    const user = c.get('user')
    const { name, lat, lng, radius, jobId, projectId, address } = await c.req.json()
    const bad = pointProblem(lat, lng) ?? (radius != null && radius !== '' ? radiusProblem(radius) : null)
    if (bad) return fail(c, 400, bad)
    if (jobId) { const p = await jobProblem(user.companyId, jobId); if (p) return fail(c, 409, p, 'geofence_job') }
    const geofence = await geofencing.createGeofence({
      companyId: user.companyId,
      name: name || 'Job Site',
      lat: num(lat),
      lng: num(lng),
      radius: radius != null && radius !== '' ? num(radius) : 100,
      jobId,
      projectId,
      address,
    })
    return one(c, geofence, 201)
  })

  // ABOVE PUT /:id, which would otherwise take "settings" for a geofence id (the template's T38).
  app.put('/settings', async (c) => {
    const user = c.get('user')
    const { locationTrackingEnabled, autoClockEnabled, locationAccuracy, trackingInterval } = await c.req.json()
    // The switches are switches; the interval is seconds between fixes; the accuracy one of the phone's three modes.
    // Each was written as sent — a string into the integer column was a 500 (sweep 2026-10-22).
    for (const [k, v] of [['locationTrackingEnabled', locationTrackingEnabled], ['autoClockEnabled', autoClockEnabled]] as const) {
      if (v !== undefined && typeof v !== 'boolean') return fail(c, 400, `${k} must be true or false.`)
    }
    if (trackingInterval !== undefined && !(Number.isInteger(num(trackingInterval)) && num(trackingInterval) >= 10 && num(trackingInterval) <= 3600)) {
      return fail(c, 400, 'Tracking interval must be a whole number of seconds between 10 and 3600.')
    }
    if (locationAccuracy !== undefined && !['high', 'balanced', 'low'].includes(locationAccuracy)) return fail(c, 400, 'Location accuracy must be high, balanced or low.')
    const settings = await geofencing.updateLocationSettings(user.userId, { locationTrackingEnabled, autoClockEnabled, locationAccuracy, trackingInterval: trackingInterval === undefined ? undefined : num(trackingInterval) })
    return one(c, settings)
  })

  app.put('/:id', requirePermission('settings:update'), async (c) => {
    const user = c.get('user')
    const { name, lat, lng, radius, active, address, jobId } = await c.req.json()
    // A move gives both halves of the point; either one alone is checked against the other's range.
    const bad = (lat !== undefined || lng !== undefined ? pointProblem(lat === undefined ? 0 : lat, lng === undefined ? 0 : lng) : null) ?? (radius !== undefined ? radiusProblem(radius) : null)
    if (bad) return fail(c, 400, bad)
    const updates: any = {}
    if (address !== undefined) updates.address = address || null
    if (jobId !== undefined) {
      if (jobId) { const p = await jobProblem(user.companyId, jobId, c.req.param('id')); if (p) return fail(c, 409, p, 'geofence_job') }
      updates.jobId = jobId || null
    }
    if (name !== undefined) updates.name = name
    if (lat !== undefined) updates.lat = num(lat)
    if (lng !== undefined) updates.lng = num(lng)
    if (radius !== undefined) updates.radius = num(radius)
    if (active !== undefined) updates.active = active
    await geofencing.updateGeofence(c.req.param('id'), user.companyId, updates)
    return done(c)
  })

  // The template answered 204 with no body; the rulebook's reply for an action with nothing to return is done().
  app.delete('/:id', requirePermission('settings:update'), async (c) => {
    const user = c.get('user')
    await geofencing.deleteGeofence(c.req.param('id'), user.companyId)
    return done(c)
  })

  // ── location tracking ──────────────────────────────────────────────────────────────────────────

  /** The mobile app's location update; nothing happens unless the person has tracking switched on. */
  app.post('/location', async (c) => {
    const user = c.get('user')
    const { lat, lng, accuracy } = await c.req.json()
    const bad = pointProblem(lat, lng)
    if (bad) return fail(c, 400, bad)
    const settings = await geofencing.getLocationSettings(user.userId)
    if (!settings.locationTrackingEnabled) return one(c, { actions: [], tracking: false })
    const actions = await geofencing.processLocationUpdate(user.userId, user.companyId, {
      lat: num(lat), lng: num(lng), accuracy: Math.max(0, num(accuracy) || 0),
    }, { autoClock: !!settings.autoClockEnabled })
    // The person hears about an automatic clock in or out on their phone (it happened in their pocket).
    for (const a of actions) {
      const title = a.type === 'clock_in' ? 'Clocked in' : 'Clocked out'
      const body = a.type === 'clock_in' ? `You arrived at ${a.geofence}` : `You left ${a.geofence}${a.hours ? ` — ${a.hours} h` : ''}`
      void d.phonePush.send(user.companyId, [user.userId], { title, body, data: { type: 'time_entry', id: a.entryId } })
    }
    return one(c, { actions, tracking: true })
  })

  // The template answered `null` with a 200 when the company has no active geofence; that is a 404 here.
  app.get('/nearest', async (c) => {
    const user = c.get('user')
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    const bad = pointProblem(lat, lng)
    if (bad) return fail(c, 400, bad)
    const nearest = await geofencing.findNearestGeofence(user.companyId, num(lat), num(lng))
    if (!nearest) return fail(c, 404, 'No active geofence')
    return one(c, nearest)
  })

  app.get('/check', async (c) => {
    const user = c.get('user')
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    const bad = pointProblem(lat, lng)
    if (bad) return fail(c, 400, bad)
    const geofences = await geofencing.getGeofences(user.companyId, { active: true })
    const inside: any[] = []
    for (const g of geofences) {
      if (geofencing.isInsideGeofence(num(lat), num(lng), g)) {
        inside.push({ id: g.id, name: g.name, jobId: g.jobId, projectId: g.projectId })
      }
    }
    return one(c, { inside, count: inside.length })
  })

  // ── the person's settings ──────────────────────────────────────────────────────────────────────

  app.get('/settings', async (c) => {
    const user = c.get('user')
    return one(c, await geofencing.getLocationSettings(user.userId))
  })

  // ── history ────────────────────────────────────────────────────────────────────────────────────

  app.get('/history', async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit')
    return all(c, await geofencing.getLocationHistory(user.userId, user.companyId, {
      startDate: c.req.query('startDate'), endDate: c.req.query('endDate'), limit: parseInt(limit || '0') || 100,
    }))
  })

  app.get('/events', async (c) => {
    const user = c.get('user')
    return all(c, await geofencing.getGeofenceEvents(user.userId, { startDate: c.req.query('startDate'), endDate: c.req.query('endDate') }))
  })

  // Where's the crew: each person sharing their location (their own switch), their latest spot, and whether they are on
  // the clock — for the office (team:read). Nobody who has not switched tracking on is listed.
  app.get('/crew', requirePermission('team:read'), async (c) => {
    const user = c.get('user')
    const rows = await crewLocations(d.db, user.companyId)
    return listAll(c, rows)
  })

  // Someone else's location history: team:read.
  app.get('/history/:userId', requirePermission('team:read'), async (c) => {
    const user = c.get('user')
    const limit = c.req.query('limit')
    return all(c, await geofencing.getLocationHistory(c.req.param('userId'), user.companyId, {
      startDate: c.req.query('startDate'), endDate: c.req.query('endDate'), limit: parseInt(limit || '0') || 100,
    }))
  })

  return app
}
