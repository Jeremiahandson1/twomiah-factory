import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { canvassingSession, canvassingStop, canvassingScript, contact, job } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ==================== SESSIONS ====================

// GET /sessions — list sessions for company
app.get('/sessions', async (c) => {
  const { companyId } = c.get('user')
  const sessions = await db.select().from(canvassingSession)
    .where(eq(canvassingSession.companyId, companyId))
    .orderBy(desc(canvassingSession.createdAt))
  return c.json(sessions)
})

// POST /sessions — create new session
app.post('/sessions', async (c) => {
  const { companyId, userId } = c.get('user')
  const body = await c.req.json()
  const [session] = await db.insert(canvassingSession).values({
    companyId,
    userId,
    name: body.name || `Session — ${new Date().toLocaleDateString()}`,
    status: 'active',
    centerLat: body.centerLat || null,
    centerLng: body.centerLng || null,
    radiusMiles: body.radiusMiles || null,
    weatherEvent: body.weatherEvent || null,
    startedAt: new Date(),
  }).returning()
  return c.json(session, 201)
})

// GET /sessions/:id — session detail with all stops
app.get('/sessions/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const [session] = await db.select().from(canvassingSession)
    .where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId)))
    .limit(1)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const stops = await db.select().from(canvassingStop)
    .where(and(eq(canvassingStop.sessionId, id), eq(canvassingStop.companyId, companyId)))
    .orderBy(desc(canvassingStop.visitedAt))

  return c.json({ ...session, stops })
})

// PUT /sessions/:id — update session
app.put('/sessions/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const updates: any = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.status !== undefined) updates.status = body.status
  if (body.weatherEvent !== undefined) updates.weatherEvent = body.weatherEvent

  const [updated] = await db.update(canvassingSession).set(updates)
    .where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Session not found' }, 404)
  return c.json(updated)
})

// POST /sessions/:id/end — mark completed
app.post('/sessions/:id/end', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')

  // Calculate final stats
  const stops = await db.select().from(canvassingStop)
    .where(and(eq(canvassingStop.sessionId, id), eq(canvassingStop.companyId, companyId)))

  const totalDoors = stops.length
  const answeredDoors = stops.filter(s => s.outcome !== 'no_answer').length
  const leadsCreated = stops.filter(s => s.jobId).length

  const [updated] = await db.update(canvassingSession).set({
    status: 'completed',
    endedAt: new Date(),
    totalDoors,
    answeredDoors,
    leadsCreated,
    updatedAt: new Date(),
  }).where(and(eq(canvassingSession.id, id), eq(canvassingSession.companyId, companyId)))
    .returning()

  if (!updated) return c.json({ error: 'Session not found' }, 404)
  return c.json(updated)
})

// ==================== STOPS ====================

// POST /sessions/:sessionId/stops — log a door knock
app.post('/sessions/:sessionId/stops', async (c) => {
  const { companyId, userId } = c.get('user')
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json()

  // Verify session exists
  const [session] = await db.select().from(canvassingSession)
    .where(and(eq(canvassingSession.id, sessionId), eq(canvassingSession.companyId, companyId)))
    .limit(1)
  if (!session) return c.json({ error: 'Session not found' }, 404)

  let contactId: string | null = null
  let jobId: string | null = null

  // Create contact + job for interested / appointment_set
  if ((body.outcome === 'interested' || body.outcome === 'appointment_set') && (body.phone || body.email)) {
    const nameParts = (body.homeownerName || '').trim().split(' ')
    const firstName = nameParts[0] || 'Unknown'
    const lastName = nameParts.slice(1).join(' ') || ''

    const [newContact] = await db.insert(contact).values({
      companyId,
      firstName,
      lastName,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      leadSource: 'canvassing',
      propertyType: 'residential',
    }).returning()
    contactId = newContact.id

    // Build job notes with storm info
    let jobNotes = ''
    if (session.weatherEvent) {
      jobNotes = `Canvassing lead — ${session.weatherEvent} — ${session.name}`
    }
    if (body.notes) {
      jobNotes = jobNotes ? `${jobNotes}\n${body.notes}` : body.notes
    }

    // Count existing jobs for job number
    const existingJobs = await db.select({ id: job.id }).from(job)
      .where(eq(job.companyId, companyId))
    const jobNum = `ROOF-${String(existingJobs.length + 1).padStart(4, '0')}`

    const [newJob] = await db.insert(job).values({
      companyId,
      contactId: newContact.id,
      jobNumber: jobNum,
      jobType: 'insurance',
      status: 'lead',
      propertyAddress: body.address || '',
      city: body.city || '',
      state: body.state || '',
      zip: body.zip || '',
      source: 'canvassing',
      priority: body.outcome === 'appointment_set' ? 'high' : 'medium',
      inspectionDate: body.appointmentDate ? new Date(body.appointmentDate) : null,
      notes: jobNotes || null,
    }).returning()
    jobId = newJob.id
  }

  // Create stop
  const [stop] = await db.insert(canvassingStop).values({
    companyId,
    sessionId,
    userId,
    address: body.address || '',
    city: body.city || null,
    state: body.state || null,
    zip: body.zip || null,
    lat: body.lat || null,
    lng: body.lng || null,
    outcome: body.outcome || 'no_answer',
    notes: body.notes || null,
    jobId,
    contactId,
    doorHangerLeft: body.doorHangerLeft || false,
    followUpDate: body.followUpDate ? new Date(body.followUpDate) : null,
    photos: body.photos || [],
    visitedAt: new Date(),
  }).returning()

  // Update session counters
  const counterUpdates: any = {
    totalDoors: (session.totalDoors || 0) + 1,
    updatedAt: new Date(),
  }
  if (body.outcome !== 'no_answer') {
    counterUpdates.answeredDoors = (session.answeredDoors || 0) + 1
  }
  if (jobId) {
    counterUpdates.leadsCreated = (session.leadsCreated || 0) + 1
  }
  await db.update(canvassingSession).set(counterUpdates)
    .where(eq(canvassingSession.id, sessionId))

  return c.json({ ...stop, jobId, contactId }, 201)
})

// GET /sessions/:sessionId/stops — all stops for session
app.get('/sessions/:sessionId/stops', async (c) => {
  const { companyId } = c.get('user')
  const sessionId = c.req.param('sessionId')
  const stops = await db.select().from(canvassingStop)
    .where(and(eq(canvassingStop.sessionId, sessionId), eq(canvassingStop.companyId, companyId)))
    .orderBy(desc(canvassingStop.visitedAt))
  return c.json(stops)
})

// PUT /stops/:id — update a stop
app.put('/stops/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const updates: any = {}
  if (body.outcome !== undefined) updates.outcome = body.outcome
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.doorHangerLeft !== undefined) updates.doorHangerLeft = body.doorHangerLeft
  if (body.followUpDate !== undefined) updates.followUpDate = body.followUpDate ? new Date(body.followUpDate) : null
  if (body.photos !== undefined) updates.photos = body.photos

  const [updated] = await db.update(canvassingStop).set(updates)
    .where(and(eq(canvassingStop.id, id), eq(canvassingStop.companyId, companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Stop not found' }, 404)
  return c.json(updated)
})

// ==================== MAP DATA ====================

// GET /sessions/:sessionId/map — stops with lat/lng + outcome for map
app.get('/sessions/:sessionId/map', async (c) => {
  const { companyId } = c.get('user')
  const sessionId = c.req.param('sessionId')
  const stops = await db.select({
    id: canvassingStop.id,
    lat: canvassingStop.lat,
    lng: canvassingStop.lng,
    outcome: canvassingStop.outcome,
    address: canvassingStop.address,
    doorHangerLeft: canvassingStop.doorHangerLeft,
    jobId: canvassingStop.jobId,
    contactId: canvassingStop.contactId,
    notes: canvassingStop.notes,
    visitedAt: canvassingStop.visitedAt,
  }).from(canvassingStop)
    .where(and(eq(canvassingStop.sessionId, sessionId), eq(canvassingStop.companyId, companyId)))
  return c.json(stops)
})

// ==================== SCRIPTS ====================

// GET /scripts — list scripts
app.get('/scripts', async (c) => {
  const { companyId } = c.get('user')
  const scripts = await db.select().from(canvassingScript)
    .where(eq(canvassingScript.companyId, companyId))
    .orderBy(desc(canvassingScript.createdAt))
  return c.json(scripts)
})

// POST /scripts — create script
app.post('/scripts', async (c) => {
  const { companyId } = c.get('user')
  const body = await c.req.json()
  const [script] = await db.insert(canvassingScript).values({
    companyId,
    name: body.name || 'New Script',
    isDefault: body.isDefault || false,
    steps: body.steps || [],
  }).returning()
  return c.json(script, 201)
})

// PUT /scripts/:id — update script
app.put('/scripts/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const updates: any = { updatedAt: new Date() }
  if (body.name !== undefined) updates.name = body.name
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault
  if (body.steps !== undefined) updates.steps = body.steps

  const [updated] = await db.update(canvassingScript).set(updates)
    .where(and(eq(canvassingScript.id, id), eq(canvassingScript.companyId, companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Script not found' }, 404)
  return c.json(updated)
})

// DELETE /scripts/:id — delete (not if default)
app.delete('/scripts/:id', async (c) => {
  const { companyId } = c.get('user')
  const id = c.req.param('id')

  const [script] = await db.select().from(canvassingScript)
    .where(and(eq(canvassingScript.id, id), eq(canvassingScript.companyId, companyId)))
    .limit(1)
  if (!script) return c.json({ error: 'Script not found' }, 404)
  if (script.isDefault) return c.json({ error: 'Cannot delete the default script' }, 400)

  await db.delete(canvassingScript)
    .where(and(eq(canvassingScript.id, id), eq(canvassingScript.companyId, companyId)))
  return c.json({ success: true })
})

export default app
