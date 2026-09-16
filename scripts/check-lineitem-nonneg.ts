// CI guard: the shared invoice/quote money fields keep what the user types and REFUSE a bad value at
// save time in the server's words — they never rewrite it. The #140 keystroke clamp
// (Math.max(0, Number(e.target.value))) on a controlled number input turned "-" into "0" and "-50" into
// "050", so a typed negative became a positive invoice with a success toast (FS T14 / events T15 M6).
// Now: NumberInput on quantity, unit price, tax rate and discount; moneyInputError names the problem
// and both pages block the save on it; the server rules stay as the backstop. (#164)
//   bun scripts/check-lineitem-nonneg.ts
import { readFileSync } from 'node:fs'
const read = (p: string) => readFileSync(new URL(`../packages/tenant-ui/src/invoicing/${p}`, import.meta.url), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const ui = read('ui.tsx')
if (/Math\.max\(\s*0\s*,\s*Number\(e\.target\.value\)/.test(ui)) fail('ui.tsx must not clamp a number input on keystroke (that is what produced "050")')
if (!/export function NumberInput\(/.test(ui)) fail('ui.tsx must export NumberInput')
if (!/if \(Number\.isFinite\(n\)\) \{ reported\.current = n; onValue\(n\) \}/.test(ui)) fail('NumberInput must report a value only when the text is a finite number')
if (!/export const moneyInputError = /.test(ui)) fail('ui.tsx must export moneyInputError')
for (const msg of ['Quantity cannot be negative', 'Price cannot be negative', 'Tax rate must be between 0 and 100', 'Discount cannot be negative']) {
  if (!ui.includes(`'${msg}'`)) fail(`moneyInputError must use the server's wording: ${msg}`)
}
const editor = ui.slice(ui.indexOf('export function LineItemsEditor('), ui.indexOf('export function TotalsBox('))
for (const [label, field] of [['Quantity', 'quantity'], ['Unit price', 'unitPrice']]) {
  if (!new RegExp(`<NumberInput min="0" step="0\\.01" aria-label="${label}" value=\\{li\\.${field}\\} onValue=\\{n => update\\(i, \\{ ${field}: n \\}\\)\\}`).test(editor)) fail(`LineItemsEditor ${field} must be a NumberInput reporting the typed value unchanged`)
}
if (!/const lineError = moneyInputError\(items, 0, 0\)/.test(editor) || !/\{lineError && <p role="alert"/.test(editor)) fail('LineItemsEditor must show the line error under the table')

for (const page of ['InvoicesPage.tsx', 'QuotesPage.tsx']) {
  const src = read(page)
  if (!/const inputError = moneyInputError\(form\.lineItems, form\.taxRate, form\.discount\)/.test(src)) fail(`${page} must compute moneyInputError for the form`)
  if (!/if \(inputError\) \{ toast\.error\(inputError\); return \}/.test(src)) fail(`${page} must refuse to save while moneyInputError is set`)
  if (!/warning=\{inputError \|\| \(totals\.discountTooBig/.test(src)) fail(`${page} must show the input error in the totals box`)
  if (!/<NumberInput min="0" max="100" step="0\.01" value=\{form\.taxRate\} onValue=/.test(src)) fail(`${page} tax rate must be a NumberInput`)
  if (!/<NumberInput min="0" step="0\.01" value=\{form\.discount\} onValue=/.test(src)) fail(`${page} discount must be a NumberInput`)
  if (/type="number"[^>]*onChange=\{e => setForm\(\{ \.\.\.form, (taxRate|discount): Number\(e\.target\.value\)/.test(src)) fail(`${page} still rewrites tax/discount on keystroke`)
}

if (failed) { console.error(`\nmoney inputs: ${failed} check(s) FAILED`); process.exit(1) }
console.log('money inputs: quantity, price, tax and discount keep what is typed; negatives are named and block the save, never rewritten')
