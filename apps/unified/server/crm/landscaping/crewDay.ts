// /api/crew-day — the crew's day on the phone and the office's side of it (landscaping parity rows 11–15). Each part is its own
// switch, all not ready (hidden): crew_day_map (the map of the day and the Finish Day recap), visit_skip ("Couldn't do it"),
// visit_materials (materials used), crew_timers (each person's clock and the Crew Score). The mount asks recurring_routes; each
// route also asks its own. A crew seat reaches only its own visits (crm/roof/seatJob.ts — assigned, or on the crew); the office's
// lists ask jobs:dispatch. Rules and reads: data/crewDay.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll, done } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { JOB_DISPATCH_PERMISSION } from '@twomiah/tenant-backend'
import { canSeeWith } from '../deps.ts'
import { createSeatJob } from '../roof/seatJob.ts'
import {
  SKIP_REASONS, SKIP_REASON_LABELS, addMaterial, clockCrew, crewOf, crewScore, dayMapUrl, dayOf, dayRecap, dayVisits, isDay, materialsOf,
  nextStop, openSkips, openSkipsOf, placeOf, pricebookCost, removeMaterial, resolveSkip, skipVisit,
} from '../../data/crewDay.ts'

export const CREW_DAY_FEATURES = { map: 'crew_day_map', skip: 'visit_skip', materials: 'visit_materials', timers: 'crew_timers' } as const

/** The moment the phone says it was tapped (a save kept with no signal), if it is believable; else now. */
const tappedAt = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) && t <= Date.now() + 5 * 60_000 && t >= Date.now() - 7 * 86_400_000 ? new Date(t) : new Date()
}

const skipBody = z.object({
  reason: z.enum(SKIP_REASONS, { error: 'Pick why the visit could not be done.' }),
  note: z.string().trim().max(500, 'A note is 500 characters at most.').optional(),
  rebook: z.boolean().default(true),
  tappedAt: z.string().optional(),
})
const materialBody = z.object({
  name: z.string().trim().max(120, 'A material name is 120 characters at most.').optional(),
  pricebookItemId: z.string().trim().max(64).optional(),
  quantity: z.number({ error: 'Say how much was used.' }).positive('Say how much was used.').max(100_000, 'That is more than one visit uses.'),
  unit: z.string().trim().max(20).optional(),
  entryKey: z.string().trim().regex(/^[A-Za-z0-9_:-]{4,80}$/).optional(),
})

export function createCrewDayRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const gate = d.features.requireEnabledFeature
  const canSee = canSeeWith(d.permissions)
  const seatJob = createSeatJob(d)
  const app = new Hono<AppEnv>()
  const seesAll = async (c: any) => { const u = c.get('user'); try { return !!(await canSee(u.role, 'jobs:read-all', u.userId)) } catch { return false } }

  /** The seat's day: its visits in order, numbered, which are skipped, the next stop, and the recap. */
  const theDay = async (c: any) => {
    const u = c.get('user')
    const { tz, date } = await dayOf(db, u.companyId, c.req.query('date'))
    const visits: any[] = await dayVisits(db, u.companyId, String(u.userId), await seesAll(c), date, tz)
    const skips = await openSkipsOf(db, u.companyId, visits.map((v) => v.id))
    const skipped = new Set(skips.map((s: any) => s.jobId))
    const stops = visits.map((v, i) => ({ ...v, n: i + 1, place: placeOf(v), skipped: skipped.has(v.id) }))
    return { date, tz, stops, nextId: nextStop(stops) }
  }

  // ── the day, its map and its recap (crew_day_map; rows 11 and 14) ──
  app.get('/day', requirePermission('jobs:read'), gate(CREW_DAY_FEATURES.map), async (c) => {
    const u = c.get('user')
    const day = await theDay(c)
    const notesOn = await d.features.isFeatureEnabled(u.companyId, 'visit_reports')
    const recap = await dayRecap(db, u.companyId, day.stops, notesOn)
    return one(c, {
      date: day.date, nextId: day.nextId,
      stops: day.stops.map((s) => ({ id: s.id, n: s.n, number: s.number, title: s.title, name: s.contactName || s.title || s.number, status: s.status, scheduledTime: s.scheduledTime, place: s.place, skipped: s.skipped })),
      recap, mapReady: !!process.env.GOOGLE_MAPS_API_KEY,
    })
  })

  // The map as a picture (Google Static Maps with the server's key — the key never reaches the phone).
  app.get('/day/map', requirePermission('jobs:read'), gate(CREW_DAY_FEATURES.map), async (c) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || ''
    if (!key) return fail(c, 409, 'The map is not set up for this business yet. The stops are listed below it.', 'MAP_NOT_SET_UP')
    const day = await theDay(c)
    const url = dayMapUrl(day.stops, day.nextId, key)
    if (!url) return fail(c, 404, 'No stops with an address on this day.', 'NO_STOPS')
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const type = res.headers.get('content-type') || ''
      if (!res.ok || !type.startsWith('image/')) return fail(c, 502, 'Google did not send the map. Try again in a moment.', 'MAP_UNAVAILABLE')
      return c.body(new Uint8Array(await res.arrayBuffer()), 200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=60' })
    } catch { return fail(c, 502, 'Google could not be reached for the map.', 'MAP_UNAVAILABLE') }
  })

  // ── "Couldn't do it" (visit_skip; row 12) ──
  app.get('/skip-reasons', requirePermission('jobs:read'), gate(CREW_DAY_FEATURES.skip), (c) => listAll(c, SKIP_REASONS.map((id) => ({ id, label: SKIP_REASON_LABELS[id] }))))

  app.post('/visits/:jobId/skip', requirePermission('jobs:update'), gate(CREW_DAY_FEATURES.skip), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    const parsed = skipBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const b = parsed.data
    const r: any = await skipVisit(db, u.companyId, String(u.userId), j.id, { reason: b.reason, note: b.note || null, rebook: b.rebook, at: tappedAt(b.tappedAt) })
    if (r.error === 404) return fail(c, 404, 'Visit not found')
    if (r.error === 409) return fail(c, 409, r.status === 'completed' ? 'This visit is already finished, so it cannot be marked as not done.' : 'This visit is cancelled.', 'VISIT_CLOSED')
    if (!r.again) audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'job', entityId: j.id, entityName: j.title, userId: u.userId, companyId: u.companyId, metadata: { couldNotDo: b.reason, rebook: b.rebook } })
    return one(c, { id: r.skip.id, jobId: j.id, reason: r.skip.reason, rebook: r.skip.rebook, status: 'on_hold' }, r.again ? 200 : 201)
  })

  app.get('/skips', requirePermission(JOB_DISPATCH_PERMISSION), gate(CREW_DAY_FEATURES.skip), async (c) => {
    const u = c.get('user')
    const rows: any[] = await openSkips(db, u.companyId)
    return listAll(c, rows.map((r) => ({ ...r, reasonLabel: SKIP_REASON_LABELS[r.reason as keyof typeof SKIP_REASON_LABELS] ?? 'Other', by: [r.byFirst, r.byLast].filter(Boolean).join(' ') || null })))
  })

  app.post('/skips/:id/rebook', requirePermission(JOB_DISPATCH_PERMISSION), gate(CREW_DAY_FEATURES.skip), async (c) => {
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    if (!isDay(b?.date)) return fail(c, 400, 'Pick the day to rebook the visit to.', undefined, { date: 'Pick the day to rebook the visit to.' })
    const r: any = await resolveSkip(db, u.companyId, String(u.userId), c.req.param('id'), { rebookTo: b.date })
    if (r.error === 404) return fail(c, 404, 'Not found')
    if (r.error === 409) return fail(c, 409, 'This has already been dealt with.')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'job', entityId: r.skip.jobId, userId: u.userId, companyId: u.companyId, metadata: { rebookedTo: b.date } })
    return one(c, { id: r.skip.id, resolution: r.skip.resolution, rebookedTo: r.skip.rebookedTo })
  })

  app.post('/skips/:id/close', requirePermission(JOB_DISPATCH_PERMISSION), gate(CREW_DAY_FEATURES.skip), async (c) => {
    const u = c.get('user')
    const r: any = await resolveSkip(db, u.companyId, String(u.userId), c.req.param('id'), { close: true })
    if (r.error === 404) return fail(c, 404, 'Not found')
    if (r.error === 409) return fail(c, 409, 'This has already been dealt with.')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'job', entityId: r.skip.jobId, userId: u.userId, companyId: u.companyId, metadata: { notRebooked: true } })
    return one(c, { id: r.skip.id, resolution: r.skip.resolution })
  })

  // ── Materials used (visit_materials; row 13) ──
  app.get('/visits/:jobId/materials', requirePermission('jobs:read'), gate(CREW_DAY_FEATURES.materials), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    const rows: any[] = await materialsOf(db, u.companyId, j.id)
    return listAll(c, rows.map((r) => ({ id: r.id, name: r.name, quantity: Number(r.quantity), unit: r.unit })))
  })

  app.post('/visits/:jobId/materials', requirePermission('jobs:update'), gate(CREW_DAY_FEATURES.materials), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    const parsed = materialBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const b = parsed.data
    // From the price book: its name, unit and what it costs us. Typed in: the name and unit as typed, no cost.
    const book = b.pricebookItemId ? await pricebookCost(db, u.companyId, b.pricebookItemId) : null
    if (b.pricebookItemId && !book) return fail(c, 404, 'That item is not in the price book.')
    const name = book?.name || b.name
    if (!name) return fail(c, 400, 'Name the material, or pick it from the price book.', undefined, { name: 'Name the material.' })
    const r = await addMaterial(db, u.companyId, String(u.userId), j.id, { name, quantity: b.quantity, unit: b.unit || book?.unit || null, unitCostCents: book ? book.cents : null, pricebookItemId: b.pricebookItemId || null, entryKey: b.entryKey || null })
    if (!r.row) return fail(c, 409, 'The material could not be saved. Try again.')
    return one(c, { id: r.row.id, name: r.row.name, quantity: Number(r.row.quantity), unit: r.row.unit }, r.again ? 200 : 201)
  })

  app.delete('/visits/:jobId/materials/:id', requirePermission('jobs:update'), gate(CREW_DAY_FEATURES.materials), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    const gone = await removeMaterial(db, u.companyId, j.id, c.req.param('id'))
    return gone ? done(c) : fail(c, 404, 'Not found')
  })

  // ── Each person's clock on a visit, and the Crew Score (crew_timers; row 15) ──
  app.get('/visits/:jobId/crew', requirePermission('jobs:read'), gate(CREW_DAY_FEATURES.timers), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    return listAll(c, (await crewOf(db, u.companyId, j.id)) || [])
  })

  app.post('/visits/:jobId/crew/:key/:action{start|stop}', requirePermission('jobs:update'), gate(CREW_DAY_FEATURES.timers), async (c) => {
    const u = c.get('user')
    const j = await seatJob(c, c.req.param('jobId'))
    if (!j) return fail(c, 404, 'Visit not found')
    const crew = (await crewOf(db, u.companyId, j.id)) || []
    const who = crew.find((p) => p.key === c.req.param('key'))
    if (!who) return fail(c, 404, 'That person is not on this visit.')
    const b: any = await c.req.json().catch(() => ({}))
    const r = await clockCrew(db, u.companyId, String(u.userId), j.id, { userId: who.userId, memberId: who.memberId }, c.req.param('action') as 'start' | 'stop', tappedAt(b?.tappedAt))
    const now = (await crewOf(db, u.companyId, j.id))!.find((p) => p.key === who.key)!
    return one(c, { ...now, changed: r.changed })
  })

  app.get('/score', requirePermission(JOB_DISPATCH_PERMISSION), gate(CREW_DAY_FEATURES.timers), async (c) => {
    const u = c.get('user')
    const from = c.req.query('from'), to = c.req.query('to')
    if (!isDay(from) || !isDay(to) || from > to) return fail(c, 400, 'Pick a from and a to day, from first.')
    const { tz } = await dayOf(db, u.companyId)
    return listAll(c, await crewScore(db, u.companyId, from, to, tz))
  })

  return app
}
