// /api/open-shifts — the open shift board. The office posts a visit (optionally offered only to caregivers it picks,
// optionally "first to accept gets it"); caregivers accept; the office approves, turns down, smart-fills or cancels.
// Moved from templates/crm-homecare/backend/src/routes/openShifts.ts (ported there from the CVHC CRM's
// openShiftsRoutes.js). Filling a visit (assignShift) is in ./shared.ts: the Schedule Hub's auto-fill uses it too.
//
// Permissions (care-schedule): what a caregiver may see (/available) and accepting a shift (/:id/claim) are :read,
// which a caregiver holds — narrowed as the template narrowed them (offered to them; they claim for themselves);
// posting is :create; the rest of the office's board (the board, who is free, approve / reject / cancel / smart-fill /
// broadcast / notify / claims) is :update — the template's requireAdmin, which a caregiver holds none of.
//
// Replies: open shifts are camelCase (shiftDate, startTime, claimedById, claimedBy, visibleTo …); the board, /available,
// /caregivers-available, /:id/eligible-caregivers and /:id/claims are list replies ({ data, pagination }). The two
// refusals that carried a record (the 409 on a visit already posted) are { error, code: 'already_posted' }.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, shiftHours, DATE_RE } from '../core/scheduleOccurrences.ts'
import {
  openShiftById, openShiftWithClient, caregiversForSlot, availableOpenShifts, openShiftBoard, insertOpenShift, scheduleForPosting,
  occurrenceOn, livePostingFor, payerCurrentRate, hasOverlap, claimOpenShift, insertClaim, personName, clientName, markFilled,
  approveClaims, reopenShift, cancelPosting, eligibleForShift, personPhone, recordShiftNotice,
  markNotified, claimsForShift, caregiversForSuggestions, clientForSuggestions,
} from '../../../data/homecareScheduling.ts'
import { seriesPostings } from '../../../data/homecareOpenOffers.ts'
import { eligibleToTell } from './openShiftEligibility.ts'
import { caregiverFit, doNotUseOf } from '../core/caregiverFit.ts'
import { HttpError, isCaregiver, who, type SchedulingShared } from './shared.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'

const fmtHm = (t: string) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const clientShort = (first: string | undefined, last: string | undefined) => `${first || ''} ${String(last || '').charAt(0)}.`.trim()
const asList = (c: any, rows: any[]) => listAll(c, rows)

export function createOpenShiftsRoutes(core: HomecareCore, d: CrmDeps, shared: SchedulingShared) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  async function authWarnings(companyId: string, s: any): Promise<string[]> {
    try { return (await shared.checkAuthorizationBalance(companyId, s.clientId, shiftHours(s.startTime, s.endTime))).warnings } catch { return [] }
  }


  /**
   * Tell caregivers about an open shift through the paths the office already has: an in-app notice, a phone push, and (when
   * asked) a text from the agency's own number. Returns who was really reached — a caller never says "sent" for a count
   * it did not deliver. POST /:id/notify (the office picks) and POST /:id/broadcast (everyone eligible) both use it.
   */
  async function tellCaregivers(companyId: string, s: any, caregiverIds: string[], opts: { customMessage?: string; sms?: boolean; email?: boolean }) {
    // care_open_shift_offers: every channel honours each person's notification settings and every message is kept in the outbox.
    if (await core.openShiftOffers.enabled(companyId)) {
      const visits = s.seriesId ? (await seriesPostings(db, companyId, s.seriesId)).filter((x: any) => x.status === 'open').length : null
      const r = await core.openShiftOffers.send(companyId, { ...s, seriesVisits: visits }, caregiverIds, { channels: ['app', 'push', ...(opts.sms ? ['sms' as const] : []), ...(opts.email ? ['email' as const] : [])], customMessage: opts.customMessage })
      return r
    }
    const bonus = parseFloat(s.bonusAmount) > 0 ? ` (+$${Number(s.bonusAmount).toFixed(2)} bonus)` : ''
    const title = `Open Shift: ${s.clientFirst || ''} ${s.clientLast || ''}`.trim()
    const base = `${fmtDay(s.shiftDate)} ${String(s.startTime).slice(0, 5)}–${String(s.endTime).slice(0, 5)}${bonus}. Open the app to claim it.`
    const message = opts.customMessage ? `${opts.customMessage}\n\n${base}` : base
    const prefix = await core.profile.agencyShortName(companyId)
    const smsBody = `${prefix ? prefix + ': ' : ''}Open shift ${fmtDay(s.shiftDate)} ${fmtHm(s.startTime)}-${fmtHm(s.endTime)} with ${clientShort(s.clientFirst, s.clientLast)}. Open the app > Open Shifts to accept.${opts.customMessage ? ' ' + opts.customMessage : ''}`

    let notified = 0, texted = 0
    for (const cgId of caregiverIds) {
      if (opts.sms) {
        const phone = await personPhone(db, companyId, cgId)
        if (phone && await core.notify.sendText({ companyId, phone, body: smsBody })) texted++
      }
      try {
        await core.notify.notifyUser(companyId, cgId, 'open_shift_offer', title, message)
        await recordShiftNotice(db, companyId, s.id, cgId)
        await core.notify.sendPush(cgId, { title, body: message, tag: `open-shift-${s.id}`, data: { type: 'open_shift_offer', openShiftId: s.id } })
        notified++
      } catch (e: any) { d.logger.error('[open-shifts] notify', { caregiverId: cgId, error: e?.message }) }
    }
    if (notified > 0) await markNotified(db, companyId, s.id)
    return { notified, texted, total: caregiverIds.length }
  }

  // GET /api/open-shifts/caregivers-available?date&startTime&endTime&excludeScheduleId
  // Who could take a slot BEFORE an open shift exists ("Mark Available"). Busy = an occurrence that day overlapping the
  // slot (recurring visits included, cancelled ones not). Approved time off and blackout dates count as not available.
  app.get('/caregivers-available', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { date, startTime, endTime, excludeScheduleId } = c.req.query()
    if (!date || !startTime || !endTime || !DATE_RE.test(date) || !hms(startTime) || !hms(endTime)) {
      return fail(c, 400, 'date, startTime, and endTime are required')
    }
    const rows = await caregiversForSlot(db, companyId, date, hms(startTime)!, hms(endTime)!, excludeScheduleId || null)
    const ids = rows.map((r) => String(r.id))
    const expired = await core.certReminders.expiredFor(companyId, ids, date)
    const noCert = await core.certReminders.blockedFor(companyId, ids, date)
    return asList(c, rows.map((r) => ({
      id: r.id, firstName: r.firstName, lastName: r.lastName, phone: r.phone, email: r.email,
      available: !r.hasConflict && !r.timeOff && !noCert[String(r.id)], busy: !!r.hasConflict, timeOff: !!r.timeOff, notified: false,
      expiredCertifications: expired[String(r.id)] || [], blockedByCredential: !!noCert[String(r.id)],
    })))
  })

  // GET /api/open-shifts/available — what a caregiver may see: open, today or later, and either offered to everyone or
  // offered to them.
  app.get('/available', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const today = await core.time.today(companyId)
    const rows = await availableOpenShifts(db, companyId, today, me, !isCaregiver(d, user))
    // care_open_shift_offers: what the agency lets caregivers see, how far ahead, and not what they declined or hid or let expire.
    if (isCaregiver(d, user) && await core.openShiftOffers.enabled(companyId)) return asList(c, await core.openShiftOffers.visibleFor(companyId, me, rows))
    return asList(c, rows)
  })

  // GET /api/open-shifts — the office's board. ?status=open (default) | active (open + claimed) | all | <status>
  app.get('/', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { status, startDate, endDate, urgency } = c.req.query()
    return asList(c, await openShiftBoard(db, companyId, {
      status: status || undefined,
      startDate: startDate && DATE_RE.test(startDate) ? startDate : undefined,
      endDate: endDate && DATE_RE.test(endDate) ? endDate : undefined,
      urgency: urgency || undefined,
    }))
  })

  // POST /api/open-shifts — post a shift by hand
  app.post('/', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const shiftDate = b.shiftDate || b.date
    if (!shiftDate || !DATE_RE.test(shiftDate)) return fail(c, 400, 'shiftDate (YYYY-MM-DD) is required')
    if (!hms(b.startTime) || !hms(b.endTime)) return fail(c, 400, 'startTime and endTime are required')
    const id = await insertOpenShift(db, companyId, {
      clientId: b.clientId || null, scheduleId: b.scheduleId || null, date: shiftDate, start: hms(b.startTime)!, end: hms(b.endTime)!,
      careTypeId: b.careTypeId || null, hourlyRate: b.hourlyRate === '' || b.hourlyRate == null ? null : Number(b.hourlyRate),
      bonusAmount: Number(b.bonusAmount) || 0, notes: b.notes || null, urgency: b.urgency || 'normal', createdById: me,
    })
    return one(c, await openShiftById(db, companyId, id), 201)
  })

  // POST /api/open-shifts/from-schedule/:scheduleId — post ONE visit of a schedule.
  // Body: { date, visibleTo?: [caregiverId…], autoAssign?, bonusAmount?, urgency? }
  // A repeating shift has no date of its own, so the office says which day; the visit must really happen that day, and
  // its times come from the engine (they may be overridden for that day).
  app.post('/from-schedule/:scheduleId', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const scheduleId = c.req.param('scheduleId')
    const b = await c.req.json().catch(() => ({})) as any
    const s = await scheduleForPosting(db, companyId, scheduleId)
    if (!s) return fail(c, 404, 'Schedule not found')
    const day = b.date || s.date
    if (!day || !DATE_RE.test(day)) return fail(c, 400, 'Pick the date of the visit to post.')

    const occ = await occurrenceOn(db, companyId, scheduleId, day)
    if (!occ) return fail(c, 400, 'That shift has no visit on that date (it may be cancelled or not scheduled that day).')
    if (await livePostingFor(db, companyId, scheduleId, day)) return fail(c, 409, 'This visit is already posted as an open shift.', 'already_posted')

    // The payer's current rate, when one is on file. No rate is invented when there is none.
    const rate = s.referredById ? await payerCurrentRate(db, companyId, s.referredById) : null
    const visible = Array.isArray(b.visibleTo) && b.visibleTo.length ? b.visibleTo.map(String) : null
    const id = await insertOpenShift(db, companyId, {
      clientId: s.clientId, scheduleId, date: day, start: occ.startTime, end: occ.endTime, hourlyRate: rate,
      bonusAmount: Number(b.bonusAmount) || 0, urgency: b.urgency || 'normal', createdById: me, visibleTo: visible,
      autoAssign: !!b.autoAssign, notes: 'Posted by the office',
    })
    return one(c, await openShiftById(db, companyId, id))
  })

  // POST /api/open-shifts/:id/claim — a caregiver accepts. Whoever changes the schedule (care-schedule:update) may name
  // the caregiver; anyone else claims for themselves (a read-only seat named anyone before 2026-10-19).
  app.post('/:id/claim', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const id = c.req.param('id')
    const b = await c.req.json().catch(() => ({})) as any
    const caregiverId = b.caregiverId && (await actsForAnyone(d, user, 'care-schedule:update')) ? String(b.caregiverId) : me

    const os = await openShiftById(db, companyId, id, true)
    if (!os) return fail(c, 400, 'Shift is no longer available')
    if (Array.isArray(os.visibleTo) && !os.visibleTo.includes(caregiverId)) return fail(c, 403, 'This shift was not offered to you')

    // care_open_shift_offers: the answer-by time has passed; and a series offered together is taken together.
    const offers = await core.openShiftOffers.enabled(companyId)
    if (offers && os.respondBy && (await core.openShiftOffers.nowLocal(companyId)) > `${os.respondBy}:00`) return fail(c, 409, 'The time to answer this offer has passed.', 'offer_expired')
    const targets: any[] = offers && os.seriesId
      ? (await seriesPostings(db, companyId, os.seriesId)).filter((x: any) => x.status === 'open').map((x: any) => (x.id === os.id ? os : { ...os, id: x.id, shiftDate: x.shiftDate, startTime: x.startTime, endTime: x.endTime, scheduleId: x.scheduleId, autoAssign: x.autoAssign }))
      : [os]

    const noCert = await core.certReminders.blockedFor(companyId, [caregiverId], targets.map((t) => t.shiftDate).sort()[0])
    if (noCert[caregiverId]?.length) return fail(c, 409, `You cannot take this shift: your ${noCert[caregiverId].join(', ')} has expired. Send the office the renewed copy.`, 'credential_expired')

    // A visit they already have at that time — recurring visits included, cancelled ones not. For a series, every date is checked first.
    const clashes: string[] = []
    for (const t of targets) if (await hasOverlap(db, companyId, caregiverId, t.shiftDate, t.startTime, t.endTime, true)) clashes.push(fmtDay(t.shiftDate))
    if (clashes.length) return fail(c, 400, targets.length > 1 ? `You have a conflicting shift on ${clashes.join(', ')}, so you cannot take this series.` : 'You have a conflicting shift at this time')

    // First tap wins; a second caregiver is told it's gone. For a series the tapped visit decides; the rest follow it.
    if (!(await claimOpenShift(db, companyId, id, caregiverId))) return fail(c, 409, 'Someone else just took this shift')
    const claimed: any[] = [os]
    for (const t of targets.filter((x) => x.id !== os.id)) if (await claimOpenShift(db, companyId, t.id, caregiverId)) claimed.push(t)
    for (const t of claimed) await insertClaim(db, companyId, t.id, caregiverId, b.notes || null)

    const person = await personName(db, companyId, caregiverId)
    const cl = os.clientId ? await clientName(db, companyId, os.clientId) : null
    const what = claimed.length > 1
      ? `${claimed.length} visits with ${clientShort(cl?.firstName, cl?.lastName)}, ${fmtDay(claimed[0].shiftDate)} to ${fmtDay(claimed[claimed.length - 1].shiftDate)}`
      : `${fmtDay(os.shiftDate)} ${fmtHm(os.startTime)}–${fmtHm(os.endTime)} with ${clientShort(cl?.firstName, cl?.lastName)}`
    const name = `${person?.firstName || ''} ${person?.lastName || ''}`.trim() || 'A caregiver'

    if (os.autoAssign) {
      try {
        for (const t of claimed) {
          await shared.assignShift(companyId, t, caregiverId, os.createdById || caregiverId)
          await markFilled(db, companyId, t.id, os.createdById || null)
          await approveClaims(db, companyId, t.id, caregiverId)
        }
        await core.notify.notifyAdmins(companyId, 'open_shift_filled', `Open shift filled: ${name}`, `${name} accepted the open shift ${what}. It is on their schedule now.`)
        return one(c, { success: true, assigned: true, visits: claimed.length, message: `It's yours — ${what} ${claimed.length > 1 ? 'are' : 'is'} on your schedule.` })
      } catch (e: any) {
        // Couldn't place it (e.g. the visit was cancelled meanwhile) — leave it claimed for the office.
        await core.notify.notifyAdmins(companyId, 'open_shift_claimed', `Open shift needs you: ${name}`,
          `${name} accepted ${what}, but it couldn't be put on their schedule automatically (${e.message}). Check Open Shifts.`)
        return one(c, { success: true, assigned: false, message: 'Shift accepted — the office will confirm it.' })
      }
    }
    await core.notify.notifyAdmins(companyId, 'open_shift_claimed', `Open shift accepted: ${name}`, `${name} wants the open shift ${what}. Approve it in Schedule Hub → Staffing → Open Shifts.`)
    return one(c, { success: true, assigned: false, visits: claimed.length, message: claimed.length > 1 ? `Series claimed (${claimed.length} visits) - pending approval` : 'Shift claimed - pending approval' })
  })

  // POST /api/open-shifts/:id/approve — the office approves the claim
  app.post('/:id/approve', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const s = await openShiftById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    if (!s.claimedById) return fail(c, 400, 'No claim to approve')
    const warnings = await authWarnings(companyId, s)
    try { await shared.assignShift(companyId, s, s.claimedById, me) } catch (e: any) {
      return fail(c, e instanceof HttpError ? e.status as any : 500, e.message)
    }
    await markFilled(db, companyId, s.id, me)
    await approveClaims(db, companyId, s.id, s.claimedById)
    await core.notify.notifyUser(companyId, s.claimedById, 'open_shift_approved', 'Open shift approved', `You're confirmed for ${fmtDay(s.shiftDate)} ${fmtHm(s.startTime)}–${fmtHm(s.endTime)}.`)
    return one(c, { success: true, authWarnings: warnings })
  })

  // POST /api/open-shifts/:id/reject — turn the claim down; the shift reopens
  app.post('/:id/reject', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const s = await openShiftById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    const { reason } = await c.req.json().catch(() => ({})) as any
    await reopenShift(db, companyId, s.id, reason || null)
    return done(c)
  })

  // POST /api/open-shifts/:id/cancel — the office takes the posting down (the schedule keeps its caregiver)
  app.post('/:id/cancel', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    if (!(await cancelPosting(db, companyId, c.req.param('id')))) return fail(c, 400, 'Shift cannot be cancelled (already filled or already cancelled)')
    return done(c)
  })

  // GET /api/open-shifts/:id/smart-fill-suggestions — the params to re-pass to the caregiver ranking
  app.get('/:id/smart-fill-suggestions', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const s = await openShiftById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Open shift not found')
    if (s.status !== 'open') return fail(c, 409, `Shift is ${s.status}, not open`)
    return one(c, { forwardTo: '/api/scheduling/suggest-caregivers', params: { clientId: s.clientId, date: s.shiftDate, startTime: s.startTime, endTime: s.endTime } })
  })

  // POST /api/open-shifts/:id/smart-fill { caregiverId } — assign directly, skipping claim → approve. Authorization is
  // advice: filling an uncovered shift is never refused over paperwork.
  app.post('/:id/smart-fill', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const { caregiverId } = await c.req.json().catch(() => ({})) as any
    if (!caregiverId) return fail(c, 400, 'caregiverId required')
    const s = await openShiftById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Open shift not found')
    if (s.status !== 'open') return fail(c, 409, `Shift is ${s.status}, not open`)
    const warnings = await authWarnings(companyId, s)
    try { await shared.assignShift(companyId, s, caregiverId, me) } catch (e: any) {
      return fail(c, e instanceof HttpError ? e.status as any : 500, e.message)
    }
    await markFilled(db, companyId, s.id, me, caregiverId)
    const what = `${fmtDay(s.shiftDate)} ${fmtHm(s.startTime)}–${fmtHm(s.endTime)}`
    await core.notify.notifyUser(companyId, caregiverId, 'shift_assigned', 'New shift assigned', `You've been assigned to ${what}.`)
    await core.notify.sendPush(caregiverId, { title: 'New shift assigned', body: `You've been assigned to ${what}.`, data: { type: 'shift_assigned', shiftId: s.id } })
    return one(c, { success: true, openShiftId: s.id, assignedTo: caregiverId, authWarnings: warnings })
  })

  // POST /api/open-shifts/:id/broadcast { sms?, customMessage? } — tell every caregiver who could take the shift: active, free at
  // that time, and (when the posting was offered to chosen caregivers only) one of those. Each gets an in-app notice and a
  // phone push; sms:true also texts them. The reply counts who was really reached, and a posting nobody was told about is
  // never marked broadcast.
  app.post('/:id/broadcast', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { customMessage, sms, email } = await c.req.json().catch(() => ({})) as any
    const s = await openShiftWithClient(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    if (s.status !== 'open') return fail(c, 409, `Shift is ${s.status}, not open`)
    // The same rule auto-fill and the suggestions use (core/caregiverFit.ts): nobody on this client's do-not-use list, on time
    // off, marked unavailable, or outside the days and hours they work is told (10/30, owner's follow-up to PR #172).
    const eligible = await eligibleToTell(core, d, companyId, s)
    if (eligible.length === 0) return fail(c, 409, 'No caregiver is free for this shift, so nobody was told.', 'nobody_to_tell')
    const r = await tellCaregivers(companyId, s, eligible.map((e) => e.id), { customMessage, sms: sms === true, email: email === true })
    if (r.notified === 0) return fail(c, 502, 'The notices could not be delivered, so nobody was told. Try again.', 'not_delivered')
    const texts = r.texted ? ` and texted ${r.texted}` : ''
    return one(c, { success: true, message: `Told ${r.notified} caregiver${r.notified === 1 ? '' : 's'}${texts}`, notified: r.notified, texted: r.texted, total: r.total, caregiverCount: r.notified })
  })

  // GET /api/open-shifts/:id/eligible-caregivers — every active caregiver, marked available and notified
  app.get('/:id/eligible-caregivers', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const s = await openShiftById(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    const rows = await eligibleForShift(db, companyId, s)
    const expired = await core.certReminders.expiredFor(companyId, rows.map((r) => String(r.id)), s.shiftDate)
    const noCert = await core.certReminders.blockedFor(companyId, rows.map((r) => String(r.id)), s.shiftDate)
    return asList(c, rows.map((r) => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, phone: r.phone, email: r.email, available: !r.hasConflict && !noCert[String(r.id)], notified: !!r.alreadyNotified, expiredCertifications: expired[String(r.id)] || [], blockedByCredential: !!noCert[String(r.id)] })))
  })

  // POST /api/open-shifts/:id/notify { caregiverIds, customMessage?, sms? } — tell chosen caregivers. An in-app
  // notification for each, the open_shift_notifications row, best-effort push, and with sms:true a text (push reaches
  // nobody who never subscribed, so a text is how they find out).
  app.post('/:id/notify', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { caregiverIds, customMessage, sms, email } = await c.req.json().catch(() => ({})) as any
    if (!Array.isArray(caregiverIds) || caregiverIds.length === 0) return fail(c, 400, 'caregiverIds is required and must be a non-empty array')
    const s = await openShiftWithClient(db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    const noCert = await core.certReminders.blockedFor(companyId, caregiverIds.map(String), s.shiftDate)
    const allowed = caregiverIds.map(String).filter((id) => !noCert[id])
    if (allowed.length === 0) return fail(c, 409, 'Every caregiver chosen has an expired credential, so nobody was told.', 'credential_expired')
    const r = await tellCaregivers(companyId, s, allowed, { customMessage, sms: !!sms, email: !!email })
    return one(c, { success: true, ...r, skippedForCredential: caregiverIds.length - allowed.length })
  })

  // GET /api/open-shifts/:id/claims — who accepted
  app.get('/:id/claims', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    return asList(c, await claimsForShift(db, companyId, c.req.param('id')))
  })

  return app
}
