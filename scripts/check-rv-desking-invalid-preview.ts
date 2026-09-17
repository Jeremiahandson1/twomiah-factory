// CI guard: the RV Desking page doesn't show a buyer's order or payments calculated from an invalid field.
// (RV T20 N2: at -5% tax the order and payment grid showed -5% sales tax while the field was flagged)
//   bun scripts/check-rv-desking-invalid-preview.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const p = readFileSync(join(ROOT, 'templates/crm-rv/frontend/src/pages/rv/DeskingPage.tsx'), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
if (!/const shown = \(n: number\) => \(hasErrors \? '—' : money\(n\)\)/.test(p)) fail('shown() must blank figures while a field is invalid')
// every figure in the order and the payment grid goes through shown(); no raw money(...) left in the rendered order
// (a line rendered only when there are no errors may format with money() directly)
const order = p.slice(p.indexOf("Buyer's order"), p.indexOf('</table>')).split(/\r?\n/).filter((l) => !/\{!hasErrors && /.test(l)).join('\n')
if (/(?<!\$)\{money\(/.test(order)) fail("the buyer's order / payment grid must not render money(...) directly — use shown()")
for (const [what, re] of [
  ['each order row', /<span>\{shown\(v\)\}<\/span>/],
  ['out-the-door', /\{shown\(t\.outTheDoor\)\}/],
  ['amount to finance', /\{shown\(t\.financed\)\}/],
  ['payment cells', /\{shown\(payment\(t\.financed, a, m\)\)\}/],
  ['down payment', /\{hasErrors \? '—' : `-\$\{money\(d\.down\)\}`\}/],
  ['net trade hidden', /\{!hasErrors && t\.netTrade !== 0 &&/],
  ['tax label without an invalid rate', /errors\.taxRate \? 'Sales tax \(net of trade\)'/],
] as [string, RegExp][]) if (!re.test(p)) fail(`${what} must not show a figure calculated from an invalid field`)
if (failed) { console.error(`\nrv desking preview: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv desking preview: no totals or payments from an invalid field')
