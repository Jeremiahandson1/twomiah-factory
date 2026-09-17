// CI guard: shared inventory stock movements (crm, field service, landscaping, RV) are validated, tenant-owned and
// all-or-nothing. Adjust, transfer, job use, job return and PO receive each run in one transaction that checks the
// item/locations/record belong to the company, locks the stock rows, refuses going below zero with a 409, and
// validates the quantity (a whole number; above zero for everything but an adjustment). Routes answer refusals with
// their message instead of a 500. (RV T19 H2: a -2 transfer took Bay 1 from 13 to 15 then failed; M4: 500s; another
// tenant's ids were accepted)
//   bun scripts/check-inventory-stock-moves.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const MOD = 'packages/tenant-backend/src/inventory/inventory.ts'
const src = read(MOD)
const fn = (name: string) => { const i = src.search(new RegExp(`async function ${name}\\(`)); if (i < 0) return ''; const rest = src.slice(i); const j = rest.search(/\r?\n\}\r?\n/); return j < 0 ? rest : rest.slice(0, j) }

if (!/export class InventoryError extends Error/.test(src)) fail('inventory.ts must export InventoryError (message + 400/404/409 status)')
if (!/InventoryError \} from '\.\/inventory\/inventory'/.test(read('packages/tenant-backend/src/index.ts'))) fail('the shared index must export InventoryError')

const lock = fn('lockStock')
if (!/onConflictDoNothing\(/.test(lock) || !/\.for\('update'\)/.test(lock)) fail('lockStock must create the stock row if missing and lock it (FOR UPDATE)')
const move = fn('moveStock')
if (!/await lockStock\(tx,/.test(move) || !/if \(newQuantity < 0\) \{\s*throw new InventoryError\([^;]*409\)/.test(move)) fail('moveStock must lock the row and refuse going below zero with a 409')
if (!/tx\.update\(stockLevel\)/.test(move) || !/tx\.insert\(inventoryTransaction\)/.test(move)) fail('moveStock must update the stock row and log the transaction inside the transaction')
if (!/eq\(inventoryItem\.companyId, companyId\)/.test(fn('ownItem'))) fail('ownItem must scope the item to the company')
if (!/eq\(inventoryLocation\.companyId, companyId\)/.test(fn('ownLocation'))) fail('ownLocation must scope the location to the company')

// every stock write goes through moveStock/lockStock on a transaction
const writes = (re: RegExp) => [...src.matchAll(re)].length
if (writes(/\.update\(stockLevel\)/g) !== 1 || writes(/\.insert\(stockLevel\)/g) !== 1 || writes(/\.insert\(inventoryTransaction\)/g) !== 1) fail('stock rows and inventory transactions may only be written by lockStock/moveStock')
if (/db\.(update|insert)\((stockLevel|inventoryTransaction)\)/.test(src)) fail('no stock write may use db directly (outside a transaction)')

const ops: [string, RegExp[]][] = [
  ['adjustStock', [/wholeNumber\(quantity\)/, /qty === 0\) throw new InventoryError/, /ownItem\(tx,/, /ownLocation\(tx,/]],
  ['transferStock', [/positiveQuantity\(quantity\)/, /fromLocationId === toLocationId\) throw new InventoryError/, /ownItem\(tx,/, /ownLocation\(tx, companyId, fromLocationId/, /ownLocation\(tx, companyId, toLocationId/, /\.sort\(\)\) await lockStock\(tx,/]],
  ['useOnJob', [/positiveQuantity\(quantity\)/, /ownItem\(tx,/, /ownLocation\(tx,/, /tx\.insert\(inventoryUsage\)/]],
  ['returnFromJob', [/positiveQuantity\(returnQuantity/, /eq\(inventoryUsage\.companyId, companyId\)[\s\S]*\.for\('update'\)/, /ownLocation\(tx,/, /tx\.update\(inventoryUsage\)/]],
  ['receivePurchaseOrder', [/Array\.isArray\(receivedItems\)/, /positiveQuantity\(r\?\.receivedQuantity/, /eq\(purchaseOrder\.companyId, companyId\)[\s\S]*\.for\('update'\)/, /ownLocation\(tx,/]],
]
for (const [name, rules] of ops) {
  const body = fn(name)
  if (!body) { fail(`${name} is missing`); continue }
  if (!/await db\.transaction\(async \(tx: any\) =>/.test(body) || !/moveStock\(tx, companyId,/.test(body)) fail(`${name} must move stock through moveStock inside one db.transaction`)
  rules.forEach((re) => { if (!re.test(body)) fail(`${name} must satisfy ${re}`) })
}

// routes: refusals are answered, quantities reach the service unparsed
const routes = src.slice(src.indexOf('export function createInventoryRoutes'))
const route = (sig: string) => { const i = routes.indexOf(sig); if (i < 0) return ''; const j = routes.indexOf('\n  app.', i + 1); return routes.slice(i, j < 0 ? undefined : j) }
if (!/const refused = \(c: any, err: unknown\) => \{\s*if \(err instanceof InventoryError\) return c\.json\(\{ error: err\.message \}, err\.status\)\s*throw err/.test(routes)) fail('routes must answer an InventoryError with its message and status, and rethrow anything else')
for (const sig of ["app.post('/adjust'", "app.post('/transfer'", "app.post('/use'", "app.post('/return'", "app.post('/purchase-orders/:id/receive'"]) {
  const r = route(sig)
  if (!r) { fail(`route ${sig} is missing`); continue }
  if (!/catch \(err\) \{ return refused\(c, err\) \}/.test(r)) fail(`${sig} must answer refusals (catch → refused)`)
  if (/parseInt\((quantity|returnQuantity)\)/.test(r)) fail(`${sig} must pass the quantity to the service unparsed (parseInt("2.5") was 2, "abc" a 500)`)
}

// the four CRMs use the shared routes and service, not a fork
for (const t of ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv']) {
  if (!/export default createInventoryRoutes\(/.test(read(`templates/${t}/backend/src/routes/inventory.ts`))) fail(`${t} routes/inventory.ts must be the shared createInventoryRoutes`)
  if (!/export default createInventoryService\(/.test(read(`templates/${t}/backend/src/services/inventory.ts`))) fail(`${t} services/inventory.ts must be the shared createInventoryService`)
}

if (failed) { console.error(`\ninventory stock moves: ${failed} check(s) FAILED`); process.exit(1) }
console.log('inventory stock moves: every movement is validated, company-owned and runs in one locked transaction; refusals answer 400/404/409')
