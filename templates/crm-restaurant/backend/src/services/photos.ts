/**
 * Photo Service — durable object storage (Cloudflare R2, private bucket).
 *
 * Job/project photos are stored PRIVATE in R2 and served back only through the
 * authenticated, company-scoped routes in routes/photos.ts (GET /:id/file and
 * /:id/thumbnail) — so they are never publicly reachable. Previously these wrote
 * to an ephemeral disk (UPLOAD_DIR/photos) that the factory does not persist, so
 * photos vanished on every redeploy.
 *
 * Image processing runs in-memory via sharp (no disk). The factory injects
 * R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME but
 * NOT R2_ENDPOINT, so the endpoint is derived from the account id.
 */

import sharp from 'sharp'
import crypto from 'crypto'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { db } from '../../db/index.ts'
import { document, user, project, job } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'

const uuid = () => crypto.randomUUID()

// NOTE: The Drizzle schema does not have a dedicated `photo` table.
// Using the `document` table with type='photo' as the closest match.

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')
const BUCKET = process.env.R2_BUCKET_NAME || ''

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

export function storageConfigured(): boolean {
  return !!(ENDPOINT && BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

async function put(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'private, max-age=31536000',
  }))
}

/** Read an object back for the authenticated serving routes. Returns null on 404. */
export async function getObject(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const bytes = await res.Body!.transformToByteArray()
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return { body, contentType: res.ContentType || 'application/octet-stream' }
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** Derive the thumbnail key from a stored main-photo key. */
export function thumbKeyFromPath(mainKey: string): string {
  return mainKey.replace(/\.jpg$/i, '_thumb.jpg')
}

// Image settings
const MAX_WIDTH = 2048
const MAX_HEIGHT = 2048
const THUMB_WIDTH = 300
const THUMB_HEIGHT = 300
const QUALITY = 85

interface ProcessPhotoOptions {
  companyId: string
  projectId?: string
  jobId?: string
  userId?: string
  caption?: string
  category?: string
}

/** Process and store an uploaded photo (main + thumbnail) in the private bucket. */
export async function processPhoto(file: any, { companyId, projectId, jobId, userId, caption, category }: ProcessPhotoOptions) {
  const id = uuid()
  const mainKey = `${companyId}/photos/${id}.jpg`
  const thumbKey = `${companyId}/photos/${id}_thumb.jpg`
  const input = file.buffer || file.path

  // Resize main image + generate thumbnail, both in-memory.
  const mainBuffer = await sharp(input)
    .rotate() // auto-orient from EXIF
    .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY })
    .toBuffer()
  const thumbBuffer = await sharp(input)
    .rotate()
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer()

  await Promise.all([put(mainKey, mainBuffer, 'image/jpeg'), put(thumbKey, thumbBuffer, 'image/jpeg')])

  const [photo] = await db.insert(document).values({
    id,
    name: caption || file.originalname || 'photo.jpg',
    type: category || 'photo',
    filename: `${id}.jpg`,
    originalName: file.originalname || 'photo.jpg',
    mimeType: 'image/jpeg',
    size: mainBuffer.length,
    path: mainKey,
    url: `/api/photos/${id}/file`,
    thumbnailUrl: `/api/photos/${id}/thumbnail`,
    description: caption,
    companyId,
    projectId: projectId || null,
    jobId: jobId || null,
    uploadedById: userId,
  }).returning()

  return photo
}

/** Process multiple photos. */
export async function processPhotos(files: any[], options: ProcessPhotoOptions) {
  const results: Array<{ success: boolean; photo?: any; error?: string; filename?: string }> = []
  for (const file of files) {
    try {
      const photo = await processPhoto(file, options)
      results.push({ success: true, photo })
    } catch (error: any) {
      results.push({ success: false, error: error.message, filename: file.originalname })
    }
  }
  return results
}

/** Get photos with filters. */
export async function getPhotos({ companyId, projectId, jobId, category, page = 1, limit = 50 }: {
  companyId: string
  projectId?: string
  jobId?: string
  category?: string
  page?: number
  limit?: number
}) {
  const conditions = [eq(document.companyId, companyId)]
  if (projectId) conditions.push(eq(document.projectId, projectId))
  if (jobId) conditions.push(eq(document.jobId, jobId))
  if (category) conditions.push(eq(document.type, category))
  conditions.push(eq(document.mimeType, 'image/jpeg'))

  const whereClause = and(...conditions)

  const [data, [totalResult]] = await Promise.all([
    db.select()
      .from(document)
      .leftJoin(user, eq(document.uploadedById, user.id))
      .leftJoin(project, eq(document.projectId, project.id))
      .leftJoin(job, eq(document.jobId, job.id))
      .where(whereClause)
      .orderBy(desc(document.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(document)
      .where(whereClause),
  ])

  const total = totalResult?.value ?? 0

  return {
    data: data.map(d => ({
      ...d.document,
      uploadedBy: d.user ? { firstName: d.user.firstName, lastName: d.user.lastName } : null,
      project: d.project ? { name: d.project.name, number: d.project.number } : null,
      job: d.job ? { title: d.job.title, number: d.job.number } : null,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/** Get single photo. */
export async function getPhoto(id: string, companyId: string) {
  const [result] = await db.select()
    .from(document)
    .leftJoin(user, eq(document.uploadedById, user.id))
    .leftJoin(project, eq(document.projectId, project.id))
    .leftJoin(job, eq(document.jobId, job.id))
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  if (!result) return null

  return {
    ...result.document,
    uploadedBy: result.user ? { firstName: result.user.firstName, lastName: result.user.lastName } : null,
    project: result.project ? { name: result.project.name, number: result.project.number } : null,
    job: result.job ? { title: result.job.title, number: result.job.number } : null,
  }
}

/** Update photo metadata. */
export async function updatePhoto(id: string, companyId: string, data: any) {
  const [photo] = await db.select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  if (!photo) return null

  const [updated] = await db.update(document)
    .set({
      description: data.caption,
      type: data.category,
      projectId: data.projectId,
      jobId: data.jobId,
    })
    .where(eq(document.id, id))
    .returning()

  return updated
}

/** Delete a photo (DB row + both R2 objects). */
export async function deletePhoto(id: string, companyId: string): Promise<boolean> {
  const [photo] = await db.select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  if (!photo) return false

  const mainKey = photo.path
  if (mainKey) {
    await Promise.all([
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: mainKey })).catch(() => {}),
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: thumbKeyFromPath(mainKey) })).catch(() => {}),
    ])
  }

  await db.delete(document).where(eq(document.id, id))
  return true
}

/** Photo categories */
export const PHOTO_CATEGORIES = [
  'before', 'during', 'after', 'progress', 'issue', 'material',
  'equipment', 'safety', 'inspection', 'damage', 'permit', 'other',
]

export default {
  processPhoto,
  processPhotos,
  getPhotos,
  getPhoto,
  updatePhoto,
  deletePhoto,
  getObject,
  thumbKeyFromPath,
  storageConfigured,
  PHOTO_CATEGORIES,
}
