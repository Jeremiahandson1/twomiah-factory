// Drawing on a job's photos (docs/parity/roof-gbb-proposals.md #4, roof-inspection-report.md #13), behind `photo_markup`
// (not ready), at /api/photo-markup:
//
//   PUT /:photoId   { shapes }   draw on a photo: arrows, circles and text (shapes in fractions of the picture, ./shapes.ts).
//                                The server lays them over the picture and keeps the result as a MARKED COPY beside the
//                                original, a photo of its own on the job (so a proposal option or an inspection report picks
//                                it like any photo). Saving again redraws the same copy; saving no shapes removes it.   jobs:update
//
// The original is never changed. The call is safe to send twice (the phone's queue may), because it names the final drawing
// rather than adding to one. Naming a marked copy draws on the photo it was made from.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { jobPhoto } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createSeatJob } from '../seatJob.ts'
import { renderMarked } from './render.ts'
import { markupBody } from './shapes.ts'

const MEDIA_PREFIX = '/media/'
const keyOf = (url: unknown) => (String(url || '').startsWith(MEDIA_PREFIX) && !String(url).includes('..') ? String(url).slice(MEDIA_PREFIX.length) : '')

export function createPhotoMarkupRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const storage = d.services.storage as any
  const jobFor = createSeatJob(d)

  const photoRow = async (companyId: string, id: string) =>
    (await db.select().from(jobPhoto).where(and(eq(jobPhoto.id, id), eq(jobPhoto.companyId, companyId))).limit(1))[0]
  const copyOf = async (companyId: string, sourceId: string) =>
    (await db.select().from(jobPhoto).where(and(eq(jobPhoto.sourcePhotoId, sourceId), eq(jobPhoto.companyId, companyId))).limit(1))[0]

  app.put('/:photoId', requirePermission('jobs:update'), async (c) => {
    const me = c.get('user')
    const parsed = markupBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    let photo = await photoRow(me.companyId, c.req.param('photoId'))
    if (photo?.sourcePhotoId) photo = await photoRow(me.companyId, photo.sourcePhotoId)
    if (!photo || !(await jobFor(c, photo.jobId))) return fail(c, 404, 'Photo not found')
    const existing = await copyOf(me.companyId, photo.id)

    // No marks: the copy goes (the original stays).
    if (!parsed.data.shapes.length) {
      if (existing) {
        const key = keyOf(existing.url)
        if (key) { try { await storage.deleteFile(key) } catch { /* the row is the source of truth */ } }
        await db.delete(jobPhoto).where(and(eq(jobPhoto.id, existing.id), eq(jobPhoto.companyId, me.companyId)))
      }
      return one(c, { original: photo.id, marked: null })
    }

    const key = keyOf(photo.url)
    if (!key) return fail(c, 400, 'That photo is stored somewhere the marks cannot be drawn on.', 'validation_failed', { photoId: 'Not a stored photo' })
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
    let bytes: Buffer
    try {
      const obj = await storage.getObject(key)
      if (!obj || !/^image\/(jpeg|png|webp|gif)$/.test(String(obj.contentType || ''))) return fail(c, 404, 'Photo not found')
      bytes = Buffer.from(obj.body)
    } catch { return fail(c, 404, 'Photo not found') }
    let picture
    try { picture = await renderMarked(bytes, parsed.data.shapes) } catch { return fail(c, 400, 'That photo could not be read as a picture.', 'validation_failed', { photoId: 'Not a readable picture' }) }

    // A new file for each drawing (a screen holding the old address is never shown a changed picture), and the old one goes.
    const newKey = `photos/${me.companyId}/${photo.jobId}/${crypto.randomUUID().replace(/-/g, '')}-marked.${picture.ext}`
    await storage.put(newKey, picture.bytes, picture.contentType)
    const fields = { url: MEDIA_PREFIX + newKey, thumbnailUrl: null, markup: parsed.data.shapes as any, caption: photo.caption, photoType: photo.photoType, takenAt: photo.takenAt, latitude: photo.latitude, longitude: photo.longitude }
    let marked = existing
    if (existing) {
      const oldKey = keyOf(existing.url)
      ;[marked] = await db.update(jobPhoto).set(fields as any).where(and(eq(jobPhoto.id, existing.id), eq(jobPhoto.companyId, me.companyId))).returning()
      if (oldKey) { try { await storage.deleteFile(oldKey) } catch { /* an orphaned file is harmless */ } }
    } else {
      try {
        ;[marked] = await db.insert(jobPhoto).values({ ...fields, companyId: me.companyId, jobId: photo.jobId, uploadedById: me.userId, sourcePhotoId: photo.id } as any).returning()
      } catch {
        // Two saves of the same photo met: the one that lost redraws the copy the other made.
        const winner = await copyOf(me.companyId, photo.id)
        if (!winner) throw new Error('The marked copy could not be saved')
        ;[marked] = await db.update(jobPhoto).set(fields as any).where(and(eq(jobPhoto.id, winner.id), eq(jobPhoto.companyId, me.companyId))).returning()
      }
    }
    return one(c, { original: photo.id, marked })
  })

  return app
}
