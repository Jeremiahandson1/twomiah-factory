// "Mary has arrived to help Pat." — a text to the relatives of a client who asked for it, when the caregiver clocks in,
// and another when they clock out. Sent from the agency's own texting service (core/visitNotify.ts sendText: the business's
// registered number, a STOP honoured, the wallet checked, the text kept in Messages) — never from ours.
//
// Who: a client's active relatives with a phone number and visit_text_optin (the office records the relative's yes on the
// family member; family_members.visit_text_optin_at is when). Only for a company with the care_family_texts feature on
// (not ready until the owner has tested it).
//
// Rules that keep it honest:
//   · once per (visit, relative, arrival|departure): claimed in family_visit_text first, so a replayed punch, an offline
//     punch sent twice or two instances never text twice;
//   · quiet hours on the agency's own clock (9 PM–8 AM unless the agency set its own, company.settings.familyTexts): no text is sent in them, and it is recorded as skipped_quiet — the
//     relative is never woken, and an arrival nobody was told of at 7 AM is not announced at 8 AM as if it were news;
//   · a punch saved on the phone and only now reaching us (more than 30 minutes old) is skipped_late for the same reason;
//   · the text names the caregiver by first name and says nothing of care, health or the visit's contents.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import { claimFamilyText, emailOptedInRelatives, optedInRelatives, setFamilyTextStatus, visitNames } from '../../../data/homecareFamilyTexts.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { AgencyProfiles } from './agencyProfile.ts'
import type { VisitNotify } from './visitNotify.ts'
import { inQuietHours } from './notificationPrefs.ts'
import { DEFAULT_TEXTS, emailHtml, fill, type FamilyComms } from './familyComms.ts'

export const FAMILY_TEXT_FEATURE = 'care_family_texts'
/** Quiet hours for these texts until an agency sets its own (on its own clock). */
export const FAMILY_QUIET = { quietHoursStart: '21:00', quietHoursEnd: '08:00' } as const
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** A punch older than this when it reaches us is not announced. */
const LATE_MS = 30 * 60 * 1000

const hm = (at: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at)

export function createFamilyTexts(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify; profile: Pick<AgencyProfiles, 'agencyShortName'>; comms: FamilyComms }) {
  /** The agency's quiet hours: what it saved, else 9 PM–8 AM. */
  async function quietHours(companyId: string): Promise<{ quietHoursStart: string; quietHoursEnd: string }> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const own = (row?.settings as any)?.familyTexts
    return HHMM.test(String(own?.quietHoursStart)) && HHMM.test(String(own?.quietHoursEnd))
      ? { quietHoursStart: own.quietHoursStart, quietHoursEnd: own.quietHoursEnd }
      : { ...FAMILY_QUIET }
  }

  /** Save the agency's quiet hours ('HH:MM' on its own clock). The start and end must differ; a start later than the end runs past midnight. */
  async function saveQuietHours(companyId: string, start: unknown, end: unknown): Promise<{ problem: string } | { quietHoursStart: string; quietHoursEnd: string }> {
    if (!HHMM.test(String(start)) || !HHMM.test(String(end))) return { problem: 'Give both times as hours and minutes, like 21:00 and 08:00.' }
    if (start === end) return { problem: 'The quiet hours cannot start and end at the same time.' }
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const hours = { quietHoursStart: String(start), quietHoursEnd: String(end) }
    const old = ((row?.settings as any) || {}).familyTexts || {}
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), familyTexts: { ...old, ...hours } } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return hours
  }

  /**
   * The punch just made: `event` 'clock_in' | 'clock_out', `punchAt` the moment of the punch. Never throws and never delays the
   * punch it follows. Returns how many texts went out.
   */
  async function onClockEvent(companyId: string, entry: { id: string; caregiverId: string; clientId: string }, event: 'clock_in' | 'clock_out', punchAt: Date, now: Date = new Date()): Promise<number> {
    try {
      if (!(await d.features.isFeatureEnabled(companyId, FAMILY_TEXT_FEATURE))) return 0
      // care_family_comms: the agency's own wording, and the same notice by email for relatives who asked for it.
      const comms = await deps.comms.enabled(companyId)
      const textRelatives = await optedInRelatives(d.db, companyId, entry.clientId)
      const emailRelatives = comms ? await emailOptedInRelatives(d.db, companyId, entry.clientId) : []
      if (!textRelatives.length && !emailRelatives.length) return 0
      const names = await visitNames(d.db, companyId, entry.caregiverId, entry.clientId)
      if (!names) return 0
      const { tz } = await deps.time.now(companyId, now)
      const late = now.getTime() - punchAt.getTime() > LATE_MS
      const hours = await quietHours(companyId)
      const quiet = inQuietHours(hours, now, tz)
      const prefix = await deps.profile.agencyShortName(companyId)
      const at = hm(punchAt, tz)
      const wording = comms ? await deps.comms.textWording(companyId) : { ...DEFAULT_TEXTS }
      const template = event === 'clock_in' ? wording.arrivalText : wording.departureText
      const said = fill(template, { caregiver: names.caregiverFirst, client: names.clientFirst, time: at, agency: prefix })
      const hasAgency = /\{agency\}/.test(template)
      const text = `${!hasAgency && prefix ? prefix + ': ' : ''}${said}${/STOP/i.test(said) ? '' : ' Reply STOP to stop these texts.'}`
      const lateWhy = 'The punch reached us more than 30 minutes after it happened, so the family was not told.'
      const quietWhy = `It fell in quiet hours (${hours.quietHoursStart}–${hours.quietHoursEnd} on the agency\'s clock), so the family was not woken.`
      let sent = 0
      for (const r of textRelatives) {
        const skip = late ? 'skipped_late' : quiet ? 'skipped_quiet' : null
        const why = skip === 'skipped_late' ? lateWhy : skip === 'skipped_quiet' ? quietWhy : null
        if (!(await claimFamilyText(d.db, companyId, entry.id, r.id, event, skip ?? 'pending', 'sms', why))) continue
        if (skip) continue
        const ok = await deps.notify.sendText({ companyId, phone: r.phone, body: text })
        await setFamilyTextStatus(d.db, companyId, entry.id, r.id, event, ok ? 'sent' : 'failed', 'sms', ok ? null : 'The texting service could not send it (texting may not be set up for this agency, or the number cannot receive texts).')
        if (ok) sent++
      }
      // Email is not held for quiet hours (it does not wake anyone), but a late punch is still not news.
      for (const r of emailRelatives) {
        const skip = late ? 'skipped_late' : null
        if (!(await claimFamilyText(d.db, companyId, entry.id, r.id, event, skip ?? 'pending', 'email', skip ? lateWhy : null))) continue
        if (skip) continue
        let ok = false
        try {
          await d.services.emailService.sendRaw({ to: r.email, subject: `${prefix ? prefix + ': ' : ''}${event === 'clock_in' ? `${names.caregiverFirst} has arrived` : `${names.caregiverFirst} has finished the visit`}`, html: emailHtml(prefix, said) })
          ok = true
        } catch (e: any) { d.logger.error('[family-texts] email', { error: e?.message }) }
        await setFamilyTextStatus(d.db, companyId, entry.id, r.id, event, ok ? 'sent' : 'failed', 'email', ok ? null : 'The email could not be sent.')
        if (ok) sent++
      }
      return sent
    } catch (e: any) {
      d.logger.error('[family-texts] clock event', { event, error: e?.message })
      return 0
    }
  }

  return { onClockEvent, quietHours, saveQuietHours }
}
