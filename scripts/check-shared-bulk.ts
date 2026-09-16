// CI guard: bulk operations have ONE implementation (packages/tenant-backend/src/bulk/bulk.ts). Each
// CRM's services/bulk.ts is glue that wires its tables in — no template may carry its own copy again.
//   bun scripts/check-shared-bulk.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
const FUNCTIONS = [
  'bulkUpdateContacts', 'bulkDeleteContacts', 'bulkAssignContactTags', 'bulkUpdateProjects', 'bulkDeleteProjects', 'bulkArchiveProjects',
  'bulkUpdateJobs', 'bulkDeleteJobs', 'bulkAssignJobs', 'bulkRescheduleJobs', 'bulkUpdateJobStatus', 'bulkUpdateInvoices', 'bulkDeleteInvoices',
  'bulkSendInvoices', 'bulkMarkInvoicesPaid', 'bulkUpdateQuotes', 'bulkDeleteQuotes', 'bulkApproveTimeEntries', 'bulkDeleteTimeEntries', 'bulkOperation',
]

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const shared = read('packages/tenant-backend/src/bulk/bulk.ts')
if (!/export function createBulkService\(/.test(shared)) fail('shared bulk/bulk.ts must export createBulkService')
for (const f of FUNCTIONS) if (!new RegExp(`async function ${f}\\(`).test(shared)) fail(`shared bulk/bulk.ts must implement ${f}`)
if (!/export \{ createBulkService \} from '\.\/bulk\/bulk'/.test(read('packages/tenant-backend/src/index.ts'))) fail('index.ts must export createBulkService')

for (const t of TEMPLATES) {
  const glue = read(`templates/${t}/backend/src/services/bulk.ts`)
  if (!/createBulkService\(/.test(glue) || !/from '\.\.\/shared\/index\.ts'/.test(glue)) fail(`${t}/services/bulk.ts must build the service with createBulkService from ../shared`)
  if (/db\.(update|delete|select)\(/.test(glue)) fail(`${t}/services/bulk.ts carries its own bulk logic — it must be glue only`)
  if (!/tables: \{ contact, project, job, invoice, quote, timeEntry, payment \}/.test(glue)) fail(`${t}/services/bulk.ts must pass the seven tables (payment for bulk mark-paid, #159)`)
  for (const f of FUNCTIONS) if (!glue.includes(f)) fail(`${t}/services/bulk.ts must re-export ${f}`)
  if (!/export default service/.test(glue)) fail(`${t}/services/bulk.ts must default-export the service (routes/bulk.ts uses bulk.<fn>)`)
}

if (failed) { console.error(`\nshared bulk: ${failed} check(s) FAILED`); process.exit(1) }
console.log('shared bulk: one implementation in packages/tenant-backend; all 7 CRMs are glue re-exporting every function')
