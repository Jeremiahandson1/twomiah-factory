// Photos kept ON a site record — a daily log's day, a punch-list item's snag — in the record's own `photos` column.
//
// Live test 2026-10-22 (contractor): "Daily logs: no photo field". `daily_log.photos` and `punch_list_item.photos` have
// been columns since the template, and nothing ever wrote either: the forms had no field and each route's schema dropped
// one. One rule for both, here:
//   POST   <base>/:id/photos                 (write permission)  multipart `photo` (+ optional `caption`)
//   GET    <base>/:id/photos/:photoId/file   (read permission)   the picture, never cached by the browser
//   DELETE <base>/:id/photos/:photoId        (write permission — or, for a photo you added yourself, the add permission)
// A record may name a separate ADD permission (`add`): the daily log's crew holds daily-logs:create and not :update, and
// a crew photographs the day as it works (Buildertrend's and every pro tool's daily log). They add photos to any log
// they can see; removing SOMEBODY ELSE'S photo stays with the write permission. (Coordinator, 2026-10-23)
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

/**
 * The one photo a form carries, re-encoded as every record's photo is (a JPEG at most 2048 px, turned the right way up,
 * its metadata — location included — dropped), or the refusal to send. Shared by the site records here and a salon
 * visit's before / after photos (crm/salon/visitPhotos.ts; salon live test, 2026-10-25), so a photo is checked and
 * stored by one rule wherever it is kept.
 */
export async function encodedPhoto(c: any, d: CrmDeps, form: FormData): Promise<{ jpeg: Buffer; name: string } | Response> {
  const file = form.get('photo') as File | null
  if (!file || typeof file === 'string') return fail(c, 400, 'No photo was attached.')
  if (file.size > MAX_PHOTO_BYTES) return fail(c, 400, `A photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`)
  const storage = d.services.storage
  if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Photo storage is not set up yet.', 'storage_not_configured')
  try {
    const jpeg = await sharp(Buffer.from(await file.arrayBuffer())).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    return { jpeg, name: String(file.name || 'photo.jpg').slice(0, 200) }
  } catch {
    return fail(c, 400, 'That file is not a photo we can read. Use a JPEG, PNG, WebP, GIF or HEIC picture.')
  }
}

/** A stored photo sent back: no-store, as the document and photo routes — not kept in the browser after sign-out (T32 M12). */
export const photoResponse = (obj: { body: ArrayBuffer }) =>
  new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store, must-revalidate', Pragma: 'no-cache' } })

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
  /** Who may ADD a photo (and remove their own) besides `write`; absent, `write` alone. */
  add?: string
  /** A refusal when the record can no longer be changed (the daily log's edit window); null when it can. */
  editable?: (c: any, row: any) => Promise<Response | null>
  /** What a missing record is called in the 404 ('Daily log not found'). */
  notFound: string
}) {
  const { db } = d
  const { requirePermission, requireAnyPermission } = d.permissions
  const t = o.table
  const mayAdd = o.add ? requireAnyPermission([o.write, o.add]) : requirePermission(o.write)
  /** Does this person hold the write permission (any photo), counting grants — not only the add permission? */
  const writes = async (c: any) => {
    const me = c.get('user') as any
    return d.permissions.hasPermission(me.role, o.write, await d.permissions.getExtraPermissions(me.userId))
  }

  /** The record as sent: each photo with the address its file is served at. */
  const withUrls = (row: any) => row ? ({ ...row, photos: photosOf(row).map((p) => ({ ...p, url: `${o.base}/${row.id}/photos/${p.id}/file` })) }) : row

  const own = async (c: any) => {
    const me = c.get('user') as any
    const [row] = await db.select().from(t).where(and(eq(t.id, c.req.param('id')), eq(t.companyId, me.companyId))).limit(1)
    return row || null
  }

  function routes(app: Hono<AppEnv>) {
    app.post('/:id/photos', mayAdd, async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const form = await uploadedForm(c)
      const existing = photosOf(row)
      if (existing.length >= MAX_PHOTOS && form.get('photo')) return fail(c, 400, `This holds up to ${MAX_PHOTOS} photos.`)
      const got = await encodedPhoto(c, d, form)
      if (got instanceof Response) return got
      const { jpeg, name } = got
      const id = crypto.randomUUID()
      const path = `${me.companyId}/${o.folder}/${row.id}/${id}.jpg`
      await d.services.storage.put(path, jpeg, 'image/jpeg')
      const caption = String(form.get('caption') || '').trim().slice(0, 300) || null
      const photo: RecordPhoto = { id, name, caption, path, size: jpeg.length, uploadedAt: new Date().toISOString(), uploadedById: me.userId }
      const [updated] = await db.update(t).set({ photos: [...existing, photo], updatedAt: new Date() })
        .where(and(eq(t.id, row.id), eq(t.companyId, me.companyId))).returning()
      return one(c, withUrls(updated), 201)
    })

    // The phone's offline queue (apps/mobile/src/offline/localPhotos.ts; contractor parity row 11) sends photos in two steps, as a
    // job's do: the file first, named from the save's id (the same name is the same file, so a retry after a lost reply replaces
    // it), answering its address — then the save, which puts the addresses on the record. One photo however often it is sent.
    const PHONE_NAME = /^[A-Za-z0-9_-]{8,80}$/
    const phonePath = (companyId: string, rowId: string, name: string) => `${companyId}/${o.folder}/${rowId}/phone-${name}.jpg`
    app.post('/:id/photos/file', mayAdd, async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const form = await uploadedForm(c)
      const got = await encodedPhoto(c, d, form)
      if (got instanceof Response) return got
      const asked = String(form.get('name') || '')
      const name = PHONE_NAME.test(asked) ? asked : crypto.randomUUID().replace(/-/g, '')
      await d.services.storage.put(phonePath(me.companyId, row.id, name), got.jpeg, 'image/jpeg')
      return one(c, { url: `phone:${name}` }, 201)
    })
    app.post('/:id/photos/saved', mayAdd, async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const body: any = await c.req.json().catch(() => ({}))
      const urls: string[] = Array.isArray(body?.photos) ? body.photos.filter((u: unknown): u is string => typeof u === 'string') : []
      const names = urls.map((u) => u.replace(/^phone:/, ''))
      if (urls.some((u) => !u.startsWith('phone:')) || names.some((n) => !PHONE_NAME.test(n))) return fail(c, 400, 'A photo could not be read — take it again.', 'bad_photo')
      const existing = photosOf(row)
      const have = new Set(existing.map((p) => p.id))
      const fresh: RecordPhoto[] = []
      for (const n of [...new Set(names)]) {
        if (have.has(n)) continue
        const path = phonePath(me.companyId, row.id, n)
        const obj = await d.services.storage.getObject(path).catch(() => null)
        if (!obj) continue
        fresh.push({ id: n, name: `${n}.jpg`, caption: typeof body?.caption === 'string' ? body.caption.trim().slice(0, 300) || null : null, path, size: Number((obj as any).size || 0), uploadedAt: new Date().toISOString(), uploadedById: me.userId })
      }
      if (existing.length + fresh.length > MAX_PHOTOS) return fail(c, 400, `This holds up to ${MAX_PHOTOS} photos.`)
      if (!fresh.length) return one(c, { saved: 0, record: withUrls(row) })
      const [updated] = await db.update(t).set({ photos: [...existing, ...fresh], updatedAt: new Date() })
        .where(and(eq(t.id, row.id), eq(t.companyId, me.companyId))).returning()
      return one(c, { saved: fresh.length, record: withUrls(updated) }, 201)
    })

    app.get('/:id/photos/:photoId/file', requirePermission(o.read), async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      const photo = row && photosOf(row).find((p) => p.id === c.req.param('photoId'))
      if (!photo || !photo.path.startsWith(`${me.companyId}/`)) return fail(c, 404, 'Photo not found')
      const obj = await d.services.storage.getObject(photo.path)
      if (!obj) return fail(c, 404, 'Photo not found')
      return photoResponse(obj)
    })

    app.delete('/:id/photos/:photoId', mayAdd, async (c) => {
      const me = c.get('user') as any
      const row = await own(c)
      if (!row) return fail(c, 404, o.notFound)
      const refused = o.editable ? await o.editable(c, row) : null
      if (refused) return refused
      const photos = photosOf(row)
      const gone = photos.find((p) => p.id === c.req.param('photoId'))
      if (!gone) return fail(c, 404, 'Photo not found')
      // Somebody else's photo is the write permission's to remove; your own is yours.
      if (gone.uploadedById !== me.userId && !(await writes(c))) return fail(c, 403, 'You can remove only the photos you added.', 'not_your_photo')
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
