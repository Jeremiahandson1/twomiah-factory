// T32 M3 — "PO commitments are never relieved."
//
// PO-00001 for $723.72 was sent and received, then billed $723.72, then a FURTHER $5,000 against the
// same purchase order. Three things were wrong:
//
//  · The $5,000 over-bill was accepted with no warning. A purchase order is the figure a vendor
//    agreed to; a bill past it is a price change nobody approved or a duplicate invoice.
//  · Open committed stayed at $723.72 after the PO was fully billed — so the commitment AND the bill
//    were both counted. The same money twice, on the one screen somebody uses to see what a job has
//    cost.
//  · `billed` was in the list of statuses excluded from the committed total, and NOTHING ever set it:
//    purchaseOrders.ts has no transition to it. The exclusion could never fire.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const isMoney = (a: unknown, e: number) => cents(a) === cents(e)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, jobPurchaseOrder } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'PO Co', slug: 'po-co', email: 'po@test.local', state: 'OH', settings: {},
  enabledFeatures: ['purchase_orders', 'vendor_bills'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-po@test.local', passwordHash: 'x', firstName: 'Pia', lastName: 'Oyelaran',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [vendorCo] = await db.insert(contact).values({ companyId: co.id, name: 'Lumber Yard', type: 'vendor' } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'PO Client', type: 'customer' } as any).returning()
const [theJob] = await db.insert(job).values({
  companyId: co.id, contactId: client.id, number: 'JOB-PO-1', title: 'Framing', status: 'in_progress',
} as any).returning()

const app = new Hono()
app.route('/api/purchase-orders', (await import('./src/routes/purchaseOrders.ts')).default)
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

// ══════════ the report's sequence, exactly ═════════════════════════════════════════════════════
{
  const made = await api('POST', '/api/purchase-orders', {
    vendorId: vendorCo.id, jobId: theJob.id,
    lines: [{ description: 'Studs', quantity: 37, unitCost: 4.87 }, { description: 'Sheathing', quantity: 12, unitCost: 42.15 }],
    taxRate: 5.5,
  })
  check('a purchase order is raised', made.status === 201, { status: made.status, body: made.text?.slice(0, 220) })
  // 37 × 4.87 + 12 × 42.15 = 685.99; 5.5% = 37.73; total 723.72. The report checked this by hand and
  // it was right — asserted here so the fix below cannot quietly change it.
  check('…and its arithmetic is the report\'s: 685.99 + 37.73 tax = 723.72', isMoney(made.json?.total, 723.72),
    { total: made.json?.total, subtotal: made.json?.subtotal })
  const poId = made.json?.id

  await api('POST', `/api/purchase-orders/${poId}/send`)
  await api('POST', `/api/purchase-orders/${poId}/receive`)

  const before = await api('GET', `/api/bills/summary/job/${theJob.id}`)
  check('before any bill, the whole order is committed', isMoney(before.json?.committed, 723.72), before.json)
  check('…and nothing is billed', isMoney(before.json?.billed, 0), before.json)

  const first = await api('POST', '/api/bills', {
    vendorId: vendorCo.id, purchaseOrderId: poId, number: 'LUM-4471', amount: 723.72,
  })
  check('billing the order in full works', first.status === 201, { status: first.status, body: first.text?.slice(0, 220) })

  const after = await api('GET', `/api/bills/summary/job/${theJob.id}`)
  check('the commitment is RELIEVED — it falls to zero', isMoney(after.json?.committed, 0),
    { committed: after.json?.committed, reportSaw: 723.72 })
  check('…and the bill is counted once', isMoney(after.json?.billed, 723.72), after.json)
  check('…so committed + billed is 723.72, not 1,447.44', isMoney(Number(after.json?.committed) + Number(after.json?.billed), 723.72),
    { committed: after.json?.committed, billed: after.json?.billed })

  const [po] = await db.select().from(jobPurchaseOrder).where(eq(jobPurchaseOrder.id, poId))
  check('…and the order is marked billed, a status nothing used to set', po?.status === 'billed', po?.status)

  // The $5,000.
  const over = await api('POST', '/api/bills', {
    vendorId: vendorCo.id, purchaseOrderId: poId, number: 'LUM-4472', amount: 5000,
  })
  check('a $5,000 bill past a fully-billed order is REFUSED', over.status === 409, { status: over.status, body: over.text?.slice(0, 260) })
  check('…naming the order, its total and what is left', /723\.72/.test(JSON.stringify(over.json)) && over.json?.remaining === 0, over.json)
  check('…and how much it is over by', isMoney(over.json?.overBy, 5000), over.json?.overBy)
  check('…and the way through, so nobody is stuck', /allowOverage/.test(JSON.stringify(over.json)), over.json?.override)

  const still = await api('GET', `/api/bills/summary/job/${theJob.id}`)
  check('…nothing landed', isMoney(still.json?.billed, 723.72), still.json)
}

// ══════════ a partial bill relieves part of the commitment ═════════════════════════════════════
{
  const made = await api('POST', '/api/purchase-orders', {
    vendorId: vendorCo.id, jobId: theJob.id,
    lines: [{ description: 'Joist hangers', quantity: 100, unitCost: 10 }],
  })
  const poId = made.json?.id
  check('a second order for 1,000', isMoney(made.json?.total, 1000), made.json?.total)
  await api('POST', `/api/purchase-orders/${poId}/send`)

  await api('POST', '/api/bills', { vendorId: vendorCo.id, purchaseOrderId: poId, amount: 400 })
  const mid = await api('GET', `/api/bills/summary/job/${theJob.id}`)
  // The first order is fully billed (0 committed), this one has 600 left.
  check('a part bill leaves the REST committed', isMoney(mid.json?.committed, 600),
    { committed: mid.json?.committed })
  const [po] = await db.select().from(jobPurchaseOrder).where(eq(jobPurchaseOrder.id, poId))
  check('…and the order is not marked billed yet', po?.status === 'sent', po?.status)

  const nudge = await api('POST', '/api/bills', { vendorId: vendorCo.id, purchaseOrderId: poId, amount: 700 })
  check('a bill that would take it past the order is refused', nudge.status === 409, { status: nudge.status })
  check('…saying 600 is left of the 1,000', nudge.json?.remaining === 600 && isMoney(nudge.json?.orderTotal, 1000), nudge.json)

  const deliberate = await api('POST', '/api/bills', { vendorId: vendorCo.id, purchaseOrderId: poId, amount: 700, allowOverage: true })
  check('…and goes through when somebody says so deliberately', deliberate.status === 201, { status: deliberate.status, body: deliberate.text?.slice(0, 200) })
  const end = await api('GET', `/api/bills/summary/job/${theJob.id}`)
  check('an over-billed order does not make the commitment NEGATIVE', Number(end.json?.committed) >= 0,
    { committed: end.json?.committed })
  check('…and does not net off another order\'s commitment', isMoney(end.json?.committed, 0), end.json?.committed)
  check('…the billed total is all of it: 723.72 + 400 + 700', isMoney(end.json?.billed, 1823.72), end.json?.billed)
}

// ══════════ the company-wide commitment figure follows the same rule ═══════════════════════════
{
  const s = await api('GET', '/api/purchase-orders/summary')
  check('open committed is the outstanding figure, not the face value', isMoney(s.json?.openCommitted, 0),
    { openCommitted: s.json?.openCommitted })
  check('…and the face value is still reported beside it, so the two reconcile',
    isMoney(s.json?.orderedValue, 1723.72), { orderedValue: s.json?.orderedValue })

  // A draft is not a commitment — the rule that was already right.
  const draft = await api('POST', '/api/purchase-orders', {
    vendorId: vendorCo.id, jobId: theJob.id, lines: [{ description: 'Nails', quantity: 10, unitCost: 5 }],
  })
  check('a draft order is created', draft.status === 201, { status: draft.status })
  const s2 = await api('GET', '/api/purchase-orders/summary')
  check('…and is not committed', isMoney(s2.json?.openCommitted, 0), s2.json?.openCommitted)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
