/**
 * Photo Service
 *
 * Handles photo uploads with:
 * - Image compression/resizing
 * - Thumbnail generation
 * - EXIF data extraction (GPS, timestamp)
 * - Organization by project/job
 */

import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import crypto from 'crypto'
const uuid = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { document, user, project, job } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'

// NOTE: The Drizzle schema does not have a dedicated `photo` table.
// Using the `document` table with type='photo' as the closest match.
// If a photo table is added to the schema, update references accordingly.

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
const PHOTOS_DIR = path.join(UPLOAD_DIR, 'photos')
const THUMBNAILS_DIR = path.join(UPLOAD_DIR, 'thumbnails')

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true })
  await fs.mkdir(THUMBNAILS_DIR, { recursive: true })
}
ensureDirs()

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

/**
 * Process and save uploaded photo
 */
export async function processPhoto(file: any, { companyId, projectId, jobId, userId, caption, category }: ProcessPhotoOptions) {
  const id = uuid()
  const ext = '.jpg' // Always convert to jpg
  const filename = `${id}${ext}`
  const thumbFilename = `${id}_thumb${ext}`

  const photoPath = path.join(PHOTOS_DIR, filename)
  const thumbPath = path.join(THUMBNAILS_DIR, thumbFilename)

  try {
    // Load image with sharp
    const image = sharp(file.buffer || file.path)
    const metadata = await image.metadata()

    // Resize and save main image
    await image
      .rotate() // Auto-rotate based on EXIF
      .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toFile(photoPath)

    // Generate thumbnail
    await sharp(file.buffer || file.path)
      .rotate()
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath)

    // Get final file sizes
    const [photoStats, thumbStats] = await Promise.all([
      fs.stat(photoPath),
      fs.stat(thumbPath),
    ])

    // Save to database using document table
    const [photo] = await db.insert(document).values({
      id,
      name: caption || file.originalname || 'photo.jpg',
      type: category || 'photo',
      filename,
      originalName: file.originalname || 'photo.jpg',
      mimeType: 'image/jpeg',
      size: photoStats.size,
      path: photoPath,
      url: `/uploads/photos/${filename}`,
      thumbnailUrl: `/uploads/thumbnails/${thumbFilename}`,
      description: caption,
      companyId,
      projectId: projectId || null,
      jobId: jobId || null,
      uploadedById: userId,
    }).returning()

    return photo
  } catch (error) {
    // Clean up files on error
    await fs.unlink(photoPath).catch(() => {})
    await fs.unlink(thumbPath).catch(() => {})
    throw error
  }
}

/**
 * Process multiple photos
 */
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

/**
 * Get photos with filters
 */
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

  // Only get photo-type documents
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

/**
 * Get single photo
 */
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

/**
 * Update photo
 */
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

/**
 * Delete photo
 */
export async function deletePhoto(id: string, companyId: string): Promise<boolean> {
  const [photo] = await db.select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  if (!photo) return false

  // Delete files
  const photoPath = path.join(PHOTOS_DIR, photo.filename)
  const thumbPath = photo.thumbnailUrl ? path.join(THUMBNAILS_DIR, path.basename(photo.thumbnailUrl)) : null

  await Promise.all([
    fs.unlink(photoPath).catch(() => {}),
    thumbPath ? fs.unlink(thumbPath).catch(() => {}) : Promise.resolve(),
  ])

  await db.delete(document).where(eq(document.id, id))
  return true
}

/**
 * Get photo file path
 */
export function getPhotoPath(filename: string): string {
  return path.join(PHOTOS_DIR, filename)
}

/**
 * Get thumbnail file path
 */
export function getThumbnailPath(filename: string): string {
  return path.join(THUMBNAILS_DIR, filename)
}

/**
 * Photo categories
 */
export const PHOTO_CATEGORIES = [
  'before',
  'during',
  'after',
  'progress',
  'issue',
  'material',
  'equipment',
  'safety',
  'inspection',
  'damage',
  'permit',
  'other',
]

export default {
  processPhoto,
  processPhotos,
  getPhotos,
  getPhoto,
  updatePhoto,
  deletePhoto,
  getPhotoPath,
  getThumbnailPath,
  PHOTO_CATEGORIES,
}
