// CI guard: RV ADF import takes only real ADF leads and doesn't duplicate a resent lead. The document must be an
// <adf> with a <prospect> whose <customer> has a name, email or phone; customer fields come from <customer> (not the
// dealer's <vendor> contact); the import runs under an identity lock and returns an open, recent lead for the same
// contact + interest instead of creating another. (RV T19 H6: "garbage" created an Unknown lead; a resent ADF
// created a second lead)
//   bun scripts/check-rv-adf-import.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const r = read('templates/crm-rv/backend/src/routes/salesLeads.ts')
const parse = r.slice(r.indexOf('function parseAdf('), r.indexOf("app.post('/import-adf'"))
const handler = r.slice(r.indexOf("app.post('/import-adf'"), r.indexOf('export default app'))
if (!parse) fail('parseAdf must exist')
if (!/if \(!\/<adf\\b\/i\.test\(xmlText\) \|\| !\/<prospect\\b\/i\.test\(xmlText\)\) return \{ error:/.test(parse)) fail('a document without <adf> and <prospect> must be refused')
if (!/const customer = block\(xmlText, 'customer'\)\s*\r?\n\s*if \(!customer\) return \{ error:/.test(parse)) fail('a prospect without <customer> must be refused')
if (!/if \(!name && !email && phoneDigits\.length < 10\) return \{ error:/.test(parse)) fail('a customer with no name, email or phone must be refused')
if (/'Unknown'/.test(r)) fail('no lead may be created for an "Unknown" customer')
for (const f of ["text(customer, 'email')", "text(customer, 'phone')", "text(customer, 'name', `part=[\"']first[\"']`)"]) if (!parse.includes(f)) fail(`customer fields must be read from <customer>: ${f}`)
if (/getTag\(xmlText, '(email|phone|name)'/.test(r)) fail('customer fields must not be read from the whole document (the dealer <vendor> contact would match)')
if (!/const adf = parseAdf\(xmlText\)\s*\r?\n\s*if \('error' in adf\) return c\.json\(\{ error: adf\.error \}, 400\)/.test(handler)) fail('the route must refuse what parseAdf rejects, before writing')
if (handler.indexOf("if ('error' in adf)") > handler.indexOf('db.transaction(')) fail('validation must come before the transaction')
if (!/pg_advisory_xact_lock\(hashtext\(/.test(handler)) fail('the import must lock on the customer identity so simultaneous copies cannot both create')
if (!/eq\(salesLead\.source, 'adf_xml'\)[\s\S]*not in \('closed_won', 'closed_lost'\)[\s\S]*make_interval\(days => \$\{ADF_DUPLICATE_DAYS\}\)[\s\S]*if \(existing\) return \{ duplicate: true/.test(handler)) fail('a resent lead (same contact, same interest, open, recent) must return the existing lead')
if (handler.indexOf('if (existing) return { duplicate: true') > handler.indexOf('tx.insert(salesLead)')) fail('the duplicate check must come before the lead insert')

const page = read('templates/crm-rv/frontend/src/pages/rv/SalesPipelinePage.tsx')
if (!/if \(r\?\.duplicate\) alert\(/.test(page)) fail('the import dialog must say when the lead was already imported')

if (failed) { console.error(`\nrv adf import: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv adf import: only real ADF leads are imported, from the <customer> block, and a resent lead returns the existing one')
