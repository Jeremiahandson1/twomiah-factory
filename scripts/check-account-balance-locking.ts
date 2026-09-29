// CI guard: a client's account balance can only be spent under a row lock, and only where a ledger exists.
//
// Both rules are invisible to the behaviour suites, which is why they are here rather than there.
//
//   THE LOCK. Spending reads the balance and writes the debit in one transaction, and every spender
//   for one client must be serialised through a single row that ALWAYS EXISTS — the client's own.
//   PGlite runs one connection, so no test in this repo can produce the interleaving; a guard is the
//   honest tool for a property a test cannot observe.
//
//   It has to check WHAT is locked, not that a keyword is present. The first version asked only
//   whether "FOR UPDATE" appeared. It did — on the LEDGER — and that is not a lock against
//   overspending at all: FOR UPDATE takes no predicate lock, so a concurrent INSERT of a new debit is
//   not blocked, and a client with no entries yet locks nothing. A live retest on real Postgres
//   settled two of six simultaneous payments against a $40.00 balance and left it at −$35.96, with
//   this guard green the whole time. A guard that checks for a keyword rather than the property is
//   worse than no guard, because it is believed.
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

if (!/FOR UPDATE/.test(engine)) fail('accountBalance.ts must take a row lock before spending')

// WHAT it locks, not merely that it locks.
//
// The first version of this guard asked only whether the words FOR UPDATE appeared, and they did —
// on the LEDGER table. That is not a lock against overspending: FOR UPDATE locks the rows that
// exist when it runs and takes no predicate lock, so a concurrent INSERT of a new debit walks
// straight past it, and a client with no entries yet locks nothing at all. A live retest proved it
// on real Postgres — six simultaneous payments against $40.00, two settled, balance −$35.96 — while
// this guard sat green. A guard that checks for a keyword instead of the property is worse than no
// guard, because it is believed.
//
// The lock must be on a row that ALWAYS EXISTS and is ONE PER CLIENT, so every spender for that
// client contends on the same thing.
const lockBody = engine.match(/async function lockClient\b[\s\S]*?\n  \}/)?.[0]
if (!lockBody) fail('accountBalance.ts: spending must serialise through a lockClient() that locks one row per client')
else {
  if (/FROM \$\{from\}/.test(lockBody)) {
    fail('accountBalance.ts: lockClient() locks the LEDGER, which does not stop a concurrent insert — lock the client row instead')
  }
  if (!/FROM \$\{anchor\}/.test(lockBody) || !/FOR UPDATE/.test(lockBody)) {
    fail('accountBalance.ts: lockClient() must SELECT … FROM the anchor (one row per client) FOR UPDATE')
  }
}

// The spend path specifically — a lock nothing calls protects nothing.
const spendBody = engine.match(/async function spend\b[\s\S]*?\n  \}/)?.[0]
if (!spendBody) fail('accountBalance.ts: could not find the spend() body to check')
else {
  if (!/await lockClient\(\s*tx\s*,/.test(spendBody)) {
    fail('accountBalance.ts: spend() must take the client lock before reading the balance — two tills can otherwise spend the same money')
  }
  // …and it must REFUSE when the lock could not be taken, rather than carrying on unserialised.
  if (!/if \(!await lockClient\(/.test(spendBody)) {
    fail('accountBalance.ts: spend() must refuse when the client row cannot be locked, not proceed unlocked')
  }
  if (!/await add\(\s*tx\s*,/.test(spendBody)) {
    fail('accountBalance.ts: spend() must write the debit through the CALLER\'S tx, or the debit can outlive a rolled-back payment')
  }
  // The lock has to come BEFORE the read it protects.
  if (spendBody.indexOf('lockClient(') > spendBody.indexOf('await balance(')) {
    fail('accountBalance.ts: spend() reads the balance before taking the lock, which is the same race with extra steps')
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
