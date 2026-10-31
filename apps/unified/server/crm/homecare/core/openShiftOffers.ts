// Open-shift offers finished (row 17, care_open_shift_offers; not ready until the owner has tried it on a real phone): a caregiver can decline
// (with a reason) or hide an offer; each posting shows an offer status with response counts and a response deadline; the agency picks what
// caregivers see (nothing / everything / only what was sent them) and how many days ahead; offers go by app, push, text and email with each
// person's notification settings honoured, every message kept in an outbox with how it ended, and failures, newcomers or everyone can be
// sent again; a warning before sending names who cannot be reached by what; a whole recurring series can be offered as one.
//
// The rules (what status a posting shows, who sees what, who cannot be reached) are pure and tested alone.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import {
  setRespondBy, recordResponse, clearResponses, responsesFor, mineAnswered, mineSent, offerCounts, offerFields, sentTo, reachability, addMessage,
  outbox, failedPairs, messagedCaregivers,
} from '../../../data/homecareOpenOffers.ts'
import { recordShiftNotice, markNotified, personPhone } from '../../../data/homecareScheduling.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, hmsIn, ymdIn, type AgencyTime } from './agencyTime.ts'
import type { NotificationPrefs } from './notificationPrefs.ts'
import type { VisitNotify } from './visitNotify.ts'

export const OFFERS_FEATURE = 'care_open_shift_offers'

export type OfferStatus = 'not_sent' | 'pending' | 'accepted' | 'declined' | 'expired' | 'closed'
export const OFFER_LABELS: Record<OfferStatus, string> = {
  not_sent: 'Not sent', pending: 'Pending', accepted: 'Accepted', declined: 'Declined — everyone answered', expired: 'Expired', closed: 'Closed',
}
export const DECLINE_REASONS = [
  { code: 'busy', label: 'I am busy then' }, { code: 'too_far', label: 'It is too far' }, { code: 'hours', label: 'It does not fit the hours I want' },
  { code: 'client', label: 'I would rather not work with this client' }, { code: 'other', label: 'Another reason' },
] as const
export const declineLabel = (code: string | null | undefined) => DECLINE_REASONS.find((r) => r.code === code)?.label ?? (code ? 'Another reason' : '')

/** Why a decline is not ready, in words — or null. "Another reason" needs the reason written. */
export function declineProblem(code: unknown, note: unknown): string | null {
  if (!DECLINE_REASONS.some((r) => r.code === code)) return 'Pick why you are turning this shift down.'
  if (code === 'other' && !String(note ?? '').trim()) return 'Write the reason.'
  return null
}

/** A posting's offer status. `now` and `respondBy` are the agency's wall clock, 'YYYY-MM-DDTHH:MM:SS'. */
export function offerStatus(i: { status: string; sent: number; declined: number; respondBy: string | null; now: string }): OfferStatus {
  if (i.status === 'claimed' || i.status === 'filled') return 'accepted'
  if (i.status !== 'open') return 'closed'
  if (i.respondBy && i.now > i.respondBy) return 'expired'
  if (i.sent === 0) return 'not_sent'
  if (i.declined >= i.sent) return 'declined'
  return 'pending'
}

export type Visibility = 'all' | 'none' | 'sent'
export interface OfferSettings { visibility: Visibility; daysAhead: number | null }
export const DEFAULT_SETTINGS: OfferSettings = { visibility: 'all', daysAhead: null }
export const VISIBILITY_LABELS: Record<Visibility, string> = { all: 'Every open shift offered to them', none: 'No open shifts', sent: 'Only the shifts the office sent them' }

export function sanitizeSettings(raw: any, prev: OfferSettings = DEFAULT_SETTINGS): { settings: OfferSettings } | { problem: string } {
  const b = raw && typeof raw === 'object' ? raw : {}
  let visibility = prev.visibility
  if (b.visibility !== undefined) {
    if (b.visibility !== 'all' && b.visibility !== 'none' && b.visibility !== 'sent') return { problem: 'Choose what caregivers see: no open shifts, all of them, or only the ones sent to them.' }
    visibility = b.visibility
  }
  let daysAhead = prev.daysAhead
  if (b.daysAhead !== undefined) {
    if (b.daysAhead === null || b.daysAhead === '') daysAhead = null
    else {
      const n = Number(b.daysAhead)
      if (!Number.isInteger(n) || n < 1 || n > 365) return { problem: 'Days ahead must be a whole number from 1 to 365, or left empty for no limit.' }
      daysAhead = n
    }
  }
  return { settings: { visibility, daysAhead } }
}

/**
 * Does this caregiver see this posting? One rule for the phone and the tests: not one they answered, not past its deadline, inside the agency's
 * days-ahead limit, and by the agency's setting — nothing, only what was sent to them, or everything offered to everyone or to them.
 */
export function visibleUnder(settings: OfferSettings, shift: { id: string; visibleTo: string[] | null; shiftDate: string; respondBy: string | null }, ctx: { caregiverId: string; today: string; now: string; sent: Set<string>; answered: Set<string> }): boolean {
  if (ctx.answered.has(shift.id)) return false
  if (shift.respondBy && ctx.now > shift.respondBy) return false
  if (settings.visibility === 'none') return false
  if (settings.daysAhead != null && shift.shiftDate > addDays(ctx.today, settings.daysAhead)) return false
  if (settings.visibility === 'sent') return ctx.sent.has(shift.id)
  return !Array.isArray(shift.visibleTo) || shift.visibleTo.includes(ctx.caregiverId)
}

export type Channel = 'app' | 'push' | 'sms' | 'email'
export const CHANNEL_LABELS: Record<Channel, string> = { app: 'App notice', push: 'Phone alert', sms: 'Text', email: 'Email' }
export const STATUS_LABELS: Record<string, string> = { delivered: 'Delivered', sent: 'Sent', failed: 'Failed', skipped: 'Not sent' }

/** Who cannot be reached by which of the chosen channels, in words — checked before anything is sent. */
export function reachProblems(people: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; hasApp: boolean }[], channels: Channel[]): { caregiverId: string; name: string; problems: string[] }[] {
  const out: { caregiverId: string; name: string; problems: string[] }[] = []
  for (const p of people) {
    const problems: string[] = []
    if (channels.includes('sms') && !p.phone) problems.push('has no phone number, so a text cannot reach them')
    if (channels.includes('email') && !p.email) problems.push('has no email address, so an email cannot reach them')
    if ((channels.includes('app') || channels.includes('push')) && !p.hasApp) problems.push('has not signed in to the app yet, so the app notice and phone alert will not be seen')
    if (problems.length) out.push({ caregiverId: p.id, name: `${p.firstName} ${p.lastName}`.trim(), problems })
  }
  return out
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const fmtHm = (t: string) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const fmtDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const clientShort = (first: string | undefined, last: string | undefined) => `${first || ''} ${String(last || '').charAt(0)}.`.trim()

export function createOpenShiftOffers(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify; prefs: NotificationPrefs; agencyName: (companyId: string) => Promise<string | null> }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, OFFERS_FEATURE)

  async function settingsOf(companyId: string): Promise<OfferSettings> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const r = sanitizeSettings((row?.settings as any)?.openShifts, DEFAULT_SETTINGS)
    return 'settings' in r ? r.settings : DEFAULT_SETTINGS
  }
  async function saveSettings(companyId: string, input: any): Promise<{ settings: OfferSettings } | { problem: string }> {
    const next = sanitizeSettings(input, await settingsOf(companyId))
    if ('problem' in next) return next
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as any) ?? {}), openShifts: next.settings } }).where(eq(company.id, companyId))
    return next
  }

  /** The agency's wall clock now, 'YYYY-MM-DDTHH:MM:SS'. */
  async function nowLocal(companyId: string): Promise<string> {
    const tz = await deps.time.timezone(companyId)
    const at = new Date()
    return `${ymdIn(at, tz)}T${hmsIn(at, tz)}`
  }
  /** A deadline as the office typed it ('YYYY-MM-DDTHH:MM' or with seconds) → 'YYYY-MM-DDTHH:MM:SS', or a problem. */
  function parseDeadline(v: unknown): { at: string | null } | { problem: string } {
    if (v === null || v === undefined || v === '') return { at: null }
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/.exec(String(v))
    if (!m || Number.isNaN(new Date(`${m[1]}T${m[2]}:00Z`).getTime())) return { problem: 'Give the answer-by time as a date and time, like 2026-11-02 17:00.' }
    return { at: `${m[1]}T${m[2]}:${m[3] ?? '00'}` }
  }

  /** What this caregiver's phone shows: the open shifts they may see under the agency's setting, newest-first rules as the board has them. */
  async function visibleFor(companyId: string, caregiverId: string, shifts: any[]): Promise<any[]> {
    const [settings, today, now, answered, sent, fields] = await Promise.all([
      settingsOf(companyId), deps.time.today(companyId), nowLocal(companyId), mineAnswered(d.db, companyId, caregiverId), mineSent(d.db, companyId, caregiverId),
      offerFields(d.db, companyId, shifts.map((s) => String(s.id))),
    ])
    const series = new Map<string, number>()
    for (const s of shifts) { const sid = fields.get(String(s.id))?.seriesId; if (sid) series.set(sid, (series.get(sid) ?? 0) + 1) }
    return shifts
      .map((s) => ({ ...s, respondBy: fields.get(String(s.id))?.respondBy ?? null, seriesId: fields.get(String(s.id))?.seriesId ?? null }))
      .filter((s) => visibleUnder(settings, { id: String(s.id), visibleTo: s.visibleTo ?? null, shiftDate: s.shiftDate, respondBy: s.respondBy }, { caregiverId, today, now, sent, answered }))
      .map((s) => ({ ...s, seriesVisits: s.seriesId ? series.get(s.seriesId) ?? 1 : null }))
  }

  /** Decline (with a reason) or hide an offer. A shift already taken is refused in words. */
  async function answer(companyId: string, shift: any, caregiverId: string, kind: 'declined' | 'hidden', reason: string | null): Promise<void> {
    await recordResponse(d.db, companyId, String(shift.id), caregiverId, kind, reason)
  }

  /** The office's board, each posting with its offer status and response counts. */
  async function overview(companyId: string, shifts: any[]): Promise<any[]> {
    const ids = shifts.map((s) => String(s.id))
    const [counts, fields, resp, now] = await Promise.all([offerCounts(d.db, companyId, ids), offerFields(d.db, companyId, ids), responsesFor(d.db, companyId, ids), nowLocal(companyId)])
    return shifts.map((s) => {
      const c = counts.get(String(s.id)) ?? { sent: 0, accepted: 0 }
      const mine = resp.filter((r) => r.openShiftId === String(s.id))
      const declined = mine.filter((r) => r.response === 'declined').length, hidden = mine.filter((r) => r.response === 'hidden').length
      const f = fields.get(String(s.id))
      const code = offerStatus({ status: s.status, sent: c.sent, declined, respondBy: f?.respondBy ?? null, now })
      return {
        ...s, respondBy: f?.respondBy ?? null, seriesId: f?.seriesId ?? null, offerStatus: code, offerStatusLabel: OFFER_LABELS[code],
        counts: { sent: c.sent, accepted: c.accepted, declined, hidden, noAnswer: Math.max(0, c.sent - c.accepted - declined - hidden) },
      }
    })
  }

  /** Warnings to show BEFORE sending. */
  async function check(companyId: string, caregiverIds: string[], channels: Channel[]) {
    return reachProblems(await reachability(d.db, companyId, caregiverIds), channels)
  }

  /**
   * Tell caregivers about a posting over the chosen channels, each person's notification settings honoured, every attempt kept in the outbox.
   * Returns what really happened — a message that was not delivered is never counted as sent.
   */
  async function send(companyId: string, s: any, caregiverIds: string[], opts: { channels: Channel[]; customMessage?: string }) {
    const people = new Map((await reachability(d.db, companyId, caregiverIds)).map((p) => [p.id, p]))
    const bonus = parseFloat(s.bonusAmount) > 0 ? ` (+$${Number(s.bonusAmount).toFixed(2)} bonus)` : ''
    const title = `Open Shift: ${s.clientFirst || ''} ${s.clientLast || ''}`.trim()
    const deadline = s.respondBy ? ` Answer by ${fmtDay(String(s.respondBy).slice(0, 10))} ${fmtHm(String(s.respondBy).slice(11, 16))}.` : ''
    const series = s.seriesVisits && s.seriesVisits > 1 ? ` This is one of ${s.seriesVisits} visits offered together.` : ''
    const base = `${fmtDay(s.shiftDate)} ${String(s.startTime).slice(0, 5)}–${String(s.endTime).slice(0, 5)}${bonus}.${series}${deadline} Open the app to answer.`
    const message = opts.customMessage ? `${opts.customMessage}\n\n${base}` : base
    const agency = (await deps.agencyName(companyId)) || ''
    const sms = `${agency ? agency + ': ' : ''}Open shift ${fmtDay(s.shiftDate)} ${fmtHm(s.startTime)}-${fmtHm(s.endTime)} with ${clientShort(s.clientFirst, s.clientLast)}.${deadline} Open the app > Open Shifts to answer.${opts.customMessage ? ' ' + opts.customMessage : ''}`
    const urgent = s.urgency === 'urgent' || s.urgency === 'critical'
    const tally = { notified: 0, texted: 0, emailed: 0, pushed: 0, pushFailed: 0, failed: 0, skipped: 0, total: caregiverIds.length }
    const note = async (cg: string, channel: Channel, target: string | null, status: 'delivered' | 'sent' | 'failed' | 'skipped', detail: string | null) => {
      await addMessage(d.db, companyId, String(s.id), cg, { channel, target, status, detail })
      if (status === 'failed') tally.failed++
      if (status === 'skipped') tally.skipped++
    }

    for (const cg of caregiverIds) {
      const p = people.get(cg)
      if (!p) continue
      if (opts.channels.includes('app')) {
        try {
          await deps.notify.notifyUser(companyId, cg, 'open_shift_offer', title, message)
          await recordShiftNotice(d.db, companyId, String(s.id), cg)
          tally.notified++
          await note(cg, 'app', 'the app', 'delivered', null)
        } catch (e: any) { await note(cg, 'app', 'the app', 'failed', 'The notice could not be saved.') }
      }
      if (opts.channels.includes('push')) {
        if (!(await deps.prefs.shouldNotify(cg, 'push', 'schedule', { urgent }))) await note(cg, 'push', 'their phone', 'skipped', 'Their notification settings turn phone alerts off (or it is their quiet hours).')
        else {
          const n = await deps.notify.sendPush(cg, { title, body: message, tag: `open-shift-${s.id}`, data: { type: 'open_shift_offer', openShiftId: s.id } })
          if (n > 0) { tally.pushed += n; await note(cg, 'push', 'their phone', 'sent', `${n} device${n === 1 ? '' : 's'}`) }
          else { tally.pushFailed++; await note(cg, 'push', 'their phone', 'failed', 'No phone has the app signed in for them.') }
        }
      }
      if (opts.channels.includes('sms')) {
        if (!p.phone) await note(cg, 'sms', null, 'skipped', 'No phone number on file.')
        else if (!(await deps.prefs.shouldNotify(cg, 'sms', 'schedule', { urgent }))) await note(cg, 'sms', p.phone, 'skipped', 'Their notification settings turn texts off (or it is their quiet hours).')
        else if (await deps.notify.sendText({ companyId, phone: p.phone, body: sms })) { tally.texted++; await note(cg, 'sms', p.phone, 'sent', null) }
        else await note(cg, 'sms', p.phone, 'failed', 'The text did not go out (texting is not set up, they replied STOP, or the carrier refused it).')
      }
      if (opts.channels.includes('email')) {
        if (!p.email) await note(cg, 'email', null, 'skipped', 'No email address on file.')
        else if (!(await deps.prefs.shouldNotify(cg, 'email', 'schedule', { urgent }))) await note(cg, 'email', p.email, 'skipped', 'Their notification settings turn email off (or it is their quiet hours).')
        else {
          try {
            await d.services.emailService.sendRaw({ to: p.email, subject: `${agency ? agency + ': ' : ''}${title}`, html: `<p>Hi ${esc(p.firstName)},</p><p>${esc(message).replace(/\n/g, '<br>')}</p>` })
            tally.emailed++; await note(cg, 'email', p.email, 'sent', null)
          } catch { await note(cg, 'email', p.email, 'failed', 'The email could not be sent.') }
        }
      }
    }
    if (tally.notified > 0) await markNotified(d.db, companyId, String(s.id))
    return tally
  }

  /** The outbox of a posting, labelled. */
  async function messages(companyId: string, shiftId: string) {
    return (await outbox(d.db, companyId, shiftId)).map((m: any) => ({ ...m, channelLabel: CHANNEL_LABELS[m.channel as Channel] ?? m.channel, statusLabel: STATUS_LABELS[m.status] ?? m.status }))
  }

  return {
    enabled, settingsOf, saveSettings, nowLocal, parseDeadline, visibleFor, answer, overview, check, send, messages,
    setDeadline: (companyId: string, id: string, at: string | null) => setRespondBy(d.db, companyId, id, at),
    clearAnswers: (companyId: string, id: string) => clearResponses(d.db, companyId, id),
    sentTo: (companyId: string, id: string) => sentTo(d.db, companyId, id),
    failedPairs: (companyId: string, id: string) => failedPairs(d.db, companyId, id),
    messagedCaregivers: (companyId: string, id: string) => messagedCaregivers(d.db, companyId, id),
    personPhone,
  }
}
export type OpenShiftOffers = ReturnType<typeof createOpenShiftOffers>
