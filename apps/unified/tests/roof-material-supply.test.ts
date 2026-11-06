// Sending the material order to the supplier, with the supplier's prices (docs/parity/roof-material-list.md #9, #10, #11), through
// the real server as the roofing vertical. Nothing here sends a real email or reaches a supplier: the shared email sender is
// replaced by a recorder, and a supplier's API is a fake registered for the test.
//   · statuses: Roofr's draft, ready to send, sent, rejected and delivered, beside ordered / partly delivered / cancelled;
//     Sent is set only by sending; an order that is sent is spend, one that is a draft, ready or rejected is not.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { dollarsToCents, matchItem, parsePriceCsv, sameSupplier, supplierKey } from '../server/crm/roof/supplierPricing.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'job_costing', 'roof_material_list', 'material_supply']

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, email: 'office@test-builders.example', phone: '715-555-0000' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field'], ['view', 'viewer']] as const) {
    ids[key] = (await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })).id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  // A buyer: a Field seat the owner has granted the inventory permissions — it may order, but not see what the business pays.
  ids.buyer = (await ins(t.schema.user, { email: 'buyer@test.example', passwordHash: hash, firstName: 'buyer', lastName: 'Seat', role: 'field', companyId, extraPermissions: ['inventory:read', 'inventory:create', 'inventory:update'] })).id
  tokens.buyer = await login('buyer@test.example', PASS)
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
}, 120_000)

async function makeJob(address = '12 Gable Ln') {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', totalSquares: 30 })
  expect(made.status).toBe(201)
  return made.body.id as string
}
const order = (jobId: string, extra: Record<string, unknown> = {}, who = 'mgr') =>
  call(who, 'POST', '/api/materials', { jobId, supplier: 'ABC Supply', lineItems: [{ description: 'Shingles', qty: 10, unit: 'bundle', unitPrice: 40 }], ...extra })
/** An order already in a state the API will not set by hand (Sent). */
const raw = (jobId: string, orderStatus: string, price: number, extra: Record<string, unknown> = {}) =>
  ins(t.schema.material, { companyId, jobId, supplier: 'ABC Supply', orderStatus, totalCost: price.toFixed(2), lineItems: [{ description: 'x', qty: 1, unit: 'ea', unitPrice: price, total: price }], ...extra })

describe('the pure parts', () => {
  test('one supplier by any of its names — Beacon is QXO — and not two suppliers that merely look alike', () => {
    expect(sameSupplier('ABC Supply', 'abc_supply')).toBe(true)
    expect(sameSupplier('ABC', ' A.B.C. Supply Co ')).toBe(true)
    expect(sameSupplier('ABC Supply', 'ABC Roofing')).toBe(false)
    expect(sameSupplier('Beacon Building Products', 'QXO')).toBe(true)
    expect(sameSupplier('SRS Distribution', 'ABC Supply')).toBe(false)
    expect(sameSupplier('', '')).toBe(false)
    expect(supplierKey('Smith’s Roofing Yard')).toBe('smithsroofingyard')
  })
  test('a line matches its kind of line first, then its SKU, then its words; prices parse to cents or not at all', () => {
    const items = [{ id: 'a', code: 'shingles', sku: 'HDZ', description: 'GAF HDZ', unit: 'bundle', unitPriceCents: 4150 }, { id: 'b', code: null, sku: null, description: 'Pipe Boot', unit: 'ea', unitPriceCents: 900 }]
    expect(matchItem({ code: 'shingles', description: 'whatever' }, items)?.id).toBe('a')
    expect(matchItem({ sku: 'hdz', description: 'x' }, items)?.id).toBe('a')
    expect(matchItem({ description: ' pipe  boot ' }, items)?.id).toBe('b')
    expect(matchItem({ description: 'Roof cement' }, items)).toBeNull()
    expect([dollarsToCents('$1,234.50'), dollarsToCents(41.5), dollarsToCents('x'), dollarsToCents('-1'), dollarsToCents('')]).toEqual([123450, 4150, null, null, null])
    expect(parsePriceCsv('description,price\nA,1').items).toHaveLength(1)
  })
  test('supplier ordering is a not-ready feature: hidden and offered to roofing alone', () => {
    const def = getFeaturesForTemplate('crm-roof').find((f: any) => f.id === 'material_supply') as any
    expect(def?.hidden).toBe(true)
  })
})

describe('statuses', () => {
  test('draft, ready to send, rejected, ordered, partly delivered, delivered and cancelled can be set; Sent only by sending', async () => {
    const jobId = await makeJob()
    for (const s of ['not_ordered', 'ready_to_send', 'rejected', 'ordered', 'partial', 'delivered', 'cancelled']) {
      const r = await order(jobId, { orderStatus: s })
      expect([s, r.status, r.body.orderStatus]).toEqual([s, 201, s])
    }
    const made = await order(jobId, { orderStatus: 'ready_to_send' })
    const hand = await call('mgr', 'PUT', `/api/materials/${made.body.id}`, { orderStatus: 'sent' })
    expect([hand.status, hand.body.code, Object.keys(hand.body.fields)]).toEqual([400, 'status_sent_by_sending', ['orderStatus']])
    expect((await order(jobId, { orderStatus: 'sent' })).status).toBe(400)
    expect((await call('mgr', 'PUT', `/api/materials/${made.body.id}`, { orderStatus: 'shipped' })).status).toBe(400)
    // An order that really was sent can be edited without losing its Sent.
    const sent = await raw(jobId, 'sent', 500)
    const edited = await call('mgr', 'PUT', `/api/materials/${sent.id}`, { orderStatus: 'sent', notes: 'Call the yard first' })
    expect([edited.status, edited.body.orderStatus, edited.body.notes]).toEqual([200, 'sent', 'Call the yard first'])
    const filtered = await call('mgr', 'GET', `/api/materials?status=ready_to_send&jobId=${jobId}`)
    expect(filtered.body.data.every((o: any) => o.status === 'ready_to_send')).toBe(true)
    expect(filtered.body.data.length).toBe(2)
  })

  test('a sent order is spend on the job; a draft, a ready one and a rejected one are not', async () => {
    const jobId = await makeJob('3 Spend St')
    await raw(jobId, 'sent', 1000)
    await raw(jobId, 'ordered', 100)
    for (const [s, price] of [['not_ordered', 200], ['ready_to_send', 500], ['rejected', 300], ['cancelled', 50]] as const) await raw(jobId, s, price)
    const costing = await call('owner', 'GET', `/api/job-costing/job/${jobId}`)
    expect(costing.status).toBe(200)
    expect(costing.body.roof.materialOrderCost).toBe(1100)
  })
})

const LIST_ITEMS = [
  { code: 'shingles', sku: 'GAF-HDZ', description: 'GAF Timberline HDZ', unit: 'bundle', price: '$41.50' },
  { code: 'starter', description: 'Starter strip', unit: 'bundle', price: 30 },
  { code: 'ridge-cap', description: 'Ridge cap', unit: 'bundle', price: '52.25' },
]
const list = (extra: Record<string, unknown> = {}) => call('mgr', 'POST', '/api/material-supply/price-lists', { supplier: 'ABC Supply', name: '2026 contractor pricing', items: LIST_ITEMS, ...extra })

describe('supplier price lists', () => {
  test('typed in or pasted from a spreadsheet; money is stored in cents', async () => {
    const made = await list()
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ supplier: 'ABC Supply', name: '2026 contractor pricing', active: true, itemCount: 3 })
    const got = await call('mgr', 'GET', `/api/material-supply/price-lists/${made.body.id}`)
    expect(got.body.items.map((i: any) => [i.description, i.unitPriceCents, i.unit, i.code])).toEqual([['GAF Timberline HDZ', 4150, 'bundle', 'shingles'], ['Starter strip', 3000, 'bundle', 'starter'], ['Ridge cap', 5225, 'bundle', 'ridge-cap']])
    ids.list = made.body.id
    const csv = 'SKU,Description,UOM,Your Price,Code\nA-1,"Ice & water, 200 sq ft",roll,"$1,234.50",ice-water\nA-2,Drip edge 10 ft,piece,6.1,\n'
    const pasted = await call('mgr', 'POST', '/api/material-supply/price-lists', { supplier: 'SRS Distribution', name: 'Pasted', csv })
    expect(pasted.status).toBe(201)
    const items = (await call('mgr', 'GET', `/api/material-supply/price-lists/${pasted.body.id}`)).body.items
    expect(items.map((i: any) => [i.sku, i.description, i.unit, i.unitPriceCents, i.code])).toEqual([['A-1', 'Ice & water, 200 sq ft', 'roll', 123450, 'ice-water'], ['A-2', 'Drip edge 10 ft', 'piece', 610, null]])
  })

  test('a price that is not a price, or a pasted list with a bad row or no price column, is refused with the row named', async () => {
    const bad = await list({ items: [{ description: 'Shingles', price: 'lots' }] })
    expect([bad.status, bad.body.code]).toEqual([400, 'bad_items'])
    expect(bad.body.error).toContain('Item 1')
    const negative = await list({ items: [{ description: 'Shingles', price: -5 }] })
    expect(negative.status).toBe(400)
    const csv = await call('mgr', 'POST', '/api/material-supply/price-lists', { supplier: 'ABC', name: 'x', csv: 'description,price\nShingles,41.5\nStarter,abc\n,3' })
    expect(csv.status).toBe(400)
    expect(csv.body.error).toContain('Row 3')
    expect(csv.body.error).toContain('Row 4')
    expect((await call('mgr', 'POST', '/api/material-supply/price-lists', { supplier: 'ABC', name: 'x', csv: 'sku,unit\nA,ea' })).body.error).toContain('"description" column and a "price" column')
    expect((await list({ csv: 'description,price\nA,1' })).status).toBe(400) // items and csv together
    expect((await list({ supplier: '' })).status).toBe(400)
  })

  test('these are the business\'s costs: only a seat that may see costs reads or changes them; another company\'s list is nobody\'s', async () => {
    for (const who of ['view', 'rep']) {
      expect([who, (await call(who, 'GET', '/api/material-supply/price-lists')).status]).toEqual([who, 403])
      expect([who, (await call(who, 'POST', '/api/material-supply/price-lists', { supplier: 'ABC', name: 'x', items: [] })).status]).toEqual([who, 403])
    }
    const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Roofing', slug: 'other-roofing' } as any).returning()
    const foreign = await ins(t.schema.supplierPriceList, { companyId: other.id, supplier: 'ABC Supply', name: 'Theirs' })
    expect((await call('owner', 'GET', `/api/material-supply/price-lists/${foreign.id}`)).status).toBe(404)
    expect((await call('owner', 'PUT', `/api/material-supply/price-lists/${foreign.id}`, { name: 'Mine' })).status).toBe(404)
    expect((await call('owner', 'DELETE', `/api/material-supply/price-lists/${foreign.id}`)).status).toBe(404)
    const mine = await call('owner', 'GET', '/api/material-supply/price-lists?supplier=abc_supply')
    expect(mine.body.data.map((l: any) => l.name)).toEqual(['2026 contractor pricing']) // "abc_supply" is ABC Supply
  })

  test('changing a list replaces its items; the not-ready feature has no door when it is off', async () => {
    const changed = await call('mgr', 'PUT', `/api/material-supply/price-lists/${ids.list}`, { name: '2026 pricing', items: [{ code: 'shingles', description: 'GAF Timberline HDZ', price: 43 }] })
    expect(changed.body).toMatchObject({ name: '2026 pricing', itemCount: 1 })
    expect((await call('mgr', 'PUT', `/api/material-supply/price-lists/${ids.list}`, { items: LIST_ITEMS })).body.itemCount).toBe(3)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'materials'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await call('owner', 'GET', '/api/material-supply/price-lists')).status).toBeGreaterThanOrEqual(400)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
  })
})

describe('an order priced from the supplier\'s list is locked to it', () => {
  const lines = () => [
    { code: 'shingles', description: 'Shingles', qty: 99, unit: 'bundle' },
    { code: 'starter', description: 'Starter strip shingles', qty: 3, unit: 'bundle' },
    { description: 'Pipe boots', qty: 4, unit: 'each' },
  ]
  let jobId = ''
  const fresh = async (extra: Record<string, unknown> = {}) => (await order(jobId, { lineItems: lines().map((l) => ({ ...l, unitPrice: 0 })), ...extra })).body.id as string
  const get = async (id: string, who = 'mgr') => (await call(who, 'GET', `/api/materials/${id}`)).body
  beforeAll(async () => { jobId = await makeJob('9 Lock Ln') })

  test('pricing takes the supplier\'s price for each line it has, names the ones it has not, and totals in cents', async () => {
    const id = await fresh()
    const priced = await call('mgr', 'POST', `/api/material-supply/orders/${id}/price`, {})
    expect(priced.status).toBe(200)
    expect(priced.body.unmatched).toEqual(['Pipe boots'])
    expect(priced.body.pricedLines).toBe(2)
    expect(priced.body.priceList).toMatchObject({ id: ids.list, supplier: 'ABC Supply' })
    const o = await get(id)
    // 99 × $41.50 = $4,108.50; 3 × $30.00 = $90.00.
    expect(o.priceListId).toBe(ids.list)
    expect(o.totalCost).toBe('4198.50')
    expect(o.lineItems.map((l: any) => [l.description, l.unitPrice, l.total, !!l.priceLocked])).toEqual([['Shingles', 41.5, 4108.5, true], ['Starter strip shingles', 30, 90, true], ['Pipe boots', 0, 0, false]])
    ids.priced = id
  })

  test('the prices cannot be typed over — the quantity can — and a line added later is priced from the list', async () => {
    const o = await get(ids.priced)
    const edited = o.lineItems.map((l: any) => (l.code === 'shingles' ? { ...l, qty: 100, unitPrice: 1 } : l))
    edited.push({ code: 'ridge-cap', description: 'Hip and ridge cap shingles', qty: 2, unit: 'bundle', unitPrice: 9999 })
    const put = await call('mgr', 'PUT', `/api/materials/${ids.priced}`, { lineItems: edited })
    expect(put.status).toBe(200)
    const after = await get(ids.priced)
    expect(after.lineItems.map((l: any) => [l.description, l.qty, l.unitPrice, l.total, !!l.priceLocked])).toEqual([
      ['Shingles', 100, 41.5, 4150, true], ['Starter strip shingles', 3, 30, 90, true], ['Pipe boots', 4, 0, 0, false], ['Hip and ridge cap shingles', 2, 52.25, 104.5, true],
    ])
    expect(after.totalCost).toBe('4344.50')
    // The supplier raises a price afterwards: the order keeps the price it was given.
    await call('mgr', 'PUT', `/api/material-supply/price-lists/${ids.list}`, { items: LIST_ITEMS.map((i) => (i.code === 'shingles' ? { ...i, price: 50 } : i)) })
    const again = await call('mgr', 'PUT', `/api/materials/${ids.priced}`, { lineItems: after.lineItems.map((l: any) => (l.code === 'shingles' ? { ...l, qty: 101 } : l)) })
    expect(again.status).toBe(200)
    expect((await get(ids.priced)).lineItems[0]).toMatchObject({ qty: 101, unitPrice: 41.5, total: 4191.5 })
    await call('mgr', 'PUT', `/api/material-supply/price-lists/${ids.list}`, { items: LIST_ITEMS })
  })

  test('changing the supplier clears the pricing; the same supplier by another spelling does not', async () => {
    const same = await call('mgr', 'PUT', `/api/materials/${ids.priced}`, { supplier: 'abc_supply' })
    expect(same.status).toBe(200)
    expect((await get(ids.priced)).priceListId).toBe(ids.list)
    const changed = await call('mgr', 'PUT', `/api/materials/${ids.priced}`, { supplier: 'SRS Distribution' })
    expect(changed.status).toBe(200)
    const o = await get(ids.priced)
    expect([o.supplier, o.priceListId, o.totalCost]).toEqual(['SRS Distribution', null, '0.00'])
    expect(o.lineItems.every((l: any) => l.unitPrice === 0 && l.total === 0 && !l.priceLocked && !l.priceSource)).toBe(true)
    expect(o.lineItems.map((l: any) => l.qty)).toEqual([101, 3, 4, 2]) // the quantities stay
    // …and typed prices are the roofer's again, since nothing locks them any more.
    const typed = await call('mgr', 'PUT', `/api/materials/${ids.priced}`, { lineItems: o.lineItems.map((l: any) => ({ ...l, unitPrice: 2 })) })
    expect(typed.status).toBe(200)
    expect((await get(ids.priced)).lineItems[0].unitPrice).toBe(2)
  })

  test('changing the supplier while the supplier\'s list is not what the order was priced from keeps typed prices (nothing was locked)', async () => {
    const id = await fresh()
    await call('mgr', 'PUT', `/api/materials/${id}`, { lineItems: [{ description: 'Shingles', qty: 5, unit: 'bundle', unitPrice: 33 }] })
    await call('mgr', 'PUT', `/api/materials/${id}`, { supplier: 'Beacon' })
    expect((await get(id)).lineItems[0].unitPrice).toBe(33)
  })

  test('only the right supplier\'s list, a list that exists, and an order that has not gone out can be priced from', async () => {
    const id = await fresh({ supplier: 'SRS Distribution' })
    const wrong = await call('mgr', 'POST', `/api/material-supply/orders/${id}/price`, { priceListId: ids.list })
    expect([wrong.status, wrong.body.code]).toEqual([409, 'wrong_supplier'])
    const none = await call('mgr', 'POST', `/api/material-supply/orders/${await fresh({ supplier: 'Smith Yard' })}/price`, {})
    expect([none.status, none.body.code]).toEqual([404, 'no_price_list'])
    expect((await call('mgr', 'POST', `/api/material-supply/orders/${id}/price`, { priceListId: 'nope' })).status).toBe(404)
    const sent = await raw(jobId, 'sent', 100, { priceListId: ids.list })
    const gone = await call('mgr', 'POST', `/api/material-supply/orders/${sent.id}/price`, {})
    expect([gone.status, gone.body.code]).toEqual([409, 'order_not_editable'])
    const swap = await call('mgr', 'PUT', `/api/materials/${sent.id}`, { supplier: 'SRS Distribution' })
    expect([swap.status, swap.body.code]).toEqual([409, 'supplier_locked'])
    expect((await call('mgr', 'POST', '/api/material-supply/orders/nope/price', {})).status).toBe(404)
  })

  test('taking the pricing off, and deleting the list, unlock the order without losing what it was given', async () => {
    const id = await fresh()
    await call('mgr', 'POST', `/api/material-supply/orders/${id}/price`, {})
    const off = await call('mgr', 'DELETE', `/api/material-supply/orders/${id}/price`)
    expect(off.status).toBe(200)
    const o = await get(id)
    expect([o.priceListId, o.totalCost]).toEqual([null, '0.00'])
    const other = await fresh()
    await call('mgr', 'POST', `/api/material-supply/orders/${other}/price`, {})
    expect((await call('mgr', 'DELETE', `/api/material-supply/price-lists/${ids.list}`)).status).toBe(204)
    const kept = await get(other)
    expect(kept.priceListId).toBeNull()
    expect(kept.totalCost).toBe('4198.50')
    expect(kept.lineItems[0].unitPrice).toBe(41.5)
  })

  test('who may price: inventory:update; the reply carries no prices to a seat that may not see costs', async () => {
    const lst = await list({ name: 'Again' })
    const id = await fresh()
    expect((await call('view', 'POST', `/api/material-supply/orders/${id}/price`, {})).status).toBe(403)
    const priced = await call('mgr', 'POST', `/api/material-supply/orders/${id}/price`, { priceListId: lst.body.id })
    expect(priced.body.order.totalCost).toBe('4198.50')
    // The buyer may price an order (inventory:update) but is told no prices and cannot read the lists.
    const other = await fresh()
    const blind = await call('buyer', 'POST', `/api/material-supply/orders/${other}/price`, {})
    expect(blind.status).toBe(200)
    expect(blind.body.pricedLines).toBe(2)
    expect(blind.body.order.totalCost).toBeUndefined()
    expect(blind.body.order.lineItems.every((l: any) => l.unitPrice === undefined && l.total === undefined)).toBe(true)
    expect((await call('buyer', 'GET', '/api/material-supply/price-lists')).status).toBe(403)
    const off = await call('buyer', 'DELETE', `/api/material-supply/orders/${other}/price`)
    expect(off.status).toBe(200)
    expect(off.body.totalCost).toBeUndefined()
  })
})
