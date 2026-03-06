import { Hono } from 'hono'
import path from 'path'
import fs from 'fs'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

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
