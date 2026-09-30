// CI guard: EVERY way a sale is created or completed asks whether the product can be sold, and every
// way a product is offered excludes a recalled one.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// This is a RULE guard, not a bug guard, and it was asked for by name. Across five QA rounds the same
// shape of finding kept coming back: a fix that closed the exact path the report named and left the
// neighbouring ones open.
//
//   T45 BL4   the register sold a recalled product          → fixed the register
//   T47 P4    untracked stock sold past a blocked batch     → fixed the register
//   T47 P20   a new zone could not overlap                  → editing one still could
//   T48 Q6    a recall lifted itself through Deplete        → three doors, one locked
//   T48 Q7    the campaign LIST was gated                   → the detail routes were not
//   T49 B1    the recall stopped the register               → order-ahead sold it, and the
//                                                             complete step handed it over
//
// B1 is the worst of them because the rule was sixty lines of batch arithmetic written out INLINE in
// POST /api/orders. Nothing else could reuse it, so nothing else did. A rule that exists in one
// route is a rule about that route.
//
// So: one implementation in services/sellableStock.ts, and this guard asserts that every door calls
// it and that nobody has quietly written a second copy.
//
//   bun scripts/check-every-sale-path-checks-batches.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const B = 'templates/crm-dispensary/backend/src/'

// ── the one implementation ──────────────────────────────────────────────────────────────────────
const engine = read(B + 'services/sellableStock.ts')
if (!engine) fail('services/sellableStock.ts is missing — the batch rule has no single home')
for (const needed of ['resolveSellableStock', 'recalledProductIds']) {
  if (!new RegExp(`export (?:async )?function ${needed}\\b`).test(engine)) {
    fail(`sellableStock.ts must export ${needed}()`)
  }
}
// The clause that makes a recall bite on untracked stock. Losing it is how T45 BL4 comes back.
if (!/blockedProducts\.set\(productId, 'recalled'\)/.test(engine)) {
  fail('sellableStock.ts: a recalled batch must block the whole PRODUCT, untracked units included — that is T45 BL4 and it is a blocker')
}
// …and the clause that keeps it from closing shops that do not run batches at all.
if (!/if \(spare > 0\) \{ out\.untrackedUnits\.set/.test(engine)) {
  fail('sellableStock.ts: stock outside every batch must stay sellable under a hold that is not a recall — refusing it would be a worse bug (T47 P4)')
}

// ── every door a sale comes in through ──────────────────────────────────────────────────────────
//
// Each entry is a file, the route that creates or completes a sale in it, and what it is in words.
const DOORS: Array<{ file: string; route: RegExp; what: string }> = [
  { file: 'routes/orders.ts', route: /app\.post\('\/',/, what: 'the register — POST /api/orders' },
  { file: 'routes/orders.ts', route: /app\.post\('\/:id\/complete'/, what: 'handing the goods over — POST /api/orders/:id/complete' },
  { file: 'routes/menu.ts', route: /app\.post\('\/order'/, what: 'public order-ahead — POST /api/public/menu/order' },
  { file: 'routes/kiosk.ts', route: /app\.post\('\/session\/:token\/checkout'/, what: 'the kiosk till — POST /api/kiosk/session/:token/checkout' },
  { file: 'routes/kiosk.ts', route: /app\.post\('\/session\/:token\/add-item'/, what: 'the kiosk basket — POST /api/kiosk/session/:token/add-item' },
]
for (const door of DOORS) {
  const src = read(B + door.file)
  if (!src) { fail(`${door.file} is missing`); continue }
  const at = src.search(door.route)
  if (at === -1) { fail(`${door.file}: could not find the route for ${door.what} — if it was renamed, update this guard`); continue }
  // The route's own body: from its opening to the next top-level `app.` registration.
  const rest = src.slice(at)
  const next = rest.slice(1).search(/\napp\.(?:get|post|put|patch|delete)\(/)
  const body = next === -1 ? rest : rest.slice(0, next + 1)
  if (!/resolveSellableStock\(/.test(body)) {
    fail(`${door.what} does not ask whether the product can be sold. Every way a sale is created or completed calls resolveSellableStock() — this is the T49 B1 rule.`)
  }
}

// ── every channel a product is OFFERED through ──────────────────────────────────────────────────
//
// Refusing at checkout is not enough: the tester was recommended a recalled product by name, with
// its remaining stock quoted. A recall should make it disappear.
// Scoped to the ROUTE, not the file. The first version of this asked only whether the file
// mentioned recalledProductIds anywhere — and it does, in a second route — so neutering the
// listing left the guard green. That is the same keyword-instead-of-property mistake that let the
// account-balance race ship, and it was caught the same way: by mutation-testing the guard.
const OFFERS: Array<{ file: string; route: RegExp; needle: RegExp; what: string }> = [
  { file: 'routes/menu.ts', route: /app\.get\('\/',/, needle: /recalledProductIds\(/, what: 'the public menu listing' },
  { file: 'routes/menu.ts', route: /app\.get\('\/:slug'/, needle: /recalledProductIds\(/, what: "a product's own public page" },
  { file: 'routes/kiosk.ts', route: /app\.get\('\/menu'/, needle: /recalledProductIds\(/, what: 'the kiosk menu' },
]
for (const offer of OFFERS) {
  const src = read(B + offer.file)
  if (!src) { fail(`${offer.file} is missing`); continue }
  const at = src.search(offer.route)
  if (at === -1) { fail(`${offer.file}: could not find the route for ${offer.what} — if it was renamed, update this guard`); continue }
  const rest = src.slice(at)
  const next = rest.slice(1).search(/\napp\.(?:get|post|put|patch|delete)\(/)
  const body = next === -1 ? rest : rest.slice(0, next + 1)
  if (!offer.needle.test(body)) {
    fail(`${offer.what} (${offer.file}) can still offer a recalled product — it must exclude them`)
  }
}

// …and the AI file holds FOUR product pools. Patching the two you happen to read first is the exact
// mistake this guard is about.
{
  const ai = read(B + 'routes/ai-budtender.ts')
  const pools = (ai.match(/FROM products p\b/g) || []).length
  const guarded = (ai.match(/\$\{NOT_RECALLED\}/g) || []).length
  if (pools && guarded < pools) {
    fail(`ai-budtender.ts has ${pools} product pool(s) and only ${guarded} exclude recalled stock — every pool, or the ones that do not become the way round`)
  }
}

// ── and nobody has written the rule a second time ───────────────────────────────────────────────
//
// The failure mode this catches: a future change re-implements the batch arithmetic inline, the two
// copies drift, and the one nobody updated is the one that sells the recalled lot. Anything reading
// batch STATUSES and deciding sellability belongs in sellableStock.ts.
{
  const routes = join(ROOT, B, 'routes')
  const files = existsSync(routes) ? readdirSync(routes).filter((f) => f.endsWith('.ts')) : []
  // batches.ts OWNS batch statuses: it is the route that recalls, quarantines, depletes and lifts,
  // and "leaving a recall takes a written reason" (T48 Q6) is its rule to enforce. Deciding what a
  // status MEANS FOR A SALE is the thing that belongs in one place; deciding what the status IS
  // belongs here.
  const OWNS_BATCH_STATUS = /^batches\.ts$/
  for (const f of files) {
    if (OWNS_BATCH_STATUS.test(f)) continue
    const src = read(B + 'routes/' + f)
    // The tell is a route deciding for itself that 'recalled' means unsellable, rather than asking.
    const decides = /status === 'recalled'|status: 'recalled'[^)]*unsellable|=== 'recalled'\s*\)\s*\{?\s*(?:return|blocked)/.test(src)
    if (decides && !/sellableStock/.test(src)) {
      fail(`routes/${f} decides for itself what a recalled batch means. Call resolveSellableStock() instead — a second copy of this rule is a second rule.`)
    }
  }
}

if (failed) { console.error(`\nevery sale path checks batches: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`every sale path checks batches: ${DOORS.length} sale door(s) call the one rule, ${OFFERS.length} offering channel(s) exclude recalled stock, no second copy`)
