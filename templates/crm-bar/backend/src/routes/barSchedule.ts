// THE SCHEDULE — /api/schedule behind the bar_schedule feature (services/barSchedule.ts).
//
//   A manager's (bar:update — the same as the menu and the hours):
//     GET    /week?day=            the week grid: shifts, people and hours, gaps, overlaps, labor %, worked hours
//     POST   /shifts  ·  PATCH /shifts/:id  ·  DELETE /shifts/:id
//     POST   /copy { fromDay, toDay, replace }   ·   POST /publish { day }
//     PUT    /time-off/:id { status: approved | denied }
//   Everyone signed in (bar:read):
//     GET    /published?day=       this week and next, as published
//     GET    /time-off/mine  ·  POST /time-off { day, note }   my own requests
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import audit from '../services/audit.ts'
import { actorOf } from '../services/barManagers.ts'
import {
  RotaError, addScheduled, copyWeek, decideTimeOff, deleteScheduled, loadWeek, myTimeOff, publishWeek, publishedWeeks, requestTimeOff, updateScheduled,
} from '../services/barSchedule.ts'

type Ctx = any
const app = new Hono()
app.use('*', authenticate)
const on = requireEnabledFeature('bar_schedule')
const manage = [on, requirePermission('bar:update')] as const
const read = [on, requirePermission('bar:read')] as const
const body = async (c: Ctx) => (await c.req.json().catch(() => ({}))) as Record<string, any>

async function run(c: Ctx, fn: () => Promise<unknown>) {
  try {
    c.header('Cache-Control', 'no-store')
    return c.json(await fn())
  } catch (e: any) {
    if (e instanceof RotaError) return c.json({ error: e.message }, e.status)
    console.error('[schedule]', e?.message || e)
    return c.json({ error: 'That did not save. Try again.' }, 500)
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
app.put('/time-off/:id', ...manage, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ request: await decideTimeOff(a, c.req.param('id'), b.status) })) })

app.get('/published', ...read, async (c) => { const a = await actorOf(c); return run(c, () => publishedWeeks(a.companyId, c.req.query('day') || null)) })
app.get('/time-off/mine', ...read, async (c) => { const a = await actorOf(c); return run(c, async () => ({ requests: await myTimeOff(a) })) })
app.post('/time-off', ...read, async (c) => { const a = await actorOf(c); const b = await body(c); return run(c, async () => ({ request: await requestTimeOff(a, b.day, b.note) })) })

export default app
