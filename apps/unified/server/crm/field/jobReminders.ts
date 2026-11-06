// Automatic reminders for the jobs the office books — a text and an email before the visit. Online-booked jobs already get
// theirs from the booking engine (booking/extras.ts); a job made on the Schedule or from a quote got nothing. Modelled on
// the vet clinic's vaccine reminders (crm/vet/vaccineReminders.ts): a timed pass, on the business's own clock, through the
// business's own texting and email.
//
// Finished (item 5 of the parity brief): a fixed-time mode ("at 9:00 the day before"), a per-customer off switch
// (contact.job_reminders_off), a manual Text / Email reminder from the job, a "visit moved" notice, a confirm link and
// Y / C text reply (./jobConfirm.ts), editable email wording, and the Client Communications report (./jobReminderRoutes.ts).
//
// The rules (company.settings.jobReminders — off until the business switches it on):
//   · a pass every 10 minutes, and nothing goes out outside the business's sending hours (default 8am–8pm on its clock);
//   · a reminder is "N hours before the visit", one or two of them; a visit's start is its date and time on the business's
//     clock (a job with no time counts as starting when the sending hours open that day);
//   · only jobs the office booked (no booking behind them, and not `online_booking`) that are scheduled or dispatched;
//   · each reminder is claimed in reminder_log BEFORE it goes, per job, step and channel — its unique index is the "once".
//     The step names the visit's exact start, so a moved visit earns reminders of its own and the old ones can never fire;
//   · several steps already due (a visit booked inside the window): only the latest one reached is sent, the earlier ones
//     are logged as superseded;
//   · a customer who texted STOP (contact.optedOutSms) is never texted, one who unsubscribed (contact.emailOptOut) is never
//     emailed; no number or no email → skipped, and the log says why;
//   · texting not set up, or the usage wallet empty: nothing was sent, so the claim is HELD and tried again next pass; a
//     carrier's refusal of the number is recorded once and not retried.
import crypto from 'node:crypto'
import { and, eq, inArray, isNull, isNotNull, ne, or, gte, lt } from 'drizzle-orm'
import { companyRowTimeZone, storeDateString, markerDay, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { company, contact, job, user, reminderLog } from '../../db/schema/index.ts'
import type { Logger } from '../../core/logger.ts'

export const JOB_REMINDER_KIND = { sms: 'job_reminder_sms', email: 'job_reminder_email' } as const
export const DEFAULT_JOB_MESSAGE = '{{company_name}}: reminder for {{customer_name}} — {{job}} on {{when}}. Reply to this text if you need to change it.'
export const MAX_JOB_MESSAGE = 320
export const DEFAULT_EMAIL_SUBJECT = 'Reminder: {{job}} on {{when}}'
export const DEFAULT_EMAIL_BODY = 'This is a reminder of your visit with {{company_name}}.\n\nWhat: {{job}}\nWhen: {{when}}\nWhere: {{address}}\nWho: {{tech_name}}\n\nIf you need to change the time, reply to this email or call us.'
export const MAX_EMAIL_BODY = 2000
export const DEFAULT_MOVED_MESSAGE = '{{company_name}}: your {{job}} visit has moved to {{when}}. Reply to this text if that does not work for you.'
/** What a reminder asks of the customer, added to the text when "ask for confirmation" is on. */
export const CONFIRM_ASK = 'Reply Y to confirm.'
/** The kinds written to reminder_log, and what each is called on screen. */
export const JOB_NOTICE_KIND = { sms: 'job_reminder_sms', email: 'job_reminder_email', movedSms: 'job_moved_sms', movedEmail: 'job_moved_email' } as const
export const JOB_NOTICE_LABEL: Record<string, string> = { job_reminder_sms: 'Reminder', job_reminder_email: 'Reminder', job_moved_sms: 'Visit moved', job_moved_email: 'Visit moved' }
export type ReminderTiming = 'hours_before' | 'fixed_time'
export interface FixedStep { daysBefore: number; time: string }

export interface JobReminderSettings {
  enabled: boolean
  /** Hours before the visit, one or two, largest first. */
  hoursBefore: number[]
  sms: boolean
  email: boolean
  /** The sending hours on the business's clock: from this hour (0–23) until this one (1–24). */
  sendFromHour: number
  sendUntilHour: number
  message: string
  /** "N hours before the visit" (hoursBefore) or "at HH:MM, N days before" (fixed). */
  timing: ReminderTiming
  /** The fixed-time steps, one or two: the day before at 9:00, say. */
  fixed: FixedStep[]
  /** The email's own wording, with the same {{fields}} as the text. */
  emailSubject: string
  emailBody: string
  /** Ask the customer to confirm: "Reply Y to confirm" on the text, a Confirm button on the email. */
  askConfirm: boolean
  /** The text and email sent when a visit is moved and the office chooses to tell the customer. */
  movedMessage: string
}

export const DEFAULT_JOB_REMINDERS: JobReminderSettings = {
  enabled: false, hoursBefore: [24], sms: true, email: true, sendFromHour: 8, sendUntilHour: 20, message: DEFAULT_JOB_MESSAGE,
  timing: 'hours_before', fixed: [{ daysBefore: 1, time: '09:00' }],
  emailSubject: DEFAULT_EMAIL_SUBJECT, emailBody: DEFAULT_EMAIL_BODY, askConfirm: true, movedMessage: DEFAULT_MOVED_MESSAGE,
}

const HM = /^\d{1,2}:\d{2}$/
const validHM = (v: string) => { const [h, m] = v.split(':').map(Number); return h >= 0 && h <= 23 && m >= 0 && m <= 59 }
const padHM = (v: string) => { const [h, m] = v.split(':'); return `${h.padStart(2, '0')}:${m}` }
const int = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback }

/** The business's reminder settings, every gap filled with what the engine really uses. */
export function jobReminderSettings(settings: unknown): JobReminderSettings {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const r = s?.jobReminders || {}
  const steps = Array.isArray(r.hoursBefore) ? r.hoursBefore : DEFAULT_JOB_REMINDERS.hoursBefore
  const hoursBefore = [...new Set(steps.map((h: unknown) => int(h, 1, 168, 0)).filter((h: number) => h > 0))].sort((a, b) => (b as number) - (a as number)).slice(0, 2) as number[]
  let from = int(r.sendFromHour, 0, 23, DEFAULT_JOB_REMINDERS.sendFromHour)
  let until = int(r.sendUntilHour, 1, 24, DEFAULT_JOB_REMINDERS.sendUntilHour)
  // A window that ends before it starts is no window: the default hours, rather than a guess at what was meant.
  if (until <= from) { from = DEFAULT_JOB_REMINDERS.sendFromHour; until = DEFAULT_JOB_REMINDERS.sendUntilHour }
  const message = typeof r.message === 'string' && r.message.trim() ? r.message.trim().slice(0, MAX_JOB_MESSAGE) : DEFAULT_JOB_MESSAGE
  const fixedIn: FixedStep[] = (Array.isArray(r.fixed) ? r.fixed : DEFAULT_JOB_REMINDERS.fixed)
    .map((f: any) => ({ daysBefore: int(f?.daysBefore, 0, 14, -1), time: HM.test(String(f?.time ?? '').trim()) && validHM(String(f.time).trim()) ? padHM(String(f.time).trim()) : '' }))
    .filter((f: FixedStep) => f.daysBefore >= 0 && f.time)
  // Latest first, like the hours: the day before at 9:00 and the morning of at 7:00 are two different steps.
  const fixed = [...new Map(fixedIn.map((f) => [`${f.daysBefore}@${f.time}`, f])).values()].sort((a, b) => b.daysBefore - a.daysBefore || a.time.localeCompare(b.time)).slice(0, 2)
  const text = (v: unknown, fallback: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback)
  return {
    enabled: r.enabled === true,
    hoursBefore: hoursBefore.length ? hoursBefore : DEFAULT_JOB_REMINDERS.hoursBefore,
    sms: r.sms !== false,
    email: r.email !== false,
    sendFromHour: from,
    sendUntilHour: until,
    message,
    timing: r.timing === 'fixed_time' ? 'fixed_time' : 'hours_before',
    fixed: fixed.length ? fixed : DEFAULT_JOB_REMINDERS.fixed,
    emailSubject: text(r.emailSubject, DEFAULT_EMAIL_SUBJECT, 200),
    emailBody: text(r.emailBody, DEFAULT_EMAIL_BODY, MAX_EMAIL_BODY),
    askConfirm: r.askConfirm !== false,
    movedMessage: text(r.movedMessage, DEFAULT_MOVED_MESSAGE, MAX_JOB_MESSAGE),
  }
}

const FALLBACKS: Record<string, string> = { confirm_link: '', customer_name: 'there', company_name: 'your service team', job: 'your visit', when: 'the scheduled time', date: 'the scheduled day', time: 'the scheduled time', address: 'your address', tech_name: 'our team' }
/** Fill `{{name}}` fields; a field with nothing behind it falls back to words that still read as a sentence. */
export function mergeFields(template: string, values: Record<string, string | undefined>): string {
  return String(template ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase()
    const v = (values[k] || '').trim()
    if (v) return v
    return k in FALLBACKS ? FALLBACKS[k] : whole
  })
}

const hourIn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const dateWords = (at: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(at)
export const timeWords = (at: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at)

/** A job's start on the business's clock: its date and time, or — with no time — when the sending hours open that day. */
export function visitStart(scheduledDate: Date | string | null, scheduledTime: string | null, tz: string, sendFromHour: number): { start: Date; allDay: boolean } | null {
  if (!scheduledDate) return null
  const day = markerDay(scheduledDate instanceof Date ? scheduledDate : new Date(scheduledDate))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const hm = HM.test(String(scheduledTime || '').trim()) ? String(scheduledTime).trim() : null
  const start = zonedWallTimeToUtc(day, hm ?? `${String(sendFromHour).padStart(2, '0')}:00`, tz)
  return Number.isNaN(start.getTime()) ? null : { start, allDay: !hm }
}

export interface JobReminderDeps {
  db: any
  sms: { sendSMS: (companyId: string, msg: any) => Promise<any> }
  email: { send: (to: string, template: string, data: Record<string, unknown>) => Promise<unknown> }
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
}

export interface PassResult { sent: number; skipped: number; failed: number; held: number }
export type Channel = 'sms' | 'email'
export interface Outcome { channel: Channel; status: 'sent' | 'skipped' | 'failed' | 'held'; detail: string | null; to: string | null }
type Mode = 'reminder' | 'moved' | 'manual'

/** The app's address, for a link in a text. Without one the text carries "Reply Y" and no link. */
const appBase = () => String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
// Not /visit/<token>: a bar website has its own /visit page (Find us), and an admin page at /visit/* took it over (bar-site test, 10/31).
export const confirmPathFor = (token: string) => `/confirm-visit/${token}`
const newConfirmToken = () => crypto.randomBytes(32).toString('hex')

/** The steps a job has under these settings, soonest first: when each is due and the key that makes it once-only. */
export function stepsFor(cfg: JobReminderSettings, start: Date, visitDay: string, tz: string): Array<{ key: string; dueAt: Date }> {
  const at = start.toISOString()
  const steps = cfg.timing === 'fixed_time'
    ? cfg.fixed.map((f) => ({ key: `d${f.daysBefore}@${f.time}:${at}`, dueAt: zonedWallTimeToUtc(addDays(visitDay, -f.daysBefore), f.time, tz) }))
    : cfg.hoursBefore.map((h) => ({ key: `${h}h:${at}`, dueAt: new Date(start.getTime() - h * 3_600_000) }))
  return steps.filter((x) => !Number.isNaN(x.dueAt.getTime())).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

export function createJobReminders(deps: JobReminderDeps) {
  const { db, sms, email, logger } = deps

  /** Claim a step for one channel: a new row, or one HELD by an earlier pass that could not text. */
  async function claim(companyId: string, kind: string, jobId: string, step: string): Promise<string | null> {
    const fresh = await db.insert(reminderLog).values({ companyId, kind, subjectId: jobId, step, status: 'sending' })
      .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
    if (fresh[0]) return fresh[0].id
    const held = await db.update(reminderLog).set({ status: 'sending', updatedAt: new Date() })
      .where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, kind), eq(reminderLog.subjectId, jobId), eq(reminderLog.step, step), eq(reminderLog.status, 'held')))
      .returning({ id: reminderLog.id })
    return held[0]?.id ?? null
  }
  const settle = (id: string, status: string, detail: string | null, sentTo: string | null = null) =>
    db.update(reminderLog).set({ status, detail, sentTo, updatedAt: new Date() }).where(eq(reminderLog.id, id))

  const JOB_COLUMNS = {
    id: job.id, title: job.title, status: job.status, scheduledDate: job.scheduledDate, scheduledTime: job.scheduledTime,
    address: job.address, city: job.city, contactId: job.contactId, techName: user.firstName, confirmedAt: job.confirmedAt, confirmToken: job.confirmToken,
    customerName: contact.name, phone: contact.phone, mobile: contact.mobile, emailAddress: contact.email,
    optedOutSms: contact.optedOutSms, emailOptOut: contact.emailOptOut, remindersOff: contact.jobRemindersOff,
  }
  const jobQuery = () => db.select(JOB_COLUMNS).from(job).leftJoin(contact, eq(contact.id, job.contactId)).leftJoin(user, eq(user.id, job.assignedToId))

  /** The private link that confirms this one visit, minted the first time one goes out. */
  async function confirmTokenFor(j: { id: string; confirmToken?: string | null }): Promise<string> {
    if (j.confirmToken) return j.confirmToken
    await db.update(job).set({ confirmToken: newConfirmToken() }).where(and(eq(job.id, j.id), isNull(job.confirmToken)))
    const [row] = await db.select({ t: job.confirmToken }).from(job).where(eq(job.id, j.id)).limit(1)
    return row.t as string
  }

  /** Everything a message about this visit can say. */
  function fieldsOf(co: any, j: any, v: { start: Date; allDay: boolean }, tz: string, confirmUrl: string) {
    return {
      customer_name: String(j.customerName || '').split(' ')[0], company_name: co.name || '', job: j.title || '',
      date: dateWords(v.start, tz), time: v.allDay ? '' : timeWords(v.start, tz),
      when: v.allDay ? dateWords(v.start, tz) : `${dateWords(v.start, tz)} at ${timeWords(v.start, tz)}`,
      address: [j.address, j.city].filter(Boolean).join(', '), tech_name: j.techName || '', confirm_link: confirmUrl,
    }
  }

  /**
   * Say it to one customer on one channel, under the claim `logId`. The rules every sender keeps: a customer who texted
   * STOP is never texted, one who unsubscribed is never emailed, no number / address is skipped and says why, and a text the
   * carrier or the wallet refused is HELD. The per-customer reminders-off switch stops only the AUTOMATIC ones (`mode`).
   */
  async function deliver(co: any, cfg: JobReminderSettings, ch: Channel, j: any, v: { start: Date; allDay: boolean }, tz: string, logId: string, mode: Mode, out?: PassResult): Promise<Outcome> {
    const done = async (status: Outcome['status'], detail: string | null, to: string | null = null): Promise<Outcome> => {
      await settle(logId, status, detail, to)
      if (out) { if (status === 'sent') out.sent++; else if (status === 'skipped') out.skipped++; else if (status === 'failed') out.failed++; else out.held++ }
      return { channel: ch, status, detail, to }
    }
    if (!j.contactId) return done('skipped', 'The job has no customer.')
    if (mode === 'reminder' && j.remindersOff) return done('skipped', 'Automatic reminders are turned off for this customer.')
    const token = cfg.askConfirm && !j.confirmedAt ? await confirmTokenFor(j) : null
    const confirmUrl = token && appBase() ? `${appBase()}${confirmPathFor(token)}` : ''
    const fields = fieldsOf(co, j, v, tz, confirmUrl)
    if (ch === 'sms') {
      if (j.optedOutSms) return done('skipped', 'The customer asked not to be texted (STOP).')
      const to = j.mobile || j.phone
      if (!to) return done('skipped', 'The customer has no phone number.')
      let text = mergeFields(mode === 'moved' ? cfg.movedMessage : cfg.message, fields)
      if (token && !(mode === 'moved' ? cfg.movedMessage : cfg.message).includes('{{confirm_link}}')) text = `${text} ${CONFIRM_ASK}${confirmUrl ? ` Or tap ${confirmUrl}` : ''}`
      let result: any
      try { result = await sms.sendSMS(co.id, { contactId: j.contactId, toPhone: to, message: text }) }
      catch (e: any) { return done('failed', String(e?.message || 'The text could not be sent.').slice(0, 500), to) }
      // Nothing was sent (texting not set up, or the wallet empty): held, and tried again next pass.
      if (result?.refused) return done('held', String(result.errorMessage || 'Texting is not available.').slice(0, 500), to)
      if (!result || result.status === 'failed') return done('failed', String(result?.errorMessage || 'The text was not accepted.').slice(0, 500), to)
      return done('sent', text, to)
    }
    if (j.emailOptOut) return done('skipped', 'The customer unsubscribed from emails.')
    const to = String(j.emailAddress || '').trim()
    if (!to) return done('skipped', 'The customer has no email address.')
    const subject = mergeFields(mode === 'moved' ? `Your visit has moved: {{job}} — {{when}}` : cfg.emailSubject, fields).replace(/\s+/g, ' ').trim()
    const body = mergeFields(mode === 'moved' ? cfg.movedMessage : cfg.emailBody, fields)
    try {
      await email.send(to, 'jobReminder', {
        companyName: co.name || '', contactName: String(j.customerName || '').split(' ')[0] || 'there', jobTitle: j.title || '',
        when: fields.when, address: fields.address, techName: fields.tech_name, subject, body, ...(token ? { confirmPath: confirmPathFor(token) } : {}),
      })
    } catch (e: any) { return done('failed', String(e?.message || 'The email could not be sent.').slice(0, 500), to) }
    return done('sent', null, to)
  }

  async function forCompany(co: any, cfg: JobReminderSettings, now: Date, out: PassResult) {
    const tz = companyRowTimeZone(co)
    const hour = hourIn(now, tz)
    if (hour < cfg.sendFromHour || hour >= cfg.sendUntilHour) return
    const today = storeDateString(now, tz)
    const reach = (cfg.timing === 'fixed_time' ? Math.max(...cfg.fixed.map((f) => f.daysBefore)) : Math.ceil(cfg.hoursBefore[0] / 24)) + 2
    const rows = await jobQuery().where(and(
      eq(job.companyId, co.id),
      isNull(job.bookingId), or(isNull(job.source), ne(job.source, 'online_booking')),
      inArray(job.status, ['scheduled', 'dispatched']),
      isNotNull(job.scheduledDate),
      gte(job.scheduledDate, new Date(`${addDays(today, -1)}T00:00:00Z`)),
      lt(job.scheduledDate, new Date(`${addDays(today, reach)}T00:00:00Z`)),
    ))

    for (const j of rows) {
      const v = visitStart(j.scheduledDate, j.scheduledTime, tz, cfg.sendFromHour)
      if (!v || v.start.getTime() <= now.getTime()) continue
      // The steps whose moment has come: the latest one reached is the one that is sent.
      const due = stepsFor(cfg, v.start, markerDay(j.scheduledDate), tz).filter((x) => x.dueAt.getTime() <= now.getTime())
      if (!due.length) continue
      const sendStep = due[due.length - 1]
      const superseded = due.slice(0, -1)
      const channels: Channel[] = [...(cfg.sms ? ['sms' as const] : []), ...(cfg.email ? ['email' as const] : [])]
      for (const ch of channels) {
        for (const x of superseded) {
          const id = await claim(co.id, JOB_REMINDER_KIND[ch], j.id, x.key)
          if (id) await settle(id, 'skipped', 'A later reminder for this visit had already come due.')
        }
        const logId = await claim(co.id, JOB_REMINDER_KIND[ch], j.id, sendStep.key)
        if (!logId) continue
        await deliver(co, cfg, ch, j, v, tz, logId, 'reminder', out)
      }
    }
  }

  /** One pass over every business with job reminders on. `now` is the clock (a test pins it). */
  async function runOnce(now: Date = new Date()): Promise<PassResult> {
    const out: PassResult = { sent: 0, skipped: 0, failed: 0, held: 0 }
    for (const co of await db.select().from(company)) {
      const cfg = jobReminderSettings(co.settings)
      if (!cfg.enabled) continue
      if (!(await deps.isFeatureEnabled(co.id, 'job_reminders'))) continue
      try { await forCompany(co, cfg, now, out) } catch (e: any) { logger.error('[job reminders] pass failed', { company: co.id, error: e?.message }) }
    }
    if (out.sent || out.failed || out.held) logger.info('[job reminders] pass', out as any)
    return out
  }

  /**
   * A reminder (or a "visit moved" notice) sent now by a person, from the job. It goes to the customer's number and address
   * under the same STOP / unsubscribe rules, whether or not the automatic reminders are on and whatever the sending hours say:
   * somebody chose to send it. Each is its own row in reminder_log, so it shows in the report beside the automatic ones.
   */
  async function sendNow(companyId: string, jobId: string, channels: Channel[], what: 'manual' | 'moved', byUserId: string | null, now: Date = new Date()): Promise<{ outcomes: Outcome[] } | { error: string; status: 404 | 400 }> {
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const [j] = await jobQuery().where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!co || !j) return { error: 'That job was not found.', status: 404 }
    const cfg = jobReminderSettings(co.settings)
    const tz = companyRowTimeZone(co)
    const v = visitStart(j.scheduledDate, j.scheduledTime, tz, cfg.sendFromHour)
    if (!v) return { error: 'This job has no date yet, so there is nothing to remind the customer of.', status: 400 }
    if (!channels.length) return { error: 'Choose text, email or both.', status: 400 }
    const outcomes: Outcome[] = []
    for (const ch of [...new Set(channels)]) {
      const kind = what === 'moved' ? (ch === 'sms' ? JOB_NOTICE_KIND.movedSms : JOB_NOTICE_KIND.movedEmail) : JOB_REMINDER_KIND[ch]
      // A manual reminder is its own row each time; a moved notice is once for each time the visit has been moved to, by each person who sends it (the step ends in who).
      const step = what === 'moved' ? `moved:${v.start.toISOString()}:${byUserId ?? ''}` : `manual:${now.toISOString()}:${byUserId ?? ''}`
      const logId = await claim(companyId, kind, j.id, step)
      if (!logId) { outcomes.push({ channel: ch, status: 'skipped', detail: 'The customer was already told about this time.', to: null }); continue }
      outcomes.push(await deliver(co, cfg, ch, j, v, tz, logId, what === 'moved' ? 'moved' : 'manual'))
    }
    return { outcomes }
  }

  /** Every 10 minutes, and shortly after boot (services.startJobs: boot only, never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[job reminders] pass failed', { error: e?.message }))
    setTimeout(tick, 2 * 60_000)
    setInterval(tick, 10 * 60_000)
  }

  return { runOnce, sendNow, confirmTokenFor, start }
}

export type JobReminders = ReturnType<typeof createJobReminders>
