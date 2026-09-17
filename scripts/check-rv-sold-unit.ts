// CI guard: in the RV CRM a sale and its unit move together. Marking a deal Sold (stage closed_won) marks its unit
// sold inside the same transaction, locking the unit and refusing a unit already sold on another deal; reopening
// or re-pointing a sold deal puts the old unit back on sale unless another sold deal holds it. Only the sales-leads
// route may put a lead into closed_won. The pipeline shows "Sold"/"Lost", flags open leads on sold units and shows
// the server's refusal; the demo seed doesn't wrap leads back onto sold units. (RV T19 B1: a unit sold twice and
// still advertised)
//   bun scripts/check-rv-sold-unit.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const ROUTE = 'templates/crm-rv/backend/src/routes/salesLeads.ts'
const r = read(ROUTE)
const fn = (name: string) => { const i = r.indexOf(`async function ${name}(`); if (i < 0) return ''; const j = r.indexOf('\n}', i); return r.slice(i, j) }
const handler = (sig: string) => { const i = r.indexOf(sig); if (i < 0) return ''; const j = r.indexOf('\napp.', i + 1); return r.slice(i, j < 0 ? undefined : j) }

const sell = fn('sellUnit')
if (!sell) fail('salesLeads.ts must define sellUnit')
else {
  if (!/eq\(unit\.companyId, companyId\)/.test(sell) || !/\.for\('update'\)/.test(sell)) fail('sellUnit must lock the unit row (FOR UPDATE), scoped to the company')
  if (!/eq\(salesLead\.stage, SOLD\)/.test(sell) || !/ne\(salesLead\.id, leadId\)/.test(sell) || !/status: 409/.test(sell)) fail('sellUnit must refuse (409) a unit already sold on another deal')
  if (!/tx\.update\(unit\)\.set\(\{ status: 'sold'/.test(sell)) fail('sellUnit must mark the unit sold in the transaction')
}
const release = fn('releaseUnit')
if (!release) fail('salesLeads.ts must define releaseUnit')
else {
  if (!/\.for\('update'\)/.test(release) || !/ne\(salesLead\.id, leadId\)/.test(release) || !/if \(!other\) await tx\.update\(unit\)\.set\(\{ status: 'available'/.test(release)) fail('releaseUnit must lock the unit and put it back on sale only when no other sold deal holds it')
}
if (!/const SOLD = 'closed_won'/.test(r)) fail("salesLeads.ts must name the sold stage (const SOLD = 'closed_won')")

const post = handler("app.post('/', ")
if (!/db\.transaction\(/.test(post) || !/sellUnit\(tx,/.test(post) || !/tx\.insert\(salesLead\)/.test(post)) fail('POST /sales-leads must sell the unit and insert the lead in one transaction')
else if (post.indexOf('sellUnit(tx,') > post.indexOf('tx.insert(salesLead)')) fail('POST /sales-leads must check the sale before inserting the lead')
if (/db\.insert\(salesLead\)/.test(post)) fail('POST /sales-leads must not insert the lead outside the transaction')

const put = handler("app.put('/:id', ")
const iSell = put.indexOf('sellUnit(tx,'), iRelease = put.indexOf('releaseUnit(tx,'), iUpdate = put.indexOf('tx.update(salesLead)')
if (!/db\.transaction\(/.test(put) || iSell < 0 || iRelease < 0 || iUpdate < 0) fail('PUT /sales-leads/:id must sell/release units and update the lead in one transaction')
else if (!(iSell < iRelease && iRelease < iUpdate)) fail('PUT /sales-leads/:id must sell first (a refusal writes nothing), then release the old unit, then update the lead')
if (/db\.update\(salesLead\)/.test(put)) fail('PUT /sales-leads/:id must not update the lead outside the transaction')

if (!/unitStatus: unit\.status/.test(handler("app.get('/', "))) fail('GET /sales-leads must return unitStatus (the pipeline\'s "Unit sold" flag)')

// only the sales-leads route may close a deal as sold
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => { const p = `${dir}/${n}`; return statSync(join(ROOT, p)).isDirectory() ? (n === 'shared' || n === 'node_modules' ? [] : walk(p)) : /\.ts$/.test(n) ? [p] : [] })
for (const f of walk('templates/crm-rv/backend/src')) {
  if (f === ROUTE) continue
  if (/stage: ['"]closed_won['"]|stage, ['"]closed_won['"]\)\s*\}|set\(\{[^}]*stage: ['"]closed_won/.test(read(f))) fail(`${f} writes a lead into closed_won; sales go through routes/salesLeads.ts so the unit is sold with it`)
}

const page = read('templates/crm-rv/frontend/src/pages/rv/SalesPipelinePage.tsx')
if (!/\{ value: 'closed_won', label: 'Sold' \}/.test(page) || !/\{ value: 'closed_lost', label: 'Lost' \}/.test(page)) fail('pipeline stages must read "Sold" and "Lost"')
if (!/row\.unitStatus === 'sold'/.test(page) || !/>Unit sold</.test(page)) fail('pipeline must flag open leads whose unit is sold ("Unit sold")')
if (!/alert\(err\?\.message \|\| 'Failed to move lead'\)/.test(page)) fail("pipeline must show the server's reason when a move is refused")

const seed = read('templates/crm-rv/backend/db/seed.template.ts')
if (/unitId: unitId\(i\)/.test(seed)) fail('seed must not wrap sales leads back onto units 0–3 (the sold ones) with unitId(i)')
if (!/if \(stage === 'closed_won' && leadUnit\) await db\.update\(unit\)\.set\(\{ status: 'sold' \}\)/.test(seed)) fail('seed must mark a sold deal\'s unit sold')

if (failed) { console.error(`\nrv sold unit: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv sold unit: a sale marks its unit sold in one locked transaction, a sold unit can\'t be sold twice, reopening frees it; the pipeline and seed agree')
