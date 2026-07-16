/**
 * R2 Storage Service — private bucket + same-origin /media proxy.
 *
 * Photos are written to a PRIVATE R2 bucket and served back through this
 * service's own /media/<key> route (see routes/media.ts), so no public bucket
 * or R2_PUBLIC_BASE_URL is required. The factory injects R2_ACCOUNT_ID /
 * R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME but NOT R2_ENDPOINT,
 * so the endpoint is derived from the account id.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { createId } from '@paralleldrive/cuid2'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

const BUCKET = process.env.R2_BUCKET_NAME || 'photos'

/** True when R2 credentials are present and uploads/reads can succeed. */
export function storageConfigured(): boolean {
  return !!(ENDPOINT && BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

/** Upload a photo to the private bucket; returns a same-origin `/media/<key>` url. */
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
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  return { url: `/media/${key}`, key }
}

/** Delete a photo given its stored `/media/<key>` url. Best-effort. */
export async function deletePhoto(url: string): Promise<void> {
  const key = keyFromMediaUrl(url)
  if (!key) return
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
  } catch { /* non-blocking — the DB row is the source of truth */ }
}

/** Read an object back for the /media proxy. Returns null on 404. */
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

/** Extract the R2 key from a stored `/media/<key>` url. */
export function keyFromMediaUrl(url: string): string | null {
  const m = /\/media\/(.+)$/.exec(url || '')
  return m ? m[1] : null
}

export default { uploadPhoto, deletePhoto }
