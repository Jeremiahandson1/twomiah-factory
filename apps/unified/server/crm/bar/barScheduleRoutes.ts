// /api/schedule — THE SCHEDULE, behind the bar_schedule feature (barSchedule.ts).
//
//   A manager's (bar:update — the same as the menu and the hours):
//     GET    /week?day=            the week grid: shifts, people and hours, gaps, overlaps, labor %, worked hours
//     POST   /shifts  ·  PATCH /shifts/:id  ·  DELETE /shifts/:id
//     POST   /copy { fromDay, toDay, replace }   ·   POST /publish { day }
//     PUT    /time-off/:id { status: approved | denied }
//   Availability and shift swaps (restaurant-bar-depth #10), each behind its own not-ready feature:
//     bar_availability   GET/PUT /availability/mine (bar:read)    ·  GET /availability, PUT /availability/:userId, POST /availability/:userId/decision (bar:update)
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
import { worksWithin } from './barAvailability.ts'
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

  const availabilityOn = (companyId: string) => d.features.isFeatureEnabled(companyId, 'bar_availability')
  app.get('/week', ...manage, async (c) => {
    const a = await actorOf(c)
    return run(c, async () => {
      const w = await loadWeek(a.companyId, c.req.query('day') || null)
      if (!(await availabilityOn(a.companyId))) return w
      // A shift outside what the person said they can work is flagged, never blocked.
      const av = await sr.approvedFor(a.companyId, [...new Set(w.shifts.map((s) => s.userId))])
      return { ...w, shifts: w.shifts.map((s) => ({ ...s, outsideAvailability: !worksWithin(av.get(s.userId) || [], s.day, s.start, s.end) })) }
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
      audit.log({ req: c, action: 'update', entity: 'bar_schedule_week', entityName: `Week of ${r.weekStart}`, changes: { published: true, shifts: r.shifts } })
      return r
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
  app.post('/swaps/:id/claim', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ request: await sr.claim(a, c.req.param('id')) })) })
  app.post('/swaps/:id/accept', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ request: await sr.respond(a, c.req.param('id'), true) })) })
  app.post('/swaps/:id/decline', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ request: await sr.respond(a, c.req.param('id'), false) })) })
  app.post('/swaps/:id/cancel', ...read, swaps, async (c) => { const a = await actorOf(c); return run(c, async () => ({ request: await sr.cancel(a, c.req.param('id')) })) })
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
