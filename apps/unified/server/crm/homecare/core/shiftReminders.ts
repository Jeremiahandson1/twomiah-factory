// "Your shift starts in 1 hour" — a push to the caregiver, once per visit. Moved from
// templates/crm-homecare/backend/src/jobs/shiftReminders.ts (ported there from the CVHC home care CRM); its SQL is in
// server/data/homecareVisitJobs.ts.
//
// It expands through the shared engine, so a CANCELLED visit is never announced and a RESCHEDULED one is announced at
// its new time; and "now" is the agency's own clock. Window: occurrences starting 55–65 minutes from now. The scan runs
// every 5 minutes (core/visitJobs.ts), and the shift_reminder_log unique key makes each (schedule, day) send exactly
// once — across restarts and across instances.
//
// One change: the template's database was one agency; the scan now runs for each company with an active schedule, on
// that company's clock.
import { claimShiftReminder, companiesWithActiveSchedules, shiftsStartingInAnHour } from '../../../data/homecareVisitJobs.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import type { VisitNotify } from './visitNotify.ts'

export function createShiftReminders(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify }) {
  /** One company's reminders. Returns how many were sent. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    const { date, time } = await deps.time.now(companyId, at)
    const upcoming = await shiftsStartingInAnHour(d.db, companyId, date, time)
    let sent = 0
    for (const s of upcoming) {
      try {
        // Claim it first: only the scan that inserts the row sends.
        if (!(await claimShiftReminder(d.db, companyId, s.id, date))) continue
        const body = `${s.clientFirst} ${s.clientLast} · ${s.startHm}–${s.endHm}`
        await deps.notify.sendCaregiverAlert({
          companyId, userId: s.caregiverId, alertType: 'shift_reminder', channel: 'push', body,
          payload: { title: 'Shift in 1 hour', body, tag: `shift-reminder-${s.id}-${date}`,
            data: { type: 'shift_reminder', eventType: 'shift_reminder', urgent: false, scheduleId: s.id } },
        })
        sent++
      } catch (e: any) { d.logger.error('[shift-reminders] one shift', { error: e?.message }) }
    }
    return sent
  }

  /** Every company's reminders. Returns how many were sent. */
  async function scanShiftReminders(at: Date = new Date()): Promise<number> {
    let sent = 0
    for (const companyId of await companiesWithActiveSchedules(d.db)) {
      try { sent += await scanCompany(companyId, at) } catch (e: any) { d.logger.error('[shift-reminders] one company', { companyId, error: e?.message }) }
    }
    return sent
  }

  return { scanShiftReminders, scanCompany }
}
