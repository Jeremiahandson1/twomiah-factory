// crm-dispensary — the T47 lows that live on the server: P13, P15, P18, P20, P21, P22, and the two
// the report raised inline (a pending offline cash sale on End of Day, and bulk waste in grams).
//
// P13 Print jobs never left "pending". T46 L-a fixed ONE of the two inserts; its sibling kept
//     writing 'pending', so the list still filled with jobs nothing would ever move.
// P15 A 2030 date of birth was answered "you have to be 21 or over" — it parses fine and works out
//     to about minus four. Telling somebody they are too young when they mistyped the year sends
//     them away instead of back to the box.
// P18 The importer wrote `cost` and not `cost_price` (T46 N26 taught goods-in to write both, and the
//     importer was the second door), and a column headed "Grams" was not in the alias list, so every
//     flower row came in with NO weight — and a cannabis product with no weight cannot be sold.
// P20 Two delivery zones could cover the same postcode, so which fee applied depended on which row
//     the matcher reached first.
// P21 ?entityType= on the audit log was ignored, which returned EVERYTHING — a filter that is
//     ignored rather than refused looks exactly like an answer.
// P22 A budtender could read the marketing campaign list.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'
import { ageFromDob } from './src/utils/cannabis.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t47lo', email: 'lo@test.local', state: 'OH', timezone: 'America/New_York',
  enabledFeatures: ['products', 'orders', 'compliance', 'delivery', 'labels', 'audit', 'locations', 'multi_store', 'franchise', 'email_campaigns', 'sms_marketing', 'eod', 'cash', 'batches'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t47lo@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const bud = await mkUser('budtender', 'bud')

const [flower] = await db.insert(product).values({
  name: 'Bulk Flower', companyId: co.id, category: 'flower', price: '35', weightGrams: '3.5',
  stockQuantity: 20, taxCategory: 'cannabis', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/labels', (await import('./src/routes/labels.ts')).default)
app.route('/api/delivery', (await import('./src/routes/delivery.ts')).default)
app.route('/api/audit', (await import('./src/routes/audit.ts')).default)
app.route('/api/marketing', (await import('./src/routes/marketing.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)
app.route('/api/eod', (await import('./src/routes/eod.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.route('/api/enterprise', (await import('./src/routes/enterprise.ts')).default)
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

// ═══════════════════════ P15 · a future birth date is a typo, not a child ════════════════════════
{
  check('P15: a date of birth in the future is not a real date of birth', ageFromDob('2030-01-01') === null, ageFromDob('2030-01-01'))
  check('P15: …nor is a date that does not exist', ageFromDob('banana') === null)
  check('P15: …while a real one still works', ageFromDob('1990-01-01')! >= 34, ageFromDob('1990-01-01'))
  check('P15: …and a genuinely under-age one still reads as under age', ageFromDob(`${new Date().getFullYear() - 18}-01-01`)! <= 18)
}

// ══════════════════════════ P13 · a print job that is actually done ═════════════════════════════
{
  const tpl = await api('POST', '/api/labels/templates', { name: 'T47 Label', type: 'product', width: 50, height: 25, fields: [{ key: 'name', label: 'Product', x: 1, y: 1 }] })
  const templateId = (tpl.json?.data || tpl.json)?.id
  const printed = await api('POST', '/api/labels/print', { templateId, productIds: [flower.id], quantity: 2 })
  check('P13: printing labels for several products works', printed.status === 200 || printed.status === 201, printed.json)

  const jobs = await rows(sql`SELECT status FROM label_print_jobs WHERE company_id = ${co.id}`)
  check('P13: …and the jobs are recorded', jobs.length >= 1, jobs.length)
  check('P13: …as COMPLETED, not left pending for ever — there is no spooler to move them',
    jobs.every((j) => j.status === 'completed'), jobs.map((j) => j.status))
}

// ══════════════════════ P20 · two zones cannot cover one postcode ═══════════════════════════════
{
  const first = await api('POST', '/api/delivery/zones', {
    name: 'T47 Zone A', zipCodes: ['43004', '43016'], deliveryFee: 5, minimumOrder: 50,
  })
  check('P20: the first zone is created', first.status === 200 || first.status === 201, first.json)

  const clash = await api('POST', '/api/delivery/zones', {
    name: 'T47 Zone B', zipCodes: ['43016', '43017'], deliveryFee: 10, minimumOrder: 35,
  })
  check('P20: a second zone covering the same postcode is refused', clash.status === 409, { status: clash.status, body: clash.json })
  check('P20: …naming the postcode and the zone that already has it',
    /43016/.test(String(clash.json?.error)) && /T47 Zone A/.test(String(clash.json?.error)), clash.json?.error)
  check('P20: …and saying why it matters — the checkout cannot choose a fee',
    /fee/i.test(String(clash.json?.error)), clash.json?.error)

  const fine = await api('POST', '/api/delivery/zones', {
    name: 'T47 Zone C', zipCodes: ['43017', '43018'], deliveryFee: 8, minimumOrder: 40,
  })
  check('P20: …while a zone covering different postcodes is fine', fine.status === 200 || fine.status === 201, fine.json)
}

// ═══════════════════ P21 · a filter that is ignored looks like an answer ════════════════════════
{
  // Two audit rows of different kinds.
  await db.execute(sql`
    INSERT INTO audit_log (id, company_id, user_id, action, entity, entity_id, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${owner.id}, 'create', 'product', ${flower.id}, NOW()),
           (gen_random_uuid(), ${co.id}, ${owner.id}, 'create', 'delivery_zone', 'z1', NOW())
  `)

  const byEntity = await api('GET', '/api/audit?entity=product')
  const n = (byEntity.json?.data || []).length
  check('P21: ?entity= filters, as it always did', n >= 1 && (byEntity.json?.data || []).every((r: any) => r.entity === 'product'),
    (byEntity.json?.data || []).map((r: any) => r.entity))

  const byType = await api('GET', '/api/audit?entityType=product')
  check('P21: ?entityType= now filters too, instead of silently returning everything',
    (byType.json?.data || []).length === n && (byType.json?.data || []).every((r: any) => r.entity === 'product'),
    (byType.json?.data || []).map((r: any) => r.entity))

  const unfiltered = await api('GET', '/api/audit')
  check('P21: …and it really was returning everything before', (unfiltered.json?.data || []).length > n,
    { filtered: n, all: (unfiltered.json?.data || []).length })
}

// ══════════════════════ P22 · the marketing list is not the till's ══════════════════════════════
{
  const mine = await api('GET', '/api/marketing/campaigns')
  check('P22: an owner reads the campaign list', mine.status === 200, mine.status)
  const theirs = await as(bud)('GET', '/api/marketing/campaigns')
  check('P22: a budtender does not', theirs.status === 403, theirs.status)
}

// ══════════ N10 follow-on · the refusal stops promising what it cannot do ═══════════════════════
//
// The message used to end "…or record the waste against the batch it came out of", and that did
// not work either: batch quantities are whole units too (batches.current_quantity is an integer),
// so a batch cannot take 1.7 g. Weighing bulk stock properly needs that column widened and the
// adjustment ledger with it — worth doing, and too big to slip into a wording fix. So the refusal
// now says what the product can ACTUALLY do, which is the half that costs nothing to get right.
{
  const partial = await api('POST', '/api/compliance/waste', {
    productId: flower.id, quantity: 1.7, unitOfMeasure: 'g',
    wasteType: 'damaged', reason: 'Dropped', witnessedBy: owner.id, method: 'rendered_unusable',
  })
  check('N10: part of a sealed package still cannot be destroyed', partial.status === 400, partial.json)
  check('N10: …and the refusal no longer sends people to the batch, which cannot take grams either',
    !/against the batch/i.test(String(partial.json?.error)), partial.json?.error)
  check('N10: …it offers the whole numbers either side instead',
    Array.isArray(partial.json?.wholeUnitOptions) && partial.json.wholeUnitOptions.length > 0, partial.json?.wholeUnitOptions)

  // …and a whole number of units still works, which is the path it is pointing at.
  const whole = await api('POST', '/api/compliance/waste', {
    productId: flower.id, quantity: 7, unitOfMeasure: 'g',
    wasteType: 'damaged', reason: 'Two dropped eighths', witnessedBy: owner.id, method: 'rendered_unusable',
  })
  check('N10: …while 7 g — exactly two 3.5 g units — is accepted', whole.status === 200 || whole.status === 201, whole.json)
  const stock = await rows(sql`SELECT stock_quantity FROM products WHERE id = ${flower.id}`)
  check('N10: …taking two units off, not four', Number(stock[0]?.stock_quantity) === 18, stock[0]?.stock_quantity)
}

// ══════════════ P18 · the importer writes both cost columns, and reads "Grams" ═══════════════════
{
  const { importProducts } = await import('./src/services/import.ts')

  const csv = [
    'Name,Category,Price,Cost,Grams,Stock',
    'T47 Import Flower,flower,45,20,3.5,12',
  ].join('\n')
  const result = await importProducts(csv, co.id, {})
  check('P18: the file imports', result.imported === 1, { imported: result.imported, errors: result.errors })

  const [made] = await rows(sql`SELECT cost, cost_price, weight_grams FROM products WHERE company_id = ${co.id} AND name = 'T47 Import Flower'`)
  check('P18: …writing cost', Math.round(Number(made?.cost) * 100) === 2000, made?.cost)
  check('P18: …AND cost_price, which goods-in has written since T46 N26 and the importer did not',
    Math.round(Number(made?.cost_price) * 100) === 2000, made?.cost_price)
  check('P18: …and a column headed "Grams" is read as the weight, instead of being dropped in silence',
    Math.abs(Number(made?.weight_grams) - 3.5) < 0.001, made?.weight_grams)

  // …and a cannabis row with NO weight comes in, but says so — that product cannot be sold until
  // somebody gives it one, and finding that out at the counter is too late.
  const noWeight = await importProducts('Name,Category,Price,Stock\nT47 No Weight,flower,30,5', co.id, {})
  check('P18: a cannabis product with no weight still imports', noWeight.imported === 1, noWeight.errors)
  check('P18: …but is warned about, rather than passing in silence',
    (noWeight.warnings || []).some((w: any) => /weight/i.test(w.warning)), noWeight.warnings)
  check('P18: …naming the product and what to do', /T47 No Weight/.test(String((noWeight.warnings || [])[0]?.warning)), (noWeight.warnings || [])[0])

  // A merch line needs no weight and must not be nagged about one.
  const merch = await importProducts('Name,Category,Price,Stock\nT47 Logo Tee,merch,25,10', co.id, {})
  check('P18: …while merch is left alone', (merch.warnings || []).length === 0, merch.warnings)
}

// ═══════════ L6 · re-adding a shop to a group creates nothing, and says so ══════════════════════
{
  const ent = as(owner)
  const loc = await ent('POST', '/api/locations', { name: 'T47 Shop', type: 'retail', address: '1 High St', city: 'Columbus', state: 'OH', zipCode: '43004' })
  const locationId = (loc.json?.data || loc.json)?.id
  const grp = await ent('POST', '/api/enterprise/store-groups', { name: 'T47 Group', type: 'chain' })
  const groupId = (grp.json?.data || grp.json)?.id

  check('L6 setup: a location is created', !!locationId, { status: loc.status, body: loc.json })
  check('L6 setup: a store group is created', !!groupId, { status: grp.status, body: grp.json })
  if (locationId && groupId) {
    const first = await ent('POST', `/api/enterprise/store-groups/${groupId}/members`, { locationId, role: 'member' })
    check('L6: adding a shop to a group is a 201 — something was created', first.status === 201, { status: first.status, body: first.json })

    const again = await ent('POST', `/api/enterprise/store-groups/${groupId}/members`, { locationId, role: 'flagship' })
    check('L6: re-adding the same shop answers 200, because nothing was created', again.status === 200, { status: again.status, body: again.json })

    const members = await rows(sql`SELECT id, role FROM store_group_members WHERE group_id = ${groupId}`)
    check('L6: …there is still exactly one membership row', members.length === 1, members.length)
    check('L6: …with the new role on it', members[0]?.role === 'flagship', members[0]?.role)
  } else {
    console.log('  --   L6: locations/enterprise not available in this sandbox')
  }
}

// ═══════════ N1 cash · a sale the shop has not been paid for reaches End of Day ══════════════════
{
  const sale = await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in' })
  const id = (sale.json?.data || sale.json)?.id
  // Left pending, the way an offline cash sale with no drawer open is left standing.
  await db.execute(sql`UPDATE orders SET status = 'pending', payment_method = 'cash' WHERE id = ${id}`)

  const today = new Date().toISOString().slice(0, 10)
  const eod = await api('POST', '/api/eod/generate', { date: today })
  check('P: End of Day generates', eod.status === 200 || eod.status === 201, eod.json?.error)
  check('N1: …and counts the sale nobody has been paid for', eod.json?.unsettledSales === 1, eod.json?.unsettledSales)
  check('N1: …with what it is worth', Number(eod.json?.unsettledTotal) > 0, eod.json?.unsettledTotal)
  check('N1: …and names it, so it cannot be forgotten at close',
    (eod.json?.unsettledOrders || []).length === 1 && !!(eod.json?.unsettledOrders || [])[0]?.number,
    eod.json?.unsettledOrders)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
