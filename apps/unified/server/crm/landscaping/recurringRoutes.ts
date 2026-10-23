// The Route Board: named per-weekday crew routes ("Monday Route A") and their property stops in visit order. Moved from
// templates/crm-landscaping/backend/src/routes/recurringRoutes.ts. The registry signs the person in and applies the
// 'recurring_routes' gate. A mow route IS recurring work, so it asks the jobs verbs.
import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { recurringRoute, recurringRouteStop, site } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { readNumber, type NumberRule } from '../../http/numberInput.ts'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Named for the control on the screen, not the key in the payload (T58c): nothing on the Route Board is labelled
 * dayOfWeek. The accepted values are still spelled out, because that is the part that helps.
 */
const DAY_INDEX_HELP = 'Pick the day this route runs — Sunday (0) through Saturday (6).'
const NAME_HELP = 'Give the route a name — it is what the crew sees on the board.'

/**
 * Hours must be a number, on both paths (T58c): a non-number reached the decimal column and 500'd. A blank box is no
 * estimate yet — 0 — on both paths: the create kept the '' (`?? '0'` lets it through) and Postgres refused it as "One of
 * the values is not in a valid format." (live test 2026-10-22). One reader for every number box (http/numberInput.ts).
 */
const HOURS: NumberRule = { label: 'Estimated hours', blank: 0, min: 0, max: 24, example: '2.5' }
const hoursOf = (value: unknown) => {
  const r = readNumber(value, HOURS)
  return r.error && Number(value) > 24 ? { error: 'A route cannot take more than 24 hours in a day. Split it across days instead.' } : r
}
/** A stop's minutes: blank is the half hour the form starts with. */
const MINUTES: NumberRule = { label: 'Minutes at the stop', blank: 30, min: 0, max: 24 * 60, integer: true, example: '30' }

/**
 * A route runs on one of the seven days (T58). One parser for create, edit and the list filter, so the filter cannot
 * accept a day the writers refuse. Number(), not parseInt(): parseInt('3days') is 3. Null for anything else; callers
 * decide whether that is a 400 (a write, a filter that was asked for) or "no filter" (absent).
 */
const dayIndex = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 6) return null
  return n
}

const withoutPrice = <T extends Record<string, any>>(s: T): Omit<T, 'pricePerVisit'> => {
  const { pricePerVisit: _price, ...rest } = s
  return rest
}

export function createRecurringRouteRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * What a route earns is the books, not the round (T62: "route cards show weekly revenue ($55)"). The price per visit
   * and the week's total are money, invoices:read, which staff do not hold. Withheld (absent, not 0) from the list,
   * the board, a route's stops and a stop just added, so the card cannot print "$0".
   */
  const maySeeMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId)) } catch { return false }
  }

  async function routeWithStops(routeId: string, companyId: string) {
    const [route] = await db.select().from(recurringRoute)
      .where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, companyId)))
    if (!route) return null
    const stops = await db.select({ stop: recurringRouteStop, siteName: site.name, siteAddress: site.address, siteCity: site.city })
      .from(recurringRouteStop)
      .leftJoin(site, eq(recurringRouteStop.siteId, site.id))
      .where(eq(recurringRouteStop.recurringRouteId, routeId))
      .orderBy(asc(recurringRouteStop.sortOrder))
    return {
      ...route,
      dayName: DAYS[route.dayOfWeek] ?? '',
      stops: stops.map((s: any) => ({ ...s.stop, siteName: s.siteName, siteAddress: s.siteAddress, siteCity: s.siteCity })),
    }
  }

  const counted = (stops: any[], money: boolean) => (r: any) => {
    const rs = stops.filter((s) => s.recurringRouteId === r.id)
    return {
      ...r,
      stopCount: rs.length,
      estimatedMinutes: rs.reduce((t, s) => t + (s.estimatedMinutes || 0), 0),
      ...(money ? { weeklyRevenue: Math.round(rs.reduce((t, s) => t + Number(s.pricePerVisit), 0) * 100) / 100 } : {}),
    }
  }

  // GET /api/recurring-routes?dayOfWeek=1 — the routes, with stop count and minutes
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const dow = c.req.query('dayOfWeek')
    // A filter that was ASKED FOR and is not a day is refused, rather than quietly becoming "all days".
    if (dow != null && dow !== '' && dayIndex(dow) === null) return fail(c, 400, DAY_INDEX_HELP, 'BAD_DAY_OF_WEEK')
    const day = dayIndex(dow)
    const where = day !== null
      ? and(eq(recurringRoute.companyId, u.companyId), eq(recurringRoute.dayOfWeek, day))
      : eq(recurringRoute.companyId, u.companyId)
    const routes = await db.select().from(recurringRoute).where(where).orderBy(asc(recurringRoute.dayOfWeek))
    const stops = await db.select().from(recurringRouteStop).where(eq(recurringRouteStop.companyId, u.companyId))
    const withCounts = counted(stops, await maySeeMoney(c))
    const data = routes.map((r: any) => withCounts({ ...r, dayName: DAYS[r.dayOfWeek] ?? '' }))
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  // GET /api/recurring-routes/board — the whole week, grouped by day
  app.get('/board', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const routes = await db.select().from(recurringRoute)
      .where(eq(recurringRoute.companyId, u.companyId)).orderBy(asc(recurringRoute.dayOfWeek))
    const stops = await db.select().from(recurringRouteStop).where(eq(recurringRouteStop.companyId, u.companyId))
    const withCounts = counted(stops, await maySeeMoney(c))
    const board = DAYS.map((dayName, dayOfWeek) => ({
      dayOfWeek, dayName, routes: routes.filter((r: any) => r.dayOfWeek === dayOfWeek).map(withCounts),
    }))
    /**
     * Routes on no day of the week are shown, not swallowed (T58). The writers refuse a day outside 0–6 now, but rows
     * already stored on day 9 (or NaN) matched no column and were simply not on the screen. They come back in their
     * own group with a note the screen shows; absent when the data is clean.
     */
    const stray = routes.filter((r: any) => dayIndex(r.dayOfWeek) === null).map(withCounts)
    // The week is one record: its seven columns under `data` (as the screen reads them), and the stray routes beside
    // them. Not a page of a list, so not list().
    return one(c, {
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
    const u = c.get('user')
    const route = await routeWithStops(c.req.param('id'), u.companyId)
    if (!route) return fail(c, 404, 'Route not found')
    if (await maySeeMoney(c)) return one(c, route)
    return one(c, { ...route, stops: route.stops.map(withoutPrice) })
  })

  app.post('/', requirePermission('jobs:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    // The refusal names the field on the screen, not the one in the payload (T58).
    if (!body.name) return fail(c, 400, NAME_HELP, undefined, { name: NAME_HELP })
    if (body.dayOfWeek == null) return fail(c, 400, 'Pick the day this route runs.', undefined, { dayOfWeek: 'Pick the day this route runs.' })
    const day = dayIndex(body.dayOfWeek)
    if (day === null) return fail(c, 400, DAY_INDEX_HELP, 'BAD_DAY_OF_WEEK', { dayOfWeek: DAY_INDEX_HELP })
    const hours = hoursOf(body.estimatedHours)
    if (hours.error) return fail(c, 400, hours.error, undefined, { estimatedHours: hours.error })
    const [route] = await db.insert(recurringRoute).values({
      companyId: u.companyId,
      name: String(body.name),
      dayOfWeek: day,
      assignedToId: body.assignedToId ?? null,
      estimatedHours: String(hours.value ?? 0),
      status: body.status ?? 'active',
      notes: body.notes ?? null,
    }).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'recurring_route', entityId: route.id, entityName: route.name, userId: u.userId, companyId: u.companyId })
    return one(c, route, 201)
  })

  app.put('/:id', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    // The same rule on the edit as on the create (T58c): an explicit blank name is refused; absent leaves it alone.
    if (body.name != null) {
      const name = String(body.name).trim()
      if (!name) return fail(c, 400, NAME_HELP, undefined, { name: NAME_HELP })
      patch.name = name
    }
    // Moving a route to day 9 took it off the board just as surely as creating it there.
    if (body.dayOfWeek != null) {
      const day = dayIndex(body.dayOfWeek)
      if (day === null) return fail(c, 400, DAY_INDEX_HELP, 'BAD_DAY_OF_WEEK', { dayOfWeek: DAY_INDEX_HELP })
      patch.dayOfWeek = day
    }
    if (body.assignedToId !== undefined) patch.assignedToId = body.assignedToId || null
    if (body.estimatedHours !== undefined) {
      const hours = hoursOf(body.estimatedHours)
      if (hours.error) return fail(c, 400, hours.error, undefined, { estimatedHours: hours.error })
      patch.estimatedHours = String(hours.value ?? 0)
    }
    if (body.status) patch.status = body.status
    if (body.notes != null) patch.notes = body.notes
    // Read BEFORE the write, so the audit entry can say what moved (T58k: route edits were not audited).
    const [before] = await db.select().from(recurringRoute)
      .where(and(eq(recurringRoute.id, id), eq(recurringRoute.companyId, u.companyId))).limit(1)
    const [route] = await db.update(recurringRoute).set(patch)
      .where(and(eq(recurringRoute.id, id), eq(recurringRoute.companyId, u.companyId)))
      .returning()
    if (!route) return fail(c, 404, 'Route not found')
    audit.log({
      req: c, action: audit.ACTIONS.UPDATE, entity: 'recurring_route', entityId: route.id, entityName: route.name || 'route',
      changes: audit.diff(before, route),
    })
    return one(c, route)
  })

  // A deleted route leaves a trace (T58d), named from the returned row because the row is gone by the time anyone
  // reads the log.
  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId)))
      .returning()
    if (gone) {
      audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'recurring_route', entityId: gone.id, entityName: gone.name || 'route', userId: u.userId, companyId: u.companyId })
    }
    return c.body(null, 204)
  })

  // ---- Stops ----

  app.post('/:id/stops', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const routeId = c.req.param('id')
    const body = await c.req.json()
    if (!body.siteId) return fail(c, 400, 'Choose the property to add to this route.', undefined, { siteId: 'Choose the property to add to this route.' })
    const [route] = await db.select().from(recurringRoute)
      .where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, u.companyId)))
    if (!route) return fail(c, 404, 'Route not found')
    // The property must be this company's. The template took any id, so a stop could point at another company's
    // property and the route would then show its name and address (fixed in the move).
    const [ownSite] = await db.select({ id: site.id }).from(site)
      .where(and(eq(site.id, String(body.siteId)), eq(site.companyId, u.companyId))).limit(1)
    if (!ownSite) return fail(c, 404, 'Property not found', undefined, { siteId: 'Property not found' })
    // A price is set by the seat that may see it. Staff still add the stop; it goes on at no charge for an owner or
    // manager to price. (T62, gate both sides)
    const money = await maySeeMoney(c)
    const priceGiven = body.pricePerVisit != null && String(body.pricePerVisit).trim() !== '' && Number(body.pricePerVisit) !== 0
    if (priceGiven && !money) {
      const why = 'Pricing a stop is for an owner or manager. Add the stop without a price and they can set it.'
      return fail(c, 403, why, undefined, { pricePerVisit: why })
    }
    const minutes = readNumber(body.estimatedMinutes, MINUTES)
    if (minutes.error) return fail(c, 400, minutes.error, undefined, { estimatedMinutes: minutes.error })
    const price = readNumber(body.pricePerVisit, { label: 'Price per visit', blank: 0, min: 0, max: 1_000_000, example: '45' })
    if (price.error) return fail(c, 400, price.error, undefined, { pricePerVisit: price.error })
    const existing = await db.select().from(recurringRouteStop).where(eq(recurringRouteStop.recurringRouteId, routeId))
    const [stop] = await db.insert(recurringRouteStop).values({
      companyId: u.companyId,
      recurringRouteId: routeId,
      siteId: String(body.siteId),
      contactId: body.contactId ?? null,
      serviceType: body.serviceType ?? 'mowing',
      sortOrder: body.sortOrder ?? existing.length,
      estimatedMinutes: minutes.value ?? 30,
      pricePerVisit: priceGiven ? String(price.value ?? 0) : '0',
    }).returning()
    return one(c, money ? stop : withoutPrice(stop), 201)
  })

  // Reorder stops: body = { stopIds: [id1, id2, ...] } in the new order
  app.put('/:id/stops/reorder', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const routeId = c.req.param('id')
    const { stopIds } = await c.req.json()
    // Not a field anybody fills in: this is the drag-reorder sending nothing. Say what to DO.
    if (!Array.isArray(stopIds)) return fail(c, 400, 'The new stop order did not reach us. Reload the route and drag the stops again.')
    for (let i = 0; i < stopIds.length; i++) {
      await db.update(recurringRouteStop).set({ sortOrder: i })
        .where(and(eq(recurringRouteStop.id, stopIds[i]), eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, u.companyId)))
    }
    return one(c, { success: true, reordered: stopIds.length })
  })

  app.delete('/:routeId/stops/:stopId', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    // The stop must be on the route the request names (the template ignored :routeId).
    const [gone] = await db.delete(recurringRouteStop)
      .where(and(eq(recurringRouteStop.id, c.req.param('stopId')), eq(recurringRouteStop.recurringRouteId, c.req.param('routeId')), eq(recurringRouteStop.companyId, u.companyId)))
      .returning({ id: recurringRouteStop.id })
    if (!gone) return fail(c, 404, 'That stop is not on this route')
    return c.body(null, 204)
  })

  return app
}
