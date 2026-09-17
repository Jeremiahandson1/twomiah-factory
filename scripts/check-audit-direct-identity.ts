// CI guard: the templates' audit service stores entries from callers that pass the user's ids directly. Inventory,
// recurring invoices, bulk, import and migration call audit.log({ ..., userId, companyId }); the service only read
// req.user, so company_id (NOT NULL) was null and every one of those entries failed with "Audit log error".
//   bun scripts/check-audit-direct-identity.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the CRMs whose code calls audit.log with direct ids (dispensary has its own service and every call there passes req)
const services = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
for (const t of services) {
  const p = `templates/${t}/backend/src/services/audit.ts`
  if (!existsSync(join(ROOT, p))) { fail(`${t}: services/audit.ts is missing`); continue }
  const s = read(p)
  if (!/export async function log\(\{[^}]*\buserId, companyId, req \}: AuditLogInput\)/.test(s)) fail(`${t}: log() must accept userId and companyId`)
  if (!/userId: req\?\.user\?\.userId \|\| userId \|\| null,/.test(s)) fail(`${t}: log() must store the direct userId`)
  if (!/companyId: req\?\.user\?\.companyId \|\| companyId \|\| null,/.test(s)) fail(`${t}: log() must store the direct companyId`)
}

// the direct-ids callers this protects are still wired to the template service
for (const t of ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv']) {
  if (!/import audit from '\.\.\/services\/audit\.ts'/.test(read(`templates/${t}/backend/src/routes/inventory.ts`))) fail(`${t}: inventory routes must use the template audit service`)
}
if (!/userId: user\.userId,\s*companyId: user\.companyId,/.test(read('packages/tenant-backend/src/inventory/inventory.ts'))) fail('shared inventory must pass the user ids to audit.log')

if (failed) { console.error(`\naudit direct identity: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`audit direct identity: ${services.length} audit services store entries from callers that pass userId/companyId (${services.join(', ')})`)
