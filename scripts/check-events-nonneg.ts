// CI guard: crm-restaurant (events) money/capacity fields can't be saved negative on ANY write path.
//  T14 HIGH-3: POST /api/event-spaces {minimumSpend:-500, hireFee:-250} and POST /api/menu-packages
//  {pricePerPerson:-30} returned 201. Menu lines already refused negatives on POST but not on PUT, and a
//  scheduled payment's amount was only validated on POST. CSV import wrote the same columns unguarded.
//   bun scripts/check-events-nonneg.ts
import { readFileSync } from 'node:fs'
// The ONE comment stripper (scripts/lib/stripComments.ts): string-aware, so a route pattern like
// '/file/*' or a `src/**` in a line comment cannot pair with a later `*/` and delete real code. (T57)
import { stripSource as strip } from './lib/stripComments.ts'
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-restaurant/backend/src/${p}`, import.meta.url), 'utf8'))
const spaces = read('routes/eventSpaces.ts')
const menus = read('routes/menuPackages.ts')
const events = read('routes/events.ts')
const imp = read('services/import.ts')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Slice one route handler: from its app.<verb>('<path>' to the next app.<verb>( or EOF.
const handler = (src: string, verb: string, path: string) => {
  const start = src.indexOf(`app.${verb}('${path}'`)
  if (start < 0) return ''
  const next = src.slice(start + 1).search(/\napp\.(get|post|put|delete)\(/)
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next)
}

// (1) spaces + packages: every column listed, checked on POST (body) and PUT (updates) before the write.
for (const [name, src, cols] of [
  ['eventSpaces', spaces, ['seatedCapacity', 'standingCapacity', 'minimumSpend', 'hireFee']],
  ['menuPackages', menus, ['pricePerPerson', 'minGuests']],
] as const) {
  const list = src.match(/const NON_NEGATIVE = \[([\s\S]*?)\] as const/)?.[1] || ''
  for (const col of cols) if (!list.includes(`'${col}'`)) fail(`${name}: NON_NEGATIVE must include ${col}`)
  const post = handler(src, 'post', '/')
  const put = handler(src, 'put', '/:id')
  if (!/negativeFieldError\(body\)[\s\S]*db\.insert/.test(post)) fail(`${name}: POST must run negativeFieldError(body) before insert`)
  if (!/negativeFieldError\(updates\)[\s\S]*db\.update/.test(put)) fail(`${name}: PUT must run negativeFieldError(updates) before update`)
}

/**
 * (2) events: the menu line's price and quantity go through THE RULE, on both create and edit.
 *
 * This used to pin the literal strings 'Unit price cannot be negative' and 'Quantity must be a
 * number' in each handler. That was a guard for the shape of the fix rather than for the rule, and
 * it failed the moment the four hand-written checks were replaced by one shared helper — while the
 * behaviour it was protecting got STRICTER, not weaker. (T51 follow-up)
 *
 * The owner had to report "0.001 is accepted" twice because the rule lived in four copies; pinning
 * those copies is what a guard should never do. So: each handler must call the helpers, and the
 * helpers must carry every branch — not a number, negative, and a positive amount that rounds away
 * to nothing.
 */
const menuPut = handler(events, 'put', '/:id/menu/:lineId')
const menuPost = handler(events, 'post', '/:id/menu')
for (const [name, src, write] of [
  ['POST /:id/menu', menuPost, /(db|tx)\.insert/],
  ['PUT /:id/menu/:lineId', menuPut, /(db|tx)\.update/],
] as const) {
  if (!/moneyRefusal\([^)]*nitPrice/.test(src)) fail(`${name} must put the unit price through moneyRefusal`)
  if (!/quantityRefusal\(/.test(src)) fail(`${name} must put the quantity through quantityRefusal`)
  if (!new RegExp(`moneyRefusal[\\s\\S]*${write.source}`).test(src)) fail(`${name} must refuse BEFORE it writes`)
}

// …and the rule itself covers all three ways an amount can be wrong. The messages are asserted
// because "abc is not negative, it is not a number" was its own report (T16 L5).
const booking = read('services/eventBooking.ts')
const moneyRule = booking.slice(booking.indexOf('export function moneyRefusal'), booking.indexOf('export function quantityRefusal'))
const qtyRule = booking.slice(booking.indexOf('export function quantityRefusal'))
if (!moneyRule) fail('services/eventBooking.ts must export moneyRefusal — the one money rule')
else {
  if (!/must be a number/.test(moneyRule)) fail('moneyRefusal must say "must be a number" for a non-numeric amount')
  if (!/cannot be negative/.test(moneyRule)) fail('moneyRefusal must refuse a negative amount')
  if (!/Math\.round\([^)]*100\)\s*\/\s*100\s*===\s*0/.test(moneyRule)) fail('moneyRefusal must refuse an amount that ROUNDS to zero — the 0.001 case the owner reported twice')
  if (!/v > 0 &&/.test(moneyRule)) fail('moneyRefusal must still ALLOW an exact zero — a complimentary line is real')
}
if (!qtyRule) fail('services/eventBooking.ts must export quantityRefusal')
else {
  if (!/must be a number/.test(qtyRule)) fail('quantityRefusal must say "must be a number"')
  if (!/v === 0/.test(qtyRule)) fail('quantityRefusal must refuse a quantity of 0 — a line for nothing is not a line')
}
for (const [name, src] of [['eventSpaces', spaces], ['menuPackages', menus]] as const) {
  if (!/return `\$\{label\} must be a number`[\s\S]*return `\$\{label\} cannot be negative`/.test(src)) fail(`${name}: negativeFieldError must distinguish "must be a number" from "cannot be negative"`)
}
/**
 * The instalment EDIT refuses a non-positive amount before it writes.
 *
 * This pinned the refusal's exact words ('Amount must be a positive number') and went red when the
 * wording was corrected — the message used to end up telling the operator to "enter 0" on the one
 * path where zero is also refused, which is the fault being fixed. A guard that fails because the
 * sentence it quotes got BETTER is a guard for the past. What matters is the rule: the amount is
 * checked, and the check happens before the update.
 */
const payPut = handler(events, 'put', '/:id/payments/:paymentId')
{
  const refusalAt = payPut.search(/round2\(amt\)\s*<=\s*0/)
  const updateAt = payPut.search(/(db|tx)\.update/)
  if (refusalAt < 0) fail('PUT /:id/payments/:paymentId must refuse a non-positive amount')
  else if (updateAt >= 0 && refusalAt > updateAt) fail('…and must do it BEFORE the update, not after')
  // An instalment is the one money field where zero is wrong too, so its refusal must not offer it.
  if (!/zeroAllowed:\s*false/.test(payPut)) {
    fail('PUT /:id/payments/:paymentId must pass zeroAllowed: false — otherwise the shared message tells the operator to enter 0, which this path then refuses')
  }
}

// (3) CSV import applies the same rule before insert.
const impSpaces = imp.slice(imp.indexOf('export async function importSpaces'), imp.indexOf('export async function importMenus'))
const impMenus = imp.slice(imp.indexOf('export async function importMenus'), imp.indexOf('export function validateCSV'))
if (!/cannot be negative[\s\S]*db\.insert\(eventSpace\)/.test(impSpaces)) fail('importSpaces must skip rows with negative capacity/money before insert')
if (!/cannot be negative[\s\S]*db\.insert\(menuPackage\)/.test(impMenus)) fail('importMenus must skip rows with a negative price/minimum before insert')

if (failed) { console.error(`\nevents non-negative: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events non-negative: spaces, packages, menu-line/payment edits and CSV import all refuse negatives')
