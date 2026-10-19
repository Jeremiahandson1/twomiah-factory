// Over-visit-length texts — a caregiver still clocked in past the LENGTH of their scheduled visit, measured from when
// they actually clocked in (in at 9:05 for a 1-hour visit → "over" at 10:05). Moved from
// templates/crm-homecare/backend/src/jobs/overtimeAlerts.ts (ported there from the CVHC home care CRM); its SQL is in
// server/data/homecareVisitJobs.ts.
//
//   +5 min  → text the caregiver
//   +30 min → text the caregiver again
//   +60 min → text the caregiver AND the office (admins' phones + an in-app notification)
//
// A text, not a push: push reaches nobody who never subscribed, and this works with the app closed. The scheduled
// length is time_entries.allotted_minutes (set at clock-in from the matched visit); unscheduled entries are skipped.
// Each threshold fires at most once per entry (overtime_alert_log unique key); a delayed scan that finds several
// crossed sends only the highest and marks the lower ones done. Entries more than 12 hours past their scheduled end are
// stuck punches that need Force Clock Out, not a text.
//
// One change: the scan runs company by company (each company's clock, name prefix and office); the template's
// database was one agency.
import { claimOvertimeThreshold, companiesWithOpenPunches, punchesPastTheirVisit } from '../../../data/homecareVisitJobs.ts'
import type { CrmDeps } from '../../deps.ts'
import { fmtClock, type AgencyTime } from './agencyTime.ts'
import type { AgencyProfiles } from './agencyProfile.ts'
import type { VisitNotify } from './visitNotify.ts'

export const THRESHOLDS = [5, 30, 60]
export const OFFICE_THRESHOLD = 60
export const STALE_HOURS = 12

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60), m = min % 60
  if (h && m) return `${h} hr ${m} min`
  return h ? `${h} hr` : `${m} min`
}

export function createOvertimeAlerts(d: CrmDeps, deps: { time: AgencyTime; profile: AgencyProfiles; notify: VisitNotify }) {
  const { notify } = deps

  /** One company's alerts. Returns how many texts went out. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    const nowIso = at.toISOString()
    const open = await punchesPastTheirVisit(d.db, companyId, nowIso, THRESHOLDS[0], STALE_HOURS)
    if (!open.length) return 0
    const { tz } = await deps.time.now(companyId, at)
    const prefix = await deps.profile.agencyShortName(companyId)
    let sent = 0
    for (const e of open) {
      try {
        const over = Number(e.minutesOver)
        const crossed = THRESHOLDS.filter((t) => over >= t)
        const top = crossed[crossed.length - 1]
        if (!top || top <= Number(e.lastThreshold)) continue
        // Claim the threshold atomically — if another scan already did, stop.
        if (!(await claimOvertimeThreshold(d.db, companyId, e.id, top, true))) continue
        for (const t of crossed.slice(0, -1)) await claimOvertimeThreshold(d.db, companyId, e.id, t, false)
        // start_time holds UTC wall-clock, so it is read back as UTC.
        const clockIn = fmtClock(new Date(e.startIso), tz)
        const client = `${e.clFirst} ${String(e.clLast || '').charAt(0)}.`.trim()
        const scheduled = fmtDuration(Number(e.allottedMinutes))
        const overTxt = fmtDuration(over)
        if (await notify.sendCaregiverAlert({ userId: e.caregiverId, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: e.cgPhone, body: `${prefix ? prefix + ': ' : ''}You're still clocked in with ${client} — ${overTxt} past your ${scheduled} visit (clocked in ${clockIn}). Please clock out if you're done.` })) sent++
        if (top === OFFICE_THRESHOLD) {
          const msg = `${e.cgFirst} ${e.cgLast} is still clocked in with ${client} — ${overTxt} past a ${scheduled} visit (clocked in ${clockIn}).`
          const admins = await notify.notifyAdmins(companyId, 'overtime_alert', 'Still clocked in past scheduled time', msg)
          for (const a of admins) {
            if (a.phone && await notify.sendCaregiverAlert({ userId: a.id, alertType: 'overtime_alert', channel: 'sms', urgent: true, phone: a.phone, body: `${prefix ? prefix + ': ' : ''}${msg}` })) sent++
          }
        }
      } catch (err: any) { d.logger.error('[overtime-alerts] one entry', { error: err?.message }) }
    }
    return sent
  }

  /** Every company's alerts. Returns how many texts went out. */
  async function scanOvertimeAlerts(at: Date = new Date()): Promise<number> {
    let sent = 0
    for (const companyId of await companiesWithOpenPunches(d.db)) {
      try { sent += await scanCompany(companyId, at) } catch (e: any) { d.logger.error('[overtime-alerts] one company', { companyId, error: e?.message }) }
    }
    return sent
  }

  return { scanOvertimeAlerts, scanCompany }
}
