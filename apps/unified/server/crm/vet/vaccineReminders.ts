// Automatic vaccine reminders — the registry called Reminders & Recall "automated" and every reminder was sent by hand
// (matrix 10/23). Now the way the salon's day-before reminders run (crm/salon/appointmentReminders.ts): a timed pass,
// on the clinic's own clock, through the clinic's own texting, once per due date. The manual Send Reminder stays.
//
// The rules (company.settings.vetReminders — off until the clinic switches it on):
//   · every hour, between 9am and 7pm on the clinic's clock (a text at 2am is not a reminder);
//   · the latest vaccination per pet and vaccine whose due date falls from today to `leadDays` ahead, for a living pet;
//   · ONE text per owner per pass, naming every pet and vaccine due ("Luna and Max … Rabies and DHPP");
//   · each vaccination's due date is claimed in reminder_log (kind 'vaccine_reminder', step 'due:<date>') before the text
//     goes — its unique index is the "once": a renewed vaccine has a new due date and earns its own reminder;
//   · an owner who texted STOP (contact.optedOutSms) is never texted; no number → skipped, and the log says why;
//   · texting not set up, or the usage wallet empty: nothing was sent, so the claim is HELD and tried again on the next
//     pass, rather than spent; a carrier's refusal of the number is recorded once and not retried;
//   · what went out is stamped on the vaccination and the owner (lastRemindedAt, reminderCount), as a manual send is, so
//     the Reminders page's "Reminded" column shows it.
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { companyRowTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { company, contact, patient, vaccination, reminderLog } from '../../db/schema/index.ts'
import { stampVaccinationsReminded } from '../../data/vetReminders.ts'
import { mergeReminder, listPhrase, prettyDate } from './reminders.ts'
import type { Logger } from '../../core/logger.ts'

// No verb that must agree with a count: one text names every pet and shot an owner has due.
export const DEFAULT_VET_MESSAGE = "Hi {{owner_name}}, it's {{clinic_name}} with a reminder: {{vaccine}} for {{pet_name}}, due {{due_date}}. Call us and we'll get it booked in."
export const QUIET_BEFORE = 9
export const QUIET_FROM = 19

export interface VetReminderSettings { auto: boolean; leadDays: number; message: string }

export function vetReminderSettings(settings: unknown): VetReminderSettings {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const r = s?.vetReminders || {}
  const lead = Number(r.leadDays)
  const message = typeof r.message === 'string' && r.message.trim() ? r.message.trim().slice(0, 480) : DEFAULT_VET_MESSAGE
  return { auto: r.auto === true, leadDays: Number.isInteger(lead) && lead >= 1 && lead <= 90 ? lead : 14, message }
}

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hourIn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))

export interface VaccineReminderDeps {
  db: any
  sms: { sendSMS: (companyId: string, msg: any) => Promise<any> }
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
}

export function createVaccineReminders(deps: VaccineReminderDeps) {
  const { db, sms, logger } = deps

  /** Claim one vaccination's due date: a new row, or one HELD by an earlier pass that could not text. */
  async function claim(companyId: string, vaccinationId: string, step: string): Promise<string | null> {
    const fresh = await db.insert(reminderLog).values({ companyId, kind: 'vaccine_reminder', subjectId: vaccinationId, step, status: 'sending' })
      .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
    if (fresh[0]) return fresh[0].id
    const held = await db.update(reminderLog).set({ status: 'sending', updatedAt: new Date() })
      .where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, 'vaccine_reminder'), eq(reminderLog.subjectId, vaccinationId), eq(reminderLog.step, step), eq(reminderLog.status, 'held')))
      .returning({ id: reminderLog.id })
    return held[0]?.id ?? null
  }
  const settle = (ids: string[], status: string, detail: string | null, sentTo: string | null = null) =>
    ids.length ? db.update(reminderLog).set({ status, detail, sentTo, updatedAt: new Date() }).where(inArray(reminderLog.id, ids)) : Promise.resolve()

  async function forClinic(co: any, cfg: VetReminderSettings, now: Date, out: { sent: number; skipped: number; failed: number; held: number }) {
    const tz = companyRowTimeZone(co)
    const hour = hourIn(now, tz)
    if (hour < QUIET_BEFORE || hour >= QUIET_FROM) return
    const today = storeDateString(now, tz)
    const until = addDays(today, cfg.leadDays)
    const rows = await db.select({
      vaccinationId: vaccination.id, vaccine: vaccination.vaccine, givenDate: vaccination.givenDate, dueDate: vaccination.dueDate,
      patientId: patient.id, patientName: patient.name, deceased: patient.deceased,
      ownerId: contact.id, ownerName: contact.name, phone: contact.phone, mobile: contact.mobile, optedOut: contact.optedOutSms,
    })
      .from(vaccination).innerJoin(patient, eq(patient.id, vaccination.patientId)).leftJoin(contact, eq(contact.id, patient.ownerId))
      .where(and(eq(vaccination.companyId, co.id), isNotNull(vaccination.dueDate)))
    // Only the most recent administration per pet and vaccine: a renewed shot does not nag on its old date.
    const latest = new Map<string, any>()
    for (const r of rows) {
      if (r.deceased) continue
      const key = r.patientId + '|' + String(r.vaccine || '').toLowerCase()
      const cur = latest.get(key)
      if (!cur || String(r.givenDate || '') > String(cur.givenDate || '')) latest.set(key, r)
    }
    // A due date is a DATE column ('YYYY-MM-DD'), compared as written — never moved into a zone.
    const due = [...latest.values()].filter((r) => { const d = String(r.dueDate).slice(0, 10); return d >= today && d <= until })
    const byOwner = new Map<string, any[]>()
    for (const r of due) {
      const k = r.ownerId || `none:${r.vaccinationId}`
      byOwner.set(k, [...(byOwner.get(k) || []), r])
    }
    for (const group of byOwner.values()) {
      const claimed: Array<{ row: any; logId: string }> = []
      for (const r of group) {
        const logId = await claim(co.id, r.vaccinationId, `due:${String(r.dueDate).slice(0, 10)}`)
        if (logId) claimed.push({ row: r, logId })
      }
      if (!claimed.length) continue
      const ids = claimed.map((c) => c.logId)
      const first = claimed[0].row
      if (!first.ownerId) { await settle(ids, 'skipped', 'The pet has no owner on file.'); out.skipped += ids.length; continue }
      if (first.optedOut) { await settle(ids, 'skipped', 'The owner asked not to be texted (STOP).'); out.skipped += ids.length; continue }
      const to = first.mobile || first.phone
      if (!to) { await settle(ids, 'skipped', 'The owner has no phone number.'); out.skipped += ids.length; continue }
      const dueDays = claimed.map((c) => String(c.row.dueDate).slice(0, 10)).sort()
      const message = mergeReminder(cfg.message, {
        owner_name: String(first.ownerName || '').split(' ')[0],
        pet_name: listPhrase(claimed.map((c) => c.row.patientName)),
        vaccine: listPhrase(claimed.map((c) => c.row.vaccine)),
        due_date: listPhrase([...new Set(dueDays)].map(prettyDate)),
        clinic_name: co.name || '',
      })
      let result: any
      try {
        result = await sms.sendSMS(co.id, { contactId: first.ownerId, toPhone: to, message })
      } catch (e: any) {
        await settle(ids, 'failed', String(e?.message || 'The text could not be sent.').slice(0, 500), to); out.failed += ids.length; continue
      }
      if (result?.refused) {
        // Nothing was sent (texting not set up, or the wallet empty): held, and tried again next pass.
        await settle(ids, 'held', String(result.errorMessage || 'Texting is not available.').slice(0, 500), to); out.held += ids.length; continue
      }
      if (!result || result.status === 'failed') {
        await settle(ids, 'failed', String(result?.errorMessage || 'The text was not accepted.').slice(0, 500), to); out.failed += ids.length; continue
      }
      await settle(ids, 'sent', message, to)
      const at = new Date()
      await stampVaccinationsReminded(db, co.id, claimed.map((c) => c.row.vaccinationId), at)
      await db.update(contact).set({ lastRemindedAt: at, updatedAt: at }).where(and(eq(contact.id, first.ownerId), eq(contact.companyId, co.id)))
      out.sent++
    }
  }

  /** One pass over every clinic with automatic reminders on. `now` is the clock (a test pins it). */
  async function runOnce(now: Date = new Date()) {
    const out = { sent: 0, skipped: 0, failed: 0, held: 0 }
    for (const co of await db.select().from(company)) {
      const cfg = vetReminderSettings(co.settings)
      if (!cfg.auto) continue
      if (!(await deps.isFeatureEnabled(co.id, 'reminders_recall'))) continue
      try { await forClinic(co, cfg, now, out) } catch (e: any) { logger.error('[vaccine reminders] pass failed', { company: co.id, error: e?.message }) }
    }
    if (out.sent || out.failed || out.held) logger.info('[vaccine reminders] pass', out as any)
    return out
  }

  /** Hourly, and shortly after boot (services.addJob: boot only, never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[vaccine reminders] pass failed', { error: e?.message }))
    setTimeout(tick, 3 * 60_000)
    setInterval(tick, 60 * 60_000)
  }

  return { runOnce, start }
}

export type VaccineReminders = ReturnType<typeof createVaccineReminders>
