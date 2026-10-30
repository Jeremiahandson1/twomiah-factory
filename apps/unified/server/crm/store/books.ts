// The store's books in QuickBooks (2026-10-30, store gap 6 against Shopify's QuickBooks connector). The shared QuickBooks
// sync sends customers, invoices and payments; a store has no invoices — its sales are paid orders — so this adds a pass
// to that same sweep (crm/office/quickbooksAutoSync.ts addPass), with the same failure record, backoff and sync log:
//
//   · every paid order → one SALES RECEIPT (the shopper as the customer; items, shipping, tax, the discount and any gift
//     card the shopper paid with as their own lines), put in Undeposited Funds;
//   · every refund → one REFUND RECEIPT against the same customer;
//   · every Stripe PAYOUT that has reached the bank → one DEPOSIT into the owner's bank account, made of the sales
//     receipts and refund receipts that were in it, less Stripe's fees as their own line — so the deposit in QuickBooks
//     is the amount the bank shows and the owner can match them in one click. A payout whose parts do not add up to its
//     amount is not booked: it is shown as refused, with the difference.
//
// Behind the quickbooks feature (offered to a store as opt-in) and settings:update for its settings routes, the QuickBooks
// routes' own line. The money is the merchant's own Stripe account's (Connect): nothing here holds a card number.
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import { contact, storeBooks, storeOrder, storeOrderItem, storeOrderRefund, storePayout, storeProduct } from '../../db/schema/index.ts'
import type { SweepHelpers } from '../office/quickbooksAutoSync.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { StoreCore } from './core.ts'
import { cardShareOfRefund } from './giftCards.ts'
import type { PayoutLine } from './payments/types.ts'

/** The accounts and items the books use, found in QuickBooks by name or made there the first time. */
const ACCOUNTS = {
  sales: { name: 'Online store sales', type: 'Income' },
  shipping: { name: 'Online store shipping', type: 'Income' },
  salesTax: { name: 'Online store sales tax', type: 'Other Current Liability' },
  giftCards: { name: 'Online store gift cards', type: 'Other Current Liability' },
  fees: { name: 'Stripe fees', type: 'Expense' },
  adjustments: { name: 'Stripe adjustments and disputes', type: 'Expense' },
} as const
const ITEMS = {
  sales: { name: 'Store sales', account: 'sales' },
  shipping: { name: 'Store shipping', account: 'shipping' },
  discounts: { name: 'Store discounts', account: 'sales' },
  salesTax: { name: 'Store sales tax', account: 'salesTax' },
  giftCards: { name: 'Store gift cards', account: 'giftCards' },
} as const
type AccountKey = keyof typeof ACCOUNTS
type ItemKey = keyof typeof ITEMS

const GUEST = 'Online store guest'
const dollars = (cents: number) => Math.round(cents) / 100
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10)
/** A name inside a QuickBooks query string. */
const quoted = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
/** QuickBooks' document numbers are at most 21 characters. */
const docNo = (s: string) => s.slice(0, 21)
type Order = typeof storeOrder.$inferSelect
type Refund = typeof storeOrderRefund.$inferSelect
type OrderItem = typeof storeOrderItem.$inferSelect
type Payout = typeof storePayout.$inferSelect
const SALE_TYPES = new Set(['charge', 'payment'])
const REFUND_TYPES = new Set(['refund', 'payment_refund'])

export function createStoreBooks(d: CrmDeps, core: StoreCore) {
  const { db, logger } = d
  const qb = d.services.quickbooks as any

  // ── What QuickBooks already has, by name ───────────────────────────────────────────────────────────────────────────
  async function refsOf(companyId: string) {
    const [row] = await db.select().from(storeBooks).where(eq(storeBooks.companyId, companyId)).limit(1)
    return row ?? null
  }
  async function saveRef(companyId: string, key: string, value: string) {
    const row = await refsOf(companyId)
    if (row) await db.update(storeBooks).set({ refs: { ...row.refs, [key]: value }, updatedAt: new Date() }).where(eq(storeBooks.id, row.id))
    else await db.insert(storeBooks).values({ companyId, refs: { [key]: value } }).onConflictDoNothing()
  }
  async function cached(companyId: string, key: string, make: () => Promise<string>): Promise<string> {
    const row = await refsOf(companyId)
    const hit = row?.refs?.[key]
    if (hit) return hit
    const made = await make()
    await saveRef(companyId, key, made)
    return made
  }

  const account = (companyId: string, key: AccountKey) => cached(companyId, `account.${key}`, async () => {
    const a = ACCOUNTS[key]
    const [found] = await qb.query(companyId, 'Account', `Name = '${quoted(a.name)}'`)
    if (found) return String(found.Id)
    const made = await qb.apiRequest(companyId, 'POST', '/account', { Name: a.name, AccountType: a.type })
    return String(made.Account.Id)
  })
  const undeposited = (companyId: string) => cached(companyId, 'account.undeposited', async () => {
    const [found] = await qb.query(companyId, 'Account', "AccountSubType = 'UndepositedFunds'")
    if (!found) throw new Error('QuickBooks has no Undeposited Funds account to hold the shop’s sales until the payout arrives.')
    return String(found.Id)
  })
  const item = (companyId: string, key: ItemKey) => cached(companyId, `item.${key}`, async () => {
    const i = ITEMS[key]
    const [found] = await qb.query(companyId, 'Item', `Name = '${quoted(i.name)}'`)
    if (found) return String(found.Id)
    const made = await qb.apiRequest(companyId, 'POST', '/item', { Name: i.name, Type: 'Service', IncomeAccountRef: { value: await account(companyId, i.account) } })
    return String(made.Item.Id)
  })
  /** Every item the books use, one at a time: two asks for the same account at once would each make it. */
  async function allItems(companyId: string): Promise<Record<ItemKey, string>> {
    const ids = {} as Record<ItemKey, string>
    for (const k of Object.keys(ITEMS) as ItemKey[]) ids[k] = await item(companyId, k)
    return ids
  }
  /** The customer an order is booked to: the shopper's own, or one shared customer for an order with no shopper on file. */
  async function customerFor(companyId: string, contactId: string | null): Promise<string> {
    if (contactId) {
      const [c] = await db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
      if (c) {
        if (!c.qbCustomerId) await qb.createCustomer(companyId, c)
        const [again] = await db.select({ id: contact.qbCustomerId }).from(contact).where(eq(contact.id, c.id)).limit(1)
        if (again?.id) return String(again.id)
      }
    }
    return cached(companyId, 'customer.guest', async () => {
      const [found] = await qb.query(companyId, 'Customer', `DisplayName = '${quoted(GUEST)}'`)
      if (found) return String(found.Id)
      return String((await qb.apiRequest(companyId, 'POST', '/customer', { Customer: { DisplayName: GUEST } })).Customer.Id)
    })
  }

  // ── Orders → sales receipts ────────────────────────────────────────────────────────────────────────────────────────
  const line = (itemRef: string, description: string, cents: number, qty = 1) => ({
    DetailType: 'SalesItemLineDetail', Amount: dollars(cents), Description: description,
    SalesItemLineDetail: { ItemRef: { value: itemRef }, Qty: qty, UnitPrice: dollars(cents) / qty },
  })

  async function sendOrder(companyId: string, o: typeof storeOrder.$inferSelect): Promise<string> {
    const rows: Array<{ i: OrderItem; kind: string | null }> = await db.select({ i: storeOrderItem, kind: storeProduct.kind }).from(storeOrderItem)
      .leftJoin(storeProduct, eq(storeProduct.id, storeOrderItem.productId)).where(eq(storeOrderItem.orderId, o.id)).orderBy(asc(storeOrderItem.id))
    const { sales, shipping, salesTax: tax, discounts, giftCards } = await allItems(companyId)
    const lines: any[] = rows.map(({ i, kind }) => ({
      DetailType: 'SalesItemLineDetail', Amount: dollars(i.lineTotalCents), Description: `${i.productName}${i.variantName && i.variantName !== 'Default' ? ` — ${i.variantName}` : ''}`,
      SalesItemLineDetail: { ItemRef: { value: kind === 'gift_card' ? giftCards : sales }, Qty: i.quantity, UnitPrice: dollars(i.unitPriceCents) },
    }))
    if (o.shippingCents > 0) lines.push(line(shipping, 'Shipping', o.shippingCents))
    if (o.taxCents > 0) lines.push(line(tax, 'Sales tax', o.taxCents))
    // Whatever took the total below items + shipping + tax: a discount code, a loyalty reward. The order's total is the truth.
    const taken = (o.subtotalCents + o.shippingCents + o.taxCents) - o.totalCents
    if (taken > 0) lines.push(line(discounts, o.discountCode ? `Discount (${o.discountCode})` : 'Discount', -taken))
    // The part a gift card paid is not takings today: it is the shop's gift-card balance going down.
    if (o.giftCardCents > 0) lines.push(line(giftCards, 'Paid with a gift card', -o.giftCardCents))
    const made = await qb.apiRequest(companyId, 'POST', '/salesreceipt', { SalesReceipt: {
      CustomerRef: { value: await customerFor(companyId, o.contactId) }, DocNumber: docNo(o.orderNumber ?? o.id), TxnDate: day(o.createdAt),
      DepositToAccountRef: { value: await undeposited(companyId) }, PrivateNote: `Online order ${o.orderNumber ?? ''}`.trim(),
      Line: lines,
    } })
    return String(made.SalesReceipt.Id)
  }

  // ── Refunds → refund receipts ──────────────────────────────────────────────────────────────────────────────────────
  async function sendRefund(companyId: string, r: typeof storeOrderRefund.$inferSelect, o: typeof storeOrder.$inferSelect): Promise<string> {
    const all: Refund[] = await db.select().from(storeOrderRefund).where(eq(storeOrderRefund.orderId, o.id)).orderBy(asc(storeOrderRefund.createdAt), asc(storeOrderRefund.id))
    const nth = all.findIndex((x) => x.id === r.id) + 1
    // The gift-card balance an order gave back, shared out over its refunds in order: the cash refunded is the rest.
    let assigned = 0
    let gift = 0
    for (const x of all) {
      if (!['refunded', 'recorded'].includes(x.status)) continue
      const share = Math.max(0, Math.min(cardShareOfRefund(o, x.amountCents), o.giftCardRefundedCents - assigned))
      assigned += share
      if (x.id === r.id) { gift = share; break }
    }
    const { sales, shipping, salesTax: tax, discounts, giftCards } = await allItems(companyId)
    const items: OrderItem[] = r.items.length ? await db.select().from(storeOrderItem).where(inArray(storeOrderItem.id, r.items.map((l) => l.orderItemId))) : []
    const byId = new Map(items.map((i) => [i.id, i]))
    const lines: any[] = []
    let itemsCents = 0
    for (const l of r.items) {
      const i = byId.get(l.orderItemId)
      if (!i || l.quantity <= 0) continue
      lines.push({ DetailType: 'SalesItemLineDetail', Amount: dollars(i.unitPriceCents * l.quantity), Description: `${i.productName}${i.variantName && i.variantName !== 'Default' ? ` — ${i.variantName}` : ''}`, SalesItemLineDetail: { ItemRef: { value: sales }, Qty: l.quantity, UnitPrice: dollars(i.unitPriceCents) } })
      itemsCents += i.unitPriceCents * l.quantity
    }
    if (r.shippingCents > 0) lines.push(line(shipping, 'Shipping', r.shippingCents))
    const rest = r.amountCents - itemsCents - Math.max(0, r.shippingCents)
    if (rest !== 0) {
      // No items named: a refund of an amount. Items named: what is left over is tax (more) or the discount that was on them (less).
      if (!r.items.length) lines.push(line(sales, r.reason || 'Refund', rest))
      else {
        // The tax that was on those items goes back with them (in proportion to the order), the rest is the discount they had.
        const taxPart = o.subtotalCents > 0 ? Math.min(o.taxCents, Math.round((o.taxCents * itemsCents) / o.subtotalCents)) : 0
        const other = rest - taxPart
        if (taxPart + Math.max(0, other) > 0) lines.push(line(tax, 'Sales tax', taxPart + Math.max(0, other)))
        if (other < 0) lines.push(line(discounts, 'Discount on the refunded items', other))
      }
    }
    if (gift > 0) lines.push(line(giftCards, 'Returned to the gift card', -gift))
    if (!lines.length) throw new Error('This refund has nothing to book.')
    const made = await qb.apiRequest(companyId, 'POST', '/refundreceipt', { RefundReceipt: {
      CustomerRef: { value: await customerFor(companyId, o.contactId) }, DocNumber: docNo(`${o.orderNumber ?? o.id}-R${nth}`), TxnDate: day(r.settledAt ?? r.createdAt),
      RefundFromAccountRef: { value: await undeposited(companyId) }, PrivateNote: `Refund of online order ${o.orderNumber ?? ''}${r.reason ? ` — ${r.reason}` : ''}`.trim(),
      Line: lines,
    } })
    return String(made.RefundReceipt.Id)
  }

  // ── Stripe payouts → deposits ──────────────────────────────────────────────────────────────────────────────────────
  /** The bank account payouts are deposited to: the owner's choice, or the only bank account QuickBooks has. */
  async function bankAccount(companyId: string): Promise<{ id: string; name: string } | { reason: string }> {
    const row = await refsOf(companyId)
    if (row?.bankAccountId) return { id: row.bankAccountId, name: row.bankAccountName ?? '' }
    const banks = await qb.query(companyId, 'Account', "AccountType = 'Bank'")
    if (banks.length === 1) return { id: String(banks[0].Id), name: String(banks[0].Name ?? '') }
    return { reason: banks.length ? 'Choose the bank account Stripe pays into: QuickBooks has more than one. Open Settings › Integrations › QuickBooks.' : 'QuickBooks has no bank account to deposit Stripe’s payouts into. Add one in QuickBooks, then press Sync Now.' }
  }

  async function sendPayouts(companyId: string, h: SweepHelpers): Promise<{ payouts: number; failed: number }> {
    const out = { payouts: 0, failed: 0 }
    const provider = await core.getActiveProvider(companyId)
    if (!provider || provider.name !== 'stripe' || !provider.payouts || !provider.payoutLines) return out
    const bank = await bankAccount(companyId)
    if ('reason' in bank) { await h.failed('payout', 'bank-account', 'Bank account', new Error(bank.reason)); return { ...out, failed: 1 } }
    await h.cleared('payout', 'bank-account')

    const [last] = await db.select({ at: storePayout.arrivedAt }).from(storePayout).where(eq(storePayout.companyId, companyId)).orderBy(desc(storePayout.arrivedAt)).limit(1)
    const since = Math.floor(((last?.at.getTime() ?? h.now.getTime() - 30 * 86_400_000) - 3 * 86_400_000) / 1000)
    const skip = await h.heldBack('payout')
    for (const p of await provider.payouts(since)) {
      const [stored] = await db.select().from(storePayout).where(and(eq(storePayout.companyId, companyId), eq(storePayout.providerPayoutId, p.id))).limit(1)
      if (stored?.qbDepositId || skip.has(p.id)) continue
      try {
        const lines = await provider.payoutLines(p.id)
        const booked = await depositFor(companyId, p, lines, bank.id)
        if (booked === 'wait') continue // a sale in it is not in QuickBooks yet: the next sync
        if (stored) await db.update(storePayout).set({ qbDepositId: booked.depositId, qbSyncedAt: new Date(), lines: booked.summary, feeCents: booked.feeCents }).where(eq(storePayout.id, stored.id))
        else await db.insert(storePayout).values({ companyId, providerPayoutId: p.id, amountCents: p.amountCents, feeCents: booked.feeCents, arrivedAt: p.arrivedAt, lines: booked.summary, qbDepositId: booked.depositId, qbSyncedAt: new Date() })
        await h.cleared('payout', p.id)
        out.payouts++
      } catch (e) {
        if (h.connectionLost(e)) throw e
        await h.failed('payout', p.id, `Stripe payout ${(p.amountCents / 100).toFixed(2)}`, e); out.failed++
      }
    }
    return out
  }

  async function depositFor(companyId: string, p: { id: string; amountCents: number; arrivedAt: Date }, lines: PayoutLine[], bankId: string) {
    const payments = [...new Set(lines.filter((l) => SALE_TYPES.has(l.type) && l.paymentId).map((l) => l.paymentId!))]
    const refundIds = [...new Set(lines.filter((l) => REFUND_TYPES.has(l.type) && l.refundId).map((l) => l.refundId!))]
    const orders: Order[] = payments.length ? await db.select().from(storeOrder).where(and(eq(storeOrder.companyId, companyId), inArray(storeOrder.providerPaymentId, payments))) : []
    const refunds: Array<{ r: Refund }> = refundIds.length
      ? await db.select({ r: storeOrderRefund }).from(storeOrderRefund).innerJoin(storeOrder, eq(storeOrder.id, storeOrderRefund.orderId))
        .where(and(eq(storeOrder.companyId, companyId), inArray(storeOrderRefund.providerRefundId, refundIds)))
      : []
    const orderBy = new Map(orders.map((o) => [o.providerPaymentId!, o]))
    const refundBy = new Map(refunds.map(({ r }) => [r.providerRefundId!, r]))
    // A sale or refund in this payout that QuickBooks has not been sent yet: book the payout after it.
    if (orders.some((o) => !o.qbSalesReceiptId) || refunds.some(({ r }) => !r.qbRefundReceiptId)) return 'wait' as const

    const net = lines.reduce((n, l) => n + l.netCents, 0)
    if (net !== p.amountCents) throw new Error(`Stripe’s payout of ${dollars(p.amountCents).toFixed(2)} is made of lines that add up to ${dollars(net).toFixed(2)}, so it was not booked. Check this payout in Stripe.`)

    const deposit: any[] = []
    const summary: unknown[] = []
    let fees = 0
    let other = 0
    const otherNotes: string[] = []
    for (const l of lines) {
      fees += l.feeCents
      const o = SALE_TYPES.has(l.type) && l.paymentId ? orderBy.get(l.paymentId) : undefined
      const r = REFUND_TYPES.has(l.type) && l.refundId ? refundBy.get(l.refundId) : undefined
      if (o) {
        deposit.push({ Amount: dollars(l.grossCents), LinkedTxn: [{ TxnId: o.qbSalesReceiptId, TxnType: 'SalesReceipt', TxnLineId: '0' }] })
        summary.push({ kind: 'sale', orderNumber: o.orderNumber, grossCents: l.grossCents, feeCents: l.feeCents })
      } else if (r) {
        const receipt = r.qbRefundReceiptId
        deposit.push({ Amount: dollars(l.grossCents), LinkedTxn: [{ TxnId: receipt, TxnType: 'RefundReceipt', TxnLineId: '0' }] })
        summary.push({ kind: 'refund', grossCents: l.grossCents })
      } else {
        // A dispute, an adjustment, a payment that is not one of the shop's orders: booked to its own account, named.
        other += l.grossCents
        otherNotes.push(`${l.type}${l.description ? ` (${l.description})` : ''} ${dollars(l.grossCents).toFixed(2)}`)
        summary.push({ kind: 'other', type: l.type, description: l.description, grossCents: l.grossCents, feeCents: l.feeCents })
      }
    }
    if (fees !== 0) deposit.push({ Amount: -dollars(fees), Description: 'Stripe fees', DetailType: 'DepositLineDetail', DepositLineDetail: { AccountRef: { value: await account(companyId, 'fees') } } })
    if (other !== 0) deposit.push({ Amount: dollars(other), Description: `Stripe: ${otherNotes.join('; ')}`.slice(0, 4000), DetailType: 'DepositLineDetail', DepositLineDetail: { AccountRef: { value: await account(companyId, 'adjustments') } } })
    const made = await qb.apiRequest(companyId, 'POST', '/deposit', { Deposit: {
      DepositToAccountRef: { value: bankId }, TxnDate: day(p.arrivedAt), PrivateNote: `Stripe payout ${p.id}`, Line: deposit,
    } })
    return { depositId: String(made.Deposit.Id), feeCents: fees, summary }
  }

  // ── The sweep's pass ───────────────────────────────────────────────────────────────────────────────────────────────
  async function pass(companyId: string, h: SweepHelpers) {
    const out = { orders: 0, refunds: 0, payouts: 0, failed: 0 }
    const skipO = await h.heldBack('order')
    const orders: Order[] = await db.select().from(storeOrder).where(and(eq(storeOrder.companyId, companyId), isNotNull(storeOrder.orderNumber), ne(storeOrder.status, 'pending'), isNull(storeOrder.qbSalesReceiptId))).orderBy(asc(storeOrder.createdAt)).limit(200)
    for (const o of orders) {
      if (skipO.has(o.id)) continue
      try {
        const id = await sendOrder(companyId, o)
        await db.update(storeOrder).set({ qbSalesReceiptId: id, qbSyncedAt: new Date() }).where(eq(storeOrder.id, o.id))
        await h.cleared('order', o.id)
        out.orders++
      } catch (e) {
        if (h.connectionLost(e)) throw e
        await h.failed('order', o.id, `#${o.orderNumber}`, e); out.failed++
      }
    }

    const skipR = await h.heldBack('refund')
    const due: Array<{ r: Refund; o: Order }> = await db.select({ r: storeOrderRefund, o: storeOrder }).from(storeOrderRefund).innerJoin(storeOrder, eq(storeOrder.id, storeOrderRefund.orderId))
      .where(and(eq(storeOrder.companyId, companyId), isNotNull(storeOrder.qbSalesReceiptId), isNull(storeOrderRefund.qbRefundReceiptId), inArray(storeOrderRefund.status, ['refunded', 'recorded'])))
      .orderBy(asc(storeOrderRefund.createdAt)).limit(200)
    for (const { r, o } of due) {
      if (skipR.has(r.id)) continue
      try {
        const id = await sendRefund(companyId, r, o)
        await db.update(storeOrderRefund).set({ qbRefundReceiptId: id }).where(eq(storeOrderRefund.id, r.id))
        await h.cleared('refund', r.id)
        out.refunds++
      } catch (e) {
        if (h.connectionLost(e)) throw e
        await h.failed('refund', r.id, `${(r.amountCents / 100).toFixed(2)} on #${o.orderNumber}`, e); out.failed++
      }
    }

    try {
      const p = await sendPayouts(companyId, h)
      out.payouts += p.payouts; out.failed += p.failed
    } catch (e) {
      if (h.connectionLost(e)) throw e
      // Stripe could not be asked (not connected, a hiccup): the orders and refunds above stand; the payouts wait for the next sync.
      logger.warn('[store-books] payouts not read', { companyId, error: (e as any)?.message })
    }
    return out
  }

  // ── Settings: which bank account the payouts land in ───────────────────────────────────────────────────────────────
  function routes() {
    const app = new Hono<AppEnv>()
    // The QuickBooks routes' own line: settings:update — the owner (and an admin or a seat granted it by name).
    app.use('*', d.permissions.requirePermission('settings:update'))

    app.get('/', async (c) => {
      const companyId = c.get('user').companyId
      const row = await refsOf(companyId)
      const payouts: Payout[] = await db.select().from(storePayout).where(eq(storePayout.companyId, companyId)).orderBy(desc(storePayout.arrivedAt)).limit(10)
      return one(c, {
        bankAccount: row?.bankAccountId ? { id: row.bankAccountId, name: row.bankAccountName } : null,
        payouts: payouts.map((p) => ({ id: p.providerPayoutId, amountCents: p.amountCents, feeCents: p.feeCents, arrivedAt: p.arrivedAt, booked: !!p.qbDepositId })),
      })
    })
    /** The bank accounts QuickBooks has, for the owner to choose from. */
    app.get('/bank-accounts', async (c) => {
      try {
        const banks = await qb.query(c.get('user').companyId, 'Account', "AccountType = 'Bank'")
        return one(c, { accounts: banks.map((b: any) => ({ id: String(b.Id), name: String(b.Name ?? '') })) })
      } catch { return fail(c, 400, 'QuickBooks could not be reached. Connect it first, then try again.', 'not_connected') }
    })
    app.put('/', async (c) => {
      const companyId = c.get('user').companyId
      const body = await c.req.json().catch(() => ({}))
      const id = String(body?.bankAccountId ?? '')
      let banks: any[]
      try { banks = await qb.query(companyId, 'Account', "AccountType = 'Bank'") } catch { return fail(c, 400, 'QuickBooks could not be reached. Connect it first, then try again.', 'not_connected') }
      const chosen = banks.find((b) => String(b.Id) === id)
      if (!chosen) return fail(c, 400, 'That is not one of the bank accounts in your QuickBooks.', 'validation_failed', { bankAccountId: 'Not a bank account' })
      const row = await refsOf(companyId)
      if (row) await db.update(storeBooks).set({ bankAccountId: id, bankAccountName: String(chosen.Name ?? ''), updatedAt: new Date() }).where(eq(storeBooks.id, row.id))
      else await db.insert(storeBooks).values({ companyId, bankAccountId: id, bankAccountName: String(chosen.Name ?? '') })
      return one(c, { bankAccount: { id, name: String(chosen.Name ?? '') } })
    })
    return app
  }

  return { pass, routes }
}
