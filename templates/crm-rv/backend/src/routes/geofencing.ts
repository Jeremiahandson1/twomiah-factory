import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import geofencing from '../services/geofencing.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// GEOFENCE MANAGEMENT
// ============================================

// Get all geofences
app.get('/', async (c) => {
  const user = c.get('user') as any
  const active = c.req.query('active')
  const geofences = await geofencing.getGeofences(
    user.companyId,
    { active: active === 'false' ? false : active === 'all' ? null : true }
  )
  return c.json(geofences)
})

// Create geofence
app.post('/', requirePermission('settings:update'), async (c) => {
  const user = c.get('user') as any
  const { name, lat, lng, radius, jobId, projectId, address } = await c.req.json()

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400)
  }

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

  return c.json(geofence, 201)
})

// Update geofence
app.put('/:id', requirePermission('settings:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { name, lat, lng, radius, active } = await c.req.json()

  const updates: any = {}
  if (name !== undefined) updates.name = name
  if (lat !== undefined) updates.lat = parseFloat(lat)
  if (lng !== undefined) updates.lng = parseFloat(lng)
  if (radius !== undefined) updates.radius = parseInt(radius)
  if (active !== undefined) updates.active = active

  await geofencing.updateGeofence(id, user.companyId, updates)
  return c.json({ success: true })
})

// Delete geofence
app.delete('/:id', requirePermission('settings:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await geofencing.deleteGeofence(id, user.companyId)
  return c.body(null, 204)
})

// ============================================
// LOCATION TRACKING
// ============================================

// Process location update (main endpoint for mobile app)
app.post('/location', async (c) => {
  const user = c.get('user') as any
  const { lat, lng, accuracy } = await c.req.json()

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400)
  }

  // Check if user has location tracking enabled
  const settings = await geofencing.getLocationSettings(user.userId)

  if (!settings.locationTrackingEnabled) {
    return c.json({ actions: [], tracking: false })
  }

  const actions = await geofencing.processLocationUpdate(
    user.userId,
    user.companyId,
    { lat: parseFloat(lat), lng: parseFloat(lng), accuracy: parseFloat(accuracy) || 0 }
  )

  return c.json({ actions, tracking: true })
})

// Find nearest geofence
app.get('/nearest', async (c) => {
  const user = c.get('user') as any
  const lat = c.req.query('lat')
  const lng = c.req.query('lng')

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400)
  }

  const nearest = await geofencing.findNearestGeofence(
    user.companyId,
    parseFloat(lat),
    parseFloat(lng)
  )

  return c.json(nearest)
})

// Check if inside any geofence
app.get('/check', async (c) => {
  const user = c.get('user') as any
  const lat = c.req.query('lat')
  const lng = c.req.query('lng')

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400)
  }

  const geofences = await geofencing.getGeofences(user.companyId, { active: true })
  const inside: any[] = []

  for (const geofence of geofences) {
    if (geofencing.isInsideGeofence(parseFloat(lat), parseFloat(lng), geofence)) {
      inside.push({
        id: geofence.id,
        name: geofence.name,
        jobId: geofence.jobId,
        projectId: geofence.projectId,
      })
    }
  }

  return c.json({ inside, count: inside.length })
})

// ============================================
// USER SETTINGS
// ============================================

// Get location settings
app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const settings = await geofencing.getLocationSettings(user.userId)
  return c.json(settings)
})

// Update location settings
app.put('/settings', async (c) => {
  const user = c.get('user') as any
  const { locationTrackingEnabled, autoClockEnabled, locationAccuracy, trackingInterval } = await c.req.json()

  const settings = await geofencing.updateLocationSettings(user.userId, {
    locationTrackingEnabled,
    autoClockEnabled,
    locationAccuracy,
    trackingInterval,
  })

  return c.json(settings)
})

// ============================================
// HISTORY & REPORTS
// ============================================

// Get location history
app.get('/history', async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const limit = c.req.query('limit')

  const history = await geofencing.getLocationHistory(
    user.userId,
    user.companyId,
    { startDate, endDate, limit: parseInt(limit || '0') || 100 }
  )

  return c.json(history)
})

// Get geofence events
app.get('/events', async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const events = await geofencing.getGeofenceEvents(user.userId, {
    startDate,
    endDate,
  })

  return c.json(events)
})

// Admin: Get user's location history
app.get('/history/:userId', requirePermission('team:read'), async (c) => {
  const user = c.get('user') as any
  const userId = c.req.param('userId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const limit = c.req.query('limit')

  const history = await geofencing.getLocationHistory(
    userId,
    user.companyId,
    { startDate, endDate, limit: parseInt(limit || '0') || 100 }
  )

  return c.json(history)
})

export default app
