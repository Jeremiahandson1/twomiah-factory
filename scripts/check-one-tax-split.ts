// CI guard: a tax report's excise / sales / local lines must ADD UP to its tax total.
//
// "$5.68 tax gap on 09-23" survived five test rounds. The components were each netted with their own
// GREATEST(0, charged − refunded) floor — right per column, since no tax line collects a negative
// amount — and a floor is not additive: on an order whose refund returned more of one component than
// that component was charged, the component floors at zero while total_tax keeps the whole deduction.
// The parts then exceed the whole, and the derived local line absorbs the difference.
//
// utils/revenue.ts now carries ONE additive split (exciseKeptExpr / salesKeptExpr / localKeptExpr), and
// this guard stops a report summing the raw components again. It would have caught the original fault:
// the compliance tax report summed the raw trio and clamped the residual at the SUM level, and the
// filing's own summaries had worked the cascade out independently without the compliance report
// learning it.
//
// The raw per-row exprs are still legitimate for a DIAGNOSTIC — "which orders were charged at the wrong
// rate" asks what an order was charged, not what it kept — so what is forbidden is SUMMING them, not
// naming them.
//   bun scripts/check-one-tax-split.ts
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const T = 'templates/crm-dispensary/backend/src'

// ── 1. the one definition ─────────────────────────────────────────────────────────────────────────
const revenue = read(`${T}/utils/revenue.ts`)
if (!revenue) fail(`${T}/utils/revenue.ts is missing — the tax split has nowhere to live`)
else {
  for (const name of ['exciseKeptExpr', 'salesKeptExpr', 'localKeptExpr', 'exciseKeptExprBare', 'salesKeptExprBare', 'localKeptExprBare']) {
    if (!new RegExp(`export const ${name}\\b`).test(revenue)) fail(`revenue.ts must export ${name}`)
  }
  // The cascade itself, by shape rather than by one literal line, so it can be rewritten but not
  // weakened: excise capped at the tax kept, sales capped at what excise leaves, local the residual.
  if (!/LEAST\(\$\{exc\}, \$\{tot\}\)/.test(revenue)) {
    fail('the excise line must be capped at the tax the order actually kept — LEAST(excise, total)')
  }
  if (!/LEAST\(\$\{sal\}, GREATEST\(0, \$\{tot\} - \$\{excKept\}\)\)/.test(revenue)) {
    fail('the sales line must be capped at what the excise line leaves — LEAST(sales, total − excise)')
  }
  if (!/\$\{tot\} - \$\{excKept\} - \$\{salKept\}/.test(revenue)) {
    fail('the local line must be the residual, so the three sum to the total by construction')
  }
  // Both tax surfaces must settle the components in the SAME order or they disagree on a mixed basket.
  if (!/excise is settled before sales/i.test(revenue) && !/Excise is settled before sales/.test(revenue)) {
    fail('revenue.ts must record WHY excise is settled before sales — the order is load-bearing')
  }
}

// ── 2. nobody sums the raw components ─────────────────────────────────────────────────────────────
// Naming a raw expr is fine (a per-order diagnostic); summing one is the fault.
const RAW = ['exciseNetExpr', 'salesNetExpr', 'exciseNetExprBare', 'salesNetExprBare']
const walk = (dir: string): string[] => {
  const out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(ROOT + dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules') continue
    const p = `${dir}/${e}`
    if (/\.(ts|tsx)$/.test(e)) out.push(p)
    else if (!e.includes('.')) out.push(...walk(p))
  }
  return out
}
const files = walk(T)
if (files.length < 5) fail(`the walk found only ${files.length} file(s) under ${T} — it is not looking where the routes are`)

for (const p of files) {
  if (p.endsWith('utils/revenue.ts')) continue
  const src = read(p)
  for (const raw of RAW) {
    // SUM( … ${rawExpr} … ) on one line. The components are always summed inline in these queries.
    const re = new RegExp(`SUM\\(\\s*\\$\\{${raw}\\}`)
    if (re.test(src)) {
      fail(`${p}: sums \${${raw}} — a report's tax lines must come from the additive split (exciseKeptExpr / salesKeptExpr / localKeptExpr), or they will not add up to its total`)
    }
  }
  // …and the residual must not be rebuilt by hand from sums of the raw trio, which is how the
  // compliance report hid the gap one level up instead of fixing it.
  if (/GREATEST\(0,\s*COALESCE\(SUM\(\$\{taxNetExpr/.test(src)) {
    fail(`${p}: clamps a local-tax residual built from SUMs — clamping the aggregate hides the gap rather than closing it; sum \${localKeptExpr} instead`)
  }
}

// ── 3. the surfaces that report the split actually use it ─────────────────────────────────────────
for (const [p, what] of [
  [`${T}/routes/compliance.ts`, 'the compliance tax report'],
  [`${T}/routes/tax-filing.ts`, 'the tax filing summaries'],
] as [string, string][]) {
  const src = read(p)
  if (!src) { fail(`${p} is missing`); continue }
  if (!/SUM\(\$\{exciseKeptExpr(Bare)?\}/.test(src)) fail(`${what} must sum \${exciseKeptExpr} — it reports an excise line and so must use the additive split`)
  if (!/SUM\(\$\{salesKeptExpr(Bare)?\}/.test(src)) fail(`${what} must sum \${salesKeptExpr} for the same reason`)
}

// The per-day report is the one the owner reads; it must report the local line from the split too.
const compliance = read(`${T}/routes/compliance.ts`)
if (compliance && !/SUM\(\$\{localKeptExpr\}/.test(compliance)) {
  fail('the compliance tax report must sum ${localKeptExpr} for its local line, not rebuild it from the other sums')
}

if (failed) { console.error(`\none tax split: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`one tax split: excise + sales + local = total tax, by construction, across ${files.length} dispensary backend files`)
