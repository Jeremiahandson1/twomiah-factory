/**
 * Manual flip-to-CRM test: deploys crm-rv for an existing website tenant and
 * copies its inventory across. Usage: bun run scripts/flip-rv-test.ts <tenantId>
 */
import { flipWebsiteToCrm } from '../src/services/flipWebsiteToCrm.ts'

const tenantId = process.argv[2]
if (!tenantId) {
  console.error('Usage: bun run scripts/flip-rv-test.ts <tenantId>')
  process.exit(1)
}

console.log('Flipping tenant', tenantId, 'to CRM (deploys crm-rv + DB, ~10min)...')
const result = await flipWebsiteToCrm(tenantId)
console.log('RESULT:', JSON.stringify(result, null, 2))
process.exit(result.success ? 0 : 1)
