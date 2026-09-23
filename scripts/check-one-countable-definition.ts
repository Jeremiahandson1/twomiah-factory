// "Can this line be counted against the purchase limit" has ONE definition, and it is the function
// that does the counting.
//
// uncountableCannabisLines used to answer it on its own: grams > 0, or mg > 0. lineFlowerEquivalentGrams
// answers it by category, because mg only means something where the category's rule is written in mg —
// edibles and tinctures. Concentrate is grams x 2.5 and its mg is never read.
//
// So an 800 mg concentrate with no weight was countable by the first and zero by the second: 20 units,
// 16,000 mg of THC, completed at 0.00 oz, past a 1 oz cap. Flower, pre-roll and vape the same. I opened
// that by adding thc_mg to the sellability test without checking what the weighing side does with it.
// (Dispensary T32 B1.)
//
// Two rules, and between them the gap cannot reopen:
//   1. the sellability test may not compute a weight of its own — it must call the weighing function
//   2. every caller passes the company's equivalency factors, or it is asking a different question from
//      the till next to it (all three kiosk call sites did exactly that, so the kiosk and the register
//      already disagreed about edibles)
//
//   bun run scripts/check-one-countable-definition.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const UTIL = join(ROOT, 'templates/crm-dispensary/backend/src/utils/cannabis.ts')
const ROUTES = join(ROOT, 'templates/crm-dispensary/backend/src/routes')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(UTIL)) { console.log('crm-dispensary not present — nothing to check'); process.exit(0) }

const util = readFileSync(UTIL, 'utf8')
const fn = /export function uncountableCannabisLines\(([\s\S]*?)\n\}/.exec(util)
if (!fn) { fail('uncountableCannabisLines is gone — this guard is pinned to it'); process.exit(1) }
const body = fn[1]

// ---- 1. it asks the weighing function ----
if (!/lineFlowerEquivalentGrams\(/.test(body)) {
  fail('uncountableCannabisLines does not call lineFlowerEquivalentGrams — it is deciding what can be counted by a rule of its own, which is how mg-only concentrate sold at 0.00 oz')
}
for (const own of ['unitGramsOf', 'unitThcMg']) {
  if (new RegExp(`${own}\\(`).test(body)) {
    fail(`uncountableCannabisLines calls ${own}() directly — that is a second definition of "countable", and it will disagree with the one that counts (T32 B1)`)
  }
}
// the topical exemption is the ONE thing it may decide itself, and only via the factor
if (!/rule\.factor === 0/.test(body)) {
  fail('uncountableCannabisLines no longer exempts a category whose equivalency factor is 0 — topicals count for nothing by design, and refusing them stops a sale the rules allow (T32 M2)')
}

// ---- 2. every caller passes the factors ----
// `uncountableCannabisLines(<lines>)` with no second argument asks the question with no rules at all,
// which for an edible is a different answer from the register's.
const files = readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))
for (const f of files) {
  const src = readFileSync(join(ROUTES, f), 'utf8')
  for (const m of src.matchAll(/uncountableCannabisLines\(/g)) {
    // walk the call to its matching close paren
    let i = m.index! + m[0].length, depth = 1
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
      i++
    }
    const call = src.slice(m.index!, i)
    // one top-level argument means no factors were passed
    let d = 0, commas = 0
    for (const ch of call.slice('uncountableCannabisLines('.length, -1)) {
      if ('([{'.includes(ch)) d++
      else if (')]}'.includes(ch)) d--
      else if (ch === ',' && d === 0) commas++
    }
    if (commas === 0) {
      fail(`routes/${f}: uncountableCannabisLines() is called without the company's equivalency factors — it will answer differently from the till beside it (an edible is countable only because its rule is written in mg)`)
    }
  }
}

// ---- 3. weighing a cart without refusing first is how a limit stops being a limit ----
// The public online-order path (menu.ts) had its OWN weighing loop: it read prod.weight and never
// weight_grams, so every seeded product counted as zero; it ignored the equivalency factors, so 25 g of
// concentrate counted as 25 g instead of the 62.5 g of flower it is worth; and it refused nothing.
// Three tills, three answers, and the one a customer drives themselves answered lowest. A surface that
// weighs a cart against the cap must first refuse the lines it cannot weigh. (T34)
for (const f of files) {
  const src = readFileSync(join(ROUTES, f), 'utf8')
  const weighs = /cartCannabisGrams\(/.test(src) || /overPurchaseLimit\(/.test(src)
  if (!weighs) continue
  if (!/uncountableCannabisLines\(/.test(src)) {
    fail(`routes/${f}: it applies the purchase limit but never refuses an uncountable cannabis line — anything it cannot weigh is counted as zero and sold past the cap`)
  }
}
// …and whatever sums that weight converts a unit the ONE way. Summing in a loop is fine — orders.ts
// does, alongside its stock and pricing checks — as long as the per-unit figure comes from
// lineFlowerEquivalentGrams (or cartCannabisGrams, which is that function over a cart). What menu.ts
// did instead was its own conversion, `weightUnit === 'oz' ? n * 28.3495 : n`, reading `weight` and
// never weight_grams and never touching the factors. The test is the SOURCE of the per-unit number,
// not whether there is a loop — flagging every loop failed orders.ts, which is correct code.
for (const f of files) {
  const src = readFileSync(join(ROUTES, f), 'utf8')
  if (!/totalWeightGrams \+=|totalWeightGrams =/.test(src)) continue
  if (/cartCannabisGrams\(|lineFlowerEquivalentGrams\(/.test(src)) continue
  fail(`routes/${f}: it totals cannabis weight without lineFlowerEquivalentGrams/cartCannabisGrams — a hand-rolled conversion misses weight_grams and the equivalency factors, which is how the online order path counted every seeded product as zero (T34)`)
}

console.log(failures
  ? `\n${failures} problem(s).`
  : 'one definition of countable: the sellability test asks the function that does the counting, with the shop\'s own rules, and every till that weighs a cart refuses first')
process.exit(failures ? 1 : 0)
