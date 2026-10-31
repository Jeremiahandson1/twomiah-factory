// Parity row 3 against Shopify Email's automations (2026-10-31): the store's post-purchase emails — a first-order email, a
// thank-you with products to go with the order, and a reminder to reorder consumables — each N days after the order ARRIVES.
//   · off by default: a shop that has not switched them on sends nothing, whatever has been delivered;
//   · the days are the owner's; an order counts from when it was marked delivered (or picked up), else from a few days after it
//     shipped; only orders whose day fell in the last 14 days are sent to (switching an email on mails no one from last year);
//   · once per customer per order — a second sweep sends nothing; the FIRST-order email is for a customer's first sale only;
//   · never to someone who unsubscribed, never with Email Marketing off; an order refunded in full is left alone;
//   · the thank-you carries products to go with what was bought (the owner's picks, else the category), never one already bought;
//   · the reorder reminder is per product (Reorder reminder, in days), and not sent to someone who has bought it again;
//   · the owner can limit the emails to a saved segment, which then cannot be removed while it is used;
//   · marking an order delivered stamps the day the days count from; the screen's API is behind store_followups and marketing:*.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createFollowups } from '../server/crm/store/followups/followups.ts'

let k: Awaited<ReturnType<typeof bootStore>>
let followups: ReturnType<typeof createFollowups>
const F = '/api/admin/followups'
const BASE = ['dashboard', 'orders', 'products', 'contacts', 'email_marketing']
const ON = [...BASE, 'store_followups', 'store_segments']
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const db = () => k.t.db as any
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const owner = (m: string, p: string, b?: unknown) => k.as('owner')(m, p, b)
const logFor = async (email: string) => (await db().select().from(k.S.emailLog).where(eq(k.S.emailLog.to, email))) as any[]
let feeder: any, seed: any, treats: any, n = 0

async function person(name: string, extra: Record<string, unknown> = {}) {
  const [c] = await db().insert(k.S.contact).values({ companyId: k.companyId, name, email: `${name.toLowerCase()}@example.com`, type: 'customer', ...extra }).returning()
  return c as { id: string; email: string }
}
/** An order that reached the customer `arrivedDaysAgo` days ago (marked delivered), unless `shippedOnly` (then it went out that long ago). */
async function order(who: { id: string; email: string }, lines: any[], o: { arrivedDaysAgo: number; status?: string; shippedOnly?: boolean; refunded?: boolean; createdAgo?: number; extra?: Record<string, unknown> }) {
  n++
  const when = ago(o.arrivedDaysAgo)
  const [row] = await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: `FU-${n}`, provider: 'stripe', providerSessionId: `cs_fu_${n}`, status: o.status ?? (o.shippedOnly ? 'shipped' : 'delivered'),
    customerEmail: who.email, subtotalCents: 3000, totalCents: 3000, refundedCents: o.refunded ? 3000 : 0, createdAt: ago(o.createdAgo ?? o.arrivedDaysAgo + 4),
    ...(o.shippedOnly ? { fulfilledAt: when } : { fulfilledAt: ago(o.arrivedDaysAgo + 2), deliveredAt: when }), ...(o.extra ?? {}),
  }).returning()
  for (const p of lines) await db().insert(k.S.storeOrderItem).values({ orderId: row.id, productId: p.id, productName: p.name, variantName: 'Default', sku: `F${n}`, unitPriceCents: 1500, quantity: 1, lineTotalCents: 1500, refundedQuantity: 0 })
  return row
}
const settings = (patch: Record<string, unknown>) => owner('PUT', F, patch)

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  feeder = (await k.product({ slug: 'feeder', name: 'Window feeder', sku: 'FEED-1', priceCents: 1500, category: 'Feeders' })).product
  seed = (await k.product({ slug: 'seed', name: 'Seed mix', sku: 'SEED-1', priceCents: 2000, category: 'Seed' })).product
  treats = (await k.product({ slug: 'treats', name: 'Suet treats', sku: 'SUET-1', priceCents: 900, category: 'Treats' })).product
  // The owner's pick to go with the feeder is the seed; the treats are in their own category.
  await db().update(k.S.storeProduct).set({ alsoLikeIds: [seed.id] }).where(eq(k.S.storeProduct.id, feeder.id))
  const deps: any = { db: k.t.db, audit: k.t.services.audit, logger: { info() {}, warn() {}, error() {} }, permissions: k.t.services.permissions, features: k.t.services.features, services: k.t.services.crm }
  followups = createFollowups(deps, createStoreCore(deps))
  await features(ON)
}, 120_000)
afterAll(() => k.restore())

describe('post-purchase emails', () => {
  test('are registered not ready: offered to the store, switched on by no plan', () => {
    expect(FEATURE_MAP.store_followups.hidden).toBe(true)
    expect(FEATURE_MAP.store_followups.templates).toEqual(['crm-store'])
  })

  test('off by default: delivered orders send nothing until the owner switches an email on', async () => {
    const quiet = await person('Quiet')
    await order(quiet, [feeder], { arrivedDaysAgo: 4 })
    const got = await owner('GET', F)
    expect(got.status).toBe(200)
    expect(got.json).toMatchObject({ firstOrder: { on: false, days: 3 }, crossSell: { on: false, days: 14 }, replenish: { on: false }, sent: { firstOrder: 0, crossSell: 0, replenish: 0 } })
    expect(await followups.sweep()).toMatchObject({ first_order: 0, cross_sell: 0, replenish: 0 })
    expect(await logFor('quiet@example.com')).toHaveLength(0)
  })

  test('first-order email: N days after the first order arrives, once, only for a first sale', async () => {
    expect((await settings({ firstOrder: { on: true, days: 3, subject: 'How is the feeder, {{firstName}}?' } })).status).toBe(200)
    const ada = await person('Ada'), bo = await person('Bo'), cy = await person('Cy'), di = await person('Di'), ed = await person('Ed')
    await order(ada, [feeder], { arrivedDaysAgo: 4 })                          // due: sent
    await order(bo, [feeder], { arrivedDaysAgo: 1 })                           // not yet
    await order(cy, [feeder], { arrivedDaysAgo: 40 })                          // long past: not mailed on switching it on
    await order(di, [feeder], { arrivedDaysAgo: 30, createdAgo: 34 })          // Di's first order (long ago) ...
    await order(di, [seed], { arrivedDaysAgo: 4 })                             // ... so this one is not her first
    await order(ed, [feeder], { arrivedDaysAgo: 9, shippedOnly: true })        // never marked delivered: counts 5 days after it went out (4 days ago)
    const out = await followups.sweep()
    expect(out.first_order).toBe(3) // Quiet (4 days), Ada, Ed
    const mails = await logFor('ada@example.com')
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('How is the feeder, Ada?')
    for (const e of ['bo', 'cy', 'di']) expect(await logFor(`${e}@example.com`)).toHaveLength(0)
    expect(await logFor('ed@example.com')).toHaveLength(1)
    // A second sweep, and a third, send nothing more.
    expect((await followups.sweep()).first_order).toBe(0)
    expect(await logFor('ada@example.com')).toHaveLength(1)
    expect((await owner('GET', F)).json.sent.firstOrder).toBe(3)
  })

  test('never to someone who unsubscribed, never with Email Marketing off, never for an order refunded in full', async () => {
    const out = await person('Opt', { emailOptOut: true }), gone = await person('Gone'), off = await person('Offy')
    await order(out, [feeder], { arrivedDaysAgo: 4 })
    await order(gone, [feeder], { arrivedDaysAgo: 4, refunded: true, status: 'refunded' })
    await order(off, [feeder], { arrivedDaysAgo: 4 })
    await features([...ON].filter((f) => f !== 'email_marketing'))
    expect((await followups.sweep()).first_order).toBe(0)
    await features(ON)
    expect((await followups.sweep()).first_order).toBe(1) // only Offy: now that Email Marketing is back
    expect(await logFor('opt@example.com')).toHaveLength(0)
    expect(await logFor('gone@example.com')).toHaveLength(0)
    expect(await logFor('offy@example.com')).toHaveLength(1)
    await settings({ firstOrder: { on: false } })
  })

  test('the shared sender itself refuses an unsubscribed customer and Email Marketing being off, and sends each claim once', async () => {
    const m = (k.t.services.crm as any).marketing
    const quiet = await person('Hush', { emailOptOut: true }), fine = await person('Fine')
    expect(await m.sendClaimed(k.companyId, quiet.id, 'store_cross_sell', 'x1', 'Hello', '<p>Hi</p>')).toBe('skipped')
    expect(await m.sendClaimed(k.companyId, fine.id, 'store_cross_sell', 'x1', 'Hello', '<p>Hi</p>')).toBe('sent')
    expect(await m.sendClaimed(k.companyId, fine.id, 'store_cross_sell', 'x1', 'Hello', '<p>Hi</p>')).toBe('already')
    expect(await m.sendClaimed(k.companyId, fine.id, 'store_cross_sell', 'x2', 'Hello', '<p>Hi</p>')).toBe('sent') // another order: another email
    await features(BASE.filter((f) => f !== 'email_marketing'))
    expect(await m.sendClaimed(k.companyId, fine.id, 'store_cross_sell', 'x3', 'Hello', '<p>Hi</p>')).toBe('off')
    await features(ON)
    expect(await logFor('hush@example.com')).toHaveLength(0)
    expect(await logFor('fine@example.com')).toHaveLength(2)
  })

  test('thank-you: carries the owner\'s picks as links, never a product already bought; the first-order email is separate', async () => {
    expect((await settings({ crossSell: { on: true, days: 7 } })).status).toBe(200)
    process.env.SITE_URL = 'https://shop.example.test'
    const fran = await person('Fran'), gil = await person('Gil')
    await order(fran, [feeder], { arrivedDaysAgo: 8 })
    const old = await order(gil, [seed], { arrivedDaysAgo: 40, createdAgo: 44 }) // Gil already owns the seed ...
    await order(gil, [feeder], { arrivedDaysAgo: 8 })                          // ... so the feeder's pick (seed) is not offered; the category is
    const out = await followups.sweep()
    expect(out.cross_sell).toBe(2)
    const [a] = await logFor('fran@example.com')
    expect(a.body).toContain('https://shop.example.test/product/seed')
    expect(a.body).toContain('Seed mix')
    const [b] = await logFor('gil@example.com')
    expect(b.body).not.toContain('/product/seed')
    expect(old.id).toBeTruthy()
    expect((await followups.sweep()).cross_sell).toBe(0)
    await settings({ crossSell: { on: false } })
  })

  test('reorder reminder: per product, N days after arrival; not once they have bought it again; not outside the window', async () => {
    expect((await owner('PATCH', `/api/admin/products/${treats.id}`, { replenishAfterDays: 30 })).status).toBe(200)
    expect((await owner('GET', `/api/admin/products/${treats.id}`)).json.replenishAfterDays).toBe(30)
    expect((await settings({ replenish: { on: true } })).status).toBe(200)
    const hal = await person('Hal'), ivy = await person('Ivy'), jo = await person('Jo'), kim = await person('Kim')
    await order(hal, [treats], { arrivedDaysAgo: 34 })                         // due 4 days ago: sent
    await order(ivy, [treats], { arrivedDaysAgo: 34 })                         // bought them again since ...
    await order(ivy, [treats], { arrivedDaysAgo: 10 })                         // ... so no nudge for the first order (the second is not due yet)
    await order(jo, [treats], { arrivedDaysAgo: 20 })                          // not yet
    await order(kim, [treats], { arrivedDaysAgo: 70 })                         // due 40 days ago: outside the window
    const out = await followups.sweep()
    expect(out.replenish).toBe(1)
    const [mail] = await logFor('hal@example.com')
    expect(mail.subject).toBe('Running low, Hal?')
    expect(mail.body).toContain('Suet treats')
    for (const e of ['ivy', 'jo', 'kim']) expect(await logFor(`${e}@example.com`)).toHaveLength(0)
    expect((await followups.sweep()).replenish).toBe(0)
  })

  test('limited to a saved segment: only its customers are mailed; the segment cannot be removed while it is used', async () => {
    const seg = await owner('POST', '/api/admin/segments', { name: 'Repeat buyers', definition: { orders: { min: 2 } } })
    expect(seg.status).toBe(201)
    expect((await settings({ segmentId: seg.json.id, firstOrder: { on: true, days: 3 } })).status).toBe(200)
    const lee = await person('Lee'), max = await person('Max')
    await order(lee, [feeder], { arrivedDaysAgo: 4 })                          // one order: not in the segment
    await order(max, [seed], { arrivedDaysAgo: 40, createdAgo: 44 })
    await order(max, [feeder], { arrivedDaysAgo: 4 })                          // two orders: in it, but this is not her first order
    await followups.sweep()
    expect(await logFor('lee@example.com')).toHaveLength(0)
    expect(await logFor('max@example.com')).toHaveLength(0)
    const del = await owner('DELETE', `/api/admin/segments/${seg.json.id}`)
    expect(del.status).toBe(409)
    expect(del.json.error).toContain('post-purchase email setting')
    await settings({ segmentId: null, firstOrder: { on: false } })
    expect((await owner('DELETE', `/api/admin/segments/${seg.json.id}`)).status).toBe(204)
  })

  test('the settings refuse what cannot work; staff may look but not change; the screen is behind store_followups', async () => {
    expect((await settings({ firstOrder: { days: 0 } })).status).toBe(400)
    expect((await settings({ crossSell: { days: 500 } })).status).toBe(400)
    const bad = await settings({ crossSell: { subject: 'Hi {{nickname}}' } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toContain('{{nickname}}')
    expect((await settings({ segmentId: 'no-such-segment' })).status).toBe(400)
    expect((await k.as('staff')('PUT', F, { firstOrder: { on: true } })).status).toBe(403)
    expect((await k.as('manager')('GET', F)).status).toBe(200)
    await features(BASE)
    expect((await owner('GET', F)).status).toBe(403)
    expect((await followups.sweep()).off).toBe(true)
    await features(ON)
  })

  test('marking an order delivered stamps the day the follow-ups count from, once', async () => {
    const pat = await person('Pat')
    const o = await order(pat, [feeder], { arrivedDaysAgo: 0, status: 'shipped', shippedOnly: true })
    expect(o.deliveredAt).toBeNull()
    const moved = await owner('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'delivered' })
    expect(moved.status).toBe(200)
    const [after] = await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.id, o.id))
    expect(after.deliveredAt).not.toBeNull()
    const first = after.deliveredAt.getTime()
    await db().update(k.S.storeOrder).set({ status: 'shipped' }).where(eq(k.S.storeOrder.id, o.id))
    await owner('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'delivered' })
    const [again] = await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.id, o.id))
    expect(again.deliveredAt.getTime()).toBe(first)
  })
})
