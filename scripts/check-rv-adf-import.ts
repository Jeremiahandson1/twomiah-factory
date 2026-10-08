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
// The lock and the contact match live in services/leadContact.ts since T59, shared with the website
// form (routes/webhooks.ts) — so the rule is checked where it lives, and both doors must call it.
const lc = read('templates/crm-rv/backend/src/services/leadContact.ts')
if (!/export async function lockLeadIdentity[\s\S]*?pg_advisory_xact_lock\(hashtext\(/.test(lc)) fail('lockLeadIdentity must take an advisory lock on the customer identity')
if (!/export async function findLeadContact[\s\S]*?lower\(\$\{contact\.email\}\) = \$\{email\}[\s\S]*?if \(!emailsDiffer && !namesDiffer\) found = byPhone/.test(lc)) fail('findLeadContact must match by email, then by a phone only when neither email nor name contradicts it')
const txStart = handler.indexOf('db.transaction(')
if (!(handler.indexOf('await lockLeadIdentity(tx,', txStart) > txStart)) fail('the import must lock on the customer identity so simultaneous copies cannot both create')
if (!(handler.indexOf('await findLeadContact(tx,', txStart) > handler.indexOf('await lockLeadIdentity(tx,', txStart))) fail('the import must find the contact AFTER taking the lock, inside the transaction')
const hook = read('templates/crm-rv/backend/src/routes/webhooks.ts')
const hookTx = hook.indexOf('db.transaction(')
if (!(hookTx > 0 && hook.indexOf('await lockLeadIdentity(tx,', hookTx) > hookTx && hook.indexOf('await findLeadContact(tx,', hookTx) > hook.indexOf('await lockLeadIdentity(tx,', hookTx))) fail('the website form must use the same lock and contact match as the ADF import, inside its transaction')
if (!/eq\(salesLead\.source, 'adf_xml'\)[\s\S]*not in \('closed_won', 'closed_lost'\)[\s\S]*make_interval\(days => \$\{ADF_DUPLICATE_DAYS\}\)[\s\S]*if \(existing\) return \{ duplicate: true/.test(handler)) fail('a resent lead (same contact, same interest, open, recent) must return the existing lead')
if (handler.indexOf('if (existing) return { duplicate: true') > handler.indexOf('tx.insert(salesLead)')) fail('the duplicate check must come before the lead insert')

const page = read('templates/crm-rv/frontend/src/pages/rv/SalesPipelinePage.tsx')
// It must SAY so, not specifically via alert(): T41 replaced the three alert() calls on this dialog
// with a toast for the outcome and an inline error for the field, because window.alert is shimmed
// into a toast whose severity is guessed from the words — and "already imported" is a successful
// outcome that the shim painted red. The rule is the message, not the mechanism.
if (!/if \(r\?\.duplicate\) (?:alert|toast\.(?:info|success))\(/.test(page)) fail('the import dialog must say when the lead was already imported')
// The ADF MODAL only — the rest of the page still uses the app-wide alert() shim, which is a
// separate question. Scanning the whole file flagged three unrelated calls.
// The template sources are CRLF and `read` above does not normalise, so the newline has to be
// matched as \r?\n or this slice silently finds nothing and the rule passes on everything.
const adfModal = (page.replace(/\r\n/g, '\n').match(/function AdfImportModal[\s\S]*?\n\}\n/) || [''])[0]
// Comments stripped first: the note explaining this fix quotes the old alert() calls, and the rule
// matched its own explanation.
const adfCode = adfModal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
if (!adfModal) fail('AdfImportModal is missing')
else if (/\balert\(/.test(adfCode)) fail('the ADF dialog must not use window.alert — a validation message belongs under the field and an outcome in a toast')

if (failed) { console.error(`\nrv adf import: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv adf import: only real ADF leads are imported, from the <customer> block, and a resent lead returns the existing one')
