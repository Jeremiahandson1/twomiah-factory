// An invoice must never be stored with a null due date.
//
// isOverdue() opens with `if (!openStatuses.includes(inv.status) || !inv.dueDate) return false`. A null due
// date is therefore not "no deadline" — it is an invoice that can NEVER become overdue, never appears in
// collections, and never chases anybody. It is unpaid money the product has agreed to stop looking for.
//
// Creating an invoice by hand has always known this: "Due date: what the form sent, else the company's
// payment terms. Never null: an invoice with no due date could never become overdue." The migration
// importers did not, and wrote `dueDate: inv.dueDate ? new Date(inv.dueDate) : null` in seven templates,
// three sites each — so every invoice imported from a system that does not carry a due date arrived
// uncollectable. (Field Service T26 L1: 25 invoices on the tenant holding a null due date.)
//
// This guard fails on any invoice insert that can store null there.
//
//   bun run scripts/check-no-null-invoice-due-date.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SCAN = [join(ROOT, 'templates'), join(ROOT, 'packages')]

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'shared' || name === 'migrations') continue
    const p = join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.ts$/.test(name)) out.push(p)
  }
  return out
}

// `dueDate: <anything> : null` / `dueDate: null` — a due date that may be stored as nothing.
const NULLABLE_DUE = /dueDate\s*:\s*(?:[^,\n]*\?\s*[^,\n]*:\s*null|null)\s*[,}]/

for (const root of SCAN) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    // only files that actually write invoices
    if (!/insert\(\s*(?:t\.)?invoice\s*\)|INSERT\s+INTO\s+invoice/i.test(text)) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (!NULLABLE_DUE.test(lines[i])) continue
      // A line that is explicitly about a QUOTE's expiry or a task is not an invoice due date.
      if (/expiry|expires|task/i.test(lines[i])) continue
      fail(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} stores a null invoice due date — isOverdue() can never fire on it, so the invoice is uncollectable. Fall back to the tenant's payment terms (dueDateFromTerms) the way creating one by hand does. (T26 L1)\n       ${lines[i].trim().slice(0, 120)}`)
    }
  }
}

console.log(failures === 0
  ? 'ok — every invoice write gives the invoice a due date it can actually fall due on'
  : `${failures} problem(s)`)
process.exit(failures ? 1 : 0)
