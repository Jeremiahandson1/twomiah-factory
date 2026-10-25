// The store's shared services, built once from the app's dependencies and handed to each of its route groups
// (docs/UNIFIED_STORE_PLAN.md): the shop (the company row) and its commerce settings, the merchant's payment, shipping
// and supplier connections, a shopper as a customer (decision 2), the store's loyalty over the shared programme, and
// its messages. Moved from templates/crm-store/backend/src (payments/index.ts, shipping/index.ts, suppliers/index.ts,
// services/loyalty.ts, routes/orders.ts notifyShipped), where each read a module-level `db` and the one store_settings row.
//
// Changes from the template:
//   · everything is the company's (company_id), the business is the company row (its name, email and settings) and the
//     commerce settings are the store_settings row with that company's id, made on first read;
//   · a shopper is a contact (decision 2): found by email (lower-cased, as the template keyed its loyalty) or made as a
//     'customer', and loyalty is the shared programme's member for that contact — the punch card counts orders in its
//     qualifying_visits, the reward's minimum spend is the shared reward's min_subtotal_cents;
//   · the member is locked for the spend-and-earn pass, and a shopper found by email, in server/data/storeCore.ts;
//   · the store's messages go through the app's email service (./emails.ts);
//   · the startup repair of a "Free service" punch-card name is not carried: no unified store has saved one, and the
//     reward name's default is the store's ('Free item') wherever the settings are read.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { currentAccountLock, loyaltyConfig, pointsForSale, punchCardProgress, rewardDiscountCents, canRedeem, type LoyaltyConfig } from '@twomiah/tenant-backend'
import { company, contact, loyaltyMember, loyaltyReward, loyaltyTransaction } from '../../db/schema/index.ts'
import {
  storeSettings, paymentConfig, shippingConfig, supplierConfig, storeOrder, storeOrderItem, variantSupplierMap,
} from '../../db/schema/store.ts'
import { lockLoyaltyMember, contactByEmail, countRewardUse } from '../../data/storeCore.ts'
import type { CrmDeps } from '../deps.ts'
import { decrypt as decryptString, decryptJSON } from '../../core/crypto.ts'
import type { PaymentProvider, ProviderCredentials } from './payments/types.ts'
import { StripeProvider } from './payments/stripe.ts'
import { SquareProvider } from './payments/square.ts'
import { PayPalProvider } from './payments/paypal.ts'
import type { ShippingCredentials, ShippingProvider, Parcel } from './shipping/types.ts'
import { EasyPostProvider } from './shipping/easypost.ts'
import type { SupplierProvider, SupplierCredentials } from './suppliers/types.ts'
import { PrintfulProvider } from './suppliers/printful.ts'
import { CjProvider } from './suppliers/cj.ts'
import { storeTemplates, emailOrder, emailItems } from './emails.ts'

export const DEFAULT_PARCEL: Parcel = { lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 16 }
/** A shop rewards an order with goods, not a "service" — the shared default's word. (Store QA T1, L1) */
export const STORE_LOYALTY_DEFAULTS = { rewardName: 'Free item' }
/** What a shopper's contact is (CrmSettings.contacts.customerType for the store). */
export const SHOPPER_TYPE = 'customer'

export const normalizeEmail = (email: string | null | undefined): string => String(email || '').trim().toLowerCase()
/** A guest checkout with no address yet is nobody. */
const isRealEmail = (email: string) => !!email && email.includes('@') && email !== 'pending@checkout'

export function buildPaymentProvider(provider: string, creds: ProviderCredentials): PaymentProvider | null {
  if (provider === 'stripe') return new StripeProvider(creds)
  if (provider === 'square') return new SquareProvider(creds)
  if (provider === 'paypal') return new PayPalProvider(creds)
  return null
}
export function buildShippingProvider(provider: string, creds: ShippingCredentials): ShippingProvider {
  if (provider === 'easypost') return new EasyPostProvider(creds)
  throw new Error('Unknown shipping provider: ' + provider)
}
export function buildSupplierProvider(provider: string, creds: SupplierCredentials): SupplierProvider {
  if (provider === 'printful') return new PrintfulProvider(creds)
  if (provider === 'cj') return new CjProvider(creds)
  throw new Error('Unknown supplier provider: ' + provider)
}

export interface AvailableReward {
  id: string
  name: string
  description: string | null
  pointsCost: number
  /** What it would take off THIS cart, in cents. */
  discountCents: number
  available: boolean
  reason?: string
  /** A full punch card is paying rather than points. */
  onTheHouse: boolean
}

let registeredWith: unknown = null

export function createStoreCore(d: CrmDeps) {
  const { db, logger } = d
  const mailer: any = d.services.emailService
  if (mailer && registeredWith !== mailer) { mailer.register(storeTemplates); registeredWith = mailer }

  // ── The shop ───────────────────────────────────────────────────────────────
  /** The business: one per tenant database (SPEC §2), the oldest company row. Null before provisioning. */
  async function shop(): Promise<{ id: string; name: string; email: string | null; settings: any } | null> {
    const [co] = await db.select({ id: company.id, name: company.name, email: company.email, settings: company.settings })
      .from(company).orderBy(asc(company.createdAt)).limit(1)
    return co || null
  }
  /** Is the store closed to shoppers? A subscription that has ended locks the admin and closes the shop alike. */
  async function isClosed(): Promise<boolean> {
    return !!(await currentAccountLock(db, company))
  }
  /** The company's commerce settings, the row made with its defaults the first time it is read. */
  async function settings(companyId: string): Promise<typeof storeSettings.$inferSelect> {
    const [row] = await db.select().from(storeSettings).where(eq(storeSettings.companyId, companyId)).limit(1)
    if (row) return row
    await db.insert(storeSettings).values({ companyId }).onConflictDoNothing()
    const [made] = await db.select().from(storeSettings).where(eq(storeSettings.companyId, companyId)).limit(1)
    return made
  }

  // ── Payments, shipping, suppliers: the merchant's own accounts ─────────────
  /** The connected payment provider, its credentials decrypted just in time. At most one at a time. */
  async function getActiveProvider(companyId: string): Promise<PaymentProvider | null> {
    const [cfg] = await db.select().from(paymentConfig).where(and(eq(paymentConfig.companyId, companyId), eq(paymentConfig.connected, true))).limit(1)
    if (!cfg) return null
    const creds = decryptJSON<Omit<ProviderCredentials, 'mode' | 'webhookSecret'>>(cfg.credentialsEnc)
    const full: ProviderCredentials = {
      ...creds,
      webhookSecret: cfg.webhookSecretEnc ? decryptString(cfg.webhookSecretEnc) : undefined,
      publishableKey: cfg.publishableKey ?? creds.publishableKey,
      mode: (cfg.mode as 'test' | 'live') ?? 'test',
    }
    return buildPaymentProvider(cfg.provider, full)
  }
  /** The label carrier; null leaves the store entering tracking by hand. */
  async function getActiveShipping(companyId: string): Promise<{ provider: ShippingProvider; parcel: Parcel; fromAddress: any } | null> {
    const [cfg] = await db.select().from(shippingConfig).where(and(eq(shippingConfig.companyId, companyId), eq(shippingConfig.connected, true))).limit(1)
    if (!cfg) return null
    const creds = decryptJSON<ShippingCredentials>(cfg.credentialsEnc)
    creds.mode = (cfg.mode as 'test' | 'live') ?? 'test'
    return { provider: buildShippingProvider(cfg.provider, creds), parcel: (cfg.defaultParcel as Parcel) || DEFAULT_PARCEL, fromAddress: cfg.fromAddress }
  }
  async function getActiveSupplier(companyId: string): Promise<{ provider: SupplierProvider; autoForward: boolean; creds: SupplierCredentials } | null> {
    const [cfg] = await db.select().from(supplierConfig).where(and(eq(supplierConfig.companyId, companyId), eq(supplierConfig.connected, true))).limit(1)
    if (!cfg) return null
    const creds = decryptJSON<SupplierCredentials>(cfg.credentialsEnc)
    creds.mode = (cfg.mode as 'test' | 'live') ?? 'test'
    return { provider: buildSupplierProvider(cfg.provider, creds), autoForward: cfg.autoForward, creds }
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  /** Send one of the store's messages. Never throws: a message must not fail the order it is about. */
  async function mail(to: string | null | undefined, template: keyof typeof storeTemplates, data: Record<string, unknown>, replyTo?: string | null): Promise<boolean> {
    if (!to) return false
    try {
      await mailer.send(to, template, data, replyTo ? { replyTo } : {})
      return true
    } catch (e: any) {
      logger.warn('[store] email failed', { template, error: e?.message })
      return false
    }
  }
  /** The shopper is told their order shipped (fulfilment, a label, a supplier's tracking). */
  async function notifyShipped(order: typeof storeOrder.$inferSelect): Promise<void> {
    const co = await shop()
    const items = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, order.id))
    await mail(order.customerEmail, 'storeOrderShipped', { order: emailOrder(order), items: emailItems(items), supportEmail: co?.email }, co?.email)
  }

  // ── Dropship forwarding ────────────────────────────────────────────────────
  /**
   * Forward a paid order to the supplier: only when one is connected, auto-forward is on (or a person asked), and EVERY
   * line has a variant → supplier mapping (never part of an order). Unmapped orders are marked so the merchant ships them;
   * a failure is marked with its message and retried by the sweep. Called without waiting from the paid order: a
   * forwarding failure must never block a payment.
   */
  async function forwardOrderToSupplier(companyId: string, orderId: string, opts: { manual?: boolean } = {}): Promise<{ ok: boolean; note?: string }> {
    const active = await getActiveSupplier(companyId)
    if (!active) return { ok: false, note: 'No supplier connected' }
    if (!active.autoForward && !opts.manual) return { ok: false, note: 'Auto-forward is off' }
    const mine = and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))
    const [order] = await db.select().from(storeOrder).where(mine).limit(1)
    if (!order) return { ok: false, note: 'Order not found' }
    if (order.supplierOrderId) return { ok: true, note: 'Already forwarded' }
    if (order.supplierStatus === 'hold' && !opts.manual) return { ok: false, note: 'On hold' }
    if (order.status !== 'paid') return { ok: false, note: 'Order is not in paid status' }
    // A pickup order is collected at the shop, and gift cards are emailed: neither goes to a supplier.
    if (order.fulfillment !== 'ship') return { ok: false, note: order.fulfillment === 'pickup' ? 'Pickup order' : 'Nothing to ship' }
    if (!order.shippingAddress) {
      await db.update(storeOrder).set({ supplierStatus: 'error', supplierError: 'No shipping address on order', updatedAt: new Date() }).where(mine)
      return { ok: false, note: 'No shipping address' }
    }
    const items = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, orderId))
    const variantIds = items.map((i: any) => i.variantId).filter((v: any): v is string => !!v)
    const maps = variantIds.length ? await db.select().from(variantSupplierMap).where(inArray(variantSupplierMap.variantId, variantIds)) : []
    const byVariant = new Map<string, any>(maps.map((m: any) => [m.variantId, m]))
    const unmapped = items.filter((i: any) => !i.variantId || !byVariant.get(i.variantId))
    if (unmapped.length > 0) {
      await db.update(storeOrder).set({ supplierStatus: 'unmapped', updatedAt: new Date() }).where(mine)
      return { ok: false, note: 'Items without a supplier mapping: ' + unmapped.map((i: any) => i.sku || i.productName).join(', ') }
    }
    try {
      const result = await active.provider.placeOrder({
        externalId: order.id,
        recipientName: order.customerName || order.customerEmail || 'Customer',
        email: order.customerEmail ?? null,
        phone: order.customerPhone ?? null,
        address: order.shippingAddress,
        items: items.map((i: any) => ({ supplierVariantRef: byVariant.get(i.variantId)!.supplierVariantRef, quantity: i.quantity, name: i.productName, sku: i.sku || '' })),
      })
      await db.update(storeOrder).set({ supplierOrderId: result.supplierOrderId, supplierStatus: 'placed', supplierCostCents: result.costCents, supplierError: null, updatedAt: new Date() }).where(mine)
      logger.info('[store] supplier order placed', { orderId, supplier: active.provider.name, supplierOrderId: result.supplierOrderId })
      return { ok: true }
    } catch (err: any) {
      const msg = err?.message || 'supplier order failed'
      await db.update(storeOrder).set({ supplierStatus: 'error', supplierError: msg, updatedAt: new Date() }).where(mine)
      logger.warn('[store] supplier forwarding failed', { orderId, error: msg })
      return { ok: false, note: msg }
    }
  }
  /** (1) Retry paid orders that never forwarded or failed; (2) poll tracking for placed orders on providers without webhooks (CJ). */
  async function sweepSupplierOrders(): Promise<void> {
    try {
      const co = await shop()
      if (!co) return
      const active = await getActiveSupplier(co.id)
      if (!active) return
      if (active.autoForward) {
        const retriable = await db.select({ id: storeOrder.id, supplierStatus: storeOrder.supplierStatus }).from(storeOrder)
          .where(and(eq(storeOrder.companyId, co.id), eq(storeOrder.status, 'paid'), isNull(storeOrder.supplierOrderId))).limit(25)
        for (const o of retriable) {
          if (o.supplierStatus === 'hold' || o.supplierStatus === 'unmapped') continue
          await forwardOrderToSupplier(co.id, o.id)
        }
      }
      const placed = await db.select().from(storeOrder)
        .where(and(eq(storeOrder.companyId, co.id), eq(storeOrder.supplierStatus, 'placed'), eq(storeOrder.status, 'paid'))).limit(25)
      for (const o of placed) {
        if (!o.supplierOrderId) continue
        try {
          const t = await active.provider.getTracking(o.supplierOrderId)
          if (t.shipped && t.trackingNumber) {
            const [updated] = await db.update(storeOrder).set({
              status: 'shipped', supplierStatus: 'shipped', trackingCarrier: t.trackingCarrier, trackingNumber: t.trackingNumber,
              fulfilledAt: new Date(), updatedAt: new Date(),
              // still paid AT THE UPDATE: a refund or cancellation since the read keeps its status
            }).where(and(eq(storeOrder.id, o.id), eq(storeOrder.companyId, co.id), eq(storeOrder.status, 'paid'))).returning()
            if (updated) void notifyShipped(updated)
          }
        } catch (err: any) {
          logger.warn('[store] supplier tracking poll failed', { orderId: o.id, error: err?.message })
        }
      }
    } catch (err: any) {
      logger.warn('[store] supplier sweep failed', { error: err?.message })
    }
  }

  // ── A shopper is a customer (decision 2) ───────────────────────────────────
  /** The contact with this email, or null. Lower-cased: Ada@x.com and ada@x.com are one customer. */
  async function findShopper(companyId: string, email: string): Promise<typeof contact.$inferSelect | null> {
    const e = normalizeEmail(email)
    if (!isRealEmail(e)) return null
    return contactByEmail(db, companyId, e)
  }
  /**
   * The shopper's contact, made at checkout when they are new: their name (or the address's local part), email and phone,
   * typed as a customer and sourced from the online store. A later order with a name or phone fills only what is empty.
   */
  async function shopperFor(companyId: string, p: { email: string; name?: string | null; phone?: string | null }): Promise<string | null> {
    const e = normalizeEmail(p.email)
    if (!isRealEmail(e)) return null
    const found = await findShopper(companyId, e)
    if (found) {
      const fill: Record<string, unknown> = {}
      if (p.phone && !found.phone && !found.mobile) fill.phone = p.phone
      if (p.name && (!found.name || found.name === e.split('@')[0])) fill.name = p.name
      if (Object.keys(fill).length) await db.update(contact).set({ ...fill, updatedAt: new Date() } as any).where(eq(contact.id, found.id))
      return found.id
    }
    const [made] = await db.insert(contact).values({
      companyId, type: SHOPPER_TYPE, name: (p.name || '').trim() || e.split('@')[0], email: e, phone: p.phone || null, source: 'online_store',
    } as any).returning({ id: contact.id })
    return made?.id ?? null
  }

  // ── Loyalty: the shared programme, by contact ──────────────────────────────
  async function loyaltySettings(companyId: string): Promise<LoyaltyConfig> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return loyaltyConfig(co?.settings, STORE_LOYALTY_DEFAULTS)
  }
  async function findMember(companyId: string, email: string): Promise<typeof loyaltyMember.$inferSelect | null> {
    const who = await findShopper(companyId, email)
    if (!who) return null
    const [m] = await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, who.id))).limit(1)
    return m || null
  }
  async function ensureMember(companyId: string, contactId: string): Promise<typeof loyaltyMember.$inferSelect | null> {
    const mine = and(eq(loyaltyMember.companyId, companyId), eq(loyaltyMember.contactId, contactId))
    const [existing] = await db.select().from(loyaltyMember).where(mine).limit(1)
    if (existing) return existing
    await db.insert(loyaltyMember).values({ companyId, contactId } as any).onConflictDoNothing()
    const [made] = await db.select().from(loyaltyMember).where(mine).limit(1)
    return made || null
  }
  /**
   * What this shopper could claim against this cart, priced against the cart in front of them: a percentage reward has no
   * fixed value, and a minimum spend cannot be judged without it.
   */
  async function availableRewards(companyId: string, email: string, subtotalCents: number): Promise<{ pointsBalance: number; punchCard: ReturnType<typeof punchCardProgress>; rewards: AvailableReward[] }> {
    const cfg = await loyaltySettings(companyId)
    const member = await findMember(companyId, email)
    const balance = member?.pointsBalance ?? 0
    const progress = punchCardProgress({ qualifyingVisits: member?.qualifyingVisits ?? 0, rewardsEarned: member?.punchRewardsEarned ?? 0 }, cfg)
    if (!cfg.enabled) return { pointsBalance: balance, punchCard: progress, rewards: [] }
    const rows = await db.select().from(loyaltyReward)
      .where(and(eq(loyaltyReward.companyId, companyId), eq(loyaltyReward.active, true))).orderBy(asc(loyaltyReward.pointsCost), asc(loyaltyReward.id))
    const cart = [{ itemId: 'cart', lineTotalCents: Math.max(0, subtotalCents) }]
    const rewards = rows
      // The store's rewards are money off: whoever types the address can spend the balance, a fair risk for a coupon and
      // a poor one for free goods (templates/crm-store). A free-item reward is the bar's and the salon's.
      .filter((r: any) => r.type === 'fixed' || r.type === 'percent')
      .map((r: any) => {
        const onTheHouse = r.pointsCost === 0 && progress.unclaimed > 0
        const discountCents = rewardDiscountCents({ pointsCost: r.pointsCost, type: r.type, value: r.valueCents }, cart)
        let available = true
        let reason: string | undefined
        if (r.pointsCost === 0 && !onTheHouse) {
          available = false
          reason = progress.enabled
            ? `Earned with a full card — ${progress.remaining} more order${progress.remaining === 1 ? '' : 's'} to go.`
            : 'Earned with a punch card, which this shop does not run.'
        } else if (subtotalCents < (r.minSubtotalCents || 0)) {
          available = false
          reason = `Spend at least ${(r.minSubtotalCents / 100).toFixed(2)} to use this.`
        } else {
          const gate = canRedeem({ pointsCost: onTheHouse ? 0 : r.pointsCost, type: r.type, value: r.valueCents }, balance, cart)
          available = gate.ok
          reason = gate.reason
        }
        return { id: r.id, name: r.name, description: r.description, pointsCost: onTheHouse ? 0 : r.pointsCost, discountCents, available, reason, onTheHouse }
      })
    return { pointsBalance: balance, punchCard: progress, rewards }
  }
  /** A reward priced for checkout by the server: 0 when the shopper cannot have it, so a tampered request gets no discount. */
  async function quoteRewardForCheckout(companyId: string, email: string, rewardId: string, subtotalCents: number): Promise<number> {
    const q = await availableRewards(companyId, email, subtotalCents)
    const found = q.rewards.find((r) => r.id === rewardId)
    return found?.available ? found.discountCents : 0
  }
  /**
   * Move the points for an order that has just become paid: spend first (a balance can never be earned and re-spent on
   * the same order), then earn on the goods (subtotal less discounts — never shipping or tax). One locked pass over the
   * member row; each movement keyed to the order (loyalty_tx_once_per_order), so a double call moves nothing twice.
   * Nothing moves at checkout: an abandoned cart must never burn a balance. Never throws: loyalty must not fail a payment
   * that has gone through.
   */
  async function settleLoyaltyForPaidOrder(companyId: string, orderId: string): Promise<{ earned: number; spent: number }> {
    const none = { earned: 0, spent: 0 }
    try {
      const [order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))).limit(1)
      if (!order) return none
      const cfg = await loyaltySettings(companyId)
      if (!cfg.enabled) return none
      const contactId = order.contactId || (await shopperFor(companyId, { email: order.customerEmail, name: order.customerName, phone: order.customerPhone }))
      if (!contactId) return none
      const member = await ensureMember(companyId, contactId)
      if (!member) return none
      const [reward] = order.loyaltyRewardId && order.loyaltyDiscountCents > 0
        ? await db.select().from(loyaltyReward).where(and(eq(loyaltyReward.id, order.loyaltyRewardId), eq(loyaltyReward.companyId, companyId))).limit(1)
        : [undefined]
      // discountCents is the whole amount taken off (code + loyalty); subtracting the loyalty share too would count it twice.
      const points = pointsForSale(Math.max(0, order.subtotalCents - order.discountCents), cfg)
      const counts = cfg.punchCard.visitsRequired > 0
      let spent = 0
      let earned = 0
      await db.transaction(async (tx: any) => {
        const row = await lockLoyaltyMember(tx, member.id, companyId)
        if (!row) return
        let nextBalance = row.pointsBalance
        let nextClaimed = row.punchRewardsEarned
        if (reward) {
          const progress = punchCardProgress({ qualifyingVisits: row.qualifyingVisits, rewardsEarned: row.punchRewardsEarned }, cfg)
          const onTheHouse = reward.pointsCost === 0 && progress.unclaimed > 0
          // Clamped: several open checkouts against one balance cannot drive it negative.
          const take = onTheHouse ? 0 : Math.min(row.pointsBalance, reward.pointsCost)
          const inserted = await tx.insert(loyaltyTransaction).values({
            companyId, memberId: member.id, type: onTheHouse ? 'punch_reward' : 'redeem', points: -take,
            balanceAfter: row.pointsBalance - take, description: reward.name, rewardId: reward.id, orderId: order.id,
          }).onConflictDoNothing().returning({ id: loyaltyTransaction.id })
          if (inserted.length) {
            spent = take
            nextBalance = Math.max(0, row.pointsBalance - take)
            nextClaimed = onTheHouse ? row.punchRewardsEarned + 1 : row.punchRewardsEarned
            await countRewardUse(tx, reward.id, companyId)
          }
        }
        let nextLifetime = row.lifetimePoints
        let nextQualifying = row.qualifyingVisits
        if (points > 0 || counts) {
          const inserted = await tx.insert(loyaltyTransaction).values({
            companyId, memberId: member.id, type: 'earn', points, balanceAfter: nextBalance + points,
            description: `Order ${order.orderNumber || order.id.slice(0, 8)}`, orderId: order.id,
          }).onConflictDoNothing().returning({ id: loyaltyTransaction.id })
          if (inserted.length) {
            earned = points
            nextBalance += points
            nextLifetime += points
            if (counts) nextQualifying += 1
          }
        }
        await tx.update(loyaltyMember).set({
          pointsBalance: nextBalance, lifetimePoints: nextLifetime, qualifyingVisits: nextQualifying, punchRewardsEarned: nextClaimed,
          lastActivityAt: new Date(), updatedAt: new Date(),
        } as any).where(eq(loyaltyMember.id, member.id))
      })
      return { earned, spent }
    } catch (e: any) {
      logger.warn('[store] loyalty settlement failed', { orderId, error: e?.message })
      return none
    }
  }
  /** A member's ledger, newest first. */
  async function memberHistory(companyId: string, memberId: string) {
    return db.select().from(loyaltyTransaction)
      .where(and(eq(loyaltyTransaction.memberId, memberId), eq(loyaltyTransaction.companyId, companyId)))
      .orderBy(desc(loyaltyTransaction.createdAt), desc(loyaltyTransaction.id)).limit(50)
  }

  return {
    shop, isClosed, settings,
    getActiveProvider, getActiveShipping, getActiveSupplier,
    mail, notifyShipped, forwardOrderToSupplier, sweepSupplierOrders,
    findShopper, shopperFor,
    loyaltySettings, findMember, ensureMember, availableRewards, quoteRewardForCheckout, settleLoyaltyForPaidOrder, memberHistory,
  }
}
export type StoreCore = ReturnType<typeof createStoreCore>
