// /api/visit-optimizer (row 15, care_visit_optimizer — hidden until the owner has tried it): AlayaCare's Visit Optimizer, for the
// office (care-schedule:update). The scheduler picks the vacant visits (a date range, optionally one client), sets how much each
// objective matters, runs it, reviews the proposals, and assigns the ones they keep — or offers them to the proposed caregivers
// through the open shift's own notify (POST /api/open-shifts/:id/notify), which the screen calls.
//
//   GET  /settings                         { weights, objectives: [{ key, label }] } — the agency's saved weights
//   PUT  /settings { weights }             each objective 0 (ignore) to 3 (matters most)
//   POST /run { startDate, endDate, clientId?, weights? }   → { proposals: [{ shift, best, alternatives, unfilledBecause }] }  (changes nothing)
//   POST /assign { assignments: [{ shiftId, caregiverId }] } → { results: [{ shiftId, status: 'assigned' | 'refused', reason? }] }
//
// Who may take a visit is the rule auto-fill and the suggestion list use (core/caregiverFit.ts: do-not-use, time off, unavailable,
// outside their hours; an expired credential the agency blocks; a clash; with care_match_prefs a must-have miss or beyond their
// travel limit). /assign checks each again at the moment of assigning, so a proposal that went stale is refused, not forced.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { caregiverFit, doNotUseOf } from '../core/caregiverFit.ts'
import { MATCH_PREFS_FEATURE, matchTraits } from '../core/matchTraits.ts'
import { DEFAULT_WEIGHTS, OBJECTIVES, OBJECTIVE_LABELS, normWeights, optimize, type OptCandidate, type OptShift } from '../core/visitOptimizer.ts'
import { addDays } from '../core/agencyTime.ts'
import {
  busyCaregiverIds, caregiversForSuggestions, clientForSuggestions, dayPlansInRange, hoursByCaregiver, markFilled, openShiftById,
  openShiftsToFill, visitCountsByClient,
} from '../../../data/homecareScheduling.ts'
import { distanceMiles } from './schedulingHub.ts'
import { weekStartOf, who, HttpError, type SchedulingShared } from './shared.ts'

export const VISIT_OPTIMIZER_FEATURE = 'care_visit_optimizer'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 31
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const hm = (t: string) => String(t).slice(0, 5)
const hoursOf = (s: string, e: string) => { const [a, b] = [s, e].map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }); return Math.max(0, (b - a) / 60) }

export function createVisitOptimizerRoutes(core: HomecareCore, d: CrmDeps, shared: SchedulingShared) {
  const app = new Hono<AppEnv>()
  const office = d.permissions.requirePermission('care-schedule:update')
  const db = d.db

  async function savedWeights(companyId: string) {
    const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return normWeights((row?.settings as any)?.visitOptimizer?.weights ?? DEFAULT_WEIGHTS)
  }

  app.get('/settings', office, async (c) => one(c, { weights: await savedWeights(who(c).companyId), objectives: OBJECTIVES.map((key) => ({ key, label: OBJECTIVE_LABELS[key] })) }))

  app.put('/settings', office, async (c) => {
    const { companyId } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const raw = b?.weights
    if (!raw || typeof raw !== 'object' || OBJECTIVES.some((k) => raw[k] !== undefined && !(Number.isInteger(Number(raw[k])) && Number(raw[k]) >= 0 && Number(raw[k]) <= 3))) {
      return fail(c, 400, 'Each objective is 0 (ignore) to 3 (matters most).', 'bad_weights')
    }
    const weights = normWeights({ ...(await savedWeights(companyId)), ...raw })
    const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = (row?.settings as any) || {}
    await db.update(company).set({ settings: { ...s, visitOptimizer: { ...(s.visitOptimizer || {}), weights } }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return one(c, { weights })
  })

  /** Every active caregiver for one vacant visit, with why they may not take it (null when they may). */
  async function candidatesBuilder(companyId: string, start: string, end: string) {
    const byDay = new Map<string, any[]>()
    const clients = new Map<string, any>()
    const busy = new Map<string, Set<string>>()
    const ws = weekStartOf(start)
    const weekly = await hoursByCaregiver(db, companyId, ws, addDays(weekStartOf(end), 6))
    const hist = await visitCountsByClient(db, companyId)
    const matchPrefs = await d.features.isFeatureEnabled(companyId, MATCH_PREFS_FEATURE)
    return async (sh: any): Promise<OptCandidate[]> => {
      if (!byDay.has(sh.shiftDate)) byDay.set(sh.shiftDate, await caregiversForSuggestions(db, companyId, WEEKDAYS[new Date(`${sh.shiftDate}T12:00:00Z`).getUTCDay()], sh.shiftDate))
      if (!clients.has(sh.clientId)) clients.set(sh.clientId, await clientForSuggestions(db, companyId, sh.clientId))
      const key = `${sh.shiftDate} ${sh.startTime} ${sh.endTime}`
      if (!busy.has(key)) busy.set(key, new Set(await busyCaregiverIds(db, companyId, sh.shiftDate, sh.startTime, sh.endTime)))
      const cgs = byDay.get(sh.shiftDate)!
      const client = clients.get(sh.clientId)
      const dnu = doNotUseOf(client)
      const noCert = await core.certReminders.blockedFor(companyId, cgs.map((x) => String(x.id)), sh.shiftDate)
      return cgs.map((cg) => {
        const fit = caregiverFit(cg, dnu, sh.startTime, sh.endTime)
        const dist = distanceMiles(cg.latitude, cg.longitude, client?.latitude, client?.longitude)
        const traits = matchPrefs && client ? matchTraits(client, cg, dist) : null
        const blocked = fit.blocks[0]
          ?? (noCert[String(cg.id)]?.length ? 'Expired credential' : null)
          ?? (busy.get(key)!.has(String(cg.id)) ? 'Already has a visit then' : null)
          ?? (traits?.hardMisses[0] ?? null)
          ?? (traits?.beyondTravel ? 'Beyond their travel limit' : null)
        return {
          id: String(cg.id), name: `${cg.firstName} ${cg.lastName}`, blocked, homeLat: cg.latitude, homeLng: cg.longitude,
          visitsWithClient: hist[sh.clientId]?.[cg.id] || 0, traitDelta: traits?.scoreDelta ?? 0, traitReasons: traits?.reasons ?? [],
          weeklyHours: weekly[cg.id] || 0, maxHours: Number(cg.maxHoursPerWeek) || 40,
        }
      })
    }
  }

  app.post('/run', office, async (c) => {
    const { companyId } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const today = await core.time.today(companyId)
    const start = DATE_RE.test(b?.startDate || '') ? b.startDate : today
    const end = DATE_RE.test(b?.endDate || '') ? b.endDate : addDays(today, 7)
    if (end < start) return fail(c, 400, 'The last day is before the first.', 'bad_range')
    if (end > addDays(start, MAX_DAYS)) return fail(c, 400, `At most ${MAX_DAYS} days at a time.`, 'range_too_long')
    const weights = b?.weights ? normWeights({ ...(await savedWeights(companyId)), ...b.weights }) : await savedWeights(companyId)
    let rows = await openShiftsToFill(db, companyId, start < today ? today : start, end)
    if (b?.clientId) rows = rows.filter((r: any) => r.clientId === String(b.clientId))
    const candidates = await candidatesBuilder(companyId, start, end)
    const plans = await dayPlansInRange(db, companyId, start, end)
    const dayOf = (cgId: string, date: string) => plans.filter((p) => p.caregiverId === cgId && p.date === date)
    const shifts: OptShift[] = rows.map((r: any) => ({ id: r.id, date: r.shiftDate, start: hm(r.startTime), end: hm(r.endTime), hours: hoursOf(hm(r.startTime), hm(r.endTime)), clientLat: r.clientLat, clientLng: r.clientLng }))
    const cands = new Map<string, OptCandidate[]>()
    for (const r of rows) cands.set(r.id, await candidates(r))
    const proposals = optimize(shifts, (s) => cands.get(s.id) || [], dayOf, weights)
    const byId = new Map(rows.map((r: any) => [r.id, r]))
    return one(c, {
      weights, startDate: start, endDate: end,
      proposals: proposals.map((p) => {
        const r: any = byId.get(p.shiftId)
        return { shift: { id: r.id, clientId: r.clientId, client: `${r.clientFirst} ${r.clientLast}`, date: r.shiftDate, startTime: hm(r.startTime), endTime: hm(r.endTime) }, best: p.best, alternatives: p.alternatives, unfilledBecause: p.unfilledBecause }
      }),
    })
  })

  app.post('/assign', office, async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const list = Array.isArray(b?.assignments) ? b.assignments.filter((a: any) => a && a.shiftId && a.caregiverId) : []
    if (!list.length) return fail(c, 400, 'Choose at least one visit to assign.', 'nothing_to_assign')
    if (list.length > 200) return fail(c, 400, 'At most 200 visits at once.', 'too_many')
    const results: any[] = []
    for (const a of list) {
      const os = await openShiftById(db, companyId, String(a.shiftId), true)
      if (!os) { results.push({ shiftId: a.shiftId, status: 'refused', reason: 'This visit is no longer open.' }); continue }
      // Checked again now: a proposal can go stale (someone else filled a clash, time off was approved).
      const cands = await (await candidatesBuilder(companyId, os.shiftDate, os.shiftDate))(os)
      const cg = cands.find((x) => x.id === String(a.caregiverId))
      if (!cg) { results.push({ shiftId: a.shiftId, status: 'refused', reason: 'That caregiver was not found.' }); continue }
      if (cg.blocked) { results.push({ shiftId: a.shiftId, status: 'refused', reason: cg.blocked }); continue }
      try {
        await shared.assignShift(companyId, os, cg.id, me)
        await markFilled(db, companyId, os.id, me, cg.id)
        results.push({ shiftId: a.shiftId, status: 'assigned', caregiverId: cg.id, caregiver: cg.name })
      } catch (e: any) {
        results.push({ shiftId: a.shiftId, status: 'refused', reason: e instanceof HttpError ? e.message : 'It could not be assigned.' })
      }
    }
    return one(c, { assigned: results.filter((r) => r.status === 'assigned').length, results })
  })

  return app
}
