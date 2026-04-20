// Tenant data export — used by the offboard flow to give customers their
// data before their services are decommissioned. Runs schema-agnostic:
// enumerates every table in the tenant DB's public schema and dumps rows
// to a single JSON bundle uploaded to R2.
//
// Large tenants can have hundreds of MB of data — we stream table-by-table
// into memory then serialize; good enough for V1. If tenants exceed ~500MB
// this should stream straight to S3 via multipart upload (not yet).

import { Client as PgClient } from 'pg'

const EXPORT_PREFIX = 'data-exports/'
// R2/S3 caps presigned URL expiry at 7 days (604800s). If the customer
// waits longer than that, they'll have to request a fresh export — email
// copy tells them so.
const SIGNED_URL_EXPIRES = 7 * 24 * 60 * 60

// Skip tables where dumping contents isn't useful or is problematic:
// migration tracking, session data, etc.
const SKIP_TABLES = new Set([
  '__drizzle_migrations',
  'drizzle_migrations',
  'pg_stat_statements',
  'session',
  'sessions',
])

export interface ExportResult {
  success: boolean
  signedUrl?: string
  expiresAt?: Date
  tableCount?: number
  rowCount?: number
  sizeBytes?: number
  error?: string
}

export async function exportTenantData(params: {
  tenantId: string
  tenantSlug: string
  tenantDatabaseUrl: string
}): Promise<ExportResult> {
  const client = new PgClient({ connectionString: params.tenantDatabaseUrl, connectionTimeoutMillis: 10_000 })
  try {
    await client.connect()

    // Enumerate public-schema tables
    const tableRes = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    )
    const tables = tableRes.rows.map(r => r.table_name).filter(t => !SKIP_TABLES.has(t))

    const bundle: Record<string, any[]> = {}
    let totalRows = 0
    for (const table of tables) {
      try {
        // Quote the identifier to avoid SQL-injection via a weirdly-named table.
        const res = await client.query('SELECT * FROM "' + table.replace(/"/g, '""') + '"')
        bundle[table] = res.rows
        totalRows += res.rowCount || 0
      } catch (err: any) {
        // Keep going on individual table failures; surface them so the customer knows.
        bundle[table] = [{ __exportError: err.message }]
      }
    }

    const exportedAt = new Date().toISOString()
    const envelope = {
      tenantId: params.tenantId,
      tenantSlug: params.tenantSlug,
      exportedAt,
      tableCount: Object.keys(bundle).length,
      totalRows,
      tables: bundle,
    }
    const jsonBuf = Buffer.from(JSON.stringify(envelope, null, 2), 'utf8')
    const key = EXPORT_PREFIX + params.tenantSlug + '/' + params.tenantSlug + '_export_' + exportedAt.replace(/[:.]/g, '-') + '.json'

    // Upload via the existing R2 client used for factory zips
    const uploaded = await uploadBufferToR2(jsonBuf, key, 'application/json')
    if (!uploaded) return { success: false, error: 'R2 not configured — cannot upload data export' }

    const signedUrl = await signR2Url(key, SIGNED_URL_EXPIRES)
    if (!signedUrl) return { success: false, error: 'Could not generate signed URL for export' }

    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES * 1000)
    return {
      success: true,
      signedUrl,
      expiresAt,
      tableCount: Object.keys(bundle).length,
      rowCount: totalRows,
      sizeBytes: jsonBuf.length,
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }
}

// ─── R2/S3 helpers scoped to this file ──────────────────────────────────────
// Separate from factoryStorage so we don't couple the zip upload pipeline
// to data-export plumbing; both happen to use the same R2 bucket.

let s3Client: any = null
let S3_BUCKET: string | null = null

async function initR2() {
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
  } else if (process.env.AWS_ACCESS_KEY_ID) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    S3_BUCKET = process.env.S3_BUCKET_NAME || null
  }
}

async function uploadBufferToR2(buf: Buffer, key: string, contentType: string): Promise<boolean> {
  await initR2()
  if (!s3Client || !S3_BUCKET) return false
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: contentType,
    ContentDisposition: 'attachment; filename="' + key.split('/').pop() + '"',
  }))
  return true
}

async function signR2Url(key: string, expiresIn: number): Promise<string | null> {
  await initR2()
  if (!s3Client || !S3_BUCKET) return null
  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn })
}
