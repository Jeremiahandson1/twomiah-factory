/**
 * Apply the backup retention rules to the R2 bucket.
 *
 *   bun run scripts/r2-lifecycle.ts            # show what would change
 *   bun run scripts/r2-lifecycle.ts --apply    # write it
 *
 * Retention is enforced by R2 itself, keyed on the prefixes tenantBackup.ts
 * writes to, rather than by a pruning job of ours. There is no delete loop to
 * get wrong, nothing to schedule, and nothing that quietly stops running.
 *
 *   db-backups/daily/    30 days   → ~30 daily copies
 *   db-backups/monthly/  365 days  → ~12 monthly copies
 *
 * Dry run by default. These rules DELETE objects on a timer, and a wrong prefix
 * here would expire the wrong thing — that deserves a look before it is written.
 *
 * PutBucketLifecycleConfiguration REPLACES the whole configuration, so this
 * reads what is there and preserves any rule it did not put there.
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

const OURS = [
  { ID: 'twomiah-db-backups-daily-30d', prefix: 'db-backups/daily/', days: 30 },
  { ID: 'twomiah-db-backups-monthly-365d', prefix: 'db-backups/monthly/', days: 365 },
]

const bucket = process.env.R2_BUCKET_NAME
if (!bucket || !process.env.R2_ACCOUNT_ID) {
  console.error('R2 is not configured (need R2_BUCKET_NAME + R2_ACCOUNT_ID)')
  process.exit(1)
}

const {
  S3Client,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} = await import('@aws-sdk/client-s3')

const s3 = new S3Client({
  region: 'auto',
  endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

let existing: any[] = []
try {
  const cur: any = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))
  existing = cur.Rules || []
} catch (e: any) {
  // No configuration yet is the normal first-run state, not a failure.
  if (!/NoSuchLifecycleConfiguration/i.test(e?.name + ' ' + e?.message)) throw e
}

console.log('bucket:', bucket)
console.log('existing rules:', existing.length)
for (const r of existing) {
  console.log('  -', r.ID, '| prefix:', r.Filter?.Prefix ?? r.Prefix ?? '(all)', '| expire:', r.Expiration?.Days ?? '-', 'days')
}

const ourIds = new Set(OURS.map(r => r.ID))
const preserved = existing.filter((r: any) => !ourIds.has(r.ID))

const rules = [
  ...preserved,
  ...OURS.map(r => ({
    ID: r.ID,
    Status: 'Enabled',
    Filter: { Prefix: r.prefix },
    Expiration: { Days: r.days },
  })),
]

console.log('')
console.log('resulting rules:', rules.length, '(' + preserved.length + ' preserved, ' + OURS.length + ' ours)')
for (const r of rules) {
  console.log('  -', r.ID, '| prefix:', r.Filter?.Prefix ?? '(all)', '| expire:', r.Expiration?.Days ?? '-', 'days')
}

if (!APPLY) {
  console.log('')
  console.log('Dry run. Re-run with --apply to write this configuration.')
  process.exit(0)
}

await s3.send(new PutBucketLifecycleConfigurationCommand({
  Bucket: bucket,
  LifecycleConfiguration: { Rules: rules as any },
}))
console.log('')
console.log('Applied. Read back:')
const after: any = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }))
for (const r of after.Rules || []) {
  console.log('  -', r.ID, '| prefix:', r.Filter?.Prefix ?? r.Prefix ?? '(all)', '| expire:', r.Expiration?.Days ?? '-', 'days')
}
