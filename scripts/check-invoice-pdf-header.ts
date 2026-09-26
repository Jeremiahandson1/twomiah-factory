// CI guard: an invoice PDF says who sent it. The generator printed only the company NAME — no address, no
// phone, no email — so an invoice went out with no way to contact the business, while the vet's rabies
// certificate from the same tenant printed the full header from the same data (vet T12 M10). The whole
// company row already reaches the generator; every line is conditional, so a tenant that has filled in
// nothing renders exactly as before.
//
// This file is duplicated verbatim across seven CRM templates. The guard fixes that in place: the copies
// must stay byte-identical, so a fix to one can never again be a fix to one.
//   bun scripts/check-invoice-pdf-header.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-homecare has its own, older generator and is parked; crm-automotive is parked.
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
const path = (t: string) => `templates/${t}/backend/src/services/pdf.ts`
const base = read(path('crm-vet'))
if (!base) fail(`${path('crm-vet')} is missing`)

for (const t of TEMPLATES) {
  const src = read(path(t))
  if (!src) { fail(`${path(t)} is missing`); continue }
  if (src !== base) fail(`${path(t)} has drifted from the other templates' copy — these files must stay identical`)
}

// the header itself
if (!/doc\.fontSize\(20\)\.text\(companyName/.test(base)) fail('the practice name must still head the document')
if (!/const cityLine = \[company\?\.city, company\?\.state\]\.filter\(Boolean\)\.join\(', '\)/.test(base)) fail('city and state must print as one line')
for (const field of ['company?.address', 'company?.zip', 'company?.phone', 'company?.email', 'company?.website']) {
  if (!base.includes(field)) fail(`the header must print ${field.replace('company?.', '')} — an invoice with no way to contact the sender is what the report was about`)
}
if (!/for \(const line of \[[\s\S]*?\]\) if \(line\) doc\.text\(String\(line\)\)/.test(base)) fail('every header line must be conditional, so a tenant that filled in nothing still renders')
const headerIdx = base.indexOf('const cityLine')
const titleIdx = base.indexOf(".fontSize(14).text(title")
if (headerIdx < 0 || titleIdx < 0 || headerIdx > titleIdx) fail('the header must print between the name and the document title')
if (!/doc\.fillColor\('black'\)\.fontSize\(14\)\.text\(title/.test(base)) fail('…and must not leave the rest of the document in the header colour')

if (failed) { console.error(`\ninvoice PDF header: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`invoice PDF header: the practice's address and phone are on its invoices, identically in ${TEMPLATES.length} CRMs`)
