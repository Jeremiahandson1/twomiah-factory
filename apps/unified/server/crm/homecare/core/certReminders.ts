// "Your CPR certificate expires in 14 days" — a reminder to the caregiver and to the office at 30, 14 and 0 days before a
// credential expires (certification_records.expiry_date), once per stage, on the agency's own calendar day.
//
// It runs for a company only when that company has the care_cert_reminders feature on (not ready until the owner has
// tested it). Each (credential, expiry date, stage) is claimed in certification_reminder first, so the scan can run as
// often as the visit jobs tick and even on two instances without sending twice; a renewed credential has a new expiry
// date, so its reminders start over. A scan that was down on the day sends the stage the credential is in now (never the
// ones it passed), and one that lapsed more than a week ago is not announced out of the blue.
import { claimCertReminder, companiesWithCredentials, credentialsNearExpiry, expiredCredentialsOn } from '../../../data/homecareCertReminders.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export const CERT_REMINDER_FEATURE = 'care_cert_reminders'
/** The days before expiry at which a reminder goes out; 0 is the day it expires. */
export const CERT_STAGES = [30, 14, 0] as const
const GRACE_DAYS = 7

/** The stage a credential is in with this many days left: the smallest stage not yet passed, or 0 once it is due or past. */
export function certStage(daysLeft: number): number | null {
  if (daysLeft > CERT_STAGES[0]) return null
  if (daysLeft <= 0) return 0
  return daysLeft <= 14 ? 14 : 30
}

export function createCertReminders(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify }) {
  const words = (type: string, daysLeft: number, expiry: string) =>
    daysLeft > 0 ? `${type} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${expiry})`
      : daysLeft === 0 ? `${type} expires today (${expiry})` : `${type} expired on ${expiry}`

  /** One company's reminders. Returns how many were sent (one per credential and stage, however many people were told). */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await d.features.isFeatureEnabled(companyId, CERT_REMINDER_FEATURE))) return 0
    const { date } = await deps.time.now(companyId, at)
    let sent = 0
    for (const cert of await credentialsNearExpiry(d.db, companyId, date, CERT_STAGES[0], GRACE_DAYS)) {
      try {
        const stage = certStage(cert.daysLeft)
        if (stage === null) continue
        // Claim it first: only the scan that inserts the row sends.
        if (!(await claimCertReminder(d.db, companyId, cert.id, cert.caregiverId, cert.expiryDate, String(stage)))) continue
        const what = words(cert.certificationType, cert.daysLeft, cert.expiryDate)
        const title = cert.daysLeft > 0 ? 'Credential expiring' : cert.daysLeft === 0 ? 'Credential expires today' : 'Credential expired'
        // The caregiver: a notice in the app and a phone push (their own notification settings apply to the push).
        await deps.notify.notifyUser(companyId, cert.caregiverId, 'certification_expiring', title, `Your ${what}. Send the office the renewed copy.`)
        await deps.notify.sendCaregiverAlert({
          companyId, userId: cert.caregiverId, alertType: 'cert_reminder', channel: 'push', body: `Your ${what}`,
          payload: { title, body: `Your ${what}`, tag: `cert-${cert.id}-${stage}`, data: { type: 'certification_expiring', certificationId: cert.id, stage } },
        })
        // The office: one notice for the credential.
        await deps.notify.notifyAdmins(companyId, 'certification_expiring', title, `${cert.firstName} ${cert.lastName}: ${what}.${stage === 0 ? ' They are flagged when scheduling until it is renewed.' : ''}`)
        sent++
      } catch (e: any) { d.logger.error('[cert-reminders] one credential', { error: e?.message }) }
    }
    return sent
  }

  /** Every company's reminders. Returns how many were sent. */
  async function scanCertReminders(at: Date = new Date()): Promise<number> {
    let sent = 0
    for (const companyId of await companiesWithCredentials(d.db)) {
      try { sent += await scanCompany(companyId, at) } catch (e: any) { d.logger.error('[cert-reminders] one company', { companyId, error: e?.message }) }
    }
    return sent
  }

  /**
   * Who holds an expired credential on `day`, for the scheduling screens to flag: { caregiverId: ['CPR (expired 2026-10-01)'] }.
   * A flag, never a block (a missing certificate is for the office to weigh, as authorization shortfalls are). Empty when the
   * company has not got the reminders feature on.
   */
  async function expiredFor(companyId: string, caregiverIds: string[], day: string): Promise<Record<string, string[]>> {
    if (!caregiverIds.length || !(await d.features.isFeatureEnabled(companyId, CERT_REMINDER_FEATURE))) return {}
    return expiredCredentialsOn(d.db, companyId, caregiverIds, day)
  }

  return { scanCertReminders, scanCompany, expiredFor }
}
