// crm-dispensary — T47 P4, P9, P10. Batches, stock, and the three ways they lied.
//
// P4  Stock that sits outside any batch was blocked by a batch's status. Gummy Bears had 55 units on
//     hand from before the shop used batches; one batch of 10 was recorded, a failed lab test
//     quarantined it, and the WHOLE product went off the till — "every batch is quarantine". In a real
//     shop the first batch recorded against existing stock takes that product's entire shelf out of
//     service.
// P9  Deplete answered 400 "a required field is missing (adjustment type)" and depleted the batch
//     anyway: the UPDATE ran, then the ledger INSERT hit a NOT NULL column and threw. PUT /batches/:id
//     answered 200 and silently ignored `status`. And a sale then drew from the zeroed batch.
// P10 A batch quarantined by a FAILED lab test could be put back on sale with Activate — no warning,
//     no reason, nothing recorded but the flip.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t47b', email: 'b@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'batches', 'wholesale', 'compliance'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t47b@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')

// 55 units on hand from before this shop ever used batches — the exact shape P4 found.
// Cannabis lines carry a weight, because the till refuses to sell one it cannot count against the
// purchase limit — which is correct, and which the first draft of this test forgot.
const [gummies] = await db.insert(product).values({
  name: 'Gummy Bears', companyId: co.id, category: 'edible', price: '20', stockQuantity: 55,
  weightGrams: '1', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const api = as(owner)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const batchRow = async (id: string) => (await rows(sql`SELECT * FROM batches WHERE id = ${id}`))[0]
const stockOf = async (id: string) => Number((await rows(sql`SELECT stock_quantity FROM product WHERE id = ${id}`))[0]?.stock_quantity)

/** Ring up `qty` of a product at the till. */
const sell = async (productId: string, qty: number) =>
  await api('POST', '/api/orders', { items: [{ productId, quantity: qty }], orderType: 'pickup' })

// ═════════════════════ P4 · a held batch does not hold the whole shelf ══════════════════════════
let theBatch: any
{
  const made = await api('POST', '/api/batches', {
    batchNumber: 'T47-LAB-1', productId: gummies.id, quantity: 10, unitOfMeasure: 'units',
  })
  check('P4: a batch of 10 is recorded against a product already holding 55', made.status === 201 || made.status === 200, made.json)
  theBatch = made.json?.id ? made.json : (made.json?.data || made.json)

  const held = await api('PUT', `/api/batches/${theBatch.id}/status`, { status: 'quarantine', reason: 'Failed pesticides' })
  check('P4: …and quarantined', held.status === 200, held.json)

  const sale = await sell(gummies.id, 1)
  check('P4: the other 45 units are STILL SELLABLE — the shelf did not go dark', sale.status === 201 || sale.status === 200,
    { status: sale.status, error: sale.json?.error })

  const sold = (sale.json?.data || sale.json)
  const line = (sold?.items || sold?.orderItems || [])[0]
  check('P4: …and the sale is NOT stamped with the held batch', !line?.batchId || line.batchId !== theBatch.id, line?.batchId)

  // 45 outside the batch: 45 is fine, 46 is not.
  const tooMany = await sell(gummies.id, 46)
  check('P4: …but the shop cannot sell more than it holds outside the hold', tooMany.status === 400, tooMany.json)
  check('P4: …saying how many actually are sellable', /44|45/.test(String(tooMany.json?.error)), tooMany.json?.error)
}

// ═════════════════════ P4b · with NO untracked stock, the refusal stands ════════════════════════
{
  const [tinct] = await db.insert(product).values({
    name: 'Tincture', companyId: co.id, category: 'tincture', price: '40', stockQuantity: 8, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-TINCT-1', productId: tinct.id, quantity: 8, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)
  await api('PUT', `/api/batches/${b.id}/status`, { status: 'recalled', reason: 'Supplier recall' })

  const sale = await sell(tinct.id, 1)
  check('P4: a product whose batch covers ALL its stock is still refused when recalled', sale.status === 400, sale.json)
  check('P4: …and says RECALLED, because that is the word that matters', /RECALLED/.test(String(sale.json?.error)), sale.json?.error)
}

// ══════════ P4c · a RECALL is the one hold untracked stock does NOT get past ════════════════════
//
// The first version of the P4 fix let untracked units sell past any blocked batch, and that broke
// T45 BL4 — a blocker. The difference is what the shop can PROVE. A quarantine is a lot the shop
// knows the bounds of; units outside it are a different lot. A recall says product matching this
// description is unsafe, and untracked units have no provenance at all — which is what untracked
// means. The till stops the product and a person sorts out what is what.
{
  const [shatter] = await db.insert(product).values({
    name: 'Shatter', companyId: co.id, category: 'concentrate', price: '55', stockQuantity: 40, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-SHAT-1', productId: shatter.id, quantity: 5, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)
  await api('PUT', `/api/batches/${b.id}/status`, { status: 'recalled', reason: 'Pesticide recall' })

  const sale = await sell(shatter.id, 1)
  check('P4: 35 untracked units do NOT sell past a recall', sale.status === 400, { status: sale.status, error: sale.json?.error })
  check('P4: …and the word is RECALLED, not "no sellable stock"', /RECALLED/.test(String(sale.json?.error)), sale.json?.error)
}

// ══════════════════════════ P9 · deplete tells the truth ════════════════════════════════════════
{
  const [choc] = await db.insert(product).values({
    name: 'Chocolate', companyId: co.id, category: 'edible', price: '15', stockQuantity: 12, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-CHOC-1', productId: choc.id, quantity: 12, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)

  const dep = await api('POST', `/api/batches/${b.id}/deplete`)
  check('P9: Deplete SUCCEEDS instead of answering 400 after doing the work', dep.status === 200, { status: dep.status, body: dep.json })

  const after = await batchRow(b.id)
  check('P9: …the batch is empty', Number(after?.current_quantity) === 0, after?.current_quantity)
  check('P9: …and marked depleted', after?.status === 'depleted', after?.status)

  const ledger = await rows(sql`SELECT * FROM inventory_adjustments WHERE product_id = ${choc.id}`)
  check('P9: …and the ledger says where the stock went', ledger.length === 1, ledger.length)
  check('P9: …with the type the column demands, which is what used to throw',
    !!ledger[0]?.adjustment_type, ledger[0]?.adjustment_type)
  check('P9: …and the movement', Number(ledger[0]?.quantity_change) === -12, ledger[0]?.quantity_change)
}

// ═════════════════ P9b · a status sent to the wrong route is refused, not ignored ════════════════
{
  const before = await batchRow(theBatch.id)
  const put = await api('PUT', `/api/batches/${theBatch.id}`, { status: 'active', notes: 'sneaky' })
  check('P9: PUT /batches/:id refuses a status rather than answering 200 and dropping it', put.status === 400, put.json)
  check('P9: …and names the route that does record it', /status/i.test(String(put.json?.error)), put.json?.error)
  const after = await batchRow(theBatch.id)
  check('P9: …and the batch is untouched', after?.status === before?.status, { before: before?.status, after: after?.status })
}

// ══════════ P9c · a sale is never stamped with a batch that has been emptied ═════════════════════
{
  const [vape] = await db.insert(product).values({
    name: 'Vape Cart', companyId: co.id, category: 'vape', price: '50', stockQuantity: 20, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-VAPE-1', productId: vape.id, quantity: 5, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)
  await api('POST', `/api/batches/${b.id}/deplete`)

  const sale = await sell(vape.id, 1)
  check('P9: the 15 units outside the emptied batch still sell', sale.status === 201 || sale.status === 200, sale.json?.error)
  const sold = (sale.json?.data || sale.json)
  const line = (sold?.items || sold?.orderItems || [])[0]
  check('P9: …and are NOT attributed to the batch that holds nothing', !line?.batchId, line?.batchId)
}

// ═══════════ P10 · releasing a failed lab test takes a reason, in writing ════════════════════════
{
  const [pre] = await db.insert(product).values({
    name: 'Pre-roll', companyId: co.id, category: 'preroll', price: '12', stockQuantity: 30, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-PRE-1', productId: pre.id, quantity: 30, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)

  // A failed lab test, recorded the way wholesale.ts records one.
  const testId = 'T47-SMP-FAIL'
  await db.execute(sql`
    INSERT INTO lab_tests (id, company_id, batch_id, sample_id, overall_result, created_at, updated_at)
    VALUES (${testId}, ${co.id}, ${b.id}, 'T47-SMP-1', 'fail', NOW(), NOW())
  `)
  await db.execute(sql`UPDATE batches SET lab_tested = true, lab_test_id = ${testId}, status = 'quarantine' WHERE id = ${b.id}`)

  const naked = await api('POST', `/api/batches/${b.id}/activate`, {})
  check('P10: Activate on a failed-test batch is refused without a reason', naked.status === 400, naked.json)
  check('P10: …naming the test that failed', String(naked.json?.error).includes(testId), naked.json?.error)
  check('P10: …and the batch is still held', (await batchRow(b.id))?.status === 'quarantine')

  const flimsy = await api('POST', `/api/batches/${b.id}/activate`, { reason: 'ok' })
  check('P10: …a two-letter reason is not a reason', flimsy.status === 400, flimsy.json)

  const proper = await api('POST', `/api/batches/${b.id}/activate`, { reason: 'Retested clean by NorthLab on 30 Sep, certificate on file' })
  check('P10: …and a real one releases it', proper.status === 200, proper.json)
  const out = await batchRow(b.id)
  check('P10: …the batch is back on sale', out?.status === 'active', out?.status)
  check('P10: …and the batch itself carries why it was released',
    /Retested clean by NorthLab/.test(String(out?.status_reason)), out?.status_reason)

  const sale = await sell(pre.id, 1)
  check('P10: …so it can be sold again', sale.status === 201 || sale.status === 200, sale.json?.error)
}

// ═══════════ P10b · a hand-raised quarantine is a manager's own to lift ══════════════════════════
{
  const [hash] = await db.insert(product).values({
    name: 'Hash', companyId: co.id, category: 'concentrate', price: '60', stockQuantity: 10, weightGrams: '1',
    taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const made = await api('POST', '/api/batches', { batchNumber: 'T47-HASH-1', productId: hash.id, quantity: 10, unitOfMeasure: 'units' })
  const b = made.json?.id ? made.json : (made.json?.data || made.json)
  await api('PUT', `/api/batches/${b.id}/status`, { status: 'quarantine', reason: 'Held while we check the paperwork' })

  const back = await api('POST', `/api/batches/${b.id}/activate`, {})
  check('P10: a quarantine a manager raised themselves needs no written override', back.status === 200, back.json)
  check('P10: …and the batch is active again', (await batchRow(b.id))?.status === 'active')
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
