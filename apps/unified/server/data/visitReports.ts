// The visit-done message (landscaping, feature `visit_reports`): when a visit is finished the customer is told, in the business's
// words, with the crew's note and the after-photos. A text if we can text them (queued for the 8 am – 8 pm window, so a 5 am
// plough does not wake anyone, and sent from the business's own number), otherwise an email; never both. Off for a customer who
// opted out, for a visit the office marked "don't message", and for a business that has not turned the feature on.
// One report per job, ever (a unique index): finishing a job twice, or a replayed request, never messages twice.
// Raw SQL lives here (RULEBOOK §2); nothing here moves money.
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { companyTimeZone, publicApiBase } from '@twomiah/tenant-backend'
import { job, contact, company, jobPhoto, document, visitReport, scheduledText } from '../db/schema/index.ts'
import { textTime } from './routeRainDay.ts'
import { pictureToken } from '../crm/comms/smsMedia.ts'

/** A text carries at most this many pictures (the carriers' practical ceiling for one message). */
export const MAX_REPORT_PHOTOS = 3
export const MAX_NOTE = 1000
export const AFTER = 'after'

const MEDIA_PREFIX = '/media/'
const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
const first = (name: string | null | undefined) => String(name || '').trim().split(/\s+/)[0] || 'there'
const keyOf = (url: string) => (String(url || '').startsWith(MEDIA_PREFIX) ? String(url).slice(MEDIA_PREFIX.length) : null)

/** The job's after-photos, newest last (the order the crew took them): `{ id, key }`, keys in the private store. */
export async function afterPhotos(db: any, companyId: string, jobId: string): Promise<Array<{ id: string; key: string; caption: string | null }>> {
  const rows: any[] = await db.select().from(jobPhoto)
    .where(and(eq(jobPhoto.companyId, companyId), eq(jobPhoto.jobId, jobId), eq(jobPhoto.photoType, AFTER)))
    .orderBy(asc(jobPhoto.createdAt), asc(jobPhoto.id))
  return rows.map((r) => ({ id: r.id, key: keyOf(r.url) as string, caption: r.caption ?? null })).filter((r) => !!r.key)
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

export function visitEmailHtml(w: VisitWords, pictureUrls: string[]): string {
  const imgs = pictureUrls.map((u) => `<p><img src="${esc(u)}" alt="After photo" style="max-width:100%;border-radius:8px"></p>`).join('')
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 8px">${esc(w.title)} is done</h2>
<p>Hi ${esc(w.firstName)}, ${esc(w.companyName)} finished this visit on ${esc(w.day)}.</p>
${w.note ? `<p style="background:#f3f4f6;border-radius:8px;padding:12px">${esc(w.note).replace(/\n/g, '<br>')}</p>` : ''}
${imgs}
<p style="color:#6b7280;font-size:13px">Sent by ${esc(w.companyName)}. Reply to this email if anything is not right.</p></div>`
}

export interface SendDeps {
  /** A link to a stored picture that opens for a while with no sign-in (crm/comms/smsMedia.ts pictureToken). */
  pictureUrl: (storageKey: string, seconds: number) => string | null
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
    sendEmail,
  }
}

/**
 * Send the report for a finished job. `force` is the office pressing "Send now": it ignores "don't message" being set only if the
 * office clears it first (it does not), but it does send again after a failure and for a visit already sent (a deliberate resend).
 */
export async function sendVisitReport(db: any, deps: SendDeps, companyId: string, jobId: string, opts: { force?: boolean; now?: Date } = {}): Promise<ReportOutcome> {
  const now = opts.now ?? new Date()
  const [j] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  if (!j) return { status: 'failed', reason: 'Job not found' }
  if (j.status !== 'completed') return { status: 'not_done', reason: 'The visit is not finished yet.' }
  const report = (await saveReport(db, companyId, jobId, {}))!
  if (report.skip) return { status: 'skipped', reason: 'This visit is marked "do not message the customer".' }
  if (!opts.force && (report.status === 'sent' || report.status === 'queued')) return { status: 'already', reason: 'The customer was already told.' }
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

  const photos = (await afterPhotos(db, companyId, jobId)).slice(0, MAX_REPORT_PHOTOS)
  const day = new Date(j.completedAt ?? now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })
  const words: VisitWords = { companyName: co?.name || 'We', firstName: first(ct.name), title: String(j.title || 'your visit'), day, note: report.note ?? null, photos: photos.length }
  const msg = visitMessage(words)

  if (canText) {
    const sendAt = textTime(now, tz)
    await db.insert(scheduledText).values({
      companyId, contactId: ct.id, toPhone: phone, body: msg.text, media: photos.length ? photos.map((p) => p.key) : null, sendAt,
    })
    await settle('queued', { channel: 'text', photoCount: photos.length, sendAt, sentAt: null, error: null })
    return { status: 'queued', channel: 'text', photos: photos.length, sendAt }
  }
  try {
    const urls = photos.map((p) => deps.pictureUrl(p.key, EMAIL_PICTURE_SECONDS)).filter((u): u is string => !!u)
    await deps.sendEmail({ to: String(ct.email).trim(), subject: msg.subject, html: visitEmailHtml({ ...words, photos: urls.length }, urls) })
    await settle('sent', { channel: 'email', photoCount: urls.length, sendAt: now, sentAt: now, error: null })
    return { status: 'sent', channel: 'email', photos: urls.length, sendAt: now }
  } catch (err: any) {
    await settle('failed', { channel: 'email', error: String(err?.message || 'The email could not be sent').slice(0, 300) })
    return { status: 'failed', reason: 'The email could not be sent.' }
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
    const photos = await afterPhotos(db, companyId, x.jobId)
    // A visit with neither a note nor a photo has nothing to show.
    if (!x.r.note && !photos.length) continue
    out.push({
      jobId: x.jobId, title: x.title, completedAt: x.completedAt, note: x.r.note ?? null,
      photos: photos.map((p) => ({ id: p.id, caption: p.caption, url: pictureUrl(p.key, 3600) })).filter((p) => !!p.url),
    })
  }
  return out
}
