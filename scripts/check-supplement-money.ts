// CI guard: a supplement's money is the server's arithmetic, and approving it is a privileged act.
//
// Three faults met on one screen in roof T17. The supplements list showed SUP-001 with a header total
// of $77,777.00 directly above its only line item of $200.00, and SUP-002 displayed as $-600.00 — an
// approved supplement for negative money. The claim above them read a Supplement Total of $77,677
// where the three approved supplements summed to $78,277.
//
//   H2   the server stored `totalAmount` as the client sent it, and never looked at the line items.
//        The quote endpoint three modules away already did this correctly; this one did not.
//
//   H1   the claim total was read AFTER the row had been set to 'approved', so the row was already in
//        the sum — and then its amount was added on top, guarded by a test on the STALE pre-update
//        status that was therefore always true. Whichever supplement was approved most recently was
//        counted twice. The comment said "Include this one since we just updated it"; it already was.
//
//   AUTH there was no role check anywhere in the insurance module, so any signed-in user — a staff
//        login included — could approve a supplement and move money on the claim. requireManager is
//        the gate account.ts and billing.ts already use.
//
// A denial has to be symmetrical: reversing an approval must take the money back off, or the claim
// stays overstated for ever.
//   bun scripts/check-supplement-money.ts
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const FILE = 'templates/crm-roof/backend/src/routes/insurance.ts'
const src = (() => { try { return readFileSync(ROOT + FILE, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } })()
if (!src) fail(`${FILE} is missing`)

/**
 * ONE HANDLER'S BODY, however long it has grown. (T41)
 *
 * These checks used to read a fixed slice — the first 2,000 or 2,500 characters after the route
 * declaration — and T41 added comments to the approve and deny handlers explaining a decision that
 * was reverted and a figure that is now cleared. That pushed the `reduce` past the window and the
 * guard went red on code it should have passed: a false failure, which costs as much trust as a
 * false pass.
 *
 * A handler ends where the next route begins, so that is what this reads. No magic number to
 * outgrow, and a comment can be as long as the explanation needs to be.
 */
const handler = (declaration: string): string => {
  const at = src.indexOf(declaration)
  if (at < 0) return ''
  const rest = src.slice(at + declaration.length)
  const next = rest.search(/\napp\.(get|post|put|patch|delete)\(/)
  return next < 0 ? rest : rest.slice(0, next)
}

// ── the money is computed here, from the line items ───────────────────────────────────────────────
{
  if (!/const lineItems = data\.lineItems\.map\(\(li\) => \(\{ \.\.\.li, total: Number\(\(li\.qty \* li\.unitPrice\)\.toFixed\(2\)\) \}\)\)/.test(src))
    fail('a supplement line total must be computed from qty × unitPrice, not taken from the client')
  if (!/const totalAmount = lineItems\.reduce\(\(s, li\) => s \+ li\.total, 0\)\.toFixed\(2\)/.test(src))
    fail('…and the supplement total must be the sum of those lines')
  if (/totalAmount: data\.totalAmount/.test(src))
    fail('the client\'s totalAmount must never be stored — that is how a $200 supplement reported $77,777')
  if (!/lineItems,\n\s*totalAmount,/.test(src))
    fail('…so the insert must use the computed values')
  // negative money, at both ends
  if (!/const money = z\.number\(\)\.finite\(\)\.nonnegative\(\)/.test(src))
    fail('line quantities and prices must be finite and non-negative — a -$600 supplement was accepted')
  if (!/\.min\(1\),?\n\s*totalAmount: z\.string\(\)\.optional\(\)/.test(src))
    fail('…and a supplement must carry at least one line item')
}

// ── editing a draft obeys the same rule ───────────────────────────────────────────────────────────
{
  if (/lineItems: z\.array\(z\.any\(\)\)\.optional\(\)/.test(src))
    fail('the edit path must validate its line items, not accept z.any()')
  if (!/const \{ totalAmount: _ignored, lineItems: incoming, \.\.\.rest \} = data/.test(src))
    fail('…and must drop the client totalAmount on edit as well as on create')
  if (!/update\.totalAmount = lineItems\.reduce/.test(src))
    fail('…recomputing the total whenever the line items change')
}

// ── the claim total is a SUM, counted once ────────────────────────────────────────────────────────
{
  if (/\+\s*\n?\s*\(sup\.status !== 'approved' \? Number\(approvedAmount\) : 0\)/.test(src))
    fail('the most recently approved supplement is being counted twice — the row is already in the query above it (T17 H1)')
  const approve = handler("app.post('/supplements/:id/approve'")
  if (!approve) fail('the approve route is gone — fix this guard\'s walk')
  if (!/const supTotal = allSups\.reduce\(\(sum, s\) => sum \+ Number\(s\.approvedAmount \|\| 0\), 0\)\n/.test(approve))
    fail('…the claim total must be exactly the sum of the approved supplements')
  if (!/if \(!Number\.isFinite\(approved\) \|\| approved < 0\)/.test(approve))
    fail('an approved amount must be a real, non-negative number')
}

// ── a denial is the mirror of an approval ─────────────────────────────────────────────────────────
{
  const deny = handler("app.post('/supplements/:id/deny'")
  if (!deny) fail('the deny route is gone — fix this guard\'s walk')
  if (!/const stillApproved = await db\.select\(\)\.from\(supplement\)/.test(deny))
    fail('denying a supplement must recompute the claim total — otherwise a reversed decision leaves the claim overstated')
  if (!/supplementAmount: String\(stillApproved\.reduce/.test(deny))
    fail('…from the supplements that are still approved')
  /**
   * …and the denied row must stop claiming to be approved for anything. (T41)
   *
   *   "A denied supplement keeps its old approvedAmount (the total correctly excludes it)."
   *
   * The claim total was right and the supplement itself read "Approved: $1,100" with a denial reason
   * beside it — two contradictory facts on one record, and the one a person reads off the screen was
   * the wrong one.
   */
  if (!/approvedAmount: null,/.test(deny))
    fail('a denial must clear approvedAmount — a denied supplement that still reads "approved for $X" contradicts itself (T41)')
}

// ── approving and denying move money, so they are not open to everyone ────────────────────────────
{
  if (!/import \{ authenticate, requireManager \} from '\.\.\/middleware\/auth\.ts'/.test(src))
    fail('the insurance module must import the role gate it needs')
  for (const route of ['/supplements/:id/approve', '/supplements/:id/deny']) {
    const re = new RegExp(`app\\.post\\('${route.replace(/[/:]/g, (m) => '\\' + m)}', requireManager,`)
    if (!re.test(src)) fail(`${route} must be gated by requireManager — it changes the money on a claim, and any signed-in user could call it`)
  }
  // and the gate must not be quietly widened back to "anyone signed in"
  if (/requireRole\(\s*\)/.test(src)) fail('requireRole() with no roles admits everyone')
}

if (failed) { console.error(`\nsupplement money: ${failed} check(s) FAILED`); process.exit(1) }
console.log('supplement money: totals come from the line items, the claim total is counted once, a denial reverses it, and only a manager may decide')
