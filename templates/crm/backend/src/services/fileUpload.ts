/**
 * File Upload Service
 *
 * Handles file uploads with:
 * - Multer storage configuration
 * - Image processing (sharp)
 * - Thumbnail generation
 * - File management utilities
 */

import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'
import logger from './logger.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE as string) || 10 * 1024 * 1024 // 10MB
const ALLOWED_MIMES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  all: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
}

// Ensure upload directories exist
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Create company-specific upload path
function getCompanyPath(companyId: string, subdir = ''): string {
  const companyDir = path.join(UPLOAD_DIR, companyId, subdir)
  ensureDir(companyDir)
  return companyDir
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req: any, file, cb) => {
    const companyId = req.user?.companyId || 'temp'
    const subdir = req.uploadSubdir || 'general'
    const uploadPath = getCompanyPath(companyId, subdir)
    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const filename = `${uuidv4()}${ext}`
    cb(null, filename)
  },
})

// File filter
const fileFilter = (allowedTypes: string) => (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const mimes = ALLOWED_MIMES[allowedTypes] || ALLOWED_MIMES.all
  if (mimes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`Invalid file type. Allowed: ${allowedTypes}`))
  }
}

// Multer instances
export const upload = {
  single: (fieldName: string, allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).single(fieldName),

  multiple: (fieldName: string, maxCount = 10, allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).array(fieldName, maxCount),

  fields: (fields: multer.Field[], allowedTypes = 'all') => multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: fileFilter(allowedTypes),
  }).fields(fields),
}

interface ProcessImageOptions {
  width?: number
  height?: number
  quality?: number
  format?: keyof sharp.FormatEnum
  fit?: keyof sharp.FitEnum
}

// Image processing
export async function processImage(filePath: string, options: ProcessImageOptions = {}): Promise<string> {
  const {
    width = 1200,
    height = 1200,
    quality = 80,
    format = 'jpeg',
    fit = 'inside',
  } = options

  const ext = path.extname(filePath)
  const outputPath = filePath.replace(ext, `.processed.${format}`)

  try {
    await sharp(filePath)
      .resize(width, height, { fit, withoutEnlargement: true })
      .toFormat(format, { quality })
      .toFile(outputPath)

    // Remove original
    fs.unlinkSync(filePath)

    // Rename processed to original name
    const finalPath = filePath.replace(ext, `.${format}`)
    fs.renameSync(outputPath, finalPath)

    return finalPath
  } catch (error) {
    logger.logError(error, null, { filePath, options })
    throw error
  }
}

// Generate thumbnail
export async function generateThumbnail(filePath: string, size = 200): Promise<string> {
  const ext = path.extname(filePath)
  const basename = path.basename(filePath, ext)
  const dirname = path.dirname(filePath)
  const thumbPath = path.join(dirname, `${basename}_thumb${ext}`)

  try {
    await sharp(filePath)
      .resize(size, size, { fit: 'cover' })
      .toFile(thumbPath)

    return thumbPath
  } catch (error) {
    logger.logError(error, null, { filePath, size })
    throw error
  }
}

// Delete file
export function deleteFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      logger.info('File deleted', { filePath })
      return true
    }
    return false
  } catch (error) {
    logger.logError(error, null, { filePath })
    throw error
  }
}

// Get file URL (for serving)
export function getFileUrl(filePath: string, companyId: string): string {
  const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/\\/g, '/')
  return `/uploads${relativePath}`
}

// File info
export function getFileInfo(filePath: string): { name: string; path: string; size: number; created: Date; modified: Date; extension: string } | null {
  try {
    const stats = fs.statSync(filePath)
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: path.extname(filePath).toLowerCase(),
    }
  } catch (error) {
    return null
  }
}

// Middleware to set upload subdirectory
export function setUploadSubdir(subdir: string) {
  return (req: any, res: any, next: any) => {
    req.uploadSubdir = subdir
    next()
  }
}

// Error handling middleware for multer
export function handleUploadError(err: any, req: any, res: any, next: any): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        error: 'File too large',
        maxSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`
      })
      return
    }
    res.status(400).json({ error: err.message })
    return
  }
  if (err) {
    res.status(400).json({ error: err.message })
    return
  }
  next()
}

export default {
  upload,
  processImage,
  generateThumbnail,
  deleteFile,
  getFileUrl,
  getFileInfo,
  setUploadSubdir,
  handleUploadError,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIMES,
}
