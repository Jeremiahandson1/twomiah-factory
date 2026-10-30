// Storm mode for snow & ice, mounted at /api/snow/storms (before /api/snow, so "storms" is never read as an id). The office
// starts a storm and dispatches every contract on a route or tag at once; each crew sees its stops on "Today's route" and logs
// pushes, salt, hours and a note (photos go on the stop's job through /api/photos); the storm is billed at the end. Every visit
// is priced by the contract's own rules in snowBilling.ts. The registry signs the person in and applies the 'snow_billing' gate.
//
// Who may do what — the server asks the same permissions the screens do:
//   see the storms ........ jobs:read          (a crew seat sees only the stops it is on, unless it may dispatch)
//   start, dispatch, skip, end, log for all ... jobs:dispatch (+ jobs:create to make the jobs, jobs:update to log)
//   start / log one stop .. jobs:update        (a crew seat: its own stops only)
//   bill the storm ........ invoices:create    (money is withheld from any seat without invoices:read)
import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { JOB_DISPATCH_PERMISSION, companyTimeZone, businessToday } from '@twomiah/tenant-backend'
import { snowStorm, snowStormStop, snowEvent } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import {
  startStorm, getStorm, dispatchStorm, stormStops, startStormStop, logStormStop, logAllStormStops, skipStormStop, endStorm, billStorm,
} from '../../data/snowStorm.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function createSnowStormRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, perm: string): Promise<boolean> => {
    const u = c.get('user')
    try { return hasPermission(u?.role, perm, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  /** A crew seat works its own stops; a seat that may dispatch works anyone's. */
  const mayWork = async (c: any, stop: { assignedToId: string | null }) =>
    (await may(c, JOB_DISPATCH_PERMISSION)) || (!!stop.assignedToId && stop.assignedToId === c.get('user')?.userId)
  /** The visit's money is for a seat that may read invoices; the crew sees pushes, salt and hours, not what they bill. */
  const withoutMoney = (ev: any) => { if (!ev) return ev; const { billableAmount, ...rest } = ev; return rest }
  const shapeStop = (s: any, money: boolean) => ({ ...s, event: money ? s.event : withoutMoney(s.event) })

  const stopById = async (companyId: string, id: string) =>
    (await db.select().from(snowStormStop).where(and(eq(snowStormStop.id, id), eq(snowStormStop.companyId, companyId))).limit(1))[0] ?? null

  const afterJob = (u: any, job: any, hook: 'onComplete' | 'onStart') => {
    if (!job) return
    d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.JOB_UPDATED, { id: job.id, status: job.status })
    // The same moments any job runs (texts "on site"/"done" where the business turned them on).
    Promise.resolve((d.services.jobHooks as any)?.[hook]?.({ job, companyId: u.companyId })).catch((err: any) => d.logger.warn('[snow] job hook failed', { error: err?.message }))
  }

  // ---- Storms ----

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const money = await may(c, 'invoices:read')
    const storms = await db.select().from(snowStorm).where(eq(snowStorm.companyId, u.companyId)).orderBy(desc(snowStorm.startedAt))
    const stops: any[] = storms.length ? await db.select().from(snowStormStop).where(and(eq(snowStormStop.companyId, u.companyId), inArray(snowStormStop.stormId, storms.map((s: any) => s.id)))) : []
    const events: any[] = storms.length ? await db.select().from(snowEvent).where(and(eq(snowEvent.companyId, u.companyId), inArray(snowEvent.stormId, storms.map((s: any) => s.id)))) : []
    const own = !(await may(c, JOB_DISPATCH_PERMISSION))
    const data = storms.map((s: any) => {
      const mine = stops.filter((x) => x.stormId === s.id && (!own || x.assignedToId === u.userId))
      const ev = events.filter((e) => e.stormId === s.id)
      return {
        ...s,
        stops: mine.length, done: mine.filter((x) => x.status === 'done').length,
        open: mine.filter((x) => x.status === 'open' || x.status === 'working').length, skipped: mine.filter((x) => x.status === 'skipped').length,
        ...(money ? {
          earned: Math.round(ev.reduce((t, e) => t + Number(e.billableAmount), 0) * 100) / 100,
          unbilled: Math.round(ev.filter((e) => !e.invoiceId).reduce((t, e) => t + Number(e.billableAmount), 0) * 100) / 100,
        } : {}),
      }
    })
    return listAll(c, data)
  })

  // The signed-in person's stops in storms that are still going — "Today's route" and "Log snow visit" on the phone.
  app.get('/mine/stops', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const money = await may(c, 'invoices:read')
    const active = await db.select().from(snowStorm).where(and(eq(snowStorm.companyId, u.companyId), eq(snowStorm.status, 'active')))
    const out: any[] = []
    for (const s of active) {
      for (const stop of await stormStops(db, u.companyId, s.id, { assignedToId: u.userId })) out.push({ ...shapeStop(stop, money), stormName: s.name })
    }
    return listAll(c, out)
  })

  app.post('/', requirePermission(JOB_DISPATCH_PERMISSION), requirePermission('jobs:create'), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const name = String(b?.name ?? '').trim()
    if (!name) return fail(c, 400, 'Name the storm (for example "Dec 14 storm").', undefined, { name: 'Required' })
    if (name.length > 120) return fail(c, 400, 'A storm name is at most 120 characters.', undefined, { name: 'Too long' })
    const storm = await startStorm(db, u.companyId, u.userId, { name, notes: b?.notes ? String(b.notes) : null })
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_storm', entityId: storm.id, entityName: storm.name, userId: u.userId, companyId: u.companyId })
    // "Start and dispatch" in one go: a target in the same request dispatches straight away.
    if (b?.target) {
      const r = await dispatchFor(c, storm, b.target, b.date, b.assignedToId)
      if ('error' in r) return fail(c, r.status, r.error)
      return one(c, { storm, ...r }, 201)
    }
    return one(c, { storm }, 201)
  })

  const dispatchFor = async (c: any, storm: any, target: any, dateIn: unknown, assignedToId: unknown): Promise<any> => {
    const u = c.get('user')
    const today = businessToday(await companyTimeZone(db, u.companyId)).toISOString().slice(0, 10)
    const date = dateIn ? String(dateIn) : today
    if (!DAY.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Pick the day to dispatch for (YYYY-MM-DD).', status: 400 }
    const r = await dispatchStorm(db, u.companyId, u.userId, storm, {
      routeId: target?.routeId ?? null, tag: target?.tag ?? null, contractIds: target?.contractIds ?? null, all: target?.all === true,
    }, { date, assignedToId: assignedToId === undefined ? undefined : (assignedToId ? String(assignedToId) : null) })
    if (r.error) return { error: r.error, status: r.error === 'Route not found' ? 404 : 400 }
    for (const m of r.made) d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.JOB_UPDATED, { id: m.jobId })
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'snow_storm', entityId: storm.id, entityName: `${storm.name} — dispatched ${r.made.length}`, userId: u.userId, companyId: u.companyId, metadata: { made: r.made.length, alreadyThere: r.alreadyThere, target } })
    return { made: r.made.length, alreadyThere: r.alreadyThere, stops: r.made }
  }

  app.post('/:id/dispatch', requirePermission(JOB_DISPATCH_PERMISSION), requirePermission('jobs:create'), async (c) => {
    const u = c.get('user')
    const storm = await getStorm(db, u.companyId, c.req.param('id'))
    if (!storm) return fail(c, 404, 'Storm not found')
    if (storm.status === 'ended') return fail(c, 409, 'This storm has ended.')
    const b: any = await c.req.json().catch(() => ({}))
    const r = await dispatchFor(c, storm, b?.target ?? {}, b?.date, b?.assignedToId)
    if ('error' in r) return fail(c, r.status, r.error)
    return one(c, r, 201)
  })

  app.get('/:id', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const storm = await getStorm(db, u.companyId, c.req.param('id'))
    if (!storm) return fail(c, 404, 'Storm not found')
    const money = await may(c, 'invoices:read')
    const own = !(await may(c, JOB_DISPATCH_PERMISSION))
    const stops = await stormStops(db, u.companyId, storm.id, own ? { assignedToId: u.userId } : {})
    return one(c, { storm, stops: stops.map((s: any) => shapeStop(s, money)) })
  })

  // ---- The crew's side ----

  app.post('/stops/:stopId/start', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const stop = await stopById(u.companyId, c.req.param('stopId'))
    if (!stop) return fail(c, 404, 'Storm stop not found')
    if (!(await mayWork(c, stop))) return fail(c, 403, 'This stop is on another crew.')
    const r = await startStormStop(db, u.companyId, stop.id)
    if (!r) return fail(c, 404, 'Storm stop not found')
    afterJob(u, r.job, 'onStart')
    return one(c, { stop: r.stop, started: r.started })
  })

  app.post('/stops/:stopId/log', requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const stop = await stopById(u.companyId, c.req.param('stopId'))
    if (!stop) return fail(c, 404, 'Storm stop not found')
    if (!(await mayWork(c, stop))) return fail(c, 403, 'This stop is on another crew.')
    const b: any = await c.req.json().catch(() => ({}))
    const r = await logStormStop(db, u.companyId, u.userId, stop.id, b)
    if ('error' in r) return fail(c, r.status, r.error)
    afterJob(u, r.job, 'onComplete')
    if (!r.alreadyLogged) audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_event', entityId: r.event.id, entityName: `Storm visit ($${r.event.billableAmount})`, userId: u.userId, companyId: u.companyId, metadata: { stormId: stop.stormId } })
    const money = await may(c, 'invoices:read')
    return one(c, { stop: r.stop, event: money ? r.event : withoutMoney(r.event), belowTrigger: r.belowTrigger, alreadyLogged: r.alreadyLogged }, r.alreadyLogged ? 200 : 201)
  })

  app.post('/stops/:stopId/skip', requirePermission(JOB_DISPATCH_PERMISSION), requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const r = await skipStormStop(db, u.companyId, c.req.param('stopId'), b?.note ? String(b.note) : null)
    if ('error' in r) return fail(c, r.status, r.error)
    return one(c, { stop: r.stop })
  })

  // ---- The office's side ----

  app.post('/:id/log-all', requirePermission(JOB_DISPATCH_PERMISSION), requirePermission('jobs:update'), async (c) => {
    const u = c.get('user')
    const storm = await getStorm(db, u.companyId, c.req.param('id'))
    if (!storm) return fail(c, 404, 'Storm not found')
    if (storm.status === 'ended') return fail(c, 409, 'This storm has ended.')
    const b: any = await c.req.json().catch(() => ({}))
    const only = Array.isArray(b?.stopIds) ? b.stopIds.map(String) : undefined
    const r = await logAllStormStops(db, u.companyId, u.userId, storm.id, b, only)
    for (const j of r.jobs) afterJob(u, j, 'onComplete')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'snow_storm', entityId: storm.id, entityName: `${storm.name} — logged ${r.logged.length}`, userId: u.userId, companyId: u.companyId, metadata: { logged: r.logged.length, failed: r.failed.length } })
    const money = await may(c, 'invoices:read')
    return one(c, { logged: r.logged.map((l) => (money ? l : { stopId: l.stopId, eventId: l.eventId, jobId: l.jobId })), failed: r.failed })
  })

  app.post('/:id/end', requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const u = c.get('user')
    const r = await endStorm(db, u.companyId, c.req.param('id'))
    if (!r) return fail(c, 404, 'Storm not found')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'snow_storm', entityId: r.storm.id, entityName: `${r.storm.name} — ended, ${r.skipped} left unserved`, userId: u.userId, companyId: u.companyId })
    return one(c, r)
  })

  // Bill the storm: every contract's visits logged in it, one draft invoice per contract. Without `confirm: true` it only reports.
  app.post('/:id/bill', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const storm = await getStorm(db, u.companyId, c.req.param('id'))
    if (!storm) return fail(c, 404, 'Storm not found')
    const b: any = await c.req.json().catch(() => ({}))
    const confirm = b?.confirm === true
    const today = businessToday(await companyTimeZone(db, u.companyId))
    const r = await billStorm(db, u.companyId, storm.id, { confirm, today })
    if (confirm && r.invoices) {
      audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: storm.id, entityName: `${storm.name} — ${r.invoices} draft invoice${r.invoices === 1 ? '' : 's'}`, userId: u.userId, companyId: u.companyId, metadata: { source: 'snow_storm', total: r.total } })
    }
    return one(c, { confirmed: confirm, ...r }, confirm && r.invoices ? 201 : 200)
  })

  return app
}
