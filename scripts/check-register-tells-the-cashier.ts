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

// ── Change is the till's figure, and it is never negative ─────────────────────────────────────────
// The server refuses an under-tender outright and clamps change at zero (F-08), so a negative change
// cannot come from a sale. It came from the order detail page RE-DERIVING it as tendered − total: an
// unpaid $25 order rendered its own total back as "Change $-25.00", and so would any paid order whose
// tender was not recorded (an integration, an offline sync). Read the stored column. (Dispensary T23)
const orders = read('templates/crm-dispensary/backend/src/routes/orders.ts')
// BOTH tender paths, counted — cash and split each carry this code, so matching it once let a plant
// that gutted the cash branch sail past while the split branch still satisfied the regex.
if ((orders.match(/code: 'insufficient_tender'/g) || []).length < 2) fail('the register must refuse a tender that does not cover the total — on cash AND on a split')
if (!/Cash tendered \$\$\{data\.cashTendered\.toFixed\(2\)\} is less than the order total/.test(orders)) fail('…telling the cashier what was short on cash')
if (!/Split payments total \$\$\{paid\.toFixed\(2\)\}, order total is/.test(orders)) fail('…and on a split')
if (!/Math\.max\(0, round2\(data\.cashTendered - orderTotal\)\)/.test(orders)) fail('…and must never store a negative change')
const detail = read('templates/crm-dispensary/frontend/src/pages/OrderDetailPage.tsx')
if (!detail) fail('the order detail page is missing')
else {
  if (/Number\(order\.cashTendered \|\| 0\) - Number\(order\.total \|\| 0\)/.test(detail)) fail('the order detail must not re-derive change as tendered − total — that is what printed "Change $-25.00" on an unpaid order')
  if (!/\$\{Number\(order\.changeDue \|\| 0\)\.toFixed\(2\)\}/.test(detail)) fail('…it must show the change the till STORED')
  if (!/order\.paymentMethod === 'cash' && \(order\.paymentStatus === 'paid' \|\| order\.cashTendered != null\)/.test(detail)) fail('…and must not show tender or change at all until money has actually been taken')
}
// The POS shows change while the cashier types, so it only shows it once the tender covers the total.
if (!/\{parseFloat\(cashTendered \|\| '0'\) >= total && total > 0 && \(/.test(pos)) fail('the register must only offer change once the tender covers the total')

if (failed) { console.error(`\nregister tells the cashier: ${failed} check(s) FAILED`); process.exit(1) }
console.log('register tells the cashier: a blocked sale says why, on the panel and on the button, the tiles re-read the shelf after every sale, and change is the till\'s stored figure — never re-derived, never negative')
