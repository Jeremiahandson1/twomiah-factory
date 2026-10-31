// The Route Board: named per-weekday crew routes ("Monday Route A") and their property stops in visit order. Moved from
// templates/crm-landscaping/backend/src/routes/recurringRoutes.ts. The registry signs the person in and applies the
// 'recurring_routes' gate. A mow route IS recurring work, so it asks the jobs verbs.
import { Hono } from 'hono'
import { eq, and, asc } from 'drizzle-orm'
import { recurringRoute, recurringRouteStop, site } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { readNumber, type NumberRule } from '../../http/numberInput.ts'
import { fail, list, one, listAll } from '../../http/reply.ts'
import { billingFor, billedVisits, BILLING_MODES } from '../../data/routeBilling.ts'
import { makeRouteVisits, retimeRouteVisits, reassignOpenVisits, cancelOpenVisits, visitsOfRoute, routeStopPoints, todayUtc, HHMM, MAX_VISIT_WEEKS } from '../../data/routeVisits.ts'
import { createRoutingService } from '../field/routingService.ts'
import { createGeocodingService } from '../field/geocodingService.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'
import { routeProfit } from '../../data/routeProfit.ts'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Named for the control on the screen, not the key in the payload (T58c): nothing on the Route Board is labelled
 * dayOfWeek. The accepted values are still spelled out, because that is the part that helps.
 */
const DAY_INDEX_HELP = 'Pick the day this route runs — Sunday (0) through Saturday (6).'
const NAME_HELP = 'Give the route a name — it is what the crew sees on the board.'
const START_HELP = 'Give the time the crew leaves the yard as hours and minutes, like 07:30. The first stop starts then.'

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

  /** Changing how a route is billed is a billing decision: the seat that may raise invoices. */
  const mayBill = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, 'invoices:create', await getExtraPermissions(u?.userId)) } catch { return false }
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
    return listAll(c, data)
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
    if (await maySeeMoney(c)) return one(c, { ...route, billing: await billingFor(db, u.companyId, route) })
    const { billingMode: _mode, ...crewRoute } = route
    return one(c, { ...crewRoute, stops: route.stops.map(withoutPrice) })
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
    if (body.startTime != null && body.startTime !== '' && !HHMM.test(String(body.startTime))) return fail(c, 400, START_HELP, undefined, { startTime: START_HELP })
    const [route] = await db.insert(recurringRoute).values({
      companyId: u.companyId,
      name: String(body.name),
      dayOfWeek: day,
      assignedToId: body.assignedToId ?? null,
      estimatedHours: String(hours.value ?? 0),
      ...(body.startTime ? { startTime: String(body.startTime) } : {}),
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
    if (body.startTime != null && body.startTime !== '') {
      if (!HHMM.test(String(body.startTime))) return fail(c, 400, START_HELP, undefined, { startTime: START_HELP })
      patch.startTime = String(body.startTime)
    }
    // How the visits are billed: per visit, monthly, billed elsewhere — or '' / null to go back to automatic.
    if (body.billingMode !== undefined) {
      if (!(await mayBill(c))) { const why = 'Choosing how a route is billed is for an owner or manager.'; return fail(c, 403, why, undefined, { billingMode: why }) }
      if (body.billingMode === null || body.billingMode === '' || body.billingMode === 'auto') patch.billingMode = null
      else if ((BILLING_MODES as readonly string[]).includes(String(body.billingMode))) patch.billingMode = String(body.billingMode)
      else { const why = 'Choose per visit, monthly, or billed elsewhere.'; return fail(c, 400, why, undefined, { billingMode: why }) }
    }
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
    // A new start time moves every still-to-do visit of this route with it.
    if (patch.startTime && before && before.startTime !== route.startTime) await retimeRouteVisits(db, u.companyId, route.id)
    // A new crew takes the visits still to do; the ones already done stay with whoever did them.
    if ('assignedToId' in patch && before && before.assignedToId !== route.assignedToId) await reassignOpenVisits(db, u.companyId, route.id, route.assignedToId)
    return one(c, route)
  })

  // A deleted route leaves a trace (T58d), named from the returned row because the row is gone by the time anyone
  // reads the log.
  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const u = c.get('user')
    // Its visits that are still to do are cancelled with it; the stops are gone after the delete, so their ids are read first.
    const stopIds = (await db.select({ id: recurringRouteStop.id }).from(recurringRouteStop)
      .where(and(eq(recurringRouteStop.recurringRouteId, c.req.param('id')), eq(recurringRouteStop.companyId, u.companyId)))).map((s: any) => s.id)
    const [gone] = await db.delete(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId)))
      .returning()
    // An id that is not this company's (or not there at all) is a 404, not a success that deleted nothing (live role check, 2026-10-23).
    if (!gone) return fail(c, 404, 'Route not found')
    await cancelOpenVisits(db, u.companyId, stopIds)
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'recurring_route', entityId: gone.id, entityName: gone.name || 'route', userId: u.userId, companyId: u.companyId })
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
    // The stop order IS the day's order: visits still to do are re-timed to match.
    const retimed = await retimeRouteVisits(db, u.companyId, routeId)
    return one(c, { success: true, reordered: stopIds.length, retimed })
  })

  app.delete('/:routeId/stops/:stopId', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    // The stop must be on the route the request names (the template ignored :routeId).
    const [gone] = await db.delete(recurringRouteStop)
      .where(and(eq(recurringRouteStop.id, c.req.param('stopId')), eq(recurringRouteStop.recurringRouteId, c.req.param('routeId')), eq(recurringRouteStop.companyId, u.companyId)))
      .returning({ id: recurringRouteStop.id })
    if (!gone) return fail(c, 404, 'That stop is not on this route')
    // The crew is no longer sent there: its visits still to do are cancelled, and the stops after it close up the gap.
    await cancelOpenVisits(db, u.companyId, [gone.id])
    await retimeRouteVisits(db, u.companyId, c.req.param('routeId'))
    return c.body(null, 204)
  })

  // ---- Visits: the route made into the crew's days ----

  const WEEKS_HELP = `Say how many weeks to make, from 1 to ${MAX_VISIT_WEEKS}.`
  const FROM_HELP = 'Pick the first day to make visits from (YYYY-MM-DD). The first visit falls on the route\'s day.'

  // POST /api/recurring-routes/:id/visits { from?, weeks? } — one job per stop per day the route runs, in stop order
  app.post('/:id/visits', requirePermission('jobs:create'), async (c) => {
    const u = c.get('user')
    const body: any = await c.req.json().catch(() => ({}))
    const from = body?.from == null || body.from === '' ? todayUtc() : String(body.from)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(from))) return fail(c, 400, FROM_HELP, undefined, { from: FROM_HELP })
    const weeksRaw = body?.weeks == null || body.weeks === '' ? 4 : Number(body.weeks)
    if (!Number.isInteger(weeksRaw) || weeksRaw < 1 || weeksRaw > MAX_VISIT_WEEKS) return fail(c, 400, WEEKS_HELP, undefined, { weeks: WEEKS_HELP })
    const [route] = await db.select().from(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId))).limit(1)
    if (!route) return fail(c, 404, 'Route not found')
    if (route.status !== 'active') return fail(c, 409, `This route is ${route.status}. Make it active before making its visits.`)
    const [anyStop] = await db.select({ id: recurringRouteStop.id }).from(recurringRouteStop).where(eq(recurringRouteStop.recurringRouteId, route.id)).limit(1)
    if (!anyStop) return fail(c, 400, 'Add at least one property to this route before making its visits.')
    const out = await makeRouteVisits(db, u.companyId, u.userId, route, { from, weeks: weeksRaw })
    for (const j of out.made) d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.JOB_CREATED, j)
    audit.log({
      req: c, action: audit.ACTIONS.CREATE, entity: 'recurring_route_visits', entityId: route.id, entityName: route.name,
      userId: u.userId, companyId: u.companyId, metadata: { made: out.made.length, alreadyThere: out.alreadyThere, from, weeks: weeksRaw },
    })
    return one(c, {
      made: out.made.length, alreadyThere: out.alreadyThere, firstDay: out.dates[0] ?? null, lastDay: out.dates[out.dates.length - 1] ?? null,
      message: out.made.length
        ? `Made ${out.made.length} ${out.made.length === 1 ? 'visit' : 'visits'} on the schedule.`
        : 'Those days already have every visit — nothing new was made.',
    }, 201)
  })

  // GET /api/recurring-routes/:id/visits?from=&to= — what is on the calendar for this route (default: the next 28 days)
  app.get('/:id/visits', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const [route] = await db.select({ id: recurringRoute.id }).from(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId))).limit(1)
    if (!route) return fail(c, 404, 'Route not found')
    const from = c.req.query('from') || todayUtc()
    const to = c.req.query('to') || new Date(Date.parse(from) + 27 * 86_400_000).toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail(c, 400, 'Give the days as YYYY-MM-DD.')
    const rows = await visitsOfRoute(db, u.companyId, route.id, from, to)
    const money = await maySeeMoney(c)
    if (!money) return listAll(c, rows.map((r: any) => (({ estimatedValue: _v, ...rest }) => rest)(r)))
    const { billed } = await billedVisits(db, u.companyId, rows.map((r: any) => r.id))
    return listAll(c, rows.map((r: any) => ({ ...r, invoice: billed.get(r.id) ?? null })))
  })

  // GET /api/recurring-routes/:id/profit?from=&to= — what the route earned against what it cost (default: the last 30 days, as
  // Jobber's rolling bar). Labour cost and margin are not technician data: reports:read, as job costing, and the billed
  // figures only for a seat that reads invoices.
  app.get('/:id/profit', requirePermission('reports:read'), async (c) => {
    const u = c.get('user')
    const [route] = await db.select({ id: recurringRoute.id, name: recurringRoute.name }).from(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId))).limit(1)
    if (!route) return fail(c, 404, 'Route not found')
    const to = c.req.query('to') || todayUtc()
    const from = c.req.query('from') || new Date(Date.parse(to) - 29 * 86_400_000).toISOString().slice(0, 10)
    const DAYS = /^\d{4}-\d{2}-\d{2}$/
    if (!DAYS.test(from) || !DAYS.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return fail(c, 400, 'Give the days as YYYY-MM-DD.')
    if (to < from) return fail(c, 400, 'The last day comes before the first. Swap them.')
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return fail(c, 400, 'Pick a span of a year or less.')
    const costing = createJobCostingService(d)
    const out = await routeProfit(db, u.companyId, route.id, { from, to }, costing.costsByJob)
    if (!(await maySeeMoney(c))) {
      const hide = ({ billed: _b, unbilled: _u, ...rest }: any) => rest
      return one(c, { route: route.name, from, to, totals: hide(out.totals), properties: out.properties.map(hide) })
    }
    return one(c, { route: route.name, from, to, ...out })
  })

  // ---- Best order: shown, then applied by the reorder above (nothing here changes the board) ----

  // GET /api/recurring-routes/:id/optimize — the stops in the shortest order, with what it saves over today's order.
  // Needs every stop on the map (a visit located by the Schedule's existing geocoding): a route with a stop we cannot place
  // is not guessed at.
  app.get('/:id/optimize', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const [route] = await db.select({ id: recurringRoute.id }).from(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId))).limit(1)
    if (!route) return fail(c, 404, 'Route not found')
    const stops = await routeStopPoints(db, u.companyId, route.id)
    const base = { current: stops.map((s) => s.stopId), stops }
    if (stops.length < 2) return one(c, { ...base, proposed: base.current, changes: false, message: 'A route needs two or more properties before there is an order to improve.' })
    const unplaced = stops.filter((s) => s.lat == null)
    if (unplaced.length) {
      return one(c, {
        ...base, proposed: base.current, changes: false, unplaced: unplaced.map((s) => ({ stopId: s.stopId, siteName: s.siteName, canLocate: !!s.locateVisitId })),
        message: `${unplaced.length} of ${stops.length} properties are not on the map yet. Put them on the map, then improve the order.`,
      })
    }
    const result = await createRoutingService(d).optimizeRoute(stops.map((s) => ({ id: s.stopId, lat: s.lat!, lng: s.lng! })))
    const proposed: string[] = result.optimizedOrder.map((s: any) => s.id)
    const changes = proposed.some((id, i) => id !== base.current[i])
    const saved = result.savings
    return one(c, {
      ...base, proposed, changes, unplaced: [],
      totalMiles: Math.round((result.totalDistanceMiles || 0) * 10) / 10,
      savings: changes && saved ? { miles: Math.round((saved.distanceMiles || 0) * 10) / 10, minutes: saved.timeMinutes || 0 } : null,
      source: result.source,
      message: changes ? 'A shorter order is ready. Apply it to move the stops and re-time the visits still to do.' : 'This order is already the shortest we can find.',
    })
  })

  // POST /api/recurring-routes/:id/locate — put the route's properties on the map: the next open visit of each stop that is
  // not there yet, a few at a time (the geocoder allows one request a second).
  app.post('/:id/locate', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const [route] = await db.select({ id: recurringRoute.id }).from(recurringRoute)
      .where(and(eq(recurringRoute.id, c.req.param('id')), eq(recurringRoute.companyId, u.companyId))).limit(1)
    if (!route) return fail(c, 404, 'Route not found')
    const stops = await routeStopPoints(db, u.companyId, route.id)
    const missing = stops.filter((s) => s.lat == null)
    const todo = missing.filter((s) => s.locateVisitId).slice(0, 10)
    const geocoding = createGeocodingService(d)
    const located: string[] = []
    for (const [i, s] of todo.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1100))
      const done = await geocoding.geocodeJob(s.locateVisitId!, u.companyId).catch(() => null)
      if (done?.lat != null) located.push(s.stopId)
    }
    const noVisit = missing.filter((s) => !s.locateVisitId).length
    return one(c, {
      located, remaining: missing.length - located.length,
      message: missing.length === 0 ? 'Every property is already on the map.'
        : noVisit ? `${noVisit} ${noVisit === 1 ? 'property has' : 'properties have'} no upcoming visit to put on the map — make visits first.` : undefined,
    })
  })

  return app
}
