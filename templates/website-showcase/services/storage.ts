/**
 * Image Storage Service
 *
 * Stores uploaded images in Cloudflare R2 (production) or local disk (dev).
 * Falls back to local disk if R2 env vars are missing.
 *
 * Required env vars for R2:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_URL
 *
 * Images are stored under a tenant-slug prefix so each contractor site
 * gets its own folder in the shared bucket:
 *   {TENANT_SLUG}/images/{filename}
 *   {TENANT_SLUG}/images/thumb_{filename}
 */

import fs from 'fs'
import path from 'path'
import appPaths from '../config/paths.ts'

// Tenant slug is baked in at deploy time
const TENANT_SLUG = '{{COMPANY_SLUG}}'
const R2_PREFIX = `${TENANT_SLUG}/images/`

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

// Detect whether R2 is configured
const USE_R2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET_NAME
)

let s3Client: any = null
let S3_BUCKET: string | null = null

async function initR2() {
  if (s3Client) return
  const { S3Client } = await import('@aws-sdk/client-s3')
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  S3_BUCKET = process.env.R2_BUCKET_NAME!
  console.log(`[Storage] Using Cloudflare R2, bucket: ${S3_BUCKET}, prefix: ${R2_PREFIX}`)
}

if (USE_R2) {
  initR2().catch(e =>
    console.error('[Storage] R2 init failed — falling back to local disk:', e.message)
  )
} else {
  console.log('[Storage] Using LOCAL disk (set R2 env vars for cloud storage)')
}

// ─── Public URL for an image ─────────────────────────────────────

export function getImageUrl(filename: string): string {
  if (USE_R2 && s3Client && R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}/${R2_PREFIX}${filename}`
  }
  return `/uploads/${filename}`
}

// ─── Upload a buffer to storage ──────────────────────────────────

export async function uploadFile(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  if (USE_R2 && s3Client && S3_BUCKET) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const key = R2_PREFIX + filename

    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )
    return getImageUrl(filename)
  }

  // Local fallback
  const uploadsDir = appPaths.uploads
  fs.writeFileSync(path.join(uploadsDir, filename), buffer)
  return `/uploads/${filename}`
}

// ─── Delete a file from storage ──────────────────────────────────

export async function deleteFile(filename: string): Promise<void> {
  if (USE_R2 && s3Client && S3_BUCKET) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const key = R2_PREFIX + filename
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })
    )
    return
  }

  // Local fallback
  const filepath = path.join(appPaths.uploads, filename)
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath)
  }
}

// ─── Check if a file exists in storage ───────────────────────────

export async function fileExists(filename: string): Promise<boolean> {
  if (USE_R2 && s3Client && S3_BUCKET) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3')
    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: S3_BUCKET, Key: R2_PREFIX + filename })
      )
      return true
    } catch {
      return false
    }
  }

  return fs.existsSync(path.join(appPaths.uploads, filename))
}

// ─── List all image files in storage ─────────────────────────────

export async function listFiles(): Promise<string[]> {
  if (USE_R2 && s3Client && S3_BUCKET) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const result = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: R2_PREFIX,
        MaxKeys: 1000,
      })
    )
    return (result.Contents || [])
      .map((obj: any) => obj.Key?.replace(R2_PREFIX, '') || '')
      .filter((name: string) => name && !name.includes('/'))
  }

  // Local fallback
  const uploadsDir = appPaths.uploads
  if (!fs.existsSync(uploadsDir)) return []
  return fs.readdirSync(uploadsDir)
}

export { USE_R2 }
