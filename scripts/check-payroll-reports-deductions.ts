// CI guard: a template that can RECOVER money from pay must REPORT it on the pay run.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// The staff balance (Salon RR9) lets a business recover an over-reimbursement from somebody's pay.
// Five templates mount the shared expenses module and therefore have that balance; nine templates
// have a payroll summary. The five got a deductions line and a wage floored at zero. The other four
// did not, and today that is correct — they have no staff balance, so there is nothing to deduct.
//
// It is correct TODAY. The moment somebody wires the shared expenses module into crm-rv or crm-vet
// — which is one line in one file — that template can record a payroll deduction and its pay run
// will not mention it. The balance would go down and the figure somebody types into the bank would
// stay the same, so the money gets recovered twice or not at all depending on which number they
// trusted. Nobody would notice until a pay run was wrong.
//
// So the two facts are coupled here rather than left to be remembered. This is the same shape as the
// fault this session kept finding: a rule enforced at one door out of five (expenses/time approval),
// a prop honoured by one table out of five (DataTable `show`), a category list the form and the
// server each kept their own copy of. The fix is never "remember to do the other four" — it is to
// make the missing four impossible to ship.
//
//   bun scripts/check-payroll-reports-deductions.ts
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8') } catch { return '' } }
// The ONE comment stripper (scripts/lib/stripComments.ts): string-aware, so a route pattern like
// '/file/*' or a `src/**` in a line comment cannot pair with a later `*/` and delete real code. (T57)
import { stripSource as strip } from './lib/stripComments.ts'

const templates = readdirSync(join(ROOT, 'templates')).filter((t) => t.startsWith('crm') && t !== 'crm-automotive')

let coupled = 0
let payrollOnly = 0
for (const t of templates) {
  const expensesRoute = read(`templates/${t}/backend/src/routes/expenses.ts`)
  const payrollRoute = read(`templates/${t}/backend/src/routes/payroll.ts`)
  const mountsShared = /createExpenseRoutes/.test(strip(expensesRoute))
  const hasPayroll = !!payrollRoute

  if (!mountsShared) { if (hasPayroll) payrollOnly++; continue }

  // It can hold a staff balance. Three things follow.
  if (!/staffAccountEntry/.test(strip(expensesRoute))) {
    fail(`${t} mounts the shared expenses module without handing it staffAccountEntry — the staff balance routes will refuse, so an over-payment can be found and never recorded.`)
  }
  const schema = read(`templates/${t}/backend/db/schema.ts`)
  if (!/pgTable\('staff_account_entry'/.test(schema)) {
    fail(`${t} has the staff-balance routes wired and no staff_account_entry table in schema.ts — the boot reconcile creates tables from THIS file, so the feature would 500 on a fresh tenant.`)
  }
  if (!/repaid_amount/.test(schema)) {
    fail(`${t} is missing the expense repayment columns (repaid_amount and friends) — the correction a reimbursed claim needs.`)
  }

  if (!hasPayroll) continue
  coupled++
  const payroll = strip(payrollRoute)
  if (!/deductionsBetween/.test(payroll)) {
    fail(`${t} can recover money from pay (it mounts the shared expenses module) and its payroll summary never asks what was recovered. The balance would go down while the figure somebody pays out stays the same.`)
  }
  if (!/Math\.max\(0, u\.totalPay - u\.deductions\)/.test(payroll)) {
    fail(`${t}'s payroll summary does not floor the wage at zero. Somebody who owes more than they earned in a light week lands on "to pay: -$2.00", which is the column a person copies into a bank transfer.`)
  }
  if (!/unrecovered/.test(payroll)) {
    fail(`${t}'s payroll summary floors the wage without reporting what could NOT be recovered. Clamping silently hides the same money the negative number was at least honest about.`)
  }
}

if (!coupled) fail('no template both mounts the shared expenses module and has a payroll summary — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${coupled} template(s) that can recover money from pay report it on the pay run; ${payrollOnly} have payroll with no staff balance to recover from, which is why they are not asked to`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)
