// THE WEEKLY CLIENT UPDATE (parity tier 2 #9, 11/10 — Buildertrend's client updates; feature weekly_client_update, not ready).
// Once a week, on the day and hour the business picks (its own clock), each client with something new in their portal that week
// gets ONE email listing it, by project or job, with a button to their portal. Built on the sharing the portals already have —
// nothing is shared by this; it only says what was:
//   · contractor (client_portal_plus): the project's daily logs shared with the client, dated in the week; its files and photos
//     shared, added in the week;
//   · roofing: the job's photos shared (taken in the week), documents and inspection reports shared (made in the week), and the
//     roofer's posts to the homeowner in the week.
// Sharing has no time of its own (a switch on each item), so "new this week" is the item's own date: an old item shared today is
// not in the update. The week is the seven days up to the send.
//
// Who gets one: a client whose portal is on, with a portal link and an email address, who has not unsubscribed — and only when
// there is something to say (an empty week sends nothing). Each send is claimed in reminder_log (kind weekly_client_update, the
// client, the week's day) BEFORE it goes, so a client gets one a week whatever the passes do.
//
// READ: the email's button goes through /api/weekly-update/open/<signed id> (public), which records the first time it was opened
// (reminder_log.detail 'opened <time>') and sends them on to their portal. The office sees each update sent and whether it was
// opened (Settings › Weekly Client Update).
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { companyRowTimeZone, tzParts } from '@twomiah/tenant-backend'
import { company, contact, dailyLog, document, inspectionReport, job, jobPhoto, project, reminderLog, roofJobPost } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const WEEKLY_UPDATE = 'weekly_client_update'
export const KIND = 'weekly_client_update'
const DAY = 86_400_000
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export interface WeeklySettings { enabled: boolean; weekday: number; hour: number }
export const DEFAULT_SETTINGS: WeeklySettings = { enabled: false, weekday: 5, hour: 16 }

export function weeklySettings(settings: unknown): WeeklySettings {
  const s: any = (typeof settings === 'string' ? JSON.parse(settings || '{}') : settings) || {}
  const w = s.weeklyUpdate || {}
  const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : d)
  return { enabled: w.enabled === true, weekday: int(w.weekday, 0, 6, DEFAULT_SETTINGS.weekday), hour: int(w.hour, 0, 23, DEFAULT_SETTINGS.hour) }
}

// The read link: the reminder_log row, signed (no table of its own, nothing to guess).
const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('weekly-update-open').digest()
const sign = (id: string) => crypto.createHmac('sha256', key()).update('open|' + id).digest('base64url').slice(0, 24)
export const openToken = (logId: string) => `${logId}.${sign(logId)}`
export function logIdOf(token: string): string | null {
  const m = /^([A-Za-z0-9_-]{10,40})\.([A-Za-z0-9_-]{24})$/.exec(String(token || ''))
  if (!m) return null
  const a = Buffer.from(sign(m[1])), b = Buffer.from(m[2])
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null
}

const esc = (x: string) => x.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One project's or job's week: what is new in the portal. */
export interface WeekItem { name: string; dailyLogs: number; photos: number; files: number; reports: number; posts: number }
const said = (i: WeekItem) => [
  i.dailyLogs && plural(i.dailyLogs, 'daily log', 'daily logs'), i.photos && plural(i.photos, 'photo', 'photos'), i.files && plural(i.files, 'file', 'files'),
  i.reports && plural(i.reports, 'report', 'reports'), i.posts && plural(i.posts, 'message', 'messages'),
].filter(Boolean).join(', ')

export function createWeeklyUpdates(d: CrmDeps) {
  const { db, logger } = d
  const on = (companyId: string, f: string) => d.features.isFeatureEnabled(companyId, f).catch(() => false)

  /** Everything new in the portals of this company's clients in [from, to), by client. */
  async function weekOf(companyId: string, from: Date, to: Date): Promise<Map<string, WeekItem[]>> {
    const byClient = new Map<string, Map<string, WeekItem>>()
    const bump = (contactId: string | null, key: string, name: string, k: keyof Omit<WeekItem, 'name'>) => {
      if (!contactId) return
      const items = byClient.get(contactId) ?? new Map<string, WeekItem>()
      const it = items.get(key) ?? { name, dailyLogs: 0, photos: 0, files: 0, reports: 0, posts: 0 }
      it[k]++
      items.set(key, it); byClient.set(contactId, items)
    }
    // Contractor: projects.
    if (await on(companyId, 'client_portal_plus')) {
      const logs = await db.select({ pid: project.id, name: project.name, cid: project.contactId }).from(dailyLog).innerJoin(project, eq(project.id, dailyLog.projectId))
        .where(and(eq(dailyLog.companyId, companyId), eq(dailyLog.sharedWithClient, true), gte(dailyLog.date, from), lt(dailyLog.date, to)))
      for (const r of logs as any[]) bump(r.cid, `p:${r.pid}`, r.name, 'dailyLogs')
      const docs = await db.select({ pid: project.id, name: project.name, cid: project.contactId, mime: document.mimeType }).from(document).innerJoin(project, eq(project.id, document.projectId))
        .where(and(eq(document.companyId, companyId), eq(document.sharedWithCustomer, true), gte(document.createdAt, from), lt(document.createdAt, to)))
      for (const r of docs as any[]) bump(r.cid, `p:${r.pid}`, r.name, /^image\//.test(String(r.mime || '')) ? 'photos' : 'files')
    }
    // Roofing: jobs (the homeowner portal's photos, documents, reports and posts).
    if (await on(companyId, 'portal_job_files')) {
      const photos = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(jobPhoto).innerJoin(job, eq(job.id, jobPhoto.jobId))
        .where(and(eq(job.companyId, companyId), eq(jobPhoto.sharedWithCustomer, true), gte(jobPhoto.takenAt, from), lt(jobPhoto.takenAt, to)))
      for (const r of photos as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'photos')
      const docs = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(document).innerJoin(job, eq(job.id, document.jobId))
        .where(and(eq(document.companyId, companyId), eq(document.sharedWithCustomer, true), gte(document.createdAt, from), lt(document.createdAt, to)))
      for (const r of docs as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'files')
      if (await on(companyId, 'inspection_reports')) {
        const reps = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(inspectionReport).innerJoin(job, eq(job.id, inspectionReport.jobId))
          .where(and(eq(inspectionReport.companyId, companyId), eq(inspectionReport.sharedWithCustomer, true), gte(inspectionReport.createdAt, from), lt(inspectionReport.createdAt, to)))
        for (const r of reps as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'reports')
      }
    }
    if (await on(companyId, 'portal_posts_packets')) {
      const posts = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(roofJobPost).innerJoin(job, eq(job.id, roofJobPost.jobId))
        .where(and(eq(roofJobPost.companyId, companyId), eq(roofJobPost.fromHomeowner, false), gte(roofJobPost.createdAt, from), lt(roofJobPost.createdAt, to)))
      for (const r of posts as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'posts')
    }
    return new Map([...byClient].map(([cid, items]) => [cid, [...items.values()].sort((a, b) => a.name.localeCompare(b.name))]))
  }

  /** The email: one line per project or job, and the button (through the read link). */
  function emailOf(companyName: string, firstName: string, items: WeekItem[], openUrl: string) {
    const lines = items.map((i) => `<li><strong>${esc(i.name || 'Your project')}</strong>: ${esc(said(i))}</li>`).join('')
    return {
      subject: `Your week with ${companyName || 'us'}`,
      html: `<p>Hi ${esc(firstName)},</p><p>Here is what ${esc(companyName || 'we')} added to your portal this week:</p><ul>${lines}</ul>`
        + `<p><a href="${esc(openUrl)}" style="display:inline-block;padding:10px 18px;background:#ea580c;color:#fff;border-radius:8px;text-decoration:none">See it in your portal</a></p>`,
    }
  }

  /**
   * One company's update, if it is due: the chosen weekday, at or after the chosen hour, on the company's clock. The week's key
   * is that day, so later passes the same day (or a restart) send nothing twice. Returns how many emails went.
   */
  async function runCompany(co: any, now = new Date()): Promise<number> {
    const cfg = weeklySettings(co.settings)
    if (!cfg.enabled || !(await on(co.id, WEEKLY_UPDATE))) return 0
    const here = tzParts(now, companyRowTimeZone(co))
    if (here.weekday !== WEEKDAYS[cfg.weekday] || here.minutes < cfg.hour * 60) return 0
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    if (!/^https?:\/\//.test(origin)) return 0
    const week = await weekOf(co.id, new Date(now.getTime() - 7 * DAY), now)
    if (!week.size) return 0
    const clients = await db.select().from(contact).where(and(eq(contact.companyId, co.id), inArray(contact.id, [...week.keys()]), eq(contact.portalEnabled, true), isNotNull(contact.portalToken)))
    let sent = 0
    for (const c of clients as any[]) {
      const to = String(c.email || '').trim()
      if (!to || c.emailOptOut) continue
      const [claimed] = await db.insert(reminderLog).values({ companyId: co.id, kind: KIND, subjectId: c.id, step: here.date, status: 'sending', sentTo: to })
        .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
      if (!claimed) continue
      const mail = emailOf(co.name || '', String(c.name || '').trim().split(/\s+/)[0] || 'there', week.get(c.id) || [], `${origin}/api/weekly-update/open/${openToken(claimed.id)}`)
      try {
        await (d.services as any).emailService.sendRaw({ to, subject: mail.subject, html: mail.html })
        await db.update(reminderLog).set({ status: 'sent', updatedAt: new Date() }).where(eq(reminderLog.id, claimed.id))
        sent++
      } catch (e: any) {
        await db.update(reminderLog).set({ status: 'failed', detail: String(e?.message || 'not sent').slice(0, 300), updatedAt: new Date() }).where(eq(reminderLog.id, claimed.id))
      }
    }
    return sent
  }

  /** Every company with the update switched on (the timed pass, and tests). */
  async function runOnce(now = new Date()): Promise<number> {
    const cos = await db.select().from(company)
    let n = 0
    for (const co of cos as any[]) {
      try { n += await runCompany(co, now) } catch (e: any) { logger.error('[weekly update] a company failed', { error: e?.message }) }
    }
    return n
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const settingsBody = z.object({
    enabled: z.boolean({ error: 'Choose on or off' }),
    weekday: z.number({ error: 'Choose a day' }).int().min(0, 'Choose a day').max(6, 'Choose a day'),
    hour: z.number({ error: 'Choose an hour' }).int().min(0, 'An hour from 0 to 23').max(23, 'An hour from 0 to 23'),
  })
  const { requirePermission } = d.permissions

  /** /api/weekly-update — Settings › Weekly Client Update (the settings and the updates sent lately). */
  const office = new Hono<AppEnv>()
  const recent = async (companyId: string) => {
    const rows = await db.select({ id: reminderLog.id, contactId: reminderLog.subjectId, week: reminderLog.step, status: reminderLog.status, sentTo: reminderLog.sentTo, detail: reminderLog.detail, at: reminderLog.createdAt, name: contact.name })
      .from(reminderLog).leftJoin(contact, eq(contact.id, reminderLog.subjectId))
      .where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, KIND))).orderBy(desc(reminderLog.createdAt), desc(reminderLog.id)).limit(100)
    return (rows as any[]).map((r) => {
      const opened = /^opened (\S+)/.exec(String(r.detail || ''))?.[1] ?? null
      return { id: r.id, client: r.name || 'A client who was removed', sentTo: r.sentTo, sentAt: new Date(r.at).toISOString(), status: r.status, openedAt: opened, problem: r.status === 'failed' ? r.detail : null }
    })
  }
  office.get('/', requirePermission('contacts:read'), async (c) => {
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return one(c, { settings: weeklySettings(co?.settings), sent: await recent(companyId) })
  })
  office.put('/settings', requirePermission('company:update'), async (c) => {
    const parsed = settingsBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings: any = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    await db.update(company).set({ settings: { ...settings, weeklyUpdate: parsed.data }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    d.audit.log({ action: d.audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { weeklyUpdate: parsed.data }, req: c })
    return one(c, { settings: weeklySettings({ weeklyUpdate: parsed.data }) })
  })

  /** /api/weekly-update/open/:token — the email's button (public): the first opening is recorded, then on to the portal. */
  const open = new Hono<AppEnv>()
  open.get('/:token', async (c) => {
    const id = logIdOf(c.req.param('token'))
    const [row] = id ? await db.select().from(reminderLog).where(and(eq(reminderLog.id, id), eq(reminderLog.kind, KIND))).limit(1) : []
    const [who] = row ? await db.select({ token: contact.portalToken }).from(contact).where(and(eq(contact.id, row.subjectId), eq(contact.companyId, row.companyId))).limit(1) : []
    if (!row || !who?.token) return fail(c, 404, 'This link is not valid any more.')
    if (!/^opened /.test(String(row.detail || ''))) await db.update(reminderLog).set({ detail: `opened ${new Date().toISOString()}`, updatedAt: new Date() }).where(eq(reminderLog.id, row.id))
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    return c.redirect(`${origin}/portal/${who.token}`, 302)
  })

  /** Every hour, and shortly after boot (services.addJob: never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[weekly update] pass failed', { error: e?.message }))
    setTimeout(tick, 3 * 60_000)
    setInterval(tick, 60 * 60_000)
  }

  return { weekOf, runCompany, runOnce, office, open, start }
}
