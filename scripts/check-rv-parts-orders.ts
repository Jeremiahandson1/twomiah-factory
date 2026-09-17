// CI guard: RV parts orders are priced by the server from the dealer's catalog (never the browser's price or a
// negative quantity), the order list is per company, and the Order button shows the result or the reason.
// (RV T19 L3: $0.01 and -$5 × -2 = $10 accepted; the button hid errors)
//   bun scripts/check-rv-parts-orders.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const po = read('templates/crm-rv/backend/src/routes/partsOrders.ts')
const create = po.slice(po.indexOf("app.post('/create'"), po.indexOf("app.get('/list'"))
if (!/const part = await findCatalogPart\(user\.companyId, partNumber,/.test(create)) fail('each item must be looked up in the company catalog')
if (!/items\.push\(\{ partNumber: part\.partNumber, oem: part\.oem, name: part\.name, price: part\.price, qty \}\)/.test(create)) fail('the order must use the catalog price and name, not the request')
if (!/qty < 1 \|\| qty > 999/.test(create) || !/Number\.isInteger\(qty\)/.test(create)) fail('quantity must be a whole number 1–999')
if (create.indexOf('provider.place(items)') < create.indexOf('findCatalogPart(')) fail('items must be resolved before the order is placed')
if (!/ORDERS\.filter\(\(o\) => o\.companyId === user\.companyId\)/.test(po)) fail('the order list must be per company')
const cat = read('templates/crm-rv/backend/src/routes/oemParts.ts')
if (!/export async function findCatalogPart\(companyId: string, partNumber: string, oem\?: string\)/.test(cat) || !/eq\(catalogPart\.companyId, companyId\), eq\(catalogPart\.partNumber, partNumber\)/.test(cat)) fail('findCatalogPart must read the company catalog')
const page = read('templates/crm-rv/frontend/src/pages/rv/OEMPartsPage.tsx')
if (/price: p\.price, qty: 1/.test(page)) fail('the page must not send a price')
if (!/catch \(e: any\) \{ alert\(e\?\.message/.test(page)) fail('the Order button must show why an order failed')

if (failed) { console.error(`\nrv parts orders: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv parts orders: priced from the catalog, validated quantities, per-company list, visible results')
