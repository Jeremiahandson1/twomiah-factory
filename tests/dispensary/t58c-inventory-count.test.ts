// T58c — the inventory count: what it refuses, and what it has never accepted.
//
// Two faults, found one after the other:
//
//   1. "an empty inventory count is accepted" — POST {items: []} returned 200 with "0 counted, 0
//      discrepancies" and wrote an audit row reading "Count: 0 items". A cycle count recorded as
//      done that touched nothing is the record somebody later points at to say the shelf was
//      checked.
//
//   2. found while confirming (1): the Count tab posts { sku, counted } and the route required
//      productId, so a count has NEVER completed from the UI. Measured live:
//      {"sku":"MER-TS-001","counted":5} → 400 "item 1 product id is required."
//
// And then my own fix for (2) shipped broken: the SKU lookup used `sku = ANY(${skus})`, which binds
// a JS array as ONE parameter, so Postgres refused with 22P02 and a VALID sku failed exactly like an
// invalid one. Only the live check found it, because nothing exercised this route at all.
//
// That is why this file exists: the route now has a test, so the next change to it cannot ship
// unexercised.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, product, location } = schema

const [co] = await db.insert(company).values({
  name: 'Count Co', slug: 'count-co', email: 'cc@test.local', state: 'OH', settings: {},
  enabledFeatures: ['inventory', 'multi_location'],
} as any).returning()
const [mgr] = await db.insert(user).values({
  email: 'mgr-cc@test.local', passwordHash: 'x', firstName: 'Mo', lastName: 'Manager',
  role: 'manager', companyId: co.id, isActive: true,
} as any).returning()
const [loc] = await db.insert(location).values({
  companyId: co.id, name: 'Back room', type: 'storage', isActive: true,
} as any).returning()
const [prod] = await db.insert(product).values({
  companyId: co.id, name: 'Branded T-Shirt', sku: 'MER-TS-001', category: 'accessory',
  price: '20.00', stockQuantity: 10, active: true,
} as any).returning()

const app = new Hono()
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const post = async (path: string, body: unknown) => {
  const res = await app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': mgr.id },
    body: JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const P = `/api/locations/${loc.id}/count`
const says = (r: any, re: RegExp) => re.test(JSON.stringify(r.json))

// ══════════ 1. a count of nothing is not a count ════════════════════════════════════════════════
{
  const r = await post(P, { items: [] })
  check('an empty items array is refused', r.status === 400, r)
  check('…and says what to do about it', says(r, /at least one product/i), r.json)

  const none = await post(P, {})
  check('a payload with no items at all is refused', none.status === 400, none)
}

// ══════════ 2. the SHAPE THE SCREEN SENDS works — this is the one that had never been exercised ══
{
  const r = await post(P, { items: [{ sku: 'MER-TS-001', counted: 7 }] })
  check('a count by SKU is accepted (the Count tab posts exactly this)', r.status === 200, r)
  check('…and reports the line it counted', Number(r.json?.counted) === 1, r.json)
  // 10 on hand, 7 counted → one adjustment of -3. The SKU must have resolved to the real product.
  check('…and the discrepancy was recorded against the right product', Number(r.json?.discrepancies) === 1, r.json)
}

// ══════════ 3. productId still works, and so does a mix ═════════════════════════════════════════
{
  const byId = await post(P, { items: [{ productId: prod.id, counted: 7 }] })
  check('a count by productId is still accepted', byId.status === 200, byId)

  const mixed = await post(P, { items: [{ productId: prod.id, counted: 7 }, { sku: 'MER-TS-001', counted: 7 }] })
  check('a payload mixing both identifiers is accepted', mixed.status === 200, mixed)
}

// ══════════ 4. an unknown SKU is refused BY NAME ════════════════════════════════════════════════
//
// The generic "item 1 product id is required" told somebody holding a shelf label nothing. This is
// also the assertion that fails if the lookup goes back to `= ANY(${array})`, because then a VALID
// sku 400s too and case 2 above breaks first.
{
  const r = await post(P, { items: [{ sku: 'NO-SUCH-SKU', counted: 1 }] })
  check('an unknown SKU is refused', r.status === 400, r)
  check('…and the refusal quotes the SKU that was not found', says(r, /NO-SUCH-SKU/), r.json)
}

// ══════════ 5. a line naming neither a product nor a SKU ════════════════════════════════════════
{
  const r = await post(P, { items: [{ counted: 1 }] })
  check('a line with no identifier is refused', r.status === 400, r)
  check('…and says to scan or pick', says(r, /scan a SKU or pick the product/i), r.json)
}

// ══════════ 6. counting ZERO units is a real count, and still allowed ═══════════════════════════
{
  const r = await post(P, { items: [{ sku: 'MER-TS-001', counted: 0 }] })
  check('counting zero units is accepted — that is a shelf that is empty, not a missing count', r.status === 200, r)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
