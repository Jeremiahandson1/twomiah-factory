import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Media storage — Cloudflare R2 (private bucket) fronted by this service's own
// /media/<key> proxy (see routes/media.ts). Uploaded files are written PRIVATE and
// streamed back same-origin, so no public bucket / R2_PUBLIC_BASE_URL is required.
//
// The factory injects R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
// R2_BUCKET_NAME but NOT R2_ENDPOINT — so we DERIVE the endpoint from the account
// id (the standard R2 S3 form). Everything no-ops cleanly when unconfigured.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const BUCKET = process.env.R2_BUCKET_NAME || ''
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

/** True when R2 credentials are present and uploads/reads can succeed. */
export function storageConfigured(): boolean {
  return !!(ENDPOINT && BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

/** Upload to the private bucket; returns a same-origin `/media/<key>` display URL. */
export async function uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return `/media/${key}`
}

/** Best-effort delete (never throws — the DB row is the source of truth). */
export async function deleteFile(key: string): Promise<void> {
  try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })) } catch { /* non-blocking */ }
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

/** Extract the R2 key from a stored `/media/<key>` url (for deletes). */
export function keyFromMediaUrl(url: string): string | null {
  const m = /\/media\/(.+)$/.exec(url || '')
  return m ? m[1] : null
}

export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn })
}
