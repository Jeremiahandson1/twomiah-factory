// CI guard: a contact read carries only the related lists the reader may open. (T62)
//
//   "Field service contact detail returns quote and invoice totals" — to a technician who holds neither
//    quotes:read nor invoices:read.
//
// Rules:
//   · standardRelations gives the quotes list `permission: 'quotes:read'` and the invoices list
//     `permission: 'invoices:read'`, and any relation that selects a money column declares a permission
//   · GET /:id filters relations through deps.canSee before querying them
//   · every template that mounts createContactRoutes passes canSee (without it, every list is sent)
//   · the contact screen treats an absent list as absent (no section, no "Quotes 0")
//   bun scripts/check-contact-relations-ask.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
// a select-map KEY naming money, camelCase included (quotedTotal, unitPrice, hireFee, minimumSpend…)
const MONEY_COL = /\b\w*(total|Total|price|Price|amount|Amount|balance|Balance|cost|Cost|fee|Fee|spend|Spend|deposit|Deposit)\w*\s*:/

const file = 'packages/tenant-backend/src/contacts/contacts.ts', src = read(file)
const std = /export function standardRelations[\s\S]*?\n}\n/.exec(src)?.[0] || ''
if (!std) fail(`${file}: standardRelations not found`)
for (const [key, perm] of [['quotes', 'quotes:read'], ['invoices', 'invoices:read']]) {
  const line = std.split('\n').find((l) => l.includes(`key: '${key}'`))
  if (!line) fail(`${file}: standardRelations has no ${key} list — if it moved, this guard must follow it`)
  else if (!line.includes(`permission: '${perm}'`)) fail(`${file}: the ${key} relation must declare permission: '${perm}'`)
}
for (const line of std.split('\n').filter((l) => /out\.push\(\{ key:/.test(l))) {
  if (MONEY_COL.test(line) && !/permission: '/.test(line)) fail(`${file}: a contact relation selects money and declares no permission: ${line.trim().slice(0, 100)}`)
}
const get = /app\.get\('\/:id', requirePermission\('contacts:read'\)[\s\S]*?\n  \}\)\n/.exec(src)?.[0] || ''
if (!/deps\.canSee\(currentUser\?\.role, r\.permission, currentUser\?\.userId\)/.test(get) || !/visible\.map\(/.test(get) || /relations\.map\(\(r\) => \{\n\s*let q/.test(get)) fail(`${file}: GET /:id must query only the relations canSee allows (visible), not every relation`)

let mounts = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const p = `templates/${t}/backend/src/routes/contacts.ts`
  if (t === 'crm-automotive' || t === 'crm-homecare' || !existsSync(join(ROOT, p))) continue
  const s = read(p)
  if (!/createContactRoutes\(/.test(s)) continue
  mounts++
  if (!/canSee:\s*async \(role: string, permission: string, userId\?: string\) => hasPermission\(role, permission, await getExtraPermissions\(userId\)\)/.test(s)) fail(`${p}: mounts createContactRoutes without canSee — every seat is handed the quotes and invoices on a contact`)
  for (const line of s.split('\n').filter((l) => /\{ key: '/.test(l))) if (MONEY_COL.test(line.replace(/key: '[^']*'/, '')) && !/permission: '/.test(line)) fail(`${p}: a contact relation selects money and declares no permission: ${line.trim().slice(0, 100)}`)
}
if (mounts < 8) fail(`only ${mounts} createContactRoutes mounts found — the walk is not reading the templates`)

const ui = read('packages/tenant-ui/src/contacts/ContactDetailPage.tsx')
if (!/const hasQuotes = 'quotes' in contact/.test(ui) || !/const showInvoices = gated\('invoices'\) && 'invoices' in contact/.test(ui)) fail('ContactDetailPage.tsx: an absent quotes/invoices list must hide its section and its sidebar count')

if (failed) { console.error(`\ncontact relations: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`contact relations: quotes and invoices ask their own permission on a contact read, across ${mounts} templates`)
