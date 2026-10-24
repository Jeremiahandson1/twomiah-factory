import { money } from '@twomiah/tenant-ui/src/money'
// What the orders screens share: the order's shape as server/crm/store/orders answers it, money in integer cents, the
// status badges, and reading a reply (RULEBOOK §3: a list is { data, pagination }; a refusal { error, code?, fields? },
// which the app's client throws as an Error whose `data` is that body). Moved from templates/crm-store/frontend/src
// (services/api.ts's types, lib/format.ts's money / statusColor); dates are the app's crm/date.ts formatDate.

export interface Address { name?: string; line1: string; line2?: string | null; city: string; state?: string | null; postalCode: string; country: string; phone?: string | null }

export interface OrderItem {
  id: string; productName: string; variantName: string; sku: string; imageUrl: string | null
  unitPriceCents: number; quantity: number; lineTotalCents: number; refundedQuantity?: number
}

/** One refund of part (or the rest) of an order — server db/schema/store.ts storeOrderRefund. */
export interface OrderRefund {
  id: string; amountCents: number; shippingCents: number; items: { orderItemId: string; quantity: number }[]; restock: boolean
  reason: string | null; status: 'pending' | 'refunded' | 'recorded' | 'failed' | string; moneyBack: string | null; error: string | null
  createdByName: string | null; createdAt: string; settledAt: string | null
}

/**
 * An order (server/crm/store/orders/rules.ts orderForSeat). A seat without margin:read is not sent supplierCostCents; one
 * without orders:refund is not sent the provider's ids (providerPaymentId, refundId) — each is optional here, and a
 * screen reads its absence as "not yours to see", never as zero.
 */
export interface Order {
  id: string; orderNumber: string | null; provider: string; status: string; contactId?: string | null
  customerEmail: string; customerName: string | null; customerPhone: string | null
  shippingAddress: Address | null
  subtotalCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number; currency: string
  trackingCarrier: string | null; trackingNumber: string | null; internalNote: string | null
  createdAt: string; fulfilledAt?: string | null
  providerPaymentId?: string | null
  refundPendingAt?: string | null; refundId?: string | null; refundedAt?: string | null; refundError?: string | null
  refundedCents?: number
  supplierOrderId?: string | null; supplierStatus?: string | null; supplierCostCents?: number | null; supplierError?: string | null
  labelUrl?: string | null; labelCostCents?: number | null; labelPurchasedAt?: string | null
  /** ship | pickup | digital (gift cards only); storefront | draft (made for a customer); Stripe Tax worked the tax out. */
  fulfillment?: string; source?: string; taxAutomatic?: boolean
  /** What a gift card paid, and what has gone back on it. */
  giftCardCents?: number; giftCardRefundedCents?: number
  /** A chargeback's status at the provider, when there is one. */
  disputeStatus?: string | null
  readyForPickupAt?: string | null; pickedUpAt?: string | null
  /** GET /:id and the part-refund replies carry them; the status, fulfilment and label replies do not. */
  items?: OrderItem[]; refunds?: OrderRefund[]
}

/** What happened to the shopper's money (server/crm/store/orders/refunds.ts MoneyBack). */
export type MoneyBack =
  | { kind: 'not_paid' }
  | { kind: 'refunded'; refundId: string | null; status: string; amountCents: number | null; alreadyRefunded?: boolean; awaiting?: boolean }
  | { kind: 'manual'; note: string }
  | { kind: 'none_on_file'; note: string }
  | { kind: 'failed'; reason: string; refused: boolean }

/** Integer cents as money: 1234 → $12.34 (the order's own currency). */
export function cents(value: number | null | undefined, currency = 'usd'): string {
  const n = Number(value ?? 0)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((Number.isFinite(n) ? n : 0) / 100)
  } catch {
    return `${money(((Number.isFinite(n) ? n : 0) / 100))}`
  }
}

/** Each status's badge, light and dark (bg-X-100 text-X-700, dark:bg-X-950/40 dark:text-X-300). */
const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300',
  paid: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  fulfilled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  shipped: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  // amber, not orange: orange-* is the shop's brand colour, and a status must not change hue with the brand.
  refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  ready_for_pickup: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  picked_up: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
}
export const statusBadge = (status: string) => STATUS_BADGE[status] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'

/** A list reply's rows; anything else is no rows. */
export function listOf<T>(reply: unknown): T[] {
  const data = (reply as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/** A refusal's code (the reply body rides on the thrown error as `data`). */
export function codeOf(err: unknown): string | undefined {
  const code = (err as { data?: { code?: unknown } } | null)?.data?.code
  return typeof code === 'string' ? code : undefined
}

/** A refusal's HTTP status. */
export function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : undefined
}
