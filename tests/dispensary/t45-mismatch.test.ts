// crm-dispensary — T45's "mismatch" class: eleven findings that are all one shape, where the screen
// and the server were built to different field names or different value sets, so the main action of
// half the modules on the menu answered 400 or 500.
//
//   H5   Transfers could never be shipped from the screen — the endpoint existed, no button called it.
//   H6   RFID: bulk tagging sent epcs (server wanted tags), scanning sent location (wanted locationId),
//        bulk scan sent epcs (wanted scans). Every RFID action but adding one tag failed.
//   H9   A plant's phase never changed; harvests always 500'd (columns that do not exist).
//   H10  Complete job sent outputBatch, the server wanted outputBatches[]; 150% yield was accepted.
//   H11  Net-terms buyers could not be created (net30 vs net_30); a buyer with no licence and an
//        invalid email was accepted, because the email was stripped before anything looked at it.
//   H12  Lab test create answered 400 "testType: Required", then 500 on every column it wrote.
//   H13  Logging a grow-input application: 400 on the screen's shape, 500 on the "correct" one.
//   H14  Custom reports could not be saved (type vs reportType, dateRange "30d" vs an object), and
//        every one of the four report queries was written against columns that are not there.
//   H21  Duplicate batch numbers were accepted, and the public QR page 500'd once a batch existed.
//   H22  The documented POS API wanted a header the docs do not name, and no screen made a key.
//   M13  Failing a manufacturing run sent no body, and the server required a reason — so Fail 500'd.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Mismatch Dispensary', slug: 'mismatch', email: 'mismatch@test.local', state: 'OH',
  enabledFeatures: [
    'products', 'batches', 'locations', 'multi_location', 'rfid', 'cultivation',
    'manufacturing', 'wholesale', 'grow_inputs', 'reports', 'integrations',
  ],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-mm@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [prod] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 100,
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/locations', 'locations'],
  ['/api/rfid', 'rfid'],
  ['/api/cultivation', 'cultivation'],
  ['/api/manufacturing', 'manufacturing'],
  ['/api/wholesale', 'wholesale'],
  ['/api/grow-inputs', 'grow-inputs'],
  ['/api/reports', 'reports'],
  ['/api/batches', 'batches'],
  ['/api/integrations', 'integrations'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

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

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── H11: wholesale buyers ───────────────────────────────────────────────────────────────────────
// Exactly what the buyer dialog sends: Net 30 as the screen spelled it, contact details under the
// names the screen uses.
const buyer = await asManager('POST', '/api/wholesale/customers', {
  name: 'Green Valley', licenseNumber: 'C10-0000001', contactName: 'Pat Buyer',
  contactEmail: 'pat@greenvalley.test', contactPhone: '555-0100', paymentTerms: 'net30', address: '1 Main St',
})
check('H11: a Net 30 buyer can be created from the dialog', buyer.status === 201, { status: buyer.status, body: buyer.json })
check('H11: ...stored under the canonical payment terms', buyer.json?.paymentTerms === 'net_30', buyer.json?.paymentTerms)
check('H11: ...and the contact email actually reached the record', buyer.json?.email === 'pat@greenvalley.test', buyer.json?.email)
check('H11: ...and the phone', buyer.json?.phone === '555-0100', buyer.json?.phone)

const canonical = await asManager('POST', '/api/wholesale/customers', {
  name: 'Canon Co', licenseNumber: 'C10-0000002', paymentTerms: 'net_15',
})
check('H11: the canonical spelling still works', canonical.status === 201 && canonical.json?.paymentTerms === 'net_15',
  { status: canonical.status, terms: canonical.json?.paymentTerms })

const noLicence = await asManager('POST', '/api/wholesale/customers', { name: 'Unlicensed Co', paymentTerms: 'cod' })
check('H11: a buyer with no licence number is refused', noLicence.status === 400, { status: noLicence.status, body: noLicence.json })

const badEmail = await asManager('POST', '/api/wholesale/customers', {
  name: 'Typo Co', licenseNumber: 'C10-0000003', contactEmail: 'not-an-email',
})
check('H11: an invalid email is refused instead of silently dropped', badEmail.status === 400, { status: badEmail.status, body: badEmail.json })

const blankEmail = await asManager('POST', '/api/wholesale/customers', {
  name: 'Blank Co', licenseNumber: 'C10-0000004', contactEmail: '', contactPhone: '',
})
check('H11: an empty email box is "not given", not an invalid address', blankEmail.status === 201, { status: blankEmail.status, body: blankEmail.json })

const badTerms = await asManager('POST', '/api/wholesale/customers', {
  name: 'Odd Co', licenseNumber: 'C10-0000005', paymentTerms: 'whenever',
})
check('H11: unknown payment terms are named in the refusal', badTerms.status === 400, { status: badTerms.status, body: badTerms.json })

// ── H12: lab tests ──────────────────────────────────────────────────────────────────────────────
const [batchForTest] = await rows(sql`
  INSERT INTO batches(id, batch_number, product_id, initial_quantity, current_quantity, unit_of_measure, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'LAB-B-001', ${prod.id}, 10, 10, 'grams', 'active', ${co.id}, NOW(), NOW())
  RETURNING id, batch_number
`)

// Exactly what the New Test dialog sends — no testType, because the dialog has no box for one.
const labCreate = await asManager('POST', '/api/wholesale/lab-tests', {
  sampleId: 'SAMPLE-001', batchId: 'LAB-B-001', labName: 'Confident Cannabis', notes: 'full panel',
})
check('H12: the New Test dialog\'s own payload is accepted', labCreate.status === 201, { status: labCreate.status, body: labCreate.json })
check('H12: ...and the typed batch NUMBER resolved to the batch', labCreate.json?.batchId === batchForTest.id,
  { got: labCreate.json?.batchId, want: batchForTest.id })

const labNoBatch = await asManager('POST', '/api/wholesale/lab-tests', { sampleId: 'SAMPLE-002' })
check('H12: a sample can be logged before a batch is chosen', labNoBatch.status === 201, { status: labNoBatch.status, body: labNoBatch.json })

const labBadBatch = await asManager('POST', '/api/wholesale/lab-tests', { sampleId: 'SAMPLE-003', batchId: 'NOPE-999' })
check('H12: an unknown batch is a plain refusal, not a foreign-key 500', labBadBatch.status === 400, { status: labBadBatch.status, body: labBadBatch.json })

const labResults = await asManager('PUT', `/api/wholesale/lab-tests/${labCreate.json?.id}/results`, {
  thc: 22.4, cbd: 0.3, totalCannabinoids: 24.1, terpenes: 2.1,
  pesticides: 'pass', heavyMetals: 'pass', microbials: 'pass', mycotoxins: 'pass',
  residualSolvents: 'pass', foreignMatter: 'pass', overallResult: 'pass',
})
check('H12: results save against the real columns', labResults.status === 200, { status: labResults.status, body: labResults.json })
check('H12: ...and the potency landed in total_thc', labResults.json?.totalThc === '22.4', labResults.json?.totalThc)

const labUpdate = await asManager('PUT', `/api/wholesale/lab-tests/${labCreate.json?.id}`, { labName: 'Green Labs', thcPercent: 19 })
check('H12: the generic update no longer writes columns that do not exist', labUpdate.status === 200, { status: labUpdate.status, body: labUpdate.json })

// ── H21: duplicate batch numbers + the public QR page ────────────────────────────────────────────
const dupeBatch = await asManager('POST', '/api/batches', {
  batchNumber: 'LAB-B-001', productId: prod.id, quantity: 5, unit: 'grams',
})
check('H21: a duplicate batch number is refused', dupeBatch.status === 400, { status: dupeBatch.status, body: dupeBatch.json })
check('H21: ...with a reason the person can act on', dupeBatch.json?.code === 'duplicate_batch_number', dupeBatch.json)

const freshBatch = await asManager('POST', '/api/batches', {
  batchNumber: 'LAB-B-002', productId: prod.id, quantity: 5, unit: 'grams',
})
check('H21: a distinct batch number still creates', freshBatch.status === 201, { status: freshBatch.status, body: freshBatch.json })

const renameOntoDupe = await asManager('PUT', `/api/batches/${freshBatch.json?.id}`, { batchNumber: 'LAB-B-001' })
check('H21: renaming a batch onto another lot\'s number is refused too', renameOntoDupe.status === 400, { status: renameOntoDupe.status, body: renameOntoDupe.json })

// The public QR payload only queried lab_tests once the product HAD an active batch — which is
// exactly the state the tester reached, and why it answered 500.
const qr = new Hono()
qr.route('/api/qr-scanner', (await import('./src/routes/qr-scanner.ts')).default)
const qrRes = await qr.request(`/api/qr-scanner/trace/${prod.id}`)
check('H21: the public QR page answers with a batch present', qrRes.status === 200, { status: qrRes.status, body: await qrRes.clone().text() })
if (qrRes.status === 200) {
  const body: any = await qrRes.json()
  check('H21: ...and carries the batch it found', !!body?.batch?.batchNumber, body?.batch)
}

// ── H13: grow inputs ────────────────────────────────────────────────────────────────────────────
const input = await asManager('POST', '/api/grow-inputs', {
  name: 'CalMag', type: 'fertilizer', unitOfMeasure: 'ml', currentStock: 1000, minStock: 100,
})
check('H13: setup — an input exists', input.status === 201, { status: input.status, body: input.json })

const [room] = await rows(sql`
  INSERT INTO grow_rooms(id, company_id, name, type, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'Veg A', 'veg', NOW(), NOW())
  RETURNING id
`)

// Exactly what the Applications tab sends.
const application = await asManager('POST', '/api/grow-inputs/applications', {
  inputId: input.json?.id, targetType: 'room', targetId: room.id,
  quantity: 50, unit: 'ml', method: 'foliar_spray', growPhase: 'vegetative', reason: 'feeding', notes: 'weekly',
})
check('H13: the Applications tab\'s own payload is accepted', application.status === 201, { status: application.status, body: application.json })
check('H13: ...against the room it named', application.json?.roomId === room.id, { got: application.json?.roomId, want: room.id })
check('H13: ...and the unit was carried through', application.json?.unitOfMeasure === 'ml', application.json?.unitOfMeasure)

const afterDraw = await rows(sql`SELECT current_stock FROM grow_inputs WHERE id = ${input.json?.id}`)
check('H13: stock came down by what was applied', Number(afterDraw[0]?.current_stock) === 950, afterDraw[0])

const noTarget = await asManager('POST', '/api/grow-inputs/applications', { inputId: input.json?.id, quantity: 1 })
check('H13: an application with no target is refused', noTarget.status === 400, { status: noTarget.status, body: noTarget.json })

const overDraw = await asManager('POST', '/api/grow-inputs/applications', {
  inputId: input.json?.id, targetType: 'room', targetId: room.id, quantity: 99999,
})
check('H13: applying more than is on hand is refused', overDraw.status === 400, { status: overDraw.status, body: overDraw.json })

const adjust = await asManager('POST', `/api/grow-inputs/${input.json?.id}/adjust-stock`, { quantity: 50, reason: 'delivery' })
check('H13: adjusting stock works', adjust.status === 200, { status: adjust.status, body: adjust.json })
check('H13: ...and stores a number, never "NaN"', adjust.json?.currentStock === '1000', adjust.json?.currentStock)

// ── H14: reports ────────────────────────────────────────────────────────────────────────────────
// Exactly what the New Report dialog sends.
const report = await asManager('POST', '/api/reports/saved', {
  name: 'Last 30 days', type: 'sales_summary',
  config: { metrics: ['revenue'], dateRange: '30d', groupBy: 'day' },
})
check('H14: the New Report dialog\'s own payload saves', report.status === 201, { status: report.status, body: report.json })
check('H14: ...under the canonical report type', report.json?.reportType === 'sales_summary', report.json?.reportType)
const savedConfig = typeof report.json?.config === 'string' ? JSON.parse(report.json.config) : report.json?.config
check('H14: ...with the bare "30d" normalised into a range the runner reads',
  savedConfig?.dateRange?.preset === 'last_30', savedConfig?.dateRange)

const unrunnable = await asManager('POST', '/api/reports/saved', {
  name: 'Customers', type: 'customers', config: { dateRange: '30d' },
})
check('H14: a report type nothing can run is refused at save time', unrunnable.status === 400, { status: unrunnable.status, body: unrunnable.json })

for (const [label, type] of [
  ['sales summary', 'sales_summary'],
  ['product sales', 'product_sales'],
  ['inventory snapshot', 'inventory_snapshot'],
  ['loyalty', 'loyalty_report'],
] as const) {
  const saved = await asManager('POST', '/api/reports/saved', {
    name: `Run ${type}`, type, config: { dateRange: 'all', groupBy: 'day' },
  })
  const run = await asManager('POST', `/api/reports/saved/${saved.json?.id}/run`)
  check(`H14: the ${label} report actually runs`, run.status === 200, { status: run.status, body: run.json })
}

// 'category' is not a period; it used to go straight into DATE_TRUNC and take the run down with it.
const oddGroup = await asManager('POST', '/api/reports/saved', {
  name: 'Odd group', type: 'sales_summary', config: { dateRange: 'all', groupBy: 'category' },
})
const oddRun = await asManager('POST', `/api/reports/saved/${oddGroup.json?.id}/run`)
check('H14: a non-period Group By falls back to day instead of 500ing', oddRun.status === 200, { status: oddRun.status, body: oddRun.json })

// ── H6: RFID ────────────────────────────────────────────────────────────────────────────────────
const [loc] = await rows(sql`
  INSERT INTO locations(id, company_id, name, type, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'Vault', 'dispensary', NOW(), NOW())
  RETURNING id, name
`)

const rfidLocations = await asManager('GET', '/api/rfid/locations')
check('H6: the RFID page can list locations without the multi_location gate',
  rfidLocations.status === 200 && Array.isArray(rfidLocations.json) && rfidLocations.json.length === 1,
  { status: rfidLocations.status, body: rfidLocations.json })

// Exactly what the register dialog sends: `location`, not `locationId`.
const oneTag = await asManager('POST', '/api/rfid/tags', { epc: 'E2000001', location: loc.id, productId: prod.id })
check('H6: a single tag registers', oneTag.status === 201, { status: oneTag.status, body: oneTag.json })
check('H6: ...and the location it was given was actually stored', oneTag.json?.locationId === loc.id,
  { got: oneTag.json?.locationId, want: loc.id })

const bulk = await asManager('POST', '/api/rfid/tags/bulk', {
  epcs: ['E2000002', 'E2000003'], location: loc.id, productId: prod.id,
})
check('H6: bulk tagging takes the screen\'s { epcs, location }', bulk.status === 201, { status: bulk.status, body: bulk.json })
check('H6: ...and registered both', bulk.json?.created === 2, bulk.json?.created)

const badLoc = await asManager('POST', '/api/rfid/tags', { epc: 'E2000099', location: 'Sales Floor' })
check('H6: a place name that is not a location is refused, not a foreign-key 500', badLoc.status === 400,
  { status: badLoc.status, body: badLoc.json })

const namedLoc = await asManager('POST', '/api/rfid/tags', { epc: 'E2000098', location: 'Vault' })
check('H6: ...but the location\'s real NAME resolves', namedLoc.status === 201 && namedLoc.json?.locationId === loc.id,
  { status: namedLoc.status, locationId: namedLoc.json?.locationId })

const scan = await asManager('POST', '/api/rfid/scan', { epc: 'E2000001', scanType: 'audit', location: loc.id })
check('H6: a scan takes the screen\'s { epc, scanType, location }', scan.status === 200, { status: scan.status, body: scan.json })

const scanNoLoc = await asManager('POST', '/api/rfid/scan', { epc: 'E2000001', scanType: 'audit' })
check('H6: a scan with no location is still logged', scanNoLoc.status === 200, { status: scanNoLoc.status, body: scanNoLoc.json })

const bulkScan = await asManager('POST', '/api/rfid/scan/bulk', {
  epcs: ['E2000001', 'E2000002'], location: loc.id, scanType: 'inventory_count',
})
check('H6: bulk scan takes the screen\'s { epcs, location }', bulkScan.status === 200, { status: bulkScan.status, body: bulkScan.json })

const tagList = await asManager('GET', `/api/rfid/tags?locationId=${loc.id}`)
check('H6: the tag list filters by locationId and carries a readable location name',
  tagList.status === 200 && tagList.json?.data?.[0]?.locationName === 'Vault',
  { status: tagList.status, first: tagList.json?.data?.[0] })

// ── H5: shipping a transfer ─────────────────────────────────────────────────────────────────────
const [locB] = await rows(sql`
  INSERT INTO locations(id, company_id, name, type, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, 'Sales Floor', 'dispensary', NOW(), NOW())
  RETURNING id
`)
await db.execute(sql`
  INSERT INTO product_locations(id, company_id, product_id, location_id, quantity, created_at, updated_at)
  VALUES (gen_random_uuid(), ${co.id}, ${prod.id}, ${loc.id}, 10, NOW(), NOW())
`)

const transfer = await asManager('POST', '/api/locations/transfers', {
  fromLocationId: loc.id, toLocationId: locB.id,
  items: [{ productId: prod.id, quantity: 4 }], notes: 'restock',
})
check('H5: a transfer is created', transfer.status === 201, { status: transfer.status, body: transfer.json })
check('H5: ...pending, which is the state the screen had no button for', (transfer.json?.status || 'pending') === 'pending', transfer.json?.status)

const ship = await asManager('PUT', `/api/locations/transfers/${transfer.json?.id}/ship`)
check('H5: the Ship button\'s endpoint moves it to in_transit', ship.status === 200 && ship.json?.status === 'in_transit',
  { status: ship.status, body: ship.json })

const sourceAfter = await rows(sql`SELECT quantity FROM product_locations WHERE product_id = ${prod.id} AND location_id = ${loc.id}`)
check('H5: ...and stock left the source', Number(sourceAfter[0]?.quantity) === 6, sourceAfter[0])

// ── H9: cultivation ─────────────────────────────────────────────────────────────────────────────
const plant = await asManager('POST', '/api/cultivation/plants', {
  strainName: 'OG Kush', strainType: 'hybrid', phase: 'clone', roomId: room.id,
})
check('H9: a plant is created', plant.status === 201, { status: plant.status, body: plant.json })

const plantId = Array.isArray(plant.json) ? plant.json[0]?.id : (plant.json?.id || plant.json?.plants?.[0]?.id)
const phaseChange = await asManager('PUT', `/api/cultivation/plants/${plantId}`, { phase: 'vegetative' })
check('H9: a plant\'s phase can be changed', phaseChange.status === 200, { status: phaseChange.status, body: phaseChange.json })
const phaseNow = await rows(sql`SELECT phase FROM plants WHERE id = ${plantId}`)
check('H9: ...and it actually changed', phaseNow[0]?.phase === 'vegetative', phaseNow[0])

// The room dialog offers vegetative/flowering/drying/curing; the column stores veg/flower/dry/cure.
const screenRoom = await asManager('POST', '/api/cultivation/rooms', { name: 'Flower B', type: 'flowering' })
check('H9: a room created with the dialog\'s own type is accepted', screenRoom.status === 201, { status: screenRoom.status, body: screenRoom.json })

// Exactly what the harvest dialog sends.
const harvest = await asManager('POST', '/api/cultivation/harvests', {
  name: 'Harvest A', strainName: 'OG Kush', plantCount: 12, wetWeight: 4200, dryWeight: 900,
})
check('H9: recording a harvest no longer 500s', harvest.status === 201, { status: harvest.status, body: harvest.json })
check('H9: ...and the weights landed in the real columns',
  harvest.json?.totalWetWeight === '4200' && harvest.json?.plantCount === 12,
  { wet: harvest.json?.totalWetWeight, count: harvest.json?.plantCount })

// ── H10 / M13: manufacturing ────────────────────────────────────────────────────────────────────
const [inputBatch] = await rows(sql`
  INSERT INTO batches(id, batch_number, product_id, initial_quantity, current_quantity, unit_of_measure, status, company_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'MFG-IN-001', ${prod.id}, 100, 100, 'grams', 'active', ${co.id}, NOW(), NOW())
  RETURNING id
`)

const job = await asManager('POST', '/api/manufacturing/jobs', {
  type: 'extraction', inputBatches: [{ batchId: inputBatch.id, quantity: 100, unit: 'grams' }],
  inputWeight: 100, method: 'CO2', equipment: 'Rig 1',
})
check('H10: a job is created', job.status === 201, { status: job.status, body: job.json })
await asManager('PUT', `/api/manufacturing/jobs/${job.json?.id}/start`)

const overYield = await asManager('PUT', `/api/manufacturing/jobs/${job.json?.id}/complete`, {
  outputBatch: 'MFG-OUT-001', outputWeight: 150,
})
check('H10: a 150% yield is refused', overYield.status === 400, { status: overYield.status, body: overYield.json })
check('H10: ...by name, so the operator knows what to fix', overYield.json?.code === 'yield_over_100', overYield.json)

// Exactly what the Complete dialog sends: outputBatch (singular), not outputBatches[].
const complete = await asManager('PUT', `/api/manufacturing/jobs/${job.json?.id}/complete`, {
  outputBatch: 'MFG-OUT-001', outputWeight: 22, notes: 'clean run',
})
check('H10: the Complete dialog\'s own payload completes the job', complete.status === 200, { status: complete.status, body: complete.json })
check('H10: ...and an output batch was created', (complete.json?.outputBatchesCreated || []).length === 1, complete.json?.outputBatchesCreated)

const drawnDown = await rows(sql`SELECT current_quantity FROM batches WHERE id = ${inputBatch.id}`)
check('H10: ...and the input batch was drawn down', Number(drawnDown[0]?.current_quantity) === 0, drawnDown[0])

const job2 = await asManager('POST', '/api/manufacturing/jobs', {
  type: 'infusion', inputBatches: [], inputWeight: 10,
})
await asManager('PUT', `/api/manufacturing/jobs/${job2.json?.id}/start`)
// The Fail button sent no body at all.
const fail = await asManager('PUT', `/api/manufacturing/jobs/${job2.json?.id}/fail`)
check('M13: Fail works with no body, the way the button called it', fail.status === 200, { status: fail.status, body: fail.json })
const failed2 = await rows(sql`SELECT status, failure_reason FROM manufacturing_jobs WHERE id = ${job2.json?.id}`)
check('M13: ...the run is recorded failed', failed2[0]?.status === 'failed', failed2[0])
check('M13: ...with a reason on the record rather than a null', !!failed2[0]?.failure_reason, failed2[0])

// ── H22: the integration API key ────────────────────────────────────────────────────────────────
const keyBefore = await asOwner('GET', '/api/integrations/api-key')
check('H22: the key panel reports no key to begin with', keyBefore.status === 200 && keyBefore.json?.configured === false,
  { status: keyBefore.status, body: keyBefore.json })
check('H22: ...and names the header the docs name', keyBefore.json?.header === 'X-API-Key', keyBefore.json?.header)

const rotated = await asOwner('POST', '/api/integrations/api-key/rotate')
check('H22: a key can be created', rotated.status === 200 && typeof rotated.json?.key === 'string' && rotated.json.key.length > 20,
  { status: rotated.status, body: { ...rotated.json, key: '<redacted>' } })

const keyAfter = await asOwner('GET', '/api/integrations/api-key')
check('H22: ...and afterwards only the masked form comes back',
  keyAfter.json?.configured === true && !String(keyAfter.json?.maskedKey || '').includes(rotated.json?.key),
  keyAfter.json)

const keyAsManager = await asManager('GET', '/api/integrations/api-key')
check('H22: a manager cannot read the key', keyAsManager.status === 403, { status: keyAsManager.status })

// The documented header must now be the one that works.
const docHeader = await app.request('/api/integrations/inventory-sync', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-API-Key': rotated.json?.key },
  body: JSON.stringify({ items: [] }),
})
check('H22: X-API-Key — the header the docs publish — authenticates', docHeader.status !== 401, { status: docHeader.status })

const oldHeader = await app.request('/api/integrations/inventory-sync', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Integration-Key': rotated.json?.key },
  body: JSON.stringify({ items: [] }),
})
check('H22: the older X-Integration-Key still authenticates', oldHeader.status !== 401, { status: oldHeader.status })

const noHeader = await app.request('/api/integrations/inventory-sync', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }),
})
check('H22: no key is still 401', noHeader.status === 401, { status: noHeader.status })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
