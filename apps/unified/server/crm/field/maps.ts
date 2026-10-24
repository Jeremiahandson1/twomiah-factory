// /api/maps: geocoding, the job and project pins for the map view, coordinate fill-ins and distance. Moved from the
// CRM template's routes/maps.ts (templates/crm/backend/src/routes). The registry signs the person in; the template
// gated no feature and no screen calls it, so it is ungated. Permissions are the template's, action by action.
import { Hono } from 'hono'
import { and, asc, count, eq, gte, lt } from 'drizzle-orm'
import { job, project, contact, user, company, website } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createGeocodingService } from './geocodingService.ts'

/** "address, city, state, zip" when at least two parts are known. */
function formatAddress(obj: any) {
  if (!obj) return null
  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean)
  return parts.length >= 2 ? parts.join(', ') : null
}

export function createMapsRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, requireRole } = d.permissions
  const geocoding = createGeocodingService(d)
  const app = new Hono<AppEnv>()

  app.get('/geocode', requirePermission('jobs:read'), async (c) => {
    const address = c.req.query('address')
    if (!address) return fail(c, 400, 'Address required')
    const result = await geocoding.geocode(address, c.get('user').companyId)
    if (!result) return fail(c, 404, 'Address not found')
    return one(c, result)
  })

  app.get('/reverse', requirePermission('jobs:read'), async (c) => {
    const latStr = c.req.query('lat')
    const lngStr = c.req.query('lng')
    if (!latStr || !lngStr) return fail(c, 400, 'lat and lng required')
    const result = await geocoding.reverseGeocode(parseFloat(latStr), parseFloat(lngStr), c.get('user').companyId)
    if (!result) return fail(c, 404, 'Location not found')
    return one(c, result)
  })

  // Every job's location for the map, using the project's coordinates when the job has none.
  // Every job on one map is the whole business: jobs:read-all (a crew seat reads only its own — 2026-10-24).
  app.get('/jobs', requirePermission('jobs:read-all'), async (c) => {
    const userObj = c.get('user')
    const status = c.req.query('status')
    const assignedTo = c.req.query('assignedTo')
    const date = c.req.query('date')
    const projectId = c.req.query('projectId')

    const conditions: any[] = [eq(job.companyId, userObj.companyId)]
    if (status) conditions.push(eq(job.status, status))
    if (assignedTo) conditions.push(eq(job.assignedToId, assignedTo))
    if (projectId) conditions.push(eq(job.projectId, projectId))
    if (date) {
      const targetDate = new Date(date)
      const nextDate = new Date(targetDate)
      nextDate.setDate(nextDate.getDate() + 1)
      conditions.push(gte(job.scheduledDate, targetDate))
      conditions.push(lt(job.scheduledDate, nextDate))
    }

    const jobs = await db
      .select({
        id: job.id,
        number: job.number,
        title: job.title,
        status: job.status,
        priority: job.priority,
        scheduledDate: job.scheduledDate,
        address: job.address,
        city: job.city,
        state: job.state,
        zip: job.zip,
        lat: job.lat,
        lng: job.lng,
        projectName: project.name,
        projectAddress: project.address,
        projectCity: project.city,
        projectState: project.state,
        projectLat: project.lat,
        projectLng: project.lng,
        contactName: contact.name,
        contactAddress: contact.address,
        contactCity: contact.city,
        contactState: contact.state,
        assignedFirstName: user.firstName,
        assignedLastName: user.lastName,
      })
      .from(job)
      .leftJoin(project, eq(job.projectId, project.id))
      .leftJoin(contact, eq(job.contactId, contact.id))
      .leftJoin(user, eq(job.assignedToId, user.id))
      .where(and(...conditions))
      .orderBy(asc(job.scheduledDate))

    const locations = jobs.map((j: any) => {
      const jobLat = j.lat || j.projectLat
      const jobLng = j.lng || j.projectLng
      const addr = formatAddress({ address: j.address, city: j.city, state: j.state, zip: j.zip })
        || formatAddress({ address: j.projectAddress, city: j.projectCity, state: j.projectState })
        || formatAddress({ address: j.contactAddress, city: j.contactCity, state: j.contactState })
      return {
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        priority: j.priority,
        scheduledDate: j.scheduledDate,
        address: addr,
        lat: jobLat,
        lng: jobLng,
        hasCoordinates: !!(jobLat && jobLng),
        projectName: j.projectName,
        contactName: j.contactName,
        assignedTo: j.assignedFirstName ? `${j.assignedFirstName} ${j.assignedLastName}` : null,
      }
    })

    return one(c, {
      total: locations.length,
      withCoordinates: locations.filter((l: any) => l.hasCoordinates).length,
      locations,
    })
  })

  app.get('/projects', requirePermission('projects:read'), async (c) => {
    const userObj = c.get('user')
    const status = c.req.query('status')
    const conditions: any[] = [eq(project.companyId, userObj.companyId)]
    if (status) conditions.push(eq(project.status, status))

    const projects = await db
      .select({
        id: project.id,
        number: project.number,
        name: project.name,
        status: project.status,
        address: project.address,
        city: project.city,
        state: project.state,
        zip: project.zip,
        lat: project.lat,
        lng: project.lng,
        contactName: contact.name,
        jobCount: count(job.id),
      })
      .from(project)
      .leftJoin(contact, eq(project.contactId, contact.id))
      .leftJoin(job, eq(job.projectId, project.id))
      .where(and(...conditions))
      .groupBy(project.id, contact.name)
      .orderBy(asc(project.name))

    const locations = projects.map((p: any) => ({
      id: p.id,
      number: p.number,
      title: p.name,
      status: p.status,
      address: formatAddress(p),
      lat: p.lat,
      lng: p.lng,
      hasCoordinates: !!(p.lat && p.lng),
      contactName: p.contactName,
      jobCount: p.jobCount,
    }))

    return one(c, {
      total: locations.length,
      withCoordinates: locations.filter((l: any) => l.hasCoordinates).length,
      locations,
    })
  })

  app.post('/jobs/:jobId/geocode', requirePermission('jobs:update'), async (c) => {
    const userObj = c.get('user')
    const jobId = c.req.param('jobId')
    const [foundJob] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, userObj.companyId))).limit(1)
    if (!foundJob) return fail(c, 404, 'Job not found')
    const updated = await geocoding.geocodeJob(jobId, userObj.companyId)
    if (!updated) return fail(c, 400, 'Could not geocode job address')
    return one(c, { lat: updated.lat, lng: updated.lng })
  })

  app.post('/projects/:projectId/geocode', requirePermission('projects:update'), async (c) => {
    const userObj = c.get('user')
    const projectId = c.req.param('projectId')
    const [foundProject] = await db.select().from(project).where(and(eq(project.id, projectId), eq(project.companyId, userObj.companyId))).limit(1)
    if (!foundProject) return fail(c, 404, 'Project not found')
    const updated = await geocoding.geocodeProject(projectId, userObj.companyId)
    if (!updated) return fail(c, 400, 'Could not geocode project address')
    return one(c, { lat: updated.lat, lng: updated.lng })
  })

  // Batch geocode the company's jobs (admin and above, as the template had it).
  app.post('/batch-geocode', requireRole('admin'), async (c) => {
    const userObj = c.get('user')
    const body = await c.req.json()
    const limit = body.limit || 20
    const results = await geocoding.geocodeAllJobs(userObj.companyId, Math.min(limit, 50))
    return one(c, {
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      results,
    })
  })

  app.get('/distance', async (c) => {
    const lat1 = c.req.query('lat1')
    const lng1 = c.req.query('lng1')
    const lat2 = c.req.query('lat2')
    const lng2 = c.req.query('lng2')
    if (!lat1 || !lng1 || !lat2 || !lng2) return fail(c, 400, 'lat1, lng1, lat2, lng2 required')
    const distance = geocoding.calculateDistance(parseFloat(lat1), parseFloat(lng1), parseFloat(lat2), parseFloat(lng2))
    return one(c, { distance, unit: 'miles' })
  })

  return app
}

/**
 * Where a new map opens: the business's own address, else the places it serves (its website's service areas, read with
 * the business's state). Every Leaflet map opened on Dallas — the template's fallback — whatever the business's town
 * (landscaping live retest, 2026-10-24). Answers { lat: null, lng: null } when nothing on record places it, and the
 * screen then shows the whole country rather than a guess. Mounted on its own, ungated by map_view: the fleet map, the
 * canvassing board and the storm map each need it. Geocoded through the same cached service as the map view.
 */
export function createMapCenterRoutes(d: CrmDeps) {
  const geocoding = createGeocodingService(d)
  const app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    const companyId = c.get('user').companyId
    const [co] = await d.db.select({ address: company.address, city: company.city, state: company.state, zip: company.zip }).from(company).where(eq(company.id, companyId)).limit(1)
    const tries: string[] = []
    if (co && (co.city || co.zip)) tries.push([co.address, co.city, [co.state, co.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))
    const [site] = await d.db.select({ serviceAreas: website.serviceAreas }).from(website).where(eq(website.companyId, companyId)).limit(1)
    for (const a of (Array.isArray(site?.serviceAreas) ? site!.serviceAreas as any[] : []).slice(0, 2)) {
      const name = typeof a === 'string' ? a : String(a?.name || a?.city || a?.title || '')
      if (name.trim()) tries.push(co?.state && !name.includes(',') ? `${name.trim()}, ${co.state}` : name.trim())
    }
    for (const q of tries) {
      const found = await geocoding.geocode(q, companyId)
      if (found) return one(c, { lat: found.lat, lng: found.lng, from: q })
    }
    return one(c, { lat: null, lng: null, from: null })
  })
  return app
}
