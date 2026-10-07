// T58d — "INV-00053 is still duplicated", and what the duplicate was preventing.
//
// invoice_company_number_live_unique_idx is the database backstop under "bill a visit once", and on
// vettest it does not exist. Measured there: INV-00070 and INV-00061 are each 1 live + 1 void
// exactly as the T41 clean-up intended, and INV-00053 is TWO LIVE DRAFTS — same company_id, both
// created 2026-09-23 01:50:03, nothing paid. The clean-up's own list ("INV-00055, 56, 59, one of the
// two INV-00061, 62, 67, one of the two INV-00070") does not include 00053. It was missed.
//
// WHY THE INDEX IS ABSENT. Not because the duplicate refused it — that was this file's first answer
// and it was wrong. 0029 never ran: its comment quoted the statement separator, drizzle cut the file
// inside the comment, and Postgres got a backtick. One transaction per run, so 0029–0034 rolled back
// on every boot for four days, while the service came up anyway and drizzle-kit push reconciled the
// schema.ts half. See scripts/check-migration-statements-parse.ts.
//
// 0034 now owns both the heal and the index, because the heal has to come first. This asserts both
// halves, and the thing neither the old test nor the old migration could: that the index EXISTS
// after a tenant that already had a duplicate is migrated.
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, contact, invoice } = await import('./db/schema.ts')

const rowsOf = async (q: any): Promise<any[]> => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const indexExists = async (name: string) => (await rowsOf(sql`SELECT indexname FROM pg_indexes WHERE indexname = ${name}`)).length > 0

const [co] = await db.insert(company).values({
  name: 'Dupe Vet', slug: 'dupe-vet', email: 'dv@test.local', state: 'OH', settings: {}, enabledFeatures: ['invoices'],
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Ada Owner', email: 'ada-dv@test.local', type: 'client',
} as any).returning()

const mkInvoice = async (number: string, status: string, when: string) => (await db.insert(invoice).values({
  companyId: co.id, contactId: client.id, number, status,
  subtotal: '10.00', total: '10.00', amountPaid: '0', taxAmount: '0', taxRate: '0', discount: '0',
  issueDate: new Date(when), dueDate: new Date(when), createdAt: new Date(when),
} as any).returning())[0]

// ══════════ 1. both indexes are there on a clean sandbox — 0029's and 0034's ════════════════════
check('invoice_company_number_live_unique_idx exists', await indexExists('invoice_company_number_live_unique_idx'))
check('visit_invoice_id_unique_idx exists', await indexExists('visit_invoice_id_unique_idx'))

// ══════════ 2. …and now it REFUSES a new live duplicate, which is the point of it ═══════════════
{
  await mkInvoice('INV-09001', 'sent', '2026-09-01T10:00:00Z')
  let refused = false
  try { await mkInvoice('INV-09001', 'draft', '2026-09-01T11:00:00Z') } catch { refused = true }
  check('a SECOND live invoice cannot reuse a number', refused)

  // …while a voided duplicate is allowed, which is what let the index go on a tenant that had raced.
  let voidAllowed = true
  try { await mkInvoice('INV-09001', 'void', '2026-09-01T12:00:00Z') } catch { voidAllowed = false }
  check('…but a VOIDED duplicate is allowed', voidAllowed)
}

// ══════════ 3. THE HEALING STEP, run against data the index would have refused ══════════════════
//
// The index cannot be created while two live rows share a number, so the only way to exercise 0034
// is to drop it, plant the duplicate the live tenant has, and run the migration's SQL.
{
  await db.execute(sql`DROP INDEX IF EXISTS invoice_company_number_live_unique_idx`)
  check('the index is gone, so this is the live tenant\'s situation', !(await indexExists('invoice_company_number_live_unique_idx')))

  const older = await mkInvoice('INV-00053', 'draft', '2026-09-23T09:00:00Z')
  const newer = await mkInvoice('INV-00053', 'draft', '2026-09-23T09:05:00Z')
  const live = await rowsOf(sql`SELECT id FROM invoice WHERE company_id = ${co.id} AND number = 'INV-00053' AND status <> 'void'`)
  check('two LIVE drafts share INV-00053, as on vettest', live.length === 2, live.length)

  // Exactly the statements in 0034, in order.
  const heal = readMigration()
  for (const stmt of heal) await db.execute(sql.raw(stmt))

  const after = await rowsOf(sql`SELECT id, number, status FROM invoice WHERE id IN (${sql.raw(`'${older.id}','${newer.id}'`)}) ORDER BY created_at`)
  const keptNumber = after.filter((r: any) => r.number === 'INV-00053')
  check('the OLDER row keeps the number', keptNumber.length === 1 && keptNumber[0].id === older.id, after)
  check('the newer draft was renumbered', after.some((r: any) => r.id === newer.id && r.number !== 'INV-00053'), after)
  check('…to something that is still an invoice number', after.every((r: any) => /^INV-\d{5}$/.test(String(r.number))), after)
  check('…and nothing was voided — a draft is renumbered, not cancelled', after.every((r: any) => r.status === 'draft'), after)
  check('THE INDEX IS NOW THERE — the backstop the duplicate was blocking', await indexExists('invoice_company_number_live_unique_idx'))
}

// ══════════ 4. a SENT duplicate is left alone, and the index then fails LOUDLY ══════════════════
//
// The opposite half of the rule, and the more important one: renumbering a bill a client is holding
// is a worse fault than the duplicate. A human has to decide, so the migration must not hide it.
{
  await db.execute(sql`DROP INDEX IF EXISTS invoice_company_number_live_unique_idx`)
  await mkInvoice('INV-00054', 'sent', '2026-09-24T09:00:00Z')
  await mkInvoice('INV-00054', 'sent', '2026-09-24T09:05:00Z')

  const heal = readMigration()
  let indexRefused = false
  try { for (const stmt of heal) await db.execute(sql.raw(stmt)) } catch { indexRefused = true }

  const sent = await rowsOf(sql`SELECT number, status FROM invoice WHERE company_id = ${co.id} AND number = 'INV-00054'`)
  check('both SENT invoices keep their number — neither is silently rewritten', sent.length === 2, sent)
  check('…and the index creation FAILS rather than pretending', indexRefused || !(await indexExists('invoice_company_number_live_unique_idx')), { indexRefused })
}

/**
 * The migration's statements, split on Drizzle's breakpoint and stripped of comments.
 *
 * Read from the SANDBOX's own db/migrations — the harness assembles a crm-vet copy and runs this
 * from its root, so a path back into the repo does not resolve (my first version reached for
 * ../../templates/… and got ENOENT). Reading the real file, rather than restating its SQL here, is
 * the point: a test that holds its own copy of a migration proves the copy works.
 */
function readMigration(): string[] {
  const src = require('node:fs').readFileSync(
    'db/migrations/0034_heal_live_duplicate_invoice_numbers.sql',
    'utf8',
  ) as string
  return src
    .split('--> statement-breakpoint')
    .map((s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim())
    .filter(Boolean)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
