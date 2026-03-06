import { Hono } from 'hono'
import path from 'path'
import { db } from '../../db/index.ts'
import { document, project, contact, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import fileService, { upload, setUploadSubdir, handleUploadError } from '../services/fileUpload.ts'
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

  return c.json({
    data: documents,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  })
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
  // NOTE: File upload middleware (setUploadSubdir, upload.single, handleUploadError)
  // needs adaptation for Hono. This preserves the logic structure.
  const req = c.req.raw as any
  if (!req.file) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  const { name, description, type, projectId, contactId, jobId, invoiceId } = await c.req.json().catch(() => (req.body || {}))

  let filePath = req.file.path
  let thumbnailPath = null

  if (req.file.mimetype.startsWith('image/')) {
    try {
      filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 })
      thumbnailPath = await fileService.generateThumbnail(filePath, 200)
    } catch (err) {
      logger.logError(err, req, { action: 'processImage' })
    }
  }

  const [doc] = await db.insert(document).values({
    companyId: currentUser.companyId,
    name: name || req.file.originalname,
    description,
    type: type || 'general',
    filename: path.basename(filePath),
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
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
  const req = c.req.raw as any
  if (!req.files || req.files.length === 0) {
    return c.json({ error: 'No files uploaded' }, 400)
  }

  const { projectId, contactId, type } = await c.req.json().catch(() => (req.body || {}))
  const documents: any[] = []

  for (const file of req.files) {
    let filePath = file.path
    let thumbnailPath = null

    if (file.mimetype.startsWith('image/')) {
      try {
        filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 })
        thumbnailPath = await fileService.generateThumbnail(filePath, 200)
      } catch (err) {
        logger.logError(err, req, { action: 'processImage', file: file.originalname })
      }
    }

    const [doc] = await db.insert(document).values({
      companyId: currentUser.companyId,
      name: file.originalname,
      type: type || 'general',
      filename: path.basename(filePath),
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
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

  // Fetch joined data separately
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

  // Delete physical files
  try {
    if (doc.path) fileService.deleteFile(doc.path)
  } catch (err) {
    logger.logError(err, c.req.raw, { action: 'deleteFile', documentId: doc.id })
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

  // NOTE: Hono does not have a built-in res.download equivalent.
  // The caller should adapt this to stream the file or use a static file middleware.
  return c.json({ path: doc.path, filename: doc.originalName })
})

export default app
