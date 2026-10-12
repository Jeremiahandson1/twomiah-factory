import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { orders, orderItems, storeSettings, productVariants } from '../../db/schema.ts'
import { eq, and, desc, sql, isNotNull, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission } from '../middleware/permissions.ts'
import { sendOrderShipped } from '../services/email.ts'
import { getActiveProvider } from '../payments/index.ts'
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
 *   failed        the provider refused; the caller puts the order back and restocks nothing
 */
export type MoneyBack =
  | { kind: 'not_paid' }
  | { kind: 'refunded'; refundId: string | null; status: string; amountCents: number | null; alreadyRefunded?: boolean }
  | { kind: 'manual'; note: string }
  | { kind: 'none_on_file'; note: string }
  | { kind: 'failed'; reason: string }

const PROVIDER_LABEL: Record<string, string> = { stripe: 'Stripe', square: 'Square', paypal: 'PayPal' }

export async function returnPayment(order: typeof orders.$inferSelect): Promise<MoneyBack> {
  if (!order.providerPaymentId) {
    return { kind: 'none_on_file', note: 'No card payment is on record for this order, so no money was sent back here. Return it the way it was paid.' }
  }
  const label = PROVIDER_LABEL[order.provider] || order.provider
  const provider = await getActiveProvider().catch(() => null)
  if (!provider || provider.name !== order.provider || !provider.refund) {
    return { kind: 'manual', note: `This order was paid through ${label}. Refund it in your ${label} dashboard — here it is only recorded as refunded.` }
  }
  try {
    const r = await provider.refund({ providerPaymentId: order.providerPaymentId, idempotencyKey: `order-refund-${order.id}` })
    return { kind: 'refunded', ...r }
  } catch (e: any) {
    return { kind: 'failed', reason: `${label} said: ${String(e?.message || 'no reason given').slice(0, 300)}` }
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
    refundedCount: sql<number>`count(*) filter (where ${orders.status} = 'refunded')`,
    refundedCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'refunded'), 0)`,
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
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id))
  return c.json({ order: orderForCaller(c, { ...order, items }) })
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
  const [updated] = await db.update(orders).set(patch).where(and(eq(orders.id, prev.id), eq(orders.status, prev.status))).returning()
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
    restocked = await settleRefund(prev.id, money)
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
 */
export async function settleRefund(orderId: string, money: MoneyBack): Promise<number> {
  return db.transaction(async (tx) => {
    const [cleared] = await tx.update(orders).set({
      refundPendingAt: null, refundError: null, updatedAt: new Date(),
      ...(money.kind === 'refunded' ? { refundId: money.refundId, refundedAt: new Date() } : {}),
    }).where(and(eq(orders.id, orderId), isNotNull(orders.refundPendingAt))).returning({ id: orders.id })
    if (!cleared) return 0
    let restocked = 0
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    for (const it of items) {
      if (!it.variantId) continue
      restocked += it.quantity
      await tx.update(productVariants)
        .set({ inventoryQty: sql`${productVariants.inventoryQty} + ${it.quantity}`, updatedAt: new Date() })
        .where(and(eq(productVariants.id, it.variantId), sql`${productVariants.inventoryQty} is not null`))
    }
    return restocked
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
  const restocked = await settleRefund(order.id, money)
  const [after] = await db.select().from(orders).where(eq(orders.id, order.id)).limit(1)
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
  return stuck.length
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
 * payment id. A FULL refund of a paid order marks it refunded and restocks, exactly once (WHERE status = what was
 * read). A partial one is written to the audit log and nothing else changes — the store has no partial refunds.
 * Our own refunds come back through here too: by then the order is refunded or cancelled (moved before Stripe was
 * asked, stamp or no stamp), so it is no longer a paid order and is left alone.
 */
export async function applyProviderRefund(provider: string, providerPaymentId: string, refundedCents: number, chargeCents: number): Promise<'refunded' | 'partial' | 'ignored'> {
  const [o] = await db.select().from(orders)
    .where(and(eq(orders.provider, provider as any), eq(orders.providerPaymentId, providerPaymentId))).limit(1)
  if (!o || !COUNTED.includes(o.status)) return 'ignored'
  const amount = (cents: number) => formatCents(cents, o.currency)
  if (refundedCents < chargeCents) {
    await audit.log({
      action: 'update', entity: 'order', entityId: o.id, entityName: o.orderNumber,
      metadata: { description: `Partly refunded in ${PROVIDER_LABEL[provider] || provider}'s dashboard: ${amount(refundedCents)} of ${amount(chargeCents)} — the order is unchanged here` },
    })
    return 'partial'
  }
  const [moved] = await db.update(orders).set({ status: 'refunded', refundPendingAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.id, o.id), eq(orders.status, o.status))).returning()
  if (!moved) return 'ignored'
  const restocked = await settleRefund(o.id, { kind: 'refunded', refundId: null, status: 'succeeded', amountCents: refundedCents, alreadyRefunded: true })
  await audit.log({
    action: 'status_change', entity: 'order', entityId: o.id, entityName: o.orderNumber,
    changes: { status: { old: o.status, new: 'refunded' } },
    metadata: { description: `Refunded in ${PROVIDER_LABEL[provider] || provider}'s dashboard — ${amount(refundedCents)}${restocked ? `, ${restocked} unit${restocked === 1 ? '' : 's'} back in stock` : ''}`, restocked },
  })
  return 'refunded'
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
