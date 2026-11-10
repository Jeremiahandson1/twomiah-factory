// The store re-check (Chrome, 2026-11-10):
//   · a cash order's refund said "goes back to the card they paid with" — the return now knows how the order was paid;
//   · Post-purchase emails named no order: it now lists what is coming up and when;
//   · a refund made by a return read "not restocked" though the return put the stock back;
//   · the low-stock email is one a day (by design) — the Running low list says so;
//   · the cart's totals follow a quantity change once Apply was pressed; QuickBooks' last step speaks of orders.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const DAY = 86_400_000
const db = () => k.t.db as any
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await db().update(k.S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts', 'email_marketing', 'store_followups'] }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}, 120_000)
afterAll(() => k.restore())

test('Post-purchase emails lists the orders coming up, soonest first, and not one already sent', async () => {
  const [ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Shopper', email: 'ann@example.com', type: 'customer' }).returning()
  const [bob] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Bob Shopper', email: 'bob@example.com', type: 'customer' }).returning()
  const mk = async (who: any, number: string, fulfilledDaysAgo: number) => (await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: number, provider: 'in_person', providerSessionId: `p_${number}`, status: 'fulfilled',
    customerEmail: who.email, subtotalCents: 3000, totalCents: 3000, createdAt: new Date(Date.now() - (fulfilledDaysAgo + 1) * DAY), fulfilledAt: new Date(Date.now() - fulfilledDaysAgo * DAY),
  }).returning())[0]
  const a = await mk(ann, 'ORD-ANN', 0)
  const b = await mk(bob, 'ORD-BOB', 1)
  expect((await k.O('PUT', '/api/admin/followups', { firstOrder: { on: true, days: 3 } })).status).toBe(200)
  // Bob's has gone already.
  await db().insert(k.S.marketingAutomationSend).values({ companyId: k.companyId, contactId: bob.id, kind: 'store_first_order', marker: b.id, status: 'sent' })
  const r = await k.O('GET', '/api/admin/followups')
  expect(r.status).toBe(200)
  const list = r.json.comingUp as any[]
  expect(list.map((c) => [c.orderNumber, c.customer, c.kind, c.arrivedMarked])).toEqual([['ORD-ANN', 'Ann Shopper', 'store_first_order', false]])
  // Fulfilled today, counted as arrived 5 days on, then 3 days: 8 days from now.
  expect(Math.round((new Date(list[0].sendOn).getTime() - Date.now()) / DAY)).toBe(8)
  expect(a.id).toBe(list[0].orderId)
})

test("a return knows how its order was paid; the screens say where the money goes", () => {
  expect(src('../server/crm/store/returns/returns.ts')).toContain("paidBy: !order.providerPaymentId ? (order.provider === 'giftcard' ? 'gift_card' : 'in_person') : 'card'")
  const page = src('../web/src/crm/pages/store/orders/ReturnsPage.tsx')
  expect(page).toContain("in_person: 'is recorded here — they paid in person, so give it back the same way (cash, check or your own terminal).'")
  expect(page).toContain('{REST_TO[ret.order?.paidBy ?? \'card\']}')
  expect(src('../web/src/crm/pages/store/orders/OrderDetailPage.tsx')).toContain("' · stock: as the return was received'")
  // …and the shopper's own account (store re-check 2): their return says where the money goes by how they paid.
  expect(src('../server/crm/store/returns/returns.ts')).toContain("paidBy: d2.order?.paidBy ?? 'card',")
  expect(src('../site/public/scripts/account.ts')).toContain("r.paidBy === 'in_person' ? ' back to you, the way you paid'")
})

test('the low-stock list says the email is daily; QuickBooks speaks of orders; the cart re-prices itself', () => {
  expect(src('../web/src/crm/pages/store/catalog/ProductsPage.tsx')).toContain('The low-stock email is one summary a day, from 8 am')
  expect(src('../verticals/store/settings.ts')).toContain("quickbooksSends: 'each paid order, refund and payout'")
  expect(src('../../../packages/tenant-ui/src/settings/IntegrationsPage.tsx')).toContain('(copy as any).quickbooksSends')
  const cart = src('../site/public/scripts/cart.ts')
  expect(cart).toContain('if (wantQuote && !quoteBusy && quoteKey !== keyOf(cart) && lastTriedKey !== keyOf(cart)) setTimeout(applyDiscount, 0);')
})
