// CI guard: Service Agreements (crm, crm-fieldservice, crm-landscaping — shared module) list the customer and plan,
// expire agreements past their end date, create from the pages' payloads with a server number, and edit only the
// agreement's own fields in its own company. (Landscaping T14 H2 blank rows / $0.00, H3 ended-in-June still Active;
// both pages' create 400'd and edit 500'd; an edit body's companyId moved the agreement to another company)
//   bun scripts/check-agreements.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const s = read('packages/tenant-backend/src/agreements/agreements.ts')
const fn = (name: string) => { const i = s.indexOf(`async function ${name}(`); if (i < 0) return ''; const j = s.indexOf('\n  async function ', i + 1); return s.slice(i, j < 0 ? undefined : j) }

if (!/async function expireEndedAgreements\(companyId: string\) \{\s*await db\.update\(serviceAgreement\)\.set\(\{ status: 'expired'[\s\S]{0,200}eq\(serviceAgreement\.status, 'active'\),\s*sql`\$\{serviceAgreement\.endDate\} IS NOT NULL AND \$\{serviceAgreement\.endDate\} < NOW\(\)`/.test(s)) fail('expireEndedAgreements must mark active agreements past their end date expired (per company)')
for (const f of ['getAgreements', 'getAgreement', 'getAgreementStats', 'getExpiringAgreements']) if (!/await expireEndedAgreements\(companyId\)/.test(fn(f))) fail(`${f} must expire ended agreements before reading`)
for (const f of ['getAgreements', 'getAgreementStats', 'getExpiringAgreements']) if (!/gte\(serviceAgreement\.endDate, new Date\(\)\)/.test(fn(f))) fail(`${f}: "expiring" must exclude agreements that already ended`)
if (!/eq\(contact\.companyId, companyId\), inArray\(contact\.id, contactIds\)/.test(s) || !/eq\(agreementPlan\.companyId, companyId\), inArray\(agreementPlan\.id, planIds\)/.test(s)) fail('withRelations must load contacts and plans from this company only')
if (!/await withRelations\(companyId, rows\)/.test(fn('getAgreements')) || !/await withRelations\(companyId, \[result\]\)/.test(fn('getAgreement'))) fail('the list and GET one must attach contact + plan')
if (/\.set\(\{ \.\.\.data/.test(s)) fail('an agreement update must never spread the raw request body')
if (!/const fields = await agreementFields\(companyId, data \?\? \{\}, existing\)/.test(fn('updateAgreement')) || !/if \(!existing\) throw new AgreementError\('Agreement not found', 404\)/.test(fn('updateAgreement'))) fail('updateAgreement must 404 outside the company and write only agreementFields')
if (!/nextNumber\(tx, serviceAgreement, serviceAgreement\.number, serviceAgreement\.companyId, companyId, \{ prefix: 'AGR', pad: 5 \}\)/.test(fn('createAgreement')) || !/agreementFields\(companyId, data \?\? \{\}, null\)/.test(fn('createAgreement'))) fail('createAgreement must validate through agreementFields and number with nextNumber')
if (!/eq\(contact\.id, data\.contactId\), eq\(contact\.companyId, companyId\)/.test(s) || !/eq\(agreementPlan\.id, data\.planId\), eq\(agreementPlan\.companyId, companyId\)/.test(s)) fail("agreementFields must refuse another company's customer or plan")
if ((s.match(/if \(err instanceof AgreementError\) return c\.json\(\{ error: err\.message \}, err\.status\)/g) || []).length < 2) fail('POST and PUT must answer AgreementError with its status')
if (!/case 'semi-annual':/.test(s) || !/monthlyRecurring \+= price \/ billingIntervalMonths\(a\.billingFrequency\)/.test(s)) fail('semi-annual must bill every 6 months and count as price/6 per month')

const page = read('packages/tenant-ui/src/agreements/AgreementsPage.tsx')
if (/agreement\.price\b/.test(page) || !/Number\(agreement\.amount\)/.test(page)) fail('the Agreements page must show agreement.amount')
for (const t of ['crm-fieldservice', 'crm-landscaping']) {
  const m = read(`templates/${t}/frontend/src/pages/fieldservice/MaintenanceContracts.tsx`)
  if (/\b(c|contract|form)\??\.price\b/.test(m) || !/Number\(c\.amount\)/.test(m) || !/Number\(contract\.amount \|\| 0\)/.test(m) || !/value=\{form\.amount\}/.test(m)) fail(`${t}: Maintenance Contracts must read and send amount`)
}
if (failed) { console.error(`\nagreements: ${failed} check(s) FAILED`); process.exit(1) }
console.log('agreements: rows carry customer + plan, ended agreements expire, create/edit validated and company-scoped')
