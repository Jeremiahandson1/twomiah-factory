/**
 * R2 Storage Service
 *
 * Handles file uploads/deletes via S3-compatible API (Cloudflare R2).
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createId } from '@paralleldrive/cuid2'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME || 'photos'
const PUBLIC_URL = process.env.R2_PUBLIC_URL || ''

/**
 * Upload a photo to R2
 */
export async function uploadPhoto(
  companyId: string,
  jobId: string,
  file: { buffer: Buffer | ArrayBuffer; type: string; name?: string }
): Promise<{ url: string; key: string }> {
  const ext = file.type === 'image/png' ? 'png' : 'jpg'
  const key = `photos/${companyId}/${jobId}/${createId()}.${ext}`

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: file.buffer instanceof ArrayBuffer ? Buffer.from(file.buffer) : file.buffer,
    ContentType: file.type,
  }))

  const url = `${PUBLIC_URL}/${key}`
  return { url, key }
}

/**
 * Delete a photo from R2
 */
export async function deletePhoto(url: string): Promise<void> {
  const key = url.replace(`${PUBLIC_URL}/`, '')

  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }))
}

export default { uploadPhoto, deletePhoto }
