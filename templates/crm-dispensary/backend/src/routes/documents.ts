import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import { db } from '../../db/index.ts'
import { document, contact, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import fileService from '../services/fileUpload.ts'
import logger from '../services/logger.ts'

const app = new Hono()
app.use('*', authenticate)

// List documents
app.get('/', async (c) => {
  const { contactId, orderId, type, search, page = '1', limit = '25' } = c.req.query() as any
  const currentUser = c.get('user') as any
  const pageNum = parseInt(page)
  const limitNum = parseInt(limit)

  const conditions: any[] = [eq(document.companyId, currentUser.companyId)]
  if (contactId) conditions.push(eq(document.contactId, contactId))
  if (orderId) conditions.push(eq(document.orderId, orderId))
  if (type) conditions.push(eq(document.type, type))
  if (search) {
    conditions.push(ilike(document.name, `%${search}%`))
  }

  const where = and(...conditions)

  const [documents, [{ value: total }]] = await Promise.all([
    db.select({
      document,
      contact: { id: contact.id, name: contact.name },
      uploadedBy: { id: user.id, firstName: user.firstName, lastName: user.lastName },
    }).from(document)
      .leftJoin(contact, eq(document.contactId, contact.id))
      .leftJoin(user, eq(document.uploadedBy, user.id))
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
    contact: { id: contact.id, name: contact.name },
    uploadedBy: { id: user.id, firstName: user.firstName, lastName: user.lastName },
  }).from(document)
    .leftJoin(contact, eq(document.contactId, contact.id))
    .leftJoin(user, eq(document.uploadedBy, user.id))
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

  const name = (body['name'] as string) || uploaded.originalname
  const type = (body['type'] as string) || 'general'
  const contactId = body['contactId'] as string | undefined
  const orderId = body['orderId'] as string | undefined
  const tags = body['tags'] ? JSON.parse(body['tags'] as string) : []

  const [doc] = await db.insert(document).values({
    companyId: currentUser.companyId,
    name,
    type,
    size: uploaded.size,
    url: fileService.getFileUrl(uploaded.path, currentUser.companyId),
    contactId: contactId || null,
    orderId: orderId || null,
    uploadedBy: currentUser.userId,
    tags,
  }).returning()

  logger.audit('document_upload', currentUser.userId, currentUser.companyId, {
    documentId: doc.id,
    filename: name,
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

  const contactId = body['contactId'] as string | undefined
  const orderId = body['orderId'] as string | undefined
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

    const [doc] = await db.insert(document).values({
      companyId: currentUser.companyId,
      name: uploaded.originalname,
      type,
      size: uploaded.size,
      url: fileService.getFileUrl(uploaded.path, currentUser.companyId),
      contactId: contactId || null,
      orderId: orderId || null,
      uploadedBy: currentUser.userId,
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
  const { name, type, contactId, orderId, tags } = await c.req.json()

  const [existing] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Document not found' }, 404)

  const updateData: any = { updatedAt: new Date() }
  if (name !== undefined) updateData.name = name
  if (type !== undefined) updateData.type = type
  if (contactId !== undefined) updateData.contactId = contactId || null
  if (orderId !== undefined) updateData.orderId = orderId || null
  if (tags !== undefined) updateData.tags = tags

  const [doc] = await db.update(document).set(updateData).where(eq(document.id, id)).returning()

  return c.json(doc)
})

// Delete document
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [doc] = await db.select().from(document).where(and(eq(document.id, id), eq(document.companyId, currentUser.companyId))).limit(1)
  if (!doc) return c.json({ error: 'Document not found' }, 404)

  await db.delete(document).where(eq(document.id, id))

  logger.audit('document_delete', currentUser.userId, currentUser.companyId, {
    documentId: doc.id,
    filename: doc.name,
  })

  return c.json({ success: true })
})

export default app
