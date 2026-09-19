// CI guard: Add Product refuses an impossible value out loud, through every door.
//
// Dispensary T21 M4 — price -50 and THC 150, click Create Product: no toast, no inline error, no
// network request, modal still open. Two causes, and the second one hid behind the first:
//   * the modal had no <form> at all (document.forms.length was 0), so the min/max already sitting on
//     those inputs could never fire and the browser never showed an inline message;
//   * only the LOWER bound was checked in JS, so 150% THC passed the client completely.
// And the bulk import accepted an unbounded potency, which made a spreadsheet the way around whatever
// the form decided.
//   bun scripts/check-product-form-validates.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
// Counting checks run against CODE only: a comment naming the old bug is documentation, not a fix.
const codeOnly = (src: string) => src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

const page = read('templates/crm-dispensary/frontend/src/pages/ProductsPage.tsx')
if (!page) fail('the dispensary Products page is missing')
// a real form, submitted by a real submit button
if (!/<form onSubmit=\{handleCreate\}/.test(page)) fail('the Add Product modal must be a FORM — without one the min/max on its inputs are decoration')
if (!/<Button type="submit" disabled=\{saving\}>/.test(page)) fail('…submitted by a submit button, so the browser validates before the handler runs')
if (!/<button\s+type="button"\s+onClick=\{\(\) => setModalOpen\(false\)\}/.test(page)) fail('…and Cancel must be type=button, or it submits the form it sits in')
if (!/const handleCreate = async \(e\?: React\.FormEvent\) => \{\n    e\?\.preventDefault\(\);/.test(page)) fail('…with the submit event prevented, so the page does not reload')
// both ends of the range, not just the bottom
if (!/if \(raw !== '' && raw != null && Number\(raw\) < 0\)/.test(page)) fail('a negative price/stock/potency must be refused')
if (!/\[\['THC %', formData\.thcPercent\], \['CBD %', formData\.cbdPercent\]\]/.test(page)) fail('…and a potency over 100 must be refused too — that is the half that was missing')
if (!/if \(raw !== '' && raw != null && Number\(raw\) > 100\)/.test(page)) fail('…with an upper bound actually applied')
// Both potency inputs, not just whichever one comes first — and counted in CODE, since a comment
// explaining the old bug mentions max="100" too and would otherwise pad the count.
if ((codeOnly(page).match(/max="100"/g) || []).length < 2) fail('…and BOTH potency inputs must keep their max, now that something enforces it')

// the same rule on the way in through the API, both doors
const routes = read('templates/crm-dispensary/backend/src/routes/products.ts')
if (!routes) fail('the products routes are missing')
if ((routes.match(/thcPercent: z\.(coerce\.)?number\(\)\.min\(0\)\.max\(100\)\.optional\(\)/g) || []).length < 2) fail('BOTH the create route and the bulk import must bound potency 0–100 — otherwise a spreadsheet is the way around the form')
if ((routes.match(/cbdPercent: z\.(coerce\.)?number\(\)\.min\(0\)\.max\(100\)\.optional\(\)/g) || []).length < 2) fail('…the same for CBD')

if (failed) { console.error(`\nproduct form validates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('product form validates: Add Product is a real form with both bounds enforced, and the bulk import agrees with it')
