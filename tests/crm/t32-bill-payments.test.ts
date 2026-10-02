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
const { company, user, contact, vendorBill, project, job } = await import('./db/schema.ts')

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

// ══════════ T34 · a bill on a job belongs to that job's project ═══════════════════════════════
//
// The report raised a bill against a job that sits on a project and the bill came back with no
// project, so every project-level spend figure was blind to it. `jobId` already fell back to the
// purchase order's job; `projectId` fell back to nothing.
const mkProject = async (number: string, name: string) => (await db.insert(project).values({
  companyId: co.id, number, name,
} as any).returning())[0]
const mkJob = async (number: string, projectId: string | null) => (await db.insert(job).values({
  companyId: co.id, number, title: `Job ${number}`, projectId,
} as any).returning())[0]

{
  const proj = await mkProject('P-700', 'Riverside Remodel')
  const theJob = await mkJob('J-700', proj.id)

  const created = await api('POST', '/api/bills', { vendorId: vendor.id, jobId: theJob.id, amount: 250, number: 'INH-1' })
  check("a bill created on a job picks up the job's project",
    created.status === 201 && created.json?.projectId === proj.id,
    { status: created.status, projectId: created.json?.projectId, expected: proj.id })

  const other = await mkProject('P-701', 'A Different Project')
  const explicit = await api('POST', '/api/bills', { vendorId: vendor.id, jobId: theJob.id, projectId: other.id, amount: 100, number: 'INH-2' })
  check('…and a project named outright is not replaced by the job\'s',
    explicit.status === 201 && explicit.json?.projectId === other.id,
    { status: explicit.status, projectId: explicit.json?.projectId, expected: other.id })

  // THE SAME RULE ON EDIT. A rule that only applies on create is a rule with a hole in it: a bill
  // moved onto a job would otherwise keep the project it had, or none.
  const loose = await api('POST', '/api/bills', { vendorId: vendor.id, amount: 90, number: 'INH-3' })
  check('…a bill raised against no job starts with no project',
    loose.status === 201 && loose.json?.projectId === null, loose.json?.projectId)

  const moved = await api('PUT', `/api/bills/${loose.json.id}`, { jobId: theJob.id })
  check('…and moving it onto a job inherits the project on edit too',
    moved.status === 200 && moved.json?.projectId === proj.id,
    { status: moved.status, projectId: moved.json?.projectId, expected: proj.id })

  const movedExplicit = await api('PUT', `/api/bills/${loose.json.id}`, { jobId: theJob.id, projectId: other.id })
  check('…on edit too, the project the caller named wins',
    movedExplicit.status === 200 && movedExplicit.json?.projectId === other.id,
    { status: movedExplicit.status, projectId: movedExplicit.json?.projectId, expected: other.id })

  // A job with no project of its own must not blank out a project already on the bill.
  const looseJob = await mkJob('J-702', null)
  const kept = await api('PUT', `/api/bills/${loose.json.id}`, { jobId: looseJob.id })
  check('…and a job that has no project leaves the bill\'s project alone',
    kept.status === 200 && kept.json?.projectId === other.id,
    { status: kept.status, projectId: kept.json?.projectId, expected: other.id })
}

// ══════════ T34 · one bill, with the payments made against it ═════════════════════════════════
//
// There was no GET /:id at all, so opening a single bill answered 404; and vendor_bill_payment had
// been written to all along with nothing anywhere to read it back — a bill could say $350 paid and
// never say when, by what method, or in how many parts.
{
  const bill = await mkBill(600, 'ONE-1')
  await api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 200, method: 'ach', reference: 'A-1' })
  await api('POST', `/api/bills/${bill.id}/record-payment`, { amount: 150, method: 'cheque', reference: 'C-9' })

  const one = await api('GET', `/api/bills/${bill.id}`)
  check('opening a single bill answers 200, not 404', one.status === 200, { status: one.status, body: one.text?.slice(0, 140) })
  check('…with the vendor on it', one.json?.vendor?.id === vendor.id, one.json?.vendor)
  check('…and both payments listed individually',
    Array.isArray(one.json?.payments) && one.json.payments.length === 2, one.json?.payments?.length)
  check('…each with the method and reference it was recorded with',
    (one.json?.payments || []).map((p: any) => `${p.method}:${p.reference}`).sort().join(',') === 'ach:A-1,cheque:C-9',
    one.json?.payments)
  check('…and WHO recorded each one, by name rather than by id',
    (one.json?.payments || []).every((p: any) => p.recordedBy === 'O W'),
    (one.json?.payments || []).map((p: any) => p.recordedBy))
  check('…paidTotal is the sum of the payment ROWS, so it can be compared against the bill',
    Math.round(Number(one.json?.paidTotal) * 100) === 35000, one.json?.paidTotal)
  check('…and balance is what is left to pay', Math.round(Number(one.json?.balance) * 100) === 25000, one.json?.balance)

  /*
   * …and paidTotal is derived from the rows, not copied off the bill. Proven by making the two
   * DISAGREE: a payment row written straight to the table, with `amount_paid` left alone. If
   * paidTotal just echoed the bill's own figure the assertion above would pass either way, which is
   * the kind of green that hid "to pay −$2.00" elsewhere in this product.
   */
  await db.execute(sql`INSERT INTO vendor_bill_payment (id, company_id, vendor_bill_id, amount, method)
                       VALUES ('direct-row-1', ${co.id}, ${bill.id}, '50.00', 'manual')`)
  const again = await api('GET', `/api/bills/${bill.id}`)
  check('…paidTotal counts a payment row the bill does not know about',
    Math.round(Number(again.json?.paidTotal) * 100) === 40000, again.json?.paidTotal)
  check('…and the bill\'s own amountPaid is reported unchanged beside it, so the disagreement shows',
    Math.round(Number(again.json?.amountPaid) * 100) === 35000, again.json?.amountPaid)
  check('…a payment with no recorder is null, not a stray id or a crash',
    (again.json?.payments || []).find((p: any) => p.id === 'direct-row-1')?.recordedBy === null,
    (again.json?.payments || []).find((p: any) => p.id === 'direct-row-1'))

  const missing = await api('GET', '/api/bills/no-such-bill')
  check('a bill that is not there is still a 404', missing.status === 404, missing.status)

  /*
   * /:id is declared AFTER /summary on purpose. If that order ever flips, Hono matches /:id first
   * and the AP total starts looking up a bill whose id is "summary" — a 404 where a figure belongs.
   * Asserted here as behaviour, because nothing about the two lines looks wrong on its own.
   */
  const summary = await api('GET', '/api/bills/summary')
  check('…and /summary is still the summary, not a bill lookup',
    summary.status === 200 && summary.json?.outstanding !== undefined,
    { status: summary.status, body: summary.text?.slice(0, 140) })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
