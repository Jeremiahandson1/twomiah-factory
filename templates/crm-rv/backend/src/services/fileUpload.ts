/**
 * File Upload Service
 *
 * Handles file uploads with:
 * - Hono parseBody() for multipart form data
 * - Image processing (sharp)
 * - Thumbnail generation
 * - File management utilities
 */

import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import sharp from 'sharp'
import logger from './logger.ts'

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE as string) || 10 * 1024 * 1024 // 10MB
const ALLOWED_MIMES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  all: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getCompanyPath(companyId: string, subdir = ''): string {
  const companyDir = path.join(UPLOAD_DIR, companyId, subdir)
  ensureDir(companyDir)
  return companyDir
}

export interface UploadedFile {
  path: string
  originalname: string
  mimetype: string
  size: number
}

/**
 * Save a single file from Hono's parseBody() result.
 * Call with: const file = body['file'] as File
 */
export async function saveFile(
  file: File,
  companyId: string,
  subdir = 'general',
  allowedTypes = 'all'
): Promise<UploadedFile> {
  const mimes = ALLOWED_MIMES[allowedTypes] || ALLOWED_MIMES.all
  if (!mimes.includes(file.type)) {
    throw new Error(`Invalid file type: ${file.type}. Allowed: ${allowedTypes}`)
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`)
  }

  const ext = path.extname(file.name).toLowerCase()
  const filename = `${crypto.randomUUID()}${ext}`
  const uploadPath = getCompanyPath(companyId, subdir)
  const filePath = path.join(uploadPath, filename)

  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(filePath, buffer)

  return {
    path: filePath,
    originalname: file.name,
    mimetype: file.type,
    size: file.size,
  }
}

/**
 * Save multiple files from Hono's parseBody() result.
 */
export async function saveFiles(
  files: File[],
  companyId: string,
  subdir = 'general',
  allowedTypes = 'all'
): Promise<UploadedFile[]> {
  const results: UploadedFile[] = []
  for (const file of files) {
    results.push(await saveFile(file, companyId, subdir, allowedTypes))
  }
  return results
}

interface ProcessImageOptions {
  width?: number
  height?: number
  quality?: number
  format?: keyof sharp.FormatEnum
  fit?: keyof sharp.FitEnum
}

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

    fs.unlinkSync(filePath)

    const finalPath = filePath.replace(ext, `.${format}`)
    fs.renameSync(outputPath, finalPath)

    return finalPath
  } catch (error) {
    logger.logError(error, null, { filePath, options })
    throw error
  }
}

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

export function getFileUrl(filePath: string, companyId: string): string {
  const relativePath = filePath.replace(UPLOAD_DIR, '').replace(/\\/g, '/')
  return `/uploads${relativePath}`
}

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

export default {
  saveFile,
  saveFiles,
  processImage,
  generateThumbnail,
  deleteFile,
  getFileUrl,
  getFileInfo,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIMES,
}
