// Two rules about data a dispensary did not enter.
//
// 1. WHAT IS CANNABIS IS NOT GUESSED. products.ts had `taxCategory: z.enum([...]).default('cannabis')`
//    and the Add Product form never sends the field, so every product created through the UI was
//    cannabis from March onwards — merch and accessories charged cannabis excise, and once weightless
//    cannabis started being refused, unsellable as well. The seed knew better and carried its own
//    CANNABIS set, which is why the seeded T-shirt was the only merch that worked: two definitions,
//    and the route had the wrong one. There is one definition, isCannabisLine in utils/cannabis.ts.
//    (Dispensary T33 H1)
//
// 2. THE SEED SHIPS NO TRADING DATA. db/seed.ts runs in the Render startCommand for every tenant, real
//    customers included. It was inserting twelve invented products with invented prices, SKUs and stock
//    counts; three ACTIVE loyalty rewards a customer could redeem; and an active delivery zone over
//    Beverly Hills zip codes. Categories and help articles are structure and stay. (Dispensary T32/T33)
//
//   bun run scripts/check-dispensary-no-invented-data.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const ROUTE = join(ROOT, 'templates/crm-dispensary/backend/src/routes/products.ts')
const SEED = join(ROOT, 'templates/crm-dispensary/backend/db/seed.template.ts')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }
if (!existsSync(ROUTE)) { console.log('crm-dispensary not present — nothing to check'); process.exit(0) }

// ---- 1. the route derives, it does not default ----
const route = readFileSync(ROUTE, 'utf8')
if (/taxCategory:\s*z\.enum\([^)]*\)\.default\(/.test(route)) {
  fail("products.ts defaults taxCategory — the form does not send it, so a default silently makes every product cannabis (merch included, charged excise). Leave it optional and derive it from the category.")
}
if (!/isCannabisLine\(\{ category: data\.category \}\)/.test(route)) {
  fail('products.ts does not derive taxCategory from isCannabisLine() — that is the one definition of what cannabis is, shared with the register, the kiosk, tax and the purchase limit')
}
// both write paths, or a product recategorised to Merch keeps charging excise under a new name
for (const [target, label] of [['values.taxCategory', 'create'], ['updateData.taxCategory', 'update']] as const) {
  if (!route.includes(target)) fail(`products.ts never sets taxCategory on ${label} — the category can move without the tax following it`)
}

// ---- 2. the seed ships no trading data ----
if (existsSync(SEED)) {
  const seed = readFileSync(SEED, 'utf8')
  const banned: Array<[RegExp, string]> = [
    [/db\.insert\(product\)/, 'products — a shop\'s catalogue is its own, and seeded rows are sellable, reach Metrc and carry invented stock counts'],
    [/db\.insert\(loyaltyReward\)/, 'loyalty rewards — they seed active, so a customer can redeem an offer the shop never made'],
    [/db\.insert\(deliveryZone\)/, 'a delivery zone — where a shop delivers and for how much is not ours to guess'],
  ]
  for (const [re, why] of banned) {
    if (re.test(seed)) fail(`the dispensary seed inserts ${why}`)
  }
  // and the structure that SHOULD stay, so this guard cannot be satisfied by gutting the seed
  if (!/db\.insert\(productCategory\)/.test(seed)) fail('the seed no longer creates product CATEGORIES — that is a taxonomy, not invented data, and the product form is unusable without one')
  if (!/supportKnowledgeBase/.test(seed)) fail('the seed no longer creates help articles — those are our own documentation, not the shop\'s data')
  // a second definition of "is this cannabis" must not creep back in here either
  if (/const CANNABIS = new Set\(/.test(seed)) fail('the seed carries its own CANNABIS category set — that is the duplicate definition that let the route be wrong for six months without anyone noticing')
}

console.log(failures ? `\n${failures} problem(s).` : 'nothing invented: the tax category is derived from the one definition, and the seed ships structure but no trading data')
process.exit(failures ? 1 : 0)
