// /api/routing: a route between two points, multi-stop ordering, a person's day, a navigation link, fuel cost, and
// the team's routes for a day. Moved from the CRM template's routes/routing.ts (templates/crm/backend/src/routes). The
// registry signs the person in; the template gated no feature and no screen calls it, so it is ungated. The template
// checked no permission on any action: the two that read people's days (a person's day, the team's routes — jobs and
// customers' addresses) ask jobs:read, the permission the job list itself asks (2026-10-19); the calculators carry no
// records and stay open to any signed-in seat.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { jobMoneyWithheld, withoutJobMoney } from '@twomiah/tenant-backend'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { createRoutingService } from './routingService.ts'

export function createRoutingRoutes(d: CrmDeps) {
  const { db } = d
  const routing = createRoutingService(d)
  const app = new Hono<AppEnv>()
  /**
   * A day's route carries each stop's whole job row, and every signed-in seat reaches these routes: the job's money is
   * withheld by the one rule (@twomiah/tenant-backend jobs/jobMoney.ts).
   */
  const shapeJobs = async (who: any, jobs: any[]) => withoutJobMoney(jobs, await jobMoneyWithheld(canSeeWith(d.permissions), who))

  app.post('/calculate', async (c) => {
    const { origin, destination } = await c.req.json()
    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return fail(c, 400, 'Origin and destination with lat/lng are required')
    }
    const route = await routing.getRoute(origin, destination)
    const fuelCost = routing.calculateFuelCost(route.distanceMiles)
    return one(c, { ...route, fuelCost })
  })

  app.post('/optimize', async (c) => {
    const { stops, startLocation } = await c.req.json()
    if (!stops || !Array.isArray(stops) || stops.length < 2) return fail(c, 400, 'At least 2 stops are required')
    const validStops = stops.filter((s: any) => s.lat && s.lng)
    if (validStops.length < 2) return fail(c, 400, 'Stops must have lat/lng coordinates')
    const result = await routing.optimizeRoute(validStops, startLocation)
    result.fuelCost = routing.calculateFuelCost(result.totalDistanceMiles)
    result.googleMapsUrl = routing.generateGoogleMapsUrl(result.optimizedOrder)
    return one(c, result)
  })

  app.get('/optimize-day', d.permissions.requirePermission('jobs:read'), async (c) => {
    const currentUser = c.get('user')
    const date = c.req.query('date')
    const targetDate = date ? new Date(date) : new Date()
    const targetUserId = c.req.query('userId') || currentUser.userId
    const day = await routing.optimizeDayRoute(currentUser.companyId, targetUserId, targetDate)
    return one(c, { ...day, jobs: await shapeJobs(currentUser, day.jobs) })
  })

  app.post('/navigation-url', async (c) => {
    const { stops } = await c.req.json()
    if (!stops || stops.length === 0) return fail(c, 400, 'Stops are required')
    return one(c, { url: routing.generateGoogleMapsUrl(stops) })
  })

  app.get('/fuel-cost', async (c) => {
    const miles = c.req.query('miles')
    const mpg = c.req.query('mpg')
    const fuelPrice = c.req.query('fuelPrice')
    if (!miles) return fail(c, 400, 'Miles parameter is required')
    return one(c, routing.calculateFuelCost(
      parseFloat(miles),
      mpg ? parseFloat(mpg) : undefined,
      fuelPrice ? parseFloat(fuelPrice) : undefined,
    ))
  })

  // The dispatcher's view: every active person's optimised day.
  app.get('/team-routes', d.permissions.requirePermission('jobs:read-all'), async (c) => {
    const currentUser = c.get('user')
    const date = c.req.query('date')
    const targetDate = date ? new Date(date) : new Date()

    const teamMembers = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName })
      .from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))

    const routes = await Promise.all(teamMembers.map(async (member: any) => {
      try {
        const result = await routing.optimizeDayRoute(currentUser.companyId, member.id, targetDate)
        return { user: member, ...result }
      } catch (error: any) {
        return { user: member, error: error.message }
      }
    }))

    // Only people with jobs.
    const withheld = await jobMoneyWithheld(canSeeWith(d.permissions), currentUser)
    const activeRoutes = routes.filter((r: any) => r.jobs?.length > 0).map((r: any) => ({ ...r, jobs: withoutJobMoney(r.jobs, withheld) }))
    return one(c, {
      date: targetDate.toISOString().split('T')[0],
      routes: activeRoutes,
      totalJobs: activeRoutes.reduce((sum: number, r: any) => sum + (r.jobs?.length || 0), 0),
      totalMiles: activeRoutes.reduce((sum: number, r: any) => sum + (r.optimizedRoute?.totalDistanceMiles || 0), 0),
    })
  })

  return app
}
