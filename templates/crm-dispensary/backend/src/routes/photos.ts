import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import photoService from '../services/photos.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Get photos
app.get('/', requirePermission('documents:read'), async (c) => {
  const user = c.get('user') as any
  const projectId = c.req.query('projectId')
  const jobId = c.req.query('jobId')
  const category = c.req.query('category')
  const page = c.req.query('page') || '1'
  const limit = c.req.query('limit') || '50'

  const result = await photoService.getPhotos({
    companyId: user.companyId,
    projectId,
    jobId,
    category,
    page: parseInt(page),
    limit: parseInt(limit),
  })

  return c.json(result)
})

// Get single photo
app.get('/:id', requirePermission('documents:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const photo = await photoService.getPhoto(id, user.companyId)
  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }
  return c.json(photo)
})

// Get photo file
app.get('/:id/file', requirePermission('documents:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const photo = await photoService.getPhoto(id, user.companyId)
  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }

  const filePath = photoService.getPhotoPath(photo.filename)
  const fs = await import('fs')
  const fileBuffer = fs.readFileSync(filePath)
  return new Response(fileBuffer, {
    headers: { 'Content-Type': 'image/jpeg' },
  })
})

// Get thumbnail
app.get('/:id/thumbnail', requirePermission('documents:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const photo = await photoService.getPhoto(id, user.companyId)
  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }

  const filePath = photoService.getThumbnailPath(photo.thumbnailPath)
  const fs = await import('fs')
  const fileBuffer = fs.readFileSync(filePath)
  return new Response(fileBuffer, {
    headers: { 'Content-Type': 'image/jpeg' },
  })
})

// Upload single photo
app.post('/', requirePermission('documents:create'), async (c) => {
  const user = c.get('user') as any
  const formData = await c.req.formData()
  const photoFile = formData.get('photo') as File | null

  if (!photoFile) {
    return c.json({ error: 'No photo uploaded' }, 400)
  }

  const projectId = formData.get('projectId') as string | null
  const jobId = formData.get('jobId') as string | null
  const caption = formData.get('caption') as string | null
  const category = formData.get('category') as string | null

  // Convert File to a multer-like object for the service
  const buffer = Buffer.from(await photoFile.arrayBuffer())
  const fileObj = {
    buffer,
    originalname: photoFile.name,
    mimetype: photoFile.type,
    size: photoFile.size,
  }

  const photo = await photoService.processPhoto(fileObj, {
    companyId: user.companyId,
    projectId: projectId || null,
    jobId: jobId || null,
    userId: user.userId,
    caption,
    category,
  })

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'photo',
    entityId: photo.id,
    entityName: photo.originalName,
    req: { user },
  })

  return c.json(photo, 201)
})

// Upload multiple photos
app.post('/bulk', requirePermission('documents:create'), async (c) => {
  const user = c.get('user') as any
  const formData = await c.req.formData()
  const photoFiles = formData.getAll('photos') as File[]

  if (!photoFiles || photoFiles.length === 0) {
    return c.json({ error: 'No photos uploaded' }, 400)
  }

  const projectId = formData.get('projectId') as string | null
  const jobId = formData.get('jobId') as string | null
  const category = formData.get('category') as string | null

  // Convert Files to multer-like objects
  const fileObjs = await Promise.all(
    photoFiles.map(async (f) => ({
      buffer: Buffer.from(await f.arrayBuffer()),
      originalname: f.name,
      mimetype: f.type,
      size: f.size,
    }))
  )

  const results = await photoService.processPhotos(fileObjs, {
    companyId: user.companyId,
    projectId: projectId || null,
    jobId: jobId || null,
    userId: user.userId,
    category,
  })

  const successful = results.filter((r: any) => r.success)
  if (successful.length > 0) {
    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'photo',
      entityName: `${successful.length} photos uploaded`,
      metadata: { count: successful.length, projectId, jobId },
      req: { user },
    })
  }

  return c.json({
    uploaded: successful.length,
    failed: results.length - successful.length,
    results,
  }, 201)
})

// Update photo
app.put('/:id', requirePermission('documents:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { caption, category, projectId, jobId } = await c.req.json()

  const photo = await photoService.updatePhoto(id, user.companyId, {
    caption,
    category,
    projectId,
    jobId,
  })

  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }

  return c.json(photo)
})

// Delete photo
app.delete('/:id', requirePermission('documents:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const photo = await photoService.getPhoto(id, user.companyId)
  if (!photo) {
    return c.json({ error: 'Photo not found' }, 404)
  }

  await photoService.deletePhoto(id, user.companyId)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'photo',
    entityId: id,
    entityName: photo.originalName,
    req: { user },
  })

  return c.body(null, 204)
})

// Get categories
app.get('/meta/categories', async (c) => {
  return c.json(photoService.PHOTO_CATEGORIES)
})

export default app
