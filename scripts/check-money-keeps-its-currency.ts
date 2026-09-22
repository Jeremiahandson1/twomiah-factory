// A money figure has to keep its currency symbol.
//
// The owner portal's Total Invoiced tile read "10,671.21" with no $. The line is
//
//     value: `${Number(stats.invoices?.totalValue ?? 0).toLocaleString()}`
//
// and it was written `` `$${...}` ``. One $ of the pair is gone, so the template literal's entire body is
// the interpolation and no symbol is ever printed. That is the $$ → $ collapse a scripted edit makes —
// String.replace treats `$$` as an escape — and the result still compiles, still renders, and is wrong in
// the one character a reader skims straight past. It shipped in two templates. (Field Service T26 L8)
//
// This fails a template literal that formats a money-shaped value and contains no literal $ of its own.
// Anything that goes through a money()/moneyShort() helper is fine — the helper carries the symbol.
//
//   bun run scripts/check-money-keeps-its-currency.ts
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
    if (name === 'node_modules' || name === 'dist' || name === 'shared') continue
    const p = join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    // .tsx only: this is about what a person SEES. A backend .ts builds CSV rows and export strings where
    // a bare number is correct and a currency symbol would be the bug (xactimate.ts writes exactly that).
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

/** A template literal that is nothing but one interpolation ending in toLocaleString()/toFixed(). */
const BARE_FORMAT = /`\$\{[^`]*\.(?:toLocaleString|toFixed)\([^`]*\}`/
/**
 * Words that make a line UNAMBIGUOUSLY about money. Deliberately narrow: a first cut included `total`,
 * `amount` and `price`, and promptly flagged "Total Miles" and a CSV export column. A guard that cries
 * wolf gets worked around, so it only speaks when it is certain.
 */
const MONEY_WORD = /DollarSign|Invoiced|Revenue|Outstanding|Balance|Collected|Refunded|Subtotal/

for (const root of SCAN) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!BARE_FORMAT.test(line) || !MONEY_WORD.test(line)) continue
      // a literal $ anywhere in the line's template means the symbol is being printed
      if (/`[^`]*\$\$\{|>\s*\$\{|\$\s*\{?\s*money/.test(line)) continue
      if (/`\$[^{]/.test(line)) continue
      // counts and percentages are not money
      if (/%|percent|Orders|Jobs|Contacts|Customers|Visits/.test(line)) continue
      fail(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} formats a money figure with no currency symbol — a lost $ from a \`$\${…}\` pair. (T26 L8)\n       ${line.trim().slice(0, 130)}`)
    }
  }
}

console.log(failures === 0
  ? 'ok — every money figure prints with its currency symbol'
  : `${failures} problem(s)`)
process.exit(failures ? 1 : 0)
