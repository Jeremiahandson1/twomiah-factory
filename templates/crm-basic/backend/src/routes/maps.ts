import { Hono } from 'hono'
import { eq, and, gte, lt, asc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, requireRole } from '../middleware/permissions.ts'
import geocoding from '../services/geocoding.ts'
import { db } from '../../db/index.ts'
import { job, project, contact, user } from '../../db/schema.ts'

const app = new Hono()
app.use('*', authenticate)

// Geocode an address
app.get('/geocode', requirePermission('jobs:read'), async (c) => {
  const address = c.req.query('address')

  if (!address) {
    return c.json({ error: 'Address required' }, 400)
  }

  const result = await geocoding.geocode(address)

  if (!result) {
    return c.json({ error: 'Address not found' }, 404)
  }

  return c.json(result)
})

// Reverse geocode coordinates
app.get('/reverse', requirePermission('jobs:read'), async (c) => {
  const latStr = c.req.query('lat')
  const lngStr = c.req.query('lng')

  if (!latStr || !lngStr) {
    return c.json({ error: 'lat and lng required' }, 400)
  }

  const result = await geocoding.reverseGeocode(parseFloat(latStr), parseFloat(lngStr))

  if (!result) {
    return c.json({ error: 'Location not found' }, 404)
  }

  return c.json(result)
})

// Get all job locations for map view
app.get('/jobs', requirePermission('jobs:read'), async (c) => {
  const userObj = c.get('user') as any
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

  // Map to location format, using project coords if job doesn't have them
  const locations = jobs.map((j) => {
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

  return c.json({
    total: locations.length,
    withCoordinates: locations.filter((l) => l.hasCoordinates).length,
    locations,
  })
})

// Get all project locations
app.get('/projects', requirePermission('projects:read'), async (c) => {
  const userObj = c.get('user') as any
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

  const locations = projects.map((p) => ({
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

  return c.json({
    total: locations.length,
    withCoordinates: locations.filter((l) => l.hasCoordinates).length,
    locations,
  })
})

// Geocode a specific job
app.post('/jobs/:jobId/geocode', requirePermission('jobs:update'), async (c) => {
  const userObj = c.get('user') as any
  const jobId = c.req.param('jobId')

  const [foundJob] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.companyId, userObj.companyId)))
    .limit(1)

  if (!foundJob) {
    return c.json({ error: 'Job not found' }, 404)
  }

  const updated = await geocoding.geocodeJob(jobId)

  if (!updated) {
    return c.json({ error: 'Could not geocode job address' }, 400)
  }

  return c.json({ lat: updated.lat, lng: updated.lng })
})

// Geocode a specific project
app.post('/projects/:projectId/geocode', requirePermission('projects:update'), async (c) => {
  const userObj = c.get('user') as any
  const projectId = c.req.param('projectId')

  const [foundProject] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.companyId, userObj.companyId)))
    .limit(1)

  if (!foundProject) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const updated = await geocoding.geocodeProject(projectId)

  if (!updated) {
    return c.json({ error: 'Could not geocode project address' }, 400)
  }

  return c.json({ lat: updated.lat, lng: updated.lng })
})

// Batch geocode all jobs (admin only)
app.post('/batch-geocode', requireRole('admin'), async (c) => {
  const userObj = c.get('user') as any
  const body = await c.req.json()
  const limit = body.limit || 20

  const results = await geocoding.geocodeAllJobs(userObj.companyId, Math.min(limit, 50))

  return c.json({
    processed: results.length,
    successful: results.filter((r: any) => r.success).length,
    results,
  })
})

// Calculate distance between two points
app.get('/distance', async (c) => {
  const lat1 = c.req.query('lat1')
  const lng1 = c.req.query('lng1')
  const lat2 = c.req.query('lat2')
  const lng2 = c.req.query('lng2')

  if (!lat1 || !lng1 || !lat2 || !lng2) {
    return c.json({ error: 'lat1, lng1, lat2, lng2 required' }, 400)
  }

  const distance = geocoding.calculateDistance(
    parseFloat(lat1),
    parseFloat(lng1),
    parseFloat(lat2),
    parseFloat(lng2)
  )

  return c.json({
    distance,
    unit: 'miles',
  })
})

function formatAddress(obj: any) {
  if (!obj) return null
  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean)
  return parts.length >= 2 ? parts.join(', ') : null
}

export default app
