// /api/open-shift-offers — open shifts finished (row 17, care_open_shift_offers; the mount carries the feature).
//
//   caregiver (care-schedule:read, for themselves)
//     GET  /reasons                         the reasons a shift can be turned down, with their words
//     POST /:id/decline { reason, note? }   turn an offer down (reason from the list; "another reason" needs the note)
//     POST /:id/hide                        take it off their list without saying why
//   office (care-schedule:update)
//     GET  /settings · PUT /settings        { visibility: all | none | sent, daysAhead: 1–365 | null }
//     GET  /board?status=                   the board with each posting's offer status and response counts
//     GET  /:id/check?channels=&caregiverIds=   who cannot be reached by what, before anything is sent
//     GET  /:id/outbox                      every message tried: channel, where, how it ended
//     POST /:id/resend { mode: 'failed' | 'new' | 'everyone', channels? }
//     PUT  /:id/deadline { respondBy: 'YYYY-MM-DD HH:MM' | null }
//     POST /series/:scheduleId { from, weeks, bonusAmount?, urgency?, visibleTo?, autoAssign?, respondBy? }   offer a whole recurring series
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { DATE_RE } from '../core/scheduleOccurrences.ts'
import { addDays } from '../core/agencyTime.ts'
import { DECLINE_REASONS, VISIBILITY_LABELS, declineProblem, type Channel } from '../core/openShiftOffers.ts'
import {
  openShiftById, openShiftWithClient, openShiftBoard, insertOpenShift, scheduleForPosting, occurrenceOn, livePostingFor, payerCurrentRate,
} from '../../../data/homecareScheduling.ts'
import { setSeries, setRespondBy, deletePostings } from '../../../data/homecareOpenOffers.ts'
import { eligibleToTell } from './openShiftEligibility.ts'
import { who } from './shared.ts'

const CHANNELS: Channel[] = ['app', 'push', 'sms', 'email']
const MAX_WEEKS = 12

export function createOpenShiftOffersRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const offers = core.openShiftOffers
  const channelsOf = (v: unknown, fallback: Channel[]): Channel[] => {
    const raw = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []
    const list = raw.map(String).filter((x): x is Channel => (CHANNELS as string[]).includes(x))
    return list.length ? [...new Set(list)] : fallback
  }

  app.get('/reasons', perm('care-schedule:read'), (c) => one(c, { reasons: DECLINE_REASONS.map((r) => ({ code: r.code, label: r.label })) }))

  const respond = (kind: 'declined' | 'hidden') => async (c: any) => {
    const { companyId, me } = who(c)
    const s = await openShiftById(d.db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    if (s.status !== 'open') return fail(c, 409, 'This shift has already been taken or taken down.')
    if (Array.isArray(s.visibleTo) && !s.visibleTo.includes(me)) return fail(c, 403, 'This shift was not offered to you')
    let reason: string | null = null
    if (kind === 'declined') {
      const b = await c.req.json().catch(() => ({})) as any
      const p = declineProblem(b.reason, b.note)
      if (p) return fail(c, 400, p)
      reason = b.reason === 'other' ? String(b.note).trim().slice(0, 300) : String(b.reason)
    }
    await offers.answer(companyId, s, me, kind, reason)
    return done(c)
  }
  app.post('/:id/decline', perm('care-schedule:read'), respond('declined'))
  app.post('/:id/hide', perm('care-schedule:read'), respond('hidden'))

  app.get('/settings', perm('care-schedule:update'), async (c) => one(c, { ...(await offers.settingsOf(who(c).companyId)), visibilityOptions: Object.entries(VISIBILITY_LABELS).map(([code, label]) => ({ code, label })) }))
  app.put('/settings', perm('care-schedule:update'), async (c) => {
    const r = await offers.saveSettings(who(c).companyId, await c.req.json().catch(() => ({})))
    return 'problem' in r ? fail(c, 400, r.problem) : one(c, r.settings)
  })

  app.get('/board', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { status, startDate, endDate } = c.req.query()
    const rows = await openShiftBoard(d.db, companyId, { status: status || 'active', startDate: startDate && DATE_RE.test(startDate) ? startDate : undefined, endDate: endDate && DATE_RE.test(endDate) ? endDate : undefined })
    return listAll(c, await offers.overview(companyId, rows))
  })

  app.get('/:id/check', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const s = await openShiftById(d.db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    const ids = String(c.req.query('caregiverIds') || '').split(',').filter(Boolean)
    const who2 = ids.length ? ids : (await eligibleToTell(core, d, companyId, s)).map((r) => String(r.id))
    return listAll(c, await offers.check(companyId, who2, channelsOf(c.req.query('channels'), ['app', 'push'])))
  })

  app.get('/:id/outbox', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    if (!(await openShiftById(d.db, companyId, c.req.param('id')))) return fail(c, 404, 'Shift not found')
    return listAll(c, await offers.messages(companyId, c.req.param('id')))
  })

  // Send again: just the messages that failed (each to the same channel), only caregivers added since (eligible now, never messaged), or
  // everyone it went to — with their answers cleared, so a "no" from last week does not hide it from them.
  app.post('/:id/resend', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const s = await openShiftWithClient(d.db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    if (s.status !== 'open') return fail(c, 409, `Shift is ${s.status}, not open`)
    const mode = b.mode
    if (mode !== 'failed' && mode !== 'new' && mode !== 'everyone') return fail(c, 400, "Say what to resend: 'failed', 'new' or 'everyone'.")
    const channels = channelsOf(b.channels, ['app', 'push'])
    const seriesVisits = null as number | null
    if (mode === 'failed') {
      const pairs = await offers.failedPairs(companyId, s.id)
      if (!pairs.length) return fail(c, 409, 'Nothing failed, so there is nothing to resend.', 'nothing_failed')
      const tally = { notified: 0, texted: 0, emailed: 0, pushed: 0, pushFailed: 0, failed: 0, skipped: 0, total: 0 }
      for (const ch of CHANNELS) {
        const ids = pairs.filter((p) => p.channel === ch).map((p) => p.caregiverId)
        if (!ids.length) continue
        const r = await offers.send(companyId, { ...s, seriesVisits }, ids, { channels: [ch] })
        for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] += r[k]
      }
      return one(c, { mode, ...tally })
    }
    if (mode === 'new') {
      const already = new Set(await offers.messagedCaregivers(companyId, s.id))
      const fresh = (await eligibleToTell(core, d, companyId, s)).map((r) => String(r.id)).filter((id) => !already.has(id))
      if (!fresh.length) return fail(c, 409, 'No one new is free for this shift — everyone who could take it has already been told.', 'nobody_new')
      return one(c, { mode, ...(await offers.send(companyId, { ...s, seriesVisits }, fresh, { channels })) })
    }
    const everyone = [...new Set([...(await offers.sentTo(companyId, s.id)), ...(await offers.messagedCaregivers(companyId, s.id))])]
    if (!everyone.length) return fail(c, 409, 'It has not been sent to anyone yet.', 'not_sent')
    const cleared = await offers.clearAnswers(companyId, s.id)
    return one(c, { mode, answersCleared: cleared, ...(await offers.send(companyId, { ...s, seriesVisits }, everyone, { channels })) })
  })

  app.put('/:id/deadline', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const s = await openShiftById(d.db, companyId, c.req.param('id'))
    if (!s) return fail(c, 404, 'Shift not found')
    const b = await c.req.json().catch(() => ({})) as any
    const at = offers.parseDeadline(b.respondBy)
    if ('problem' in at) return fail(c, 400, at.problem)
    await setRespondBy(d.db, companyId, s.id, at.at)
    return one(c, { id: s.id, respondBy: at.at })
  })

  // Offer a whole recurring series: one posting per week the visit really happens, all sharing a series, so whoever taps first takes them all.
  app.post('/series/:scheduleId', perm('care-schedule:create'), async (c) => {
    const { companyId, me } = who(c)
    const scheduleId = c.req.param('scheduleId')!
    const b = await c.req.json().catch(() => ({})) as any
    const sched = await scheduleForPosting(d.db, companyId, scheduleId)
    if (!sched) return fail(c, 404, 'Schedule not found')
    if (!b.from || !DATE_RE.test(b.from)) return fail(c, 400, 'Pick the first date of the series.')
    const weeks = Number(b.weeks)
    if (!Number.isInteger(weeks) || weeks < 2 || weeks > MAX_WEEKS) return fail(c, 400, `A series is 2 to ${MAX_WEEKS} weeks.`)
    const deadline = offers.parseDeadline(b.respondBy)
    if ('problem' in deadline) return fail(c, 400, deadline.problem)
    const rate = sched.referredById ? await payerCurrentRate(d.db, companyId, sched.referredById) : null
    const visible = Array.isArray(b.visibleTo) && b.visibleTo.length ? b.visibleTo.map(String) : null
    const posted: string[] = [], skipped: { date: string; reason: string }[] = []
    for (let i = 0; i < weeks; i++) {
      const day = addDays(b.from, i * 7)
      const occ = await occurrenceOn(d.db, companyId, scheduleId, day)
      if (!occ) { skipped.push({ date: day, reason: 'The visit does not happen that day.' }); continue }
      if (await livePostingFor(d.db, companyId, scheduleId, day)) { skipped.push({ date: day, reason: 'Already posted as an open shift.' }); continue }
      posted.push(await insertOpenShift(d.db, companyId, {
        clientId: sched.clientId, scheduleId, date: day, start: occ.startTime, end: occ.endTime, hourlyRate: rate, bonusAmount: Number(b.bonusAmount) || 0,
        urgency: b.urgency || 'normal', createdById: me, visibleTo: visible, autoAssign: !!b.autoAssign, notes: 'Posted by the office as a series',
      }))
    }
    if (posted.length < 2) {
      // A series of one is not a series: take back what was posted and say why.
      await deletePostings(d.db, companyId, posted)
      return fail(c, 409, 'Fewer than two of those weeks have a visit to offer, so no series was posted.', 'series_too_short')
    }
    const seriesId = randomUUID()
    await setSeries(d.db, companyId, posted, seriesId)
    if (deadline.at) for (const id of posted) await setRespondBy(d.db, companyId, id, deadline.at)
    return one(c, { seriesId, posted: posted.length, ids: posted, skipped }, 201)
  })

  return app
}
