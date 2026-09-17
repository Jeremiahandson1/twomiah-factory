// CI guard: in the RV CRM the desked deal is one saved record with one calculation. Desking saves the deal on the
// lead (PUT /api/sales-leads/:id/deal) and reloads it; F&I finances that saved deal plus products using the same
// calculation (frontend/src/lib/deal.ts); the server and the Desking inputs apply the same rules with the same
// wording; no second deal calculator writes desks into notes. (RV T19 H1: F&I financed $74,995 where the desk said
// $58,508; M5: a typed -5% tax became 5% and an oversized discount was silently capped)
//   bun scripts/check-rv-desked-deal.ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const read = (p: string) => strip(raw(p))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const T = 'templates/crm-rv'

// storage
const schema = read(`${T}/backend/db/schema.ts`)
const leadTable = schema.slice(schema.indexOf("export const salesLead = pgTable('sales_lead'"), schema.indexOf('export const repairOrder'))
if (!/deal: json\('deal'\)/.test(leadTable)) fail('sales_lead must have a json deal column in schema.ts')
const migDir = `${T}/backend/db/migrations`
const mig = readdirSync(join(ROOT, migDir)).filter((f) => f.endsWith('.sql')).find((f) => /ALTER TABLE "sales_lead" ADD COLUMN IF NOT EXISTS "deal" json/.test(raw(`${migDir}/${f}`)))
if (!mig) fail('a migration must add sales_lead.deal (ADD COLUMN IF NOT EXISTS)')
else if (!raw(`${migDir}/meta/_journal.json`).includes(`"tag": "${mig.replace(/\.sql$/, '')}"`)) fail(`${mig} must be in the migration journal`)

// server
const route = read(`${T}/backend/src/routes/salesLeads.ts`)
const handler = (sig: string) => { const i = route.indexOf(sig); if (i < 0) return ''; const j = route.indexOf('\napp.', i + 1); return route.slice(i, j < 0 ? undefined : j) }
const getDeal = handler("app.get('/:id/deal', ")
const putDeal = handler("app.put('/:id/deal', ")
if (!getDeal || !/eq\(salesLead\.companyId, currentUser\.companyId\)/.test(getDeal) || !/dealSaved: !!saved/.test(getDeal)) fail('GET /sales-leads/:id/deal must exist, be company-scoped and say whether the deal is saved')
if (!putDeal || !/eq\(salesLead\.companyId, currentUser\.companyId\)/.test(putDeal)) fail('PUT /sales-leads/:id/deal must exist and be company-scoped')
else if (!(putDeal.indexOf('dealInput(') >= 0 && putDeal.indexOf('dealInput(') < putDeal.indexOf('db.update(salesLead)'))) fail('PUT /sales-leads/:id/deal must validate (dealInput) before writing')

// one set of rules and wording on both sides
const lib = read(`${T}/frontend/src/lib/deal.ts`)
const labels = (src: string) => { const m = src.match(/LABELS[^=]*= \{([\s\S]*?)\};?\r?\n/); return m ? Object.fromEntries([...m[1].matchAll(/(\w+): '([^']+)'/g)].map((x) => [x[1], x[2]])) : null }
const sl = labels(route), cl = labels(lib)
if (!sl || !cl || JSON.stringify(Object.entries(sl).sort()) !== JSON.stringify(Object.entries(cl).sort())) fail(`deal field labels must match between the server and lib/deal.ts (server ${JSON.stringify(sl)}, client ${JSON.stringify(cl)})`)
for (const msg of ["can't be negative", 'is too large', 'must be a number', 'Tax rate must be between 0% and 25%', "Discount can't be more than the selling price"]) {
  if (!route.includes(msg) || !lib.includes(msg)) fail(`server and lib/deal.ts must both apply the rule "${msg}"`)
}
if (!/DEAL_MAX = 10_000_000/.test(route) || !/DEAL_MAX = 10_000_000/.test(lib)) fail('server and lib/deal.ts must share the same maximum amount')
if (!/taxRate < 0 \|\| deal\.taxRate > 25|deal\.taxRate < 0 \|\| deal\.taxRate > 25/.test(route) || !/d\.taxRate < 0 \|\| d\.taxRate > 25/.test(lib)) fail('tax rate must be bounded 0–25% on both sides')
if (!/deal\.discount > deal\.price/.test(route) || !/d\.discount > d\.price/.test(lib)) fail('a discount above the price must be refused on both sides')
for (const fn of ['dealTotals', 'parseDeal', 'dealErrors']) if (!new RegExp(`export function ${fn}\\(`).test(lib)) fail(`lib/deal.ts must export ${fn}`)

// Desking: uses the shared calculation, keeps typed text, saves and reloads
const desk = read(`${T}/frontend/src/pages/rv/DeskingPage.tsx`)
if (!/from '\.\.\/\.\.\/lib\/deal'/.test(desk) || !/dealTotals\(/.test(desk) || !/parseDeal\(/.test(desk)) fail('DeskingPage must use dealTotals/parseDeal from lib/deal')
if (/const taxable =|d\.price - d\.discount/.test(desk)) fail('DeskingPage must not carry its own deal calculation')
if (/Number\(e\.target\.value\) \|\| 0/.test(desk)) fail('DeskingPage inputs must keep typed text (Number(value) || 0 turned "-5" into "05")')
if (!/api\.put\(`\/api\/sales-leads\/\$\{leadId\}\/deal`/.test(desk) || !/api\.get\(`\/api\/sales-leads\/\$\{id\}\/deal`/.test(desk)) fail('DeskingPage must save and reload the deal through /api/sales-leads/:id/deal')
if (!/async function sendToFi\(\) \{\s*if \(await save\(\)\) navigate\(/.test(desk)) fail('"Send to F&I" must save the deal before leaving Desking')

// F&I: finances the saved deal plus products
const fi = read(`${T}/frontend/src/pages/rv/FIPage.tsx`)
if (!/from '\.\.\/\.\.\/lib\/deal'/.test(fi) || !/dealTotals\(desked\)/.test(fi)) fail('FIPage must compute from the saved deal with dealTotals')
if (!/const amountFinanced = totals \? totals\.financed \+ productTotal : 0/.test(fi)) fail('FIPage amount financed must be the desked amount plus products')
if (/price - trade - down|setPrice\(|setTrade\(|setDown\(/.test(fi)) fail('FIPage must not re-key price/trade/down or finance price - trade - down')
if (!/lead\?\.dealSaved/.test(fi) || !/hasn't been desked yet/.test(fi)) fail('FIPage must send an undesked deal back to Desking instead of financing it')

// no second calculator
if (existsSync(join(ROOT, `${T}/frontend/src/pages/rv/DealDeskModal.tsx`))) fail('the Pipeline DealDeskModal (a second, divergent calculator) must stay removed')
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => { const p = `${dir}/${n}`; return statSync(join(ROOT, p)).isDirectory() ? (n === 'shared' || n === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(n) ? [p] : [] })
for (const f of walk(`${T}/frontend/src`)) if (/DealDeskModal|\[NOTE_KEY\]|dealDesk:/.test(read(f))) fail(`${f} still references the old notes-JSON deal desk`)
if (!/navigate\(`\/crm\/desking\?lead=\$\{row\.lead\.id\}`\)/.test(read(`${T}/frontend/src/pages/rv/SalesPipelinePage.tsx`))) fail("the Pipeline's Deal Desk button must open Desking for that lead")
if (raw(`${T}/feature-manifest.json`).includes('DealDeskModal')) fail('feature-manifest.json must not list DealDeskModal')

if (failed) { console.error(`\nrv desked deal: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv desked deal: Desking saves one deal on the lead, F&I finances it plus products with the same calculation, and both sides apply the same rules')
