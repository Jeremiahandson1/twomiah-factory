/**
 * Delete R2 buckets left behind by tenants that no longer exist.
 *
 *   bun run scripts/cleanup-orphan-buckets.ts           # list what it would delete
 *   bun run scripts/cleanup-orphan-buckets.ts --apply   # delete them
 *
 * Teardown used to leave the bucket behind (fixed in testCleanup.ts); this
 * clears what accumulated before that. One-off in intent, safe to re-run.
 *
 * Deleting storage is not reversible, so a bucket has to fail every test below
 * before it is touched:
 *
 *   1. It must look like a tenant media bucket (<something>-media).
 *   2. It must not belong to ANY tenant row in Supabase — any status, not just
 *      active. A tenant mid-offboard still owns its files.
 *   3. It must be empty. A non-empty bucket is reported and skipped: an
 *      unexpected object means an assumption here is wrong, and the answer to
 *      that is a human looking, not a delete.
 *   4. It must not be on the protected list.
 *
 * Dry run by default.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
  }
}

const APPLY = process.argv.includes('--apply')

// Buckets that are not tenant media and must never be swept, whatever the
// name-matching says.
const PROTECTED = new Set([
  process.env.R2_BUCKET_NAME,        // the factory's own bucket — holds the backups
  'twomiah-offboard',
  'aplus-cases-media',               // a real product, not a tenant
])

const { createClient } = await import('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const { S3Client, ListBucketsCommand, ListObjectsV2Command, DeleteBucketCommand } =
  await import('@aws-sdk/client-s3')

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

// Every tenant, any status — a row mid-offboard still owns its files.
const { data: tenants, error } = await supabase.from('tenants').select('slug, status')
if (error) {
  console.error('Could not read tenants:', error.message)
  process.exit(1)
}
const slugs = (tenants || []).map(t => t.slug).filter(Boolean) as string[]
console.log('tenant rows in Supabase:', slugs.length)

const all: any = await s3.send(new ListBucketsCommand({}))
const buckets = (all.Buckets || []).map((b: any) => String(b.Name))
console.log('buckets on the account:', buckets.length)
console.log('')

const orphans: string[] = []
const skipped: string[] = []

for (const name of buckets) {
  if (PROTECTED.has(name)) { skipped.push(name + ' — protected'); continue }
  if (!name.endsWith('-media')) { skipped.push(name + ' — not a tenant media bucket'); continue }

  // Owned by a live tenant row? The bucket is <slug><suffix>-media, so match on
  // the slug boundary the same way teardown does.
  const owner = slugs.find(s => name === s + '-media' || (name.startsWith(s + '-') && name.endsWith('-media')))
  if (owner) { skipped.push(name + ' — belongs to tenant ' + owner); continue }

  let count = 0
  try {
    const page: any = await s3.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }))
    count = (page.Contents || []).length
  } catch (e: any) {
    skipped.push(name + ' — cannot list (' + (e?.name || e?.message) + ')')
    continue
  }
  if (count > 0) { skipped.push(name + ' — NOT EMPTY, left alone for a human to look at'); continue }

  orphans.push(name)
}

console.log('skipped (' + skipped.length + '):')
for (const s of skipped) console.log('  -', s)
console.log('')
console.log('orphaned + empty (' + orphans.length + '):')
for (const o of orphans) console.log('  -', o)

if (orphans.length === 0) {
  console.log('\nNothing to do.')
  process.exit(0)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete the ' + orphans.length + ' bucket(s) above.')
  process.exit(0)
}

let deleted = 0
for (const name of orphans) {
  try {
    await s3.send(new DeleteBucketCommand({ Bucket: name }))
    console.log('  deleted', name)
    deleted++
  } catch (e: any) {
    console.log('  FAILED', name, '-', e?.name || e?.message)
  }
}
console.log('\n' + deleted + '/' + orphans.length + ' deleted')
