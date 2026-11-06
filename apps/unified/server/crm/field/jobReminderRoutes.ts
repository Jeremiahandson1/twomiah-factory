// /api/job-reminders — the business's automatic job reminders (./jobReminders.ts): read and set the rules
// (Settings › Job Reminders).
//
// Who: reading is anyone who reads jobs; changing the rules is a company setting (company:update — the owner and
// admins, as PUT /api/company and the invoice reminders).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, gte, lt, inArray, desc } from 'drizzle-orm'
import { companyRowTimeZone, storeDayRange, storeDateString } from '@twomiah/tenant-backend'
import { company, contact, job, jobAssignee, reminderLog, user, smsConversation, smsMessage } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, fail } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { jobReminderSettings, MAX_JOB_MESSAGE, MAX_EMAIL_BODY, JOB_NOTICE_KIND, JOB_NOTICE_LABEL, type Channel } from './jobReminders.ts'

const whole = (what: string) => z.number({ error: `Enter ${what}` }).int(`Enter ${what}`)
const settingsSchema = z.object({
  enabled: z.boolean(),
  hoursBefore: z.array(whole('a whole number of hours').min(1, 'At least 1 hour before').max(168, 'At most 168 hours (7 days) before'))
    .min(1, 'Add at least one reminder').max(2, 'At most 2 reminders'),
  sms: z.boolean(),
  email: z.boolean(),
  sendFromHour: whole('an hour from 0 to 23').min(0, 'An hour from 0 to 23').max(23, 'An hour from 0 to 23'),
  sendUntilHour: whole('an hour from 1 to 24').min(1, 'An hour from 1 to 24').max(24, 'An hour from 1 to 24'),
  message: z.string({ error: 'Write the text message' }).trim().min(1, 'Write the text message').max(MAX_JOB_MESSAGE, `At most ${MAX_JOB_MESSAGE} characters`),
  // The newer settings are optional so a caller that predates them (the first screen, a script) still saves; they keep what was stored.
  timing: z.enum(['hours_before', 'fixed_time'], { error: 'Choose when reminders go out' }).optional(),
  fixed: z.array(z.object({
    daysBefore: whole('a whole number of days').min(0, 'At least 0 days before').max(14, 'At most 14 days before'),
    time: z.string({ error: 'Enter a time' }).regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Enter a time like 09:00'),
  })).min(1, 'Add at least one reminder').max(2, 'At most 2 reminders').optional(),
  emailSubject: z.string({ error: 'Write the email subject' }).trim().min(1, 'Write the email subject').max(200, 'At most 200 characters').optional(),
  emailBody: z.string({ error: 'Write the email' }).trim().min(1, 'Write the email').max(MAX_EMAIL_BODY, `At most ${MAX_EMAIL_BODY} characters`).optional(),
  askConfirm: z.boolean().optional(),
  movedMessage: z.string({ error: 'Write the visit-moved message' }).trim().min(1, 'Write the visit-moved message').max(MAX_JOB_MESSAGE, `At most ${MAX_JOB_MESSAGE} characters`).optional(),
}).superRefine((s, ctx) => {
  if (s.sendUntilHour <= s.sendFromHour) ctx.addIssue({ code: 'custom', path: ['sendUntilHour'], message: 'Must be later than the starting hour' })
  if (s.enabled && !s.sms && !s.email) ctx.addIssue({ code: 'custom', path: ['sms'], message: 'Turn on text, email or both' })
})

const VARIABLES = ['customer_name', 'company_name', 'job', 'when', 'date', 'time', 'address', 'tech_name', 'confirm_link']
const MANAGERS = new Set(['owner', 'admin', 'manager'])
const STATUS_WORDS: Record<string, string> = { sent: 'Sent', skipped: 'Not sent', failed: 'Failed', held: 'Waiting to send', sending: 'Sending' }
/** A reminder or moved notice a person sent carries who in its step (manual:<time>:<user>, moved:<time>:<user>). */
const byPerson = (step: unknown) => /^(manual|moved):/.test(String(step))
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export function createJobReminderRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const view = (settings: unknown) => ({ ...jobReminderSettings(settings), maxMessage: MAX_JOB_MESSAGE, maxEmailBody: MAX_EMAIL_BODY, variables: VARIABLES })
  const engine = () => d.services.jobReminders

  app.get('/settings', requirePermission('jobs:read'), async (c) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    return one(c, view(co?.settings))
  })

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    const before = jobReminderSettings(settings)
    // Stored as the engine reads it back, so what the screen shows after saving is what will run.
    const next = jobReminderSettings({ jobReminders: { ...before, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) } })
    await db.update(company).set({ settings: { ...settings, jobReminders: next }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { jobReminders: { before, after: next } }, req: c })
    return one(c, view({ jobReminders: next }))
  })

  // ── from the job ────────────────────────────────────────────────────────────────────────────────
  /** A seat that is not the office may act only on its own jobs (the one it leads, or is on the crew of). */
  async function mayActOn(c: any, jobId: string): Promise<boolean> {
    const u = c.get('user')
    const [j] = await db.select({ id: job.id, assignedToId: job.assignedToId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, u.companyId))).limit(1)
    if (!j) return false
    if (MANAGERS.has(u.role) || j.assignedToId === u.userId) return true
    const [crew] = await db.select({ id: jobAssignee.id }).from(jobAssignee).where(and(eq(jobAssignee.jobId, jobId), eq(jobAssignee.userId, u.userId))).limit(1)
    return !!crew
  }
  const channelsOf = (body: any): Channel[] | null => {
    const list = Array.isArray(body?.channels) ? body.channels : []
    const ok = list.filter((x: unknown) => x === 'sms' || x === 'email') as Channel[]
    return ok.length && ok.length === list.length ? ok : null
  }
  const sendRoute = (what: 'manual' | 'moved') => async (c: any) => {
    const u = c.get('user')
    const jobId = c.req.param('jobId')
    const channels = channelsOf(await c.req.json().catch(() => null))
    if (!channels) return fail(c, 400, 'Choose text, email or both.')
    if (!(await mayActOn(c, jobId))) return fail(c, 404, 'That job was not found.')
    const r = await engine().sendNow(u.companyId, jobId, channels, what, u.userId)
    if ('error' in r) return fail(c, r.status, r.error)
    audit.log({ action: audit.ACTIONS.SEND, entity: 'job', entityId: jobId, metadata: { [what === 'moved' ? 'visitMovedNotice' : 'manualReminder']: r.outcomes.map((o) => `${o.channel}:${o.status}`) }, req: c })
    return one(c, { outcomes: r.outcomes })
  }
  /** Text / Email reminder: sent now by a person, logged like the automatic ones. */
  app.post('/send/:jobId', requirePermission('jobs:update'), sendRoute('manual'))
  /** "Notify client?": the visit moved and the office chose to tell the customer. */
  app.post('/moved/:jobId', requirePermission('jobs:update'), sendRoute('moved'))

  /** What the job panel shows: is it confirmed, and what the customer has been sent about it. */
  app.get('/job/:jobId', requirePermission('jobs:read'), async (c) => {
    const u = c.get('user')
    const jobId = c.req.param('jobId')
    const [j] = await db.select({ id: job.id, confirmedAt: job.confirmedAt, confirmedVia: job.confirmedVia, contactId: job.contactId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, u.companyId))).limit(1)
    if (!j) return fail(c, 404, 'That job was not found.')
    const [ct] = j.contactId ? await db.select({ off: contact.jobRemindersOff, sms: contact.optedOutSms, email: contact.emailOptOut, phone: contact.phone, mobile: contact.mobile, address: contact.email }).from(contact).where(eq(contact.id, j.contactId)).limit(1) : []
    const rows: any[] = await db.select().from(reminderLog).where(and(eq(reminderLog.companyId, u.companyId), eq(reminderLog.subjectId, jobId), inArray(reminderLog.kind, Object.values(JOB_NOTICE_KIND)))).orderBy(desc(reminderLog.createdAt)).limit(20)
    return one(c, {
      confirmedAt: j.confirmedAt ? new Date(j.confirmedAt).toISOString() : null,
      confirmedBy: j.confirmedVia === 'text' ? 'by text' : j.confirmedVia === 'portal' ? 'in the customer portal' : j.confirmedVia === 'link' ? 'from the link in the reminder' : null,
      customer: { remindersOff: !!ct?.off, textsOff: !!ct?.sms, emailsOff: !!ct?.email },
      // Who a message from the office can reach right now: a person's own Text / Email buttons are offered on these.
      hasCustomer: !!j.contactId,
      canText: !!(ct && (ct.mobile || ct.phone) && !ct.sms),
      canEmail: !!(ct && ct.address && !ct.email),
      notices: rows.map((r) => ({ id: r.id, what: JOB_NOTICE_LABEL[r.kind] ?? 'Message', channel: r.kind.endsWith('_sms') ? 'Text' : 'Email', status: STATUS_WORDS[r.status] ?? r.status, detail: r.status === 'sent' ? null : r.detail, at: new Date(r.createdAt).toISOString(), manual: byPerson(r.step) })),
    })
  })

  // ── Client Communications ───────────────────────────────────────────────────────────────────────
  /**
   * Every reminder and "visit moved" message the business sent (automatic or by a person), with whether it reached the customer
   * and whether the visit was confirmed, plus the customers' replies. Over reminder_log and the text log. ?format=csv downloads it.
   */
  app.get('/report', requirePermission('reports:read'), async (c) => {
    const u = c.get('user')
    const [co] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    const tz = companyRowTimeZone(co)
    const today = storeDateString(new Date(), tz)
    const ymd = (v: string | undefined, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback)
    const back = new Date(`${today}T00:00:00Z`); back.setUTCDate(back.getUTCDate() - 29)
    const startDate = ymd(c.req.query('startDate'), back.toISOString().slice(0, 10))
    const endDate = ymd(c.req.query('endDate'), today)
    if (startDate > endDate) return fail(c, 400, 'The start date must not be after the end date.')
    const from = storeDayRange(tz, startDate).start, to = storeDayRange(tz, endDate).end
    const what = c.req.query('what'), channel = c.req.query('channel'), status = c.req.query('status')
    const kinds = Object.values(JOB_NOTICE_KIND).filter((k) => (what === 'reminder' ? !k.startsWith('job_moved') : what === 'moved' ? k.startsWith('job_moved') : true) && (channel === 'sms' ? k.endsWith('_sms') : channel === 'email' ? k.endsWith('_email') : true))
    const logs: any[] = await db.select({
      id: reminderLog.id, kind: reminderLog.kind, step: reminderLog.step, status: reminderLog.status, detail: reminderLog.detail, sentTo: reminderLog.sentTo, at: reminderLog.createdAt,
      jobId: job.id, jobNumber: job.number, jobTitle: job.title, confirmedAt: job.confirmedAt, confirmedVia: job.confirmedVia, contactId: contact.id, customer: contact.name,
    }).from(reminderLog).innerJoin(job, eq(job.id, reminderLog.subjectId)).leftJoin(contact, eq(contact.id, job.contactId))
      .where(and(eq(reminderLog.companyId, u.companyId), inArray(reminderLog.kind, kinds), gte(reminderLog.createdAt, from), lt(reminderLog.createdAt, to), ...(status ? [eq(reminderLog.status, status)] : [])))
      .orderBy(desc(reminderLog.createdAt)).limit(2000)
    const byId = new Map<string, string>()
    const senders = [...new Set(logs.map((r) => byPerson(r.step) ? String(r.step).split(':').pop() : '').filter(Boolean))] as string[]
    if (senders.length) for (const p of await db.select({ id: user.id, f: user.firstName, l: user.lastName }).from(user).where(and(eq(user.companyId, u.companyId), inArray(user.id, senders)))) byId.set(p.id, `${p.f} ${p.l}`.trim())
    const rows = logs.map((r) => ({
      id: r.id, at: new Date(r.at).toISOString(), what: JOB_NOTICE_LABEL[r.kind] ?? 'Message', channel: r.kind.endsWith('_sms') ? 'Text' : 'Email',
      status: STATUS_WORDS[r.status] ?? r.status, detail: r.status === 'sent' ? '' : (r.detail ?? ''), to: r.sentTo ?? '',
      sentBy: byPerson(r.step) ? (byId.get(String(r.step).split(':').pop() || '') || 'A team member') : 'Automatic',
      jobId: r.jobId, jobNumber: r.jobNumber, jobTitle: r.jobTitle, contactId: r.contactId, customer: r.customer ?? '',
      confirmed: !!r.confirmedAt, confirmedAt: r.confirmedAt ? new Date(r.confirmedAt).toISOString() : null,
    }))
    // The customers' own texts back, in the same period, for the customers who were sent something.
    const people = [...new Set(logs.map((r) => r.contactId).filter(Boolean))] as string[]
    const replies = people.length ? await db.select({ at: smsMessage.createdAt, body: smsMessage.body, contactId: smsConversation.contactId, name: contact.name })
      .from(smsMessage).innerJoin(smsConversation, eq(smsConversation.id, smsMessage.conversationId)).leftJoin(contact, eq(contact.id, smsConversation.contactId))
      .where(and(eq(smsConversation.companyId, u.companyId), inArray(smsConversation.contactId, people), eq(smsMessage.direction, 'inbound'), gte(smsMessage.createdAt, from), lt(smsMessage.createdAt, to)))
      .orderBy(desc(smsMessage.createdAt)).limit(500) : []
    const summary = {
      sent: rows.filter((r) => r.status === 'Sent').length,
      notSent: rows.filter((r) => r.status === 'Not sent').length,
      failed: rows.filter((r) => r.status === 'Failed').length,
      waiting: rows.filter((r) => r.status === 'Waiting to send' || r.status === 'Sending').length,
      visitsConfirmed: new Set(rows.filter((r) => r.confirmed).map((r) => r.jobId)).size,
      visitsReminded: new Set(rows.filter((r) => r.status === 'Sent').map((r) => r.jobId)).size,
      replies: replies.length,
    }
    if (c.req.query('format') === 'csv') {
      const head = ['When', 'Customer', 'Job', 'What', 'Channel', 'Result', 'Sent to', 'Sent by', 'Why not', 'Visit confirmed']
      const lines = [head.map(csvCell).join(',')].concat(rows.map((r) => [r.at, r.customer, `${r.jobNumber} ${r.jobTitle}`, r.what, r.channel, r.status, r.to, r.sentBy, r.detail, r.confirmed ? 'Yes' : 'No'].map(csvCell).join(',')))
      return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="client-communications-${startDate}-to-${endDate}.csv"` } })
    }
    return one(c, { startDate, endDate, summary, rows, replies: replies.map((r: any) => ({ at: new Date(r.at).toISOString(), customer: r.name ?? '', body: r.body })) })
  })

  return app
}
