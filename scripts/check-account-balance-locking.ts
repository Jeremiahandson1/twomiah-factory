// CI guard: a client's account balance can only be spent under a row lock, and only where a ledger exists.
//
// Both rules are invisible to the behaviour suites, which is why they are here rather than there.
//
//   THE LOCK. Spending reads the balance and writes the debit in one transaction; the read must be FOR
//   UPDATE. Without it two tills reading $20 at the same instant both pass the check and both spend it,
//   and the client's balance goes negative by a route nobody authorised. PGlite runs one connection, so
//   no test in this repo can produce the interleaving — a mutation that changed `forUpdate` to false
//   left all 46 assertions green. A guard is the honest tool for a property a test cannot observe.
//
//   THE LEDGER. `account_balance` is a valid method in the shared payment and refund schemas, so every
//   CRM will accept the word. What stops a vertical with no client balances from settling a real sale
//   against an imaginary one is the refusal when the template passed no ledger. If that check is ever
//   softened, twelve CRMs quietly gain a way to mark invoices paid with nothing.
//
//   bun scripts/check-account-balance-locking.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the lock ────────────────────────────────────────────────────────────────────────────────────
const engine = read('packages/tenant-backend/src/clients/accountBalance.ts')

if (!/FOR UPDATE/.test(engine)) fail('accountBalance.ts must read the balance FOR UPDATE somewhere')
// The spend path specifically — a FOR UPDATE that only the read-only helper uses protects nothing.
const spendBody = engine.match(/async function spend\b[\s\S]*?\n  \}/)?.[0]
if (!spendBody) fail('accountBalance.ts: could not find the spend() body to check')
else {
  if (!/await balance\(\s*tx\s*,[^)]*,\s*true\s*\)/.test(spendBody)) {
    fail('accountBalance.ts: spend() must read the balance with forUpdate=true — without the row lock two tills can spend the same money')
  }
  if (!/await add\(\s*tx\s*,/.test(spendBody)) {
    fail('accountBalance.ts: spend() must write the debit through the CALLER\'S tx, or the debit can outlive a rolled-back payment')
  }
}

// ── the ledger, or a refusal ────────────────────────────────────────────────────────────────────
const shared = read('packages/tenant-backend/src/invoicing/invoices.ts')

if (!/ACCOUNT_BALANCE_METHOD/.test(shared)) fail('shared invoices.ts must know the account_balance method by its constant, not a loose string')
if (!/if \(!input\.spendFromAccount\) \{/.test(shared)) {
  fail('shared invoices.ts: an account_balance PAYMENT must be refused when the template wired no ledger')
}
if (!/if \(!input\.creditToAccount\) \{/.test(shared)) {
  fail('shared invoices.ts: an account_balance REFUND must be refused when the template wired no ledger')
}

// ── and only the templates that actually keep balances may wire one ─────────────────────────────
const wired: string[] = []
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const p = `templates/${t}/backend/src/routes/invoices.ts`
  if (!existsSync(join(ROOT, p))) continue
  const s = read(p)
  if (!/accountBalance:\s*\{/.test(s)) continue
  wired.push(t)
  // A template that offers the feature must have somewhere to keep it.
  const schema = `templates/${t}/backend/db/schema.ts`
  if (!existsSync(join(ROOT, schema)) || !/clientAccountEntry\s*=\s*pgTable\('client_account_entry'/.test(read(schema))) {
    fail(`${t}: wires options.accountBalance but has no client_account_entry table to keep it in`)
  }
}

if (failed) { console.error(`\naccount balance locking: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`account balance locking: spend is row-locked, both money paths refuse without a ledger; wired in ${wired.length ? wired.join(', ') : 'no templates'}`)
