// /api/photos — job/project photos (the mobile app's PhotoGallery uses this API). ONE implementation for
// every CRM: photos are re-encoded to web-sized JPEG + a thumbnail, stored PRIVATE in the tenant's R2
// bucket, and served back only through the authenticated, company-scoped routes here. Rows live in the
// document table (type = category, mimeType image/jpeg) — the schema has no dedicated photo table in use.
import { Hono } from 'hono'
import crypto from 'crypto'
import sharp from 'sharp'
import { eq, and, desc, count } from 'drizzle-orm'
import type { FileStorage } from './storage'

export interface PhotoTables { document: any; user: any; project: any; job: any }
export interface PhotoDeps {
  db: any
  tables: PhotoTables
  storage: FileStorage
  authenticate: any
  requirePermission: (permission: string) => any
  audit?: (event: string, actor: { userId: string; companyId: string }, meta: Record<string, unknown>) => void
}

export const PHOTO_CATEGORIES = ['before', 'during', 'after', 'progress', 'issue', 'material', 'equipment', 'safety', 'inspection', 'damage', 'permit', 'other']
const MAX_W = 2048, MAX_H = 2048, THUMB = 300, QUALITY = 85
const MAX_PHOTO_BYTES = 25 * 1024 * 1024

export function createPhotoRoutes(deps: PhotoDeps) {
  const { db, tables: t, storage, authenticate, requirePermission } = deps
  const audit = deps.audit || (() => {})
  const app = new Hono()
  app.use('*', authenticate)
  const actor = (c: any) => { const u = c.get('user') as any; return { userId: u.userId, companyId: u.companyId } }
  const thumbKey = (mainKey: string) => mainKey.replace(/\.jpg$/i, '_thumb.jpg')

  const withRelations = (where: any) => db.select().from(t.document)
    .leftJoin(t.user, eq(t.document.uploadedById, t.user.id))
    .leftJoin(t.project, eq(t.document.projectId, t.project.id))
    .leftJoin(t.job, eq(t.document.jobId, t.job.id))
    .where(where)
  const shape = (r: any) => ({
    ...r.document,
    uploadedBy: r.user ? { firstName: r.user.firstName, lastName: r.user.lastName } : null,
    project: r.project ? { name: r.project.name, number: r.project.number } : null,
    job: r.job ? { title: r.job.title, number: r.job.number } : null,
  })
  const getPhoto = async (id: string, companyId: string) => {
    const [r] = await withRelations(and(eq(t.document.id, id), eq(t.document.companyId, companyId))).limit(1)
    return r ? shape(r) : null
  }

  /** Re-encode + store one photo (main + thumbnail). Throws a plain Error for a caller mistake. */
  async function processPhoto(file: File, o: { companyId: string; userId: string; projectId?: string | null; jobId?: string | null; caption?: string | null; category?: string | null }) {
    if (file.size > MAX_PHOTO_BYTES) throw new Error(`Photo too large. Max size: ${MAX_PHOTO_BYTES / 1024 / 1024}MB`)
    const input = Buffer.from(await file.arrayBuffer())
    let main: Buffer, thumb: Buffer
    try {
      main = await sharp(input).rotate().resize(MAX_W, MAX_H, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: QUALITY }).toBuffer()
      thumb = await sharp(input).rotate().resize(THUMB, THUMB, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer()
    } catch {
      throw new Error(`That file is not an image we can read${file.type ? ` (${file.type})` : ''}. Upload a JPEG, PNG, WebP, GIF or HEIC photo.`)
    }
    const id = crypto.randomUUID()
    const mainKey = `${o.companyId}/photos/${id}.jpg`
    await Promise.all([storage.put(mainKey, main, 'image/jpeg'), storage.put(thumbKey(mainKey), thumb, 'image/jpeg')])
    const category = o.category && PHOTO_CATEGORIES.includes(o.category) ? o.category : 'photo'
    const [photo] = await db.insert(t.document).values({
      id,
      name: o.caption || file.name || 'photo.jpg',
      type: category,
      filename: `${id}.jpg`,
      originalName: file.name || 'photo.jpg',
      mimeType: 'image/jpeg',
      size: main.length,
      path: mainKey,
      url: `/api/photos/${id}/file`,
      thumbnailUrl: `/api/photos/${id}/thumbnail`,
      description: o.caption || null,
      companyId: o.companyId,
      projectId: o.projectId || null,
      jobId: o.jobId || null,
      uploadedById: o.userId,
    }).returning()
    return photo
  }

  const serve = (obj: { body: ArrayBuffer; contentType: string }) => new Response(obj.body, {
    headers: { 'Content-Type': obj.contentType.startsWith('image/') ? obj.contentType : 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' },
  })

  app.get('/', requirePermission('documents:read'), async (c) => {
    const { companyId } = actor(c)
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1') || 1)
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '50') || 50))
    const conditions: any[] = [eq(t.document.companyId, companyId), eq(t.document.mimeType, 'image/jpeg')]
    if (q.projectId) conditions.push(eq(t.document.projectId, q.projectId))
    if (q.jobId) conditions.push(eq(t.document.jobId, q.jobId))
    if (q.category) conditions.push(eq(t.document.type, q.category))
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      withRelations(where).orderBy(desc(t.document.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.document).where(where),
    ])
    return c.json({ data: rows.map(shape), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // Registered before /:id so "meta" is never read as an id.
  app.get('/meta/categories', async (c) => c.json(PHOTO_CATEGORIES))

  app.get('/:id', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId)
    return photo ? c.json(photo) : c.json({ error: 'Photo not found' }, 404)
  })

  app.get('/:id/file', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId)
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    const obj = photo.path ? await storage.getObject(photo.path) : null
    if (!obj) return c.json({ error: 'Photo file not found' }, 404)
    return serve(obj)
  })

  app.get('/:id/thumbnail', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId)
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    const obj = photo.path ? (await storage.getObject(thumbKey(photo.path))) || (await storage.getObject(photo.path)) : null
    if (!obj) return c.json({ error: 'Thumbnail not found' }, 404)
    return serve(obj)
  })

  app.post('/', requirePermission('documents:create'), async (c) => {
    const { userId, companyId } = actor(c)
    const fd = await c.req.formData().catch(() => null)
    const file = fd?.get('photo')
    if (!(file instanceof File)) return c.json({ error: 'No photo uploaded' }, 400)
    let photo
    try {
      photo = await processPhoto(file, { companyId, userId, projectId: fd!.get('projectId') as string | null, jobId: fd!.get('jobId') as string | null, caption: fd!.get('caption') as string | null, category: fd!.get('category') as string | null })
    } catch (err: any) { return c.json({ error: err.message }, 400) }
    audit('photo_upload', { userId, companyId }, { photoId: photo.id, filename: photo.originalName })
    return c.json(photo, 201)
  })

  app.post('/bulk', requirePermission('documents:create'), async (c) => {
    const { userId, companyId } = actor(c)
    const fd = await c.req.formData().catch(() => null)
    const files = (fd?.getAll('photos') || []).filter((f: any) => f instanceof File) as File[]
    if (!files.length) return c.json({ error: 'No photos uploaded' }, 400)
    const o = { companyId, userId, projectId: fd!.get('projectId') as string | null, jobId: fd!.get('jobId') as string | null, category: fd!.get('category') as string | null }
    const results: Array<{ success: boolean; photo?: any; error?: string; filename?: string }> = []
    for (const f of files) {
      try { results.push({ success: true, photo: await processPhoto(f, o) }) } catch (err: any) { results.push({ success: false, error: err.message, filename: f.name }) }
    }
    const uploaded = results.filter(r => r.success).length
    if (uploaded) audit('photo_bulk_upload', { userId, companyId }, { count: uploaded, projectId: o.projectId, jobId: o.jobId })
    return c.json({ uploaded, failed: results.length - uploaded, results }, uploaded ? 201 : 400)
  })

  app.put('/:id', requirePermission('documents:update'), async (c) => {
    const { companyId } = actor(c)
    const photo = await getPhoto(c.req.param('id'), companyId)
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    const body = (await c.req.json().catch(() => null)) ?? {}
    const u: Record<string, unknown> = { updatedAt: new Date() }
    if (body.caption !== undefined) { u.description = body.caption || null; if (body.caption) u.name = String(body.caption).slice(0, 200) }
    if (body.category !== undefined) u.type = PHOTO_CATEGORIES.includes(body.category) ? body.category : 'photo'
    if (body.projectId !== undefined) u.projectId = body.projectId || null
    if (body.jobId !== undefined) u.jobId = body.jobId || null
    const [updated] = await db.update(t.document).set(u).where(eq(t.document.id, photo.id)).returning()
    return c.json(updated)
  })

  app.delete('/:id', requirePermission('documents:delete'), async (c) => {
    const { userId, companyId } = actor(c)
    const photo = await getPhoto(c.req.param('id'), companyId)
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    if (photo.path) { storage.deleteFile(photo.path); storage.deleteFile(thumbKey(photo.path)) }
    await db.delete(t.document).where(eq(t.document.id, photo.id))
    audit('photo_delete', { userId, companyId }, { photoId: photo.id, filename: photo.originalName })
    return c.body(null, 204)
  })

  return app
}
