// /api/photos — job/project photos (the mobile app's PhotoGallery uses this API). ONE implementation for
// every CRM: photos are re-encoded to web-sized JPEG + a thumbnail, stored PRIVATE in the tenant's R2
// bucket, and served back only through the authenticated, company-scoped routes here. Rows live in the
// document table (type = category, mimeType image/jpeg) — the schema has no dedicated photo table in use.
import { folderNameCheck, ownFolderOf, foldersOfJob } from './photoFolders'
import { Hono } from 'hono'
import crypto from 'crypto'
import sharp from 'sharp'
import { eq, and, desc, count, asc } from 'drizzle-orm'
import type { FileStorage } from './storage'

export interface PhotoTables { document: any; user: any; project: any; job: any
  /** A job's own named folders (files/photoFolders.ts) — with document.photoFolderId; absent, the standard categories only. */
  jobPhotoFolder?: any }
export interface PhotoDeps {
  db: any
  tables: PhotoTables
  storage: FileStorage
  authenticate: any
  requirePermission: (permission: string) => any
  /**
   * WHOSE FILES A SEAT READS (security review S1-15, 2026-11-12). A condition on the document table (a photo is a document row) for a seat that reads
   * only its own work (a job trade's crew, the Sales rep), or undefined for a seat that reads the whole business. These
   * doors were company-wide: a crew login listed and downloaded the files of customers and jobs it cannot open. Every
   * door that reads or changes one row, and the list, takes it. Not wired, nothing is narrowed (the templates).
   */
  visibleTo?: (user: { userId: string; role: string }) => Promise<any | undefined> | any | undefined
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
  const actor = (c: any) => { const u = c.get('user') as any; return { userId: u.userId, companyId: u.companyId, role: u.role } }
  /** The narrowing for the person asking (deps.visibleTo), or undefined: `and()` drops an undefined condition. */
  const seenBy = async (c: any) => (deps.visibleTo ? await deps.visibleTo(actor(c)) : undefined)
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
  const getPhoto = async (id: string, companyId: string, seen?: any) => {
    const [r] = await withRelations(and(eq(t.document.id, id), eq(t.document.companyId, companyId), seen)).limit(1)
    return r ? shape(r) : null
  }

  /** Re-encode + store one photo (main + thumbnail). Throws a plain Error for a caller mistake. */
  async function processPhoto(file: File, o: { companyId: string; userId: string; projectId?: string | null; jobId?: string | null; caption?: string | null; category?: string | null; folderId?: string | null }) {
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
      ...(o.folderId ? { photoFolderId: o.folderId } : {}),
    }).returning()
    return photo
  }

  /**
   * NO-STORE, for the same reason as the document route. (T32 M12, the sibling)
   *
   * The report found `private, max-age=86400` on /api/documents/file/*. This route had the identical
   * header and was not in the report only because nobody fetched a site photo twice. A job photo is
   * the same kind of thing: a customer's property, a damaged part, somebody's driveway — kept in the
   * browser for a day and served again without credentials after sign-out.
   *
   * Fixing one of two identical sites is how a finding comes back next round.
   */
  const serve = (obj: { body: ArrayBuffer; contentType: string }) => new Response(obj.body, {
    headers: {
      'Content-Type': obj.contentType.startsWith('image/') ? obj.contentType : 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  })

  app.get('/', requirePermission('documents:read'), async (c) => {
    const { companyId } = actor(c)
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1') || 1)
    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '50') || 50))
    const conditions: any[] = [eq(t.document.companyId, companyId), eq(t.document.mimeType, 'image/jpeg'), await seenBy(c)]
    if (q.projectId) conditions.push(eq(t.document.projectId, q.projectId))
    if (q.jobId) conditions.push(eq(t.document.jobId, q.jobId))
    if (q.category) conditions.push(eq(t.document.type, q.category))
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      withRelations(where).orderBy(desc(t.document.createdAt), asc(t.document.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.document).where(where),
    ])
    return c.json({ data: rows.map(shape), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // Registered before /:id so "meta" is never read as an id.
  app.get('/meta/categories', async (c) => c.json(PHOTO_CATEGORIES))

  // ── A job's own named folders, for the photos filed under it here (live test 11/11: the contractor's job photos are this
  //    library's, and only had the standard categories — Buildertrend and CompanyCam let you name your own). The same folders as
  //    the job's own photos use (files/photoFolders.ts). Registered before /:id.
  const named = !!t.jobPhotoFolder && 'photoFolderId' in t.document
  const ownJob = async (companyId: string, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) return null
    const [j] = await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.id, jobId), eq(t.job.companyId, companyId))).limit(1)
    return j ?? null
  }
  const folderById = async (companyId: string, id: string) => {
    const [f] = await db.select().from(t.jobPhotoFolder).where(and(eq(t.jobPhotoFolder.id, id), eq(t.jobPhotoFolder.companyId, companyId))).limit(1)
    return f ?? null
  }
  if (named) {
    app.get('/folders', requirePermission('documents:read'), async (c) => {
      const { companyId } = actor(c)
      const job = await ownJob(companyId, c.req.query('jobId'))
      if (!job) return c.json({ error: 'Job not found' }, 404)
      return c.json({ data: await foldersOfJob(db, t.jobPhotoFolder, job.id, companyId) })
    })
    app.post('/folders', requirePermission('documents:create'), async (c) => {
      const { companyId } = actor(c)
      const body = (await c.req.json().catch(() => null)) ?? {}
      const job = await ownJob(companyId, body.jobId)
      if (!job) return c.json({ error: 'Job not found' }, 404)
      const n = await folderNameCheck(db, t.jobPhotoFolder, job.id, companyId, body.name)
      if ('error' in n) return c.json({ error: n.error, code: 'validation_failed' }, n.status)
      const [made] = await db.insert(t.jobPhotoFolder).values({ companyId, jobId: job.id, name: n.name }).returning({ id: t.jobPhotoFolder.id, name: t.jobPhotoFolder.name })
      return c.json(made, 201)
    })
    app.patch('/folders/:folderId', requirePermission('documents:update'), async (c) => {
      const { companyId } = actor(c)
      const f = await folderById(companyId, c.req.param('folderId'))
      if (!f) return c.json({ error: 'Folder not found' }, 404)
      const body = (await c.req.json().catch(() => null)) ?? {}
      const n = await folderNameCheck(db, t.jobPhotoFolder, f.jobId, companyId, body.name, f.id)
      if ('error' in n) return c.json({ error: n.error, code: 'validation_failed' }, n.status)
      const [renamed] = await db.update(t.jobPhotoFolder).set({ name: n.name }).where(eq(t.jobPhotoFolder.id, f.id)).returning({ id: t.jobPhotoFolder.id, name: t.jobPhotoFolder.name })
      return c.json(renamed)
    })
    // Its photos stay, in no folder.
    app.delete('/folders/:folderId', requirePermission('documents:update'), async (c) => {
      const { companyId } = actor(c)
      const f = await folderById(companyId, c.req.param('folderId'))
      if (!f) return c.json({ error: 'Folder not found' }, 404)
      await db.update(t.document).set({ photoFolderId: null }).where(and(eq(t.document.photoFolderId, f.id), eq(t.document.companyId, companyId)))
      await db.delete(t.jobPhotoFolder).where(eq(t.jobPhotoFolder.id, f.id))
      return c.body(null, 204)
    })
  }

  app.get('/:id', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId, await seenBy(c))
    return photo ? c.json(photo) : c.json({ error: 'Photo not found' }, 404)
  })

  app.get('/:id/file', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId, await seenBy(c))
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    const obj = photo.path ? await storage.getObject(photo.path) : null
    if (!obj) return c.json({ error: 'Photo file not found' }, 404)
    return serve(obj)
  })

  app.get('/:id/thumbnail', requirePermission('documents:read'), async (c) => {
    const photo = await getPhoto(c.req.param('id'), actor(c).companyId, await seenBy(c))
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
      const jobId = fd!.get('jobId') as string | null
      const askedFolder = named ? (fd!.get('folderId') as string | null) : null
      const folder = askedFolder ? await ownFolderOf(db, t.jobPhotoFolder, jobId, companyId, askedFolder) : null
      if (askedFolder && !folder) return c.json({ error: 'That folder is not on this job.', code: 'validation_failed' }, 400)
      photo = await processPhoto(file, { companyId, userId, projectId: fd!.get('projectId') as string | null, jobId, caption: fd!.get('caption') as string | null, category: folder ? null : fd!.get('category') as string | null, folderId: folder?.id ?? null })
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
    const photo = await getPhoto(c.req.param('id'), companyId, await seenBy(c))
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    const body = (await c.req.json().catch(() => null)) ?? {}
    const u: Record<string, unknown> = { updatedAt: new Date() }
    if (body.caption !== undefined) { u.description = body.caption || null; if (body.caption) u.name = String(body.caption).slice(0, 200) }
    if (body.category !== undefined) u.type = PHOTO_CATEGORIES.includes(body.category) ? body.category : 'photo'
    // Into one of its job's named folders (out of any category), or — a category given — out of any named folder.
    if (named && body.folderId) {
      const folder = await ownFolderOf(db, t.jobPhotoFolder, photo.jobId, companyId, body.folderId)
      if (!folder) return c.json({ error: 'That folder is not on this photo\'s job.', code: 'validation_failed' }, 400)
      u.photoFolderId = folder.id; u.type = 'photo'
    } else if (named && body.category !== undefined) u.photoFolderId = null
    if (body.projectId !== undefined) u.projectId = body.projectId || null
    if (body.jobId !== undefined) u.jobId = body.jobId || null
    const [updated] = await db.update(t.document).set(u).where(eq(t.document.id, photo.id)).returning()
    return c.json(updated)
  })

  app.delete('/:id', requirePermission('documents:delete'), async (c) => {
    const { userId, companyId } = actor(c)
    const photo = await getPhoto(c.req.param('id'), companyId, await seenBy(c))
    if (!photo) return c.json({ error: 'Photo not found' }, 404)
    if (photo.path) { storage.deleteFile(photo.path); storage.deleteFile(thumbKey(photo.path)) }
    await db.delete(t.document).where(eq(t.document.id, photo.id))
    audit('photo_delete', { userId, companyId }, { photoId: photo.id, filename: photo.originalName })
    return c.body(null, 204)
  })

  return app
}
