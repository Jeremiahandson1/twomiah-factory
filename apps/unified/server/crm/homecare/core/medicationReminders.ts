// "Time for Mrs. Lee's 8:00 AM Metformin" — a push to the caregiver on the visit when a scheduled dose is due, and a notice
// to the office when a dose that fell inside a visit was never recorded. (item 2, care_medication_reminders; not ready until
// the owner has tested it on a phone.)
//
//   · WHEN A DOSE IS DUE. Each scheduled (not as-needed) medicine carries the times of day it is due on the agency's clock
//     (medications.dose_times, set on the medicine list), inside its start and end dates. A dose is due for a caregiver who is
//     CLOCKED IN at that client, and the push goes out `leadMinutes` before the due time (agency's choice) and keeps being
//     eligible for an hour after, so a caregiver who clocks in at 8:20 for an 8:00 dose is still told. It is not sent when the
//     dose has already been recorded — including a dose saved on the phone without signal, which carries the time it was
//     tapped. Each dose of each visit is claimed (medication_dose_reminder) before it is sent: once, however often the scan
//     runs and on however many instances.
//   · A DOSE THAT WAS NOT RECORDED. When a visit has ended and `officeGraceMinutes` have passed (a phone that was offline has
//     had time to send), every dose that fell inside the visit and still has no record — given, refused, held or missed all
//     count as an answer — is told to the office once.
//   · THE CAREGIVER'S OWN SETTINGS. The push goes through the one door for caregiver alerts (visitNotify.sendCaregiverAlert), so
//     the caregiver's phone-notification switch applies. A dose reminder is urgent: it still goes through quiet hours unless the
//     caregiver turned "still send urgent alerts" off. There is no separate medicine switch in the caregiver's settings.
//   · THE AGENCY'S SETTINGS (company.settings.medicationReminders): on/off, the lead time and the office grace.
import { eq } from 'drizzle-orm'
import { zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { company, user as users } from '../../../db/schema/index.ts'
import { claimDoseReminder, companiesWithDoseTimes, doseRecorded, scheduledMedicines, visitsInWindow } from '../../../data/homecareMedicationReminders.ts'
import type { CrmDeps } from '../../deps.ts'
import { fmtClock, ymdIn, type AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export const MEDICATION_REMINDER_FEATURE = 'care_medication_reminders'
/** What the agency may pick: minutes before the due time the caregiver is told; minutes after a visit ends before the office is. */
export const LEAD_CHOICES = [0, 5, 10, 15, 30] as const
export const GRACE_CHOICES = [15, 30, 60, 120, 240] as const
/** A recorded dose within this many minutes of its due time counts as that dose; a reminder stays eligible this long after it. */
export const DOSE_WINDOW_MINUTES = 60
const MAX_TIMES = 12

export interface MedicationReminderSettings { enabled: boolean; leadMinutes: number; officeGraceMinutes: number }
export const DEFAULT_REMINDER_SETTINGS: MedicationReminderSettings = { enabled: true, leadMinutes: 10, officeGraceMinutes: 60 }

const pickFrom = (choices: readonly number[], v: unknown, fallback: number) => (choices.includes(Number(v)) ? Number(v) : fallback)

/** A list of dose times as sorted, de-duplicated 'HH:MM'. `{ error }` names the first thing wrong; null/empty → []. Pure. */
export function normDoseTimes(v: unknown): { times: string[] } | { error: string } {
  if (v === null || v === undefined || v === '') return { times: [] }
  if (!Array.isArray(v)) return { error: 'Dose times must be a list of times, like 08:00 and 20:00.' }
  const out = new Set<string>()
  for (const raw of v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw).trim())
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: `"${String(raw)}" is not a time of day. Use hours and minutes, like 08:00.` }
    out.add(`${m[1].padStart(2, '0')}:${m[2]}`)
  }
  if (out.size > MAX_TIMES) return { error: `A medicine can have at most ${MAX_TIMES} dose times a day.` }
  return { times: [...out].sort() }
}

export function createMedicationReminders(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify }) {
  async function settings(companyId: string): Promise<MedicationReminderSettings> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = ((row?.settings as any)?.medicationReminders || {}) as Partial<MedicationReminderSettings>
    return {
      enabled: s.enabled !== false,
      leadMinutes: pickFrom(LEAD_CHOICES, s.leadMinutes, DEFAULT_REMINDER_SETTINGS.leadMinutes),
      officeGraceMinutes: pickFrom(GRACE_CHOICES, s.officeGraceMinutes, DEFAULT_REMINDER_SETTINGS.officeGraceMinutes),
    }
  }

  async function setSettings(companyId: string, patch: Partial<MedicationReminderSettings>): Promise<MedicationReminderSettings> {
    const now = await settings(companyId)
    const next: MedicationReminderSettings = {
      enabled: patch.enabled !== undefined ? patch.enabled === true : now.enabled,
      leadMinutes: patch.leadMinutes !== undefined ? pickFrom(LEAD_CHOICES, patch.leadMinutes, now.leadMinutes) : now.leadMinutes,
      officeGraceMinutes: patch.officeGraceMinutes !== undefined ? pickFrom(GRACE_CHOICES, patch.officeGraceMinutes, now.officeGraceMinutes) : now.officeGraceMinutes,
    }
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), medicationReminders: next } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return next
  }

  /** The instants a medicine is due on these agency days, inside its start and end dates. */
  function dueInstants(med: { doseTimes: unknown; startDate: string | null; endDate: string | null }, days: string[], tz: string): Date[] {
    const parsed = normDoseTimes(med.doseTimes)
    if ('error' in parsed) return []
    const out: Date[] = []
    for (const day of days) {
      if ((med.startDate && day < med.startDate) || (med.endDate && day > med.endDate)) continue
      for (const t of parsed.times) out.push(zonedWallTimeToUtc(day, t, tz))
    }
    return out
  }

  /** One company's reminders and alerts. Returns how many were sent. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await d.features.isFeatureEnabled(companyId, MEDICATION_REMINDER_FEATURE))) return 0
    const cfg = await settings(companyId)
    if (!cfg.enabled) return 0
    const tz = await deps.time.timezone(companyId)
    const nowMs = at.getTime()
    const DAY = 86_400_000
    let sent = 0

    // 1. The caregiver on an open visit: a dose due within the lead time, or up to an hour ago and not yet recorded.
    const open = await visitsInWindow(d.db, companyId, new Date(nowMs - DAY).toISOString(), at.toISOString(), 'open')
    // 2. The office: visits that ended at least `officeGraceMinutes` ago (and not more than a day before that).
    const ended = await visitsInWindow(d.db, companyId, new Date(nowMs - DAY - cfg.officeGraceMinutes * 60_000).toISOString(), new Date(nowMs - cfg.officeGraceMinutes * 60_000).toISOString(), 'ended')
    const meds = await scheduledMedicines(d.db, companyId, [...new Set([...open, ...ended].map((v) => v.clientId))])

    for (const v of open) {
      const startMs = Date.parse(v.startIso)
      const days = [...new Set([ymdIn(new Date(startMs), tz), ymdIn(at, tz)])]
      for (const med of meds.filter((m) => m.clientId === v.clientId)) {
        for (const due of dueInstants(med, days, tz)) {
          const dueMs = due.getTime()
          if (nowMs < dueMs - cfg.leadMinutes * 60_000 || nowMs > dueMs + DOSE_WINDOW_MINUTES * 60_000) continue
          if (dueMs + DOSE_WINDOW_MINUTES * 60_000 < startMs) continue // due long before they clocked in
          try {
            if (await doseRecorded(d.db, companyId, med.id, due.toISOString(), DOSE_WINDOW_MINUTES)) continue
            if (!(await claimDoseReminder(d.db, companyId, med.id, v.id, due.toISOString(), 'due'))) continue
            const clock = fmtClock(due, tz)
            const who = `${v.clientFirst} ${v.clientLast}`
            const body = `${who}: ${med.name}${med.dosage ? ` ${med.dosage}` : ''}, due ${clock}`
            await deps.notify.notifyUser(companyId, v.caregiverId, 'medication_due', 'Medication due', body)
            await deps.notify.sendCaregiverAlert({
              companyId, userId: v.caregiverId, alertType: 'medication_reminder', channel: 'push', body, urgent: true,
              payload: { title: 'Medication due', body, tag: `med-${med.id}-${due.toISOString()}`,
                data: { type: 'medication_due', eventType: 'medication_due', urgent: true, medicationId: med.id, clientId: v.clientId, timeEntryId: v.id, dueAt: due.toISOString() } },
            })
            sent++
          } catch (e: any) { d.logger.error('[medication-reminders] one dose', { error: e?.message }) }
        }
      }
    }

    for (const v of ended) {
      const startMs = Date.parse(v.startIso), endMs = Date.parse(v.endIso as string)
      const days = [...new Set([ymdIn(new Date(startMs), tz), ymdIn(new Date(endMs), tz)])]
      for (const med of meds.filter((m) => m.clientId === v.clientId)) {
        for (const due of dueInstants(med, days, tz)) {
          const dueMs = due.getTime()
          if (dueMs < startMs || dueMs > endMs) continue // only a dose that fell inside the visit
          try {
            if (await doseRecorded(d.db, companyId, med.id, due.toISOString(), DOSE_WINDOW_MINUTES)) continue
            if (!(await claimDoseReminder(d.db, companyId, med.id, v.id, due.toISOString(), 'missed'))) continue
            const [cg] = await d.db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, v.caregiverId)).limit(1)
            await deps.notify.notifyAdmins(companyId, 'medication_not_recorded', 'Medication not recorded',
              `${v.clientFirst} ${v.clientLast}: ${med.name}${med.dosage ? ` ${med.dosage}` : ''} was due at ${fmtClock(due, tz)} on ${ymdIn(due, tz)} during ${cg ? `${cg.firstName} ${cg.lastName}'s` : 'a'} visit and was not recorded as given, refused, held or missed.`)
            sent++
          } catch (e: any) { d.logger.error('[medication-reminders] one missed dose', { error: e?.message }) }
        }
      }
    }
    return sent
  }

  /** Every company's reminders. Returns how many were sent. */
  async function scanMedicationReminders(at: Date = new Date()): Promise<number> {
    let sent = 0
    for (const companyId of await companiesWithDoseTimes(d.db)) {
      try { sent += await scanCompany(companyId, at) } catch (e: any) { d.logger.error('[medication-reminders] one company', { companyId, error: e?.message }) }
    }
    return sent
  }

  return { settings, setSettings, scanCompany, scanMedicationReminders }
}
export type MedicationReminders = ReturnType<typeof createMedicationReminders>
