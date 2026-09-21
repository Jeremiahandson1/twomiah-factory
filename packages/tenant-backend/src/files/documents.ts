// /api/documents — ONE implementation for every CRM template. List/search, upload (single + bulk),
// metadata edit, authenticated download + file stream (company-scoped keys), version history (the
// document row always points at the CURRENT file; replacing it snapshots the outgoing one first) and,
// where the template has the table, plan markups (annotation layers stored as JSON).
import { Hono } from 'hono'
import path from 'path'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import type { FileStorage } from './storage'
import { INLINE_IMAGE_TYPES } from './storage'

export interface DocumentTables {
  document: any
  /** the contractor lineage only — a roofing or salon CRM hangs a document off a JOB. Optional. */
  project?: any
  contact: any
  user: any
  /** version history — added to every template */
  documentVersion?: any
  /** plan markups — construction only */
  planMarkup?: any
}

export interface DocumentDeps {
  db: any
  tables: DocumentTables
  storage: FileStorage
  authenticate: any
  /** audit hook: (event, actor, meta) */
  audit?: (event: string, actor: { userId: string; companyId: string }, meta: Record<string, unknown>) => void
  options?: {
    /** max page size, default 100 */
    maxLimit?: number
    /**
     * Records a document can hang off BEYOND the four every CRM has (project, contact, job, invoice),
     * as column name → the table it points at. The vet passes { patientId: patient }, because a vaccination
     * certificate or an x-ray belongs to the animal, not to the person who pays the bill — filing it under
     * the owner is what made a multi-pet household's chart useless. (Vet T12 M6)
     * The column is filterable (?patientId=), settable on upload and on edit, and checked to exist in this
     * company before it is stored.
     */
    links?: Record<string, any>
    /**
     * The document types this vertical files, and the only ones it will store.
     *
     * The picker on the page was the only thing deciding this, so anything that did not come from the
     * picker was kept verbatim: `type: "banana"` stored a banana, and it then appeared in the type
     * filter as a real category. The list belongs to the vertical — a roofer files a scope and a
     * warranty, a vet files a lab result — so it is passed in rather than hardcoded here, and
     * check-document-types-match-the-picker.ts holds it identical to the frontend's docsConfig.
     * (roof T18 D4)
     *
     * Omitted = no check, which is how a template that has not been given a list yet keeps working.
     */
    types?: string[]
  }
}

const THUMB = 200
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
const idOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function createDocumentRoutes(deps: DocumentDeps) {
  const { db, tables: t, storage, authenticate } = deps
  const audit = deps.audit || (() => {})
  const maxLimit = deps.options?.maxLimit || 100
  const links: Record<string, any> = deps.options?.links || {}
  const linkCols = Object.keys(links)

  /**
   * The document type, checked against what this vertical actually files.
   *
   * Returns the type to store, or an { error } to hand straight back as a 400. An absent type is the
   * vertical's 'general', which every list contains — only a type that was SENT and is unknown is
   * refused, and the message lists the real ones so the caller can correct it.
   */
  const allowedTypes: string[] | undefined = deps.options?.types
  const checkType = (raw: unknown): { type: string } | { error: string } => {
    const value = str(raw, 50)
    if (!value) return { type: 'general' }
    if (allowedTypes && !allowedTypes.includes(value)) {
      return { error: `Unknown document type "${value}". Use one of: ${allowedTypes.join(', ')}.` }
    }
    return { type: value }
  }
  const linkLabel = (col: string) => col.replace(/Id$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  /** the extra link columns from a body, refusing an id that is not this company's */
  const linkValues = async (companyId: string, src: Record<string, any>): Promise<{ values: Record<string, any> } | { error: string }> => {
    const values: Record<string, any> = {}
    for (const col of linkCols) {
      if (src[col] === undefined) continue
      const id = idOrNull(src[col])
      if (id) {
        const table = links[col]
        const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).limit(1)
        if (!row) return { error: `That ${linkLabel(col)} does not exist.` }
      }
      values[col] = id
    }
    return { values }
  }
  const app = new Hono()
  app.use('*', authenticate)
  const actor = (c: any) => { const u = c.get('user') as any; return { userId: u.userId, companyId: u.companyId } }

  // Not every CRM has projects. The contractor lineage does; a roofing or salon CRM hangs a document
  // off a JOB instead, and passing `project: undefined` used to crash the first list request with
  // "undefined is not an object (evaluating 't.project.id')". The join is therefore conditional —
  // templates that pass a project table are unaffected, and `flat()` below already copes with the
  // relation being absent.
  const hasProjects = !!t.project
  /**
   * A contact is named differently across the fleet: most templates carry a single `name`, roof
   * carries `firstName` / `lastName`. Selecting `t.contact.name` where it does not exist hands
   * drizzle an undefined column and the first list request dies on "Object.entries requires that
   * input parameter not be null or undefined". Select whichever the template has; `flat()` composes
   * one `{ id, name }` shape either way, so every caller sees the same thing.
   */
  const splitName = !t.contact.name
  const contactSel = splitName
    ? { id: t.contact.id, firstName: t.contact.firstName, lastName: t.contact.lastName }
    : { id: t.contact.id, name: t.contact.name }

  const withRelations = (where: any) => {
    let q = db.select({
      document: t.document,
      ...(hasProjects ? { project: { id: t.project.id, name: t.project.name } } : {}),
      contact: contactSel,
      uploadedBy: { id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName },
    }).from(t.document) as any
    if (hasProjects) q = q.leftJoin(t.project, eq(t.document.projectId, t.project.id))
    return q
      .leftJoin(t.contact, eq(t.document.contactId, t.contact.id))
      .leftJoin(t.user, eq(t.document.uploadedById, t.user.id))
      .where(where)
  }
  /** one `{ id, name }` contact regardless of how the template stores it */
  const namedContact = (ct: any) =>
    ct?.id ? { id: ct.id, name: ct.name ?? [ct.firstName, ct.lastName].filter(Boolean).join(' ') } : null
  // One flat shape everywhere: the document's own columns at the top level, relations nested.
  const flat = (r: any) => ({ ...r.document, project: r.project?.id ? r.project : null, contact: namedContact(r.contact), uploadedBy: r.uploadedBy?.id ? r.uploadedBy : null })

  const owned = async (c: any) => {
    const { companyId } = actor(c)
    const [doc] = await db.select().from(t.document).where(and(eq(t.document.id, c.req.param('id')), eq(t.document.companyId, companyId))).limit(1)
    return doc || null
  }

  /** Store an upload as-is (a Document keeps its original bytes/type/name), plus a thumbnail for images. */
  async function storeUpload(file: File, companyId: string) {
    const uploaded = await storage.saveFile(file, companyId, 'documents')
    const key = uploaded.path
    let thumbKey: string | null = null
    // A document is preserved exactly as uploaded — a PNG contract must come back a PNG, not a re-encoded
    // JPEG, and the row must report the bytes ACTUALLY stored. Transcoding the main file in place left the
    // record showing the original size (24× the JPEG served) under the original .png name. We only add a
    // thumbnail beside it for the list view.
    if (uploaded.mimetype.startsWith('image/') && uploaded.mimetype !== 'image/gif') {
      try { thumbKey = await storage.generateThumbnail(key, THUMB) } catch { /* no thumbnail; the original still stands */ }
    }
    return {
      filename: path.basename(key),
      originalName: uploaded.originalname,
      mimeType: uploaded.mimetype,
      size: uploaded.size,
      path: key,
      url: storage.getFileUrl(key, companyId),
      thumbnailUrl: thumbKey ? storage.getFileUrl(thumbKey, companyId) : null,
    }
  }

  const parseMultipart = async (c: any, all = false): Promise<Record<string, any> | null> => {
    try { return await c.req.parseBody(all ? { all: true } : undefined) } catch { return null }
  }

  // ---------------------------------------------------------------- list

  app.get('/', async (c) => {
    const { companyId } = actor(c)
    const q = c.req.query()
    const page = Math.max(1, parseInt(q.page || '1') || 1)
    const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit || '25') || 25))
    const conditions: any[] = [eq(t.document.companyId, companyId)]
    // `projectId` only exists where the template has projects — see hasProjects above.
    if (hasProjects && q.projectId) conditions.push(eq(t.document.projectId, q.projectId))
    if (q.contactId) conditions.push(eq(t.document.contactId, q.contactId))
    if (q.jobId) conditions.push(eq(t.document.jobId, q.jobId))
    for (const col of linkCols) if (q[col]) conditions.push(eq(t.document[col], q[col]))
    if (q.type) conditions.push(eq(t.document.type, q.type))
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, ch => '\\' + ch)}%`
      conditions.push(or(ilike(t.document.name, term), ilike(t.document.description, term), ilike(t.document.originalName, term))!)
    }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      withRelations(where).orderBy(desc(t.document.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.document).where(where),
    ])
    return c.json({ data: rows.map(flat), pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // ---------------------------------------------------------------- file stream (powers url / thumbnailUrl)

  app.get('/file/*', async (c) => {
    const { companyId } = actor(c)
    const key = decodeURIComponent(c.req.path.replace(/^.*\/file\//, ''))
    if (!key || key.includes('..') || key.startsWith('/')) return c.json({ error: 'Invalid key' }, 400)
    if (!key.startsWith(`${companyId}/`)) return c.json({ error: 'Forbidden' }, 403)
    const obj = await storage.getObject(key)
    if (!obj) return c.json({ error: 'Not found' }, 404)
    // Preview inline for images and PDFs (both magic-byte verified on upload) so the preview pane can render
    // them; PDFs were forced to application/octet-stream, which made the preview pane blank. Everything else
    // still downloads as an opaque attachment with nosniff, so an uploaded HTML/script can't run inline.
    const inline = INLINE_IMAGE_TYPES.includes(obj.contentType) || obj.contentType === 'application/pdf'
    c.header('Content-Type', inline ? obj.contentType : 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Disposition', inline ? 'inline' : 'attachment')
    c.header('Cache-Control', 'private, max-age=86400')
    return c.body(obj.body)
  })

  // ---------------------------------------------------------------- single

  app.get('/:id', async (c) => {
    const { companyId } = actor(c)
    const [row] = await withRelations(and(eq(t.document.id, c.req.param('id')), eq(t.document.companyId, companyId))).limit(1)
    if (!row) return c.json({ error: 'Document not found' }, 404)
    return c.json(flat(row))
  })

  // ---------------------------------------------------------------- upload

  app.post('/', async (c) => {
    const { userId, companyId } = actor(c)
    const body = await parseMultipart(c)
    if (!body) return c.json({ error: 'Expected multipart/form-data with a file.' }, 400)
    const file = body['file']
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400)
    const extra = await linkValues(companyId, body)
    if ('error' in extra) return c.json({ error: extra.error }, 404)
    const checked = checkType(body['type'])
    if ('error' in checked) return c.json({ error: checked.error }, 400)
    let stored
    try { stored = await storeUpload(file, companyId) } catch (err: any) { return c.json({ error: err.message }, 400) }
    const [doc] = await db.insert(t.document).values({
      companyId,
      name: str(body['name'], 200) || stored.originalName,
      description: str(body['description'], 2000) || null,
      type: checked.type,
      ...stored,
      ...(hasProjects ? { projectId: idOrNull(body["projectId"]) } : {}),
      contactId: idOrNull(body['contactId']),
      jobId: idOrNull(body['jobId']),
      invoiceId: idOrNull(body['invoiceId']),
      ...extra.values,
      uploadedById: userId,
    }).returning()
    audit('document_upload', { userId, companyId }, { documentId: doc.id, filename: doc.originalName })
    return c.json(doc, 201)
  })

  app.post('/bulk', async (c) => {
    const { userId, companyId } = actor(c)
    const body = await parseMultipart(c, true)
    if (!body) return c.json({ error: 'Expected multipart/form-data with files.' }, 400)
    const raw = body['files'] ?? body['files[]']
    const files: File[] = Array.isArray(raw) ? raw.filter((f: any) => f instanceof File) : raw instanceof File ? [raw] : []
    if (!files.length) return c.json({ error: 'No files uploaded' }, 400)
    const checkedBulk = checkType(body['type'])
    if ('error' in checkedBulk) return c.json({ error: checkedBulk.error }, 400)
    const type = checkedBulk.type
    const projectId = hasProjects ? idOrNull(body["projectId"]) : undefined, contactId = idOrNull(body['contactId']), jobId = idOrNull(body['jobId'])
    const extra = await linkValues(companyId, body)
    if ('error' in extra) return c.json({ error: extra.error }, 404)
    const documents: any[] = []
    const failed: Array<{ file: string; error: string }> = []
    for (const file of files) {
      try {
        const stored = await storeUpload(file, companyId)
        const [doc] = await db.insert(t.document).values({ companyId, name: stored.originalName, type, ...stored, ...(hasProjects ? { projectId } : {}), contactId, jobId, ...extra.values, uploadedById: userId }).returning()
        documents.push(doc)
      } catch (err: any) { failed.push({ file: file.name, error: err.message }) }
    }
    if (documents.length) audit('bulk_document_upload', { userId, companyId }, { count: documents.length })
    if (!documents.length) return c.json({ error: failed[0]?.error || 'No files could be uploaded', failed }, 400)
    return c.json({ data: documents, count: documents.length, failed }, 201)
  })

  // ---------------------------------------------------------------- update / delete

  app.put('/:id', async (c) => {
    const { companyId } = actor(c)
    const doc = await owned(c)
    if (!doc) return c.json({ error: 'Document not found' }, 404)
    const body = (await c.req.json().catch(() => null)) ?? {}
    const u: Record<string, unknown> = { updatedAt: new Date() }
    if (body.name !== undefined) { const n = str(body.name, 200); if (!n) return c.json({ error: 'Name cannot be empty' }, 400); u.name = n }
    if (body.description !== undefined) u.description = str(body.description, 2000) || null
    if (body.type !== undefined) {
      const checked = checkType(body.type)
      if ('error' in checked) return c.json({ error: checked.error }, 400)
      u.type = checked.type
    }
    if (hasProjects && body.projectId !== undefined) u.projectId = idOrNull(body.projectId)
    if (body.contactId !== undefined) u.contactId = idOrNull(body.contactId)
    if (body.jobId !== undefined) u.jobId = idOrNull(body.jobId)
    const extra = await linkValues(companyId, body)
    if ('error' in extra) return c.json({ error: extra.error }, 404)
    Object.assign(u, extra.values)
    await db.update(t.document).set(u).where(eq(t.document.id, doc.id))
    const [row] = await withRelations(and(eq(t.document.id, doc.id), eq(t.document.companyId, companyId))).limit(1)
    return c.json(flat(row))
  })

  app.delete('/:id', async (c) => {
    const { userId, companyId } = actor(c)
    const doc = await owned(c)
    if (!doc) return c.json({ error: 'Document not found' }, 404)
    // versions own their files too
    if (t.documentVersion) {
      const versions = await db.select({ path: t.documentVersion.path }).from(t.documentVersion).where(eq(t.documentVersion.documentId, doc.id))
      for (const v of versions) if (v.path && v.path !== doc.path) storage.deleteFile(v.path)
      await db.delete(t.documentVersion).where(eq(t.documentVersion.documentId, doc.id))
    }
    if (t.planMarkup) await db.delete(t.planMarkup).where(eq(t.planMarkup.documentId, doc.id))
    if (doc.path) storage.deleteFile(doc.path)
    if (doc.path && doc.thumbnailUrl) storage.deleteFile(storage.thumbKeyFor(doc.path))
    await db.delete(t.document).where(eq(t.document.id, doc.id))
    audit('document_delete', { userId, companyId }, { documentId: doc.id, filename: doc.originalName })
    return c.json({ success: true })
  })

  // ---------------------------------------------------------------- download

  const streamAttachment = (obj: { body: ArrayBuffer; contentType: string }, mimeType: string | null, name: string) => new Response(obj.body, {
    headers: {
      'Content-Type': mimeType || obj.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name.replace(/["\r\n]/g, '')}"`,
      'Content-Length': String(obj.body.byteLength),
      'X-Content-Type-Options': 'nosniff',
    },
  })

  app.get('/:id/download', async (c) => {
    const doc = await owned(c)
    if (!doc) return c.json({ error: 'Document not found' }, 404)
    if (!doc.path) return c.json({ error: 'File not found' }, 404)
    const obj = await storage.getObject(doc.path)
    if (!obj) return c.json({ error: 'File not found' }, 404)
    return streamAttachment(obj, doc.mimeType, doc.originalName || path.basename(doc.path))
  })

  // ---------------------------------------------------------------- version history

  if (t.documentVersion) {
    const v = t.documentVersion
    const snapshot = (doc: any, userId: string, versionNumber: number, note: string | null) => ({
      documentId: doc.id, versionNumber, filename: doc.filename, originalName: doc.originalName, mimeType: doc.mimeType, size: doc.size, path: doc.path, url: doc.url, note, uploadedById: userId,
    })
    const nextVersion = async (docId: string) => { const [{ value }] = await db.select({ value: count() }).from(v).where(eq(v.documentId, docId)); return Number(value) + 1 }

    app.get('/:id/versions', async (c) => {
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const versions = await db.select().from(v).where(eq(v.documentId, doc.id)).orderBy(desc(v.versionNumber))
      const currentVersion = versions.length + 1
      // The file that is live now is part of its own history. Listing only the superseded copies meant the newest
      // thing the list knew about was the file that had just been replaced, so nothing said which version you are
      // looking at. It has no version row — it IS the document — so it carries isCurrent and no id to restore from,
      // and it downloads from the document itself. (Landscaping T21 M3)
      const live = { id: null, documentId: doc.id, versionNumber: currentVersion, filename: doc.filename, originalName: doc.originalName, mimeType: doc.mimeType, size: doc.size, path: doc.path, url: doc.url, note: null, uploadedById: doc.uploadedById ?? null, createdAt: doc.updatedAt || doc.createdAt, isCurrent: true }
      return c.json({ data: [live, ...versions.map((row: any) => ({ ...row, isCurrent: false }))], currentVersion })
    })

    // Replace the file: the outgoing file is kept as a version, and the row (path, url, thumbnail) points at the new one.
    app.post('/:id/versions', async (c) => {
      const { userId, companyId } = actor(c)
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const body = await parseMultipart(c)
      const file = body?.['file']
      if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400)
      let stored
      try { stored = await storeUpload(file, companyId) } catch (err: any) { return c.json({ error: err.message }, 400) }
      await db.insert(v).values(snapshot(doc, userId, await nextVersion(doc.id), str(body?.['note'], 500) || null))
      const [updated] = await db.update(t.document).set({ ...stored, updatedAt: new Date() }).where(eq(t.document.id, doc.id)).returning()
      audit('document_version_upload', { userId, companyId }, { documentId: doc.id, filename: stored.originalName })
      return c.json(updated, 201)
    })

    app.post('/:id/versions/:versionId/restore', async (c) => {
      const { userId, companyId } = actor(c)
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const [version] = await db.select().from(v).where(and(eq(v.id, c.req.param('versionId')), eq(v.documentId, doc.id))).limit(1)
      if (!version) return c.json({ error: 'Version not found' }, 404)
      // the current file becomes a version too, so a restore is always reversible
      await db.insert(v).values(snapshot(doc, userId, await nextVersion(doc.id), `Superseded by restore of v${version.versionNumber}`))
      const [updated] = await db.update(t.document).set({
        filename: version.filename, originalName: version.originalName, mimeType: version.mimeType, size: version.size, path: version.path,
        url: version.url, thumbnailUrl: version.mimeType?.startsWith('image/') ? storage.getFileUrl(storage.thumbKeyFor(version.path), companyId) : null, updatedAt: new Date(),
      }).where(eq(t.document.id, doc.id)).returning()
      return c.json(updated)
    })

    app.get('/:id/versions/:versionId/download', async (c) => {
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const [version] = await db.select().from(v).where(and(eq(v.id, c.req.param('versionId')), eq(v.documentId, doc.id))).limit(1)
      if (!version) return c.json({ error: 'Version not found' }, 404)
      const obj = await storage.getObject(version.path)
      if (!obj) return c.json({ error: 'File not found' }, 404)
      return streamAttachment(obj, version.mimeType, version.originalName || path.basename(version.path))
    })
  }

  // ---------------------------------------------------------------- plan markups (annotation layers)

  if (t.planMarkup) {
    const m = t.planMarkup
    app.get('/:id/markups', async (c) => {
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      return c.json({ data: await db.select().from(m).where(eq(m.documentId, doc.id)).orderBy(desc(m.updatedAt)) })
    })
    app.post('/:id/markups', async (c) => {
      const { userId } = actor(c)
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const body = (await c.req.json().catch(() => null)) ?? {}
      if (typeof body.data !== 'string' || !body.data.length) return c.json({ error: 'Markup data is required' }, 400)
      const [markup] = await db.insert(m).values({ documentId: doc.id, name: str(body.name, 100) || 'Markup', data: body.data, createdById: userId }).returning()
      return c.json(markup, 201)
    })
    app.put('/:id/markups/:markupId', async (c) => {
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const body = (await c.req.json().catch(() => null)) ?? {}
      const u: Record<string, unknown> = { updatedAt: new Date() }
      if (typeof body.data === 'string' && body.data.length) u.data = body.data
      if (str(body.name, 100)) u.name = str(body.name, 100)
      const [updated] = await db.update(m).set(u).where(and(eq(m.id, c.req.param('markupId')), eq(m.documentId, doc.id))).returning()
      if (!updated) return c.json({ error: 'Markup not found' }, 404)
      return c.json(updated)
    })
    app.delete('/:id/markups/:markupId', async (c) => {
      const doc = await owned(c)
      if (!doc) return c.json({ error: 'Document not found' }, 404)
      const deleted = await db.delete(m).where(and(eq(m.id, c.req.param('markupId')), eq(m.documentId, doc.id))).returning()
      if (!deleted.length) return c.json({ error: 'Markup not found' }, 404)
      return c.body(null, 204)
    })
  }

  return app
}
