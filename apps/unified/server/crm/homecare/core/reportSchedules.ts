// Scheduled report emails (row 12, care_report_builder): the office asks for a report — the client margin, the margin per visit,
// the turnover, the daily manager report, the caregiver performance report, the workforce report or one of its own saved
// reports — as CSV or PDF, every day, every week on a weekday or every month on a day, at an hour of the AGENCY's clock, over
// the last N days (ending yesterday; the daily manager report is yesterday's), to staff it names.
//
// The mail never carries the report. The file is built, encrypted at rest (AES-256-GCM, core/encryption.ts — the same key that
// seals SSNs) and stored as a report_delivery; the mail carries a link that opens only for a signed-in recipient (or someone
// who may manage reports) and stops working after DELIVERY_DAYS. So a forwarded mail, a shared inbox or a lost phone never
// hands the figures to anyone the agency did not name.
//
// The scan runs with the visit jobs every 5 minutes. A schedule is sent once per due day: the claim is an UPDATE that moves
// last_run_on to today only when it is not already today, so two instances cannot send twice. A scan that was down at the hour
// sends when it is back the same day (and skips a day it missed whole — that day's report is not sent out of the blue).
import { and, desc, eq, inArray, isNull, lte, ne, or } from 'drizzle-orm'
import { company, reportDelivery, reportSchedule, user } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'
import { encrypt, decrypt } from './encryption.ts'
import type { Margin } from './margin.ts'
import type { ReportBuilder } from './reportBuilder.ts'
import { renderClientMargin, renderDailyManager, renderPerformance, renderSavedReport, renderTurnover, renderVisitMargin, renderWorkforce, type Format, type ReportFile } from '../planning/reportRenderers.ts'

export const DELIVERY_DAYS = 14
export const REPORT_KINDS: { kind: string; label: string; needs: 'billing' | 'hr' | 'both' }[] = [
  { kind: 'client_margin', label: 'Client margin', needs: 'both' },
  { kind: 'visit_margin', label: 'Margin per visit', needs: 'both' },
  { kind: 'turnover', label: 'Caregiver turnover and hiring', needs: 'hr' },
  { kind: 'daily_manager', label: 'Daily manager report', needs: 'billing' },
  { kind: 'caregiver_performance', label: 'Caregiver performance', needs: 'hr' },
  { kind: 'workforce', label: 'Workforce (workload, underused staff, cancellations)', needs: 'hr' },
  { kind: 'saved', label: 'One of your saved reports', needs: 'billing' },
]
export const kindLabel = (k: string) => REPORT_KINDS.find((x) => x.kind === k)?.label ?? k
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** How a schedule reads on screen: "Every Monday at 06:00, the last 7 days". */
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
export function cadenceText(s: { cadence: string; dayOfWeek?: number | null; dayOfMonth?: number | null; hour: number; windowDays: number; reportKind: string }): string {
  const at = `${String(s.hour).padStart(2, '0')}:00`
  const when = s.cadence === 'daily' ? `Every day at ${at}` : s.cadence === 'weekly' ? `Every ${DAY_NAMES[s.dayOfWeek ?? 1]} at ${at}` : `On the ${ordinal(s.dayOfMonth ?? 1)} of the month at ${at}`
  return s.reportKind === 'daily_manager' ? `${when}, the day before` : `${when}, the last ${s.windowDays} day${s.windowDays === 1 ? '' : 's'}`
}

/** The first due day on or after `from` (YYYY-MM-DD) for a cadence. Pure. */
export function nextRunOn(s: { cadence: string; dayOfWeek?: number | null; dayOfMonth?: number | null }, from: string): string {
  if (s.cadence === 'daily') return from
  if (s.cadence === 'weekly') {
    const want = s.dayOfWeek ?? 1
    const dow = new Date(`${from}T12:00:00Z`).getUTCDay()
    return addDays(from, (want - dow + 7) % 7)
  }
  const day = Math.min(28, Math.max(1, s.dayOfMonth ?? 1))
  const [y, m] = from.split('-').map(Number)
  const thisMonth = `${from.slice(0, 7)}-${String(day).padStart(2, '0')}`
  if (thisMonth >= from) return thisMonth
  const next = new Date(Date.UTC(y, m, day))
  return next.toISOString().slice(0, 10)
}

export interface ScheduleInput { name: string; reportKind: string; reportId: string | null; format: Format; cadence: 'daily' | 'weekly' | 'monthly'; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; windowDays: number; recipients: string[] }
/** A schedule body checked. A problem names the box. */
export function checkSchedule(raw: any): { input: ScheduleInput } | { problem: string; fields: Record<string, string> } {
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 120) : ''
  if (!name) return { problem: 'Give the schedule a name.', fields: { name: 'Name it' } }
  if (!REPORT_KINDS.some((k) => k.kind === raw.reportKind)) return { problem: 'Pick which report to send.', fields: { reportKind: 'Pick a report' } }
  if (raw.reportKind === 'saved' && !raw.reportId) return { problem: 'Pick which saved report to send.', fields: { reportId: 'Pick a saved report' } }
  const format: Format = raw.format === 'pdf' ? 'pdf' : 'csv'
  if (!['daily', 'weekly', 'monthly'].includes(raw.cadence)) return { problem: 'Pick how often: every day, every week or every month.', fields: { cadence: 'Pick one' } }
  const dayOfWeek = raw.cadence === 'weekly' ? Number(raw.dayOfWeek) : null
  if (raw.cadence === 'weekly' && !(Number.isInteger(dayOfWeek) && dayOfWeek! >= 0 && dayOfWeek! <= 6)) return { problem: 'Pick the weekday.', fields: { dayOfWeek: 'Pick a day' } }
  const dayOfMonth = raw.cadence === 'monthly' ? Number(raw.dayOfMonth) : null
  if (raw.cadence === 'monthly' && !(Number.isInteger(dayOfMonth) && dayOfMonth! >= 1 && dayOfMonth! <= 28)) return { problem: 'Pick a day of the month from 1 to 28.', fields: { dayOfMonth: '1 to 28' } }
  const hour = Number(raw.hour ?? 6)
  if (!(Number.isInteger(hour) && hour >= 0 && hour <= 23)) return { problem: 'Pick the hour (0 to 23) on the agency\'s clock.', fields: { hour: '0 to 23' } }
  const windowDays = Number(raw.windowDays ?? (raw.cadence === 'daily' ? 1 : raw.cadence === 'weekly' ? 7 : 30))
  if (!(Number.isInteger(windowDays) && windowDays >= 1 && windowDays <= 400)) return { problem: 'The report can cover 1 to 400 days.', fields: { windowDays: '1 to 400' } }
  const recipients = Array.isArray(raw.recipients) ? [...new Set(raw.recipients.map(String).filter(Boolean))] as string[] : []
  if (!recipients.length) return { problem: 'Pick at least one person to send it to.', fields: { recipients: 'Pick someone' } }
  return { input: { name, reportKind: String(raw.reportKind), reportId: raw.reportKind === 'saved' ? String(raw.reportId) : null, format, cadence: raw.cadence, dayOfWeek, dayOfMonth, hour, windowDays, recipients } }
}

export function createReportSchedules(d: CrmDeps, deps: { time: AgencyTime; margin: Margin; reportBuilder: ReportBuilder }) {
  const mine = (companyId: string, id: string) => and(eq(reportSchedule.companyId, companyId), eq(reportSchedule.id, id))
  const agencyName = async (companyId: string) => (await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1))[0]?.name || 'Home Care Agency'
  /** The agency's staff among these ids (a recipient must be the agency's own, active, and able to sign in). */
  async function staff(companyId: string, ids: string[]) {
    if (!ids.length) return []
    return d.db.select({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }).from(user)
      .where(and(eq(user.companyId, companyId), inArray(user.id, ids), eq(user.isActive, true)))
  }

  const list = async (companyId: string) => (await d.db.select().from(reportSchedule).where(eq(reportSchedule.companyId, companyId)).orderBy(reportSchedule.name)).map(present)
  const present = (s: any) => ({ ...s, kindLabel: kindLabel(s.reportKind), cadenceLabel: cadenceText(s) })
  async function save(companyId: string, by: string, input: ScheduleInput, id?: string): Promise<{ schedule: any } | { problem: string; fields: Record<string, string> }> {
    const people = await staff(companyId, input.recipients)
    if (people.length !== input.recipients.length) return { problem: 'Every recipient must be one of your own active staff.', fields: { recipients: 'Not your staff' } as Record<string, string> }
    if (input.reportKind === 'saved' && !(await deps.reportBuilder.get(companyId, input.reportId!))) return { problem: 'That saved report does not exist.', fields: { reportId: 'Pick another' } as Record<string, string> }
    const today = await deps.time.today(companyId)
    const values = { name: input.name, reportKind: input.reportKind, reportId: input.reportId, format: input.format, cadence: input.cadence, dayOfWeek: input.dayOfWeek, dayOfMonth: input.dayOfMonth, hour: input.hour, windowDays: input.windowDays, recipients: input.recipients, nextRunOn: nextRunOn(input, today) }
    if (id) {
      const [row] = await d.db.update(reportSchedule).set({ ...values, updatedAt: new Date() }).where(mine(companyId, id)).returning()
      return row ? { schedule: present(row) } : { problem: 'That schedule does not exist.', fields: {} as Record<string, string> }
    }
    const [row] = await d.db.insert(reportSchedule).values({ companyId, createdById: by, ...values }).returning()
    return { schedule: present(row) }
  }
  async function setActive(companyId: string, id: string, isActive: boolean) {
    const today = await deps.time.today(companyId)
    const [was] = await d.db.select({ nextRunOn: reportSchedule.nextRunOn }).from(reportSchedule).where(mine(companyId, id)).limit(1)
    if (!was) return null
    // Resumed: never due in the past (a paused week is not sent out of the blue).
    const nextRunOn = isActive ? (was.nextRunOn && String(was.nextRunOn) > today ? String(was.nextRunOn) : today) : undefined
    const [row] = await d.db.update(reportSchedule).set({ isActive, updatedAt: new Date(), ...(nextRunOn ? { nextRunOn } : {}) }).where(mine(companyId, id)).returning()
    return row ? present(row) : null
  }
  const remove = (companyId: string, id: string) => d.db.delete(reportSchedule).where(mine(companyId, id))

  /** The report a schedule names, over its window, rendered. `end` is the last day covered. */
  async function build(companyId: string, s: any, end: string): Promise<{ file: ReportFile; start: string; end: string } | { problem: string }> {
    const start = s.reportKind === 'daily_manager' ? end : addDays(end, -(Number(s.windowDays) - 1))
    const agency = await agencyName(companyId)
    const format: Format = s.format === 'pdf' ? 'pdf' : 'csv'
    switch (s.reportKind) {
      case 'client_margin': return { file: await renderClientMargin(await deps.margin.clientMargin(companyId, start, end), agency, format), start, end }
      case 'visit_margin': return { file: await renderVisitMargin(await deps.margin.visitMargin(companyId, start, end), agency, format), start, end }
      case 'turnover': return { file: await renderTurnover(await deps.margin.turnover(companyId, start, end, await deps.time.today(companyId)), agency, format), start, end }
      case 'daily_manager': return { file: await renderDailyManager(await deps.reportBuilder.dailyManager(companyId, end, { money: true }), agency, format), start, end }
      case 'caregiver_performance': return { file: await renderPerformance(await deps.reportBuilder.performance(companyId, start, end), agency, format), start, end }
      case 'workforce': return { file: await renderWorkforce(await deps.reportBuilder.workforce(companyId, start, end), agency, format), start, end }
      case 'saved': {
        const def = await deps.reportBuilder.get(companyId, String(s.reportId))
        if (!def) return { problem: 'The saved report no longer exists.' }
        return { file: await renderSavedReport(await deps.reportBuilder.run(companyId, deps.reportBuilder.asDefinition(def), start, end, true), def.name, agency, format), start, end }
      }
      default: return { problem: `Unknown report kind ${s.reportKind}` }
    }
  }

  /** Store a built file encrypted and mail the recipients a link. Returns the delivery row (without the ciphertext). */
  async function deliver(companyId: string, s: any, built: { file: ReportFile; start: string; end: string }) {
    const ciphertext = encrypt(built.file.body.toString('base64'))!
    const people = await staff(companyId, (s.recipients as string[]) ?? [])
    const [row] = await d.db.insert(reportDelivery).values({
      companyId, scheduleId: s.id ?? null, name: s.name, fileName: built.file.fileName, contentType: built.file.contentType, ciphertext, byteSize: built.file.body.length,
      periodStart: built.start, periodEnd: built.end, recipients: people.map((p: any) => p.id), sentTo: [], expiresAt: new Date(Date.now() + DELIVERY_DAYS * 86_400_000),
    }).returning({ id: reportDelivery.id })
    const agency = await agencyName(companyId)
    const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    const link = `${base}/crm/report-builder/deliveries/${row.id}`
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const sentTo: string[] = []
    for (const p of people) {
      if (!p.email) continue
      try {
        await d.services.emailService.sendRaw({
          to: p.email, subject: `${s.name} — ${agency}`,
          html: `<p>Hi ${esc(p.firstName)},</p><p>Your scheduled report <b>${esc(s.name)}</b> (${esc(kindLabel(s.reportKind))}, ${esc(built.start)} to ${esc(built.end)}) is ready.</p>`
            + `<p><a href="${esc(link)}">Open the report</a> — you will be asked to sign in. The report is kept encrypted on our servers and is not attached to this mail; the link works for ${DELIVERY_DAYS} days and only for the people this schedule names.</p>`
            + `<p style="color:#6b7280">${esc(agency)}</p>`,
        })
        sentTo.push(p.email)
      } catch (e: any) { d.logger.error('[report-schedules] email', { error: e?.message, to: p.email }) }
    }
    await d.db.update(reportDelivery).set({ sentTo }).where(eq(reportDelivery.id, row.id))
    return { id: row.id, sentTo, link }
  }

  /** Send one schedule now (the office's "Send now"), as of yesterday on the agency's clock. */
  async function sendNow(companyId: string, id: string) {
    const [s] = await d.db.select().from(reportSchedule).where(mine(companyId, id)).limit(1)
    if (!s) return { problem: 'That schedule does not exist.' }
    const today = await deps.time.today(companyId)
    const built = await build(companyId, s, addDays(today, -1))
    if ('problem' in built) return built
    const delivery = await deliver(companyId, s, built)
    await d.db.update(reportSchedule).set({ lastRunOn: today, nextRunOn: nextRunOn(s, addDays(today, 1)), updatedAt: new Date() }).where(mine(companyId, id))
    return { delivery }
  }

  /** One company's due schedules. Returns how many were sent. */
  async function scanCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await deps.reportBuilder.enabled(companyId))) return 0
    const { date, time } = await deps.time.now(companyId, at)
    const hour = Number(String(time).slice(0, 2))
    const due = await d.db.select().from(reportSchedule).where(and(eq(reportSchedule.companyId, companyId), eq(reportSchedule.isActive, true), lte(reportSchedule.nextRunOn, date)))
    let sent = 0
    for (const s of due) {
      try {
        if (Number(s.hour) > hour) continue
        // A missed whole day is not sent out of the blue: a due day before today moves on to the next one.
        if (s.nextRunOn && String(s.nextRunOn) < date) { await d.db.update(reportSchedule).set({ nextRunOn: nextRunOn(s, date) }).where(eq(reportSchedule.id, s.id)); if (nextRunOn(s, date) !== date) continue }
        // Claim: only the scan that moves last_run_on to today sends.
        const claimed = await d.db.update(reportSchedule).set({ lastRunOn: date, nextRunOn: nextRunOn(s, addDays(date, 1)), updatedAt: new Date() })
          .where(and(eq(reportSchedule.id, s.id), or(isNull(reportSchedule.lastRunOn), ne(reportSchedule.lastRunOn, date)))).returning({ id: reportSchedule.id })
        if (!claimed.length) continue
        const built = await build(companyId, s, addDays(date, -1))
        if ('problem' in built) { d.logger.error('[report-schedules] build', { scheduleId: s.id, problem: built.problem }); continue }
        await deliver(companyId, s, built)
        sent++
      } catch (e: any) { d.logger.error('[report-schedules] one schedule', { scheduleId: s.id, error: e?.message }) }
    }
    return sent
  }
  async function scanReportSchedules(at: Date = new Date()): Promise<number> {
    const rows = await d.db.selectDistinct({ companyId: reportSchedule.companyId }).from(reportSchedule).where(eq(reportSchedule.isActive, true))
    let sent = 0
    for (const r of rows) { try { sent += await scanCompany(String(r.companyId), at) } catch (e: any) { d.logger.error('[report-schedules] one company', { companyId: r.companyId, error: e?.message }) } }
    return sent
  }

  // ── deliveries ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const deliveries = async (companyId: string) => d.db.select({
    id: reportDelivery.id, scheduleId: reportDelivery.scheduleId, name: reportDelivery.name, fileName: reportDelivery.fileName, contentType: reportDelivery.contentType, byteSize: reportDelivery.byteSize,
    periodStart: reportDelivery.periodStart, periodEnd: reportDelivery.periodEnd, recipients: reportDelivery.recipients, sentTo: reportDelivery.sentTo, expiresAt: reportDelivery.expiresAt, downloads: reportDelivery.downloads, createdAt: reportDelivery.createdAt,
  }).from(reportDelivery).where(eq(reportDelivery.companyId, companyId)).orderBy(desc(reportDelivery.createdAt)).limit(200)
  /** Open a delivery: the file, decrypted, for a named recipient (or a manager) while the link is live. */
  async function open(companyId: string, id: string, who: { userId: string; manager: boolean }): Promise<{ file: ReportFile; name: string } | { problem: string; status: 403 | 404 | 410 }> {
    const [row] = await d.db.select().from(reportDelivery).where(and(eq(reportDelivery.companyId, companyId), eq(reportDelivery.id, id))).limit(1)
    if (!row) return { problem: 'That report link does not exist.', status: 404 }
    if (!who.manager && !((row.recipients as string[]) ?? []).includes(who.userId)) return { problem: 'This report was not sent to you.', status: 403 }
    if (new Date(row.expiresAt).getTime() < Date.now()) return { problem: `This report link has expired (links work for ${DELIVERY_DAYS} days). Ask for it to be sent again.`, status: 410 }
    const plain = decrypt(row.ciphertext)
    if (!plain) return { problem: 'The report could not be opened.', status: 410 }
    await d.db.update(reportDelivery).set({ downloads: Number(row.downloads) + 1 }).where(eq(reportDelivery.id, row.id))
    return { file: { body: Buffer.from(plain, 'base64'), contentType: row.contentType, fileName: row.fileName }, name: row.name }
  }

  return { list, save, setActive, remove, build, deliver, sendNow, scanCompany, scanReportSchedules, deliveries, open }
}
export type ReportSchedules = ReturnType<typeof createReportSchedules>
