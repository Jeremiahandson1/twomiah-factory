// CI guard: RV title & registration is filed for a sold deal with the fee desked on it (never an invented $0 or a
// green tick for "not submitted"), and the F&I credit app refuses nonsense amounts, terms and products.
// (RV T19 L1, L2)
//   bun scripts/check-rv-deal-jacket.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const tr = read('templates/crm-rv/backend/src/routes/titleReg.ts')
if (!/eq\(salesLead\.id, leadId\), eq\(salesLead\.companyId, user\.companyId\)/.test(tr)) fail('title & registration must load the company\'s own deal')
if (!/if \(row\.lead\.stage !== 'closed_won'\) return c\.json\([^)]*409\)/.test(tr)) fail('title & registration must refuse a deal that is not Sold')
if (!/Number\(deal\.titleReg\)/.test(tr) || /fees: \{ title: \d|registration: \d/.test(tr)) fail('the fee must come from the desk, not be invented')
if (!/SUBMISSIONS\.filter\(\(s\) => s\.companyId === user\.companyId\)/.test(tr)) fail("the submissions list must show only the company's filings")
const page = read('templates/crm-rv/frontend/src/pages/rv/TitleRegPage.tsx')
if (!/\{accepted \? <CheckCircle2/.test(page) || !/disabled=\{submitting \|\| !sold\}/.test(page)) fail('the page must not show a success tick unless accepted, and must not submit an unsold deal')

const fi = read('templates/crm-rv/backend/src/routes/fi.ts')
const submit = fi.slice(fi.indexOf("app.post('/submit'"))
if (!/amount <= 0 \|\| amount > 10_000_000\) return c\.json\(\{ error: 'Amount financed must be more than \$0\.' \}, 400\)/.test(submit)) fail('F&I must refuse an amount financed of $0 or less')
if (!/if \(!TERMS\.includes\(Number\(body\.term\)\)\) return c\.json/.test(submit)) fail('F&I must refuse a term that is not offered')
if (!/products\.some\(\(p: unknown\) => typeof p !== 'string' \|\| !PRODUCTS\.some\(\(x\) => x\.id === p\)\)/.test(submit)) fail('F&I must refuse products that are not on the menu')
if (submit.indexOf('lender.submit(') < submit.indexOf('TERMS.includes')) fail('F&I must validate before submitting to a lender')

if (failed) { console.error(`\nrv deal jacket: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv deal jacket: title & registration only for sold deals with the desked fee; F&I credit apps validated')
