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
// The shared invoice LIST once computed its Balance column as (total − amountPaid), ignoring refunds and
// the server's own `balance` — so a refunded deposit read short in the list while the detail page was
// right ("one surface behind"). Assert the list's balanceOf prefers the server balance and nets refunds.
const invSrc = readFileSync(new URL('../packages/tenant-ui/src/invoicing/InvoicesPage.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const balanceOfBody = (invSrc.match(/const\s+balanceOf\b[\s\S]{0,600}/) || [''])[0]
structural.push(
  [/r\.balance/.test(balanceOfBody), 'InvoicesPage balanceOf must use the server-provided r.balance (net of refunds)'],
  [/amountRefunded/.test(balanceOfBody), 'InvoicesPage balanceOf fallback must net refunds (reference amountRefunded)'],
)

// Void must refuse a refunded invoice. Void guards by NET money (amountPaid − amountRefunded), so a
// fully-refunded invoice nets 0 and once slipped through — refiling a real, reversed sale as "never
// issued" and skewing the refunded/void counts (contractor M24). 'refunded' is terminal for every other
// mutation (edit/send/payment); the void handler must reject it too, before the net-money check.
const invRouteSrc = readFileSync(new URL('../packages/tenant-backend/src/invoicing/invoices.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const voidBody = (invRouteSrc.match(/\/:id\/void'[\s\S]{0,900}?\/:id\/refund'/) || invRouteSrc.match(/\/:id\/void'[\s\S]{0,900}/) || [''])[0]
structural.push(
  [/status === 'refunded'/.test(voidBody), "the void handler must reject a 'refunded' invoice (a reversed sale can't be voided)"],
)

// The salon dashboard has its own outstanding tile (not the shared reporting service). It once summed
// total − amountPaid, ignoring refunds, so a part-paid-then-refunded invoice read short and ONLY the
// dashboard disagreed with the list / /stats / Reports (BL1a). It must net refunds like balanceExpr.
const salonDash = readFileSync(new URL('../templates/crm-salon/backend/src/routes/dashboard.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const owingBody = (salonDash.match(/outstandingValue[\s\S]{0,400}/) || [''])[0]
structural.push(
  [/amountRefunded/.test(owingBody), 'salon dashboard outstanding must net refunds (reference amountRefunded), matching the shared balance model'],
)

// What is owed is a question for the BALANCE, never for the status string. Three surfaces each re-derived it
// from `status === 'refunded'` and so disagreed with the record: the stats tile skipped those invoices, the
// list printed the word "Refunded" over the amount, and the detail page reported $0.00 — and hid Record
// Payment — on an invoice still owing $100. $206 across three invoices was owed and counted nowhere. (T29 M1)
// Outstanding excludes 'refunded', and Reports does the same through `issued`. That is only safe while
// 'refunded' really does mean the WHOLE sale came back — so the self-heal has to correct any row that carries
// it after a merely partial refund, or the tile quietly writes off money still owed. Three such rows held
// $206 between them. (T29 M1)
const invoicesRoute = readFileSync(new URL('../packages/tenant-backend/src/invoicing/invoices.ts', import.meta.url), 'utf8')
const reconcile = (invoicesRoute.match(/async function reconcileInvoiceStatuses[\s\S]*?\n\}/) || [''])[0]
structural.push(
  [/status = 'refunded'[\s\S]*?amount_refunded, 0\)::numeric >= total::numeric/.test(reconcile), "the self-heal must mark a wholly returned sale 'refunded'"],
  [/WHERE status = 'refunded' AND total::numeric > 0 AND coalesce\(amount_refunded, 0\)::numeric < total::numeric/.test(reconcile), "…and must take 'refunded' OFF a row where only part of the money went back — that status is read as 'owes nothing'"],
  [/WHEN amount_paid::numeric >= total::numeric THEN 'paid'/.test(reconcile), '…restoring it to paid when the invoice was settled in full'],
  [/THEN 'partial'/.test(reconcile) && /ELSE 'sent'/.test(reconcile), '…to partial while money is still held, and open once the deposit has gone back'],
)

const listPage = readFileSync(new URL('../packages/tenant-ui/src/invoicing/InvoicesPage.tsx', import.meta.url), 'utf8')
const balanceCell = (listPage.match(/key: 'amountPaid'[\s\S]*?\} \},/) || [''])[0]
structural.push(
  [balanceCell.indexOf('const bal = balanceOf(r)') < balanceCell.indexOf("r.status === 'refunded'"), 'the invoice list must work out the balance BEFORE it considers printing "Refunded" over it'],
  [/if \(bal > 0\.005\)/.test(balanceCell), '…and print the amount whenever one is owed'],
)

const detailPage = readFileSync(new URL('../packages/tenant-ui/src/invoicing/InvoiceDetailPage.tsx', import.meta.url), 'utf8')
structural.push(
  [/const serverBalance = invoice\.balance/.test(detailPage), "the invoice page must use the server's balance rather than deriving its own"],
  [/const closed = invoice\.status === 'void' \|\| fullyReturned/.test(detailPage), 'only void or a WHOLE sale returned closes an invoice — otherwise Record Payment is hidden on money still owed'],
  [!/const closed = invoice\.status === 'void' \|\| invoice\.status === 'refunded'/.test(detailPage), "…the status string must not decide it"],
)

let sFail = 0
// prefix matches the behavioural half above, so the self-test harness counts these as failures too
for (const [ok, msg] of structural) { if (!ok) { sFail++; console.error(`FAIL: (structural) ${msg}`) } }
if (sFail) { console.error(`\nmoney model: ${sFail} structural check(s) FAILED`); process.exit(1) }
console.log(`money model: outstanding summed over \`issued\` (dashboard == Reports == /stats); invoice list balance nets refunds`)
