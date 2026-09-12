// File storage — ONE implementation for every CRM template: a PRIVATE per-tenant Cloudflare R2 bucket.
// Files are never publicly reachable; they are streamed back only through authenticated, company-scoped
// routes (documents.ts `/file/*` + `/:id/download`, photos.ts `/:id/file`). "path" values are opaque R2
// keys prefixed with the owning companyId, which is what the serving routes check.
//
// The factory injects R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME but NOT
// R2_ENDPOINT, so the endpoint is derived from the account id. Image processing is in-memory via sharp.
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export const ALLOWED_MIMES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
  spreadsheet: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
  all: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain'],
}

/** Raster types that may be served inline; everything else user-uploaded is forced to download (stored-XSS). */
export const INLINE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']

export interface UploadedFile {
  /** opaque R2 key */
  path: string
  originalname: string
  mimetype: string
  size: number
}

export interface StoredObject { body: ArrayBuffer; contentType: string }

export interface FileStorageOptions {
  /** Max upload size in bytes. Default env MAX_FILE_SIZE or 10 MB. */
  maxFileSize?: number
  /** URL prefix the authenticated file route is mounted at. Default /api/documents/file/ */
  fileUrlPrefix?: string
}

/** Sniff the magic bytes of the formats a browser could otherwise be tricked into rendering. */
export function sniffType(b: Buffer): string | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}
const SNIFFABLE = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Base MIME type: browsers append parameters ("text/plain;charset=utf-8"), and case varies. */
export const baseMime = (type: string | undefined | null) => (type || '').split(';')[0].trim().toLowerCase()

export function createFileStorage(options: FileStorageOptions = {}) {
  const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
  const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')
  const BUCKET = process.env.R2_BUCKET_NAME || ''
  const MAX_FILE_SIZE = options.maxFileSize || parseInt(process.env.MAX_FILE_SIZE as string) || 10 * 1024 * 1024
  const fileUrlPrefix = options.fileUrlPrefix || '/api/documents/file/'
  const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' },
  })

  /** True when R2 credentials are present and uploads/reads can succeed. */
  const storageConfigured = () => !!(ENDPOINT && BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)

  async function put(key: string, body: Buffer, contentType: string): Promise<void> {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=31536000' }))
  }

  /** Read an object back for the authenticated serving routes. Returns null when it does not exist. */
  async function getObject(key: string): Promise<StoredObject | null> {
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

  /** Validate (type allowlist, size, magic bytes) and store one file under `<companyId>/<subdir>/<uuid><ext>`. */
  async function saveFile(file: File, companyId: string, subdir = 'general', allowedTypes = 'all'): Promise<UploadedFile> {
    const mimes = ALLOWED_MIMES[allowedTypes] || ALLOWED_MIMES.all
    const type = baseMime(file.type)
    if (!mimes.includes(type)) throw new Error(`Unsupported file type${type ? ` (${type})` : ''}. Allowed: images, PDF, Word, Excel, CSV and text files.`)
    if (file.size > MAX_FILE_SIZE) throw new Error(`File too large. Max size: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`)
    const buffer = Buffer.from(await file.arrayBuffer())
    // evil.pdf that is really HTML is rejected: the bytes must match what the file claims to be.
    if (SNIFFABLE.includes(type) && sniffType(buffer) !== type) throw new Error(`File content does not match its declared type (${type}).`)
    const ext = path.extname(file.name || '').toLowerCase().slice(0, 10)
    const key = `${companyId}/${subdir}/${crypto.randomUUID()}${ext}`
    await put(key, buffer, type)
    return { path: key, originalname: file.name || `upload${ext}`, mimetype: type, size: file.size }
  }

  async function saveFiles(files: File[], companyId: string, subdir = 'general', allowedTypes = 'all'): Promise<UploadedFile[]> {
    const out: UploadedFile[] = []
    for (const f of files) out.push(await saveFile(f, companyId, subdir, allowedTypes))
    return out
  }

  /** Resize an already-stored image in place (download → sharp → re-upload under the same key). */
  async function processImage(key: string, o: { width?: number; height?: number; quality?: number; format?: keyof sharp.FormatEnum; fit?: keyof sharp.FitEnum } = {}): Promise<string> {
    const { width = 1200, height = 1200, quality = 80, format = 'jpeg', fit = 'inside' } = o
    const obj = await getObject(key)
    if (!obj) return key
    const out = await sharp(Buffer.from(obj.body)).rotate().resize(width, height, { fit, withoutEnlargement: true }).toFormat(format, { quality }).toBuffer()
    await put(key, out, `image/${format === 'jpeg' ? 'jpeg' : String(format)}`)
    return key
  }

  /** Thumbnail key derived from a main key: `<key>_thumb<ext>`. */
  const thumbKeyFor = (key: string) => { const ext = path.extname(key); return `${key.slice(0, key.length - ext.length)}_thumb${ext || '.jpg'}` }

  /** Generate a square thumbnail beside the given key and return the thumbnail key. */
  async function generateThumbnail(key: string, size = 200): Promise<string> {
    const obj = await getObject(key)
    if (!obj) return key
    const thumb = await sharp(Buffer.from(obj.body)).rotate().resize(size, size, { fit: 'cover' }).toBuffer()
    const thumbKey = thumbKeyFor(key)
    await put(thumbKey, thumb, obj.contentType.startsWith('image/') ? obj.contentType : 'image/jpeg')
    return thumbKey
  }

  /** Delete an object by key. Best-effort, non-blocking — the DB row is the source of truth. */
  function deleteFile(key: string): boolean {
    if (!key) return false
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {})
    return true
  }

  /** URL an authenticated client fetches the file from (served company-scoped by the documents route). */
  const getFileUrl = (key: string, _companyId?: string) => `${fileUrlPrefix}${key}`

  return { saveFile, saveFiles, processImage, generateThumbnail, thumbKeyFor, deleteFile, getFileUrl, getObject, put, storageConfigured, MAX_FILE_SIZE, ALLOWED_MIMES }
}

export type FileStorage = ReturnType<typeof createFileStorage>
