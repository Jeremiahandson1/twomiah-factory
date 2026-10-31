// "Your CPR certificate expires in 14 days" — a reminder to the caregiver and to the office at the lead times the AGENCY picks
// (any of 90 / 60 / 30 / 14 / 0 days before a credential expires; 30, 14 and 0 until it picks), once per stage, on the
// agency's own calendar day. By phone and in the app, and by email when the agency has that switched on. Client credentials
// (a client's own certification or licence) are reminded the same way, to the office only.
//
// It runs for a company only when that company has the care_cert_reminders feature on (not ready until the owner has
// tested it). Each (credential, expiry date, stage) is claimed in certification_reminder first, so the scan can run as
// often as the visit jobs tick and even on two instances without sending twice; a renewed credential has a new expiry
// date, so its reminders start over. A scan that was down on the day sends the stage the credential is in now (never the
// ones it passed), and one that lapsed more than a week ago is not announced out of the blue.
//
// The same scan fills the office's "certification alerts" list (certification_alerts), so the old list and the reminders
// are one source of truth. The agency can also choose to BLOCK putting a caregiver with an expired credential on a shift
// (company.settings.certReminders.blockExpired); without it, an expired credential is a flag, never a refusal.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import {
  claimCertReminder, claimClientCredentialReminder, clientCredentialsNearExpiry, companiesWithClientCredentials, companiesWithCredentials,
  credentialsNearExpiry, expiredCredentialsOn, officeEmails, resolveStaleCertAlerts, upsertCertAlert,
} from '../../../data/homecareCertReminders.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export const CERT_REMINDER_FEATURE = 'care_cert_reminders'
/** The lead times an agency may pick from: days before expiry; 0 is the day it expires. */
export const CERT_LEAD_CHOICES = [90, 60, 30, 14, 0] as const
/** What an agency that has not picked gets. */
export const CERT_STAGES = [30, 14, 0] as const
const GRACE_DAYS = 7
/** How far back the office alerts list looks for credentials that have already expired. */
const ALERT_LOOKBACK_DAYS = 3650

export interface CertSettings { leadDays: number[]; email: boolean; blockExpired: boolean }
export const DEFAULT_CERT_SETTINGS: CertSettings = { leadDays: [...CERT_STAGES], email: false, blockExpired: false }

/** The lead times as a sorted (largest first) list of allowed choices; anything else is dropped, and none left means the default. */
export function normLeadDays(v: unknown): number[] {
  const picked = new Set<number>()
  for (const x of Array.isArray(v) ? v : []) {
    const n = Number(x)
    if ((CERT_LEAD_CHOICES as readonly number[]).includes(n)) picked.add(n)
  }
  return picked.size ? [...picked].sort((a, b) => b - a) : [...CERT_STAGES]
}

/**
 * The stage a credential is in with this many days left: the smallest of the agency's stages not yet passed, or 0 once it is
 * due or past (null when the agency did not pick the expiry day, or the credential is further out than its first stage).
 */
export function certStage(daysLeft: number, stages: readonly number[] = CERT_STAGES): number | null {
  const sorted = [...stages].sort((a, b) => b - a)
  if (!sorted.length || daysLeft > sorted[0]) return null
  const left = Math.max(daysLeft, 0)
  let best: number | null = null
  for (const s of sorted) if (s >= left && (best === null || s < best)) best = s
  return best
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The agency's reminder choices and the expired-credential rule, which need only the database and the feature gate — so the
 * places that put a caregiver on a shift (scheduling/shared.ts assignShift among them) can ask without the whole reminder job.
 */
export function createCredentialGate(d: CrmDeps) {
  /** The agency's reminder choices (company.settings.certReminders), defaults filled in. */
  async function settings(companyId: string): Promise<CertSettings> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const s = ((row?.settings as any)?.certReminders || {}) as Partial<CertSettings>
    return { leadDays: normLeadDays(s.leadDays), email: s.email === true, blockExpired: s.blockExpired === true }
  }

  async function setSettings(companyId: string, patch: Partial<CertSettings>): Promise<CertSettings> {
    const now = await settings(companyId)
    const next: CertSettings = {
      leadDays: patch.leadDays !== undefined ? normLeadDays(patch.leadDays) : now.leadDays,
      email: patch.email !== undefined ? patch.email === true : now.email,
      blockExpired: patch.blockExpired !== undefined ? patch.blockExpired === true : now.blockExpired,
    }
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), certReminders: next } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return next
  }

  /**
   * Who holds an expired credential on `day`, for the scheduling screens to flag: { caregiverId: ['CPR (expired 2026-10-01)'] }.
   * A flag unless the agency chose to block (see `blockedFor`). Empty when the company has not got the reminders feature on.
   */
  async function expiredFor(companyId: string, caregiverIds: string[], day: string): Promise<Record<string, string[]>> {
    if (!caregiverIds.length || !(await d.features.isFeatureEnabled(companyId, CERT_REMINDER_FEATURE))) return {}
    return expiredCredentialsOn(d.db, companyId, caregiverIds, day)
  }

  /**
   * The caregivers among `caregiverIds` the agency will NOT put on a shift on `day` because of an expired credential:
   * { caregiverId: ['CPR (expired …)'] }. Empty unless the agency switched blocking on.
   */
  async function blockedFor(companyId: string, caregiverIds: string[], day: string): Promise<Record<string, string[]>> {
    if (!caregiverIds.length || !(await settings(companyId)).blockExpired) return {}
    return expiredFor(companyId, caregiverIds, day)
  }

  return { settings, setSettings, expiredFor, blockedFor }
}
export type CredentialGate = ReturnType<typeof createCredentialGate>

export function createCertReminders(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify }) {
  const gate = createCredentialGate(d)
  const { settings } = gate
  const words = (type: string, daysLeft: number, expiry: string) =>
    daysLeft > 0 ? `${type} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${expiry})`
      : daysLeft === 0 ? `${type} expires today (${expiry})` : `${type} expired on ${expiry}`

  /** Best-effort email: a mail that cannot go never stops the reminder. */
  async function mail(companyId: string, to: string | null | undefined, subject: string, line: string): Promise<boolean> {
    if (!to) return false
    try {
      const agency = await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
      const name = agency[0]?.name || 'Your agency'
      await d.services.emailService.sendRaw({ to, subject, html: `<p>${esc(line)}</p><p style="color:#6b7280">${esc(name)}</p>` })
      return true
    } catch (e: any) { d.logger.error('[cert-reminders] email', { error: e?.message }); return false }
  }

  /** One company's reminders. Returns how many were sent (one per credential and stage, however many people were told). */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await d.features.isFeatureEnabled(companyId, CERT_REMINDER_FEATURE))) return 0
    const { date } = await deps.time.now(companyId, at)
    const cfg = await settings(companyId)
    const window = cfg.leadDays[0]
    let sent = 0
    const office = cfg.email ? await officeEmails(d.db, companyId) : []
    // The alerts list is not an announcement: it shows every credential inside the window and every one already expired,
    // however long ago. The reminders below keep the one-week grace (an old lapse is not announced out of the blue).
    for (const cert of await credentialsNearExpiry(d.db, companyId, date, window, ALERT_LOOKBACK_DAYS)) {
      try {
        await upsertCertAlert(d.db, companyId, { caregiverId: cert.caregiverId, certificationRecordId: cert.id, certificationType: cert.certificationType, expiryDate: cert.expiryDate, daysLeft: cert.daysLeft })
        if (cert.daysLeft < -GRACE_DAYS) continue
        const stage = certStage(cert.daysLeft, cfg.leadDays)
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
        const flagged = stage === 0 ? (cfg.blockExpired ? ' They cannot be put on a shift until it is renewed.' : ' They are flagged when scheduling until it is renewed.') : ''
        await deps.notify.notifyAdmins(companyId, 'certification_expiring', title, `${cert.firstName} ${cert.lastName}: ${what}.${flagged}`)
        if (cfg.email) {
          await mail(companyId, cert.email, title, `Your ${what}. Send the office the renewed copy.`)
          for (const to of office) await mail(companyId, to, title, `${cert.firstName} ${cert.lastName}: ${what}.${flagged}`)
        }
        sent++
      } catch (e: any) { d.logger.error('[cert-reminders] one credential', { error: e?.message }) }
    }
    await resolveStaleCertAlerts(d.db, companyId)
    // Clients' own credentials: the office is told (a client does not sign in to be reminded).
    for (const cc of await clientCredentialsNearExpiry(d.db, companyId, date, window, GRACE_DAYS)) {
      try {
        const stage = certStage(cc.daysLeft, cfg.leadDays)
        if (stage === null) continue
        if (!(await claimClientCredentialReminder(d.db, companyId, cc.id, cc.expiryDate, String(stage)))) continue
        const what = words(cc.credentialType, cc.daysLeft, cc.expiryDate)
        const title = cc.daysLeft > 0 ? 'Client credential expiring' : cc.daysLeft === 0 ? 'Client credential expires today' : 'Client credential expired'
        await deps.notify.notifyAdmins(companyId, 'client_credential_expiring', title, `${cc.firstName} ${cc.lastName}: ${what}.`)
        if (cfg.email) for (const to of office) await mail(companyId, to, title, `${cc.firstName} ${cc.lastName}: ${what}.`)
        sent++
      } catch (e: any) { d.logger.error('[cert-reminders] one client credential', { error: e?.message }) }
    }
    return sent
  }

  /** Every company's reminders. Returns how many were sent. */
  async function scanCertReminders(at: Date = new Date()): Promise<number> {
    let sent = 0
    const ids = new Set([...(await companiesWithCredentials(d.db)), ...(await companiesWithClientCredentials(d.db))])
    for (const companyId of ids) {
      try { sent += await scanCompany(companyId, at) } catch (e: any) { d.logger.error('[cert-reminders] one company', { companyId, error: e?.message }) }
    }
    return sent
  }

  return { scanCertReminders, scanCompany, ...gate }
}
