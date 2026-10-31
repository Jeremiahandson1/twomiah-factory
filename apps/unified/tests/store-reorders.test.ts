// Parity row 4 against Shopify (2026-10-31): "Draft a reorder" — from what is running low, a purchase order per supplier with the
// low options, a suggested count (back up to the option's "order up to", else twice its low-stock level, less what is already
// on an order) and the supplier's cost; the owner edits it, emails it, and books what arrives against it.
//   · the figures are worked out by hand from fixed stock; an option with no supplier is shown apart, never ordered by guess;
//   · pressing "Draft" twice never orders the same shortfall twice (what is on an open order is taken off);
//   · only a DRAFT can be edited; sending needs an address; a sent order cannot be edited, and cannot be received twice over;
//   · received units go onto the shelf — a part delivery too — and an over-receipt is refused whole, changing nothing;
//   · costs are the shop's own: margin:read for everything here, products:update to change it; behind store_reorders;
//   · the daily low-stock email offers "Draft a reorder" only when the feature is on.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createLowStockDigest } from '../server/crm/store/lowStock.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const R = '/api/admin/reorders'
const BASE = ['dashboard', 'orders', 'products', 'contacts', 'store_low_stock']
const ON = [...BASE, 'store_reorders']
const db = () => k.t.db as any
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const owner = (m: string, p: string, b?: unknown) => k.as('owner')(m, p, b)
const stock = async (id: string) => (await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, id)))[0].inventoryQty as number | null
let feeder: any, seed: any, treats: any, plain: any, acme: any, birdco: any

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await db().update(k.S.company).set({ timezone: 'UTC', email: 'owner@shop.test' }).where(eq(k.S.company.id, k.companyId))
  const mk = async (slug: string, name: string, sku: string, qty: number | null) => (await k.product({ slug, name, sku, priceCents: 2000, qty }))
  feeder = (await mk('feeder', 'Window feeder', 'FEED-1', 2)).variant
  seed = (await mk('seed', 'Seed mix', 'SEED-1', 10)).variant
  treats = (await mk('treats', 'Suet treats', 'SUET-1', 1)).variant
  plain = (await mk('plain', 'Birdbath', 'BATH-1', 50)).variant
  await features(ON)
  acme = (await owner('POST', `${R}/suppliers`, { name: 'Acme Feeders', email: 'orders@acme.test' })).json
  birdco = (await owner('POST', `${R}/suppliers`, { name: 'BirdCo' })).json // no address yet
  const set = (v: any, body: Record<string, unknown>) => owner('PATCH', `/api/admin/products/variants/${v.id}`, body)
  await set(feeder, { lowStockAt: 5, costCents: 800, supplierId: acme.id })           // low: 2 of 5 → back up to 10 → order 8
  await set(seed, { lowStockAt: 10, costCents: 500, supplierId: birdco.id, reorderToQty: 40 }) // low: 10 of 10 → order up to 40 → 30
  await set(treats, { lowStockAt: 3, costCents: 250 })                                 // low, no supplier: shown apart
  await set(plain, { lowStockAt: 5, costCents: 100, supplierId: acme.id })             // not low
}, 120_000)
afterAll(() => k.restore())

describe('draft a reorder', () => {
  test('is registered not ready: offered to the store, switched on by no plan', () => {
    expect(FEATURE_MAP.store_reorders.hidden).toBe(true)
    expect(FEATURE_MAP.store_reorders.templates).toEqual(['crm-store'])
  })

  test('a supplier and an order-up-to count are the shop\'s own: a supplier of another shop, or the feature off, is refused', async () => {
    expect((await owner('PATCH', `/api/admin/products/variants/${plain.id}`, { supplierId: 'someone-elses' })).status).toBe(400)
    await features(BASE)
    expect((await owner('PATCH', `/api/admin/products/variants/${plain.id}`, { reorderToQty: 20 })).status).toBe(403)
    await features(ON)
  })

  test('suggestions: by supplier, back up to the target, at the supplier\'s cost; no supplier is shown apart', async () => {
    const got = await owner('GET', `${R}/suggestions`)
    expect(got.status).toBe(200)
    const byName = Object.fromEntries(got.json.groups.map((g: any) => [g.supplierName ?? 'none', g]))
    expect(byName['Acme Feeders'].lines).toHaveLength(1) // the birdbath is not low
    expect(byName['Acme Feeders'].lines[0]).toMatchObject({ sku: 'FEED-1', quantity: 2, lowStockAt: 5, suggested: 8, unitCostCents: 800 })
    expect(byName['Acme Feeders'].totalCents).toBe(6400)
    expect(byName['BirdCo'].lines[0]).toMatchObject({ sku: 'SEED-1', suggested: 30, unitCostCents: 500 })
    expect(byName['BirdCo'].totalCents).toBe(15000)
    expect(byName['none'].supplierId).toBeNull()
    expect(byName['none'].lines[0]).toMatchObject({ sku: 'SUET-1', suggested: 5 }) // twice its level (6) less the 1 left
  })

  let po: any, po2: any

  test('draft: a purchase order of the supplier\'s suggestions; pressing it again orders nothing twice', async () => {
    const made = await owner('POST', `${R}/draft`, { supplierId: acme.id })
    expect(made.status).toBe(201)
    po = made.json
    expect(po).toMatchObject({ number: 'PO-0001', status: 'draft', supplierName: 'Acme Feeders', totalCents: 6400 })
    expect(po.lines).toHaveLength(1)
    expect(po.lines[0]).toMatchObject({ sku: 'FEED-1', name: 'Window feeder', quantity: 8, unitCostCents: 800, receivedQuantity: 0 })
    // What is on the draft is taken off the suggestion: the same shortfall is not ordered twice.
    const again = await owner('POST', `${R}/draft`, { supplierId: acme.id })
    expect(again.status).toBe(409)
    expect(again.json.code).toBe('nothing_to_order')
    const after = await owner('GET', `${R}/suggestions`)
    expect(after.json.coveredByOpenOrders).toBe(1)
    expect(after.json.groups.map((g: any) => g.supplierName)).not.toContain('Acme Feeders')
    // An option with no supplier can be drafted onto one the owner picks, by naming it.
    const picked = await owner('POST', `${R}/draft`, { supplierId: birdco.id, variantIds: [treats.id, seed.id] })
    expect(picked.status).toBe(201)
    po2 = picked.json
    expect(po2.number).toBe('PO-0002')
    expect(po2.lines.map((l: any) => [l.sku, l.quantity]).sort()).toEqual([['SEED-1', 30], ['SUET-1', 5]])
  })

  test('edit a draft: counts and costs, a note, a day; a count of 0 drops the line; a day that is not a date is refused', async () => {
    const line = po2.lines.find((l: any) => l.sku === 'SUET-1')
    const edited = await owner('PUT', `${R}/${po2.id}`, { notes: 'Ship with the next pallet', expectedOn: '2026-11-12', lines: [{ id: line.id, quantity: 0, unitCostCents: 0 }, ...po2.lines.filter((l: any) => l.sku === 'SEED-1').map((l: any) => ({ id: l.id, quantity: 24, unitCostCents: 450 }))] })
    expect(edited.status).toBe(200)
    expect(edited.json.lines).toHaveLength(1)
    expect(edited.json).toMatchObject({ notes: 'Ship with the next pallet', expectedOn: '2026-11-12', totalCents: 24 * 450 })
    expect((await owner('PUT', `${R}/${po2.id}`, { expectedOn: 'next week' })).status).toBe(400)
    expect((await owner('PUT', `${R}/${po2.id}`, { supplierId: 'someone-elses' })).status).toBe(400)
  })

  test('send: needs an address (the supplier\'s or one typed); emails the order; then it can no longer be edited', async () => {
    const noAddress = await owner('POST', `${R}/${po2.id}/send`, {})
    expect(noAddress.status).toBe(400)
    expect(noAddress.json.code).toBe('no_recipient')
    expect((await owner('POST', `${R}/${po2.id}/send`, { to: 'not an address' })).status).toBe(400)
    const before = k.mails.length
    const sent = await owner('POST', `${R}/${po2.id}/send`, { to: 'sales@birdco.test' })
    expect(sent.status).toBe(200)
    expect(sent.json).toMatchObject({ status: 'sent', sentTo: 'sales@birdco.test' })
    const mail = k.mails.slice(before).find((m) => m.template === 'storePurchaseOrder')!
    expect(mail.to).toBe('sales@birdco.test')
    expect(mail.data).toMatchObject({ number: 'PO-0002', totalCents: 10800, notes: 'Ship with the next pallet' })
    expect(mail.data.lines[0]).toMatchObject({ sku: 'SEED-1', quantity: 24, unitCostCents: 450 })
    expect((await owner('PUT', `${R}/${po2.id}`, { notes: 'too late' })).status).toBe(409)
    expect((await owner('POST', `${R}/${po2.id}/send`, { to: 'sales@birdco.test' })).status).toBe(409)
    // The supplier's own address is used when none is typed.
    const own = await owner('POST', `${R}/${po.id}/send`, {})
    expect(own.status).toBe(200)
    expect(own.json.sentTo).toBe('orders@acme.test')
  })

  test('receive: a part delivery puts units on the shelf; too many is refused whole; the rest completes it; nothing is booked twice', async () => {
    const line = po.lines[0]
    expect(await stock(feeder.id)).toBe(2)
    expect((await owner('POST', `${R}/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 9 }] })).status).toBe(409) // 8 ordered
    expect(await stock(feeder.id)).toBe(2) // nothing changed
    const part = await owner('POST', `${R}/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 3 }] })
    expect(part.status).toBe(200)
    expect(part.json.status).toBe('partly_received')
    expect(part.json.lines[0].receivedQuantity).toBe(3)
    expect(await stock(feeder.id)).toBe(5)
    // Part-received counts as on order for the 5 still to come: 10 − 5 − 5 = 0, nothing more to draft.
    expect((await owner('POST', `${R}/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 6 }] })).status).toBe(409)
    const rest = await owner('POST', `${R}/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 5 }] })
    expect(rest.json.status).toBe('received')
    expect(await stock(feeder.id)).toBe(10)
    expect((await owner('POST', `${R}/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 1 }] })).status).toBe(409)
    expect(await stock(feeder.id)).toBe(10)
    // A draft cannot be received against.
    const draft = await owner('POST', `${R}/draft`, { supplierId: acme.id, variantIds: [plain.id] }) // plain is not low
    expect(draft.status).toBe(409)
  })

  test('cancel: a draft or a sent order with nothing in; never one with stock booked; a supplier with orders stays', async () => {
    expect((await owner('DELETE', `${R}/suppliers/${birdco.id}`)).status).toBe(409)
    expect((await owner('POST', `${R}/${po.id}/cancel`)).status).toBe(409)
    const cancelled = await owner('POST', `${R}/${po2.id}/cancel`)
    expect(cancelled.json.status).toBe('cancelled')
    expect((await owner('DELETE', `${R}/${po2.id}`)).status).toBe(404) // orders stay on record: a cancelled one is not deleted
    const lonely = (await owner('POST', `${R}/suppliers`, { name: 'Nobody Yet' })).json
    expect((await owner('DELETE', `${R}/suppliers/${lonely.id}`)).status).toBe(204)
  })

  test('numbers keep counting; a cancelled order\'s shortfall can be drafted again', async () => {
    const next = await owner('POST', `${R}/draft`, { supplierId: birdco.id }) // the seed (30) is low and no longer on an order
    expect(next.status).toBe(201)
    expect(next.json.number).toBe('PO-0003')
  })

  test('costs are the shop\'s own: staff are refused everything here; a manager may look and change', async () => {
    expect((await k.as('staff')('GET', `${R}/suggestions`)).status).toBe(403)
    expect((await k.as('staff')('GET', R)).status).toBe(403)
    expect((await k.as('manager')('GET', `${R}/suggestions`)).status).toBe(200)
    expect((await k.as('manager')('POST', `${R}/suppliers`, { name: 'Manager Co' })).status).toBe(201)
  })

  test('the screen is behind store_reorders', async () => {
    await features(BASE)
    expect((await owner('GET', `${R}/suggestions`)).status).toBe(403)
    await features(ON)
  })

  test('the daily low-stock email offers "Draft a reorder" only while the feature is on', async () => {
    const deps: any = { db: k.t.db, audit: k.t.services.audit, logger: { info() {}, warn() {}, error() {} }, permissions: k.t.services.permissions, features: k.t.services.features, services: k.t.services.crm }
    const digest = createLowStockDigest(deps, createStoreCore(deps))
    const noon = (day: number) => new Date(Date.UTC(2026, 9, day, 15, 0))
    const lowFeature = [...ON]
    await features(lowFeature)
    await digest.sweep(noon(20))
    const withIt = k.mails.filter((m) => m.template === 'storeLowStockDigest').pop()!
    expect(withIt.data.reorderUrl).toMatch(/\/crm\/reorders$/)
    await features(BASE)
    await digest.sweep(noon(21))
    const without = k.mails.filter((m) => m.template === 'storeLowStockDigest').pop()!
    expect(without).not.toBe(withIt)
    expect(without.data.reorderUrl).toBeUndefined()
    await features(ON)
  })
})
