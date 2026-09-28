// crm-dispensary — the five blockers from the T45 full audit.
//
// Each one would hurt a dispensary with regulators or customers on day one, and four of the five
// are the same shape: something reports success it has not earned.
//
//   BL1  The ID scanner returned "verified" for data it could not read. An age-verification tool
//        that approves whatever it fails to parse is worse than no scanner, because the shop now
//        believes it checked.
//   BL2  "Report to Metrc" and a compliance report's "Submit" wrote timestamps on a shop connected
//        to nothing. An inspector would read records claiming the state had been notified.
//   BL3  Print Receipt had no onClick at all — and the receipt, when it was reached directly,
//        ignored every one of the header/footer/logo settings the shop had saved.
//   BL4  A recalled batch still sold, and order lines recorded no batch, so the one question a
//        recall asks — who bought it — had no answer.
//   BL5  Generating labels always 400'd (the screen sends productIds, the server wanted productId),
//        and the labels it did produce said THC 0% on a 100 mg edible with a blank batch number.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Blocker Dispensary', slug: 'blockers', email: 'blockers@test.local', state: 'OH',
  address: '1 Test Way', city: 'Columbus', zip: '43004', phone: '614-555-0100',
  settings: { receipts: { headerText: 'Twomiah Leaf — welcome', footerText: 'Keep out of reach of children', showLogo: false } },
  enabledFeatures: ['orders', 'products', 'compliance', 'labels', 'batches', 'id_scanner'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-blockers@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const [flower] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-BL', category: 'flower', price: '40', cost: '10',
  weightGrams: '3.5', stockQuantity: 500, trackInventory: true, taxCategory: 'cannabis',
  thcPercent: '24.5', companyId: co.id,
} as any).returning()
// An edible: milligrams per piece, and NO percent — the case that printed "THC 0%".
const [edible] = await db.insert(product).values({
  name: 'Chocolate Bar', sku: 'CB-BL', category: 'edible', price: '25', cost: '8',
  stockQuantity: 100, trackInventory: true, taxCategory: 'cannabis',
  weightGrams: '1', thcMg: '100', companyId: co.id,
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/orders', 'orders'],
  ['/api/compliance', 'compliance'],
  ['/api/id-scanner', 'id-scanner'],
  ['/api/labels', 'labels'],
  ['/api/batches', 'batches'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

app.onError((err: any, c: any) => { console.log("   [server error]", err?.message || err); return c.json({ error: String(err?.message || err) }, 500) })

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)

// ── BL1: an age check fails CLOSED ─────────────────────────────────────────────────────────────
const garbage = await asOwner('POST', '/api/id-scanner/scan', { scanMethod: 'barcode', rawData: 'garbage-not-an-id' })
check('BL1: unreadable data is not "verified"', garbage.json?.status !== 'verified', garbage.json?.status)
check('BL1: ...it is reported as unreadable', garbage.json?.status === 'unreadable', garbage.json?.status)
check('BL1: ...and verified is false', garbage.json?.verified === false, garbage.json?.verified)
check('BL1: ...and it says why', /could not be read/i.test(String(garbage.json?.scan?.flagReason || '')), garbage.json?.scan?.flagReason)
check('BL1: ...and it is flagged, so it lands in the Flagged tab', garbage.json?.scan?.isFlagged === true, garbage.json?.scan?.isFlagged)

// A real AAMVA barcode still parses and still decides correctly — the fix must not break the scanner.
const adultDob = `01011980`
const realBarcode = `@\n\x1e\rANSI 636000090002DL00410288ZO03290015DLDAQT64235789\nDCSDOE\nDACJANE\nDBB${adultDob}\nDBA01012030\nDAJOH\n`
const good = await asOwner('POST', '/api/id-scanner/scan', { scanMethod: 'barcode', rawData: realBarcode })
check('BL1: a readable adult ID still verifies', good.json?.status === 'verified', { status: good.json?.status, dob: good.json?.dob })
const minorBarcode = realBarcode.replace(`DBB${adultDob}`, 'DBB01012010')
const minor = await asOwner('POST', '/api/id-scanner/scan', { scanMethod: 'barcode', rawData: minorBarcode })
check('BL1: an underage ID is still caught', minor.json?.status === 'underage', minor.json?.status)

// ── BL2: nothing claims the state was told ─────────────────────────────────────────────────────
const waste = await asManager('POST', '/api/compliance/waste', {
  productId: flower.id, wasteType: 'expired', quantity: 3.5, unit: 'g', reason: 'past date',
})
check('BL2: setup — waste can still be logged', waste.status === 201 || waste.status === 200, { status: waste.status, body: waste.json })
const wasteId = waste.json?.id
if (wasteId) {
  const report = await asManager('PUT', `/api/compliance/waste/${wasteId}/metrc`, {})
  check('BL2: reporting waste to Metrc is refused when nothing is connected',
    report.status === 400 && report.json?.code === 'traceability_not_connected', report.json)
  const row: any = await db.execute(sql`SELECT metrc_reported, metrc_reported_at FROM waste_log WHERE id = ${wasteId}`)
  const w = ((row as any).rows || row)?.[0]
  check('BL2: ...and the record does NOT claim it was reported',
    !w?.metrc_reported && !w?.metrc_reported_at, w)
}

const gen = await asManager('POST', '/api/compliance/reports/generate', {
  reportType: 'daily_sales', startDate: '2026-09-01', endDate: '2026-09-02',
})
check('BL2: setup — a report can still be generated', gen.status === 201 || gen.status === 200, gen.status)
const reportId = gen.json?.id
if (reportId) {
  const submit = await asManager('POST', `/api/compliance/reports/${reportId}/submit`, {})
  check('BL2: submitting a report is refused when nothing is connected',
    submit.status === 400 && submit.json?.code === 'traceability_not_connected', submit.json)
  check('BL2: ...and it says the report can still be filed by hand',
    /export/i.test(String(submit.json?.error)), submit.json?.error)
  const r: any = await db.execute(sql`SELECT status, submitted_at FROM compliance_reports WHERE id = ${reportId}`)
  const rep = ((r as any).rows || r)?.[0]
  check('BL2: ...and the report is not marked submitted', rep?.status !== 'submitted' && !rep?.submitted_at, rep)
}

// Connect Metrc, and the same actions go through — the refusal is about being disconnected, not
// about the button.
await db.execute(sql`
  INSERT INTO metrc_config (id, company_id, api_key, user_key, license_number, state, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'test-api-key', 'test-user-key', 'OH-1', 'OH', NOW(), NOW())
`)
if (reportId) {
  const submit2 = await asManager('POST', `/api/compliance/reports/${reportId}/submit`, {})
  check('BL2: with Metrc connected, submitting works again', submit2.status === 200, { status: submit2.status, body: submit2.json })
}

// ── BL4: a recall reaches the register ─────────────────────────────────────────────────────────
const sell = (productId: string) => asOwner('POST', '/api/orders', {
  contactId: cust.id, items: [{ productId, quantity: 1 }],
  type: 'walk_in', idVerified: true, paymentMethod: 'cash',
})

// No batches yet: a shop that does not run them must still be able to sell.
const beforeBatches = await sell(flower.id)
check('BL4: a product with no batches sells exactly as before', beforeBatches.status === 201, { status: beforeBatches.status, body: beforeBatches.json })

const [batchRow]: any = await db.execute(sql`
  INSERT INTO batches (id, company_id, batch_number, product_id, metrc_tag, status, initial_quantity, current_quantity, received_date, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'T45-B-001', ${flower.id}, '1A4000000000000000000001', 'active', 100, 100, CURRENT_DATE, NOW(), NOW())
  RETURNING id
`).then((r: any) => (r as any).rows || r)

const withBatch = await sell(flower.id)
check('BL4: a sale from an active batch goes through', withBatch.status === 201, withBatch.status)
const lines: any = await db.execute(sql`SELECT batch_id, metrc_tag FROM order_items WHERE order_id = ${withBatch.json?.id}`)
const line = ((lines as any).rows || lines)?.[0]
check('BL4: the line records WHICH batch it came out of', line?.batch_id === batchRow.id, line)
check('BL4: ...and its state tag, so a recall can be traced', line?.metrc_tag === '1A4000000000000000000001', line)

await db.execute(sql`UPDATE batches SET status = 'recalled' WHERE id = ${batchRow.id}`)
const afterRecall = await sell(flower.id)
check('BL4: a recalled batch stops the register', afterRecall.status === 400, { status: afterRecall.status, body: afterRecall.json })
check('BL4: ...and the refusal says the word', /RECALLED/i.test(String(afterRecall.json?.error)), afterRecall.json?.error)
check('BL4: ...with a code the till can act on', afterRecall.json?.code === 'batch_not_sellable', afterRecall.json?.code)
// Another product is unaffected — a recall is not a shutdown.
const otherSale = await sell(edible.id)
check('BL4: a different product still sells', otherSale.status === 201, { status: otherSale.status, body: otherSale.json })

// ── BL3: the receipt ───────────────────────────────────────────────────────────────────────────
const receipt = await asOwner('GET', `/api/orders/${withBatch.json?.id}/receipt`)
check('BL3: the receipt renders', receipt.status === 200 && receipt.text.includes('<html'), receipt.status)
check('BL3: it carries the shop\'s own header text', receipt.text.includes('Twomiah Leaf — welcome'), receipt.text.slice(0, 200))
check('BL3: ...and the footer it saved', receipt.text.includes('Keep out of reach of children'))
check('BL3: ...and the shop name, not just the word "Receipt"', receipt.text.includes('Blocker Dispensary'))
check('BL3: ...and it asks the browser to print itself', receipt.text.includes('window.print()'))

// ── BL5: labels ────────────────────────────────────────────────────────────────────────────────
// The edible gets an active batch of its own, so a label CAN find one to print.
await db.execute(sql`
  INSERT INTO batches (id, company_id, batch_number, product_id, metrc_tag, status, initial_quantity, current_quantity, received_date, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'T45-B-EDI', ${edible.id}, '1A4000000000000000000002', 'active', 50, 50, CURRENT_DATE, NOW(), NOW())
`)

const tmpl = await asManager('POST', '/api/labels/templates', {
  name: 'Product label', type: 'product', width: 2, height: 1,
  fields: [{ key: 'product_name', x: 0, y: 0 }, { key: 'thc', x: 0, y: 10 }, { key: 'batch_number', x: 0, y: 20 }],
})
check('BL5: setup — a template can be created', tmpl.status === 201, { status: tmpl.status, body: tmpl.json })

// Exactly what the screen sends, which used to 400.
const run = await asManager('POST', '/api/labels/generate', {
  templateId: tmpl.json?.id, productIds: [flower.id, edible.id], quantity: 2,
})
check('BL5: the screen\'s own payload is accepted', run.status === 201, { status: run.status, body: run.json })
check('BL5: ...and produces a label per product', (run.json?.jobs || []).length === 2, (run.json?.jobs || []).length)

const jobs: any = await db.execute(sql`SELECT product_id, batch_id, label_data FROM label_print_jobs WHERE company_id = ${co.id}`)
const jobRows = ((jobs as any).rows || jobs)
const edibleJob = jobRows.find((j: any) => j.product_id === edible.id)
const flowerJob = jobRows.find((j: any) => j.product_id === flower.id)
const dataOf = (j: any) => (typeof j?.label_data === 'string' ? JSON.parse(j.label_data) : j?.label_data) || {}
check('BL5: a 100 mg edible prints its milligrams, not "0%"', dataOf(edibleJob).thc === '100mg', dataOf(edibleJob).thc)
check('BL5: ...and flower still prints its percent', dataOf(flowerJob).thc === '24.5%', dataOf(flowerJob).thc)
// The edible was given an active batch above, so its label must carry that batch number and tag.
// This is the assertion that fails against the old code, where nothing looked a batch up unless one
// was already pinned to the product — and nothing pins one, so every label printed blank.
check('BL5: the batch number is filled in from the product\'s own active batch',
  dataOf(edibleJob).batch_number === 'T45-B-EDI', dataOf(edibleJob).batch_number)
check('BL5: ...and the Metrc tag comes from that batch, not the product',
  dataOf(edibleJob).metrc_tag === '1A4000000000000000000002', dataOf(edibleJob).metrc_tag)
// …while the flower's only batch was recalled, so there is no active batch to label. Blank is the
// right answer there, and it must be blank rather than naming a recalled batch.
check('BL5: a recalled batch is never offered as the one being labelled',
  dataOf(flowerJob).batch_number === '', dataOf(flowerJob).batch_number)
check('BL5: a print job is recorded for the run', jobRows.length === 2, jobRows.length)

// The single-product shape older callers use still works.
const single = await asManager('POST', '/api/labels/generate', { templateId: tmpl.json?.id, productId: edible.id })
check('BL5: the old single-product shape still works', single.status === 201, single.status)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
