// The caregiver who has not arrived (row 7, care_no_arrival — hidden until the owner has tried it): the No-Show Alerts screen's
// check. Its "Run check" button was a stub (0 checked, 0 alerts) and nothing ever raised an alert; AxisCare and AlayaCare tell the
// office (and, by its rules, the family) when a visit's caregiver has not clocked in.
//
// Every five minutes (and on "Run check"), for an agency with the feature and its No-Show settings switched on:
//   · today's scheduled visits on the agency's own clock whose start plus the grace minutes (the settings' graceMinutes, 15 until set)
//     has passed — and by no more than three hours, so switching it on never floods the office with the morning's visits;
//   · with no clock-in by that caregiver at that client that day;
//   · get ONE No-Show alert (a unique row per visit: two scans, or two servers, never alert twice), and the people the settings name
//     are told: the office (an in-app notice, plus a text to the settings' office phone and an email to its office email), the
//     caregiver (push and text, their own notification settings apply), and — when "tell the client's family" is on — the client's
//     relatives who agreed to visit texts (not in the agency's quiet hours) or visit emails.
import { and, eq } from 'drizzle-orm'
import { company, familyMembers, noshowAlertConfig, noshowAlerts } from '../../../db/schema/index.ts'
import { clockInsSince, visitsOnDay } from '../../../data/homecareScheduling.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import { ymdIn } from './agencyTime.ts'
import { inQuietHours } from './notificationPrefs.ts'
import type { VisitNotify } from './visitNotify.ts'

export const NO_ARRIVAL_FEATURE = 'care_no_arrival'
export const DEFAULT_GRACE_MINUTES = 15
/** A visit that started more than this long ago is not announced out of the blue. */
export const LOOKBACK_MINUTES = 180

const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }
const twelve = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

/** Which of today's visits are missed at `nowMin` (minutes into the agency's day). Pure. */
export function missedVisits<V extends { caregiverId: string; clientId: string; start: string }>(visits: V[], arrived: (v: V) => boolean, nowMin: number, graceMinutes: number): V[] {
  return visits.filter((v) => {
    const s = toMin(v.start)
    return nowMin >= s + graceMinutes && nowMin <= s + LOOKBACK_MINUTES && !arrived(v)
  })
}

export function createNoArrival(d: CrmDeps, deps: { time: AgencyTime; notify: VisitNotify; quietHours: (companyId: string) => Promise<{ quietHoursStart: string; quietHoursEnd: string }> }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, NO_ARRIVAL_FEATURE)

  async function settings(companyId: string) {
    const [row] = await d.db.select().from(noshowAlertConfig).where(eq(noshowAlertConfig.companyId, companyId)).limit(1)
    return {
      graceMinutes: Number.isInteger(row?.graceMinutes) && row!.graceMinutes >= 0 ? row!.graceMinutes : DEFAULT_GRACE_MINUTES,
      notifyAdmin: row?.notifyAdmin ?? true, notifyCaregiver: row?.notifyCaregiver ?? true, notifyClientFamily: row?.notifyClientFamily ?? false,
      adminPhone: row?.adminPhone ?? null, adminEmail: row?.adminEmail ?? null, isActive: row?.isActive ?? true,
    }
  }

  /** One agency's check. Returns how many visits were found missed (and alerted) now, and how many were looked at. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<{ checked: number; alertsCreated: number }> {
    if (!(await enabled(companyId))) return { checked: 0, alertsCreated: 0 }
    const cfg = await settings(companyId)
    if (!cfg.isActive) return { checked: 0, alertsCreated: 0 }
    const { date, time, tz } = await deps.time.now(companyId, at)
    const nowMin = toMin(time.slice(0, 5))
    const visits = await visitsOnDay(d.db, companyId, date)
    const punches = await clockInsSince(d.db, companyId, new Date(at.getTime() - 36 * 3600_000))
    const arrived = (v: { caregiverId: string; clientId: string }) =>
      punches.some((p) => p.caregiverId === v.caregiverId && p.clientId === v.clientId && ymdIn(new Date(p.startTime), tz) === date)
    let created = 0
    for (const v of missedVisits(visits, arrived, nowMin, cfg.graceMinutes)) {
      try {
        const [row] = await d.db.insert(noshowAlerts).values({
          companyId, scheduleId: v.scheduleId, caregiverId: v.caregiverId, clientId: v.clientId, shiftDate: date, expectedStart: `${v.start}:00`, status: 'open',
        } as any).onConflictDoNothing().returning({ id: noshowAlerts.id })
        if (!row) continue                                    // already alerted
        created++
        const cg = `${v.caregiverFirst} ${v.caregiverLast}`.trim(), cl = `${v.clientFirst} ${v.clientLast}`.trim()
        const line = `${cg} has not clocked in at ${cl}'s visit (due ${twelve(v.start)}).`
        let sms = false
        if (cfg.notifyAdmin) {
          await deps.notify.notifyAdmins(companyId, 'noshow_alert', 'A caregiver has not arrived', line)
          if (cfg.adminPhone) sms = (await deps.notify.sendText({ companyId, phone: cfg.adminPhone, body: line })) || sms
          if (cfg.adminEmail) await mail(cfg.adminEmail, 'A caregiver has not arrived', line)
        }
        if (cfg.notifyCaregiver) {
          const mine = `You have not clocked in at ${cl}'s visit (due ${twelve(v.start)}). Clock in now, or call the office.`
          await deps.notify.notifyUser(companyId, v.caregiverId, 'noshow_alert', 'You have not clocked in', mine)
          await deps.notify.sendCaregiverAlert({ companyId, userId: v.caregiverId, alertType: 'agency_rule', channel: 'push', body: mine, payload: { title: 'You have not clocked in', body: mine, tag: `noshow-${row.id}` }, urgent: true })
          sms = (await deps.notify.sendCaregiverAlert({ companyId, userId: v.caregiverId, alertType: 'agency_rule', channel: 'sms', phone: v.caregiverPhone, body: mine, urgent: true })) || sms
        }
        if (cfg.notifyClientFamily) sms = (await tellFamily(companyId, v.clientId, `${cg} has not arrived yet for ${v.clientFirst}'s visit (due ${twelve(v.start)}). The office has been told.`, at)) || sms
        if (sms) await d.db.update(noshowAlerts).set({ smsSent: true } as any).where(eq(noshowAlerts.id, row.id))
      } catch (e: any) { d.logger.error('[no-arrival] one visit', { error: e?.message }) }
    }
    return { checked: visits.length, alertsCreated: created }
  }

  async function mail(to: string, subject: string, line: string) {
    try { await d.services.emailService.sendRaw({ to, subject, html: `<p>${line.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>` }) }
    catch (e: any) { d.logger.error('[no-arrival] email', { error: e?.message }) }
  }

  /** The client's relatives who agreed: a text outside quiet hours, an email any time. True when a text went. */
  async function tellFamily(companyId: string, clientId: string, line: string, at: Date): Promise<boolean> {
    const people = await d.db.select({ phone: familyMembers.phone, email: familyMembers.email, text: familyMembers.visitTextOptIn, mailOk: familyMembers.visitEmailOptIn })
      .from(familyMembers).where(and(eq(familyMembers.companyId, companyId), eq(familyMembers.clientId, clientId), eq(familyMembers.isActive, true)))
    const quiet = inQuietHours(await deps.quietHours(companyId), at, await deps.time.timezone(companyId))
    let texted = false
    for (const p of people) {
      if (p.text && p.phone && !quiet) texted = (await deps.notify.sendText({ companyId, phone: p.phone, body: `${line} Reply STOP to stop these texts.` })) || texted
      if (p.mailOk && p.email) await mail(p.email, 'Your caregiver has not arrived yet', line)
    }
    return texted
  }

  /** Every agency with the feature (the visit jobs' tick). Returns how many alerts were raised. */
  async function scanAll(at: Date = new Date()): Promise<number> {
    let n = 0
    for (const { id } of await d.db.select({ id: company.id }).from(company)) {
      try { n += (await scanCompany(id, at)).alertsCreated } catch (e: any) { d.logger.error('[no-arrival] company', { error: e?.message }) }
    }
    return n
  }

  return { enabled, settings, scanCompany, scanAll }
}
export type NoArrival = ReturnType<typeof createNoArrival>
