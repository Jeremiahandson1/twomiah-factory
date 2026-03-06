import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import { db } from '../../db/index.ts'
import { document, project, contact, user } from '../../db/schema.ts'
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
  if (!doc.path || !fs.existsSync(doc.path)) return c.json({ error: 'File not found' }, 404)

  const fileBuffer = fs.readFileSync(doc.path)
  return new Response(fileBuffer, {
    headers: {
      'Content-Type': doc.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${doc.originalName || path.basename(doc.path)}"`,
      'Content-Length': String(fileBuffer.length),
    },
  })
})

export default app
