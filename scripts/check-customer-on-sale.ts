// CI guard: the customer is findable, visible on what they bought, and keeps the money they spent.
// Three T20 findings with one theme — the person behind a sale kept disappearing (Dispensary T20):
//
//   * /loyalty/check matched `c.phone ILIKE '%' + digits`, against the phone EXACTLY as stored. A phone is
//     stored the way someone typed it ("715-555-0121"), which never ends with contiguous digits — so every
//     member came back found:false and no till could pull up a balance.
//   * The orders list reads customerName, which is only filled in for a walk-in whose name was typed. An
//     order with a real customer ATTACHED left it null, so the one order that knows exactly who bought it
//     showed nobody.
//   * The customers list summed spend over status = 'completed'. Refunding ten pounds flips an order to
//     'partially_refunded', dropping it out of the sum entirely: one order, one small refund, lifetime
//     spend $0 — and the order count and last visit with it.
//   bun scripts/check-customer-on-sale.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const R = 'templates/crm-dispensary/backend/src/routes/'

const loy = read(R + 'loyalty.ts')
if (!loy) fail('the loyalty routes are missing')
if (/c\.phone ILIKE \$\{'%' \+ phone\.replace/.test(loy)) fail('the loyalty lookup must not match a raw stored phone against bare digits — that is why every member was found:false')
if (!/RIGHT\(regexp_replace\(COALESCE\(c\.phone, ''\), '\[\^0-9\]', '', 'g'\), \$\{digits\.length\}\) = \$\{digits\}/.test(loy)) fail('…it must compare DIGITS on both sides, so a formatted phone still matches')

const ord = read(R + 'orders.ts')
// pinned on the FILTER, not just the assignment: widening the filter to every linked order would overwrite
// a walk-in name someone typed, and the assignment line alone still reads correctly
if (!/\.filter\(\(o\) => o\.contactId && !o\.customerName\)/.test(ord)) fail('the orders list must fill in the name only for an attached customer that has none')
if (!/nmap\.get\(o\.contactId\)/.test(ord)) fail('…from the contact record')
if (!/if \(o\.contactId && !o\.customerName\) o\.customerName = /.test(ord)) fail('…without overwriting a walk-in name someone typed')

const ct = read(R + 'contacts.ts')
if (/status = 'completed' AND contact_id IS NOT NULL/.test(ct)) fail("customer spend must not be summed over completed-only — a partial refund drops the order out and zeroes the customer")
if (!/COALESCE\(SUM\(\$\{netExprBare\}\), 0\)::numeric as spent/.test(ct)) fail('…it must be NET of refunds')
if (!/status IN \$\{settledSale\}/.test(ct)) fail('…over every settled sale, so a refunded order still counts as a sale that happened')
if (!/from '\.\.\/utils\/revenue\.ts'/.test(ct)) fail('…using the one definition in utils/revenue.ts, not a fourth copy of it')

if (failed) { console.error(`\ncustomer on sale: ${failed} check(s) FAILED`); process.exit(1) }
console.log('customer on sale: a member is found by any spelling of their phone; the buyer shows on the order; a refund takes back only what it refunded')
