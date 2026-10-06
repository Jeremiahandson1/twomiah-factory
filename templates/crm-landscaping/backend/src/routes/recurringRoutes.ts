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

/**
 * A ROUTE RUNS ON A DAY OF THE WEEK, AND THERE ARE SEVEN. (T58)
 *
 *   "Landscaping: the route day-of-week checks."
 *
 * dayOfWeek was `parseInt(body.dayOfWeek, 10)` on create, the same on edit, and the same again on the
 * list filter — three places, no validation in any of them. What that allows:
 *
 *   dayOfWeek: 9        stored. DAYS[9] is undefined, so dayName comes back '' — and the WEEK BOARD
 *                       builds itself by walking DAYS 0..6, so the route and every stop on it vanish
 *                       from the only screen a crew works off, while the row sits in the table. A
 *                       day's work disappearing is worse than a refusal.
 *   dayOfWeek: 'Monday' parseInt gives NaN, which is not caught by `== null`.
 *   dayOfWeek: -1       stored, same disappearance.
 *   ?dayOfWeek=abc      NaN into the WHERE clause.
 *
 * One parser for all three, so the filter cannot accept a day the writers refuse — and so the edit
 * path holds the same rule as create, which it did not.
 *
 * Returns null for anything that is not one of the seven. Callers decide whether that is a 400 (a
 * write) or "no filter" (a read), because those are different answers to a bad value: a query for a
 * day that does not exist should not silently return every route.
 */
const DAY_INDEX_HELP = 'dayOfWeek must be a whole number from 0 (Sunday) to 6 (Saturday)'
const dayIndex = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  // Number(), not parseInt(): parseInt('3days') is 3, and a route is not scheduled by a string that
  // happens to start with a digit.
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 6) return null
  return n
}

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
  // A filter that was ASKED FOR and is not a day is refused, rather than quietly becoming "all days".
  // Returning the whole week to a board that asked for Tuesday is the kind of wrong answer nobody
  // notices. An absent filter is still absent.
  if (dow != null && dow !== '' && dayIndex(dow) === null) {
    return c.json({ error: DAY_INDEX_HELP, code: 'BAD_DAY_OF_WEEK' }, 400)
  }
  const day = dayIndex(dow)
  const where = day !== null
    ? and(eq(recurringRoute.companyId, u.companyId), eq(recurringRoute.dayOfWeek, day))
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
  const withCounts = (r: any) => {
    const rs = stops.filter(s => s.recurringRouteId === r.id)
    return {
      ...r,
      stopCount: rs.length,
      estimatedMinutes: rs.reduce((t, s) => t + (s.estimatedMinutes || 0), 0),
      weeklyRevenue: Math.round(rs.reduce((t, s) => t + Number(s.pricePerVisit), 0) * 100) / 100,
    }
  }
  const board = DAYS.map((dayName, dayOfWeek) => ({
    dayOfWeek,
    dayName,
    routes: routes.filter(r => r.dayOfWeek === dayOfWeek).map(withCounts),
  }))

  /**
   * ROUTES ON NO DAY OF THE WEEK — shown, not swallowed. (T58)
   *
   * The write paths now refuse a dayOfWeek outside 0–6, but a fixed writer does nothing for rows
   * already stored: this board builds itself by walking DAYS 0..6, so a route sitting on day 9 (or on
   * NaN, which the old parseInt could produce) matched no column and simply was not on the screen,
   * with its stops and its weekly revenue. A crew's day missing from the only board they work off is
   * the worst version of this, because nothing says anything is wrong.
   *
   * So they come back in their own group, with a note the screen can show. An empty array when the
   * data is clean, which it is for every tenant that has only ever used the UI.
   */
  const stray = routes.filter(r => dayIndex(r.dayOfWeek) === null).map(withCounts)

  return c.json({
    data: board,
    ...(stray.length
      ? {
          unscheduled: stray,
          unscheduledNote: `${stray.length} ${stray.length === 1 ? 'route is' : 'routes are'} stored against a day that is not a day of the week, so ${stray.length === 1 ? 'it does' : 'they do'} not appear on any column above. Edit ${stray.length === 1 ? 'it' : 'them'} and pick a day.`,
        }
      : {}),
  })
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
  const day = dayIndex(body.dayOfWeek)
  if (day === null) return c.json({ error: DAY_INDEX_HELP, code: 'BAD_DAY_OF_WEEK' }, 400)
  const [route] = await db.insert(recurringRoute).values({
    companyId: u.companyId,
    name: String(body.name),
    dayOfWeek: day,
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
  // The same rule create holds. Moving a route to day 9 took it off the board just as surely as
  // creating it there, and this path had no check at all.
  if (body.dayOfWeek != null) {
    const day = dayIndex(body.dayOfWeek)
    if (day === null) return c.json({ error: DAY_INDEX_HELP, code: 'BAD_DAY_OF_WEEK' }, 400)
    patch.dayOfWeek = day
  }
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
