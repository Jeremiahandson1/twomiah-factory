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

/**
 * THE FORM SHOWS THE SERVER'S REASON — ON THE PAGE. (T58j)
 *
 * This used to assert the presence of `alert((error as Error)?.message || 'Failed to save item')`.
 * The intent was right and the encoding was not: it pinned the MECHANISM, and that mechanism was
 * itself the defect the owner reported four separate times ("the message is a pop-up instead of
 * showing on the page"). So when the pop-ups were replaced with a rendered banner, this guard failed
 * the FIX — which is the "never pin the broken expression" trap.
 *
 * What matters is that the server's own sentence reaches the person, and that it stays on screen
 * while they correct the field. So the rule is now: the page passes the caught error through
 * `errorText` into state, renders it with `PageError`, and uses no pop-up at all.
 */
{
  const page = read('packages/tenant-ui/src/inventory/InventoryPage.tsx')
  if (!/import \{ PageError, errorText \}/.test(page)) fail('InventoryPage must import PageError + errorText — the server\'s reason has to render on the page')
  if (!/setError\(errorText\(error, 'That item could not be saved\.'\)\)/.test(page)) {
    fail("the item form must put the server's reason into state via errorText, not swallow it for a generic string")
  }
  if (!/<PageError message=\{error\}/.test(page)) fail('InventoryPage must RENDER the error it stored — state nothing reads is the same as no message')
  // The thing the original rule was really protecting against, stated directly.
  const bare = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  if (/(?<![.\w])(?:window\.)?alert\s*\(/.test(bare)) fail('InventoryPage is back to a native pop-up — a refusal must render on the page')
}

if (failed) { console.error(`\ninventory items: ${failed} check(s) FAILED`); process.exit(1) }
console.log('inventory items: name required, money and levels non-negative, edits limited to item fields')
