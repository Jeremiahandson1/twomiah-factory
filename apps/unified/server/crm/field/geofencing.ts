// /api/geofencing: geofences, the mobile app's location updates (automatic clock in/out), the nearest and containing
// geofence, the person's tracking settings and the location / geofence history. Moved from the CRM template's
// routes/geofencing.ts (templates/crm/backend/src/routes). The registry signs the person in; the template gated no
// feature and no web screen calls it (the mobile app posts /location), so it is ungated. Permissions are the
// template's, action by action.
import { Hono } from 'hono'
import { and, eq, ne } from 'drizzle-orm'
import { geofence, job } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createGeofencingService } from './geofencingService.ts'

const all = <T,>(c: any, rows: T[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

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
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    if (jobId) { const p = await jobProblem(user.companyId, jobId); if (p) return fail(c, 409, p, 'geofence_job') }
    const geofence = await geofencing.createGeofence({
      companyId: user.companyId,
      name: name || 'Job Site',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius: radius ? parseInt(radius) : 100,
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
    const settings = await geofencing.updateLocationSettings(user.userId, { locationTrackingEnabled, autoClockEnabled, locationAccuracy, trackingInterval })
    return one(c, settings)
  })

  app.put('/:id', requirePermission('settings:update'), async (c) => {
    const user = c.get('user')
    const { name, lat, lng, radius, active, address, jobId } = await c.req.json()
    const updates: any = {}
    if (address !== undefined) updates.address = address || null
    if (jobId !== undefined) {
      if (jobId) { const p = await jobProblem(user.companyId, jobId, c.req.param('id')); if (p) return fail(c, 409, p, 'geofence_job') }
      updates.jobId = jobId || null
    }
    if (name !== undefined) updates.name = name
    if (lat !== undefined) updates.lat = parseFloat(lat)
    if (lng !== undefined) updates.lng = parseFloat(lng)
    if (radius !== undefined) updates.radius = parseInt(radius)
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
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    const settings = await geofencing.getLocationSettings(user.userId)
    if (!settings.locationTrackingEnabled) return one(c, { actions: [], tracking: false })
    const actions = await geofencing.processLocationUpdate(user.userId, user.companyId, {
      lat: parseFloat(lat), lng: parseFloat(lng), accuracy: parseFloat(accuracy) || 0,
    })
    return one(c, { actions, tracking: true })
  })

  // The template answered `null` with a 200 when the company has no active geofence; that is a 404 here.
  app.get('/nearest', async (c) => {
    const user = c.get('user')
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    const nearest = await geofencing.findNearestGeofence(user.companyId, parseFloat(lat), parseFloat(lng))
    if (!nearest) return fail(c, 404, 'No active geofence')
    return one(c, nearest)
  })

  app.get('/check', async (c) => {
    const user = c.get('user')
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    const geofences = await geofencing.getGeofences(user.companyId, { active: true })
    const inside: any[] = []
    for (const g of geofences) {
      if (geofencing.isInsideGeofence(parseFloat(lat), parseFloat(lng), g)) {
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
