// CI guard: RV global search finds inventory units (stock number, VIN, make, model, trim, year) — included by default,
// company-scoped, gated on unit_inventory like the sidebar — and a result opens the Inventory page filtered to it.
// (RV T19 M7: searching "Bennington" returned no results although two Bennington units existed)
//   bun scripts/check-rv-search-units.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('templates/crm-rv/backend/src/services/search.ts')
if (!/const searchTypes = types \|\| \['unit', /.test(svc)) fail('units must be searched by default')
const block = svc.slice(svc.indexOf("if (searchTypes.includes('unit'))"), svc.indexOf('// Contacts'))
if (!block) fail('the search service must search units')
if (!/eq\(unit\.companyId, companyId\)/.test(block)) fail('unit search must be scoped to the company')
for (const col of ['stockNumber', 'vin', 'make', 'modelName', 'trim']) if (!new RegExp(`ilike\\(unit\\.${col}, pattern\\)`).test(block)) fail(`unit search must match ${col}`)
if (!/url: `\/crm\/units\?search=\$\{encodeURIComponent\(/.test(block)) fail('a unit result must open the Inventory page filtered to it')
if (!/unit: \['unit_inventory'\]/.test(read('templates/crm-rv/backend/src/routes/search.ts'))) fail("unit results must be gated on unit_inventory (the sidebar's feature)")
const page = read('templates/crm-rv/frontend/src/pages/rv/InventoryPage.tsx')
if (!/useState<string>\(searchParams\.get\('search'\) \|\| ''\)/.test(page) || !/if \(q !== null\) setSearch\(q\)/.test(page)) fail('the Inventory page must take ?search= from the URL')
if (!/unit: Caravan/.test(read('packages/tenant-ui/src/shell/GlobalSearch.tsx'))) fail('the search box must show units with their icon')

if (failed) { console.error(`\nrv search units: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv search units: global search finds units and opens the filtered Inventory page')
