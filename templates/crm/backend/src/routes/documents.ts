import { Hono } from 'hono'
import path from 'path'
import { db } from '../../db/index.ts'
import { document, documentVersion, planMarkup, project, contact, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import fileService from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

const app = new Hono()
app.use('*', authenticate)

// List documents
app.get('/', async (c) => {
  const { projectId, contactId, type, search, page = '1', limit = '25' } = c.req.query() as any
  const currentUser = c.get('user') as any
  const pageNum = parseInt(page)
  const limitNum = parseInt(limit)

  const conditions: any[] = [eq(document.companyId, currentUser.companyId)]
  if (projectId) conditions.push(eq(document.projectId, projectId))
  if (contactId) conditions.push(eq(document.contactId, contactId))
  if (type) conditions.push(eq(document.type, type))
  if (search) {
    conditions.push(
      or(
        ilike(document.name, `%${search}%`),
        ilike(document.description, `%${search}%`),
      )!
    )
  }

  const where = and(...conditions)

  const [documents, [{ value: total }]] = await Promise.all([
    db.select({
      document,
      project: { id: project.id, name: project.name },
      contact: { id: contact.id, name: contact.name },
      uploadedBy: { id: user.id, firstName: user.firstName, lastName: user.lastName },
    }).from(document)
      .leftJoin(project, eq(document.projectId, project.id))
      .leftJoin(contact, eq(document.contactId, contact.id))
      .leftJoin(user, eq(document.uploadedById, user.id))
      .where(where)
      .orderBy(desc(document.createdAt))
      .offset((pageNum - 1) * limitNum)
      .limit(limitNum),
    db.select({ value: count() }).from(document).where(where),
  ])

  // Flatten the document columns up to the row level so list consumers can read
  // row.name / row.size / row.createdAt directly (they previously read the
  // wrapper and got undefined → blank rows dated "Invalid Date"). Relations stay
  // nested under project/contact/uploadedBy.
  const flatDocuments = documents.map((r: any) => ({ ...r.document, project: r.project, contact: r.contact, uploadedBy: r.uploadedBy }))

  return c.json({
    data: flatDocuments,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  })
})

// Stream a file from the private bucket. Authenticated + company-scoped: the key
// is prefixed with the owning companyId, so a user can only read their company's
// files. Powers doc.url / thumbnailUrl. Never serves user HTML/SVG inline.
app.get('/file/*', async (c) => {
  const currentUser = c.get('user') as any
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/documents\/file\//, ''))
  if (!key || key.includes('..')) return c.json({ error: 'Invalid key' }, 400)
  if (!key.startsWith(`${currentUser.companyId}/`)) return c.json({ error: 'Forbidden' }, 403)

  const obj = await fileService.getObject(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)

  const inlineOk = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'].includes(obj.contentType)
  c.header('Content-Type', inlineOk ? obj.contentType : 'application/octet-stream')
  c.header('X-Content-Type-Options', 'nosniff')
  if (!inlineOk) c.header('Content-Disposition', 'attachment')
  c.header('Cache-Control', 'private, max-age=86400')
  return c.body(obj.body)
})

// Get single document
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [result] = await db.select({
    document,
    project: { id: project.id, name: project.name, number: project.number },
    contact: { id: contact.id, name: contact.name },
    uploadedBy: { id: user.id, firstName: user.firstName, lastName: user.lastName },
  }).from(document)
    .leftJoin(project, eq(document.projectId, project.id))
    .leftJoin(contact, eq(document.contactId, contact.id))
    .leftJoin(user, eq(document.uploadedById, user.id))
    .where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId)))
    .limit(1)

  if (!result) return c.json({ error: 'Document not found' }, 404)
  return c.json(result)
})

// Upload document
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.parseBody()

  const file = body['file'] as File | undefined
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  let uploaded
  try {
    uploaded = await fileService.saveFile(file, currentUser.companyId, 'documents')
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }

  let filePath = uploaded.path
  let thumbnailPath = null

  if (uploaded.mimetype.startsWith('image/')) {
    try {
      filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 })
      thumbnailPath = await fileService.generateThumbnail(filePath, 200)
    } catch (err) {
      logger.logError(err, null, { action: 'processImage' })
    }
  }

  const name = (body['name'] as string) || uploaded.originalname
  const description = body['description'] as string | undefined
  const type = (body['type'] as string) || 'general'
  const projectId = body['projectId'] as string | undefined
  const contactId = body['contactId'] as string | undefined
  const jobId = body['jobId'] as string | undefined
  const invoiceId = body['invoiceId'] as string | undefined

  const [doc] = await db.insert(document).values({
    companyId: currentUser.companyId,
    name,
    description,
    type,
    filename: path.basename(filePath),
    originalName: uploaded.originalname,
    mimeType: uploaded.mimetype,
    size: uploaded.size,
    path: filePath,
    url: fileService.getFileUrl(filePath, currentUser.companyId),
    thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, currentUser.companyId) : null,
    projectId: projectId || null,
    contactId: contactId || null,
    jobId: jobId || null,
    invoiceId: invoiceId || null,
    uploadedById: currentUser.userId,
  }).returning()

  logger.audit('document_upload', currentUser.userId, currentUser.companyId, {
    documentId: doc.id,
    filename: doc.originalName,
  })

  return c.json(doc, 201)
})

// Upload multiple documents
app.post('/bulk', async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.parseBody({ all: true })

  const rawFiles = body['files'] || body['files[]']
  const files: File[] = Array.isArray(rawFiles)
    ? rawFiles.filter((f): f is File => f instanceof File)
    : rawFiles instanceof File ? [rawFiles] : []

  if (files.length === 0) {
    return c.json({ error: 'No files uploaded' }, 400)
  }

  const projectId = body['projectId'] as string | undefined
  const contactId = body['contactId'] as string | undefined
  const type = (body['type'] as string) || 'general'
  const documents: any[] = []

  for (const file of files) {
    let uploaded
    try {
      uploaded = await fileService.saveFile(file, currentUser.companyId, 'documents')
    } catch (err: any) {
      logger.logError(err, null, { action: 'saveFile', file: file.name })
      continue
    }

    let filePath = uploaded.path
    let thumbnailPath = null

    if (uploaded.mimetype.startsWith('image/')) {
      try {
        filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 })
        thumbnailPath = await fileService.generateThumbnail(filePath, 200)
      } catch (err) {
        logger.logError(err, null, { action: 'processImage', file: uploaded.originalname })
      }
    }

    const [doc] = await db.insert(document).values({
      companyId: currentUser.companyId,
      name: uploaded.originalname,
      type,
      filename: path.basename(filePath),
      originalName: uploaded.originalname,
      mimeType: uploaded.mimetype,
      size: uploaded.size,
      path: filePath,
      url: fileService.getFileUrl(filePath, currentUser.companyId),
      thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, currentUser.companyId) : null,
      projectId: projectId || null,
      contactId: contactId || null,
      uploadedById: currentUser.userId,
    }).returning()

    documents.push(doc)
  }

  logger.audit('bulk_document_upload', currentUser.userId, currentUser.companyId, {
    count: documents.length,
  })

  return c.json({ data: documents, count: documents.length }, 201)
})

// Update document metadata
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { name, description, type, projectId, contactId } = await c.req.json()

  const [existing] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Document not found' }, 404)

  const [doc] = await db.update(document).set({
    name,
    description,
    type,
    projectId: projectId || null,
    contactId: contactId || null,
    updatedAt: new Date(),
  }).where(eq(document.id, id)).returning()

  const [result] = await db.select({
    document,
    project: { id: project.id, name: project.name },
    contact: { id: contact.id, name: contact.name },
    uploadedBy: { id: user.id, firstName: user.firstName, lastName: user.lastName },
  }).from(document)
    .leftJoin(project, eq(document.projectId, project.id))
    .leftJoin(contact, eq(document.contactId, contact.id))
    .leftJoin(user, eq(document.uploadedById, user.id))
    .where(eq(document.id, id))
    .limit(1)

  return c.json(result)
})

// Delete document
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [doc] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId))).limit(1)
  if (!doc) return c.json({ error: 'Document not found' }, 404)

  try {
    if (doc.path) fileService.deleteFile(doc.path)
  } catch (err) {
    logger.logError(err, null, { action: 'deleteFile', documentId: doc.id })
  }

  await db.delete(document).where(eq(document.id, id))

  logger.audit('document_delete', currentUser.userId, currentUser.companyId, {
    documentId: doc.id,
    filename: doc.originalName,
  })

  return c.json({ success: true })
})

// Download document
app.get('/:id/download', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [doc] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId))).limit(1)

  if (!doc) return c.json({ error: 'Document not found' }, 404)
  if (!doc.path) return c.json({ error: 'File not found' }, 404)

  const obj = await fileService.getObject(doc.path)
  if (!obj) return c.json({ error: 'File not found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': doc.mimeType || obj.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${doc.originalName || path.basename(doc.path)}"`,
      'Content-Length': String(obj.body.byteLength),
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

// ==================== VERSION HISTORY ====================
// The document row always points at the CURRENT file. Uploading a new
// version snapshots the outgoing file first, so a plan revision never
// silently destroys the sheet a sub already built from.

async function ownedDocument(c: any) {
  const currentUser = c.get('user') as any
  const [doc] = await db.select().from(document)
    .where(and(eq(document.id, c.req.param('id')), eq(document.companyId, currentUser.companyId))).limit(1)
  return doc || null
}

app.get('/:id/versions', async (c) => {
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const versions = await db.select().from(documentVersion)
    .where(eq(documentVersion.documentId, doc.id)).orderBy(desc(documentVersion.versionNumber))
  return c.json({ data: versions, currentVersion: versions.length + 1 })
})

app.post('/:id/versions', async (c) => {
  const currentUser = c.get('user') as any
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)

  const body = await c.req.parseBody()
  const file = body['file'] as File | undefined
  if (!file || !(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400)

  let uploaded
  try {
    uploaded = await fileService.saveFile(file, currentUser.companyId, 'documents')
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }

  const [{ value: existingCount }] = await db.select({ value: count() }).from(documentVersion)
    .where(eq(documentVersion.documentId, doc.id))

  // snapshot the outgoing file, then point the document at the new one
  await db.insert(documentVersion).values({
    documentId: doc.id,
    versionNumber: Number(existingCount) + 1,
    filename: doc.filename,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    path: doc.path,
    url: doc.url,
    note: (body['note'] as string) || null,
    uploadedById: currentUser.id,
  })
  const [updated] = await db.update(document).set({
    filename: uploaded.filename,
    originalName: uploaded.originalname,
    mimeType: uploaded.mimetype,
    size: uploaded.size,
    path: uploaded.path,
    url: uploaded.url,
    updatedAt: new Date(),
  }).where(eq(document.id, doc.id)).returning()
  return c.json(updated, 201)
})

app.post('/:id/versions/:versionId/restore', async (c) => {
  const currentUser = c.get('user') as any
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const [version] = await db.select().from(documentVersion)
    .where(and(eq(documentVersion.id, c.req.param('versionId')), eq(documentVersion.documentId, doc.id))).limit(1)
  if (!version) return c.json({ error: 'Version not found' }, 404)

  const [{ value: existingCount }] = await db.select({ value: count() }).from(documentVersion)
    .where(eq(documentVersion.documentId, doc.id))
  // the current file becomes a version too, so a restore is always reversible
  await db.insert(documentVersion).values({
    documentId: doc.id,
    versionNumber: Number(existingCount) + 1,
    filename: doc.filename,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    path: doc.path,
    url: doc.url,
    note: `Superseded by restore of v${version.versionNumber}`,
    uploadedById: currentUser.id,
  })
  const [updated] = await db.update(document).set({
    filename: version.filename,
    originalName: version.originalName,
    mimeType: version.mimeType,
    size: version.size,
    path: version.path,
    url: version.url,
    updatedAt: new Date(),
  }).where(eq(document.id, doc.id)).returning()
  return c.json(updated)
})

app.get('/:id/versions/:versionId/download', async (c) => {
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const [version] = await db.select().from(documentVersion)
    .where(and(eq(documentVersion.id, c.req.param('versionId')), eq(documentVersion.documentId, doc.id))).limit(1)
  if (!version) return c.json({ error: 'Version not found' }, 404)
  const obj = await fileService.getObject(version.path)
  if (!obj) return c.json({ error: 'File not found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': version.mimeType || obj.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${version.originalName || path.basename(version.path)}"`,
      'Content-Length': String(obj.body.byteLength),
      'X-Content-Type-Options': 'nosniff',
    },
  })
})

// ==================== PLAN MARKUP ====================
// Annotation layers over a plan/photo. The drawing itself is client-side;
// the server stores the annotation JSON per named layer.

app.get('/:id/markups', async (c) => {
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const markups = await db.select().from(planMarkup)
    .where(eq(planMarkup.documentId, doc.id)).orderBy(desc(planMarkup.updatedAt))
  return c.json({ data: markups })
})

app.post('/:id/markups', async (c) => {
  const currentUser = c.get('user') as any
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const body = ((await c.req.json().catch(() => null)) ?? {}) as any
  if (typeof body.data !== 'string' || !body.data.length) return c.json({ error: 'Markup data is required' }, 400)
  const [markup] = await db.insert(planMarkup).values({
    documentId: doc.id,
    name: (typeof body.name === 'string' && body.name.trim()) || 'Markup',
    data: body.data,
    createdById: currentUser.id,
  }).returning()
  return c.json(markup, 201)
})

app.put('/:id/markups/:markupId', async (c) => {
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const body = ((await c.req.json().catch(() => null)) ?? {}) as any
  const update: Record<string, any> = { updatedAt: new Date() }
  if (typeof body.data === 'string' && body.data.length) update.data = body.data
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
  const [updated] = await db.update(planMarkup).set(update)
    .where(and(eq(planMarkup.id, c.req.param('markupId')), eq(planMarkup.documentId, doc.id))).returning()
  if (!updated) return c.json({ error: 'Markup not found' }, 404)
  return c.json(updated)
})

app.delete('/:id/markups/:markupId', async (c) => {
  const doc = await ownedDocument(c)
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const deleted = await db.delete(planMarkup)
    .where(and(eq(planMarkup.id, c.req.param('markupId')), eq(planMarkup.documentId, doc.id))).returning()
  if (!deleted.length) return c.json({ error: 'Markup not found' }, 404)
  return c.body(null, 204)
})

export default app
