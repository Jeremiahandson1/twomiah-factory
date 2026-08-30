/**
 * File Upload Service — durable object storage (Cloudflare R2, private bucket).
 *
 * Files are stored in a PRIVATE per-tenant R2 bucket (no public URL). They are
 * served back ONLY through authenticated, company-scoped routes in documents.ts
 * (GET /api/documents/:id/download and GET /api/documents/file/*), which stream
 * from R2 — so private business documents are never publicly reachable.
 *
 * The public API (saveFile / processImage / generateThumbnail / getFileUrl /
 * deleteFile) is unchanged so existing callers (documents.ts, portal.ts) work as
 * before; "path" values are now opaque R2 keys instead of disk paths. Image
 * processing runs in-memory via sharp (no disk needed).
 *
 * The factory injects R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
 * R2_BUCKET_NAME but NOT R2_ENDPOINT, so the endpoint is derived from the account id.
 */

import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import logger from './logger.ts'

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

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE as string) || 10 * 1024 * 1024 // 10MB
const ALLOWED_MIMES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  all: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
}

/** True when R2 credentials are present and uploads/reads can succeed. */
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

export interface UploadedFile {
  path: string          // opaque R2 key
  originalname: string
  mimetype: string
  size: number
}

/** Save a single file from Hono's parseBody() result to the private bucket. */
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
  const key = `${companyId}/${subdir}/${crypto.randomUUID()}${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  // Verify magic bytes match the declared type so evil.pdf (really HTML) is rejected. (R2-05)
  const _b = buffer
  const _sniff = (_b.length >= 4 && _b[0] === 0x25 && _b[1] === 0x50 && _b[2] === 0x44 && _b[3] === 0x46) ? 'application/pdf'
    : (_b.length >= 8 && _b[0] === 0x89 && _b[1] === 0x50 && _b[2] === 0x4e && _b[3] === 0x47) ? 'image/png'
    : (_b.length >= 3 && _b[0] === 0xff && _b[1] === 0xd8 && _b[2] === 0xff) ? 'image/jpeg'
    : (_b.length >= 4 && _b[0] === 0x47 && _b[1] === 0x49 && _b[2] === 0x46 && _b[3] === 0x38) ? 'image/gif'
    : (_b.length >= 12 && _b.toString('ascii', 0, 4) === 'RIFF' && _b.toString('ascii', 8, 12) === 'WEBP') ? 'image/webp'
    : null
  const _sniffable = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']
  if (_sniffable.includes(file.type) && _sniff !== file.type) {
    throw new Error('File content does not match its declared type (' + file.type + ').')
  }

  await put(key, buffer, file.type)

  return { path: key, originalname: file.name, mimetype: file.type, size: file.size }
}

/** Save multiple files. */
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

/** Resize an already-stored image in place (download → sharp → re-upload same key). */
export async function processImage(key: string, options: ProcessImageOptions = {}): Promise<string> {
  const { width = 1200, height = 1200, quality = 80, format = 'jpeg', fit = 'inside' } = options
  try {
    const obj = await getObject(key)
    if (!obj) return key
    const out = await sharp(Buffer.from(obj.body))
      .resize(width, height, { fit, withoutEnlargement: true })
      .toFormat(format, { quality })
      .toBuffer()
    await put(key, out, `image/${format === 'jpeg' ? 'jpeg' : String(format)}`)
    return key
  } catch (error) {
    logger.error('processImage failed', { key, error: (error as Error)?.message })
    throw error
  }
}

/** Generate a thumbnail beside the given key and return the thumbnail key. */
export async function generateThumbnail(key: string, size = 200): Promise<string> {
  try {
    const obj = await getObject(key)
    if (!obj) return key
    const thumb = await sharp(Buffer.from(obj.body)).resize(size, size, { fit: 'cover' }).toBuffer()
    const ext = path.extname(key)
    const thumbKey = `${key.slice(0, key.length - ext.length)}_thumb${ext || '.jpg'}`
    await put(thumbKey, thumb, obj.contentType.startsWith('image/') ? obj.contentType : 'image/jpeg')
    return thumbKey
  } catch (error) {
    logger.error('generateThumbnail failed', { key, size, error: (error as Error)?.message })
    throw error
  }
}

/** Delete an object by key. Best-effort, non-blocking. */
export function deleteFile(key: string): boolean {
  s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch((error) => {
    logger.error('deleteFile failed', { key, error: (error as Error)?.message })
  })
  return true
}

/**
 * URL an authenticated client uses to fetch the file. Served (company-scoped) by
 * GET /api/documents/file/* in documents.ts — NOT a public URL.
 */
export function getFileUrl(key: string, _companyId?: string): string {
  return `/api/documents/file/${key}`
}

export default {
  saveFile,
  saveFiles,
  processImage,
  generateThumbnail,
  deleteFile,
  getFileUrl,
  getObject,
  storageConfigured,
  MAX_FILE_SIZE,
  ALLOWED_MIMES,
}
