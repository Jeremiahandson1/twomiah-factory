/**
 * Photo Service
 *
 * Handles photo uploads for dispensary:
 * - Product images
 * - Document attachments
 * - Image compression/resizing
 * - Thumbnail generation
 */

import path from 'path'
import fs from 'fs/promises'
import sharp from 'sharp'
import crypto from 'crypto'
const uuid = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { document, product } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'

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
  productId?: string
  userId?: string
  caption?: string
  category?: string
}

/**
 * Process and save uploaded photo
 */
export async function processPhoto(file: any, { companyId, productId, userId, caption, category }: ProcessPhotoOptions) {
  const id = uuid()
  const ext = '.jpg' // Always convert to jpg
  const filename = `${id}${ext}`
  const thumbFilename = `${id}_thumb${ext}`

  const photoPath = path.join(PHOTOS_DIR, filename)
  const thumbPath = path.join(THUMBNAILS_DIR, thumbFilename)

  try {
    // Load image with sharp
    const image = sharp(file.buffer || file.path)

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
    const [photoStats] = await Promise.all([
      fs.stat(photoPath),
      fs.stat(thumbPath),
    ])

    // Save to database using document table
    const [photo] = await db.insert(document).values({
      id,
      name: caption || file.originalname || 'photo.jpg',
      type: category || 'photo',
      url: `/uploads/photos/${filename}`,
      size: photoStats.size,
      companyId,
      uploadedBy: userId || null,
    }).returning()

    // If this is a product image, update the product's imageUrl
    if (productId) {
      await db.update(product)
        .set({ imageUrl: `/uploads/photos/${filename}` })
        .where(eq(product.id, productId))
    }

    return { ...photo, thumbnailUrl: `/uploads/thumbnails/${thumbFilename}` }
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
export async function getPhotos({ companyId, category, page = 1, limit = 50 }: {
  companyId: string
  category?: string
  page?: number
  limit?: number
}) {
  const conditions = [eq(document.companyId, companyId)]
  if (category) conditions.push(eq(document.type, category))

  const whereClause = and(...conditions)

  const [data, [totalResult]] = await Promise.all([
    db.select()
      .from(document)
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
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get single photo
 */
export async function getPhoto(id: string, companyId: string) {
  const [result] = await db.select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  return result || null
}

/**
 * Update photo metadata
 */
export async function updatePhoto(id: string, companyId: string, data: any) {
  const [photo] = await db.select()
    .from(document)
    .where(and(eq(document.id, id), eq(document.companyId, companyId)))

  if (!photo) return null

  const updateData: any = {}
  if (data.caption !== undefined) updateData.name = data.caption
  if (data.category !== undefined) updateData.type = data.category

  const [updated] = await db.update(document)
    .set(updateData)
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

  // Delete files if they exist locally
  if (photo.url) {
    const filename = path.basename(photo.url)
    const photoPath = path.join(PHOTOS_DIR, filename)
    const thumbPath = path.join(THUMBNAILS_DIR, filename.replace('.jpg', '_thumb.jpg'))

    await Promise.all([
      fs.unlink(photoPath).catch(() => {}),
      fs.unlink(thumbPath).catch(() => {}),
    ])
  }

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
 * Photo categories for a dispensary
 */
export const PHOTO_CATEGORIES = [
  'product',
  'menu',
  'storefront',
  'compliance',
  'receipt',
  'id_scan',
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
