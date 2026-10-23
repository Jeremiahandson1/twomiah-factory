// Photos kept ON a site record — a daily log's day, a punch-list item's snag — in the record's own `photos` column.
//
// Live test 2026-10-22 (contractor): "Daily logs: no photo field". `daily_log.photos` and `punch_list_item.photos` have
// been columns since the template, and nothing ever wrote either: the forms had no field and each route's schema dropped
// one. One rule for both, here:
//   POST   <base>/:id/photos                 (write permission)  multipart `photo` (+ optional `caption`)
//   GET    <base>/:id/photos/:photoId/file   (read permission)   the picture, never cached by the browser
//   DELETE <base>/:id/photos/:photoId        (write permission)
// A photo is re-encoded (JPEG, turned the right way up, its metadata — location included — dropped) and kept in the file
// store under the company. The record holds the list; each entry is given its `url` when the record is sent.
import type { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import sharp from 'sharp'
import { eq, and } from 'drizzle-orm'
import type { CrmDeps } from '../deps.ts'
import { fail, one } from '../../http/reply.ts'
import { uploadedForm } from '../office/upload.ts'

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024
export const MAX_PHOTOS = 30

export interface RecordPhoto { id: string; name: string; caption: string | null; path: string; size: number; uploadedAt: string; uploadedById: string }

const photosOf = (row: any): RecordPhoto[] =>
  (Array.isArray(row?.photos) ? row.photos : []).filter((p: any) => p && typeof p.id === 'string' && typeof p.path === 'string')

export function recordPhotos(d: CrmDeps, o: {
  /** The Drizzle table: it has id, companyId, photos and updatedAt. */
  table: any
  /** Where the routes are mounted, for the urls handed back (e.g. '/api/daily-logs'). */
  base: string
  /** The store folder under the company (e.g. 'daily-logs'). */
  folder: string
  read: string
  write: string
  /** A refusal when the record can no longer be changed (the daily log's edit window); null when it can. */
  editable?: (c: any, row: any) => Promise<Response | null>
  /** What a missing record is called in the 404 ('Daily log not found'). */
  notFound: string
}) {
  const { db } = d
  const { requirePermission } = d.permissions
  const t = o.table

  /** The record as sent: each photo with the address its file is served at. */
  const withUrls = (row: any) => row ? ({ ...row, photos: photosOf(row).map((p) => ({ ...p, url: `${o.base}/${row.id}/photos/${p.id}/file` })) }) : row

  const own = async (c: any) => {
    const me = c.get('user') as any
    const [row] = await db.select().from(t).where(and(eq(t.id, c.req.param('id')), eq(t.companyId, me.companyId))).limit(1)
    return row || null
  }

  function routes(app: Hono<AppEnv>) {
    app.post('/:id/photos', requirePermission(o.write), async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const form = await uploadedForm(c)
      const file = form.get('photo') as File | null
      if (!file || typeof file === 'string') return fail(c, 400, 'No photo was attached.')
      if (file.size > MAX_PHOTO_BYTES) return fail(c, 400, `A photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`)
      const existing = photosOf(row)
      if (existing.length >= MAX_PHOTOS) return fail(c, 400, `This holds up to ${MAX_PHOTOS} photos.`)
      const storage = d.services.storage
      if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
      let jpeg: Buffer
      try {
        jpeg = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      } catch {
        return fail(c, 400, 'That file is not a photo we can read. Use a JPEG, PNG, WebP, GIF or HEIC picture.')
      }
      const id = crypto.randomUUID()
      const path = `${me.companyId}/${o.folder}/${row.id}/${id}.jpg`
      await storage.put(path, jpeg, 'image/jpeg')
      const caption = String(form.get('caption') || '').trim().slice(0, 300) || null
      const photo: RecordPhoto = { id, name: String(file.name || 'photo.jpg').slice(0, 200), caption, path, size: jpeg.length, uploadedAt: new Date().toISOString(), uploadedById: me.userId }
      const [updated] = await db.update(t).set({ photos: [...existing, photo], updatedAt: new Date() })
        .where(and(eq(t.id, row.id), eq(t.companyId, me.companyId))).returning()
      return one(c, withUrls(updated), 201)
    })

    app.get('/:id/photos/:photoId/file', requirePermission(o.read), async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      const photo = row && photosOf(row).find((p) => p.id === c.req.param('photoId'))
      if (!photo || !photo.path.startsWith(`${me.companyId}/`)) return fail(c, 404, 'Photo not found')
      const obj = await d.services.storage.getObject(photo.path)
      if (!obj) return fail(c, 404, 'Photo not found')
      // No-store, as the document and photo routes: a site photo is not kept in the browser after sign-out (T32 M12).
      return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', Pragma: 'no-cache' } })
    })

    app.delete('/:id/photos/:photoId', requirePermission(o.write), async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const photos = photosOf(row)
      const gone = photos.find((p) => p.id === c.req.param('photoId'))
      if (!gone) return fail(c, 404, 'Photo not found')
      const [updated] = await db.update(t).set({ photos: photos.filter((p) => p.id !== gone.id), updatedAt: new Date() })
        .where(and(eq(t.id, row.id), eq(t.companyId, me.companyId))).returning()
      try { await d.services.storage.deleteFile(gone.path) } catch { /* the record's list is what counts */ }
      return one(c, withUrls(updated))
    })
  }

  /** A deleted record's photo files, best-effort: the row is gone, so nothing points at them any more. */
  const removeFiles = (row: any) => { for (const p of photosOf(row)) { try { d.services.storage.deleteFile(p.path) } catch { /* nothing to undo */ } } }

  return { routes, withUrls, removeFiles }
}
