// /api/schedule — THE SCHEDULE, behind the bar_schedule feature (barSchedule.ts).
//
//   A manager's (bar:update — the same as the menu and the hours):
//     GET    /week?day=            the week grid: shifts, people and hours, gaps, overlaps, labor %, worked hours
//     POST   /shifts  ·  PATCH /shifts/:id  ·  DELETE /shifts/:id
//     POST   /copy { fromDay, toDay, replace }   ·   POST /publish { day }
//     PUT    /time-off/:id { status: approved | denied }
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

  app.get('/week', ...manage, async (c) => { const a = await actorOf(c); return run(c, () => loadWeek(a.companyId, c.req.query('day') || null)) })
  app.post('/shifts', ...manage, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ shift: await addScheduled(a, b) })) })
  app.patch('/shifts/:id', ...manage, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ shift: await updateScheduled(a, c.req.param('id'), b) })) })
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

  return app
}
