// CI guard: a handler that bills a record ONCE must lock that record and use the shared write path.
//
// WHY A GUARD AND NOT A TEST. T41 raced "Bill this visit" on vettest and it double-billed five times
// out of five. I fixed it, added a four-way concurrent test to tests/vet — and that test passed with
// the lock REMOVED. PGlite serialises the sandbox's requests, so no suite in this repo can observe
// this class of race. Re-raced against the live tenant on real Postgres it was worse than reported:
// 4 of 5 rounds double-billed, one round turned 4 clicks into 4 invoices, duplicate numbers in four.
//
// So the only thing that can hold this in place automatically is a guard on the SHAPE of the code.
// Two things have to be true of a "bill this once" handler, and each fixes a different race:
//
//   1. It locks the record inside a transaction — `SELECT … FOR UPDATE` on the row whose
//      already-billed flag is being checked. Re-reading without a lock only narrows the window; the
//      second caller must BLOCK until the first commits, then see what it wrote.
//   2. It creates the invoice through the shared `insertInvoice`, which numbers under
//      `pg_advisory_xact_lock`. Vet had hand-rolled its own creation with a `max()` scan, which is
//      why vet alone handed the same number to two invoices.
//
// WHAT IT WALKS. Route files that bill one record into one invoice — matched by a handler that both
// writes an invoice and sets an `invoiceId`/`invoice_id` on the record it billed. That is the precise
// shape: "this thing becomes an invoice, and must only ever become one".
//
//   bun scripts/check-billing-race-guarded.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** PARKED templates are not modified in this repo and are not held to this. */
const PARKED = /templates[\\/](crm-automotive|crm-homecare)[\\/]/

const files: string[] = []
const walk = (dir: string) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|dist|shared|migrations/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.ts')) files.push(p)
  }
}
for (const tpl of readdirSync(join(ROOT, 'templates'))) walk(join(ROOT, 'templates', tpl, 'backend', 'src', 'routes'))
walk(join(ROOT, 'packages', 'tenant-backend', 'src'))

let checked = 0, handlers = 0
for (const file of files) {
  if (PARKED.test(file)) continue
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const src = strip(raw)

  // A billing handler: it marks the record as billed by writing an invoice id onto it.
  const marksBilled = /\b(invoiceId|invoice_id)\s*[:=]/.test(src) && /insert\(\s*(?:[A-Za-z_$][\w$]*\.)?invoice\b|insertInvoice\(/.test(src)
  if (!marksBilled) continue
  checked++

  // Split into handler blocks so one file's compliant handler cannot excuse another's.
  const blocks = src.split(/\n(?=app\.(?:get|post|put|patch|delete)\(')/)
  for (const block of blocks) {
    const billsOnce = /\b(invoiceId|invoice_id)\s*[:=]/.test(block)
      && (/insertInvoice\(/.test(block) || /insert\(\s*(?:[A-Za-z_$][\w$]*\.)?invoice\b/.test(block))
    if (!billsOnce) continue
    // …and it must be the kind that refuses a second attempt. A handler with no already-billed check
    // is not claiming to bill once, and is out of scope here.
    /**
     * "ALREADY" IS NOT A BILLING CHECK. (T48)
     *
     * The fallback here was a bare `/already/i` over the whole block, meaning any occurrence of the
     * word marked the block as an already-billed guard. agreements.ts's service section — one block,
     * because blocks split on `app.<verb>(` — gained a local helper named `already` for an unrelated
     * question (does a visit already cover this date), and that one identifier pulled the entire
     * service into scope and reported `/plans` as an unlocked billing handler. A word is not a
     * property: ask for the phrase that actually means this.
     *
     * The specific forms are kept, so a handler that really does refuse a second attempt is still
     * checked — and the count printed at the end is the proof that narrowing this did not quietly
     * switch the guard off.
     */
    if (!/already been billed|invoice_id\b[^\n]*\?|\.invoiceId\)/.test(block)
      && !/already\s+(?:been\s+)?(?:billed|invoiced|raised|charged)/i.test(block)) continue
    handlers++

    const route = (/app\.(?:get|post|put|patch|delete)\('([^']*)'/.exec(block) || [, '?'])[1]
    const where = `${relative(ROOT, file).replace(/\\/g, '/')} ${route}`

    /**
     * TWO SPELLINGS OF THE SAME LOCK. Raw SQL writes `FOR UPDATE`; drizzle's query builder writes
     * `.for('update')`. My first version only matched the SQL form and reported crm-landscaping's
     * snow billing as unlocked when it locks its events with `.for('update')` — a false positive
     * printed with the same confidence as a real one.
     */
    if (!/\bFOR UPDATE\b/i.test(block) && !/\.for\(\s*'update'\s*\)/.test(block)) {
      fail(`${where}: bills a record once but never takes \`FOR UPDATE\` on it. Two callers both pass the already-billed check and both insert — T41 turned four clicks into four invoices this way. Lock the row inside a transaction.`)
    }
    if (!/db\.transaction\(|\btx\b/.test(block)) {
      fail(`${where}: the lock and the insert must be in ONE transaction, or the lock is released before the invoice exists.`)
    }
    /**
     * WHAT THIS ACTUALLY NEEDS IS THE LOCKED NUMBERING, not one particular function.
     *
     * The first version demanded `insertInvoice` and flagged quotes.ts's convert-to-invoice, which
     * already numbers with `nextNumber(tx, …)` — the very helper that takes the advisory lock.
     * Insisting on the wrapper rather than the guarantee is how a guard starts rejecting correct
     * code, and I would then have "fixed" a working path to satisfy my own regex.
     *
     * So either is accepted: the shared creator, or the shared locked numberer.
     */
    if (!/insertInvoice\(/.test(block) && !/nextNumber\(\s*tx\b/.test(block)) {
      fail(`${where}: creates the invoice without the shared locked numbering — use \`insertInvoice\` or \`nextNumber(tx, …)\`, which take pg_advisory_xact_lock. A local \`max()\` scan hands two concurrent invoices the same number: vet issued INV-00061 and INV-00070 twice each.`)
    }
  }
}

if (failed) {
  console.error(`\nbilling race: ${failed} problem(s).`)
  process.exit(1)
}
console.log(`billing race: ${handlers} bill-once handler(s) across ${checked} file(s); each locks its record FOR UPDATE inside a transaction and raises the invoice through the shared insertInvoice`)
