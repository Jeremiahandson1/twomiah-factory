// Day-before appointment reminders by text. (SALON launch QA: "no appointment reminders")
//
// Every 10 minutes: any appointment starting 22–26 hours from now that is still scheduled/confirmed,
// has a client with a mobile/phone number and has not been reminded yet gets one text. The row is
// stamped reminderSentAt whether or not the carrier accepted it, so a failure (empty texting wallet,
// bad number) is recorded once and never retried into a spam loop; the failure reason is kept in
// reminderNotes and the message itself is in the client's text thread with status "failed".
import { db } from '../../db/index.ts'
import { appointment, contact, serviceMenu, company, bookingSettings } from '../../db/schema.ts'
import { eq, and, gte, lte, isNull, inArray } from 'drizzle-orm'
import { sendSMS } from './sms.ts'

const WINDOW_START_H = 22
const WINDOW_END_H = 26
const INTERVAL_MS = 10 * 60 * 1000

function fmtWhen(d: Date, timeZone: string): string {
  try {
    return d.toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
}

export async function processAppointmentReminders(): Promise<{ sent: number; failed: number }> {
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
      const [bs] = await db.select({ timezone: bookingSettings.timezone }).from(bookingSettings).where(eq(bookingSettings.companyId, r.appt.companyId)).limit(1)
      tzByCompany.set(r.appt.companyId, bs?.timezone || 'America/Chicago')
    }
    const when = fmtWhen(new Date(r.appt.startTime), tzByCompany.get(r.appt.companyId)!)
    const first = (r.clientName || '').split(' ')[0] || 'there'
    const body = `Hi ${first}, a reminder from ${r.companyName || 'your salon'}: ${r.serviceName ? r.serviceName + ' ' : 'your appointment '}on ${when}. Reply to this text if you need to reschedule.`
    try {
      const msg: any = await sendSMS(r.appt.companyId, { contactId: r.appt.contactId, toPhone: to, message: body })
      const ok = msg?.status !== 'failed'
      if (ok) sent++; else failed++
      await db.update(appointment).set({ reminderSentAt: new Date(), reminderNotes: ok ? 'Reminder text sent' : `Reminder failed: ${msg?.errorMessage || 'send failed'}` }).where(eq(appointment.id, r.appt.id))
    } catch (e: any) {
      failed++
      await db.update(appointment).set({ reminderSentAt: new Date(), reminderNotes: `Reminder failed: ${e?.message || 'send failed'}` }).where(eq(appointment.id, r.appt.id))
    }
  }
  if (sent || failed) console.log(`[reminders] appointment reminders: ${sent} sent, ${failed} failed`)
  return { sent, failed }
}

export function startAppointmentReminders(): void {
  const tick = () => processAppointmentReminders().catch((e) => console.warn('[reminders] appointment reminder pass failed:', e?.message || e))
  setTimeout(tick, 60_000)
  setInterval(tick, INTERVAL_MS)
}
