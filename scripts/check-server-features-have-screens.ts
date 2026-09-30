// CI guard: a server feature an owner is supposed to USE has a screen.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// Asked for by name, as one of three rules meant to close whole families of findings rather than
// individual paths. T49 M1: five features shipped in T48 that exist only in the API — supersede a
// filing, the reconciliation variance list, End of Day's awaitingCollection, delivery-zone overlap
// warnings, and the online-awaiting count. The reconciliation note even tells the owner the orders
// are "listed under 'orders out of step'", a section that does not exist. Lifting a recall is the
// same: the rule works, and a recalled batch has no button on the Batches page for any role.
//
// Each was a real fix. None is reachable by the person it was written for, so from the shop's point
// of view none of them shipped.
//
// ── how it works, and what it deliberately does NOT do ──────────────────────────────────────────
//
// Each entry pairs a server capability with something the front end must mention for it to be
// reachable — a path, a field name, a label. That is a weak test on its own: a screen can reference
// a field and still be useless. It is not trying to prove the screen is good; it is trying to stop a
// capability shipping with NO screen at all, which is the thing that keeps happening.
//
// The OUTSTANDING list is the honest part. Those five are known to be API-only right now and are
// recorded here by name, with the finding that reported them, so nobody has to rediscover them and
// nobody can quietly add a sixth. Moving one out of OUTSTANDING and into COVERED is what "we built
// the screen" looks like to this guard.
//
//   bun scripts/check-server-features-have-screens.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const FE = 'templates/crm-dispensary/frontend/src'
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** Every front-end source file, concatenated — the question is "does the UI mention this anywhere". */
function frontendSource(): string {
  const out: string[] = []
  const walk = (rel: string) => {
    const dir = join(ROOT, FE, rel)
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { walk(join(rel, e.name)); continue }
      if (!/\.(tsx?|jsx?)$/.test(e.name)) continue
      try { out.push(readFileSync(join(dir, e.name), 'utf8')) } catch { /* unreadable is not mentioned */ }
    }
  }
  walk('.')
  return out.join('\n')
}
const ui = frontendSource()
if (!ui) fail(`${FE} has no readable source — this guard cannot answer anything`)

/** Capabilities that MUST be reachable from a screen. */
const COVERED: Array<{ what: string; needles: RegExp[]; why: string }> = [
  {
    what: 'two-factor at sign-in',
    needles: [/mfaRequired/, /completeMfa/],
    why: 'T49 H4: login returns a challenge instead of tokens. Without a code step on the sign-in page, an account with two-factor on cannot sign in at all — the fix would lock people out rather than protect them.',
  },
  {
    what: 'recovery codes at sign-in',
    needles: [/recoveryCodesAvailable|recovery code/i],
    why: 'T49 H4: the codes the product generates have to be typeable somewhere, which was the tester\'s point.',
  },
]
for (const cap of COVERED) {
  const missing = cap.needles.filter((n) => !n.test(ui))
  if (missing.length) fail(`${cap.what} has no screen — the front end never mentions ${missing.map(String).join(' or ')}. ${cap.why}`)
}

/**
 * Known API-only, recorded so they are not rediscovered and a sixth cannot be added quietly.
 *
 * Each is a real T49 M1 finding. The guard asserts the list is HONEST: if one of these has in fact
 * gained a screen, it must move to COVERED rather than sit here understating the product.
 */
const OUTSTANDING: Array<{ what: string; needle: RegExp; finding: string }> = [
  { what: 'supersede a tax filing', needle: /supersede/i, finding: 'T49 M1' },
  { what: 'the excise variance list (varianceOrders)', needle: /varianceOrders/, finding: 'T49 M1' },
  { what: "End of Day's awaiting-collection figure", needle: /awaitingCollection/, finding: 'T49 M1' },
  { what: 'delivery-zone overlap warnings', needle: /overlapWarning/, finding: 'T49 M1' },
  { what: 'the online-awaiting order count', needle: /online_awaiting_count|onlineAwaitingCount/, finding: 'T49 M1' },
  { what: 'lifting a recall from the Batches page', needle: /recall_needs_reason/, finding: 'T49 M1' },
]
const builtSince: string[] = []
for (const item of OUTSTANDING) {
  if (item.needle.test(ui)) builtSince.push(`${item.what} (${item.finding})`)
}
if (builtSince.length) {
  fail(`these are listed as API-only but the front end now references them — move them to COVERED so the guard protects them: ${builtSince.join(', ')}`)
}

if (failed) { console.error(`\nserver features have screens: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`server features have screens: ${COVERED.length} capability(ies) reachable from a screen; ${OUTSTANDING.length} recorded as API-only and still API-only`)
