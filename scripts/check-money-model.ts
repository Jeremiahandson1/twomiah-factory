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
