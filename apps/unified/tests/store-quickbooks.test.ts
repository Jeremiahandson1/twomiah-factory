// Gap 6 against Shopify's QuickBooks connector (2026-10-30): the store's paid orders, refunds and Stripe payouts in
// QuickBooks (server/crm/store/books.ts, a pass in the shared sweep), against the stand-ins for QuickBooks Online
// (tests/qboMock.ts) and for Stripe (tests/storeKit.ts). Nothing reaches the internet; the clock is the machine's.
//   · QuickBooks is OFFERED to the store as opt-in: not in a new shop's starting set, 403 until the owner turns it on;
//   · a paid order becomes one sales receipt (items, shipping, tax, the discount, a gift card paid with) — once — and an
//     unfinished checkout becomes nothing;
//   · a refund becomes one refund receipt, by item or by amount;
//   · a Stripe payout becomes ONE deposit, made of the receipts in it less Stripe's fees as their own line, so its total
//     is exactly the amount the bank shows; a payout whose parts do not add up is refused with the difference;
//   · with two bank accounts in QuickBooks the owner chooses one (settings:update; the staff seat is refused);
//   · a record QuickBooks refuses is kept in QuickBooks' own words and sent when the cause is fixed.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { createQboMock } from './qboMock.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
const qbo = createQboMock()
const BOOKS = '/api/admin/store-books'
const ON = ['dashboard', 'orders', 'products', 'contacts', 'quickbooks']
const db = () => k.t.db as any
const sweep = () => (k.t.services.crm as any).quickbooksSync
const run = () => sweep().syncCompany(k.companyId, 'manual') as Promise<any>
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const nowSec = () => Math.floor(Date.now() / 1000)
const receiptOf = async (number: string) => (await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.orderNumber, number)))[0]
const failures = async () => (await db().select().from(k.S.qbSyncFailure).where(eq(k.S.qbSyncFailure.companyId, k.companyId))) as any[]

let ann: any
let mug: any
let card: any
let orderA: any
let orderB: any
let seq = 0
/** A paid order of the lines given: [product, qty, unit price]. */
async function order(number: string, o: { who?: any; lines: Array<[any, number, number]>; shipping?: number; tax?: number; discount?: number; total: number; gift?: number; pi?: string; status?: string; paid?: boolean }) {
  const who = o.who ?? ann
  const subtotal = o.lines.reduce((n, [, q, p]) => n + q * p, 0)
  const [row] = await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: o.paid === false ? null : number, provider: 'stripe', providerSessionId: `cs_books_${++seq}`, providerPaymentId: o.pi ?? null,
    status: o.status ?? 'paid', customerEmail: who.email, customerName: who.name, subtotalCents: subtotal, shippingCents: o.shipping ?? 0, taxCents: o.tax ?? 0, discountCents: o.discount ?? 0,
    discountCode: o.discount ? 'SAVE' : null, totalCents: o.total, giftCardId: o.gift ? 'gc_test' : null, giftCardCents: o.gift ?? 0,
  }).returning()
  for (const [p, qty, price] of o.lines) {
    await db().insert(k.S.storeOrderItem).values({ orderId: row.id, productId: p.product.id, variantId: p.variant.id, productName: p.product.name, variantName: 'Default', sku: `${p.variant.sku}-${seq}`, unitPriceCents: price, quantity: qty, lineTotalCents: qty * price })
  }
  return row
}
/** A balance transaction as Stripe reports it for a payout. */
const txn = (n: number, type: string, gross: number, fee: number, source: Record<string, unknown> | null) => ({ id: `txn_${n}`, object: 'balance_transaction', type, amount: gross, fee, net: gross - fee, currency: 'usd', description: null, source })
const payout = (id: string, amount: number, lines: any[]) => {
  k.stripe.payouts.push({ id, object: 'payout', amount, currency: 'usd', status: 'paid', arrival_date: nowSec() - 3600 })
  k.stripe.balance.set(id, lines)
}

const realFetch = globalThis.fetch
beforeAll(async () => {
  k = await bootStore()
  // QuickBooks' addresses answer from the stand-in; Stripe's from the store kit's; anything else as the kit had it.
  const before = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const host = new URL(String(input?.url ?? input)).hostname
    return host.endsWith('intuit.com') ? qbo.fetch(input, init) : before(input, init)
  }) as any
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000 })
  card = await k.product({ slug: 'gift-card', name: 'Gift card', sku: 'GC-25', priceCents: 2500, kind: 'gift_card' })
  ;[ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Able', email: 'ann@example.com', type: 'customer' }).returning()
  await k.t.services.crm.quickbooks.saveConnection(k.companyId, { accessToken: 'access-1', refreshToken: 'refresh-1', realmId: '9130', expiresIn: 3600 })
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch; k.restore() })

describe('offered, never switched on', () => {
  test('QuickBooks is offered to the store as opt-in: not in a starting set; refused until the owner turns it on', async () => {
    expect(FEATURE_MAP.quickbooks.templates).toContain('crm-store')
    expect(FEATURE_MAP.quickbooks.optIn).toContain('crm-store')
    expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('quickbooks')
    await features(['dashboard', 'orders', 'products', 'contacts'])
    const off = await k.O('GET', BOOKS)
    expect(off.status).toBe(403)
    expect(off.json.code).toBe('FEATURE_NOT_ENABLED')
    await features(ON)
    expect((await k.O('GET', BOOKS)).status).toBe(200)
  })

  test('a seat without settings:update is refused by the server, whatever the switch says', async () => {
    expect((await k.ST('GET', BOOKS)).status).toBe(403)
    expect((await k.ST('PUT', BOOKS, { bankAccountId: '1' })).status).toBe(403)
    expect((await k.ST('GET', `${BOOKS}/bank-accounts`)).status).toBe(403)
  })
})

describe('a paid order is one sales receipt', () => {
  test('items, shipping, tax, the discount and a gift card paid with are lines; an unfinished checkout is nothing; nothing twice', async () => {
    // 2 mugs 40.00 + shipping 5.00 + tax 3.30 − discount 4.00 = 44.30
    orderA = await order('S-1', { lines: [[mug, 2, 2000]], shipping: 500, tax: 330, discount: 400, total: 4430, pi: 'pi_A' })
    // A gift card (25.00) and a mug (20.00) = 45.00, 10.00 of it paid with another gift card: 35.00 on the card.
    orderB = await order('S-2', { lines: [[card, 1, 2500], [mug, 1, 2000]], total: 4500, gift: 1000, pi: 'pi_B' })
    await order('S-3', { lines: [[mug, 1, 2000]], total: 2000, status: 'pending', paid: false })
    // An abandoned checkout the shop cancelled: it has a number but no money was ever taken. It is not a sale.
    await order('S-4', { lines: [[mug, 1, 2000]], total: 2000, status: 'cancelled' })

    const first = await run()
    expect(first).toMatchObject({ status: 'ok', orders: 2, refunds: 0, failed: 0 })
    expect(qbo.salesReceipts.size).toBe(2)
    const [a, b] = [...qbo.salesReceipts.values()]
    expect(a).toMatchObject({ DocNumber: 'S-1', TotalAmt: 44.3 })
    expect(a.Line.map((l: any) => [l.Description, l.Amount])).toEqual([['Mug', 40], ['Shipping', 5], ['Sales tax', 3.3], ['Discount (SAVE)', -4]])
    expect(b).toMatchObject({ DocNumber: 'S-2', TotalAmt: 35 })
    expect(b.Line.map((l: any) => [l.Description, l.Amount]).sort()).toEqual([['Gift card', 25], ['Mug', 20], ['Paid with a gift card', -10]])
    // The customer is the shopper's own, already in QuickBooks; the money waits in Undeposited Funds.
    expect([...qbo.customers.values()].map((c) => c.DisplayName)).toEqual(['Ann Able'])
    expect(a.CustomerRef.value).toBe([...qbo.customers.values()][0].Id)
    expect(qbo.accounts.get(a.DepositToAccountRef.value)?.Name).toBe('Undeposited Funds')
    // Gift cards sold are a liability, not takings; tax collected is owed.
    const itemOf = (l: any) => qbo.items.get(l.SalesItemLineDetail.ItemRef.value)!
    expect(qbo.accounts.get(itemOf(b.Line.find((l: any) => l.Description === 'Gift card')).IncomeAccountRef.value)?.AccountType).toBe('Other Current Liability')
    expect(qbo.accounts.get(itemOf(a.Line[2]).IncomeAccountRef.value)?.Name).toBe('Online store sales tax')
    expect((await receiptOf('S-1')).qbSalesReceiptId).toBe(a.Id)

    const writes = qbo.writes().length
    expect(await run()).toMatchObject({ status: 'ok', orders: 0, failed: 0 })
    expect(qbo.writes().length).toBe(writes)
  })
})

describe('a refund is one refund receipt', () => {
  test('by item, and by an amount; each once', async () => {
    const items = await db().select().from(k.S.storeOrderItem).where(eq(k.S.storeOrderItem.orderId, orderA.id))
    const r1 = await k.O('POST', `/api/admin/orders/${orderA.id}/refunds`, { items: [{ orderItemId: items[0].id, quantity: 1 }], restock: true, reason: 'Arrived chipped' })
    expect(r1.status).toBe(200)
    const r2 = await k.O('POST', `/api/admin/orders/${orderA.id}/refunds`, { items: [], amountCents: 300, reason: 'Late, a little back' })
    expect(r2.status).toBe(200)

    const rows = await db().select().from(k.S.storeOrderRefund).where(eq(k.S.storeOrderRefund.orderId, orderA.id))
    const byItem = rows.find((r: any) => r.reason === 'Arrived chipped')
    const done = await run()
    expect(done).toMatchObject({ status: 'ok', orders: 0, refunds: 2, failed: 0 })
    const receipts = [...qbo.refundReceipts.values()]
    expect(receipts.map((r) => r.DocNumber)).toEqual(['S-1-R1', 'S-1-R2'])
    // The mug at its price, then the tax that was on it and the discount it had: the receipt is what went back to the card.
    expect(receipts[0].Line[0]).toMatchObject({ Description: 'Mug', Amount: 20 })
    expect(receipts[0].TotalAmt).toBe(byItem.amountCents / 100)
    expect(receipts[0].Line.slice(1).map((l: any) => l.Description)).toEqual(['Sales tax', 'Discount on the refunded items'])
    expect(receipts[1]).toMatchObject({ TotalAmt: 3 })
    expect(receipts[1].Line[0].Description).toBe('Late, a little back')
    expect(qbo.accounts.get(receipts[0].RefundFromAccountRef.value)?.Name).toBe('Undeposited Funds')
    const writes = qbo.writes().length
    expect(await run()).toMatchObject({ refunds: 0 })
    expect(qbo.writes().length).toBe(writes)
  })
})

describe('a Stripe payout is one deposit that matches the bank', () => {
  test('two bank accounts: nothing is guessed — the owner chooses (settings:update), then the payout is booked there', async () => {
    const refunds = await db().select().from(k.S.storeOrderRefund).where(eq(k.S.storeOrderRefund.orderId, orderA.id))
    const byItem = refunds.find((r: any) => r.reason === 'Arrived chipped')
    const byAmount = refunds.find((r: any) => r.reason === 'Late, a little back')
    expect(byItem.providerRefundId).toBeTruthy()
    // Two sales (44.30 and 35.00 charged, fees 1.58 and 1.32) and the two refunds (no fee), as Stripe reports them:
    //   4430 − 158 = 4272;  3500 − 132 = 3368;  the refunds come off.
    const netCents = 4272 + 3368 - byItem.amountCents - byAmount.amountCents
    payout('po_1', netCents, [
      txn(1, 'charge', 4430, 158, { id: 'ch_A', object: 'charge', payment_intent: 'pi_A' }),
      txn(2, 'charge', 3500, 132, { id: 'ch_B', object: 'charge', payment_intent: 'pi_B' }),
      txn(3, 'refund', -byItem.amountCents, 0, { id: byItem.providerRefundId, object: 'refund', payment_intent: 'pi_A' }),
      txn(4, 'refund', -byAmount.amountCents, 0, { id: byAmount.providerRefundId, object: 'refund', payment_intent: 'pi_A' }),
    ])
    qbo.addBank('Savings')
    const held = await run()
    expect(held).toMatchObject({ status: 'partial', payouts: 0, failed: 1 })
    expect(qbo.deposits.size).toBe(0)
    const f = (await failures()).find((x) => x.entity === 'payout')
    expect(f.lastError).toContain('Choose the bank account')

    const banks = (await k.O('GET', `${BOOKS}/bank-accounts`)).json.accounts
    expect(banks.map((b: any) => b.name).sort()).toEqual(['Checking', 'Savings'])
    expect((await k.O('PUT', BOOKS, { bankAccountId: 'not-a-bank' })).status).toBe(400)
    const checking = banks.find((b: any) => b.name === 'Checking')
    expect((await k.O('PUT', BOOKS, { bankAccountId: checking.id })).json.bankAccount).toEqual({ id: checking.id, name: 'Checking' })

    const booked = await run()
    expect(booked).toMatchObject({ status: 'ok', payouts: 1, failed: 0 })
    expect((await failures()).filter((x) => x.entity === 'payout')).toEqual([])
    const [dep] = [...qbo.deposits.values()]
    // The deposit IS the payout: the same amount in QuickBooks as on the bank statement.
    expect(dep.TotalAmt).toBe(netCents / 100)
    expect(dep.DepositToAccountRef.value).toBe(checking.id)
    expect(dep.PrivateNote).toBe('Stripe payout po_1')
    expect(dep.Line.map((l: any) => [l.LinkedTxn?.[0]?.TxnType ?? l.Description, l.Amount])).toEqual([['SalesReceipt', 44.3], ['SalesReceipt', 35], ['RefundReceipt', -byItem.amountCents / 100], ['RefundReceipt', -3], ['Stripe fees', -2.9]])
    const feeLine = dep.Line.find((l: any) => l.Description === 'Stripe fees')
    expect(qbo.accounts.get(feeLine.DepositLineDetail.AccountRef.value)).toMatchObject({ Name: 'Stripe fees', AccountType: 'Expense' })
    const [stored] = await db().select().from(k.S.storePayout).where(eq(k.S.storePayout.providerPayoutId, 'po_1'))
    expect(stored).toMatchObject({ amountCents: netCents, feeCents: 290, qbDepositId: dep.Id })

    const writes = qbo.writes().length
    expect(await run()).toMatchObject({ payouts: 0, failed: 0 })
    expect(qbo.writes().length).toBe(writes)
    // The owner reads it on the card.
    const shown = (await k.O('GET', BOOKS)).json
    expect(shown.bankAccount.name).toBe('Checking')
    expect(shown.payouts.find((p: any) => p.id === 'po_1')).toMatchObject({ amountCents: netCents, feeCents: 290, booked: true })
  })

  test('a payout whose parts do not add up is not booked: it is refused with the difference', async () => {
    payout('po_2', 1000, [txn(1, 'charge', 900, 0, { id: 'ch_X', object: 'charge', payment_intent: 'pi_unknown' })])
    const before = qbo.deposits.size
    const r = await run()
    expect(r).toMatchObject({ status: 'partial', payouts: 0, failed: 1 })
    expect(qbo.deposits.size).toBe(before)
    const f = (await failures()).find((x) => x.entity === 'payout' && x.entityId === 'po_2')
    expect(f.lastError).toContain('add up to 9.00')
    expect(f.lastError).toContain('10.00')
    // Stripe's report catches up (the missing line arrives): the same payout is booked on the next try.
    k.stripe.balance.set('po_2', [txn(1, 'charge', 900, 0, { id: 'ch_X', object: 'charge', payment_intent: 'pi_unknown' }), txn(2, 'adjustment', 100, 0, null)])
    await sweep().retry(k.companyId, f.id)
    expect(await run()).toMatchObject({ payouts: 1, failed: 0 })
  })

  test("a dispute or a payment that is not one of the shop's orders is booked to its own account, named — the deposit still matches", async () => {
    payout('po_3', 4000, [
      txn(1, 'charge', 5000, 150, { id: 'ch_Z', object: 'charge', payment_intent: 'pi_elsewhere' }),
      txn(2, 'adjustment', -850, 0, { id: 'dp_1', object: 'dispute' }),
    ])
    expect(await run()).toMatchObject({ payouts: 1, failed: 0 })
    const dep = [...qbo.deposits.values()].find((d) => d.PrivateNote === 'Stripe payout po_3')!
    expect(dep.TotalAmt).toBe(40)
    const other = dep.Line.find((l: any) => /^Stripe: /.test(l.Description ?? ''))
    expect(other.Amount).toBe(41.5)
    expect(qbo.accounts.get(other.DepositLineDetail.AccountRef.value)?.Name).toBe('Stripe adjustments and disputes')
    expect(dep.Line.find((l: any) => l.Description === 'Stripe fees').Amount).toBe(-1.5)
  })
})

describe('a record QuickBooks refuses is kept in its words and sent once the cause is fixed', () => {
  test("an order for a shopper whose name QuickBooks already uses", async () => {
    qbo.customers.set('x1', { Id: 'x1', SyncToken: '0', DisplayName: 'Dee Dupe', Active: true })
    const [dee] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Dee Dupe', email: 'dee@example.com', type: 'customer' }).returning()
    const o = await order('S-9', { who: dee, lines: [[mug, 1, 2000]], total: 2000 })
    const r = await run()
    expect(r.status).toBe('partial')
    const f = (await failures()).find((x) => x.entity === 'order')
    expect(f).toMatchObject({ entityId: o.id, label: '#S-9' })
    expect(f.lastError).toContain('Duplicate Name Exists Error')
    expect((await receiptOf('S-9')).qbSalesReceiptId).toBeNull()

    await db().update(k.S.contact).set({ name: 'Dee Dupe-Shopper' }).where(eq(k.S.contact.id, dee.id))
    await sweep().retry(k.companyId, f.id)
    expect(await run()).toMatchObject({ status: 'ok', orders: 1, failed: 0 })
    expect((await receiptOf('S-9')).qbSalesReceiptId).toBeTruthy()
    expect((await failures()).filter((x) => x.entity === 'order')).toEqual([])
  })

  test('a revoked connection stops the run and says so; it is not one failure per order', async () => {
    await order('S-10', { lines: [[mug, 1, 2000]], total: 2000 })
    await order('S-11', { lines: [[mug, 1, 2000]], total: 2000 })
    qbo.revoke(true)
    const r = await run()
    qbo.revoke(false)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('not connected')
    expect((await failures()).filter((x) => x.entity === 'order')).toEqual([])
    expect(await run()).toMatchObject({ status: 'ok', orders: 2 })
  })
})

describe("the card's sync log", () => {
  test('counts the store\'s orders, refunds and payouts', async () => {
    const runs = (await db().select().from(k.S.qbSyncRun).where(eq(k.S.qbSyncRun.companyId, k.companyId))) as any[]
    const total = runs.reduce((n, r) => ({ orders: n.orders + r.orders, refunds: n.refunds + r.refunds, payouts: n.payouts + r.payouts }), { orders: 0, refunds: 0, payouts: 0 })
    expect(total).toEqual({ orders: 5, refunds: 2, payouts: 3 })
    // And the card reads them: the newest run says what went across.
    const shown = (await k.O('GET', '/api/qb-sync/log')).json
    expect(shown.runs[0]).toHaveProperty('orders')
    expect(shown.runs[0]).toHaveProperty('payouts')
  })
})
