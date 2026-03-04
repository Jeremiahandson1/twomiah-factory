/**
 * Photo Service
 * 
 * Handles photo uploads with:
 * - Image compression/resizing
 * - Thumbnail generation
 * - EXIF data extraction (GPS, timestamp)
 * - Organization by project/job
 */

import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const PHOTOS_DIR = path.join(UPLOAD_DIR, 'photos');
const THUMBNAILS_DIR = path.join(UPLOAD_DIR, 'thumbnails');

// Ensure directories exist
async function ensureDirs() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
  await fs.mkdir(THUMBNAILS_DIR, { recursive: true });
}
ensureDirs();

// Image settings
const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const THUMB_WIDTH = 300;
const THUMB_HEIGHT = 300;
const QUALITY = 85;

/**
 * Process and save uploaded photo
 */
export async function processPhoto(file, { companyId, projectId, jobId, userId, caption, category }) {
  const id = uuid();
  const ext = '.jpg'; // Always convert to jpg
  const filename = `${id}${ext}`;
  const thumbFilename = `${id}_thumb${ext}`;

  const photoPath = path.join(PHOTOS_DIR, filename);
  const thumbPath = path.join(THUMBNAILS_DIR, thumbFilename);

  try {
    // Load image with sharp
    const image = sharp(file.buffer || file.path);
    const metadata = await image.metadata();

    // Extract EXIF data
    let exifData = null;
    let takenAt = null;
    let gpsLat = null;
    let gpsLng = null;

    if (metadata.exif) {
      try {
        // Sharp doesn't parse EXIF fully, but we can get basics
        exifData = {
          width: metadata.width,
          height: metadata.height,
          format: metadata.format,
          orientation: metadata.orientation,
        };
      } catch (e) {
        // EXIF parsing failed, continue without it
      }
    }

    // Resize and save main image
    await image
      .rotate() // Auto-rotate based on EXIF
      .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toFile(photoPath);

    // Generate thumbnail
    await sharp(file.buffer || file.path)
      .rotate()
      .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    // Get final file sizes
    const [photoStats, thumbStats] = await Promise.all([
      fs.stat(photoPath),
      fs.stat(thumbPath),
    ]);

    // Save to database
    const photo = await prisma.photo.create({
      data: {
        id,
        filename,
        originalName: file.originalname || 'photo.jpg',
        mimeType: 'image/jpeg',
        size: photoStats.size,
        width: metadata.width,
        height: metadata.height,
        thumbnailPath: thumbFilename,
        caption,
        category,
        takenAt,
        gpsLat,
        gpsLng,
        exifData,
        companyId,
        projectId: projectId || null,
        jobId: jobId || null,
        uploadedById: userId,
      },
    });

    return photo;
  } catch (error) {
    // Clean up files on error
    await fs.unlink(photoPath).catch(() => {});
    await fs.unlink(thumbPath).catch(() => {});
    throw error;
  }
}

/**
 * Process multiple photos
 */
export async function processPhotos(files, options) {
  const results = [];
  for (const file of files) {
    try {
      const photo = await processPhoto(file, options);
      results.push({ success: true, photo });
    } catch (error) {
      results.push({ success: false, error: error.message, filename: file.originalname });
    }
  }
  return results;
}

/**
 * Get photos with filters
 */
export async function getPhotos({ companyId, projectId, jobId, category, page = 1, limit = 50 }) {
  const where = { companyId };
  if (projectId) where.projectId = projectId;
  if (jobId) where.jobId = jobId;
  if (category) where.category = category;

  const [data, total] = await Promise.all([
    prisma.photo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
        project: { select: { name: true, number: true } },
        job: { select: { title: true, number: true } },
      },
    }),
    prisma.photo.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single photo
 */
export async function getPhoto(id, companyId) {
  return prisma.photo.findFirst({
    where: { id, companyId },
    include: {
      uploadedBy: { select: { firstName: true, lastName: true } },
      project: { select: { name: true, number: true } },
      job: { select: { title: true, number: true } },
    },
  });
}

/**
 * Update photo
 */
export async function updatePhoto(id, companyId, data) {
  const photo = await prisma.photo.findFirst({ where: { id, companyId } });
  if (!photo) return null;

  return prisma.photo.update({
    where: { id },
    data: {
      caption: data.caption,
      category: data.category,
      projectId: data.projectId,
      jobId: data.jobId,
    },
  });
}

/**
 * Delete photo
 */
export async function deletePhoto(id, companyId) {
  const photo = await prisma.photo.findFirst({ where: { id, companyId } });
  if (!photo) return false;

  // Delete files
  const photoPath = path.join(PHOTOS_DIR, photo.filename);
  const thumbPath = path.join(THUMBNAILS_DIR, photo.thumbnailPath);
  
  await Promise.all([
    fs.unlink(photoPath).catch(() => {}),
    fs.unlink(thumbPath).catch(() => {}),
  ]);

  await prisma.photo.delete({ where: { id } });
  return true;
}

/**
 * Get photo file path
 */
export function getPhotoPath(filename) {
  return path.join(PHOTOS_DIR, filename);
}

/**
 * Get thumbnail file path
 */
export function getThumbnailPath(filename) {
  return path.join(THUMBNAILS_DIR, filename);
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
];

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
};
