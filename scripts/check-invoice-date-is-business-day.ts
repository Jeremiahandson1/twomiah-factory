// CI guard: no invoice is dated by the server's clock. (T59)
//
//   "A visit at 10:24pm ET on Oct 8 produced INV-00178 dated Oct 9."
//
// Render runs UTC, so `issueDate: new Date()` — and insertInvoice keeping the UTC day of it — dates
// every invoice raised after 8pm Eastern (7pm Central, 4pm Pacific in winter) with TOMORROW. The vet's
// visit invoices did it, and so did landscaping's snow billing, vet's wellness billing and the
// agreements processors. The rule is `businessToday(<the company's zone>)`. A daytime test can never
// see this, which is why the first "fixed" was a false pass — so it is checked in the source, everywhere.
//   bun scripts/check-invoice-date-is-business-day.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const walk = (d: string): string[] => {
  let out: string[] = []
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'shared' && d.endsWith('src')) continue
    const p = join(d, e)
    const s = statSync(p)
    if (s.isDirectory()) out = out.concat(walk(p))
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p)
  }
  return out
}
// Parked templates are out of scope (crm-automotive, crm-homecare).
const roots = readdirSync(join(ROOT, 'templates'))
  .filter((t) => t.startsWith('crm') && t !== 'crm-automotive' && t !== 'crm-homecare')
  .map((t) => join(ROOT, 'templates', t, 'backend', 'src'))
  .concat([join(ROOT, 'packages', 'tenant-backend', 'src')])
let failed = 0, scanned = 0
for (const r of roots) {
  let files: string[] = []
  try { files = walk(r) } catch { continue }
  for (const f of files) {
    scanned++
    const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n')
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return // a comment quoting the old code is not the code
      if (/\bissueDate:\s*new Date\(\s*\)/.test(l)) { failed++; console.error(`FAIL: ${f.replace(ROOT, '')}:${i + 1} dates an invoice by the server clock — use businessToday(companyTimeZone)`) }
    })
  }
}
if (failed) { console.error(`\ninvoice dates: ${failed} invoice(s) dated by the server clock`); process.exit(1) }
console.log(`invoice dates: ${scanned} file(s) — every invoice is dated on the company's own calendar`)
