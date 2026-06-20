/**
 * Tears down a tenant provisioned by scripts/provision-rv-website-test.ts.
 * Respects the is_test_tenant=true safety gate.
 *
 *     cd apps/api && bun run scripts/cleanup-rv-website-test.ts <tenantId>
 */
import { hardDeleteTestTenant } from '../src/services/testCleanup.ts'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: bun run scripts/cleanup-rv-website-test.ts <tenantId>')
  process.exit(1)
}

const result = await hardDeleteTestTenant(tenantId)
console.log(JSON.stringify(result, null, 2))
