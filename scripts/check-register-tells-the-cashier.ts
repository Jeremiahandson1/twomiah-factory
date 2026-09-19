// CI guard: the register explains itself, and its shelf numbers are the shop's. (Dispensary T21 M5 + M6)
//
//   * M5 — nine eighths of an ounce turned the weight meter red and disabled Complete Sale with no
//     title attribute and no explanatory text anywhere on the panel. The cashier was left with a dead
//     button and nothing to act on. The server's refusal has always been clear; it was never reached,
//     so nobody ever saw it. Five separate conditions disable that button, so the REASON has to be
//     rendered, not implied.
//   * M6 — the product tiles kept the counts loaded when the page opened. After selling 8 of 40 the
//     grid still read "40 left" while the server had moved to 32, and the next customer was rung up
//     against a number that no longer existed.
//   bun scripts/check-register-tells-the-cashier.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const pos = read('templates/crm-dispensary/frontend/src/pages/POSPage.tsx')
if (!pos) fail('the dispensary POS page is missing')

// M5 — a reason exists, is rendered, and is on the button
if (!/const blockReason = \(\(\) => \{/.test(pos)) fail('the register must work out WHY it will not sell')
if (!/if \(overWeight\) return `Over the legal limit: \$\{Number\(totalWeightOz\)\.toFixed\(2\)\} oz exceeds the \$\{WEIGHT_LIMIT_OZ\} oz maximum/.test(pos)) fail('…naming the weight over the limit, in the same terms as the meter')
if (!/if \(overStockLine\)/.test(pos)) fail('…naming the line that outruns the shelf')
if (!/if \(!idVerified\) return 'Check the customer/.test(pos)) fail('…and asking for the ID check by name')
// rendered where the cashier is looking, not only as a tooltip
if (!/\{blockReason && \(/.test(pos)) fail('the reason must be RENDERED on the panel — a disabled button alone is what the report was about')
if (!/role="alert"/.test(pos)) fail('…and announced, so it is not purely visual')
if (!/title=\{blockReason \|\| undefined\}/.test(pos)) fail('…and carried on the button itself for a cashier who hovers it')
// the button must stay disabled for the reasons it states: pinned so the two cannot drift apart
if (!/disabled=\{processing \|\| cart\.length === 0 \|\| !idVerified \|\| overWeight \|\| overStock\}/.test(pos)) fail('the conditions that disable the sale must be the ones the reason explains')

// M6 — the tiles are re-read once the sale has moved the shelf
const completed = pos.indexOf("toast.success('Order completed!')")
if (completed < 0) fail('the POS no longer confirms a completed order')
else {
  const after = pos.slice(completed, completed + 700)
  if (!/loadProducts\(\)/.test(after)) fail('the catalog must be re-read after a sale settles, or the tiles keep pre-sale stock')
}
if (!/\{product\.stockQuantity\} left/.test(pos)) fail('the tile must show the stock it just re-read')

if (failed) { console.error(`\nregister tells the cashier: ${failed} check(s) FAILED`); process.exit(1) }
console.log('register tells the cashier: a blocked sale says why, on the panel and on the button, and the tiles re-read the shelf after every sale')
