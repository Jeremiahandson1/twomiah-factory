/**
 * lib/square/orders.ts — pickup ordering on our own domain.
 *
 * The browser never sends a price. It sends menu item ids + variation ids +
 * quantities; the server re-reads the menu, refuses anything 86'd or sold out,
 * and lets Square compute tax and the total (auto_apply_taxes: the tax rates
 * the owner set up in Square are the only tax rates). Then: CreateOrder with a
 * PICKUP fulfillment → CreatePayment against that order with the card token
 * from the Web Payments SDK. A paid order with a fulfillment is what makes it
 * appear on the register / kitchen display.
 */
import type { MenuSectionWithItems } from '../site-data'
import { squareApi, squareConfig, SquareError } from './client'
import type { Variation } from './catalog'

export const MAX_LINES = 30
export const MAX_QTY = 20

export interface CartLine { itemId: string; variationId: string; qty: number; note?: string }
export interface ResolvedLine { itemId: string; variationId: string; qty: number; note: string; name: string; variation: string; priceCents: number }

export interface OrderableItem { id: string; slug: string; name: string; description: string | null; variations: Array<{ id: string; name: string; priceCents: number }> }
export interface OrderableSection { slug: string; name: string; description: string | null; items: OrderableItem[] }

/** Food only (no alcohol carry-out without a decision), active, not 86'd, not sold out, with a priced Square variation. */
export function orderableMenu(menu: MenuSectionWithItems[]): OrderableSection[] {
  return menu
    .filter(s => (s.kind || 'food') === 'food')
    .map(s => ({
      slug: s.slug, name: s.name, description: s.description,
      items: s.items
        .filter(i => i.isActive && !i.is86ed && !i.squareSoldOut)
        .map(i => ({
          id: i.id, slug: i.slug, name: i.name, description: i.description,
          variations: ((Array.isArray(i.variations) ? i.variations : []) as Variation[])
            .filter(v => v.id && typeof v.priceCents === 'number' && v.priceCents > 0 && !v.soldOut)
            .map(v => ({ id: v.id as string, name: v.name, priceCents: v.priceCents as number })),
        }))
        .filter(i => i.variations.length > 0),
    }))
    .filter(s => s.items.length > 0)
}

/** Validate a cart against the orderable menu. Returns the lines with OUR prices, or an error a customer can read. */
export function resolveCart(raw: unknown, menu: OrderableSection[]): { lines: ResolvedLine[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Your order is empty.' }
  if (raw.length > MAX_LINES) return { error: 'That is a big order. Call the bar and we will set it up.' }
  const items = new Map(menu.flatMap(s => s.items).map(i => [i.id, i]))
  const lines: ResolvedLine[] = []
  for (const r of raw as any[]) {
    const item = items.get(String(r?.itemId || ''))
    if (!item) return { error: 'Something in your order is off the menu tonight. Take it out and try again.' }
    const v = item.variations.find(x => x.id === String(r?.variationId || ''))
    if (!v) return { error: `Pick a size for the ${item.name}.` }
    const qty = Math.floor(Number(r?.qty))
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return { error: `Check the quantity on the ${item.name}.` }
    lines.push({ itemId: item.id, variationId: v.id, qty, note: String(r?.note || '').replace(/\s+/g, ' ').trim().slice(0, 140), name: item.name, variation: v.name, priceCents: v.priceCents })
  }
  return { lines }
}

function lineItems(lines: ResolvedLine[]) {
  return lines.map(l => ({
    catalog_object_id: l.variationId,
    quantity: String(l.qty),
    ...(l.note ? { note: l.note } : {}),
  }))
}

export interface Totals { subtotalCents: number; taxCents: number; totalCents: number }

function totalsOf(order: any): Totals {
  const total = order?.total_money?.amount ?? 0
  const tax = order?.total_tax_money?.amount ?? 0
  return { subtotalCents: total - tax - (order?.total_tip_money?.amount ?? 0), taxCents: tax, totalCents: total }
}

/** Price the cart in Square without creating anything. */
export async function quote(lines: ResolvedLine[]): Promise<Totals> {
  const cfg = squareConfig()!
  const res = await squareApi<{ order: any }>('/v2/orders/calculate', 'POST', {
    order: { location_id: cfg.locationId, line_items: lineItems(lines), pricing_options: { auto_apply_taxes: true } },
  })
  return totalsOf(res.order)
}

/** ISO-8601 duration for prep time: 20 → PT20M. */
export function prepDuration(minutes: number): string { return `PT${Math.max(5, Math.min(120, Math.round(minutes)))}M` }

export interface PlaceInput {
  lines: ResolvedLine[]; name: string; phone: string; sourceId: string; idempotencyKey: string
  referenceId: string; prepMinutes: number; pickupNote?: string; now?: Date
}
export interface PlaceResult extends Totals { squareOrderId: string; squarePaymentId: string; pickupAt: Date }

/** Create the pickup order, then charge the card for exactly Square's total. */
export async function placeOrder(input: PlaceInput): Promise<PlaceResult> {
  const cfg = squareConfig()
  if (!cfg) throw new SquareError('Square is not configured', 503)
  const now = input.now || new Date()
  const pickupAt = new Date(now.getTime() + input.prepMinutes * 60000)
  const created = await squareApi<{ order: any }>('/v2/orders', 'POST', {
    idempotency_key: input.idempotencyKey,
    order: {
      location_id: cfg.locationId,
      reference_id: input.referenceId.slice(0, 40),
      source: { name: 'Website' },
      line_items: lineItems(input.lines),
      pricing_options: { auto_apply_taxes: true },
      fulfillments: [{
        type: 'PICKUP',
        state: 'PROPOSED',
        pickup_details: {
          recipient: { display_name: input.name, phone_number: input.phone },
          schedule_type: 'ASAP',
          pickup_at: pickupAt.toISOString(),
          prep_time_duration: prepDuration(input.prepMinutes),
          ...(input.pickupNote ? { note: input.pickupNote.slice(0, 500) } : {}),
        },
      }],
    },
  })
  const order = created.order
  const totals = totalsOf(order)
  if (!order?.id || !totals.totalCents) throw new SquareError('Square did not return an order total', 502)
  const paid = await squareApi<{ payment: any }>('/v2/payments', 'POST', {
    source_id: input.sourceId,
    idempotency_key: (input.idempotencyKey + ':pay').slice(0, 45),
    amount_money: { amount: totals.totalCents, currency: order.total_money?.currency || 'USD' },
    order_id: order.id,
    location_id: cfg.locationId,
    autocomplete: true,
    reference_id: input.referenceId.slice(0, 40),
    note: 'Website pickup order',
  })
  const payment = paid.payment
  if (!payment?.id || !['COMPLETED', 'APPROVED'].includes(payment.status)) throw new SquareError('The card was not charged', 402)
  return { ...totals, squareOrderId: order.id, squarePaymentId: payment.id, pickupAt }
}

/** What a customer sees when a card fails. Square's codes → plain words. */
export function paymentErrorMessage(err: unknown): string {
  const code = err instanceof SquareError ? err.code : ''
  if (/CVV|VERIFY_CVV/.test(code)) return 'The security code on the card did not match.'
  if (/EXPIRATION|INVALID_EXPIRATION/.test(code)) return 'The expiration date on the card did not match.'
  if (/POSTAL|ADDRESS_VERIFICATION/.test(code)) return 'The ZIP code did not match the card.'
  if (/INSUFFICIENT_FUNDS/.test(code)) return 'The card was declined for insufficient funds.'
  if (/DECLINE|CARD_DECLINED|GENERIC_DECLINE|INVALID_CARD|CARD_NOT_SUPPORTED|TRANSACTION_LIMIT/.test(code)) return 'The card was declined. Try another card.'
  return 'We could not take the payment. Nothing was charged. Try again, or call the bar.'
}

// ─── The window: can the website take an order right now? ─────────────────

export interface OrderingState { available: boolean; reason: string | null; prepMinutes: number; lastCallAt: string | null }

/**
 * Orders are ASAP pickup only, while the kitchen is open, and not in the last
 * (prep + 10) minutes before it closes. The console can pause it.
 */
export function orderingWindow(opts: {
  enabled: boolean; kitchen: { isOpen: boolean; closesAt: string | null }
  paused: boolean; pausedUntil: Date | null; prepMinutes: number; now: Date
}): OrderingState {
  const prep = opts.prepMinutes || 20
  const lastCall = opts.kitchen.closesAt ? new Date(new Date(opts.kitchen.closesAt).getTime() - (prep + 10) * 60000) : null
  const base = { prepMinutes: prep, lastCallAt: lastCall ? lastCall.toISOString() : null }
  if (!opts.enabled) return { available: false, reason: 'Online ordering is not open yet.', ...base }
  const pausedNow = opts.paused && (!opts.pausedUntil || opts.pausedUntil.getTime() > opts.now.getTime())
  if (pausedNow) return { available: false, reason: 'The kitchen is not taking online orders right now. Call the bar.', ...base }
  if (!opts.kitchen.isOpen) return { available: false, reason: 'The kitchen is closed.', ...base }
  if (lastCall && opts.now.getTime() >= lastCall.getTime()) return { available: false, reason: 'Too close to kitchen close for an online order. Call the bar.', ...base }
  return { available: true, reason: null, ...base }
}
