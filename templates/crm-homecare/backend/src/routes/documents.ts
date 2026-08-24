import { Hono } from 'hono'
import path from 'path'
import fs from 'fs'
import { db } from '../../db/index.ts'
import { clientDocuments, clients } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/documents — the Document Management screen listed nothing because no
// list endpoint existed (404 → perpetual empty). Surface the real client
// documents that have been sent/signed so the screen shows genuine records.
app.get('/', async (c) => {
  const { entityType } = c.req.query()
  if (entityType && entityType !== 'client') return c.json([])

  const rows = await db.select({
    doc: clientDocuments,
    clientFirstName: clients.firstName,
    clientLastName: clients.lastName,
  })
    .from(clientDocuments)
    .leftJoin(clients, eq(clientDocuments.clientId, clients.id))
    .orderBy(desc(clientDocuments.sentAt))

  return c.json(rows.map(r => ({
    id: r.doc.id,
    entity_type: 'client',
    entity_id: r.doc.clientId,
    entity_name: `${r.clientFirstName || ''} ${r.clientLastName || ''}`.trim(),
    title: r.doc.title,
    filename: r.doc.title,
    status: r.doc.status,
    created_at: r.doc.sentAt,
    signed_at: r.doc.signedAt,
  })))
})

const uploadsDir = process.env.UPLOAD_DIR || './uploads'
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

// POST /:entityType/:entityId/upload
app.post('/:entityType/:entityId/upload', requireAdmin, async (c) => {
  const entityType = c.req.param('entityType')
  const dir = path.join(uploadsDir, entityType || 'misc')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ error: 'No file uploaded' }, 400)

  const maxSize = (parseInt(process.env.MAX_FILE_SIZE_MB || '10')) * 1024 * 1024
  if (file.size > maxSize) return c.json({ error: 'File too large' }, 400)

  const safe = file.name.replace(/[^a-z0-9.\-_]/gi, '_')
  const filename = `${Date.now()}-${safe}`
  const filePath = path.join(dir, filename)

  const arrayBuffer = await file.arrayBuffer()
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer))

  return c.json({
    filename,
    originalName: file.name,
    size: file.size,
    path: `/uploads/${entityType}/${filename}`,
  })
})

export default app
