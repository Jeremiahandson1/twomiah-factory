// The visit-done message (landscaping, feature `visit_reports`): when a visit is finished the customer is told, in the business's
// words, with the crew's note and the after-photos. A text if we can text them (queued for the 8 am – 8 pm window, so a 5 am
// plough does not wake anyone, and sent from the business's own number), otherwise an email; never both. Off for a customer who
// opted out, for a visit the office marked "don't message", and for a business that has not turned the feature on.
// One report per job, ever (a unique index): finishing a job twice, or a replayed request, never messages twice.
// Raw SQL lives here (RULEBOOK §2); nothing here moves money.
import crypto from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { companyTimeZone, publicApiBase } from '@twomiah/tenant-backend'
import { job, contact, company, jobPhoto, document, visitReport, scheduledText, landscapingSetting, recurringRouteStop } from '../db/schema/index.ts'
import { textTime } from './routeRainDay.ts'
import { officeEmails } from './homecareCertReminders.ts'
import { pictureToken } from '../crm/comms/smsMedia.ts'

/** Row 26 (Yardbook's office side; not ready): the office screen, the message's own words, and the services never messaged. */
export const VISIT_TOOLS = 'visit_message_tools'
/** Row 31 (Jobber's feedback survey; not ready): a 1–5 rating and a comment from the message's link; a low one emails the office. */
export const VISIT_SURVEY = 'visit_survey'

/** A text carries at most this many pictures (the carriers' practical ceiling for one message). */
export const MAX_REPORT_PHOTOS = 3
export const MAX_NOTE = 1000
export const AFTER = 'after'
/** A photo the crew took before starting (Yardbook before/after; landscaping parity row 9). */
export const BEFORE = 'before'

const MEDIA_PREFIX = '/media/'
const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
const first = (name: string | null | undefined) => String(name || '').trim().split(/\s+/)[0] || 'there'
const keyOf = (url: string) => (String(url || '').startsWith(MEDIA_PREFIX) ? String(url).slice(MEDIA_PREFIX.length) : null)

/**
 * The job's before- and after-photos (Yardbook sends both with the visit report): the before ones first, then the after ones, each
 * in the order the crew took them. `kind` says which.
 */
export async function visitPhotos(db: any, companyId: string, jobId: string): Promise<Array<{ id: string; key: string; caption: string | null; kind: 'before' | 'after' }>> {
  const rows: any[] = await db.select().from(jobPhoto)
    .where(and(eq(jobPhoto.companyId, companyId), eq(jobPhoto.jobId, jobId), inArray(jobPhoto.photoType, [BEFORE, AFTER])))
    .orderBy(asc(jobPhoto.createdAt), asc(jobPhoto.id))
  // A photo the crew drew on (photo_markup) goes in place of its original: the marked copy keeps the original's kind.
  const drawnOn = new Set(rows.map((r) => r.sourcePhotoId).filter(Boolean))
  const all = rows.filter((r) => !drawnOn.has(r.id)).map((r) => ({ id: r.id, key: keyOf(r.url) as string, caption: r.caption ?? null, kind: (r.photoType === BEFORE ? 'before' : 'after') as 'before' | 'after' })).filter((r) => !!r.key)
  return [...all.filter((p) => p.kind === 'before'), ...all.filter((p) => p.kind === 'after')]
}

/**
 * The pictures a visit-done message carries (a text takes MAX_REPORT_PHOTOS): with both kinds, the first before-photo and then the
 * after-photos — the change the customer is paying for; with one kind, that kind.
 */
export function messagePhotos<P extends { kind: 'before' | 'after' }>(photos: P[], max = MAX_REPORT_PHOTOS): P[] {
  const before = photos.filter((p) => p.kind === 'before'), after = photos.filter((p) => p.kind === 'after')
  if (before.length && after.length) return [before[0], ...after].slice(0, max)
  return photos.slice(0, max)
}

export async function getReport(db: any, companyId: string, jobId: string) {
  const [row] = await db.select().from(visitReport).where(and(eq(visitReport.jobId, jobId), eq(visitReport.companyId, companyId))).limit(1)
  return row ?? null
}

/** The crew's note (and the office's "don't message about this visit"), kept on the job's report; made if it is not there yet. */
export async function saveReport(db: any, companyId: string, jobId: string, patch: { note?: string | null; skip?: boolean }) {
  const [j] = await db.select({ id: job.id, contactId: job.contactId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j) return null
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.note !== undefined) set.note = patch.note === null || String(patch.note).trim() === '' ? null : String(patch.note).trim().slice(0, MAX_NOTE)
  if (patch.skip !== undefined) set.skip = !!patch.skip
  const have = await getReport(db, companyId, jobId)
  if (have) {
    const [row] = await db.update(visitReport).set(set).where(eq(visitReport.id, have.id)).returning()
    return row
  }
  const [row] = await db.insert(visitReport).values({ companyId, jobId, contactId: j.contactId ?? null, ...set }).onConflictDoNothing().returning()
  return row ?? (await getReport(db, companyId, jobId))
}

export interface VisitWords { companyName: string; firstName: string; title: string; day: string; note: string | null; photos: number }

/** What the customer reads. The text is short; the email is the same words with the pictures under them. */
export function visitMessage(w: VisitWords): { text: string; subject: string } {
  const note = w.note ? ` ${w.note}` : ''
  const pics = w.photos ? ` ${w.photos === 1 ? 'A photo is' : `${w.photos} photos are`} attached.` : ''
  return {
    text: `Hi ${w.firstName}, ${w.companyName} finished ${w.title} on ${w.day}.${note}${pics}`.replace(/\s+/g, ' ').trim(),
    subject: `${w.title} is done — ${w.companyName}`,
  }
}

export function visitEmailHtml(w: VisitWords, pictureUrls: string[], kinds: Array<'before' | 'after'> = [], extra: { intro?: string | null; feedbackLink?: string | null } = {}): string {
  const label = (i: number) => (kinds[i] === 'before' ? 'Before' : 'After')
  const imgs = pictureUrls.map((u, i) => `${kinds.length ? `<p style="margin:12px 0 4px;font-weight:bold">${label(i)}</p>` : ''}<p style="margin-top:0"><img src="${esc(u)}" alt="${label(i)} photo" style="max-width:100%;border-radius:8px"></p>`).join('')
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 8px">${esc(w.title)} is done</h2>
${extra.intro ? extra.intro.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('') : `<p>Hi ${esc(w.firstName)}, ${esc(w.companyName)} finished this visit on ${esc(w.day)}.</p>`}
${w.note ? `<p style="background:#f3f4f6;border-radius:8px;padding:12px">${esc(w.note).replace(/\n/g, '<br>')}</p>` : ''}
${imgs}
${extra.feedbackLink ? `<p style="margin:20px 0 6px;font-weight:bold">How did we do?</p><p>${[1, 2, 3, 4, 5].map((n) => `<a href="${esc(extra.feedbackLink as string)}?r=${n}" style="display:inline-block;margin-right:6px;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;color:#111827;text-decoration:none">${n} ★</a>`).join('')}</p>` : ''}
<p style="color:#6b7280;font-size:13px">Sent by ${esc(w.companyName)}. Reply to this email if anything is not right.</p></div>`
}

// ---- Row 26: the business's own words ----

/** The words the business can put in its message, each filled from the visit. */
export const PLACEHOLDERS = ['first_name', 'company_name', 'job', 'day', 'note', 'photos', 'feedback_link'] as const
/** The built-in wording, as templates (the same words visitMessage writes). */
export const DEFAULT_TEMPLATES = {
  text: 'Hi {first_name}, {company_name} finished {job} on {day}. {note} {photos}',
  subject: '{job} is done — {company_name}',
  email: 'Hi {first_name}, {company_name} finished this visit on {day}.',
}
export const TEMPLATE_LIMITS = { text: 600, subject: 150, email: 2000 }
const MAX_SKIP_SERVICES = 50

export interface VisitSettings { text: string; subject: string; email: string; custom: { text: boolean; subject: boolean; email: boolean }; skipServices: string[]; alertBelow: number }

export async function getVisitSettings(db: any, companyId: string): Promise<VisitSettings> {
  const [r] = await db.select().from(landscapingSetting).where(eq(landscapingSetting.companyId, companyId)).limit(1)
  return {
    text: r?.visitText || DEFAULT_TEMPLATES.text, subject: r?.visitEmailSubject || DEFAULT_TEMPLATES.subject, email: r?.visitEmailBody || DEFAULT_TEMPLATES.email,
    custom: { text: !!r?.visitText, subject: !!r?.visitEmailSubject, email: !!r?.visitEmailBody },
    skipServices: Array.isArray(r?.visitSkipServices) ? r.visitSkipServices.map(String) : [],
    alertBelow: Number(r?.visitAlertBelow ?? 3),
  }
}

/** A template checked: within its length, and naming only the placeholders there are. A problem names the box. */
export function templateProblem(which: 'text' | 'subject' | 'email', tpl: string): string | null {
  if (tpl.length > TEMPLATE_LIMITS[which]) return `Keep it under ${TEMPLATE_LIMITS[which]} characters.`
  for (const m of tpl.matchAll(/\{([^{}]*)\}/g)) {
    if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) return `{${m[1]}} is not one of the words we can fill in (${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}).`
  }
  return null
}

/** The office's settings saved. A template left empty (or null) goes back to the built-in words. */
export async function saveVisitSettings(db: any, companyId: string, patch: { text?: string | null; subject?: string | null; email?: string | null; skipServices?: string[]; alertBelow?: number }) {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  const tpl = (v: string | null | undefined) => (v == null || !String(v).trim() ? null : String(v).trim())
  if (patch.text !== undefined) set.visitText = tpl(patch.text)
  if (patch.subject !== undefined) set.visitEmailSubject = tpl(patch.subject)
  if (patch.email !== undefined) set.visitEmailBody = tpl(patch.email)
  if (patch.skipServices !== undefined) set.visitSkipServices = [...new Set(patch.skipServices.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_SKIP_SERVICES)
  if (patch.alertBelow !== undefined) set.visitAlertBelow = patch.alertBelow
  await db.insert(landscapingSetting).values({ companyId, ...set }).onConflictDoUpdate({ target: landscapingSetting.companyId, set })
  return getVisitSettings(db, companyId)
}

/** A template filled from the visit. A placeholder with nothing to say is left out; spaces are tidied. */
export function fillTemplate(tpl: string, w: VisitWords, feedbackLink: string | null, oneLine = true): string {
  const photos = w.photos ? `${w.photos === 1 ? 'A photo is' : `${w.photos} photos are`} attached.` : ''
  const values: Record<string, string> = {
    first_name: w.firstName, company_name: w.companyName, job: w.title, day: w.day, note: w.note ?? '', photos, feedback_link: feedbackLink ?? '',
  }
  const out = tpl.replace(/\{([a-z_]+)\}/g, (all, k) => (k in values ? values[k] : all))
  return oneLine ? out.replace(/\s+/g, ' ').trim() : out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** Why this visit's service is never messaged (a stop marked so, or its service on the office's list), or null. */
export async function serviceSkip(db: any, companyId: string, j: { recurringRouteStopId?: string | null }, skipServices: string[]): Promise<string | null> {
  if (!j.recurringRouteStopId) return null
  const [stop] = await db.select({ skip: recurringRouteStop.skipVisitMessage, serviceType: recurringRouteStop.serviceType }).from(recurringRouteStop)
    .where(and(eq(recurringRouteStop.id, j.recurringRouteStopId), eq(recurringRouteStop.companyId, companyId))).limit(1)
  if (!stop) return null
  if (stop.skip) return 'This route stop is marked "no visit-done message".'
  if (skipServices.includes(String(stop.serviceType || '').trim().toLowerCase())) return `${stop.serviceType} visits are not messaged (Settings on the Visit messages screen).`
  return null
}

/** Change a route stop's "no visit-done message" mark. */
export async function setStopSkip(db: any, companyId: string, stopId: string, skip: boolean) {
  const [row] = await db.update(recurringRouteStop).set({ skipVisitMessage: skip }).where(and(eq(recurringRouteStop.id, stopId), eq(recurringRouteStop.companyId, companyId))).returning({ id: recurringRouteStop.id, skip: recurringRouteStop.skipVisitMessage })
  return row ?? null
}

// ---- Row 31: the feedback link ----

const FEEDBACK_PURPOSE = 'visit_feedback'
/** A feedback link works this long (Jobber's survey has no stated end; two months covers a slow reply). */
export const FEEDBACK_DAYS = 60
const feedbackSig = (body: string) => crypto.createHmac('sha256', `${process.env.JWT_SECRET || ''}:${FEEDBACK_PURPOSE}`).update(body).digest('base64url')

/** The token of one visit's feedback link: the report and until when, signed with the server's secret. */
export function feedbackToken(companyId: string, reportId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ c: companyId, r: reportId, e: Math.floor(now / 1000) + FEEDBACK_DAYS * 86_400 })).toString('base64url')
  return `${body}.${feedbackSig(body)}`
}

/** The report a feedback token names, or null (tampered, run out, another kind of token, or no secret set). */
export function readFeedbackToken(token: unknown, now = Date.now()): { companyId: string; reportId: string } | null {
  if (typeof token !== 'string' || !process.env.JWT_SECRET) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const want = Buffer.from(feedbackSig(body)), got = Buffer.from(sig)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof v?.c !== 'string' || typeof v?.r !== 'string' || typeof v?.e !== 'number' || v.e * 1000 < now) return null
    return { companyId: v.c, reportId: v.r }
  } catch { return null }
}

export const feedbackPath = (token: string) => `/api/visit-feedback/${token}`

/** What the feedback page shows: the visit, the business, and any rating already given. */
export async function feedbackView(db: any, companyId: string, reportId: string) {
  const [x] = await db.select({ r: visitReport, title: job.title, companyName: company.name })
    .from(visitReport).innerJoin(job, eq(visitReport.jobId, job.id)).innerJoin(company, eq(visitReport.companyId, company.id))
    .where(and(eq(visitReport.id, reportId), eq(visitReport.companyId, companyId))).limit(1)
  if (!x) return null
  return { reportId: x.r.id, jobId: x.r.jobId, title: String(x.title || 'your visit'), companyName: String(x.companyName || ''), rating: (x.r.rating ?? null) as number | null, comment: (x.r.ratingComment ?? null) as string | null, ratedAt: x.r.ratedAt ?? null }
}

export const MAX_COMMENT = 1000

/**
 * The customer's rating kept (once: a second answer is refused, the first stands). A rating under the office's line emails the
 * office people (admins and owners) — `sendEmail` is the email service's sendRaw.
 */
export async function rateVisit(db: any, companyId: string, reportId: string, rating: number, comment: string | null, sendEmail?: SendDeps['sendEmail']) {
  const view = await feedbackView(db, companyId, reportId)
  if (!view) return { status: 'missing' as const }
  if (view.rating != null) return { status: 'already' as const, view }
  const text = comment ? String(comment).trim().slice(0, MAX_COMMENT) || null : null
  const [row] = await db.update(visitReport).set({ rating, ratingComment: text, ratedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(visitReport.id, reportId), eq(visitReport.companyId, companyId), isNull(visitReport.rating))).returning()
  if (!row) return { status: 'already' as const, view: (await feedbackView(db, companyId, reportId))! }
  const { alertBelow } = await getVisitSettings(db, companyId)
  let alerted = 0
  if (rating < alertBelow && sendEmail) {
    const [x] = await db.select({ customer: contact.name }).from(visitReport).leftJoin(contact, eq(visitReport.contactId, contact.id)).where(eq(visitReport.id, reportId)).limit(1)
    const who = String(x?.customer || 'A customer')
    for (const to of await officeEmails(db, companyId)) {
      try {
        await sendEmail({ to, subject: `${who} rated a visit ${rating} of 5`, html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#111827"><p>${esc(who)} rated <b>${esc(view.title)}</b> ${rating} of 5.</p>${text ? `<p style="background:#f3f4f6;border-radius:8px;padding:12px">${esc(text).replace(/\n/g, '<br>')}</p>` : '<p>They left no comment.</p>'}<p style="color:#6b7280;font-size:13px">Open Visit messages in the CRM to see it beside what they were sent.</p></div>` })
        alerted++
      } catch { /* one address failing never loses the rating */ }
    }
  }
  return { status: 'rated' as const, view: { ...view, rating, comment: text, ratedAt: row.ratedAt }, low: rating < alertBelow, alerted }
}

export interface SendDeps {
  /** A link to a stored picture that opens for a while with no sign-in (crm/comms/smsMedia.ts pictureToken). */
  pictureUrl: (storageKey: string, seconds: number) => string | null
  /** Row 31: the customer's feedback link for one report (the app's address in front), or null where there is no public address. */
  feedbackUrl?: (companyId: string, reportId: string) => string | null
  /** The email service's sendRaw. */
  sendEmail: (m: { to: string; subject: string; html: string }) => Promise<unknown>
}

export type ReportOutcome =
  | { status: 'sent' | 'queued'; channel: 'text' | 'email'; photos: number; sendAt: Date | null }
  | { status: 'skipped' | 'nothing' | 'failed' | 'already' | 'not_done'; reason: string }

const EMAIL_PICTURE_SECONDS = 14 * 86_400

/** How this module reaches the outside: a picture link a mail client can open with no sign-in, and the email sender (sendRaw). */
export function visitSendDeps(sendEmail: SendDeps['sendEmail']): SendDeps {
  return {
    pictureUrl: (key, seconds) => {
      const base = publicApiBase()
      return /^https?:\/\//.test(base) ? `${base}/api/sms-media/file/${pictureToken(key, seconds)}` : null
    },
    feedbackUrl: (companyId, reportId) => {
      const base = publicApiBase()
      return /^https?:\/\//.test(base) && process.env.JWT_SECRET ? `${base}${feedbackPath(feedbackToken(companyId, reportId))}` : null
    },
    sendEmail,
  }
}

/**
 * Send the report for a finished job. `force` is the office pressing "Send now": it ignores "don't message" being set only if the
 * office clears it first (it does not), but it does send again after a failure and for a visit already sent (a deliberate resend).
 */
export async function sendVisitReport(db: any, deps: SendDeps, companyId: string, jobId: string, opts: { force?: boolean; now?: Date; tools?: boolean; survey?: boolean } = {}): Promise<ReportOutcome> {
  const now = opts.now ?? new Date()
  const [j] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j) return { status: 'failed', reason: 'Job not found' }
  if (j.status !== 'completed') return { status: 'not_done', reason: 'The visit is not finished yet.' }
  const report = (await saveReport(db, companyId, jobId, {}))!
  if (report.skip) return { status: 'skipped', reason: 'This visit is marked "do not message the customer".' }
  if (!opts.force && (report.status === 'sent' || report.status === 'queued')) return { status: 'already', reason: 'The customer was already told.' }
  // Row 26 (visit_message_tools): the business's own words, and the services it never messages.
  const vs = opts.tools ? await getVisitSettings(db, companyId) : null
  if (vs) {
    const why = await serviceSkip(db, companyId, j, vs.skipServices)
    if (why) {
      await db.update(visitReport).set({ status: 'skipped', error: null, updatedAt: new Date() }).where(eq(visitReport.id, report.id))
      return { status: 'skipped', reason: why }
    }
  }
  const [ct] = j.contactId ? await db.select().from(contact).where(and(eq(contact.id, j.contactId), eq(contact.companyId, companyId))).limit(1) : []
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const tz = await companyTimeZone(db, companyId)

  const settle = async (status: string, extra: Record<string, unknown>) => {
    await db.update(visitReport).set({ status, contactId: ct?.id ?? null, updatedAt: new Date(), ...extra }).where(eq(visitReport.id, report.id))
  }
  const phone = String(ct?.mobile || ct?.phone || '').trim()
  const canText = !!ct && !!phone && !ct.optedOutSms
  const canEmail = !!ct && !!String(ct.email || '').trim() && !ct.emailOptOut
  if (!canText && !canEmail) {
    await settle('nothing', { channel: null, error: null })
    return { status: 'nothing', reason: !ct ? 'The visit has no customer.' : 'No way to reach this customer: no phone or email, or they opted out.' }
  }

  const photos = messagePhotos(await visitPhotos(db, companyId, jobId))
  const day = new Date(j.completedAt ?? now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })
  const words: VisitWords = { companyName: co?.name || 'We', firstName: first(ct.name), title: String(j.title || 'your visit'), day, note: report.note ?? null, photos: photos.length }
  // Row 31 (visit_survey): the message carries the feedback link (put where {feedback_link} is, or at the end).
  const link = opts.survey && deps.feedbackUrl ? deps.feedbackUrl(companyId, report.id) : null
  const msg = vs ? { text: fillTemplate(vs.text, words, link), subject: fillTemplate(vs.subject, words, null) } : visitMessage(words)
  if (link && !(vs?.text || '').includes('{feedback_link}')) msg.text = `${msg.text} How did we do? ${link}`
  const intro = vs ? fillTemplate(vs.email, words, link, false) : null
  const copy = { messageSubject: msg.subject, messageText: msg.text }

  if (canText) {
    const sendAt = textTime(now, tz)
    await db.insert(scheduledText).values({
      companyId, contactId: ct.id, toPhone: phone, body: msg.text, media: photos.length ? photos.map((p) => p.key) : null, sendAt,
    })
    await settle('queued', { channel: 'text', photoCount: photos.length, sendAt, sentAt: null, error: null, ...copy })
    return { status: 'queued', channel: 'text', photos: photos.length, sendAt }
  }
  try {
    // The email has room for every photo, before and after, each labelled.
    const pics = (await visitPhotos(db, companyId, jobId)).map((p) => ({ url: deps.pictureUrl(p.key, EMAIL_PICTURE_SECONDS), kind: p.kind })).filter((p): p is { url: string; kind: 'before' | 'after' } => !!p.url)
    const urls = pics.map((p) => p.url)
    await deps.sendEmail({ to: String(ct.email).trim(), subject: msg.subject, html: visitEmailHtml({ ...words, photos: urls.length }, urls, pics.map((p) => p.kind), { intro, feedbackLink: link }) })
    await settle('sent', { channel: 'email', photoCount: urls.length, sendAt: now, sentAt: now, error: null, messageSubject: msg.subject, messageText: [intro ?? `Hi ${words.firstName}, ${words.companyName} finished this visit on ${words.day}.`, words.note].filter(Boolean).join('\n\n') })
    return { status: 'sent', channel: 'email', photos: urls.length, sendAt: now }
  } catch (err: any) {
    await settle('failed', { channel: 'email', error: String(err?.message || 'The email could not be sent').slice(0, 300) })
    return { status: 'failed', reason: 'The email could not be sent.' }
  }
}

/**
 * Row 26: what the customer would get for this visit now — the channel, who, and the words — without sending anything (Yardbook's
 * preview). Null when the job is not this company's.
 */
export async function previewVisitReport(db: any, companyId: string, jobId: string, opts: { tools?: boolean; survey?: boolean } = {}) {
  const [j] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j) return null
  const report = await getReport(db, companyId, jobId)
  const [ct] = j.contactId ? await db.select().from(contact).where(and(eq(contact.id, j.contactId), eq(contact.companyId, companyId))).limit(1) : []
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const tz = await companyTimeZone(db, companyId)
  const vs = opts.tools ? await getVisitSettings(db, companyId) : null
  const skip = report?.skip ? 'This visit is marked "do not message the customer".' : vs ? await serviceSkip(db, companyId, j, vs.skipServices) : null
  const phone = String(ct?.mobile || ct?.phone || '').trim()
  const channel: 'text' | 'email' | null = ct && phone && !ct.optedOutSms ? 'text' : ct && String(ct.email || '').trim() && !ct.emailOptOut ? 'email' : null
  const all = await visitPhotos(db, companyId, jobId)
  const photos = channel === 'text' ? messagePhotos(all).length : all.length
  const day = new Date(j.completedAt ?? new Date()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })
  const words: VisitWords = { companyName: co?.name || 'We', firstName: first(ct?.name), title: String(j.title || 'your visit'), day, note: report?.note ?? null, photos }
  const link = opts.survey ? '(the feedback link)' : null
  let text = vs ? fillTemplate(vs.text, words, link) : visitMessage(words).text
  if (link && !(vs?.text || '').includes('{feedback_link}')) text = `${text} How did we do? ${link}`
  return {
    channel, to: channel === 'text' ? phone : channel === 'email' ? String(ct.email).trim() : null, skip, photos,
    subject: vs ? fillTemplate(vs.subject, words, null) : visitMessage(words).subject,
    text, email: vs ? fillTemplate(vs.email, words, link, false) : `Hi ${words.firstName}, ${words.companyName} finished this visit on ${day}.`, note: words.note,
  }
}

/** The recent reports, newest first, with the job and customer they are about. */
export async function recentReports(db: any, companyId: string, opts: { limit?: number; jobIds?: string[] } = {}) {
  const where = [eq(visitReport.companyId, companyId)]
  if (opts.jobIds) where.push(inArray(visitReport.jobId, opts.jobIds.length ? opts.jobIds : ['']))
  const rows: any[] = await db.select({ r: visitReport, title: job.title, number: job.number, completedAt: job.completedAt, customer: contact.name, assignedToId: job.assignedToId })
    .from(visitReport).innerJoin(job, eq(visitReport.jobId, job.id)).leftJoin(contact, eq(visitReport.contactId, contact.id))
    .where(and(...where)).orderBy(desc(visitReport.updatedAt)).limit(Math.min(opts.limit ?? 100, 200))
  return rows.map((x) => ({ ...x.r, title: x.title, number: x.number, completedAt: x.completedAt, customer: x.customer, assignedToId: x.assignedToId }))
}

/** What a customer sees in the portal: their finished visits that have a report, with the note and after-photos. */
export async function visitsForCustomer(db: any, companyId: string, contactId: string, pictureUrl: (key: string, seconds: number) => string | null, limit = 50) {
  const rows: any[] = await db.select({ r: visitReport, title: job.title, completedAt: job.completedAt, jobId: job.id })
    .from(visitReport).innerJoin(job, eq(visitReport.jobId, job.id))
    .where(and(eq(visitReport.companyId, companyId), eq(job.contactId, contactId), eq(job.status, 'completed'), eq(visitReport.skip, false)))
    .orderBy(desc(job.completedAt)).limit(limit)
  const out = []
  for (const x of rows) {
    const photos = await visitPhotos(db, companyId, x.jobId)
    // A visit with neither a note nor a photo has nothing to show.
    if (!x.r.note && !photos.length) continue
    out.push({
      jobId: x.jobId, title: x.title, completedAt: x.completedAt, note: x.r.note ?? null,
      photos: photos.map((p) => ({ id: p.id, caption: p.caption, kind: p.kind, url: pictureUrl(p.key, 3600) })).filter((p) => !!p.url),
    })
  }
  return out
}
