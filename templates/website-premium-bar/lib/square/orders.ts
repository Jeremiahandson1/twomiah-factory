/**
 * lib/square/orders.ts — pickup ordering on our own domain. Our database is
 * the menu and prices the cart; Square only charges the card.
 *
 * The browser never sends a price. It sends item ids + size ids + quantities;
 * the server re-reads the menu, refuses anything 86'd or unpriced, adds sales
 * tax at the rate in settings, and charges exactly that through Square's
 * Payments API with the token from the Web Payments SDK. The order itself
 * lives with us (online_orders + a grill ticket), not in Square.
 */
import type { MenuSectionWithItems } from '../site-data'
import { sizesOf, taxOn } from '../menu/sizes'
import { squareApi, squareConfig, SquareError } from './client'

export const MAX_LINES = 30
export const MAX_QTY = 20

export interface ResolvedLine { itemId: string; sizeId: string; qty: number; note: string; name: string; size: string; priceCents: number }
export interface OrderableItem { id: string; slug: string; name: string; description: string | null; sizes: Array<{ id: string; name: string; priceCents: number }> }
export interface OrderableSection { slug: string; name: string; description: string | null; items: OrderableItem[] }

/** Food only (no carry-out alcohol without a decision), active, not 86'd, with at least one priced size. */
export function orderableMenu(menu: MenuSectionWithItems[]): OrderableSection[] {
  return menu
    .filter(s => (s.kind || 'food') === 'food')
    .map(s => ({
      slug: s.slug, name: s.name, description: s.description,
      items: s.items
        .filter(i => i.isActive && !i.is86ed)
        .map(i => ({
          id: i.id, slug: i.slug, name: i.name, description: i.description,
          sizes: sizesOf(i, s.description)
            .filter(v => typeof v.priceCents === 'number' && v.priceCents > 0)
            .map(v => ({ id: v.id, name: v.name, priceCents: v.priceCents as number })),
        }))
        .filter(i => i.sizes.length > 0),
    }))
    .filter(s => s.items.length > 0)
}

/** Validate a cart against the orderable menu. Returns lines at OUR prices, or an error a customer can read. */
export function resolveCart(raw: unknown, menu: OrderableSection[]): { lines: ResolvedLine[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Your order is empty.' }
  if (raw.length > MAX_LINES) return { error: 'That is a big order. Call the bar and we will set it up.' }
  const items = new Map(menu.flatMap(s => s.items).map(i => [i.id, i]))
  const lines: ResolvedLine[] = []
  for (const r of raw as any[]) {
    const item = items.get(String(r?.itemId || ''))
    if (!item) return { error: 'Something in your order is off the menu tonight. Take it out and try again.' }
    const v = item.sizes.find(x => x.id === String(r?.sizeId || ''))
    if (!v) return { error: `Pick a size for the ${item.name}.` }
    const qty = Math.floor(Number(r?.qty))
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return { error: `Check the quantity on the ${item.name}.` }
    lines.push({ itemId: item.id, sizeId: v.id, qty, note: String(r?.note || '').replace(/\s+/g, ' ').trim().slice(0, 140), name: item.name, size: v.name, priceCents: v.priceCents })
  }
  return { lines }
}

export interface Totals { subtotalCents: number; taxCents: number; totalCents: number }

/** Subtotal, sales tax (rate in basis points), total. Pure. */
export function totals(lines: Array<{ qty: number; priceCents: number }>, taxRateBps: number): Totals {
  const subtotalCents = lines.reduce((s, l) => s + l.qty * l.priceCents, 0)
  const taxCents = taxOn(subtotalCents, taxRateBps)
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

/** ISO-8601 duration kept for pickup-time math elsewhere: 20 → PT20M. */
export function prepDuration(minutes: number): string { return `PT${Math.max(5, Math.min(120, Math.round(minutes)))}M` }

export interface ChargeInput { amountCents: number; sourceId: string; idempotencyKey: string; referenceId: string; note: string; phone?: string | null }

/** Charge the card for exactly our total. Square holds the money; we hold the order. */
export async function charge(input: ChargeInput): Promise<{ squarePaymentId: string }> {
  const cfg = squareConfig()
  if (!cfg) throw new SquareError('Square is not configured', 503)
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new SquareError('Nothing to charge', 400)
  const paid = await squareApi<{ payment: any }>('/v2/payments', 'POST', {
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey.slice(0, 45),
    amount_money: { amount: input.amountCents, currency: 'USD' },
    location_id: cfg.locationId,
    autocomplete: true,
    reference_id: input.referenceId.slice(0, 40),
    note: input.note.slice(0, 500),
    ...(input.phone ? { buyer_phone_number: input.phone } : {}),
  })
  const payment = paid.payment
  if (!payment?.id || !['COMPLETED', 'APPROVED'].includes(payment.status)) throw new SquareError('The card was not charged', 402)
  if (payment.amount_money?.amount !== input.amountCents) throw new SquareError('Square charged a different amount', 502)
  return { squarePaymentId: payment.id }
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
