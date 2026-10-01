// T32 B4 and H8 — accounts payable, where the money was wrong in two directions.
//
// B4: POST /api/bills/:id/record-payment read amountPaid, added to it in JavaScript and wrote the sum
//     back, outside any transaction. Five concurrent $150 payments on a $1,000 bill all read the same
//     starting figure and the last write won: 15 requests across three bills answered 200 ($2,250
//     acknowledged), $1,350 was recorded. $900 vanished — and with no payment ledger it left no trace.
//
// H8: a $1,000 bill with $300 paid could be edited to $100, giving a balance of −$200 that netted
//     into Bills Outstanding, understating AP by money the company had actually spent.
//
// The concurrency assertion fires the payments CONCURRENTLY. A race fixed with a lock and asserted
// sequentially proves nothing: the old read-then-write passes a sequential test every time.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, vendorBill } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'AP Co', slug: 'ap-co', email: 'ap@test.local', state: 'OH', settings: {},
  enabledFeatures: ['vendor_bills', 'purchase_orders'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-ap@test.local', passwordHash: 'x', firstName: 'O', lastName: 'W', role: 'owner', companyId: co.id,
} as any).returning()
const [vendor] = await db.insert(contact).values({
  companyId: co.id, name: 'Acme Supply', type: 'vendor',
} as any).returning()

const app = new Hono()
app.route('/api/bills', (await import('./src/routes/bills.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const mkBill = async (amount: number, number: string) => (await db.insert(vendorBill).values({
  companyId: co.id, vendorId: vendor.id, number, amount: amount.toFixed(2), amountPaid: '0',
  status: 'open', billDate: new Date(),
} as any).returning())[0]
const paidOn = async (id: string) => {
  const r: any = await db.execute(sql`SELECT amount_paid, status FROM vendor_bill WHERE id = ${id}`)
  return (r.rows || r)[0]
}
const ledgerFor = async (id: string) => {
  const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0) AS total FROM vendor_bill_payment WHERE vendor_bill_id = ${id}`)
  return (r.rows || r)[0]
}

// ══════════ B4 · five payments at once must all be kept ════════════════════════════════════════
{
  const bill = await mkBill(1000, 'RACE-1')
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 150, method: 'cheque' })),
  )
  const accepted = results.filter((r) => r.status === 200).length
  const after = await paidOn(bill.id)
  const ledger = await ledgerFor(bill.id)

  check('five concurrent payments: every one that answered 200 is in the total',
    Math.round(Number(after.amount_paid) * 100) === accepted * 15000,
    { accepted, recorded: after.amount_paid, expected: (accepted * 150).toFixed(2) })
  check('…and the ledger has one row per accepted payment',
    Number(ledger.n) === accepted && Math.round(Number(ledger.total) * 100) === accepted * 15000,
    { accepted, rows: ledger.n, ledgerTotal: ledger.total })
  check('…all five were accepted, because $750 fits in a $1,000 bill', accepted === 5, { accepted })
  check('…and the status is partial, not paid', after.status === 'partial', after)
}

// ══════════ B4b · the overpay guard still holds under a race ═══════════════════════════════════
{
  const bill = await mkBill(400, 'RACE-2')
  // Five × $150 = $750 against a $400 bill: some must be refused, and the total must never exceed it.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 150 })),
  )
  const accepted = results.filter((r) => r.status === 200).length
  const after = await paidOn(bill.id)
  const ledger = await ledgerFor(bill.id)
  check('a race cannot overpay a bill', Number(after.amount_paid) <= 400.005, after)
  check('…the refusals are refusals, not silent drops', results.filter((r) => r.status === 400).length === 5 - accepted, results.map((r) => r.status))
  check('…and the ledger matches the total exactly', Math.round(Number(ledger.total) * 100) === Math.round(Number(after.amount_paid) * 100), { ledger: ledger.total, total: after.amount_paid })
}

// ══════════ B4c · the ledger records HOW it was paid ═══════════════════════════════════════════
{
  const bill = await mkBill(500, 'LEDGER-1')
  await api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 200, method: 'ach', reference: 'ACH-99812', notes: 'part payment' })
  const r: any = await db.execute(sql`SELECT method, reference, notes, recorded_by_id FROM vendor_bill_payment WHERE vendor_bill_id = ${bill.id}`)
  const row = (r.rows || r)[0]
  check('a payment keeps its method and reference', row?.method === 'ach' && row?.reference === 'ACH-99812', row)
  check('…and who recorded it', String(row?.recorded_by_id) === String(owner.id), row?.recorded_by_id)
}

// ══════════ H8 · a bill cannot be worth less than has been paid ════════════════════════════════
{
  const bill = await mkBill(1000, 'EDIT-1')
  await api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 300 })

  const down = await api('PUT', `/api/bills/${bill.id}`, { amount: 100 })
  check('editing a bill below what was paid is refused', down.status === 400, { status: down.status, body: down.text?.slice(0, 180) })
  check('…and the refusal says how much was already paid', /300/.test(JSON.stringify(down.json)), down.json)
  const unchanged = await paidOn(bill.id)
  check('…and nothing changed', Math.round(Number(unchanged.amount_paid) * 100) === 30000, unchanged)

  const toExactly = await api('PUT', `/api/bills/${bill.id}`, { amount: 300 })
  check('lowering it to exactly what was paid settles the bill', toExactly.status === 200 && toExactly.json?.status === 'paid',
    { status: toExactly.status, billStatus: toExactly.json?.status })

  /**
   * …and once settled it is closed to edits, which is the EXISTING rule, not something added here.
   *
   * My first version of this assertion expected raising it to reopen the bill. That was my
   * expectation, not the product's: `if (existing.status === 'paid') return 400` predates this work
   * and is defensible — a bill somebody has paid in full is a closed document.
   *
   * Worth naming as a consequence rather than a defect: lowering a bill to exactly what has been paid
   * now settles it, and a settled bill cannot be edited, so that one edit is a door that closes
   * behind you. The way back is a credit from the vendor, which is what the refusal above tells you.
   */
  const up = await api('PUT', `/api/bills/${bill.id}`, { amount: 900 })
  check('a settled bill is closed to further edits (the pre-existing rule)', up.status === 400, { status: up.status, body: up.text?.slice(0, 140) })
  check('…and it says so in those terms', /paid bill/i.test(JSON.stringify(up.json)), up.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
