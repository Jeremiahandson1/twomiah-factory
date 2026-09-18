// Media storage for product images — Cloudflare R2 (S3-compatible).
//
// Uploaded images are written to a PRIVATE per-tenant R2 bucket and served back
// through this backend's own `/media/*` route (see routes/media.ts). We do NOT
// hand out raw R2 public URLs: the factory injects R2 read/write credentials but
// does not (currently) configure a public bucket domain (R2_PUBLIC_BASE_URL), so
// a direct bucket URL would 403 in the browser. Proxying through the backend
// makes uploads work with zero extra Cloudflare/public-access configuration.
//
// The factory injects R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY /
// R2_BUCKET_NAME. R2_ENDPOINT is NOT injected, so we derive the S3 endpoint from
// the account id (the standard R2 form). Everything no-ops with a clear 503 if
// storage is unconfigured (e.g. local dev without R2).

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || ''
const BUCKET = process.env.R2_BUCKET_NAME || ''
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || ''
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || ''
// R2_ENDPOINT is not injected by the factory; derive it from the account id.
const ENDPOINT = process.env.R2_ENDPOINT || (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : '')

const CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** True when R2 credentials are present and uploads/reads can succeed. */
export function storageConfigured(): boolean {
  return !!(ENDPOINT && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY)
}

let _client: S3Client | null = null
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: ENDPOINT,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    })
  }
  return _client
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE_CONTROL,
  }))
}

/** Read an object back for the /media proxy. Returns null on 404. */
export async function getObject(key: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const bytes = await res.Body!.transformToByteArray()
    // Return a standalone ArrayBuffer (Hono's c.body() accepts it directly, and it
    // sidesteps the Uint8Array<ArrayBufferLike> vs <ArrayBuffer> lib mismatch).
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return { body, contentType: res.ContentType || 'application/octet-stream' }
  } catch (e: any) {
    if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
    throw e
  }
}

/** Best-effort delete (never throws — image row removal is the source of truth). */
export async function deleteObject(key: string): Promise<void> {
  try { await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })) } catch { /* non-blocking */ }
}

/** Extract the R2 key from a stored `.../media/<key>` URL, or null if not one of ours. */
export function keyFromMediaUrl(url: string): string | null {
  const m = /\/media\/(.+)$/.exec(url || '')
  return m ? m[1] : null
}
