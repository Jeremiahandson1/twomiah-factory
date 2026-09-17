// CI guard: an invoice needs at least one line item. Every CRM that mounts the shared invoice routes passes
// minLineItems: 1, and the shared routes refuse fewer lines on create and on edit. (RV T19 L8: POST /api/invoices with
// no lines saved an empty $0 invoice; restaurant T16 L6 was the same)
//   bun scripts/check-invoice-min-lines.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const shared = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/const minLineItems = deps\.options\?\.minLineItems \?\? 0/.test(shared)) fail('shared invoices.ts must read options.minLineItems')
if (!/if \(data\.lineItems\.length < minLineItems\) return c\.json\(\{ error: 'Add at least one line item\.' \}, 400\)/.test(shared)) fail('shared invoices.ts must refuse too few lines on create')
if (!/if \(lines\.length < minLineItems\) return c\.json\(\{ error: 'Add at least one line item\.' \}, 400\)/.test(shared)) fail('shared invoices.ts must refuse too few lines on edit')

const users: string[] = []
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const p = `templates/${t}/backend/src/routes/invoices.ts`
  if (!existsSync(join(ROOT, p))) continue
  const s = read(p)
  if (!/createInvoiceRoutes\(/.test(s)) continue
  users.push(t)
  if (!/^\s*options: \{[^\r\n]*\bminLineItems: 1\b[^\r\n]*\},?\s*$/m.test(s)) fail(`${t}: the invoice routes must pass options.minLineItems: 1`)
}
if (users.length < 7) fail(`expected at least 7 CRMs on the shared invoice routes, found ${users.length} (${users.join(', ')})`)

if (failed) { console.error(`\ninvoice min lines: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`invoice min lines: ${users.length} CRMs refuse an invoice with no line items (${users.join(', ')})`)
