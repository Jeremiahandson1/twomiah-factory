// /api/schedule — THE SCHEDULE, behind the bar_schedule feature (barSchedule.ts).
//
//   A manager's (bar:update — the same as the menu and the hours):
//     GET    /week?day=            the week grid: shifts, people and hours, gaps, overlaps, labor %, worked hours
//     GET    /labor-forecast?day=  (bar_labor_forecast as well) sales by day and hour from the register's history, booked events, and the hours per position that fit the target labor %
//     GET/PUT /labor-forecast/settings   the target labor percent and how many weeks to look back
//     POST   /shifts  ·  PATCH /shifts/:id  ·  DELETE /shifts/:id
//     POST   /copy { fromDay, toDay, replace }   ·   POST /publish { day }
//     PUT    /time-off/:id { status: approved | denied }
//   Availability and shift swaps (restaurant-bar-depth #10), each behind its own not-ready feature:
//     bar_availability   GET/PUT /availability/mine (bar:read)    ·  GET /availability, PUT /availability/:userId, POST /availability/:userId/decision (bar:update)
//     bar_availability   GET/POST /availability/dates/mine, DELETE /availability/dates/mine/:id (bar:read)  ·  GET /availability/dates, PUT /availability/dates/user/:userId, POST /availability/dates/:id/decision, DELETE /availability/dates/:id (bar:update)   one-day availability
//     bar_shift_swaps    GET/PUT /swap-settings (bar:update)   approval off for swaps / pick-ups, and when a request lapses
//     bar_shift_swaps    GET /swaps/mine, POST /swaps, POST /swaps/:id/claim|accept|decline|cancel (bar:read)  ·  GET /swaps, PUT /swaps/:id (bar:update)
//   Everyone signed in (bar:read):
//     GET    /published?day=       this week and next, as published
//     GET    /time-off/mine  ·  POST /time-off { day, note }   my own requests
//
// Moved from templates/crm-bar/backend/src/routes/barSchedule.ts; paths, permissions and answers as they were.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { checkFilter } from '@twomiah/tenant-backend'
import { RotaError } from './barSchedule.ts'
import { TIME_OFF_TILES } from './tileConditions.ts'
import type { BarServices } from './services.ts'

type Ctx = any
const body = async (c: Ctx) => (await c.req.json().catch(() => ({}))) as Record<string, any>

export function createBarScheduleRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('bar_schedule')
  const manage = [on, requirePermission('bar:update')] as const
  const read = [on, requirePermission('bar:read')] as const
  const { actorOf } = bar.managers
  const avail = d.features.requireEnabledFeature('bar_availability')
  const swaps = d.features.requireEnabledFeature('bar_shift_swaps')
  const sr = bar.staffRequests
  const { addScheduled, copyWeek, decideTimeOff, deleteScheduled, loadWeek, myTimeOff, publishWeek, publishedWeeks, requestTimeOff, timeOffRequests, updateScheduled } = bar.schedule
  const app = new Hono<AppEnv>()

  async function run(c: Ctx, fn: () => Promise<unknown>) {
    try {
      c.header('Cache-Control', 'no-store')
      return one(c, await fn() as object)
    } catch (e: any) {
      if (e instanceof RotaError) return fail(c, e.status as any, e.message)
      logger.error('[schedule]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  // Sales-driven labor forecast (restaurant-bar parity #9), beside the grid; a manager's, behind its own feature as well.
  const laborOn = d.features.requireEnabledFeature('bar_labor_forecast')
  app.get('/labor-forecast', ...manage, laborOn, async (c) => { const a = await actorOf(c); return run(c, () => bar.labor.week(a.companyId, c.req.query('day') || null)) })
  app.get('/labor-forecast/settings', ...manage, laborOn, async (c) => { const a = await actorOf(c); return run(c, async () => ({ settings: await bar.labor.getSettings(a.companyId) })) })
  app.put('/labor-forecast/settings', ...manage, laborOn, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const r = await bar.labor.setSettings(a.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_labor_settings', entityName: 'Labor forecast settings', changes: audit.diff(r.before as any, r.settings as any) })
      return { settings: r.settings }
    })
  })
  const availabilityOn = (companyId: string) => d.features.isFeatureEnabled(companyId, 'bar_availability')
  app.get('/week', ...manage, async (c) => {
    const a = await actorOf(c)
    return run(c, async () => {
      const w = await loadWeek(a.companyId, c.req.query('day') || null)
      if (!(await availabilityOn(a.companyId))) return w
      // A shift outside what the person said they can work is flagged, never blocked.
      const av = await sr.rulesFor(a.companyId, [...new Set(w.shifts.map((s) => s.userId))])
      return { ...w, shifts: w.shifts.map((s) => ({ ...s, outsideAvailability: !sr.fits(av, s) })) }
    })
  })
  app.post('/shifts', ...manage, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const shift = await addScheduled(a, b); return { shift, warning: (await availabilityOn(a.companyId)) ? await sr.availabilityWarning(a.companyId, shift) : null } })
  })
  app.patch('/shifts/:id', ...manage, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const shift = await updateScheduled(a, c.req.param('id'), b); return { shift, warning: (await availabilityOn(a.companyId)) ? await sr.availabilityWarning(a.companyId, shift) : null } })
  })
  app.delete('/shifts/:id', ...manage, async (c) => { const a = await actorOf(c); return run(c, async () => { await deleteScheduled(a, c.req.param('id')); return { ok: true } }) })
  app.post('/copy', ...manage, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => ({ shifts: await copyWeek(a, String(b.fromDay || ''), String(b.toDay || ''), b.replace === true) }))
  })
  app.post('/publish', ...manage, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const r = await publishWeek(a, String(b.day || ''))
      // A swap or pick-up whose shift this publish changed is cancelled, and the people in it told (bar_shift_swaps).
      const cancelled = (await d.features.isFeatureEnabled(a.companyId, 'bar_shift_swaps')) ? await sr.cancelChanged(a.companyId, r.weekStart) : 0
      audit.log({ req: c, action: 'update', entity: 'bar_schedule_week', entityName: `Week of ${r.weekStart}`, changes: { published: true, shifts: r.shifts } })
      return { ...r, swapsCancelled: cancelled }
    })
  })
  // The team's time-off requests (a manager's). ?tile=pending is the home screen's "Time off to decide": the dashboard's
  // count calls the same condition (tileConditions.ts). An unknown tile is refused 400 INVALID_FILTER.
  app.get('/time-off', ...manage, async (c) => {
    const bad = checkFilter(c, 'tile', c.req.query('tile'), TIME_OFF_TILES); if (bad) return bad
    const a = await actorOf(c)
    return run(c, async () => ({ requests: await timeOffRequests(a.companyId, c.req.query('tile') === 'pending') }))
  })
  app.put('/time-off/:id', ...manage, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ request: await decideTimeOff(a, c.req.param('id'), b.status) })) })

  app.get('/published', ...read, async (c) => { const a = await actorOf(c); return run(c, () => publishedWeeks(a.companyId, c.req.query('day') || null)) })
  app.get('/time-off/mine', ...read, async (c) => { const a = await actorOf(c); return run(c, async () => ({ requests: await myTimeOff(a) })) })
  app.post('/time-off', ...read, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ request: await requestTimeOff(a, b.day, b.note) })) })

  // ── Availability (bar_availability) ──
  app.get('/availability/mine', ...read, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.mineAvailability(a)) })
  app.put('/availability/mine', ...read, avail, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, () => sr.submitAvailability(a, b.windows)) })
  // One-day availability (the same feature). The fixed paths come first so ":userId" never swallows them.
  app.get('/availability/dates/mine', ...read, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.mineDates(a)) })
  app.post('/availability/dates/mine', ...read, avail, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ entry: await sr.submitDate(a, b) })) })
  app.delete('/availability/dates/mine/:id', ...read, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.withdrawDate(a, c.req.param('id'))) })
  app.get('/availability/dates', ...manage, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.allDates(a.companyId)) })
  app.put('/availability/dates/user/:userId', ...manage, avail, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const entry = await sr.setDate(a, c.req.param('userId'), b); audit.log({ req: c, action: 'update', entity: 'bar_availability', entityId: c.req.param('userId'), entityName: 'One-day availability', changes: { day: entry.day, mode: entry.mode } }); return { entry } })
  })
  app.post('/availability/dates/:id/decision', ...manage, avail, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const r = await sr.decideDate(a, c.req.param('id'), b.status); audit.log({ req: c, action: 'update', entity: 'bar_availability', entityId: c.req.param('id'), entityName: 'One-day availability', changes: { decision: b.status } }); return r })
  })
  app.delete('/availability/dates/:id', ...manage, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.removeDate(a, c.req.param('id'))) })
  app.get('/availability', ...manage, avail, async (c) => { const a = await actorOf(c); return run(c, () => sr.allAvailability(a.companyId)) })
  app.put('/availability/:userId', ...manage, avail, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const r = await sr.setAvailability(a, c.req.param('userId'), b.windows); audit.log({ req: c, action: 'update', entity: 'bar_availability', entityId: c.req.param('userId'), entityName: 'Availability', changes: { windows: r.windows.length } }); return r })
  })
  app.post('/availability/:userId/decision', ...manage, avail, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => { const r = await sr.decideAvailability(a, c.req.param('userId'), b.status); audit.log({ req: c, action: 'update', entity: 'bar_availability', entityId: c.req.param('userId'), entityName: 'Availability', changes: { decision: b.status } }); return r })
  })

  // ── Shift swaps and pick-ups (bar_shift_swaps) ──
  app.get('/swaps/mine', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, () => sr.mine(a)) })
  app.post('/swaps', ...read, swaps, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ request: await sr.createRequest(a, b) })) })
  app.post('/swaps/:id/claim', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, () => sr.claim(a, c.req.param('id'))) })
  app.post('/swaps/:id/accept', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, () => sr.respond(a, c.req.param('id'), true)) })
  app.post('/swaps/:id/decline', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, () => sr.respond(a, c.req.param('id'), false)) })
  app.post('/swaps/:id/cancel', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ request: await sr.cancel(a, c.req.param('id')) })) })
  // What the manager decided about swaps: approval on or off for swaps and for pick-ups, and how long before a shift a request lapses.
  app.get('/swap-settings', ...manage, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ settings: await sr.swapSettings(a.companyId) })) })
  app.put('/swap-settings', ...manage, swaps, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const r = await sr.setSwapSettings(a.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_shift_swap_settings', entityName: 'Shift swap rules', changes: audit.diff(r.before as any, r.settings as any) })
      return { settings: r.settings }
    })
  })
  app.get('/swaps', ...manage, swaps, async (c) => { const a = await actorOf(c); return run(c, () => sr.toDecide(a.companyId, c.req.query('tile') === 'pending')) })
  app.put('/swaps/:id', ...manage, swaps, async (c) => {
    const a = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const r = await sr.decide(a, c.req.param('id'), b.status)
      audit.log({ req: c, action: 'update', entity: 'bar_shift_request', entityId: c.req.param('id'), entityName: 'Shift swap', changes: { decision: b.status } })
      return r
    })
  })

  return app
}
