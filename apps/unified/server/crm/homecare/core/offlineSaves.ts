// Saves made on the phone without signal and sent later (item 4, care_offline_saves) — the SERVER's half of the promise.
// The phone's queue (apps/mobile/src/offline) keeps a save and sends it again until it is answered, so a save can arrive twice
// (the reply was lost), hours late, or after someone else has recorded the same thing. This module makes that safe for the
// home-care saves a caregiver makes at a visit — a task done, a medicine given, a photo:
//
//   · REPEAT-SAFE. The phone sends one Idempotency-Key per save, the same on every try. The first successful answer is kept
//     (saved_request); a later try with the key gets that answer back and nothing is done twice. A refused save is NOT kept,
//     so it can be fixed and sent again under the same key. Without the header, or without the feature, nothing changes.
//   · THE TIME IT WAS MADE. The phone says when the caregiver tapped (savedAt / administeredAt / takenAt); that is the time
//     recorded, not the time the signal came back. A time in the future (beyond a few minutes of clock difference) or more
//     than 30 days old is refused in plain words.
//   · ONE DOSE, ONE RECORD. A dose of a medicine at a scheduled time that someone has already recorded as given is refused with
//     who recorded it and when (409), so two caregivers who both tapped "given" offline do not both land. A dose of a medicine
//     that has since been stopped is still recorded — it happened — and the office is told.
//
// Off for a company without the care_offline_saves feature (not ready until the owner has tested it on a phone).
import { and, eq } from 'drizzle-orm'
import { medicationLogs, user as users } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export const OFFLINE_SAVES_FEATURE = 'care_offline_saves'
/** A phone's clock may be this far ahead of ours before a time is called "in the future". */
const SKEW_MS = 5 * 60_000
const OLDEST_DAYS = 30

/** The time a phone says a save was made, checked against ours. `at` is null when none was given. Pure. */
export function savedTime(raw: unknown, now: Date = new Date()): { at: Date | null } | { problem: string } {
  if (raw === undefined || raw === null || raw === '') return { at: null }
  const at = new Date(raw as any)
  if (Number.isNaN(at.getTime())) return { problem: 'The time this was saved on the phone is not a valid date and time.' }
  if (at.getTime() > now.getTime() + SKEW_MS) return { problem: 'The time this was saved on the phone is in the future — check the phone\'s date and time.' }
  if (now.getTime() - at.getTime() > OLDEST_DAYS * 86_400_000) return { problem: `This was saved on the phone more than ${OLDEST_DAYS} days ago. Tell the office so they can enter it by hand.` }
  return { at: at.getTime() > now.getTime() ? now : at }
}

export function createOfflineSaves(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, OFFLINE_SAVES_FEATURE)

  // Repeat-safety (the Idempotency-Key) is the server-wide guard (http/savedOnce.ts), run for every signed-in write.

  /** Who already recorded this medicine as given at this scheduled time, if anyone. */
  async function doseAlreadyRecorded(companyId: string, medicationId: string, clientId: string, scheduledTime: Date | null) {
    if (!scheduledTime) return null
    const [row] = await d.db.select({ at: medicationLogs.administeredAt, first: users.firstName, last: users.lastName, status: medicationLogs.status })
      .from(medicationLogs).leftJoin(users, eq(users.id, medicationLogs.caregiverId))
      .where(and(eq(medicationLogs.companyId, companyId), eq(medicationLogs.medicationId, medicationId), eq(medicationLogs.clientId, clientId),
        eq(medicationLogs.scheduledTime, scheduledTime)))
      .limit(5).then((rs: any[]) => rs.filter((r) => r.status === 'given' || r.status === 'self_administered'))
    if (!row) return null
    const tz = await deps.time.timezone(companyId)
    const when = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(row.at)
    return { sentence: `${[row.first, row.last].filter(Boolean).join(' ') || 'Someone'} already recorded this dose as given at ${when}. If you gave it too, tell the office before giving anything more.` }
  }

  /** The key the database keeps one-of: this company's medicine at this due time (medication_logs.dose_key). */
  const doseKey = (companyId: string, medicationId: string, due: Date) => `${companyId}|${medicationId}|${due.toISOString()}`

  /** Did this insert fail because another save of the same dose got there first? (Postgres 23505 on the dose_key index, as the driver wraps it.) */
  function isDoseKeyClash(e: any): boolean {
    for (let x = e, n = 0; x && n < 4; x = x.cause, n++) {
      if (x.code === '23505' || /medication_logs_dose_key_idx|duplicate key value/i.test(String(x.message || ''))) return true
    }
    return false
  }

  /** A dose of a medicine that was stopped before it was given: recorded all the same; the office is told. */
  async function tellOfficeIfStopped(companyId: string, med: { name: string; status: string; endDate: string | null }, givenAt: Date) {
    if (med.status === 'active') return false
    const tz = await deps.time.timezone(companyId)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(givenAt)
    if (med.endDate && day <= med.endDate) return false
    await deps.notify.notifyAdmins(companyId, 'dose_after_stop', 'A stopped medicine was recorded as given',
      `${med.name} was recorded as given on ${day}, ${med.endDate ? `after it was stopped on ${med.endDate}` : 'but it is marked as stopped'}. Please check with the caregiver.`)
    return true
  }

  return { enabled, savedTime, doseAlreadyRecorded, doseKey, isDoseKeyClash, tellOfficeIfStopped }
}

export type OfflineSaves = ReturnType<typeof createOfflineSaves>
