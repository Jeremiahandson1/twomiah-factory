// CI guard for the invoice refund model. It has TWO halves that MUST hold together — every prior fix
// satisfied one and broke the other (ignored refunds → wrote off the balance → inverted the sign).
// This asserts both, plus the neutral cases, so a one-directional change can't regress it again.
//   bun scripts/check-money-model.ts
import { invoiceBalance, recomputeStatus } from '../packages/tenant-backend/src/invoicing/money.ts'

type Inv = { status?: string; total: number; amountPaid: number; amountRefunded?: number }
const cases: Array<{ name: string; inv: Inv; prev: string; balance: number; status: string }> = [
  // ── The two halves that fought each other ──────────────────────────────────────────────
  { name: 'deposit refunded on a partly-paid invoice REOPENS the balance',
    inv: { total: 200, amountPaid: 50, amountRefunded: 50 }, prev: 'partial', balance: 200, status: 'sent' },
  { name: 'partial refund of a deposit leaves the net still owed',
    inv: { total: 200, amountPaid: 50, amountRefunded: 20 }, prev: 'partial', balance: 170, status: 'partial' },
  { name: 'partial refund on a FULLY-PAID invoice does NOT create a balance (return/goodwill)',
    inv: { total: 200, amountPaid: 200, amountRefunded: 50 }, prev: 'paid', balance: 0, status: 'paid' },
  { name: 'large goodwill refund on a fully-paid invoice still owes nothing',
    inv: { total: 200, amountPaid: 200, amountRefunded: 150 }, prev: 'paid', balance: 0, status: 'paid' },
  // ── Neutral / boundary cases ───────────────────────────────────────────────────────────
  { name: 'whole sale returned → refunded, $0',
    inv: { total: 200, amountPaid: 200, amountRefunded: 200 }, prev: 'paid', balance: 0, status: 'refunded' },
  { name: 'partly paid, no refund → owes the remainder',
    inv: { total: 200, amountPaid: 50, amountRefunded: 0 }, prev: 'sent', balance: 150, status: 'partial' },
  { name: 'fully paid, no refund → paid, $0',
    inv: { total: 200, amountPaid: 200, amountRefunded: 0 }, prev: 'sent', balance: 0, status: 'paid' },
  { name: 'overpaid then refund down to total → paid, $0',
    inv: { total: 200, amountPaid: 250, amountRefunded: 50 }, prev: 'paid', balance: 0, status: 'paid' },
  { name: 'void owes nothing',
    inv: { status: 'void', total: 200, amountPaid: 0, amountRefunded: 0 }, prev: 'void', balance: 0, status: 'void' },
  { name: 'draft stays draft on recompute',
    inv: { total: 200, amountPaid: 100, amountRefunded: 0 }, prev: 'draft', balance: 100, status: 'draft' },
  // A legacy row stored as status='overdue' (older templates persisted it) is STILL money owed. Only
  // 'void' zeroes a balance. Reporting must sum balances over `issued`, never a narrower "open" set that
  // drops these rows — that made the dashboard disagree with Reports / the invoice list. See below.
  { name: 'a stored status=overdue invoice is still money owed (not dropped from AR)',
    inv: { status: 'overdue', total: 200, amountPaid: 0, amountRefunded: 0 }, prev: 'overdue', balance: 200, status: 'sent' },
]

let failed = 0
for (const c of cases) {
  const b = invoiceBalance(c.inv)
  const s = recomputeStatus(c.inv, c.prev)
  const okB = Math.abs(b - c.balance) < 0.005
  const okS = s === c.status
  if (!okB || !okS) {
    failed++
    console.error(`FAIL: ${c.name}`)
    if (!okB) console.error(`      balance: got ${b}, want ${c.balance}`)
    if (!okS) console.error(`      status:  got ${s}, want ${c.status}`)
  }
}
if (failed) { console.error(`\nmoney model: ${failed}/${cases.length} case(s) FAILED`); process.exit(1) }
console.log(`money model: all ${cases.length} refund cases pass (deposit reopens, fully-paid never does)`)

// ── Structural guard: outstanding must be summed the SAME way everywhere ─────────────────────────
// The dashboard once summed balances over an `isOpen` (sent/open/viewed/partial) set while Reports and
// the invoice /stats summed over `issued` (everything but draft/void/refunded). Legacy status='overdue'
// rows fell through the gap, so the dashboard's "outstanding" silently disagreed with every other screen.
// Assert the shared reporting service sums one shared balanceExpr over `issued` and never reintroduces
// the narrowing. A read-only source check — no DB needed in CI.
import { readFileSync } from 'node:fs'
const reportSrc = readFileSync(new URL('../packages/tenant-backend/src/reporting/reporting.ts', import.meta.url), 'utf8')
const structural: Array<[boolean, string]> = [
  [reportSrc.includes('const balanceExpr'), 'reporting.ts must define a single shared balanceExpr for outstanding/overdue'],
  [!/const\s+isOpen\b/.test(reportSrc), 'reporting.ts must NOT reintroduce an isOpen narrowing on the balance aggregates'],
  [(reportSrc.match(/coalesce\(sum\(\$\{balanceExpr\}\)/g) || []).length >= 2, 'both outstanding and overdue must sum balanceExpr'],
  [!/\{balanceExpr\}\), 0\)`[\s\S]{0,220}?isOpen/.test(reportSrc), 'the balance sums must be filtered by `issued`, not `isOpen`'],
]
let sFail = 0
for (const [ok, msg] of structural) { if (!ok) { sFail++; console.error(`FAIL (structural): ${msg}`) } }
if (sFail) { console.error(`\nmoney model: ${sFail} structural check(s) FAILED`); process.exit(1) }
console.log(`money model: outstanding is summed over \`issued\` in one place (dashboard == Reports == /stats)`)
