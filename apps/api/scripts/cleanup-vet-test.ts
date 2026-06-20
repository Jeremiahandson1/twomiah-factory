/**
 * Tears down a tenant provisioned by scripts/provision-vet-test.ts — deletes the
 * GitHub repo, Render services, Render Postgres, R2 bucket, Supabase row, etc.
 * Respects the is_test_tenant=true safety gate (refuses to delete a real customer).
 *
 *     cd apps/api && bun run scripts/cleanup-vet-test.ts <tenantId>
 */
import { hardDeleteTestTenant } from '../src/services/testCleanup.ts'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: bun run scripts/cleanup-vet-test.ts <tenantId>')
  process.exit(1)
}

const result = await hardDeleteTestTenant(tenantId)
console.log(JSON.stringify(result, null, 2))
