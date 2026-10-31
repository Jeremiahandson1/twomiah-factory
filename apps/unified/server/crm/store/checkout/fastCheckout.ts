// Accelerated checkout — the parts of Shop Pay a single shop can build (store_fast_checkout, 2026-10-31, parity row 6):
//   · a signed-in shopper's card kept on the MERCHANT'S OWN Stripe customer, only after they tick "save my card";
//   · that card offered at the next checkout (and from their order history) as one tap: the card is charged at once, no card form;
//   · the card can be removed by the shopper at any time, which detaches it at Stripe.
// Outside party only, and not built: Shop Pay's cross-merchant network of saved shoppers (Shopify's own).
// Stripe only (Square and PayPal have no saved-customer card here). Behind the hidden feature store_fast_checkout.
import { and, eq } from 'drizzle-orm'
import { storeShopperCard } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import type { PaymentProvider } from '../payments/types.ts'

export interface SavedCardView { brand: string; last4: string; expMonth: number; expYear: number }

export function createFastCheckout(d: Pick<CrmDeps, 'db' | 'logger' | 'features'>, core: StoreCore) {
  const { db, logger } = d
  const row = async (companyId: string, contactId: string) => (await db.select().from(storeShopperCard).where(and(eq(storeShopperCard.companyId, companyId), eq(storeShopperCard.contactId, contactId))).limit(1))[0] ?? null
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, 'store_fast_checkout').catch(() => false)

  /** The card to show the shopper — only when the feature is on and a card is really kept and not expired. */
  async function cardOf(companyId: string, contactId: string, now = new Date()): Promise<(SavedCardView & { paymentMethodId: string; customerId: string }) | null> {
    if (!(await enabled(companyId))) return null
    const r = await row(companyId, contactId)
    if (!r || !r.paymentMethodId || !r.consentAt || !r.brand || !r.last4 || r.expMonth == null || r.expYear == null) return null
    // A card is good through the END of its expiry month.
    if (r.expYear < now.getUTCFullYear() || (r.expYear === now.getUTCFullYear() && r.expMonth < now.getUTCMonth() + 1)) return null
    return { paymentMethodId: r.paymentMethodId, customerId: r.stripeCustomerId, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear }
  }

  /**
   * The shopper agreed to keep their card: make (or reuse) their customer on the merchant's account and record the consent.
   * Returns the customer to put on the payment page. Nothing is recorded for a shopper who did not tick the box.
   */
  async function agree(provider: PaymentProvider, companyId: string, shopper: { contactId: string; email: string; name: string | null; shipping?: { name: string; address: any } }): Promise<string | null> {
    if (!provider.ensureCustomer) return null
    const cur = await row(companyId, shopper.contactId)
    const customerId = await provider.ensureCustomer({ email: shopper.email, name: shopper.name, existingId: cur?.stripeCustomerId ?? null, shipping: shopper.shipping })
    if (cur) await db.update(storeShopperCard).set({ stripeCustomerId: customerId, consentAt: cur.consentAt ?? new Date(), updatedAt: new Date() }).where(eq(storeShopperCard.id, cur.id))
    else await db.insert(storeShopperCard).values({ companyId, contactId: shopper.contactId, stripeCustomerId: customerId, consentAt: new Date() }).onConflictDoNothing()
    return customerId
  }

  /** The shopper takes their card away: detached at Stripe first, then forgotten here along with the consent. */
  async function remove(companyId: string, contactId: string): Promise<boolean> {
    const r = await row(companyId, contactId)
    if (!r) return false
    if (r.paymentMethodId) {
      const provider = await core.getActiveProvider(companyId)
      if (provider?.forgetCard) await provider.forgetCard(r.paymentMethodId)
    }
    await db.update(storeShopperCard).set({ paymentMethodId: null, brand: null, last4: null, expMonth: null, expYear: null, consentAt: null, updatedAt: new Date() }).where(eq(storeShopperCard.id, r.id))
    return true
  }

  return { enabled, cardOf, agree, afterPaid: (order: Parameters<typeof keepCardAfterPaid>[2]) => keepCardAfterPaid(d, core, order), remove }
}
export type FastCheckout = ReturnType<typeof createFastCheckout>

/**
 * After an order is paid: if the shopper agreed to keep their card (a consent is on file — it is only ever recorded while the
 * feature is on), read what the payment left on their customer and keep it. Never throws (a paid order does not wait on this);
 * a payment that did not leave a card changes nothing.
 */
export async function keepCardAfterPaid(d: Pick<CrmDeps, 'db' | 'logger'>, core: Pick<StoreCore, 'getActiveProvider'>, order: { companyId: string; contactId: string | null; provider: string; providerPaymentId: string | null }): Promise<void> {
  try {
    if (!order.contactId || order.provider !== 'stripe' || !order.providerPaymentId) return
    const [r] = await d.db.select().from(storeShopperCard).where(and(eq(storeShopperCard.companyId, order.companyId), eq(storeShopperCard.contactId, order.contactId))).limit(1)
    if (!r || !r.consentAt) return
    const provider = await core.getActiveProvider(order.companyId)
    if (!provider?.savedCardOf) return
    const card = await provider.savedCardOf(order.providerPaymentId, r.stripeCustomerId)
    if (!card) return
    await d.db.update(storeShopperCard).set({ paymentMethodId: card.paymentMethodId, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, updatedAt: new Date() }).where(eq(storeShopperCard.id, r.id))
  } catch (e: any) { d.logger.warn('[store] saved card not kept', { error: e?.message }) }
}
