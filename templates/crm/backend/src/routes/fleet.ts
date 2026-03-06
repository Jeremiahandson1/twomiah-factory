import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import fleet from '../services/fleet.ts'

const app = new Hono()
app.use('*', authenticate)

// Vehicles
app.get('/vehicles', async (c) => {
  const user = c.get('user') as any
  const query = c.req.query() as any
  const data = await fleet.getVehicles(user.companyId, query)
  return c.json(data)
})

app.get('/vehicles/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const vehicle = await fleet.getVehicle(id, user.companyId)
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404)
  return c.json(vehicle)
})

app.post('/vehicles', requirePermission('fleet:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const vehicle = await fleet.createVehicle(user.companyId, body)
  return c.json(vehicle, 201)
})

app.put('/vehicles/:id', requirePermission('fleet:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await fleet.updateVehicle(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/vehicles/:id/assign', requirePermission('fleet:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { userId } = await c.req.json()
  await fleet.assignVehicle(id, user.companyId, userId)
  return c.json({ success: true })
})

// Locations
app.get('/locations', async (c) => {
  const user = c.get('user') as any
  const data = await fleet.getFleetLocations(user.companyId)
  return c.json(data)
})

app.post('/vehicles/:id/location', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await fleet.updateLocation(id, user.companyId, body)
  return c.json({ success: true })
})

app.get('/vehicles/:id/location-history', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const query = c.req.query() as any
  const data = await fleet.getLocationHistory(id, user.companyId, query)
  return c.json(data)
})

// Trips
app.get('/trips', async (c) => {
  const user = c.get('user') as any
  const query = c.req.query() as any
  const data = await fleet.getTrips(user.companyId, query)
  return c.json(data)
})

app.post('/trips/start', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const trip = await fleet.startTrip(body.vehicleId, user.companyId, {
    ...body,
    userId: user.userId,
  })
  return c.json(trip, 201)
})

app.post('/trips/:id/end', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const trip = await fleet.endTrip(id, user.companyId, body)
  return c.json(trip)
})

// Maintenance
app.get('/maintenance-due', async (c) => {
  const user = c.get('user') as any
  const data = await fleet.getMaintenanceDue(user.companyId)
  return c.json(data)
})

app.post('/vehicles/:id/maintenance', requirePermission('fleet:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const record = await fleet.addMaintenance(id, user.companyId, body)
  return c.json(record, 201)
})

// Fuel
app.post('/vehicles/:id/fuel', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const entry = await fleet.addFuelEntry(id, user.companyId, body)
  return c.json(entry, 201)
})

app.get('/vehicles/:id/fuel-stats', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const query = c.req.query() as any
  const stats = await fleet.getFuelStats(id, user.companyId, query)
  return c.json(stats)
})

// Stats
app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const stats = await fleet.getFleetStats(user.companyId)
  return c.json(stats)
})

export default app
