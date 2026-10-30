// /api/schedules — one caregiver's shifts, creating a shift, reassigning it, the scoped delete and suspend / resume
// service. Moved from templates/crm-homecare/backend/src/routes/schedules.ts (ported there from the CVHC home care CRM).
//
// Permissions (care-schedule): reading a caregiver's shifts is care-schedule:read, which a caregiver holds — narrowed,
// as the template narrowed it, to their own; creating is :create, reassigning / suspending / resuming :update, the
// delete :delete (the template's requireAdmin: a caregiver holds none of them).
//
// Replies: rows are camelCase (RULEBOOK §2); the two shift lists are list replies ({ data, pagination }).
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { schedTs, hms, shiftHours, shiftTimesError, DATE_RE } from '../core/scheduleOccurrences.ts'
import { CANCEL_REASONS } from '../core/cancelReasons.ts'
import { addDays, ymdIn } from '../core/agencyTime.ts'
import {
  caregiverPatterns, movedInShifts, caregiverOccurrences, oneTimeTwin, insertSchedule, activeCaregiver, dateOverlap,
  setScheduleCaregiver, cancelOccurrence, endActivePattern, deactivateSchedules, endSchedules, activeScheduleClient,
  activeScheduleIdsForClient, suspendSchedules, resumeSchedules, type ScheduleTarget,
} from '../../../data/homecareScheduling.ts'
import { isCaregiver, who, type SchedulingShared } from './shared.ts'

const asList = (c: any, rows: any[]) => listAll(c, rows)

export function createSchedulesRoutes(core: HomecareCore, d: CrmDeps, shared: SchedulingShared) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  /** A caregiver may read only their own shifts; the office anyone's. */
  const ownOnly = (c: any, caregiverId: string) => {
    const { user, me } = who(c)
    return isCaregiver(d, user) && me !== caregiverId ? fail(c, 403, 'You can only view your own schedules') : null
  }

  // GET /api/schedules/caregiver/:caregiverId — used by the Schedule Hub.
  app.get('/caregiver/:caregiverId', perm('care-schedule:read'), async (c) => {
    const caregiverId = c.req.param('caregiverId')
    const refused = ownOnly(c, caregiverId); if (refused) return refused
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const rows = await caregiverPatterns(db, companyId, caregiverId, today, false)
    return asList(c, await core.schedules.attachExceptions(companyId, rows))
  })

  // GET /api/schedules/:caregiverId/occurrences?from&to — the caregiver's DATED visits between two days (inclusive, at
  // most 92), through the one schedule engine. A caregiver may read only their own; the office anyone's.
  app.get('/:caregiverId/occurrences', perm('care-schedule:read'), async (c) => {
    const caregiverId = c.req.param('caregiverId')
    const refused = ownOnly(c, caregiverId); if (refused) return refused
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const from = c.req.query('from') || today
    const to = c.req.query('to') || addDays(from, 13)
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) return fail(c, 400, 'from and to must be YYYY-MM-DD')
    if (to < from) return fail(c, 400, 'to must be on or after from')
    if (addDays(from, 91) < to) return fail(c, 400, 'At most 92 days at a time')
    const occurrences = await caregiverOccurrences(db, companyId, caregiverId, from, to)
    return one(c, { caregiverId, from, to, occurrences })
  })

  // GET /api/schedules/:caregiverId — the caregiver's own phone. Exceptions are attached so a cancelled visit never
  // shows (and never auto-clocks anyone in). ?includeMovedIn=1 adds shifts moved ONTO this caregiver for a single day
  // from someone else's pattern, as one-time shifts.
  app.get('/:caregiverId', perm('care-schedule:read'), async (c) => {
    const caregiverId = c.req.param('caregiverId')
    const refused = ownOnly(c, caregiverId); if (refused) return refused
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const out = await core.schedules.attachExceptions(companyId, await caregiverPatterns(db, companyId, caregiverId, today, true))
    if (String(c.req.query('includeMovedIn')) === '1') {
      const moved = await movedInShifts(db, companyId, caregiverId, today)
      out.push(...moved.map((r) => ({ ...r, exceptions: [] })))
    }
    return asList(c, out)
  })

  // POST /api/schedules — create a shift.
  app.post('/', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const { caregiverId, clientId, scheduleType, dayOfWeek, date, startTime, endTime, notes, effectiveDate, isTraining } = b
    if (!caregiverId || !clientId) return fail(c, 400, 'A caregiver and client are required.')
    const timesError = shiftTimesError(startTime, endTime, b.overnight)
    if (timesError) return fail(c, 400, timesError)

    const isRecurring = dayOfWeek !== null && dayOfWeek !== undefined && dayOfWeek !== ''
    if (!isRecurring && !(date && DATE_RE.test(date))) return fail(c, 400, 'A one-time shift needs its date (YYYY-MM-DD).')
    if (isRecurring && !(Number.isInteger(Number(dayOfWeek)) && Number(dayOfWeek) >= 0 && Number(dayOfWeek) <= 6)) {
      return fail(c, 400, 'dayOfWeek must be 0 (Sunday) to 6 (Saturday).')
    }

    // Advisory only — never blocks. Training shifts don't bill, so they don't touch the balance.
    const authCheck = isTraining ? { warnings: [] as string[] } : await shared.checkAuthorizationBalance(companyId, clientId, shiftHours(startTime, endTime))

    // A recurring pattern MUST have an effective date, never in the past: expansion would otherwise walk backwards and
    // back-bill / back-pay visits that never happened.
    const today = await core.time.today(companyId)
    const effDate = isRecurring ? ((effectiveDate && effectiveDate >= today) ? effectiveDate : today) : null
    const base = isRecurring ? effDate! : date

    // One-time duplicate guard: a double-submit returns the existing row instead of a billable twin.
    if (!isRecurring) {
      const existing = await oneTimeTwin(db, companyId, { caregiverId, clientId, date, start: hms(startTime)!, end: hms(endTime)! })
      if (existing) return one(c, { ...existing, duplicate: true, authWarnings: authCheck.warnings }, 200)
    }

    try {
      const id = await insertSchedule(db, companyId, {
        caregiverId, clientId, scheduleType: scheduleType || (isRecurring ? 'recurring' : 'one-time'),
        dayOfWeek: isRecurring ? Number(dayOfWeek) : null, date: isRecurring ? null : date,
        startTs: schedTs(startTime, base), endTs: schedTs(endTime, base), notes: notes || null, effectiveDate: effDate,
        isTraining: !!isTraining, frequency: 'weekly',
      })
      const row = await core.schedules.scheduleById(companyId, id)
      await core.notify.recordAudit(companyId, me, 'CREATE', 'schedules', id, null, row)
      // An expired credential is a flag for the office, never a refusal (credentialWarnings is [] unless the company has the reminders feature on).
      const credentialWarnings = (await core.certReminders.expiredFor(companyId, [String(caregiverId)], base))[String(caregiverId)] || []
      return one(c, { ...row, authWarnings: authCheck.warnings, credentialWarnings }, 201)
    } catch (e: any) {
      if (e?.code === '23505' || /unique|duplicate key/i.test(e?.message || '')) {
        return fail(c, 409, 'This caregiver already has this exact shift (same client, day, and time).', 'duplicate')
      }
      throw e
    }
  })

  // PUT /api/schedules/:id/reassign — hand the whole shift to another caregiver.
  app.put('/:id/reassign', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const id = c.req.param('id')
    const { newCaregiverId, reason } = await c.req.json().catch(() => ({})) as any
    if (!newCaregiverId) return fail(c, 400, 'newCaregiverId is required')
    const before = await core.schedules.scheduleById(companyId, id)
    if (!before) return fail(c, 404, 'Schedule not found')
    const cg = await activeCaregiver(db, companyId, newCaregiverId)
    if (!cg) return fail(c, 404, 'Caregiver not found or inactive')
    if (before.date && await dateOverlap(db, companyId, newCaregiverId, id, before.date, before.startTime, before.endTime)) {
      return fail(c, 400, `${cg.firstName} ${cg.lastName} has a conflicting schedule at this time`)
    }
    await setScheduleCaregiver(db, companyId, id, newCaregiverId)
    const after = await core.schedules.scheduleById(companyId, id)
    await core.notify.recordAudit(companyId, me, 'UPDATE', 'schedules', id, before, after, reason || null)
    return one(c, { success: true, schedule: after, message: `Schedule reassigned to ${cg.firstName} ${cg.lastName}` })
  })

  // DELETE /api/schedules/:scheduleId
  //   ?scope=this&date=YYYY-MM-DD[&cancelReason=]  cancel one occurrence (a 'cancelled' exception)
  //   ?scope=following&date=YYYY-MM-DD            end the recurring pattern the day before
  //   ?scope=all (default)  recurring: END it as of today, keeping every worked occurrence; one-time: remove the row
  //   ?scope=purge          erase the pattern including history (for a pattern made by mistake)
  //   &deletePair=true      also the other half of a split shift
  app.delete('/:scheduleId', perm('care-schedule:delete'), async (c) => {
    const { companyId, me: actor } = who(c)
    const scheduleId = c.req.param('scheduleId')
    const scope = c.req.query('scope') || 'all'
    const date = c.req.query('date')
    const reason = c.req.query('reason') || null
    const deletePair = c.req.query('deletePair') === 'true'

    const shift = await core.schedules.scheduleById(companyId, scheduleId)
    if (!shift) return fail(c, 404, 'Schedule not found')
    const isRecurring = shift.dayOfWeek !== null && shift.dayOfWeek !== undefined

    // A scoped delete must NEVER fall through to a destructive full delete.
    if (scope === 'this' || scope === 'following') {
      if (!isRecurring) return fail(c, 400, `scope='${scope}' is only valid for recurring shifts; this is a one-time shift. Use scope=all to delete it.`)
      if (!date || !DATE_RE.test(date)) return fail(c, 400, `scope='${scope}' requires a 'date' query param. Refusing to delete to avoid wiping the whole pattern.`)
    }
    if (!['this', 'following', 'all', 'purge'].includes(scope)) return fail(c, 400, `Invalid scope '${scope}'.`)

    if (scope === 'this') {
      const raw = c.req.query('cancelReason')
      const cancelReason = raw && CANCEL_REASONS[raw] ? raw : null // unknown values are dropped, not stored
      await cancelOccurrence(db, companyId, scheduleId, date!, actor, cancelReason)
      await core.notify.recordAudit(companyId, actor, 'CANCEL_OCCURRENCE', 'schedules', scheduleId, null, { date, cancelReason }, reason)
      return one(c, { message: 'Occurrence cancelled', date, scheduleId })
    }

    if (scope === 'following') {
      const endDate = addDays(date!, -1)
      await endActivePattern(db, companyId, scheduleId, endDate)
      const after = await core.schedules.scheduleById(companyId, scheduleId)
      await core.notify.recordAudit(companyId, actor, 'END_PATTERN', 'schedules', scheduleId, shift, after, reason)
      return one(c, { message: 'Recurring pattern ended', endDate, schedule: after })
    }

    const isSplitPair = !!(shift.isSplitShift && shift.splitShiftGroupId && deletePair)
    const target: ScheduleTarget = isSplitPair ? { splitGroup: shift.splitShiftGroupId } : { id: scheduleId }

    if (scope === 'purge') {
      const ids = await deactivateSchedules(db, companyId, target)
      for (const id of ids) await core.notify.recordAudit(companyId, actor, 'DELETE', 'schedules', id, shift, null, reason)
      return one(c, { message: 'Schedule permanently removed (history included)', deletedCount: ids.length })
    }

    // scope=all on a recurring pattern: END it today; past occurrences stay visible and billable.
    if (isRecurring) {
      const today = await core.time.today(companyId)
      const endStr = addDays(today, -1)
      // A pattern with no effective date started the day it was made — on the agency's clock, not UTC's.
      const effStr = shift.effectiveDate || (shift.createdAt ? ymdIn(new Date(shift.createdAt), await core.time.timezone(companyId)) : today)
      if (endStr < effStr) {
        // It had not started yet — nothing to protect, remove it outright.
        const ids = await deactivateSchedules(db, companyId, target)
        for (const id of ids) await core.notify.recordAudit(companyId, actor, 'DELETE', 'schedules', id, shift, null, reason)
        return one(c, { message: 'Recurring schedule removed (had not started; no past occurrences)', deletedCount: ids.length })
      }
      const ids = await endSchedules(db, companyId, target, endStr)
      for (const id of ids) await core.notify.recordAudit(companyId, actor, 'END_PATTERN', 'schedules', id, shift, { end_date: endStr }, reason)
      return one(c, { message: 'Recurring pattern ended today; past occurrences kept', endDate: endStr, pastKept: true, deletedCount: ids.length })
    }

    const ids = await deactivateSchedules(db, companyId, target)
    for (const id of ids) await core.notify.recordAudit(companyId, actor, 'DELETE', 'schedules', id, shift, null, reason)
    return one(c, {
      message: isSplitPair ? 'Split shift pair deleted' : 'Schedule deleted',
      deletedCount: ids.length,
      wasSplitShift: !!shift.isSplitShift,
      splitShiftGroupId: shift.splitShiftGroupId || null,
    })
  })

  // ── SUSPEND / RESUME SERVICE ─────────────────────────────────────────────────────────────
  // Pause a client's service without deleting anything: schedules.suspended_from makes the engine stop generating
  // visits on/after that date (so billing, payroll, reminders and no-show all stop) while already-worked visits before
  // it stay. Resume clears the date and the schedule returns as it was.
  //   scope='this' — just this schedule; scope='client' — every active schedule of this client.
  async function resolveScopeIds(companyId: string, scheduleId: string, scope: string) {
    const cur = await activeScheduleClient(db, companyId, scheduleId)
    if (!cur) return null
    if (scope === 'client') return { clientId: cur.clientId, ids: await activeScheduleIdsForClient(db, companyId, cur.clientId) }
    return { clientId: cur.clientId, ids: [scheduleId] }
  }

  async function fromDateOf(companyId: string, body: any): Promise<string | null> {
    const v = body?.fromDate || await core.time.today(companyId)
    return DATE_RE.test(String(v)) ? String(v) : null
  }

  app.post('/:id/suspend', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const scope = String(body.scope || 'this').toLowerCase()
    if (!['this', 'client'].includes(scope)) return fail(c, 400, "scope must be 'this' or 'client'.")
    const fromDate = await fromDateOf(companyId, body)
    if (!fromDate) return fail(c, 400, 'fromDate must be YYYY-MM-DD.')
    const scoped = await resolveScopeIds(companyId, c.req.param('id'), scope)
    if (!scoped) return fail(c, 404, 'Schedule not found')
    const ids = await suspendSchedules(db, companyId, { ids: scoped.ids }, fromDate)
    for (const id of ids) await core.notify.recordAudit(companyId, me, 'SUSPEND', 'schedules', id, null, { scope, suspended_from: fromDate }, body.reason || null)
    return one(c, { suspended: ids.length, scope, fromDate, clientId: scoped.clientId, scheduleIds: ids })
  })

  app.post('/:id/resume', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const scope = String(body.scope || 'this').toLowerCase()
    if (!['this', 'client'].includes(scope)) return fail(c, 400, "scope must be 'this' or 'client'.")
    const scoped = await resolveScopeIds(companyId, c.req.param('id'), scope)
    if (!scoped) return fail(c, 404, 'Schedule not found')
    const ids = await resumeSchedules(db, companyId, { ids: scoped.ids })
    for (const id of ids) await core.notify.recordAudit(companyId, me, 'RESUME', 'schedules', id, null, { scope }, body.reason || null)
    return one(c, { resumed: ids.length, scope, clientId: scoped.clientId, scheduleIds: ids })
  })

  // Client-scoped — the Clients screen works on a client, not a schedule id.
  app.post('/client/:clientId/suspend', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const fromDate = await fromDateOf(companyId, body)
    if (!fromDate) return fail(c, 400, 'fromDate must be YYYY-MM-DD.')
    const clientId = c.req.param('clientId')
    const ids = await suspendSchedules(db, companyId, { clientId }, fromDate)
    for (const id of ids) await core.notify.recordAudit(companyId, me, 'SUSPEND', 'schedules', id, null, { scope: 'client', suspended_from: fromDate }, body.reason || null)
    return one(c, { suspended: ids.length, fromDate, clientId, scheduleIds: ids })
  })

  app.post('/client/:clientId/resume', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const clientId = c.req.param('clientId')
    const ids = await resumeSchedules(db, companyId, { clientId })
    for (const id of ids) await core.notify.recordAudit(companyId, me, 'RESUME', 'schedules', id, null, { scope: 'client' }, body.reason || null)
    return one(c, { resumed: ids.length, clientId, scheduleIds: ids })
  })

  return app
}
