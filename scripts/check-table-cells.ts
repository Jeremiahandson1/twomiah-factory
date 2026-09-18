// CI guard: a table row keeps its height whatever is in it. One long value — a 140-character contact name —
// used to wrap its cell and render an 84px row against a normal 42px (vet T12 M2), after an earlier fix
// stopped it stretching the column off-screen by wrapping it instead. The cell now ellipsises at a cap and
// offers the full value on hover, and a column that renders its own markup must supply that tooltip itself:
// taking it from the raw field would make the tooltip disagree with the cell (Location shows "Eau Claire, WI"
// from city AND state).
//   bun scripts/check-table-cells.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const ui = read('packages/tenant-ui/src/invoicing/ui.tsx')
if (!ui) fail('packages/tenant-ui/src/invoicing/ui.tsx is missing')

const cell = ui.match(/<div title=\{full\} className="([^"]*)"/)?.[1] || ''
if (!cell) fail('a DataTable cell must wrap its content in a bounded div carrying the row tooltip')
if (!/\bmax-w-\[480px\]/.test(cell)) fail('…capped, so one long value cannot stretch its column off-screen')
if (!/\btruncate\b/.test(cell)) fail('…truncated, so one long value cannot wrap the row to twice its height')
if (/\bbreak-words\b/.test(cell)) fail('break-words is what made the row grow — the cell must ellipsise, not wrap')
if (!/\[&_p\]:truncate/.test(cell)) fail('…and the stacked lines a column renderer produces (name over company) must truncate too')

if (!/title\?: \(row: T\) => string \| undefined/.test(ui)) fail('a Column must be able to supply its own tooltip')
const full = ui.match(/const full = [\s\S]*?: undefined/)?.[0] || ''
if (!/c\.title \? c\.title\(row\)/.test(full)) fail('a column that supplies a tooltip must win')
if (!/!c\.render &&/.test(full)) fail('a column that renders its own markup must NOT borrow the raw field as its tooltip — it would disagree with the cell')

// the one column whose value is routinely long enough to be cut
const contacts = read('packages/tenant-ui/src/contacts/ContactsPage.tsx')
if (!/key: 'name', label: 'Name', title: \(row: ContactRow\) => \[row\.name, row\.company\]/.test(contacts)) {
  fail("the Contacts name column must offer the full name (and company) on hover — it is the one that gets cut")
}

if (failed) { console.error(`\ntable cells: ${failed} check(s) FAILED`); process.exit(1) }
console.log('table cells: one long value ellipsises inside its cell instead of growing the row')
