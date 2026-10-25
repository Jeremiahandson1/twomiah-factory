// Picture messages (MMS) in two-way texting: a picture from the customer's jobs (their job photos and the photo library)
// or one uploaded from the computer, sent through the same sender as every text (packages/tenant-backend
// integrations/sms.ts — the contact's opt-out and the usage wallet hold exactly as they do for words).
//
// The pictures stay in the business's PRIVATE store. The carrier is handed a short-lived signed link to each one
// (links.providerUrl, an hour: Twilio fetches it while it sends), and the inbox shows them by another (links.viewUrl,
// fifteen minutes, minted each time the thread is read). A link names one file and when it stops working, signed with
// the tenant's own secret; it opens nothing else and is refused once it has run out.
//
//   GET  /api/sms-media/file/:token     the picture, by its signed link (no sign-in: the carrier has none)
//   POST /api/sms-media/upload          a picture from the computer, kept for a text               sms:send
//   GET  /api/sms-media/library         the pictures on a customer's jobs (?contactId=)            sms:send + jobs:read
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { publicApiBase, sniffType } from '@twomiah/tenant-backend'
import { job, jobPhoto, document } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const SMS_MEDIA_PATH = '/api/sms-media'
/** The carrier's link lasts an hour (it fetches while sending, and retries); the inbox's a quarter of one. */
const PROVIDER_SECONDS = 60 * 60
const VIEW_SECONDS = 15 * 60
/** The carriers' ceiling for one picture. */
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024
const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const PICTURE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

/** The signing key: the tenant's own secret, kept apart from the sign-in tokens it also signs. */
const key = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('sms-media-link').digest()
const sign = (k: string, exp: number) => crypto.createHmac('sha256', key()).update(`${k}|${exp}`).digest('base64url')

/** A link to one stored picture until `seconds` from now. */
export function pictureToken(storageKey: string, seconds: number, now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + seconds
  return `${b64(storageKey)}.${exp}.${sign(storageKey, exp)}`
}

/** The stored picture a link names, while it is good — else null (forged, altered or run out). */
export function pictureKeyOf(token: string, now: number = Date.now()): string | null {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || !/^\d+$/.test(parts[1])) return null
  let k: string
  try { k = unb64(parts[0]) } catch { return null }
  const exp = Number(parts[1])
  const want = Buffer.from(sign(k, exp))
  const got = Buffer.from(parts[2])
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  return exp * 1000 > now ? k : null
}

/** Is this stored file this company's? Job photos live under photos/<company>/, everything else under <company>/. */
export const isCompanyFile = (companyId: string, k: string) =>
  typeof k === 'string' && !k.includes('..') && (k.startsWith(`${companyId}/`) || k.startsWith(`photos/${companyId}/`))

/** What the sender is handed (integrations/sms.ts SmsServiceDeps.media). */
export const smsMediaLinks = {
  allowed: isCompanyFile,
  providerUrl: (k: string) => {
    const base = publicApiBase()
    return /^https?:\/\//.test(base) ? `${base}${SMS_MEDIA_PATH}/file/${pictureToken(k, PROVIDER_SECONDS)}` : null
  },
  viewUrl: (k: string) => `${SMS_MEDIA_PATH}/file/${pictureToken(k, VIEW_SECONDS)}`,
}

/** The stored key of a job photo, from the address it is kept by ('/media/photos/<company>/<job>/<x>.jpg'). */
const jobPhotoKey = (url: string) => (String(url || '').startsWith('/media/') ? String(url).slice('/media/'.length) : null)

export function createSmsMediaRoutes(d: CrmDeps) {
  const { db } = d
  const storage = d.services.storage as any
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // The carrier's (and the inbox's) door: the signed link is the only key.
  app.get('/file/:token', async (c) => {
    const k = pictureKeyOf(c.req.param('token'))
    if (!k) return fail(c, 404, 'This picture link has run out.', 'link_expired')
    const obj = await storage.getObject(k).catch(() => null)
    if (!obj || !String(obj.contentType || '').startsWith('image/')) return fail(c, 404, 'Picture not found')
    return new Response(obj.body, { headers: { 'Content-Type': obj.contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' } })
  })

  // Everything else is the business's: signed in, with Two-Way Texting on.
  app.use('*', d.authenticate)
  app.use('*', d.features.requireEnabledFeature('two_way_texting'))

  app.post('/upload', requirePermission('sms:send'), async (c) => {
    const cid = c.get('user').companyId
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'File storage is not set up yet.', 'storage_not_configured')
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return fail(c, 400, 'Choose a picture to send.')
    if (!PICTURE_TYPES.includes(String(file.type).split(';')[0].toLowerCase())) return fail(c, 400, 'A picture message carries a JPEG, PNG or GIF.')
    if (file.size > MAX_PICTURE_BYTES) return fail(c, 400, 'That picture is over 5 MB — the most a text can carry.')
    // Trust the bytes, not the declared type (the job photos' rule): a renamed page is never kept as a picture.
    const buffer = Buffer.from(await file.arrayBuffer())
    const type = sniffType(buffer)
    if (!type || !PICTURE_TYPES.includes(type)) return fail(c, 400, 'That file is not a JPEG, PNG or GIF picture.')
    const k = `${cid}/sms/${crypto.randomUUID()}.${PICTURE_EXT[type]}`
    await storage.put(k, buffer, type)
    return one(c, { key: k, url: smsMediaLinks.viewUrl(k), name: file.name || 'picture' }, 201)
  })

  // The pictures on the customer's jobs, newest first: job photos and the photo library's pictures filed on those jobs.
  app.get('/library', requirePermission('sms:send'), requirePermission('jobs:read'), async (c) => {
    const cid = c.get('user').companyId
    const contactId = c.req.query('contactId')
    const jobs = await db.select({ id: job.id, title: job.title, number: job.number }).from(job)
      .where(contactId ? and(eq(job.companyId, cid), eq(job.contactId, contactId)) : eq(job.companyId, cid)).orderBy(desc(job.createdAt)).limit(contactId ? 200 : 25)
    if (!jobs.length) return listAll(c, [])
    const ids = jobs.map((j: any) => j.id)
    const name = (id: string) => { const j = jobs.find((x: any) => x.id === id); return j ? `${j.number} — ${j.title}` : '' }
    const [photos, library] = await Promise.all([
      db.select().from(jobPhoto).where(and(eq(jobPhoto.companyId, cid), inArray(jobPhoto.jobId, ids))).orderBy(desc(jobPhoto.createdAt)).limit(60),
      db.select().from(document).where(and(eq(document.companyId, cid), inArray(document.jobId, ids), eq(document.mimeType, 'image/jpeg'))).orderBy(desc(document.createdAt)).limit(60),
    ])
    const rows = [
      ...photos.map((p: any) => ({ key: jobPhotoKey(p.url), caption: p.caption || null, job: name(p.jobId), at: p.createdAt })),
      ...library.map((p: any) => ({ key: p.path, caption: p.description || p.name || null, job: name(p.jobId), at: p.createdAt })),
    ].filter((r) => r.key && isCompanyFile(cid, r.key))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .map((r) => ({ ...r, url: smsMediaLinks.viewUrl(r.key as string) }))
    return listAll(c, rows)
  })

  return app
}
