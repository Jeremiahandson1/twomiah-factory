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
import { claimFamilyText, optedInRelatives, setFamilyTextStatus, visitNames } from '../../../data/homecareFamilyTexts.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { AgencyProfiles } from './agencyProfile.ts'
import type { VisitNotify } from './visitNotify.ts'
import { inQuietHours } from './notificationPrefs.ts'

export const FAMILY_TEXT_FEATURE = 'care_family_texts'
/** Quiet hours for these texts until an agency sets its own (on its own clock). */
export const FAMILY_QUIET = { quietHoursStart: '21:00', quietHoursEnd: '08:00' } as const
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** A punch older than this when it reaches us is not announced. */
const LATE_MS = 30 * 60 * 1000

const hm = (at: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at)

export function createFamilyTexts(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify; profile: Pick<AgencyProfiles, 'agencyShortName'> }) {
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
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), familyTexts: hours } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return hours
  }

  /**
   * The punch just made: `event` 'clock_in' | 'clock_out', `punchAt` the moment of the punch. Never throws and never delays the
   * punch it follows. Returns how many texts went out.
   */
  async function onClockEvent(companyId: string, entry: { id: string; caregiverId: string; clientId: string }, event: 'clock_in' | 'clock_out', punchAt: Date, now: Date = new Date()): Promise<number> {
    try {
      if (!(await d.features.isFeatureEnabled(companyId, FAMILY_TEXT_FEATURE))) return 0
      const relatives = await optedInRelatives(d.db, companyId, entry.clientId)
      if (!relatives.length) return 0
      const names = await visitNames(d.db, companyId, entry.caregiverId, entry.clientId)
      if (!names) return 0
      const { tz } = await deps.time.now(companyId, now)
      const skip = now.getTime() - punchAt.getTime() > LATE_MS ? 'skipped_late' : inQuietHours(await quietHours(companyId), now, tz) ? 'skipped_quiet' : null
      const prefix = await deps.profile.agencyShortName(companyId)
      const at = hm(punchAt, tz)
      const body = `${prefix ? prefix + ': ' : ''}${event === 'clock_in'
        ? `${names.caregiverFirst} has arrived to help ${names.clientFirst} (${at}).`
        : `${names.caregiverFirst} has finished the visit with ${names.clientFirst} (${at}).`} Reply STOP to stop these texts.`
      let sent = 0
      for (const r of relatives) {
        if (!(await claimFamilyText(d.db, companyId, entry.id, r.id, event, skip ?? 'pending'))) continue
        if (skip) continue
        const ok = await deps.notify.sendText({ companyId, phone: r.phone, body })
        await setFamilyTextStatus(d.db, companyId, entry.id, r.id, event, ok ? 'sent' : 'failed')
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
