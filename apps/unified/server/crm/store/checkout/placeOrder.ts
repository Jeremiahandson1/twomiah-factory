// Starting an order: the storefront's checkout (POST /api/public/checkout) and an order the owner makes for a customer
// (a draft order, orders/draftOrders.ts) are priced by this one rule, from the database, never from the browser:
// the variants on sale and their stock, the customer group's prices (a draft for a group member), the discount code and
// the loyalty reward, shipping (or none, for pickup or gift cards alone), tax (the store's rates, or Stripe Tax's at the
// payment page), and a gift card the shopper pays with. The pending order and its lines are written first, so a
// webhook (or the success page) can find them by the provider's session; a checkout that cannot start leaves nothing.
// Moved out of publicRoutes.ts's POST /checkout (2026-10-24, the store upgrade) so the two ways an order begins cannot
// price it two ways.
import { createId } from '@paralleldrive/cuid2'
import { and, eq, inArray } from 'drizzle-orm'
import { discountCode, storeOrder, storeOrderItem, storeProduct, storeProductImage, storeProductVariant } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { groupPrice, type GroupPricing } from '../catalog/groupPricing.ts'
import { cardShare, GIFT_CARD_TAX_CODE, MIN_PROVIDER_CHARGE_CENTS, sellableCardAmount, type StoreGiftCards } from '../giftCards.ts'
import type { PaymentProvider } from '../payments/types.ts'
import { formatCents } from '../lib/money.ts'
import { NO_EMAIL_YET, newRecoveryToken, orderNumberFor, successUrlFor, type CheckoutService } from './checkoutService.ts'

/** How the order reaches the shopper. 'digital' is decided here (a cart of gift cards only), never asked for. */
export type Delivery = 'ship' | 'pickup'

export interface StartInput {
  companyId: string
  items: { sku: string; quantity: number }[]
  customerEmail?: string
  shipTo?: { country?: string; state?: string }
  discountCode?: string
  loyaltyRewardId?: string
  giftCardCode?: string
  delivery?: Delivery
  /** The storefront's origin, from the request (never a body field). */
  origin: string
  /** A draft order: made by the owner for this customer at their group's prices, paid from the emailed link. */
  draft?: { contactId: string; customerName?: string | null; pricing: GroupPricing | null; note?: string | null }
}
export type StartResult =
  | { ok: true; orderId: string; url: string; paidByGiftCard: boolean }
  | { ok: false; status: 400 | 409 | 502 | 503; error: string; code?: string }

// Shipping: first matching zone (by the buyer's ship-to region) wins, else the flat rate. Free-shipping thresholds
// apply per-zone or via the flat threshold.
export function computeShipping(settings: any, subtotalCents: number, shipTo?: { country?: string; state?: string }): number {
  const zones: any[] = settings?.shippingZones || []
  if (shipTo && zones.length) {
    const c = (shipTo.country || '').toUpperCase()
    const s = (shipTo.state || '').toUpperCase()
    const zone = zones.find((z) =>
      (!z.countries?.length || z.countries.map((x: string) => x.toUpperCase()).includes(c)) &&
      (!z.states?.length || z.states.map((x: string) => x.toUpperCase()).includes(s)))
    if (zone) {
      if (zone.freeThresholdCents != null && subtotalCents >= zone.freeThresholdCents) return 0
      return Math.max(0, zone.rateCents || 0)
    }
  }
  const threshold = settings?.freeShippingThresholdCents ?? null
  return threshold !== null && subtotalCents >= threshold ? 0 : (settings?.flatShippingCents ?? 0)
}

// Tax: first matching region rate wins, else the flat taxRateBps.
export function computeTaxBps(settings: any, shipTo?: { country?: string; state?: string }): number {
  const rates: any[] = settings?.taxRates || []
  if (shipTo && rates.length) {
    const c = (shipTo.country || '').toUpperCase()
    const s = (shipTo.state || '').toUpperCase()
    const r = rates.find((r) =>
      (!r.country || r.country.toUpperCase() === c) &&
      (!r.state || r.state.toUpperCase() === s))
    if (r) return Math.max(0, r.rateBps || 0)
  }
  return settings?.taxRateBps ?? 0
}

/**
 * WHO WORKS OUT THE TAX. Stripe Tax, from the address on Stripe's payment page, when the store has it on AND takes
 * payment through Stripe (Square and PayPal have no Stripe Tax); otherwise the store's own rates. Never both.
 */
export const usesStripeTax = (settings: { stripeTaxEnabled?: boolean | null } | null | undefined, provider: Pick<PaymentProvider, 'name'> | null) =>
  !!settings?.stripeTaxEnabled && provider?.name === 'stripe'

/**
 * THE PICTURE A PAYMENT PAGE MAY SHOW. Stripe takes a product image only as a public https address; a picture Stripe
 * cannot fetch (the seeded products' data: placeholders) is left off, and the shopper still pays. (Live, 10/12.)
 */
export const checkoutImageUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href : undefined } catch { return undefined }
}

type Line = {
  sku: string; name: string; description?: string; imageUrl?: string
  unitPriceCents: number; quantity: number; giftCard: boolean
  productId: string; variantId: string; variantName: string; productName: string
}

export function createOrderStarter(d: CrmDeps, core: StoreCore, checkout: CheckoutService, giftCards: StoreGiftCards) {
  const { db, logger } = d
  const refuse = (status: 400 | 409 | 502 | 503, error: string, code?: string): StartResult => ({ ok: false, status, error, ...(code ? { code } : {}) })

  async function start(input: StartInput): Promise<StartResult> {
    const { companyId } = input
    const provider = await core.getActiveProvider(companyId)
    const settings = await core.settings(companyId)
    const currency = settings.currency ?? 'usd'
    if (input.delivery === 'pickup' && !settings.pickupEnabled) return refuse(400, 'This store does not offer pickup.', 'no_pickup')

    // Collapse duplicate SKUs, then load the real variants (trusted prices) — of this company's products.
    const wanted = new Map<string, number>()
    for (const it of input.items) wanted.set(it.sku, (wanted.get(it.sku) ?? 0) + it.quantity)
    const found: Array<{ v: typeof storeProductVariant.$inferSelect; p: typeof storeProduct.$inferSelect }> = await db
      .select({ v: storeProductVariant, p: storeProduct })
      .from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(inArray(storeProductVariant.sku, [...wanted.keys()]), eq(storeProduct.companyId, companyId)))
    const lines: Line[] = []
    for (const { v, p } of found) {
      if (p.status !== 'active') continue
      const qty = wanted.get(v.sku)!
      if (v.inventoryQty !== null && v.inventoryQty < qty) return refuse(409, `Only ${v.inventoryQty} of ${p.name} left`)
      const giftCard = p.kind === 'gift_card'
      if (giftCard && !sellableCardAmount(v.priceCents)) return refuse(400, `${p.name} is not on sale at that amount.`)
      lines.push({
        sku: v.sku, name: v.name && v.name !== p.name ? `${p.name} — ${v.name}` : p.name, description: p.tagline ?? undefined,
        unitPriceCents: groupPrice(v.priceCents, v.id, input.draft?.pricing ?? null, giftCard), quantity: qty, giftCard,
        productId: p.id, variantId: v.id, variantName: v.name, productName: p.name,
      })
    }
    if (!lines.length) return refuse(400, 'None of these items are available')

    // A primary image per product: the order keeps the photo as the shop shows it (its own /media address), so the
    // order-received page and the order show it; only the payment page is held to an address it can fetch
    // (checkoutImageUrl, at createCheckout). The line kept only an https picture, so a shop's own photo left the
    // thank-you page with an empty box (store live test, 2026-10-26).
    const prodIds = [...new Set(lines.map((l) => l.productId))]
    const imgs: Array<typeof storeProductImage.$inferSelect> = await db.select().from(storeProductImage).where(inArray(storeProductImage.productId, prodIds))
    for (const li of lines) {
      const img = imgs.find((i) => i.productId === li.productId && i.isPrimary) ?? imgs.find((i) => i.productId === li.productId)
      if (img?.url) li.imageUrl = img.url
    }

    // ── Server-computed totals (never trust the client) ──
    const subtotalCents = lines.reduce((a, li) => a + li.unitPriceCents * li.quantity, 0)
    // A gift card is money, not goods: no discount, no tax and no shipping on it, and a card cannot pay for another.
    const cardLinesCents = lines.filter((l) => l.giftCard).reduce((a, li) => a + li.unitPriceCents * li.quantity, 0)
    const goodsCents = subtotalCents - cardLinesCents
    const fulfillment = goodsCents === 0 && lines.every((l) => l.giftCard) ? 'digital' : input.delivery === 'pickup' ? 'pickup' : 'ship'

    let discountCents = 0
    let appliedCode: string | null = null
    if (input.discountCode && goodsCents > 0) {
      const code = input.discountCode.trim().toUpperCase()
      const [dc] = await db.select().from(discountCode).where(and(eq(discountCode.companyId, companyId), eq(discountCode.code, code))).limit(1)
      if (dc && dc.active && (!dc.expiresAt || dc.expiresAt > new Date()) && (dc.maxUses == null || dc.usedCount < dc.maxUses) && goodsCents >= dc.minSubtotalCents) {
        discountCents = dc.type === 'percent' ? Math.min(goodsCents, Math.round(goodsCents * dc.value / 100)) : Math.min(goodsCents, dc.value)
        appliedCode = dc.code
      }
    }
    // A loyalty reward, priced by the server against this cart; the points are spent when the order is paid.
    let loyaltyDiscountCents = 0
    let loyaltyRewardId: string | null = null
    if (input.loyaltyRewardId && input.customerEmail && goodsCents > 0) {
      try {
        const quoted = await core.quoteRewardForCheckout(companyId, input.customerEmail, input.loyaltyRewardId, goodsCents)
        loyaltyDiscountCents = Math.max(0, Math.min(quoted, goodsCents - discountCents))
        if (loyaltyDiscountCents > 0) loyaltyRewardId = input.loyaltyRewardId
      } catch { /* a loyalty problem must not stop a customer paying */ }
    }
    const totalDiscountCents = Math.min(goodsCents, discountCents + loyaltyDiscountCents)

    const shippingCents = fulfillment === 'ship' ? computeShipping(settings, goodsCents, input.shipTo) : 0
    const automaticTax = usesStripeTax(settings, provider)
    const taxCents = automaticTax ? 0 : Math.round(Math.max(0, goodsCents - totalDiscountCents) * (computeTaxBps(settings, input.shipTo) / 10000))
    const totalCents = subtotalCents - totalDiscountCents + shippingCents + taxCents

    // A gift card pays what it can of the order — never the gift cards in it. Its balance is looked at now and HELD when
    // the order is written (giftCards.hold, the card row locked), so the figure the provider is told is the one taken.
    let card: { id: string; balanceCents: number } | null = null
    if (input.giftCardCode && !input.draft) {
      const c = await giftCards.cards.findCard(companyId, input.giftCardCode)
      if (!c || c.status !== 'active' || c.balanceCents <= 0) return refuse(400, !c ? 'That gift card number was not found.' : c.status !== 'active' ? 'That gift card is no longer active.' : 'That gift card has nothing left on it.', 'gift_card')
      if (!input.customerEmail) return refuse(400, 'Enter your email to pay with a gift card — your receipt goes there.', 'gift_card')
      card = { id: c.id, balanceCents: c.balanceCents }
    }
    const payable = totalCents - cardLinesCents
    const minimum = provider?.name === 'stripe' ? MIN_PROVIDER_CHARGE_CENTS : 1
    const wantFromCard = card ? cardShare(card.balanceCents, payable, minimum) : 0
    if (card && wantFromCard <= 0) return refuse(400, 'A gift card cannot pay for this order (gift cards cannot buy gift cards).', 'gift_card')
    // Stripe Tax adds its tax at the payment page, so an order whose card covers everything before tax still has tax to
    // pay: it goes to the provider with the minimum left on it rather than being taken as paid.
    if (!provider && !(card && wantFromCard >= totalCents && !automaticTax)) return refuse(503, 'This store is not accepting orders yet')

    let contactId: string | null = input.draft?.contactId ?? null
    if (!contactId && input.customerEmail) {
      try { contactId = await core.shopperFor(companyId, { email: input.customerEmail }) } catch (e: any) {
        logger.warn('[store] shopper contact not made at checkout', { error: e?.message })
      }
    }

    // The pending order and its lines, FIRST (see the header). The number is given now, from the id, and kept when paid.
    const orderId = createId()
    const [order] = await db.insert(storeOrder).values({
      id: orderId, companyId, contactId, orderNumber: orderNumberFor(orderId),
      provider: provider?.name ?? 'giftcard', providerSessionId: `pending_${createId()}`, status: 'pending',
      customerEmail: input.customerEmail ?? NO_EMAIL_YET, customerName: input.draft?.customerName ?? null,
      subtotalCents, shippingCents, taxCents,
      discountCents: totalDiscountCents, discountCode: appliedCode, loyaltyRewardId, loyaltyDiscountCents,
      totalCents, currency, fulfillment, taxAutomatic: automaticTax,
      source: input.draft ? 'draft' : 'storefront', customerGroupId: input.draft?.pricing?.groupId ?? null,
      internalNote: input.draft?.note ?? null,
      // A draft is paid from its emailed link, which reopens a payment page each time it is opened (resumeCheckout).
      recoveryToken: input.draft ? newRecoveryToken() : null,
    }).returning()
    await db.insert(storeOrderItem).values(lines.map((li) => ({
      orderId: order.id, productId: li.productId, variantId: li.variantId, productName: li.productName, variantName: li.variantName,
      sku: li.sku, imageUrl: li.imageUrl ?? null, unitPriceCents: li.unitPriceCents, quantity: li.quantity, lineTotalCents: li.unitPriceCents * li.quantity,
    })))
    // The audit log: an order begun (store live test, 2026-10-26: orders left no record there). Unpaid until the provider
    // says so (checkoutService.ts finalizeOrder records "paid").
    await d.audit.log({ action: d.audit.ACTIONS.CREATE, entity: 'store_order', entityId: order.id, entityName: order.orderNumber, companyId,
      metadata: { description: `Order ${order.orderNumber} ${input.draft ? 'made for ' + (input.draft.customerName || 'a customer') : 'started at checkout'} — ${formatCents(totalCents, currency)}, not paid yet` } })
    let heldCents = 0
    const forget = async (why: string) => {
      await giftCards.release({ id: order.id, companyId, giftCardId: card?.id ?? null, giftCardCents: heldCents }, why)
      await db.delete(storeOrder).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
    }

    if (card) {
      try { heldCents = await giftCards.hold(companyId, order.id, card.id, wantFromCard) } catch (e: any) {
        await db.delete(storeOrder).where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
        return refuse(409, e?.message || 'That gift card could not be used.', 'gift_card')
      }
    }
    const storefront = input.origin.replace(/\/+$/, '')

    // Paid in full by the card: there is nothing for a provider to take. The order is paid now.
    if (card && heldCents >= totalCents && !automaticTax) {
      // Nothing went through a provider: the order says it was paid by gift card, which is where a refund goes back.
      const [fresh] = await db.update(storeOrder).set({ provider: 'giftcard', updatedAt: new Date() })
        .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId))).returning()
      await checkout.finalizeOrder(fresh, { type: 'paid', providerSessionId: fresh.providerSessionId, customerEmail: input.customerEmail })
      return { ok: true, orderId: order.id, url: `${storefront}/checkout/success?ref=${encodeURIComponent(order.id)}`, paidByGiftCard: true }
    }
    if (!provider) { await forget('No payment provider'); return refuse(503, 'This store is not accepting orders yet') }
    if (input.draft) return { ok: true, orderId: order.id, url: `${storefront}/api/public/recover/${order.recoveryToken}`, paidByGiftCard: false }

    try {
      const session = await provider.createCheckout({
        lineItems: lines.map((li) => ({
          name: li.name, description: li.description, imageUrl: checkoutImageUrl(li.imageUrl), unitPriceCents: li.unitPriceCents, quantity: li.quantity, sku: li.sku,
          ...(li.giftCard ? { taxCode: GIFT_CARD_TAX_CODE } : {}),
        })),
        currency, shippingCents, taxCents,
        // EVERYTHING taken off — the code, the loyalty reward, and what the gift card pays: the provider charges the rest.
        discountCents: totalDiscountCents + heldCents,
        customerEmail: input.customerEmail,
        collectShippingAddress: fulfillment === 'ship',
        automaticTax,
        // Stripe Tax needs an address; a pickup or gift-card order has no shipping one, so the billing address is asked.
        collectBillingAddress: automaticTax && fulfillment !== 'ship',
        successUrl: successUrlFor(provider.name, storefront, order.id),
        cancelUrl: `${storefront}/cart`,
        clientReferenceId: order.id,
        metadata: { orderId: order.id },
      })
      await db.update(storeOrder).set({ providerSessionId: session.providerSessionId, updatedAt: new Date() })
        .where(and(eq(storeOrder.id, order.id), eq(storeOrder.companyId, companyId)))
      return { ok: true, orderId: order.id, url: session.redirectUrl, paidByGiftCard: false }
    } catch (err: any) {
      // A failed provider call leaves no orphan — and gives the gift card's hold back.
      await forget('Checkout could not start')
      logger.error('[store] checkout failed', { error: err?.message })
      return refuse(502, 'Could not start checkout')
    }
  }

  return { start }
}
export type OrderStarter = ReturnType<typeof createOrderStarter>
