/**
 * Factory Zip Storage
 *
 * Stores generated zip files in R2/S3 (production) or local disk (dev).
 * Falls back to local if S3 is not configured.
 *
 * Env vars:
 *   STORAGE_BACKEND=s3
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   -- or --
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
 */

import fs from 'fs'
import path from 'path'

const STORAGE_BACKEND = process.env.STORAGE_BACKEND || 'local'
const USE_S3 = STORAGE_BACKEND === 's3'

let s3Client: any = null
let S3_BUCKET: string | null = null

async function initS3() {
  if (s3Client) return
  const { S3Client } = await import('@aws-sdk/client-s3')
  const isR2 = !!process.env.R2_ACCOUNT_ID
  if (isR2) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
    S3_BUCKET = process.env.R2_BUCKET_NAME || null
    console.log('[FactoryStorage] Using Cloudflare R2, bucket:', S3_BUCKET)
  } else {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    S3_BUCKET = process.env.S3_BUCKET_NAME || null
    console.log('[FactoryStorage] Using AWS S3, bucket:', S3_BUCKET)
  }
}

if (USE_S3) {
  initS3().catch(e => console.warn('[FactoryStorage] S3 init failed:', e.message))
} else {
  console.log('[FactoryStorage] Using LOCAL disk — zips will be lost on Render redeploy. Set STORAGE_BACKEND=s3 for production.')
}

const S3_PREFIX = 'factory-builds/'

export async function uploadZip(localZipPath: string, zipName: string): Promise<{ storageKey: string; storageType: 's3' | 'local' }> {
  if (!USE_S3 || !s3Client || !S3_BUCKET) {
    return { storageKey: localZipPath, storageType: 'local' }
  }

  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const key = S3_PREFIX + zipName
  const fileBuffer = fs.readFileSync(localZipPath)

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: 'application/zip',
    ContentDisposition: 'attachment; filename="' + zipName + '"',
  }))

  console.log('[FactoryStorage] Uploaded zip to S3:', key)
  try { fs.unlinkSync(localZipPath) } catch { /* ignore */ }

  return { storageKey: key, storageType: 's3' }
}

export async function getZipDownloadUrl(storageKey: string, storageType: string, expiresIn = 3600): Promise<string | null> {
  if (storageType === 's3' && s3Client && S3_BUCKET) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })
    return getSignedUrl(s3Client, command, { expiresIn })
  }
  if (fs.existsSync(storageKey)) return storageKey
  return null
}

export async function deleteZip(storageKey: string, storageType: string): Promise<void> {
  try {
    if (storageType === 's3' && s3Client && S3_BUCKET) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
      await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }))
      console.log('[FactoryStorage] Deleted S3 zip:', storageKey)
    } else if (fs.existsSync(storageKey)) {
      fs.unlinkSync(storageKey)
    }
  } catch (err: any) {
    console.warn('[FactoryStorage] Failed to delete zip:', err.message)
  }
}

