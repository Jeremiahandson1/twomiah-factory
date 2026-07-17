/**
 * Storage abstraction: R2 (Cloudflare) in production, local filesystem
 * in dev. R2 uses an S3-compatible API; we keep all the credentials
 * R2_* prefixed so it's clear we're not using AWS S3.
 *
 * Switches by env:
 *   STORAGE_BACKEND=s3  → R2 client (requires R2_* env vars + bucket)
 *   STORAGE_BACKEND=local (or unset) → writes to ./uploads/ on disk
 *
 * Local uploads are served by server-static.ts at /uploads/*. In R2 mode,
 * objects are served from R2_PUBLIC_URL (typically a CDN like
 * https://cdn.example.com/) which the tenant points at the bucket.
 */
import fs from 'fs'
import path from 'path'
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

const BACKEND = process.env.STORAGE_BACKEND === 's3' ? 's3' : 'local'

let s3Client: S3Client | null = null
function getS3(): S3Client {
  if (s3Client) return s3Client
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
  }
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return s3Client
}

export interface UploadResult {
  url: string         // public URL the browser can fetch from
  storageKey: string  // canonical key for deletion
  bytes: number
  contentType: string
}

export async function uploadImage(buffer: Buffer, opts: {
  filename: string
  contentType: string
}): Promise<UploadResult> {
  const ext = path.extname(opts.filename).toLowerCase() || '.jpg'
  const key = `photos/${crypto.randomUUID()}${ext}`

  if (BACKEND === 's3') {
    const bucket = process.env.R2_BUCKET_NAME
    if (!bucket) throw new Error('R2_BUCKET_NAME not set')

    await getS3().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: opts.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    return {
      // Served same-origin via the /media proxy (services/mediaProxy.ts), which
      // streams from the private bucket — no public bucket / R2_PUBLIC_URL needed.
      url: `/media/${key}`,
      storageKey: key,
      bytes: buffer.length,
      contentType: opts.contentType,
    }
  }

  // Local fallback
  const uploadsDir = path.join(process.cwd(), 'uploads', 'photos')
  fs.mkdirSync(uploadsDir, { recursive: true })
  const filename = path.basename(key)
  fs.writeFileSync(path.join(uploadsDir, filename), buffer)
  return {
    url: '/uploads/photos/' + filename,
    storageKey: key,
    bytes: buffer.length,
    contentType: opts.contentType,
  }
}

export async function deleteImage(storageKey: string): Promise<void> {
  if (BACKEND === 's3') {
    const bucket = process.env.R2_BUCKET_NAME
    if (!bucket) return
    try {
      await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }))
    } catch (e: any) {
      console.warn('[Storage] R2 delete failed (object may already be gone):', e.message)
    }
    return
  }

  // Local
  const filename = path.basename(storageKey)
  const filepath = path.join(process.cwd(), 'uploads', 'photos', filename)
  try { fs.unlinkSync(filepath) } catch { /* ignore — already gone */ }
}

// Read an object back for the /media proxy. Returns null when not in R2 mode or 404.
export async function getObject(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  if (BACKEND !== 's3') return null
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) return null
  try {
    const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const bytes = await res.Body!.transformToByteArray()
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return { body, contentType: res.ContentType || 'application/octet-stream' }
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}
