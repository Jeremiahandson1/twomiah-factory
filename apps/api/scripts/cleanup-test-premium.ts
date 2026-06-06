/**
 * Tears down a tenant provisioned by scripts/provision-test-premium.ts.
 * Respects the is_test_tenant=true safety gate (will refuse to delete
 * a real customer).
 *
 *     bun run scripts/cleanup-test-premium.ts <tenantId>
 */
import { hardDeleteTestTenant } from '../src/services/testCleanup.ts'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: bun run scripts/cleanup-test-premium.ts <tenantId>')
  process.exit(1)
}

const result = await hardDeleteTestTenant(tenantId)
console.log(JSON.stringify(result, null, 2))
