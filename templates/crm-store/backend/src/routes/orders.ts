import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, orderItems, orderRefunds, storeSettings, productVariants, users, type RefundLine } from '../../db/schema.ts'
import { eq, and, desc, asc, sql, isNotNull, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission } from '../middleware/permissions.ts'
import { sendOrderShipped, sendRefundIssued } from '../services/email.ts'
import { getActiveProvider } from '../payments/index.ts'
import { RefundRefused } from '../payments/types.ts'
import audit from '../services/audit.ts'
import { formatCents } from '../lib/money.ts'

const admin = new Hono()
admin.use('*', authenticate, requirePermission('orders:read'))

export const may = (c: any, permission: string) => hasPermission((c.get('user') as any)?.role, permission)

// What the shop paid its supplier, and the margin over it, is margin:read — the fleet's line for cost.
// Staff pack the order; they do not need to know what it cost us. (owner's decision, T42)
export const orderForCaller = (c: any, order: any) => {
  if (!order) return order
  let out = order
  if (!may(c, 'margin:read')) { const { supplierCostCents: _cost, ...rest } = out; out = rest }
  // The payment provider's own ids — the checkout session, the payment, the refund — are what a refund is made
  // against, and refunding is orders:refund. Staff pack the order; they are not sent the ids. (Store sweep, 10/12:
  // the fleet round took every Stripe id off the seats that do not need them; the store's orders still carried them.)
  if (!may(c, 'orders:refund')) { const { providerSessionId: _s, providerPaymentId: _p, refundId: _r, ...rest } = out; out = rest }
  return out
}

/**
 * A status change staff may make: moving a PAID order along the floor — fulfilled, shipped, delivered.
 * Everything else changes whether the order was paid for (cancel, refund, mark paid or pending, reopen a
 * cancelled one, ship one nobody paid for) and is orders:refund, the manager's and the owner's.
 */
const COUNTED = ['paid', 'fulfilled', 'shipped', 'delivered']
const FULFILMENT = ['fulfilled', 'shipped', 'delivered']
export const isFulfilment = (from: string, to: string) => COUNTED.includes(from) && FULFILMENT.includes(to)
/**
 * WHERE AN ORDER MAY GO NEXT. (Store QA T1, M1)
 *
 *   "A cancelled order moved to paid then shipped (200 each), and a refunded order moved back to paid. Setting the
 *    cancelled order back to cancelled left fulfilledAt populated."
 *
 * The status route checked WHO was asking and never WHERE the order stood, so anything could become anything. That
 * was not cosmetic: cancelling or refunding a paid order puts its units back on the shelf (below), and nothing
 * takes them out again — so "reopening" one sold stock the shop had already restored, and a refunded order read as
 * paid money that had gone back to the customer. Cancelled and refunded are where an order ends; a mistake there
 * is a new order, not a resurrection. Nothing ships before it is paid.
 *
 * This is the table the order screen has always offered (frontend OrderDetailPage NEXT_STATUS) — the server now
 * holds everyone to it, and tests/store/order-lifecycle.test.ts holds the two tables equal. A same-status save is
 * not a move and is allowed.
 */
export const NEXT_STATUS: Record<string, string[]> = {
  // an order taken offline is marked paid by the owner or a manager; one never paid for is cancelled
  pending: ['paid', 'cancelled'],
  paid: ['fulfilled', 'shipped', 'cancelled', 'refunded'],
  fulfilled: ['shipped', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
}
export const mayMove = (from: string, to: string) => from === to || (NEXT_STATUS[from] || []).includes(to)
export const moveRefusal = (c: any, from: string, to: string) => c.json({
  error: (NEXT_STATUS[from] || []).length
    ? `An order that is ${from} can be marked ${NEXT_STATUS[from].join(', ')} — not ${to}.`
    : `An order that is ${from} is closed and cannot be marked ${to}. If it should go ahead, take it as a new order.`,
  code: 'invalid_transition',
  allowed: NEXT_STATUS[from] || [],
}, 409)

/**
 * TWO PEOPLE ON ONE ORDER. Every status change reads the order, decides the move is allowed, then writes it. Two at
 * once both read "paid": two refunds each put the units back on the shelf (10 in stock, 3 sold, refunded twice → 13),
 * and a cancel racing "mark shipped" restocked an order that then read shipped. So the write names the status it was
 * decided from — `WHERE status = <what was read>` — and only the one that still finds it there moves the order, puts
 * stock back or emails the customer. The other is told who got there first, and nothing of theirs is applied.
 */
export const changedUnderYou = (c: any, now: { status: string } | undefined, wanted: string, notDone = `it was not marked ${wanted}`) => c.json({
  error: now
    ? `Someone else just marked this order ${now.status}, so ${notDone}. Reload the order to see it as it stands.`
    : 'This order no longer exists.',
  code: 'order_changed',
  status: now?.status ?? null,
}, 409)

/**
 * WHICH ORDERS HAVE A PARCEL. (Store QA T3, manager: "I saved a carrier and tracking number on the cancelled order
 * QA-ROLES-2 (200), although changing its status to shipped is refused.") Tracking is the parcel's, so it belongs to an
 * order that is going out or went out: paid and on along the floor, or refunded after it shipped (fulfilledAt — a
 * cancel clears it, a refund after shipping keeps it). A pending order nobody paid for, a cancelled one, or one
 * refunded before it left never had a parcel. Clearing tracking is always allowed, so a wrong value can be removed;
 * the internal note is the shop's and is never refused.
 */
export const hasParcel = (o: { status: string; fulfilledAt?: Date | string | null }) =>
  COUNTED.includes(o.status) || (o.status === 'refunded' && !!o.fulfilledAt)
export const noParcelRefusal = (c: any, status: string) => c.json({
  error: `This order is ${status} and never went out, so it has no parcel to track. The internal note can still be saved.`,
  code: 'no_parcel',
}, 409)

/**
 * WHAT HAPPENED TO THE SHOPPER'S MONEY when a paid order was refunded or cancelled. (Owner's decision, 10/12)
 *
 * 'Mark refunded' only ever changed the order's status: the order said refunded and the shopper's money stayed
 * taken. Shopify's Refund sends the money back through the payment provider, and so does this now — for a provider
 * whose refund is built and tested (Stripe). For any other, the owner is told plainly that this only RECORDS it:
 *   refunded      the provider sent it back (or it already had — refunded from the provider's own dashboard)
 *   manual        paid through a provider whose refund is not built here, or not the one connected now — refund there
 *   none_on_file  no card payment on record (an order marked paid by hand) — return it the way it was paid
 *   failed        the provider refused (refused: true — nothing was sent), or did not answer (refused: false — it may
 *                 have gone through, so a part refund stays pending and is asked again with the same key)
 */
export type MoneyBack =
  | { kind: 'not_paid' }
  | { kind: 'refunded'; refundId: string | null; status: string; amountCents: number | null; alreadyRefunded?: boolean }
  | { kind: 'manual'; note: string }
  | { kind: 'none_on_file'; note: string }
  | { kind: 'failed'; reason: string; refused: boolean }

const PROVIDER_LABEL: Record<string, string> = { stripe: 'Stripe', square: 'Square', paypal: 'PayPal' }

/**
 * Send money back for an order. With no `part`, it is everything not already sent back: after part refunds that is
 * totalCents − refundedCents; with none, the provider's own "the rest" (which also allows for anything refunded in its
 * dashboard). A part names its amount and its own idempotency key (refund-<order_refunds.id>).
 */
export async function returnPayment(order: typeof orders.$inferSelect, part?: { amountCents: number; idempotencyKey: string; reason?: string | null }): Promise<MoneyBack> {
  if (!order.providerPaymentId) {
    return { kind: 'none_on_file', note: 'No card payment is on record for this order, so no money was sent back here. Return it the way it was paid.' }
  }
  const label = PROVIDER_LABEL[order.provider] || order.provider
  const provider = await getActiveProvider().catch(() => null)
  if (!provider || provider.name !== order.provider || !provider.refund) {
    return { kind: 'manual', note: `This order was paid through ${label}. Refund it in your ${label} dashboard — here it is only recorded as refunded.` }
  }
  try {
    const r = await provider.refund(part
      ? { providerPaymentId: order.providerPaymentId, idempotencyKey: part.idempotencyKey, amountCents: part.amountCents, currency: order.currency, ...(part.reason ? { reason: part.reason } : {}) }
      // After part refunds the key names how much had gone back, so it is a different request from a refund of the whole
      // tried (and refused) earlier — a provider refuses a key reused with a different amount.
      : order.refundedCents > 0
        ? { providerPaymentId: order.providerPaymentId, idempotencyKey: `order-refund-${order.id}-${order.refundedCents}`, amountCents: order.totalCents - order.refundedCents, currency: order.currency }
        : { providerPaymentId: order.providerPaymentId, idempotencyKey: `order-refund-${order.id}`, currency: order.currency })
    return { kind: 'refunded', ...r }
  } catch (e: any) {
    return { kind: 'failed', reason: `${label} said: ${String(e?.message || 'no reason given').slice(0, 300)}`, refused: e instanceof RefundRefused }
  }
}

/**
 * A status change in the audit log, with what it was worth: a refund or a cancel is money going back and stock coming
 * back, so the row says how much of each. (Store T3: refunds are a manager's power; the owner can see who used it.)
 */
async function logStatusChange(c: any, prev: typeof orders.$inferSelect, updated: typeof orders.$inferSelect, restocked: number, back: MoneyBack = { kind: 'not_paid' }) {
  const money = formatCents(updated.totalCents, updated.currency)
  const sent = back.kind === 'refunded' ? (back.alreadyRefunded ? ', already refunded at the provider' : ', sent back to the card') : back.kind === 'manual' || back.kind === 'none_on_file' ? ', recorded only — no money sent back here' : ''
  const what = updated.status === 'refunded' ? `Refunded — ${money}${sent}` : updated.status === 'cancelled' ? `Cancelled — ${money}${sent}` : `Marked ${updated.status}`
  await audit.log({
    action: 'status_change', entity: 'order', entityId: updated.id, entityName: updated.orderNumber,
    changes: { status: { old: prev.status, new: updated.status } },
    metadata: { description: restocked ? `${what}, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : what, totalCents: updated.totalCents, restocked, ...(back.kind === 'refunded' ? { refundId: back.refundId, refundStatus: back.status } : back.kind === 'not_paid' ? {} : { moneyBack: back.kind }) },
    req: c,
  })
}

export const refundRefusal = (c: any) => c.json({
  error: 'Cancelling, refunding or changing whether an order was paid is for a manager or the owner.',
  required: 'orders:refund',
}, 403)

// Email the customer that their order shipped (with tracking). Non-blocking.
export async function notifyShipped(order: typeof orders.$inferSelect): Promise<void> {
  try {
    const [settings] = await db.select().from(storeSettings).limit(1)
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
    await sendOrderShipped({
      order: {
        orderNumber: order.orderNumber, customerEmail: order.customerEmail, customerName: order.customerName,
        subtotalCents: order.subtotalCents, shippingCents: order.shippingCents, taxCents: order.taxCents,
        discountCents: order.discountCents, loyaltyDiscountCents: order.loyaltyDiscountCents, discountCode: order.discountCode,
        totalCents: order.totalCents, currency: order.currency, shippingAddress: order.shippingAddress,
        trackingCarrier: order.trackingCarrier, trackingNumber: order.trackingNumber,
      },
      items: items.map((it) => ({ productName: it.productName, variantName: it.variantName, quantity: it.quantity, lineTotalCents: it.lineTotalCents })),
      storeName: settings?.companyName || 'Our Store',
      supportEmail: settings?.supportEmail,
    })
  } catch { /* non-blocking */ }
}

// ── Orders ───────────────────────────────────────────────────────────────────
admin.get('/', async (c) => {
  const status = c.req.query('status')
  const rows = status
    ? await db.select().from(orders).where(eq(orders.status, status as any)).orderBy(desc(orders.createdAt))
    : await db.select().from(orders).orderBy(desc(orders.createdAt))
  return c.json({ orders: rows.map((o) => orderForCaller(c, o)) })
})

admin.get('/stats', async (c) => {
  const [row] = await db.select({
    paidCount: sql<number>`count(*) filter (where ${orders.status} not in ('pending','cancelled'))`,
    pendingFulfillment: sql<number>`count(*) filter (where ${orders.status} = 'paid')`,
    atSupplier: sql<number>`count(*) filter (where ${orders.supplierStatus} = 'placed')`,
    revenueCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
    // Every order with money sent back — refunded whole, or in part (E2E Run 2: a part refund has to show here too).
    refundedCount: sql<number>`count(*) filter (where ${orders.status} not in ('pending','cancelled') and ${orders.refundedCents} > 0)`,
    refundedCents: sql<number>`coalesce(sum(${orders.refundedCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
  }).from(orders)
  return c.json({ stats: {
    paidCount: Number(row.paidCount),
    pendingFulfillment: Number(row.pendingFulfillment),
    atSupplier: Number(row.atSupplier),
    // The shop's takings as one figure is revenue:read — staff see how many orders are waiting, not
    // what the business has taken. null, not 0: "no revenue" and "not yours to see" are different.
    revenueCents: may(c, 'revenue:read') ? Number(row.revenueCents) : null,
    /**
     * What went back. (Store QA T1, L3: "Revenue $25.00 / Orders 1 while the only orders are cancelled and refunded …
     * the dashboard shows no refund figure beside it.") Revenue keeps counting a refunded sale — the owner's refund
     * model: the sale happened, the refund is its own event — so the refund has to be on the screen too, or $25.00
     * reads as money the shop still has. Same seat rule as revenue: null when it is not theirs to see.
     */
    refundedCount: Number(row.refundedCount),
    refundedCents: may(c, 'revenue:read') ? Number(row.refundedCents) : null,
    // What the shop has kept: the sales less what went back. (E2E Run 2: "Revenue $40.71" after a full refund.)
    netCents: may(c, 'revenue:read') ? Number(row.revenueCents) - Number(row.refundedCents) : null,
  } })
})

// Derived customers (no separate table — orders snapshot customer info).
admin.get('/customers', async (c) => {
  const rows = await db.select({
    email: orders.customerEmail,
    name: sql<string>`max(${orders.customerName})`,
    phone: sql<string>`max(${orders.customerPhone})`,
    orderCount: sql<number>`count(*)`,
    totalSpentCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} not in ('pending','cancelled')), 0)`,
    lastOrderAt: sql<string>`max(${orders.createdAt})`,
  }).from(orders)
    .where(sql`${orders.status} not in ('pending')`)
    .groupBy(orders.customerEmail)
    .orderBy(desc(sql`max(${orders.createdAt})`))
  return c.json({ customers: rows.map((r) => ({ ...r, orderCount: Number(r.orderCount), totalSpentCents: Number(r.totalSpentCents) })) })
})

admin.get('/:id', async (c) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  // With its refund history (order_refunds), oldest first.
  return c.json({ order: await orderWithRefunds(c, order.id) })
})

const statusSchema = z.object({
  status: z.enum(['pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded']),
})

admin.patch('/:id/status', requirePermission('orders:update'), async (c) => {
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  const next = parsed.data.status
  // Already there: nothing moves, nothing is refunded, and nothing is written to the audit log.
  if (next === prev.status) { audit.nothingToRecord(); return c.json({ order: orderForCaller(c, prev) }) }
  if (!mayMove(prev.status, next)) return moveRefusal(c, prev.status, next)
  if (!isFulfilment(prev.status, next) && !may(c, 'orders:refund')) return refundRefusal(c)
  const patch: Record<string, unknown> = { status: next, updatedAt: new Date() }
  // The FIRST fulfilment is the one recorded: packing and then shipping kept rewriting it.
  if ((next === 'fulfilled' || next === 'shipped') && !prev.fulfilledAt) patch.fulfilledAt = new Date()
  // A paid order cancelled before it went out was never fulfilled. (A refund after shipping keeps it: it did ship.)
  if (next === 'cancelled') patch.fulfilledAt = null
  // Only from the status this was decided on (changedUnderYou above): a second person's change in between wins.
  // A paid order leaving for refunded/cancelled is stamped refundPendingAt in the SAME write: from here until the
  // provider has answered and the stock is back, the order says a refund is under way — so a crash in between is
  // finished by resumePendingRefunds rather than left reading "refunded" with the money still taken.
  const givesMoneyBack = (next === 'cancelled' || next === 'refunded') && COUNTED.includes(prev.status)
  if (givesMoneyBack) { patch.refundPendingAt = new Date(); patch.refundError = null }
  // "The rest" is worked out from what has gone back; a part refund still on its way would be counted in neither.
  if (givesMoneyBack && await partInFlight(prev.id)) return partInFlightRefusal(c)
  const [updated] = await db.update(orders).set(patch).where(and(eq(orders.id, prev.id), eq(orders.status, prev.status), ...(givesMoneyBack ? [noPartInFlight] : []))).returning()
  if (!updated) {
    const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, prev.id)).limit(1)
    return changedUnderYou(c, now, next)
  }

  // The money goes back BEFORE the stock does, and only from the request that won the status change above — so two
  // presses, or a refund racing 'mark shipped', can never send money back for an order that did not move. If the
  // provider refuses, the order is put back exactly as it was and nothing is restocked. (See returnPayment.)
  let money: MoneyBack = { kind: 'not_paid' }
  let restocked = 0
  if (givesMoneyBack) {
    money = await returnPayment(prev)
    if (money.kind === 'failed') {
      await db.update(orders).set({ status: prev.status, fulfilledAt: prev.fulfilledAt, refundPendingAt: null, updatedAt: new Date() })
        .where(and(eq(orders.id, prev.id), eq(orders.status, next)))
      return c.json({
        error: `The payment could not be refunded, so the order is still ${prev.status} and nothing was restocked. ${money.reason}`,
        code: 'refund_failed',
      }, 502)
    }
    const once = await settleRefundOnce(prev.id, money, await whoIs(c))
    restocked = once.restocked
    if (once.settled && money.kind === 'refunded' && !money.alreadyRefunded) void notifyLastRefund(prev.id, next === 'cancelled')
  }

  const [final] = givesMoneyBack ? await db.select().from(orders).where(eq(orders.id, prev.id)).limit(1) : [updated]
  await logStatusChange(c, prev, final, restocked, money)
  if (next === 'shipped' && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: orderForCaller(c, final), ...(money.kind === 'not_paid' ? {} : { refund: money }) })
})

/**
 * THE REFUND IS DONE: the stamp comes off and the stock goes back, as ONE write. (Owner, 10/12: "the professional
 * thing to do".) Clearing refundPendingAt is conditional on it still being set, so whoever finishes a refund — the
 * request, resumePendingRefunds after a crash, a retry — restocks exactly once, however many of them get here.
 * Restocking: payment (finalizeOrder) took the units off for tracked variants; untracked (inventoryQty IS NULL =
 * unlimited) are skipped by the WHERE guard. Everything inside reads through `tx` — an outer `db` read inside the
 * transaction would wait on itself.
 *
 * After part refunds, "the rest" is what is left: only the units not refunded yet go back on the shelf (a part refund
 * restocked its own, or chose not to), and the order's refundedCents becomes its total. The rest is written to the
 * order's refund history as one row, like a part refund.
 */
export async function settleRefund(orderId: string, money: MoneyBack, by?: { userId?: string | null; name?: string | null; reason?: string | null }): Promise<number> {
  return (await settleRefundOnce(orderId, money, by)).restocked
}
/** settleRefund, saying whether THIS call was the one that settled it (only that one tells the shopper). */
export async function settleRefundOnce(orderId: string, money: MoneyBack, by?: { userId?: string | null; name?: string | null; reason?: string | null }): Promise<{ restocked: number; settled: boolean }> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ refundedCents: orders.refundedCents }).from(orders).where(eq(orders.id, orderId)).limit(1)
    const [cleared] = await tx.update(orders).set({
      refundPendingAt: null, refundError: null, updatedAt: new Date(), refundedCents: sql`${orders.totalCents}`,
      ...(money.kind === 'refunded' ? { refundId: money.refundId, refundedAt: new Date() } : {}),
    }).where(and(eq(orders.id, orderId), isNotNull(orders.refundPendingAt))).returning()
    if (!cleared) return { restocked: 0, settled: false }
    let restocked = 0
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const lines: RefundLine[] = []
    for (const it of items) {
      const left = it.quantity - it.refundedQuantity
      if (left <= 0) continue
      lines.push({ orderItemId: it.id, quantity: left })
      await tx.update(orderItems).set({ refundedQuantity: it.quantity }).where(eq(orderItems.id, it.id))
      if (!it.variantId) continue
      restocked += left
      await tx.update(productVariants)
        .set({ inventoryQty: sql`${productVariants.inventoryQty} + ${left}`, updatedAt: new Date() })
        .where(and(eq(productVariants.id, it.variantId), sql`${productVariants.inventoryQty} is not null`))
    }
    const amount = cleared.totalCents - (before?.refundedCents ?? 0)
    if (amount > 0 || lines.length) {
      const [shipped] = await tx.select({ cents: sql<number>`coalesce(sum(${orderRefunds.shippingCents}), 0)` }).from(orderRefunds)
        .where(and(eq(orderRefunds.orderId, orderId), sql`${orderRefunds.status} <> 'failed'`))
      await tx.insert(orderRefunds).values({
        orderId, amountCents: Math.max(0, amount), shippingCents: Math.max(0, cleared.shippingCents - Number(shipped?.cents ?? 0)),
        items: lines, restock: true, reason: by?.reason ?? (cleared.status === 'cancelled' ? 'Order cancelled' : null),
        status: money.kind === 'refunded' ? 'refunded' : 'recorded', moneyBack: money.kind,
        providerRefundId: money.kind === 'refunded' ? money.refundId : null,
        createdBy: by?.userId ?? null, createdByName: by?.name ?? null, settledAt: new Date(),
      })
    }
    return { restocked, settled: true }
  })
}

/**
 * FINISH WHAT WAS INTERRUPTED. A refund left stamped (refundPendingAt) for more than a couple of minutes — the server
 * restarted between moving the order and hearing from the provider — is asked of the provider again. The per-order
 * idempotency key hands back the SAME refund if the first request did reach it, so this never refunds twice; the
 * settle above never restocks twice. A refusal is kept on the order (refundError) for the order page to show, with a
 * Try again button; the order stays refunded/cancelled and nothing is restocked until the money has gone back.
 */
export async function finishRefund(order: typeof orders.$inferSelect, why: string): Promise<MoneyBack> {
  const money = await returnPayment(order)
  if (money.kind === 'failed') {
    await db.update(orders).set({ refundError: money.reason, updatedAt: new Date() })
      .where(and(eq(orders.id, order.id), isNotNull(orders.refundPendingAt)))
    return money
  }
  const { restocked, settled } = await settleRefundOnce(order.id, money)
  const [after] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1)
  if (settled && after && money.kind === 'refunded' && !money.alreadyRefunded) void notifyLastRefund(order.id, after.status === 'cancelled')
  if (after) {
    const amount = formatCents(after.totalCents, after.currency)
    await audit.log({
      action: 'status_change', entity: 'order', entityId: after.id, entityName: after.orderNumber,
      metadata: {
        description: `${why} — ${money.kind === 'refunded' ? `${amount} sent back to the card` : 'recorded only, no money sent back here'}${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : ''}`,
        ...(money.kind === 'refunded' ? { refundId: money.refundId, refundStatus: money.status } : { moneyBack: money.kind }),
      },
    })
  }
  return money
}

export async function resumePendingRefunds(olderThanMs = 2 * 60_000): Promise<number> {
  const stuck = await db.select().from(orders)
    .where(and(isNotNull(orders.refundPendingAt), lt(orders.refundPendingAt, new Date(Date.now() - olderThanMs))))
  for (const o of stuck) {
    try { await finishRefund(o, 'Refund completed after an interruption') } catch (e: any) { console.error('[orders] resuming a refund failed:', e?.message || e) }
  }
  return stuck.length + await resumePendingParts(olderThanMs)
}

// The order page's "Try the refund again", for a refund the provider refused after the order had moved.
admin.post('/:id/refund/retry', requirePermission('orders:refund'), async (c) => {
  const [o] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!o) return c.json({ error: 'Not found' }, 404)
  if (!o.refundPendingAt) return c.json({ order: orderForCaller(c, o), refund: null })
  const money = await finishRefund(o, 'Refund completed on a retry')
  const [after] = await db.select().from(orders).where(eq(orders.id, o.id)).limit(1)
  if (money.kind === 'failed') return c.json({ error: `The refund still has not gone through. ${money.reason}`, code: 'refund_failed', order: orderForCaller(c, after) }, 502)
  return c.json({ order: orderForCaller(c, after), refund: money })
})

/**
 * A REFUND MADE IN THE PROVIDER'S OWN DASHBOARD. (Owner, 10/12.) Stripe sends charge.refunded; the order is found by its
 * payment id, and `refundedCents` is everything refunded off that payment so far (Stripe's amount_refunded, Square's
 * refunded_money).
 *   ours          — no more than the order has already sent back (refundedCents counts a part refund from the moment
 *                   it is reserved, before the provider is asked): nothing to do. A whole refund of ours has moved
 *                   the order off paid before the provider was asked, so it is left alone too.
 *   all of it     — the order is marked refunded and the rest restocked, exactly once (WHERE status = what was read).
 *   part of it    — the extra is written to the order's refund history as money back with no items: the store cannot
 *                   know which units it was for, so nothing is restocked.
 */
export async function applyProviderRefund(provider: string, providerPaymentId: string, refundedCents: number, chargeCents: number): Promise<'refunded' | 'partial' | 'ignored'> {
  const [o] = await db.select().from(orders)
    .where(and(eq(orders.provider, provider as any), eq(orders.providerPaymentId, providerPaymentId))).limit(1)
  if (!o || !COUNTED.includes(o.status)) return 'ignored'
  if (refundedCents <= o.refundedCents) return 'ignored'
  const amount = (cents: number) => formatCents(cents, o.currency)
  const where = `${PROVIDER_LABEL[provider] || provider}'s dashboard`
  if (refundedCents < chargeCents) {
    const extra = refundedCents - o.refundedCents
    const recorded = await db.transaction(async (tx) => {
      const [moved] = await tx.update(orders).set({ refundedCents, updatedAt: new Date() })
        .where(and(eq(orders.id, o.id), eq(orders.status, o.status), eq(orders.refundedCents, o.refundedCents), sql`${orders.refundPendingAt} is null`))
        .returning({ id: orders.id })
      if (!moved) return false
      await tx.insert(orderRefunds).values({ orderId: o.id, amountCents: extra, items: [], restock: false, reason: `Refunded in ${where}`, status: 'refunded', moneyBack: 'provider_dashboard', settledAt: new Date() })
      return true
    })
    if (!recorded) return 'ignored'
    await audit.log({
      action: 'update', entity: 'order', entityId: o.id, entityName: o.orderNumber,
      metadata: { description: `Partly refunded in ${where}: ${amount(extra)} (${amount(refundedCents)} of ${amount(chargeCents)} back so far) — no units restocked` },
    })
    return 'partial'
  }
  const [moved] = await db.update(orders).set({ status: 'refunded', refundPendingAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, o.id), eq(orders.status, o.status), noPartInFlight)).returning()
  if (!moved) return 'ignored'
  const restocked = await settleRefund(o.id, { kind: 'refunded', refundId: null, status: 'succeeded', amountCents: refundedCents, alreadyRefunded: true }, { reason: `Refunded in ${where}` })
  await audit.log({
    action: 'status_change', entity: 'order', entityId: o.id, entityName: o.orderNumber,
    changes: { status: { old: o.status, new: 'refunded' } },
    metadata: { description: `Refunded in ${PROVIDER_LABEL[provider] || provider}'s dashboard — ${amount(refundedCents)}${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : ''}`, restocked },
  })
  return 'refunded'
}

// ── Part refunds ─────────────────────────────────────────────────────────────
/**
 * REFUND PART OF AN ORDER. (E2E Run 2: "There is no way to refund one item — Refund sends back the whole $40.71.")
 * As Shopify does it: pick the units (and, if it is going back, the shipping), the store suggests what they are worth,
 * the owner may change the amount, and only that goes back to the card. Each refund is a row of order_refunds.
 *
 *   1. RESERVE, in one transaction: the order's refundedCents and each line's refundedQuantity go up and the row is
 *      written 'pending' — conditional on the order still standing where it was read (status, refundedCents, no whole
 *      refund under way), so two people at once can never refund past the total or past a line's units.
 *   2. ASK the provider, with the row's own idempotency key (refund-<id>).
 *   3. SETTLE: the row becomes refunded (or recorded, for a provider whose refund is not built here), the chosen units
 *      go back on the shelf, and an order with nothing left to refund is marked refunded. Exactly once.
 *   A refusal gives the reservation back (the row reads failed). No answer at all keeps it pending: it may have gone
 *   through, so it is asked again — same key, same refund — by Try again or by resumePendingRefunds.
 */
const PART_KEY = (refundId: string) => `refund-${refundId}`
// Raw on purpose: inside an UPDATE of orders, "orders"."id" is the row being updated.
const noPartInFlight = sql`not exists (select 1 from "order_refunds" r where r."order_id" = "orders"."id" and r."status" = 'pending')`
async function partInFlight(orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: orderRefunds.id }).from(orderRefunds)
    .where(and(eq(orderRefunds.orderId, orderId), eq(orderRefunds.status, 'pending'))).limit(1)
  return !!row
}
const partInFlightRefusal = (c: any) => c.json({
  error: 'A refund on this order is still on its way to the payment provider. Wait for it to finish (or press Try again on it), then refund the rest.',
  code: 'refund_in_progress',
}, 409)

async function whoIs(c: any): Promise<{ userId: string | null; name: string | null }> {
  const id = (c.get('user') as any)?.userId as string | undefined
  if (!id) return { userId: null, name: null }
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1)
  return { userId: id, name: u?.name || u?.email || null }
}

const partSchema = z.object({
  items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1) })).max(200).default([]),
  shippingCents: z.number().int().min(0).default(0),
  // Absent: the suggested amount. The owner may refund more or less than the units are worth (a goodwill refund).
  amountCents: z.number().int().min(1).optional(),
  restock: z.boolean().default(true),
  reason: z.string().trim().max(500).optional().nullable(),
})
type PartInput = z.infer<typeof partSchema>

export type RefundQuote = {
  suggestedCents: number
  // What can still be sent back, and the shipping still unrefunded.
  maxCents: number
  shippingLeftCents: number
  lines: { orderItemId: string; productName: string; variantName: string; quantity: number; refundedQuantity: number; unitPriceCents: number }[]
}

/**
 * What the chosen units are worth back. A unit's share of what the shopper paid for goods — the total less shipping,
 * so the discount and the tax come off in the same proportion as they went on — plus the shipping chosen. Choosing
 * everything that is left suggests exactly what is left, so rounding can never strand a cent.
 */
export function quoteRefund(
  order: Pick<typeof orders.$inferSelect, 'subtotalCents' | 'shippingCents' | 'totalCents' | 'refundedCents'>,
  items: Pick<typeof orderItems.$inferSelect, 'id' | 'productName' | 'variantName' | 'quantity' | 'refundedQuantity' | 'unitPriceCents'>[],
  shippingRefundedCents: number,
  input: { items: { orderItemId: string; quantity: number }[]; shippingCents: number },
): { ok: true; quote: RefundQuote } | { ok: false; error: string } {
  const maxCents = Math.max(0, order.totalCents - order.refundedCents)
  const shippingLeftCents = Math.max(0, order.shippingCents - shippingRefundedCents)
  const lines = items.map((it) => ({ orderItemId: it.id, productName: it.productName, variantName: it.variantName, quantity: it.quantity, refundedQuantity: it.refundedQuantity, unitPriceCents: it.unitPriceCents }))
  const byId = new Map(items.map((it) => [it.id, it]))
  const asked = new Map<string, number>()
  for (const l of input.items) asked.set(l.orderItemId, (asked.get(l.orderItemId) || 0) + l.quantity)
  const goodsPaid = Math.max(0, order.totalCents - order.shippingCents)
  let suggested = 0
  for (const [id, qty] of asked) {
    const it = byId.get(id)
    if (!it) return { ok: false, error: 'One of the items is not on this order.' }
    const left = it.quantity - it.refundedQuantity
    if (qty > left) return { ok: false, error: left > 0 ? `Only ${left} of ${it.productName} can still be refunded.` : `${it.productName} has already been refunded.` }
    suggested += order.subtotalCents > 0 ? Math.round((it.unitPriceCents * qty * goodsPaid) / order.subtotalCents) : 0
  }
  if (input.shippingCents > shippingLeftCents) return { ok: false, error: `Only ${formatCents(shippingLeftCents)} of the shipping can still be refunded.` }
  suggested += input.shippingCents
  const everything = items.every((it) => (asked.get(it.id) || 0) === it.quantity - it.refundedQuantity) && input.shippingCents === shippingLeftCents
  if (everything) suggested = maxCents
  return { ok: true, quote: { suggestedCents: Math.min(suggested, maxCents), maxCents, shippingLeftCents, lines } }
}

async function shippingRefunded(orderId: string): Promise<number> {
  const [row] = await db.select({ cents: sql<number>`coalesce(sum(${orderRefunds.shippingCents}), 0)` }).from(orderRefunds)
    .where(and(eq(orderRefunds.orderId, orderId), sql`${orderRefunds.status} <> 'failed'`))
  return Number(row?.cents ?? 0)
}

const refundsForCaller = (c: any, rows: (typeof orderRefunds.$inferSelect)[]) =>
  rows.map((r) => (may(c, 'orders:refund') ? r : (({ providerRefundId: _p, ...rest }) => rest)(r)))

async function orderWithRefunds(c: any, id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
  if (!order) return null
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id))
  const refunds = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, id)).orderBy(asc(orderRefunds.createdAt))
  return orderForCaller(c, { ...order, items, refunds: refundsForCaller(c, refunds) })
}

const partOpen = (status: string) => COUNTED.includes(status)
const partClosedRefusal = (c: any, status: string) => c.json({
  error: status === 'pending' ? 'This order was never paid, so there is nothing to refund.' : `This order is ${status}; there is nothing left to refund.`,
  code: 'nothing_to_refund',
}, 409)

/** What the chosen units would come to — the dialog asks as the owner picks. Nothing is written. */
admin.post('/:id/refunds/quote', requirePermission('orders:refund'), async (c) => {
  const body = partSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Choose the items and how many of each to refund.' }, 400)
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  const q = quoteRefund(order, items, await shippingRefunded(order.id), body.data)
  if (!q.ok) return c.json({ error: q.error, code: 'invalid_refund' }, 400)
  return c.json({ quote: q.quote })
})

/** Settle a part refund the provider has answered (or that is only recorded). Exactly once: WHERE status = 'pending'. */
async function settlePart(refundId: string, money: MoneyBack): Promise<{ restocked: number; closed: boolean } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(orderRefunds).set({
      status: money.kind === 'refunded' ? 'refunded' : 'recorded', moneyBack: money.kind, error: null, settledAt: new Date(),
      providerRefundId: money.kind === 'refunded' ? money.refundId : null,
    }).where(and(eq(orderRefunds.id, refundId), eq(orderRefunds.status, 'pending'))).returning()
    if (!row) return null
    let restocked = 0
    if (row.restock) {
      for (const l of row.items) {
        const [it] = await tx.select({ variantId: orderItems.variantId }).from(orderItems).where(eq(orderItems.id, l.orderItemId)).limit(1)
        if (!it?.variantId) continue
        const [back] = await tx.update(productVariants)
          .set({ inventoryQty: sql`${productVariants.inventoryQty} + ${l.quantity}`, updatedAt: new Date() })
          .where(and(eq(productVariants.id, it.variantId), sql`${productVariants.inventoryQty} is not null`))
          .returning({ id: productVariants.id })
        if (back) restocked += l.quantity
      }
    }
    // Nothing left to send back: the order is refunded, as a whole refund would have left it.
    const [closed] = await tx.update(orders).set({
      status: 'refunded', updatedAt: new Date(),
      ...(money.kind === 'refunded' ? { refundId: money.refundId, refundedAt: new Date() } : {}),
    }).where(and(eq(orders.id, row.orderId), sql`${orders.refundedCents} >= ${orders.totalCents}`, sql`${orders.status} in ('paid','fulfilled','shipped','delivered')`))
      .returning({ id: orders.id })
    return { restocked, closed: !!closed }
  })
}

/** A refusal: the reservation is given back and the row reads failed. Exactly once: WHERE status = 'pending'. */
async function abandonPart(refundId: string, reason: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(orderRefunds).set({ status: 'failed', error: reason, settledAt: new Date() })
      .where(and(eq(orderRefunds.id, refundId), eq(orderRefunds.status, 'pending'))).returning()
    if (!row) return false
    await tx.update(orders).set({ refundedCents: sql`greatest(0, ${orders.refundedCents} - ${row.amountCents})`, updatedAt: new Date() })
      .where(eq(orders.id, row.orderId))
    for (const l of row.items) {
      await tx.update(orderItems).set({ refundedQuantity: sql`greatest(0, ${orderItems.refundedQuantity} - ${l.quantity})` })
        .where(eq(orderItems.id, l.orderItemId))
    }
    return true
  })
}

const partDescription = (row: typeof orderRefunds.$inferSelect, items: { id: string; productName: string }[], currency: string) => {
  const names = new Map(items.map((i) => [i.id, i.productName]))
  const what = [
    ...row.items.map((l) => `${l.quantity} × ${names.get(l.orderItemId) || 'item'}`),
    ...(row.shippingCents > 0 ? [`shipping ${formatCents(row.shippingCents, currency)}`] : []),
  ]
  return `${formatCents(row.amountCents, currency)}${what.length ? ` (${what.join(', ')})` : ''}`
}

/** Ask the provider for a reserved part refund, then settle, give back, or leave it pending. The shared tail. */
async function sendPart(order: typeof orders.$inferSelect, row: typeof orderRefunds.$inferSelect, c: any | null, why: string) {
  const money = await returnPayment(order, { amountCents: row.amountCents, idempotencyKey: PART_KEY(row.id), reason: row.reason })
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  const what = partDescription(row, items, order.currency)
  if (money.kind === 'failed') {
    if (money.refused) {
      await abandonPart(row.id, money.reason)
      await audit.log({ action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber, metadata: { description: `${why} refused — ${what}: ${money.reason}. Nothing was sent back.`, refundRowId: row.id }, ...(c ? { req: c } : {}) })
    } else {
      await db.update(orderRefunds).set({ error: money.reason }).where(and(eq(orderRefunds.id, row.id), eq(orderRefunds.status, 'pending')))
    }
    return { money, settled: null }
  }
  const settled = await settlePart(row.id, money)
  if (settled) {
    const sent = money.kind === 'refunded' ? (money.alreadyRefunded ? ', already refunded at the provider' : ', sent back to the card') : ', recorded only — no money sent back here'
    await audit.log({
      action: 'update', entity: 'order', entityId: order.id, entityName: order.orderNumber,
      ...(settled.closed ? { changes: { status: { old: order.status, new: 'refunded' } } } : {}),
      metadata: {
        description: `${why} — ${what}${sent}${settled.restocked ? `, ${settled.restocked} unit${settled.restocked === 1 ? '' : 's'} back in stock` : ''}${settled.closed ? '; nothing left to refund, so the order is refunded' : ''}`,
        amountCents: row.amountCents, refundRowId: row.id, restocked: settled.restocked,
        ...(money.kind === 'refunded' ? { refundId: money.refundId, refundStatus: money.status } : { moneyBack: money.kind }),
      },
      ...(c ? { req: c } : {}),
    })
    if (money.kind === 'refunded' && !money.alreadyRefunded) void notifyRefund(order, row, items)
  }
  return { money, settled }
}

// Tell the shopper what came back. Non-blocking; only when money was actually sent here.
async function notifyRefund(order: typeof orders.$inferSelect, row: { amountCents: number; shippingCents: number; items: RefundLine[] }, items: (typeof orderItems.$inferSelect)[], cancelled = false) {
  try {
    const [settings] = await db.select().from(storeSettings).limit(1)
    const byId = new Map(items.map((i) => [i.id, i]))
    await sendRefundIssued({
      order: { orderNumber: order.orderNumber, customerEmail: order.customerEmail, customerName: order.customerName, currency: order.currency },
      lines: row.items.map((l) => ({ productName: byId.get(l.orderItemId)?.productName || 'Item', variantName: byId.get(l.orderItemId)?.variantName || '', quantity: l.quantity })),
      shippingCents: row.shippingCents, amountCents: row.amountCents, cancelled,
      storeName: settings?.companyName || 'Our Store', supportEmail: settings?.supportEmail,
    })
  } catch { /* non-blocking */ }
}

// A whole refund (or a cancel) settled: the shopper is told about the row settleRefund just wrote.
async function notifyLastRefund(orderId: string, cancelled: boolean) {
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    const [row] = await db.select().from(orderRefunds).where(eq(orderRefunds.orderId, orderId)).orderBy(desc(orderRefunds.createdAt)).limit(1)
    if (!order || !row || row.amountCents <= 0) return
    await notifyRefund(order, row, await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)), cancelled)
  } catch { /* non-blocking */ }
}

admin.post('/:id/refunds', requirePermission('orders:refund'), async (c) => {
  const body = partSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: 'Choose the items and how many of each to refund.' }, 400)
  const input: PartInput = body.data
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  if (!partOpen(order.status)) return partClosedRefusal(c, order.status)
  if (order.refundPendingAt) return partInFlightRefusal(c)
  if (await partInFlight(order.id)) return partInFlightRefusal(c)
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  const q = quoteRefund(order, items, await shippingRefunded(order.id), input)
  if (!q.ok) return c.json({ error: q.error, code: 'invalid_refund' }, 400)
  const amountCents = input.amountCents ?? q.quote.suggestedCents
  if (amountCents <= 0) return c.json({ error: 'Choose at least one item, the shipping, or an amount to refund.', code: 'invalid_refund' }, 400)
  if (amountCents > q.quote.maxCents) return c.json({ error: `At most ${formatCents(q.quote.maxCents, order.currency)} can still be refunded on this order.`, code: 'invalid_refund', maxCents: q.quote.maxCents }, 400)

  // 1. Reserve. A line asked twice is one line.
  const merged = new Map<string, number>()
  for (const l of input.items) merged.set(l.orderItemId, (merged.get(l.orderItemId) || 0) + l.quantity)
  const lines: RefundLine[] = [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
  const by = await whoIs(c)
  class Moved extends Error {}
  let row: typeof orderRefunds.$inferSelect
  try {
    row = await db.transaction(async (tx) => {
      const [held] = await tx.update(orders).set({ refundedCents: sql`${orders.refundedCents} + ${amountCents}`, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.status, order.status), eq(orders.refundedCents, order.refundedCents),
          sql`${orders.refundPendingAt} is null`, sql`${orders.refundedCents} + ${amountCents} <= ${orders.totalCents}`, noPartInFlight))
        .returning({ id: orders.id })
      if (!held) throw new Moved()
      for (const l of lines) {
        const [ok] = await tx.update(orderItems).set({ refundedQuantity: sql`${orderItems.refundedQuantity} + ${l.quantity}` })
          .where(and(eq(orderItems.id, l.orderItemId), eq(orderItems.orderId, order.id), sql`${orderItems.refundedQuantity} + ${l.quantity} <= ${orderItems.quantity}`))
          .returning({ id: orderItems.id })
        if (!ok) throw new Moved()
      }
      const [r] = await tx.insert(orderRefunds).values({
        orderId: order.id, amountCents, shippingCents: input.shippingCents, items: lines, restock: input.restock,
        reason: input.reason || null, status: 'pending', createdBy: by.userId, createdByName: by.name,
      }).returning()
      return r
    })
  } catch (e) {
    if (!(e instanceof Moved)) throw e
    return c.json({ error: 'Someone else just refunded or changed this order, so this refund was not made. Reload the order to see what is left.', code: 'order_changed' }, 409)
  }

  // 2 + 3.
  const { money, settled } = await sendPart(order, row, c, 'Part refund')
  const after = await orderWithRefunds(c, order.id)
  if (money.kind === 'failed') {
    return c.json(money.refused
      ? { error: `The refund was refused, so nothing was sent back and nothing was restocked. ${money.reason}`, code: 'refund_failed', order: after }
      : { error: `We could not hear back from the payment provider, so this refund is waiting. It will be tried again automatically — or press Try again. It will never be sent twice. ${money.reason}`, code: 'refund_unconfirmed', order: after }, 502)
  }
  return c.json({ order: after, refund: money, restocked: settled?.restocked ?? 0 })
})

// The order page's Try again, for a part refund the provider did not answer. Same row, same key: never sent twice.
admin.post('/:id/refunds/:refundId/retry', requirePermission('orders:refund'), async (c) => {
  const [row] = await db.select().from(orderRefunds)
    .where(and(eq(orderRefunds.id, c.req.param('refundId')), eq(orderRefunds.orderId, c.req.param('id')))).limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.status !== 'pending') return c.json({ order: await orderWithRefunds(c, row.orderId), refund: null })
  const [order] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1)
  if (!order) return c.json({ error: 'Not found' }, 404)
  const { money } = await sendPart(order, row, c, 'Part refund (tried again)')
  const after = await orderWithRefunds(c, order.id)
  if (money.kind === 'failed') return c.json({ error: `The refund still has not gone through. ${money.reason}`, code: money.refused ? 'refund_failed' : 'refund_unconfirmed', order: after }, 502)
  return c.json({ order: after, refund: money })
})

/** Part refunds left pending by a restart or a provider that did not answer: asked again, same key. */
export async function resumePendingParts(olderThanMs = 2 * 60_000): Promise<number> {
  const stuck = await db.select().from(orderRefunds)
    .where(and(eq(orderRefunds.status, 'pending'), lt(orderRefunds.createdAt, new Date(Date.now() - olderThanMs))))
  for (const row of stuck) {
    try {
      const [order] = await db.select().from(orders).where(eq(orders.id, row.orderId)).limit(1)
      if (order) await sendPart(order, row, null, 'Part refund completed after an interruption')
    } catch (e: any) { console.error('[orders] resuming a part refund failed:', e?.message || e) }
  }
  return stuck.length
}

const fulfillSchema = z.object({
  trackingCarrier: z.string().optional().nullable(),
  trackingNumber: z.string().optional().nullable(),
  internalNote: z.string().optional().nullable(),
  markShipped: z.boolean().optional(),
})

admin.patch('/:id/fulfillment', requirePermission('orders:update'), async (c) => {
  const parsed = fulfillSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid fulfillment' }, 400)
  const [prev] = await db.select().from(orders).where(eq(orders.id, c.req.param('id'))).limit(1)
  if (!prev) return c.json({ error: 'Not found' }, 404)
  // "Save & mark shipped" is a status change too, and the same rules apply to it.
  if (parsed.data.markShipped && !mayMove(prev.status, 'shipped')) return moveRefusal(c, prev.status, 'shipped')
  if (parsed.data.markShipped && !isFulfilment(prev.status, 'shipped') && !may(c, 'orders:refund')) return refundRefusal(c)
  // Tracking set to a value (not cleared) needs a parcel — see hasParcel.
  const tracks = !!(parsed.data.trackingCarrier?.trim() || parsed.data.trackingNumber?.trim())
  if (tracks && !hasParcel(prev)) return noParcelRefusal(c, prev.status)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  delete (patch as any).markShipped
  if (parsed.data.markShipped) { patch.status = 'shipped'; if (!prev.fulfilledAt) patch.fulfilledAt = new Date() }
  // Marking it shipped, or giving it tracking, was decided from the status read above; a cancel or refund landing
  // since keeps the order as it now stands.
  const [updated] = await db.update(orders).set(patch)
    .where(parsed.data.markShipped || tracks ? and(eq(orders.id, prev.id), eq(orders.status, prev.status)) : eq(orders.id, prev.id)).returning()
  if (!updated) {
    const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, prev.id)).limit(1)
    return parsed.data.markShipped ? changedUnderYou(c, now, 'shipped') : changedUnderYou(c, now, 'shipped', 'the tracking was not saved')
  }
  if (parsed.data.markShipped && prev.status !== 'shipped') await logStatusChange(c, prev, updated, 0)
  else {
    // The changes say it ("Tracking number: — → 1Z…"); a description would be read in their place.
    const changes = audit.diff(prev as any, updated as any, ['trackingCarrier', 'trackingNumber', 'internalNote'])
    await audit.log({
      action: 'update', entity: 'order', entityId: updated.id, entityName: updated.orderNumber,
      changes, metadata: changes ? null : { description: 'Fulfilment saved with no change' }, req: c,
    })
  }
  if (parsed.data.markShipped && prev.status !== 'shipped') void notifyShipped(updated)
  return c.json({ order: orderForCaller(c, updated) })
})

/**
 * Rows a back-move left stamped. (Store QA T1, M1: "QA-ROLES-2 now carries a fulfilledAt … that I could not clear.")
 * Under the table above a pending, paid or cancelled order has never been fulfilled — no move reaches those
 * statuses from a fulfilled one — so a stamp on one can only be what the old route left. Cleared once, at startup.
 */
export async function repairFulfilmentStamps(): Promise<number> {
  const rows = await db.update(orders).set({ fulfilledAt: null })
    .where(and(sql`${orders.status} in ('pending','paid','cancelled')`, sql`${orders.fulfilledAt} is not null`))
    .returning({ id: orders.id })
  return rows.length
}
repairFulfilmentStamps()
  .then((n) => { if (n) console.log(`[orders] cleared the fulfilment stamp from ${n} order${n === 1 ? '' : 's'} that never went out`) })
  .catch((err) => console.error('[orders] fulfilment-stamp repair failed:', err?.message || err))

export default admin
