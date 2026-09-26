import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import routing from '../services/routing.ts'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'

const app = new Hono()
app.use('*', authenticate)

// Calculate route between two points
app.post('/calculate', async (c) => {
  const { origin, destination } = await c.req.json()

  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    return c.json({ error: 'Origin and destination with lat/lng are required' }, 400)
  }

  const route = await routing.getRoute(origin, destination)
  const fuelCost = routing.calculateFuelCost(route.distanceMiles)

  return c.json({
    ...route,
    fuelCost,
  })
})

// Optimize route for multiple stops
app.post('/optimize', async (c) => {
  const { stops, startLocation } = await c.req.json()

  if (!stops || !Array.isArray(stops) || stops.length < 2) {
    return c.json({ error: 'At least 2 stops are required' }, 400)
  }

  // Validate stops have coordinates
  const validStops = stops.filter((s: any) => s.lat && s.lng)
  if (validStops.length < 2) {
    return c.json({ error: 'Stops must have lat/lng coordinates' }, 400)
  }

  const result = await routing.optimizeRoute(validStops, startLocation)

  // Add fuel cost
  result.fuelCost = routing.calculateFuelCost(result.totalDistanceMiles)
  result.googleMapsUrl = routing.generateGoogleMapsUrl(result.optimizedOrder)

  return c.json(result)
})

// Optimize route for a specific day
app.get('/optimize-day', async (c) => {
  const currentUser = c.get('user') as any
  const date = c.req.query('date')
  const userId = c.req.query('userId')

  const targetDate = date ? new Date(date) : new Date()
  const targetUserId = userId || currentUser.userId

  const result = await routing.optimizeDayRoute(
    currentUser.companyId,
    targetUserId,
    targetDate,
    db
  )

  return c.json(result)
})

// Get Google Maps navigation URL
app.post('/navigation-url', async (c) => {
  const { stops } = await c.req.json()

  if (!stops || stops.length === 0) {
    return c.json({ error: 'Stops are required' }, 400)
  }

  const url = routing.generateGoogleMapsUrl(stops)
  return c.json({ url })
})

// Calculate fuel cost
app.get('/fuel-cost', async (c) => {
  const miles = c.req.query('miles')
  const mpg = c.req.query('mpg')
  const fuelPrice = c.req.query('fuelPrice')

  if (!miles) {
    return c.json({ error: 'Miles parameter is required' }, 400)
  }

  const cost = routing.calculateFuelCost(
    parseFloat(miles),
    mpg ? parseFloat(mpg) : undefined,
    fuelPrice ? parseFloat(fuelPrice) : undefined
  )

  return c.json(cost)
})

// Get team's routes for a day (dispatcher view)
app.get('/team-routes', async (c) => {
  const currentUser = c.get('user') as any
  const date = c.req.query('date')
  const targetDate = date ? new Date(date) : new Date()

  // Get all team members
  const teamMembers = await db.select({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
  }).from(user)
    .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))

  // Get optimized routes for each team member
  const routes = await Promise.all(
    teamMembers.map(async (member) => {
      try {
        const result = await routing.optimizeDayRoute(
          currentUser.companyId,
          member.id,
          targetDate,
          db
        )
        return {
          user: member,
          ...result,
        }
      } catch (error: any) {
        return {
          user: member,
          error: error.message,
        }
      }
    })
  )

  // Filter out users with no jobs
  const activeRoutes = routes.filter((r: any) => r.jobs?.length > 0)

  return c.json({
    date: targetDate.toISOString().split('T')[0],
    routes: activeRoutes,
    totalJobs: activeRoutes.reduce((sum, r: any) => sum + (r.jobs?.length || 0), 0),
    totalMiles: activeRoutes.reduce((sum, r: any) => sum + (r.optimizedRoute?.totalDistanceMiles || 0), 0),
  })
})

export default app
