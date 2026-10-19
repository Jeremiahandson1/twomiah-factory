// The order's rules the orders, refunds and shipping routes share: where an order may go next, which moves are the
// packing bench's and which are money, which orders have a parcel, what a seat is sent, and the refusals that say so.
// Moved from templates/crm-store/backend/src/routes/orders.ts (NEXT_STATUS, mayMove, isFulfilment, hasParcel,
// orderForCaller, moveRefusal, changedUnderYou, noParcelRefusal, refundRefusal), which routes/shipping.ts imported.
//
// Changes from the template:
//   · what a seat may see is asked with the person's own grants as well as their role (crm/deps.ts canSeeWith): the
//     template's `may` read the role alone, so a grant the owner gave one person by name was ignored here;
//   · the refusals reply through server/http/reply.ts: the sentence and the code are kept, the extra fields are not —
//     moveRefusal's `allowed` (the sentence names the moves), changedUnderYou's `status` (the sentence names it),
//     refundRefusal's `required` (code 'permission_denied'; the sentence names who may).
import type { Context } from 'hono'
import { canSeeWith } from '../../deps.ts'
import { fail } from '../../../http/reply.ts'

/**
 * A status change staff may make: moving a PAID order along the floor — fulfilled, shipped, delivered.
 * Everything else changes whether the order was paid for (cancel, refund, mark paid or pending, reopen a
 * cancelled one, ship one nobody paid for) and is orders:refund, the manager's and the owner's.
 */
export const COUNTED = ['paid', 'fulfilled', 'shipped', 'delivered']
const FULFILMENT = ['fulfilled', 'shipped', 'delivered']
export const isFulfilment = (from: string, to: string) => COUNTED.includes(from) && FULFILMENT.includes(to)
/**
 * WHERE AN ORDER MAY GO NEXT. (Store QA T1, M1)
 *
 *   "A cancelled order moved to paid then shipped (200 each), and a refunded order moved back to paid. Setting the
 *    cancelled order back to cancelled left fulfilledAt populated."
 *
 * The status route checked WHO was asking and never WHERE the order stood, so anything could become anything. That
 * was not cosmetic: cancelling or refunding a paid order puts its units back on the shelf, and nothing takes them out
 * again — so "reopening" one sold stock the shop had already restored, and a refunded order read as paid money that had
 * gone back to the customer. Cancelled and refunded are where an order ends; a mistake there is a new order, not a
 * resurrection. Nothing ships before it is paid.
 *
 * This is the table the order screen has always offered (frontend OrderDetailPage NEXT_STATUS) — the server holds
 * everyone to it. A same-status save is not a move and is allowed.
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
export const moveRefusal = (c: Context, from: string, to: string) => fail(c, 409,
  (NEXT_STATUS[from] || []).length
    ? `An order that is ${from} can be marked ${NEXT_STATUS[from].join(', ')} — not ${to}.`
    : `An order that is ${from} is closed and cannot be marked ${to}. If it should go ahead, take it as a new order.`,
  'invalid_transition')

/**
 * TWO PEOPLE ON ONE ORDER. Every status change reads the order, decides the move is allowed, then writes it. Two at
 * once both read "paid": two refunds each put the units back on the shelf (10 in stock, 3 sold, refunded twice → 13),
 * and a cancel racing "mark shipped" restocked an order that then read shipped. So the write names the status it was
 * decided from — `WHERE status = <what was read>` — and only the one that still finds it there moves the order, puts
 * stock back or emails the customer. The other is told who got there first, and nothing of theirs is applied.
 */
export const changedUnderYou = (c: Context, now: { status: string } | undefined, wanted: string, notDone = `it was not marked ${wanted}`) => fail(c, 409,
  now
    ? `Someone else just marked this order ${now.status}, so ${notDone}. Reload the order to see it as it stands.`
    : 'This order no longer exists.',
  'order_changed')

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
export const noParcelRefusal = (c: Context, status: string) => fail(c, 409,
  `This order is ${status} and never went out, so it has no parcel to track. The internal note can still be saved.`, 'no_parcel')

export const refundRefusal = (c: Context) => fail(c, 403,
  'Cancelling, refunding or changing whether an order was paid is for a manager or the owner.', 'permission_denied')

/** What this seat may see and do with an order's money, asked once per request. */
export interface Seat { refund: boolean; margin: boolean; revenue: boolean }
export async function seatOf(permissions: any, c: Context): Promise<Seat> {
  const u = (c as any).get('user') as { role: string; userId: string }
  const may = canSeeWith(permissions)
  const [refund, margin, revenue] = await Promise.all([
    may(u.role, 'orders:refund', u.userId), may(u.role, 'margin:read', u.userId), may(u.role, 'revenue:read', u.userId),
  ])
  return { refund, margin, revenue }
}

/**
 * What the shop paid its supplier, and the margin over it, is margin:read — the fleet's line for cost. Staff pack the
 * order; they do not need to know what it cost us. (owner's decision, T42)
 * The payment provider's own ids — the checkout session, the payment, the refund — are what a refund is made against,
 * and refunding is orders:refund. Staff pack the order; they are not sent the ids. (Store sweep, 10/12: the fleet round
 * took every Stripe id off the seats that do not need them; the store's orders still carried them.)
 */
export function orderForSeat<T extends Record<string, any> | null | undefined>(seat: Seat, order: T): T {
  if (!order) return order
  let out: any = order
  if (!seat.margin) { const { supplierCostCents: _cost, ...rest } = out; out = rest }
  if (!seat.refund) { const { providerSessionId: _s, providerPaymentId: _p, refundId: _r, ...rest } = out; out = rest }
  if (Array.isArray(out.refunds) && !seat.refund) out = { ...out, refunds: out.refunds.map(({ providerRefundId: _p, ...rest }: any) => rest) }
  return out
}
