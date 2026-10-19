// /api/shift-swaps — a caregiver asks a coworker to take ONE day of their shift; the coworker answers; the office
// approves. Moved from templates/crm-homecare/backend/src/routes/shiftSwaps.ts (ported there from the CVHC CRM's
// shiftSwapsRoutes.js, with the gating it lacked).
//
// Permissions (care-schedule): listing, asking, answering and withdrawing are :read, which a caregiver holds — narrowed
// as the template narrowed them (a caregiver sees only swaps they are in, asks only for their own visit, answers only a
// swap they were asked, withdraws only their own); approve / reject are :update (the template's requireAdmin).
//
// Replies: swaps are camelCase (requesterId, requestingCaregiverId, targetId, shiftDate, …); the list is a list reply
// ({ data, pagination }); the 409 on a swap already waiting is { error, code: 'swap_pending' }.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { DATE_RE } from '../core/scheduleOccurrences.ts'
import { addDays } from '../core/agencyTime.ts'
import {
  swapById, listSwaps, activeScheduleBasics, nextOccurrenceDate, occurrenceOn, openSwapFor, insertSwap, answerSwap,
  scheduleOwner, coverDate, setActiveScheduleCaregiver, reviewSwap, withdrawSwap,
} from '../../../data/homecareScheduling.ts'
import { isCaregiver, who } from './shared.ts'

export function createShiftSwapsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // GET /api/shift-swaps?status&caregiverId
  app.get('/', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const { status, caregiverId } = c.req.query()
    const rows = await listSwaps(db, companyId, { status: status || undefined, who: isCaregiver(d, user) ? me : (caregiverId || null) })
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // POST /api/shift-swaps { scheduleId, targetCaregiverId, reason, shiftDate? }
  // A swap is always about ONE day. A recurring pattern has no date, so when the caller does not say which, the request
  // is pinned to the NEXT upcoming occurrence — the one the caregiver is looking at.
  app.post('/', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const office = !isCaregiver(d, user)
    const b = await c.req.json().catch(() => ({})) as any
    const requester = office && (b.requestingCaregiverId || b.requesterId) ? String(b.requestingCaregiverId || b.requesterId) : me
    const target = b.targetCaregiverId || b.targetId || null
    if (!b.scheduleId) return fail(c, 400, 'scheduleId is required')
    const sch = await activeScheduleBasics(db, companyId, b.scheduleId)
    if (!sch) return fail(c, 404, 'Schedule not found')
    const isRecurring = sch.dayOfWeek !== null && sch.dayOfWeek !== undefined

    let shiftDate: string | null = b.shiftDate || sch.date || null
    if (shiftDate && !DATE_RE.test(shiftDate)) return fail(c, 400, 'shiftDate must be YYYY-MM-DD')
    if (isRecurring && !shiftDate) {
      const today = await core.time.today(companyId)
      shiftDate = await nextOccurrenceDate(db, companyId, b.scheduleId, today, addDays(today, 90))
      if (!shiftDate) return fail(c, 400, 'This shift has no upcoming occurrences to swap.')
    }
    // The day's real owner and times (a covered day belongs to the covering caregiver).
    const occ = await occurrenceOn(db, companyId, b.scheduleId, shiftDate!)
    if (!occ) return fail(c, 400, 'That shift has no visit on that date.')
    if (!office && occ.caregiverId !== requester) return fail(c, 403, 'You can only swap your own shifts')
    if (target && target === requester) return fail(c, 400, 'Pick a different caregiver to take the shift')
    // One open swap per visit day (pending, or accepted and waiting on the office) — as a Move is.
    if (await openSwapFor(db, companyId, b.scheduleId, shiftDate!)) return fail(c, 409, 'A swap for this visit is already waiting for an answer.', 'swap_pending')

    const id = await insertSwap(db, companyId, {
      scheduleId: b.scheduleId, requesterId: requester, targetId: target, clientId: occ.clientId, date: shiftDate!,
      start: occ.startTime, end: occ.endTime, reason: b.reason || null,
    })
    if (target) await core.notify.notifyUser(companyId, target, 'shift_swap_request', 'Shift swap request', `A coworker is asking you to take their ${shiftDate} shift (${occ.startTime.slice(0, 5)}–${occ.endTime.slice(0, 5)}).`)
    return one(c, await swapById(db, companyId, id), 201)
  })

  // PUT /api/shift-swaps/:id/respond { accepted, notes } — only the target caregiver answers.
  app.put('/:id/respond', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const s = await swapById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Swap request not found')
    if (isCaregiver(d, user) && s.targetId !== me) return fail(c, 403, 'Only the caregiver asked can answer this swap')
    if (s.status !== 'pending') return fail(c, 400, `This swap is already ${s.status}`)
    const { accepted, notes } = await c.req.json().catch(() => ({})) as any
    await answerSwap(db, companyId, s.id, !!accepted, notes || null)
    return done(c)
  })

  // PUT /api/shift-swaps/:id/approve — the office approves an ACCEPTED swap.
  app.put('/:id/approve', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const s = await swapById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Swap request not found')
    if (s.status !== 'accepted') return fail(c, 400, 'Swap must be accepted by target caregiver first')
    if (!s.targetId) return fail(c, 400, 'This swap names no caregiver to take the shift.')
    const sched = s.scheduleId ? await scheduleOwner(db, companyId, s.scheduleId) : null
    if (!sched || sched.isActive === false) return fail(c, 409, 'The original schedule was deleted or modified; swap can no longer be approved.')
    if (sched.caregiverId !== s.requesterId && sched.caregiverId !== s.targetId) {
      return fail(c, 409, 'The schedule was reassigned to a different caregiver; swap can no longer be approved.')
    }
    const isRecurring = sched.dayOfWeek !== null && sched.dayOfWeek !== undefined
    if (isRecurring) {
      // ONE day: a per-date override. Reassigning the pattern would hand every future week away.
      if (!s.shiftDate) return fail(c, 400, 'This swap request has no shift date, so it cannot be applied to a single occurrence. Ask the caregiver to resubmit it.')
      await coverDate(db, companyId, s.scheduleId, s.shiftDate, s.targetId, me, false)
    } else if (!(await setActiveScheduleCaregiver(db, companyId, s.scheduleId, s.targetId))) {
      return fail(c, 409, 'Schedule changed during approval. Try again.')
    }
    await reviewSwap(db, companyId, s.id, 'approved', me)
    await core.notify.recordAudit(companyId, me, 'APPROVE', 'shift_swaps', s.id, s, { status: 'approved' })
    await core.notify.notifyUser(companyId, s.requesterId, 'shift_swap_approved', 'Shift swap approved', `Your ${s.shiftDate} shift is now covered.`)
    await core.notify.notifyUser(companyId, s.targetId, 'shift_swap_approved', 'Shift swap approved', `The ${s.shiftDate} shift is on your schedule.`)
    return done(c)
  })

  // PUT /api/shift-swaps/:id/reject { reason }
  app.put('/:id/reject', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const s = await swapById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Swap request not found')
    const { reason } = await c.req.json().catch(() => ({})) as any
    await reviewSwap(db, companyId, s.id, 'rejected', me, reason || null)
    return done(c)
  })

  // PUT /api/shift-swaps/:id/cancel — the requester (or the office) withdraws it
  app.put('/:id/cancel', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const s = await swapById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Swap request not found')
    if (isCaregiver(d, user) && s.requesterId !== me) return fail(c, 403, 'Only the caregiver who asked can withdraw this swap')
    await withdrawSwap(db, companyId, s.id)
    return done(c)
  })

  return app
}
