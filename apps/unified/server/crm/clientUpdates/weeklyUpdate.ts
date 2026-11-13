// THE WEEKLY CLIENT UPDATE (parity tier 2 #9, 11/10 — Buildertrend's client updates; feature weekly_client_update, not ready).
// Once a week, on the day and hour the business picks (its own clock), each client with something new in their portal that week
// gets ONE email listing it, by project or job, with a button to their portal. Built on the sharing the portals already have —
// nothing is shared by this; it only says what was:
//   · contractor (client_portal_plus): the project's daily logs shared with the client, dated in the week; its files and photos
//     shared, added in the week;
//   · roofing: the job's photos shared (taken in the week), documents and inspection reports shared (made in the week), and the
//     roofer's posts to the homeowner in the week.
// "New this week" is when the item was SHARED that week (its shared_at, stamped when the switch goes on — the photos a crew took
// last month and shared today are news); an item shared before shared_at was kept counts by its own date. The week is the seven
// days up to the send.
//
// Who gets one: a client whose portal is on, with a portal link and an email address, who has not unsubscribed — and only when
// there is something to say (an empty week sends nothing). Each send is claimed in reminder_log (kind weekly_client_update, the
// client, the week's day) BEFORE it goes, so a client gets one a week whatever the passes do.
//
// LIKE AND REPLY (Buildertrend's client update reactions): the email's "Like this update, or reply" link opens a small page (no
// sign-in — the signed link is the key; opening it records nothing, so a mail scanner's visit likes nothing) where the client likes
// the update and can write back. Each lands on the client's activity and in Settings › Weekly Client Update beside the send.
//
// READ: the email's button goes through /api/weekly-update/open/<signed id> (public), which records the first time it was opened
// (reminder_log.detail 'opened <time>') and sends them on to their portal. The office sees each update sent and whether it was
// opened (Settings › Weekly Client Update).
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { companyRowTimeZone, tzParts } from '@twomiah/tenant-backend'
import { activity, clientUpdateReaction, company, contact, dailyLog, document, inspectionReport, job, jobPhoto, project, reminderLog, roofJobPost } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const WEEKLY_UPDATE = 'weekly_client_update'
export const KIND = 'weekly_client_update'
/** How long an update's Open button works: the week it is about, and a little after. */
export const OPEN_LINK_DAYS = 21
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

/** Shared in [from, to): by when it was shared, or — shared before that was kept — by its own date. */
const sharedIn = (sharedAt: any, own: any, from: Date, to: Date) =>
  or(and(isNotNull(sharedAt), gte(sharedAt, from), lt(sharedAt, to)), and(isNull(sharedAt), gte(own, from), lt(own, to)))
export const MAX_REPLY = 2000
const MAX_REPLIES = 20

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
        .where(and(eq(dailyLog.companyId, companyId), eq(dailyLog.sharedWithClient, true), sharedIn(dailyLog.sharedAt, dailyLog.date, from, to)))
      for (const r of logs as any[]) bump(r.cid, `p:${r.pid}`, r.name, 'dailyLogs')
      const docs = await db.select({ pid: project.id, name: project.name, cid: project.contactId, mime: document.mimeType }).from(document).innerJoin(project, eq(project.id, document.projectId))
        .where(and(eq(document.companyId, companyId), eq(document.sharedWithCustomer, true), sharedIn(document.sharedAt, document.createdAt, from, to)))
      for (const r of docs as any[]) bump(r.cid, `p:${r.pid}`, r.name, /^image\//.test(String(r.mime || '')) ? 'photos' : 'files')
    }
    // Roofing: jobs (the homeowner portal's photos, documents, reports and posts).
    if (await on(companyId, 'portal_job_files')) {
      const photos = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(jobPhoto).innerJoin(job, eq(job.id, jobPhoto.jobId))
        .where(and(eq(job.companyId, companyId), eq(jobPhoto.sharedWithCustomer, true), sharedIn(jobPhoto.sharedAt, jobPhoto.takenAt, from, to)))
      for (const r of photos as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'photos')
      const docs = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(document).innerJoin(job, eq(job.id, document.jobId))
        .where(and(eq(document.companyId, companyId), eq(document.sharedWithCustomer, true), sharedIn(document.sharedAt, document.createdAt, from, to)))
      for (const r of docs as any[]) bump(r.cid, `j:${r.jid}`, r.name, 'files')
      if (await on(companyId, 'inspection_reports')) {
        const reps = await db.select({ jid: job.id, name: job.title, cid: job.contactId }).from(inspectionReport).innerJoin(job, eq(job.id, inspectionReport.jobId))
          .where(and(eq(inspectionReport.companyId, companyId), eq(inspectionReport.sharedWithCustomer, true), sharedIn(inspectionReport.sharedAt, inspectionReport.createdAt, from, to)))
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
  function emailOf(companyName: string, firstName: string, items: WeekItem[], openUrl: string, reactUrl: string) {
    const lines = items.map((i) => `<li><strong>${esc(i.name || 'Your project')}</strong>: ${esc(said(i))}</li>`).join('')
    return {
      subject: `Your week with ${companyName || 'us'}`,
      html: `<p>Hi ${esc(firstName)},</p><p>Here is what ${esc(companyName || 'we')} added to your portal this week:</p><ul>${lines}</ul>`
        + `<p><a href="${esc(openUrl)}" style="display:inline-block;padding:10px 18px;background:#ea580c;color:#fff;border-radius:8px;text-decoration:none">See it in your portal</a></p>`
        + `<p><a href="${esc(reactUrl)}" style="color:#c2410c">Like this update, or reply to ${esc(companyName || 'us')}</a></p>`,
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
      const mail = emailOf(co.name || '', String(c.name || '').trim().split(/\s+/)[0] || 'there', week.get(c.id) || [], `${origin}/api/weekly-update/open/${openToken(claimed.id)}`, `${origin}/api/weekly-update/react/${openToken(claimed.id)}`)
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
    const ids = (rows as any[]).map((r) => r.id)
    const reacts = ids.length ? await db.select().from(clientUpdateReaction).where(and(eq(clientUpdateReaction.companyId, companyId), inArray(clientUpdateReaction.logId, ids))).orderBy(asc(clientUpdateReaction.createdAt), asc(clientUpdateReaction.id)) : []
    return (rows as any[]).map((r) => {
      const mine = (reacts as any[]).filter((x) => x.logId === r.id)
      // Opened: the email's button, else the first like or reply (a person who read it) — so a send liked before the reaction
      // marked it (live test 11/11) reads opened too.
      const firstReaction = mine.length ? new Date(Math.min(...mine.map((x: any) => new Date(x.createdAt).getTime()))).toISOString() : null
      const opened = /^opened (\S+)/.exec(String(r.detail || ''))?.[1] ?? firstReaction
      const like = mine.find((x) => x.kind === 'like')
      return {
        id: r.id, client: r.name || 'A client who was removed', sentTo: r.sentTo, sentAt: new Date(r.at).toISOString(), status: r.status, openedAt: opened, problem: r.status === 'failed' ? r.detail : null,
        likedAt: like ? new Date(like.createdAt).toISOString() : null,
        replies: mine.filter((x) => x.kind === 'reply').map((x) => ({ body: x.body, at: new Date(x.createdAt).toISOString() })),
      }
    })
  }
  // Who was sent what, their emails and their replies: the Settings screen's (owners and admins — company:update, as saving it is).
  // Live test 11/11: contacts:read let a Field seat read every client's email and reply through the API.
  office.get('/', requirePermission('company:update'), async (c) => {
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
    // The button carries the reader straight into the customer's portal on its CURRENT link, so an old email was a
    // standing key however often the office reissued the portal link (security review S2-9, 2026-11-13). It works
    // while the update is fresh and the feature is on; after that the customer uses their portal link itself.
    if (Date.now() - new Date(row.createdAt).getTime() > OPEN_LINK_DAYS * 86_400_000 || !(await on(row.companyId, WEEKLY_UPDATE))) return fail(c, 404, 'This link is not valid any more.')
    if (!/^opened /.test(String(row.detail || ''))) await db.update(reminderLog).set({ detail: `opened ${new Date().toISOString()}`, updatedAt: new Date() }).where(eq(reminderLog.id, row.id))
    const origin = String(process.env.FRONTEND_URL || '').replace(/\/+$/, '')
    return c.redirect(`${origin}/portal/${who.token}`, 302)
  })

  /** /api/weekly-update/react/:token — like the update, or reply (public; the signed link is the key, and the feature must be on). */
  const react = new Hono<AppEnv>()
  const reactPage = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f9fafb;color:#111827}main{max-width:520px;margin:0 auto;padding:32px 16px}h1{font-size:22px;margin:0 0 8px}p{line-height:1.5}
textarea{width:100%;box-sizing:border-box;min-height:110px;border:1px solid #9ca3af;border-radius:10px;padding:10px;font:inherit;background:#fff;color:#111827}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:10px;background:#c2410c;color:#fff;font-size:16px;font-weight:bold;cursor:pointer}button.like{background:#15803d}
.muted{color:#4b5563;font-size:14px}.ok{color:#166534;font-weight:bold}.err{color:#b91c1c}
@media (prefers-color-scheme: dark){body{background:#0f172a;color:#e5e7eb}textarea{background:#1e293b;border-color:#475569;color:#e5e7eb}.muted{color:#cbd5e1}.ok{color:#86efac}.err{color:#fca5a5}}</style></head><body><main>${body}</main></body></html>`
  async function reactionOf(token: string) {
    const id = logIdOf(token)
    const [row] = id ? await db.select().from(reminderLog).where(and(eq(reminderLog.id, id), eq(reminderLog.kind, KIND))).limit(1) : []
    if (!row || !(await on(row.companyId, WEEKLY_UPDATE))) return null
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, row.companyId)).limit(1)
    const mine = await db.select().from(clientUpdateReaction).where(and(eq(clientUpdateReaction.logId, row.id), eq(clientUpdateReaction.companyId, row.companyId))).orderBy(asc(clientUpdateReaction.createdAt))
    return { row, companyName: String(co?.name || 'us'), liked: (mine as any[]).some((x) => x.kind === 'like'), replies: (mine as any[]).filter((x) => x.kind === 'reply').length }
  }
  const gone = () => reactPage('Link not valid', '<h1>This link is not valid any more</h1><p class="muted">Ask the business for a new one.</p>')
  const formOf = (v: { companyName: string; liked: boolean }, note = '', error = '') => reactPage(`Your week with ${v.companyName}`, `<h1>Your week with ${esc(v.companyName)}</h1>`
    + (note ? `<p class="ok" role="status">${esc(note)}</p>` : '')
    + (v.liked ? '<p class="muted">You liked this update.</p>' : '<form method="post"><input type="hidden" name="like" value="1"><button class="like" type="submit">Like this update</button></form>')
    + `<form method="post"><p><label for="reply">Write back to ${esc(v.companyName)}</label></p>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}<textarea id="reply" name="reply" maxlength="${MAX_REPLY}" required></textarea><button type="submit">Send</button></form>`)
  react.get('/:token', async (c) => {
    const v = await reactionOf(c.req.param('token'))
    return v ? c.html(formOf(v)) : c.html(gone(), 404)
  })
  react.post('/:token', async (c) => {
    const v = await reactionOf(c.req.param('token'))
    if (!v) return c.html(gone(), 404)
    const f: Record<string, unknown> = await c.req.parseBody().catch(() => ({}))
    const { row } = v
    const toActivity = (action: string, description: string) => db.insert(activity).values({ companyId: row.companyId, userId: null, entityType: 'contact', entityId: row.subjectId, action, description, metadata: { reminderLogId: row.id } })
    // A like or a reply is a person who read it: "Opened" says so, if the email's own button never did (live test 11/11: liked and
    // replied, still "Not yet"). Only on these — a plain GET of the page is what a mail scanner does too, so it records nothing.
    const opened = async () => { if (!/^opened /.test(String(row.detail || ''))) await db.update(reminderLog).set({ detail: `opened ${new Date().toISOString()}`, updatedAt: new Date() }).where(eq(reminderLog.id, row.id)) }
    if (String(f.like || '') === '1') {
      if (!v.liked) {
        await opened()
        await db.insert(clientUpdateReaction).values({ companyId: row.companyId, logId: row.id, contactId: row.subjectId, kind: 'like' })
        await toActivity('weekly_update_liked', `Liked the weekly update of ${row.step}.`)
      }
      return c.html(formOf({ ...v, liked: true }, 'Thanks — they will see you liked it.'))
    }
    const text = String(f.reply ?? '').trim()
    if (!text) return c.html(formOf(v, '', 'Write your message first.'), 400)
    if (text.length > MAX_REPLY) return c.html(formOf(v, '', `At most ${MAX_REPLY.toLocaleString('en-US')} characters.`), 400)
    if (v.replies >= MAX_REPLIES) return c.html(formOf(v, '', 'That is a lot of messages on one update. Please call or email them instead.'), 429)
    await opened()
    await db.insert(clientUpdateReaction).values({ companyId: row.companyId, logId: row.id, contactId: row.subjectId, kind: 'reply', body: text })
    await toActivity('weekly_update_reply', `Replied to the weekly update: ${text.slice(0, 500)}`)
    return c.html(formOf(v, `Sent to ${v.companyName}. They will get back to you.`))
  })

  /** Every hour, and shortly after boot (services.addJob: never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[weekly update] pass failed', { error: e?.message }))
    setTimeout(tick, 3 * 60_000)
    setInterval(tick, 60 * 60_000)
  }

  return { weekOf, runCompany, runOnce, office, open, react, start }
}
