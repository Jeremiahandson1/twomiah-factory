import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { recurringRoute, recurringRouteStop, site, user } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

async function routeWithStops(routeId: string, companyId: string) {
  const [route] = await db.select().from(recurringRoute)
    .where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, companyId)))
  if (!route) return null
  const stops = await db.select({
    stop: recurringRouteStop,
    siteName: site.name,
    siteAddress: site.address,
    siteCity: site.city,
  })
    .from(recurringRouteStop)
    .leftJoin(site, eq(recurringRouteStop.siteId, site.id))
    .where(eq(recurringRouteStop.recurringRouteId, routeId))
    .orderBy(asc(recurringRouteStop.sortOrder))
  return {
    ...route,
    dayName: DAYS[route.dayOfWeek] ?? '',
    stops: stops.map(s => ({ ...s.stop, siteName: s.siteName, siteAddress: s.siteAddress, siteCity: s.siteCity })),
  }
}

// GET /api/recurring-routes?dayOfWeek=1  — list (board-friendly: includes stop count + minutes)
app.get('/', requirePermission('jobs:read'), async (c) => {
  const u = c.get('user') as any
  const dow = c.req.query('dayOfWeek')
  const where = dow != null && dow !== ''
    ? and(eq(recurringRoute.companyId, u.companyId), eq(recurringRoute.dayOfWeek, parseInt(dow, 10)))
    : eq(recurringRoute.companyId, u.companyId)
  const routes = await db.select().from(recurringRoute).where(where).orderBy(asc(recurringRoute.dayOfWeek))
  const stops = await db.select().from(recurringRouteStop).where(eq(recurringRouteStop.companyId, u.companyId))
  const data = routes.map(r => {
    const rs = stops.filter(s => s.recurringRouteId === r.id)
    return {
      ...r,
      dayName: DAYS[r.dayOfWeek] ?? '',
      stopCount: rs.length,
      estimatedMinutes: rs.reduce((t, s) => t + (s.estimatedMinutes || 0), 0),
      weeklyRevenue: Math.round(rs.reduce((t, s) => t + Number(s.pricePerVisit), 0) * 100) / 100,
    }
  })
  return c.json({ data })
})

// GET /api/recurring-routes/board — whole week, grouped by day
app.get('/board', requirePermission('jobs:read'), async (c) => {
  const u = c.get('user') as any
  const routes = await db.select().from(recurringRoute)
    .where(eq(recurringRoute.companyId, u.companyId)).orderBy(asc(recurringRoute.dayOfWeek))
  const stops = await db.select().from(recurringRouteStop).where(eq(recurringRouteStop.companyId, u.companyId))
  const board = DAYS.map((dayName, dayOfWeek) => {
    const dayRoutes = routes.filter(r => r.dayOfWeek === dayOfWeek).map(r => {
      const rs = stops.filter(s => s.recurringRouteId === r.id)
      return {
        ...r,
        stopCount: rs.length,
        estimatedMinutes: rs.reduce((t, s) => t + (s.estimatedMinutes || 0), 0),
        weeklyRevenue: Math.round(rs.reduce((t, s) => t + Number(s.pricePerVisit), 0) * 100) / 100,
      }
    })
    return { dayOfWeek, dayName, routes: dayRoutes }
  })
  return c.json({ data: board })
})

app.get('/:id', requirePermission('jobs:read'), async (c) => {
  const u = c.get('user') as any
  const route = await routeWithStops(c.req.param('id'), u.companyId)
  if (!route) return c.json({ error: 'Route not found' }, 404)
  return c.json(route)
})

app.post('/', requirePermission('jobs:create'), async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json()
  if (!body.name || body.dayOfWeek == null) return c.json({ error: 'name and dayOfWeek are required' }, 400)
  const [route] = await db.insert(recurringRoute).values({
    companyId: u.companyId,
    name: String(body.name),
    dayOfWeek: parseInt(body.dayOfWeek, 10),
    assignedToId: body.assignedToId ?? null,
    estimatedHours: String(body.estimatedHours ?? '0'),
    status: body.status ?? 'active',
    notes: body.notes ?? null,
  }).returning()
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'recurring_route', entityId: route.id, entityName: route.name, userId: u.userId, companyId: u.companyId })
  return c.json(route, 201)
})

app.put('/:id', requirePermission('jobs:update'), async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.name != null) patch.name = String(body.name)
  if (body.dayOfWeek != null) patch.dayOfWeek = parseInt(body.dayOfWeek, 10)
  if (body.assignedToId !== undefined) patch.assignedToId = body.assignedToId || null
  if (body.estimatedHours != null) patch.estimatedHours = String(body.estimatedHours)
  if (body.status) patch.status = body.status
  if (body.notes != null) patch.notes = body.notes
  const [route] = await db.update(recurringRoute).set(patch)
    .where(and(eq(recurringRoute.id, id), eq(recurringRoute.companyId, u.companyId)))
    .returning()
  if (!route) return c.json({ error: 'Route not found' }, 404)
  return c.json(route)
})

app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
  const u = c.get('user') as any
  await db.delete(recurringRoute)
    .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId)))
  return c.body(null, 204)
})

// ---- Stops ----

app.post('/:id/stops', requirePermission('jobs:update'), async (c) => {
  const u = c.get('user') as any
  const routeId = c.req.param('id')
  const body = await c.req.json()
  if (!body.siteId) return c.json({ error: 'siteId is required' }, 400)
  const [route] = await db.select().from(recurringRoute)
    .where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, u.companyId)))
  if (!route) return c.json({ error: 'Route not found' }, 404)
  const existing = await db.select().from(recurringRouteStop)
    .where(eq(recurringRouteStop.recurringRouteId, routeId))
  const [stop] = await db.insert(recurringRouteStop).values({
    companyId: u.companyId,
    recurringRouteId: routeId,
    siteId: String(body.siteId),
    contactId: body.contactId ?? null,
    serviceType: body.serviceType ?? 'mowing',
    sortOrder: body.sortOrder ?? existing.length,
    estimatedMinutes: parseInt(body.estimatedMinutes ?? '30', 10),
    pricePerVisit: String(body.pricePerVisit ?? '0'),
  }).returning()
  return c.json(stop, 201)
})

// Reorder stops: body = { stopIds: [id1, id2, ...] } in new order
app.put('/:id/stops/reorder', requirePermission('jobs:update'), async (c) => {
  const u = c.get('user') as any
  const routeId = c.req.param('id')
  const { stopIds } = await c.req.json()
  if (!Array.isArray(stopIds)) return c.json({ error: 'stopIds array required' }, 400)
  for (let i = 0; i < stopIds.length; i++) {
    await db.update(recurringRouteStop).set({ sortOrder: i })
      .where(and(
        eq(recurringRouteStop.id, stopIds[i]),
        eq(recurringRouteStop.recurringRouteId, routeId),
        eq(recurringRouteStop.companyId, u.companyId),
      ))
  }
  return c.json({ ok: true, reordered: stopIds.length })
})

app.delete('/:routeId/stops/:stopId', requirePermission('jobs:update'), async (c) => {
  const u = c.get('user') as any
  await db.delete(recurringRouteStop)
    .where(and(
      eq(recurringRouteStop.id, c.req.param('stopId')),
      eq(recurringRouteStop.companyId, u.companyId),
    ))
  return c.body(null, 204)
})

export default app
