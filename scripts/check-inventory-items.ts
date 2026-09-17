// CI guard: shared inventory items (crm, field service, landscaping, RV) need a name and non-negative money and
// stock levels, and an edit writes only allowed item fields — never companyId or id. (RV T19 M4: cost -$5, price -$10,
// reorder point -3 and a blank name were accepted; updateItem wrote the raw request body, so an edit could move an item
// to another company)
//   bun scripts/check-inventory-items.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const src = read('packages/tenant-backend/src/inventory/inventory.ts')
const fields = src.slice(src.indexOf('function itemFields('), src.indexOf('export function createInventoryService('))
if (!fields) fail('itemFields must exist')
if (!/if \(!name\) throw new InventoryError\('Item name is required', 400\)/.test(fields)) fail('a blank item name must be refused')
if (!/if \(!Number\.isFinite\(n\) \|\| n < 0 \|\| n > 10_000_000\) throw new InventoryError\(`\$\{label\} must be an amount of 0 or more`, 400\)/.test(fields)) fail('negative unit cost / price must be refused')
if (!/if \(n === null \|\| n < 0 \|\| n > MAX_MOVE\) throw new InventoryError\(`\$\{label\} must be a whole number of 0 or more`, 400\)/.test(fields)) fail('negative or fractional stock levels must be refused')
if (/companyId|\bout\.id\b|\['id'\]/.test(fields)) fail('itemFields must never produce companyId or id')

const fn = (name: string) => { const i = src.search(new RegExp(`async function ${name}\\(`)); const rest = src.slice(i); const j = rest.search(/\r?\n\}\r?\n/); return i < 0 ? '' : rest.slice(0, j) }
if (!/const fields = itemFields\(data, true\)/.test(fn('createItem'))) fail('createItem must use itemFields')
const upd = fn('updateItem')
if (!/const fields = itemFields\(data, false\)/.test(upd) || /\.set\(data\)/.test(upd) || !/\.set\(fields\)/.test(upd)) fail('updateItem must write only itemFields, never the raw body')

const routes = src.slice(src.indexOf('export function createInventoryRoutes'))
const post = routes.slice(routes.indexOf("app.post('/items'"), routes.indexOf("app.put('/items/:id'"))
if (!/try \{ item = await service\.createItem\(user\.companyId, body\) \} catch \(err\) \{ return refused\(c, err\) \}/.test(post)) fail('POST /items must answer refusals')
const put = routes.slice(routes.indexOf("app.put('/items/:id'"), routes.indexOf("app.get('/low-stock'"))
if (!/if \(!\(await service\.getItem\(id, user\.companyId\)\)\) return c\.json\(\{ error: 'Item not found' \}, 404\)/.test(put)) fail("PUT /items/:id must 404 for another company's or a missing item")
if (!/try \{ await service\.updateItem\(id, user\.companyId, body\) \} catch \(err\) \{ return refused\(c, err\) \}/.test(put)) fail('PUT /items/:id must answer refusals')

if (!/alert\(\(error as Error\)\?\.message \|\| 'Failed to save item'\)/.test(read('packages/tenant-ui/src/inventory/InventoryPage.tsx'))) fail("the item form must show the server's reason")

if (failed) { console.error(`\ninventory items: ${failed} check(s) FAILED`); process.exit(1) }
console.log('inventory items: name required, money and levels non-negative, edits limited to item fields')
