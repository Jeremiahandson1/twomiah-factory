// Day-before appointment reminders by text (SALON launch QA: "no appointment reminders"). Moved from
// templates/crm-salon/backend/src/services/appointmentReminders.ts; started once at boot from crm/services.ts startJobs
// where the vertical says so (CrmSettings.appointmentReminders).
//
// Every 10 minutes: any appointment starting 22–26 hours from now that is still scheduled or confirmed, whose client has
// a number, and that has not been reminded yet gets one text. The row is stamped reminderSentAt whether or not the
// carrier accepted it, so a failure is recorded once and never retried into a spam loop.
import { and, eq, gte, lte, isNull, inArray } from 'drizzle-orm'
import { appointment, contact, serviceMenu, company } from '../../db/schema/index.ts'
import { companyTimeZone } from '@twomiah/tenant-backend'
import type { Logger } from '../../core/logger.ts'

const WINDOW_START_H = 22
const WINDOW_END_H = 26
const INTERVAL_MS = 10 * 60 * 1000

/** The time in the text, in the salon's zone and SAYING so — the client reading it has no screen to explain it. (T58) */
function fmtWhen(d: Date, timeZone: string): string {
  try {
    return d.toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch {
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  }
}

export function createAppointmentReminders(deps: { db: any; sms: { sendSMS: (companyId: string, msg: any) => Promise<any> }; logger: Logger }) {
  const { db, sms, logger } = deps

  async function processAppointmentReminders(): Promise<{ sent: number; failed: number }> {
    const now = Date.now()
    const rows = await db.select({
      appt: appointment,
      clientName: contact.name,
      clientPhone: contact.phone,
      clientMobile: contact.mobile,
      serviceName: serviceMenu.name,
      companyName: company.name,
    })
      .from(appointment)
      .leftJoin(contact, eq(appointment.contactId, contact.id))
      .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
      .leftJoin(company, eq(appointment.companyId, company.id))
      .where(and(
        gte(appointment.startTime, new Date(now + WINDOW_START_H * 3600_000)),
        lte(appointment.startTime, new Date(now + WINDOW_END_H * 3600_000)),
        isNull(appointment.reminderSentAt),
        inArray(appointment.status, ['scheduled', 'confirmed']),
      ))
      .limit(200)

    let sent = 0, failed = 0
    const tzByCompany = new Map<string, string>()
    for (const r of rows) {
      const to = r.clientMobile || r.clientPhone
      if (!to || !r.appt.contactId) {
        await db.update(appointment).set({ reminderSentAt: new Date(), reminderNotes: 'No mobile number on file' }).where(eq(appointment.id, r.appt.id))
        continue
      }
      if (!tzByCompany.has(r.appt.companyId)) {
        // The business's one clock (Settings › Company), as every other reader of the time has.
        tzByCompany.set(r.appt.companyId, await companyTimeZone(db, r.appt.companyId))
      }
      const when = fmtWhen(new Date(r.appt.startTime), tzByCompany.get(r.appt.companyId)!)
      const first = (r.clientName || '').split(' ')[0] || 'there'
      const body = `Hi ${first}, a reminder from ${r.companyName || 'your salon'}: ${r.serviceName ? r.serviceName + ' ' : 'your appointment '}on ${when}. Reply to this text if you need to reschedule.`
      try {
        const msg = await sms.sendSMS(r.appt.companyId, { contactId: r.appt.contactId, toPhone: to, message: body })
        const ok = msg?.status !== 'failed'
        if (ok) sent++; else failed++
        await db.update(appointment).set({ reminderSentAt: new Date(), reminderNotes: ok ? 'Reminder text sent' : `Reminder failed: ${msg?.errorMessage || 'send failed'}` }).where(eq(appointment.id, r.appt.id))
      } catch (e: any) {
        failed++
        await db.update(appointment).set({ reminderSentAt: new Date(), reminderNotes: `Reminder failed: ${e?.message || 'send failed'}` }).where(eq(appointment.id, r.appt.id))
      }
    }
    if (sent || failed) logger.info('[reminders] appointment reminders', { sent, failed })
    return { sent, failed }
  }

  function startAppointmentReminders(): void {
    const tick = () => processAppointmentReminders().catch((e) => logger.warn('[reminders] appointment reminder pass failed', { error: e?.message || String(e) }))
    setTimeout(tick, 60_000)
    setInterval(tick, INTERVAL_MS)
  }

  return { processAppointmentReminders, startAppointmentReminders }
}
