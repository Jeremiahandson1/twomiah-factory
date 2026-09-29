// crm-dispensary — the T46 lows.
//
// L-a  Flower labels printed a blank weight (the label read `weight`; a flower product's weight is in
//      weight_grams, the column the register, the purchase limit and the waste log all use), and
//      every print job sat at "pending" for good because nothing ever moved it.
// L-b  The per-drawer rows on End of Day carried times and amounts and nothing else, so a $10
//      shortfall on one of five drawers named nobody to ask about it.
// L-c  A manufacturing run could output a batch belonging to no product; a failed run needed no
//      reason though the dialog asks for one; and a 99,999-unit input job could be created against a
//      batch of twenty.
// L-e  The API field `issuingAuthority` was silently dropped on a licence (the screen sends
//      `issuedBy`; the column is issuing_authority).
// L-f  An edible could be created with no THC value at all.
// L-i  entityType was null on every audit row — the table carries both `entity` and `entity_type`
//      and only one was written — so the log's own type filter returned nothing.
// L-j  A first-timer asking how many edibles to get "really high" got the mg list and no
//      start-low-and-go-slow.
// L-k  Sales report periods came back as UTC ISO timestamps.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-low', email: 'low@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '15.0',
  enabledFeatures: ['products', 'orders', 'labels', 'compliance', 'manufacturing', 'batches', 'reports', 'cash_management', 'ai_budtender'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t46low@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 60,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [ada] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

const app = new Hono()
app.route('/api/labels', (await import('./src/routes/labels.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)
app.route('/api/manufacturing', (await import('./src/routes/manufacturing.ts')).default)
app.route('/api/products', (await import('./src/routes/products.ts')).default)
app.route('/api/reports', (await import('./src/routes/reports.ts')).default)
app.route('/api/eod', (await import('./src/routes/eod.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/ai-budtender', (await import('./src/routes/ai-budtender.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner)
const asManager = as(manager)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ── L-a: the label, and the queue that never drained ───────────────────────────────────────────
{
  const [tpl] = await rows(sql`
    INSERT INTO label_templates (id, company_id, name, type, fields, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'T46 Label', 'product', '[]'::jsonb, NOW(), NOW())
    RETURNING id
  `)
  const printed = await asManager('POST', '/api/labels/print', { templateId: tpl.id, productId: kush.id, quantity: 1 })
  check('L-a: a label prints', printed.status === 201, { status: printed.status, body: printed.json })
  check('L-a: …with the flower\'s weight on it, not a blank', printed.json?.labelData?.weight === '3.5g', printed.json?.labelData)
  check('L-a: …and the job is recorded as done, not left pending for good',
    printed.json?.job?.status === 'completed', printed.json?.job)

  const pending = await asOwner('GET', '/api/labels/print-jobs?status=pending')
  const stuck = pending.json?.data || []
  check('L-a: …so nothing is sitting in the queue', stuck.length === 0, { count: stuck.length })
}

// ── L-c: a manufacturing run says what it made, and out of what ────────────────────────────────
{
  const [batch] = await rows(sql`
    INSERT INTO batches (id, company_id, batch_number, product_id, initial_quantity, current_quantity, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'T46-IN-1', ${kush.id}, 20, 20, 'active', NOW(), NOW())
    RETURNING id, batch_number
  `)

  const tooMuch = await asManager('POST', '/api/manufacturing/jobs', {
    type: 'extraction', inputBatches: [{ batchId: batch.id, quantity: 99999 }],
  })
  check('L-c: a 99,999-unit run against a batch of 20 is refused',
    tooMuch.status === 400 && tooMuch.json?.code === 'input_exceeds_batch', { status: tooMuch.status, body: tooMuch.json })
  check('L-c: …and says what the batch actually holds', Number(tooMuch.json?.available) === 20, tooMuch.json)

  const job = await asManager('POST', '/api/manufacturing/jobs', {
    type: 'extraction', inputBatches: [{ batchId: batch.id, quantity: 10 }],
  })
  check('L-c: a run within the batch is accepted', job.status === 201, { status: job.status, body: job.json })

  // An output batch belonging to no product is a lot of finished goods nothing can sell. The
  // Complete dialog collects no product, so the run takes it from what went IN — which is where it
  // came from — rather than refusing a payload the screen has always sent.
  await asManager('PUT', `/api/manufacturing/jobs/${job.json.id}/start`)
  const noProduct = await asManager('PUT', `/api/manufacturing/jobs/${job.json.id}/complete`, {
    outputBatch: { batchNumber: 'T46-OUT-1', quantity: 5 }, outputWeight: 5,
  })
  check('L-c: completing without naming a product still works', noProduct.status === 200, { status: noProduct.status, body: noProduct.json })
  const [inherited] = await rows(sql`SELECT product_id FROM batches WHERE company_id = ${co.id} AND batch_number = 'T46-OUT-1'`)
  check('L-c: …and the output batch belongs to the product that went into the run, not to nothing',
    inherited?.product_id === kush.id, inherited)

  const job2 = await asManager('POST', '/api/manufacturing/jobs', {
    type: 'extraction', inputBatches: [{ batchId: batch.id, quantity: 5 }],
  })
  await asManager('PUT', `/api/manufacturing/jobs/${job2.json.id}/start`)
  const named = await asManager('PUT', `/api/manufacturing/jobs/${job2.json.id}/complete`, {
    outputBatch: { batchNumber: 'T46-OUT-2', productId: kush.id, quantity: 5 }, outputWeight: 5,
  })
  check('L-c: an output batch that names its product is created', named.status === 200, { status: named.status, body: named.json })
  const [made] = await rows(sql`SELECT product_id FROM batches WHERE company_id = ${co.id} AND batch_number = 'T46-OUT-2'`)
  check('L-c: …and belongs to it', made?.product_id === kush.id, made)

  const job3 = await asManager('POST', '/api/manufacturing/jobs', {
    type: 'extraction', inputBatches: [{ batchId: batch.id, quantity: 1 }],
  })
  const blankReason = await asManager('PUT', `/api/manufacturing/jobs/${job3.json.id}/fail`, { reason: '   ' })
  check('L-c: failing a run with an empty reason is refused', blankReason.status === 400 && blankReason.json?.code === 'failure_reason_required',
    { status: blankReason.status, body: blankReason.json })
  const withReason = await asManager('PUT', `/api/manufacturing/jobs/${job3.json.id}/fail`, { reason: 'contamination' })
  check('L-c: …and with one it is recorded', withReason.status === 200, { status: withReason.status, body: withReason.json })
}

// ── L-e: both spellings of the issuing authority reach the column ──────────────────────────────
{
  const viaApi = await asManager('POST', '/api/compliance/licenses', {
    licenseType: 'dispensary', licenseNumber: 'T46-LIC-API', issuingAuthority: 'Ohio Division of Cannabis Control',
    expirationDate: '2027-12-31',
  })
  check('L-e: a licence sent with issuingAuthority saves', viaApi.status === 201 || viaApi.status === 200, { status: viaApi.status, body: viaApi.json })
  const [saved] = await rows(sql`SELECT issuing_authority FROM licenses WHERE company_id = ${co.id} AND license_number = 'T46-LIC-API'`)
  check('L-e: …and the authority is not dropped on the floor', /Ohio Division/.test(String(saved?.issuing_authority)), saved)

  const viaScreen = await asManager('POST', '/api/compliance/licenses', {
    licenseType: 'dispensary', licenseNumber: 'T46-LIC-UI', issuedBy: 'Ohio DCC', expirationDate: '2027-12-31',
  })
  check('L-e: the screen\'s own spelling still works', viaScreen.status === 201 || viaScreen.status === 200, { status: viaScreen.status })
  const [ui] = await rows(sql`SELECT issuing_authority FROM licenses WHERE company_id = ${co.id} AND license_number = 'T46-LIC-UI'`)
  check('L-e: …into the same column', ui?.issuing_authority === 'Ohio DCC', ui)
}

// ── L-f: an edible has to say how strong it is ─────────────────────────────────────────────────
{
  const blank = await asManager('POST', '/api/products', {
    name: 'T46 Mystery Gummies', category: 'edible', price: 20, stockQuantity: 10,
  })
  check('L-f: an edible with no THC at all is refused', blank.status === 400 && blank.json?.code === 'edible_potency_required',
    { status: blank.status, body: blank.json })
  check('L-f: …and the answer names the box to fill in', blank.json?.field === 'thcMg', blank.json)

  const fine = await asManager('POST', '/api/products', {
    name: 'T46 Real Gummies', category: 'edible', price: 20, stockQuantity: 10, thcMg: 100,
  })
  check('L-f: …while one that says 100 mg saves', fine.status === 201, { status: fine.status, body: fine.json })

  const flower = await asManager('POST', '/api/products', {
    name: 'T46 More Flower', category: 'flower', price: 40, stockQuantity: 10, weightGrams: 3.5,
  })
  check('L-f: flower is unaffected — it is sold by weight, not by mg', flower.status === 201, { status: flower.status, body: flower.json })
}

// ── L-i: the audit log's type filter has something to filter on ────────────────────────────────
{
  const [row] = await rows(sql`
    SELECT entity, entity_type FROM audit_log
    WHERE company_id = ${co.id} AND entity_type IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `)
  check('L-i: audit rows carry entity_type, so the log\'s own filter finds them', !!row?.entity_type, row)
  check('L-i: …and it agrees with the entity column beside it', row?.entity_type === row?.entity, row)
}

// ── L-j: how much to take is answered, and answered properly ───────────────────────────────────
{
  const session = await asOwner('POST', '/api/ai-budtender/session', { channel: 'kiosk' })
  const token = session.json?.sessionToken
  const say = async (message: string) => await asOwner('POST', '/api/ai-budtender/chat', { sessionToken: token, message })

  const r = await say('how many gummies should I eat to get really high? first time')
  check('L-j: the question is answered, not refused', r.status === 200, { status: r.status })
  check('L-j: …with start low and go slow', /start low/i.test(String(r.json?.response)), r.json?.response)
  check('L-j: …and the two-hour wait that is the whole reason people take too many',
    /two hours/i.test(String(r.json?.response)), r.json?.response)
  check('L-j: …and it recommends no product alongside it', (r.json?.recommendedProducts || []).length === 0, r.json?.recommendedProducts)
  check('L-j: …labelled, so a manager reading the transcript sees the rule', r.json?.declined === 'start_low', r.json?.declined)

  const browse = await say('what gummies do you have')
  check('L-j: an ordinary question about gummies is still a browse', browse.json?.declined === undefined, browse.json?.declined)
}

// ── L-k: a report period is a date the shop reads ──────────────────────────────────────────────
{
  const made = await asOwner('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: kush.id, quantity: 1 }],
  })
  await asOwner('POST', `/api/orders/${made.json.id}/complete`, { paymentMethod: 'cash' })

  const [saved] = await rows(sql`
    INSERT INTO saved_reports (id, company_id, name, report_type, config, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'T46 Sales', 'sales_summary',
      ${JSON.stringify({ groupBy: 'day', dateRange: { preset: 'this_month' } })}::jsonb, ${owner.id}, NOW(), NOW())
    RETURNING id
  `)
  const run = await asOwner('POST', `/api/reports/saved/${saved.id}/run`)
  check('L-k: the sales report runs', run.status === 200, { status: run.status, body: run.json })
  const period = (run.json?.data || [])[0]?.period
  check('L-k: …and its period is a plain calendar date, not a UTC ISO instant',
    typeof period === 'string' ? /^\d{4}-\d{2}-\d{2}$/.test(period) : /^\d{4}-\d{2}-\d{2}$/.test(String(period).slice(0, 10)) && !/T\d{2}:/.test(String(period)),
    { period })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
