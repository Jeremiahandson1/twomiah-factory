/**
 * Factory Stripe Service
 *
 * Handles operator-level billing for Factory customers:
 * - Create Stripe Checkout sessions (subscription + one-time)
 * - Process webhooks for Factory billing events
 *
 * Uses pre-created Stripe price IDs from config/stripe-prices.ts.
 * This is SEPARATE from the CRM stripe service which handles
 * end-user invoice payments. This handles Twomiah → Customer billing.
 */

import Stripe from 'stripe'
import { STRIPE_PRICES } from '../config/stripe-prices'

const FRONTEND_URL = process.env.PLATFORM_URL || (process.env.NODE_ENV === 'production' ? 'https://twomiah-factory-platform.onrender.com' : 'http://localhost:5173')

let stripe: Stripe | null = null
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
}

// ── Price ID lookups ─────────────────────────────────────────────────────────

// Each vertical has its own top tier. Build=construction, Wrench=fleet,
// Roof=storm, Care=agency. They are all priced the same ($599/mo). Fleet/
// Storm/Agency Stripe SKUs are minted by create-stripe-products.ts. Until
// that script has been re-run on production, the env vars won't exist yet,
// so each top tier falls back to the Construction SKU so checkout keeps
// working. Once the new SKUs are minted, they'll take over automatically.
const CONSTRUCTION_PRICE    = STRIPE_PRICES.STRIPE_PRICE_CONSTRUCTION
const CONSTRUCTION_PRICE_A  = STRIPE_PRICES.STRIPE_PRICE_CONSTRUCTION_ANNUAL

const PLAN_PRICE_MAP: Record<string, { monthly: string; annual: string }> = {
  starter:      { monthly: STRIPE_PRICES.STRIPE_PRICE_STARTER,      annual: STRIPE_PRICES.STRIPE_PRICE_STARTER_ANNUAL },
  pro:          { monthly: STRIPE_PRICES.STRIPE_PRICE_PRO,          annual: STRIPE_PRICES.STRIPE_PRICE_PRO_ANNUAL },
  business:     { monthly: STRIPE_PRICES.STRIPE_PRICE_BUSINESS,     annual: STRIPE_PRICES.STRIPE_PRICE_BUSINESS_ANNUAL },
  construction: { monthly: CONSTRUCTION_PRICE,                      annual: CONSTRUCTION_PRICE_A },
  fleet:        { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_FLEET        || CONSTRUCTION_PRICE,   annual: (STRIPE_PRICES as any).STRIPE_PRICE_FLEET_ANNUAL  || CONSTRUCTION_PRICE_A },
  storm:        { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_STORM        || CONSTRUCTION_PRICE,   annual: (STRIPE_PRICES as any).STRIPE_PRICE_STORM_ANNUAL  || CONSTRUCTION_PRICE_A },
  agency:       { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_AGENCY       || CONSTRUCTION_PRICE,   annual: (STRIPE_PRICES as any).STRIPE_PRICE_AGENCY_ANNUAL || CONSTRUCTION_PRICE_A },
  enterprise:   { monthly: STRIPE_PRICES.STRIPE_PRICE_ENTERPRISE,   annual: STRIPE_PRICES.STRIPE_PRICE_ENTERPRISE_ANNUAL },
  // ── Pricing model v2 (2026-07) — flat website + seat-tiered CRM. Keys minted
  // by create-stripe-products.ts (STRIPE_PRICE_V2_*); read via `as any` so this
  // compiles before the mint script has regenerated stripe-prices.ts. Annual
  // isn't offered in v2 yet — the annual slot points at the monthly price.
  website:      { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_V2_WEBSITE,    annual: (STRIPE_PRICES as any).STRIPE_PRICE_V2_WEBSITE },
  starter10:    { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_V2_STARTER10,  annual: (STRIPE_PRICES as any).STRIPE_PRICE_V2_STARTER10 },
  team25:       { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_V2_TEAM25,     annual: (STRIPE_PRICES as any).STRIPE_PRICE_V2_TEAM25 },
  business50:   { monthly: (STRIPE_PRICES as any).STRIPE_PRICE_V2_BUSINESS50, annual: (STRIPE_PRICES as any).STRIPE_PRICE_V2_BUSINESS50 },
}

const LICENSE_PRICE_MAP: Record<string, string> = {
  starter:      STRIPE_PRICES.STRIPE_PRICE_LICENSE_STARTER,
  pro:          STRIPE_PRICES.STRIPE_PRICE_LICENSE_PRO,
  business:     STRIPE_PRICES.STRIPE_PRICE_LICENSE_BUSINESS,
  construction: STRIPE_PRICES.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  // Vertical top-tier licenses share the Construction license until their own
  // SKUs are minted. Same $21,564 price point.
  fleet:        (STRIPE_PRICES as any).STRIPE_PRICE_LICENSE_FLEET  || STRIPE_PRICES.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  storm:        (STRIPE_PRICES as any).STRIPE_PRICE_LICENSE_STORM  || STRIPE_PRICES.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  agency:       (STRIPE_PRICES as any).STRIPE_PRICE_LICENSE_AGENCY || STRIPE_PRICES.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  full:         (STRIPE_PRICES as any).STRIPE_PRICE_LICENSE_FULL || STRIPE_PRICES.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  // Pricing model v2 own-it / self-host licenses (one-time = 36× monthly)
  website:      (STRIPE_PRICES as any).STRIPE_PRICE_V2_LICENSE_WEBSITE,
  starter10:    (STRIPE_PRICES as any).STRIPE_PRICE_V2_LICENSE_STARTER10,
  team25:       (STRIPE_PRICES as any).STRIPE_PRICE_V2_LICENSE_TEAM25,
  business50:   (STRIPE_PRICES as any).STRIPE_PRICE_V2_LICENSE_BUSINESS50,
}

const DEPLOY_PRICE_MAP: Record<string, string> = {
  basic:       STRIPE_PRICES.STRIPE_PRICE_DEPLOY_BASIC,
  full:        STRIPE_PRICES.STRIPE_PRICE_DEPLOY_FULL,
  white_glove: STRIPE_PRICES.STRIPE_PRICE_DEPLOY_WHITE_GLOVE,
  'white-glove': STRIPE_PRICES.STRIPE_PRICE_DEPLOY_WHITE_GLOVE,
}

export function getPriceId(planId: string, billingCycle: 'monthly' | 'annual' = 'monthly'): string | null {
  return PLAN_PRICE_MAP[planId]?.[billingCycle] || null
}

export function getLicensePriceId(planId: string): string | null {
  return LICENSE_PRICE_MAP[planId] || null
}

export function getDeployPriceId(serviceId: string): string | null {
  return DEPLOY_PRICE_MAP[serviceId] || null
}

// Pricing model v2 — the optional one-time "True Customization" ($499) charge.
// Minted as STRIPE_PRICE_V2_TRUE_CUSTOMIZATION. Charge it as a one-time via
// createCheckoutSessionForExistingCustomer({ mode: 'payment', priceId }).
export function getV2CustomizationPriceId(): string | null {
  return (STRIPE_PRICES as any).STRIPE_PRICE_V2_TRUE_CUSTOMIZATION || null
}

// ── Stripe customer helper ───────────────────────────────────────────────────

async function ensureCustomer(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; stripeCustomerId?: string }
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')
  if (factoryCustomer.stripeCustomerId) return factoryCustomer.stripeCustomerId
  // Idempotency key keyed on the factory customer id — repeat checkouts before
  // stripe_customer_id is persisted won't mint duplicate Stripe customers.
  const customer = await stripe.customers.create({
    email: factoryCustomer.email,
    name: factoryCustomer.name,
    phone: factoryCustomer.phone || undefined,
    metadata: { twomiah_build_factory_customer_id: factoryCustomer.id },
  }, { idempotencyKey: 'twomiah-customer-' + factoryCustomer.id })
  return customer.id
}

// ── Subscription checkout ────────────────────────────────────────────────────

export async function createSubscriptionCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; products?: string[]; stripeCustomerId?: string; companyId?: string },
  options: { planId?: string; monthlyAmount?: number; billingCycle?: string; trialDays?: number; successUrl?: string; cancelUrl?: string }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const { planId = 'starter', billingCycle = 'monthly', trialDays = 0 } = options
  const cycle = billingCycle === 'annual' ? 'annual' : 'monthly' as const

  const priceId = getPriceId(planId, cycle)
  if (!priceId) throw new Error('No Stripe price configured for plan: ' + planId + ' (' + cycle + ')')

  const stripeCustomerId = await ensureCustomer(factoryCustomer)

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: options.successUrl || (FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success'),
    cancel_url: options.cancelUrl || (FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled'),
    // An "Add promotion code" box on the Stripe page, so a promotion code made in the Stripe dashboard can be used —
    // launch offers, and a 100%-off one-use code to run the real sign-up end to end without a charge. A code that
    // takes the first invoice to $0 still completes the checkout (the card is still collected), and the webhook
    // provisions on checkout.session.completed whatever the amount.
    allow_promotion_codes: true,
    metadata: {
      factory_customer_id: factoryCustomer.id,
      plan_id: planId,
      billing_type: 'subscription',
      billing_cycle: cycle,
    },
  }

  // The subscription carries the tenant on EVERY checkout. This was set only for a trial, and signup stopped
  // offering trials — so customer.subscription.updated and .deleted arrived as "Not a factory subscription": the
  // next billing date was never recorded, and a subscription canceled in Stripe never suspended its tenant.
  // (E2E run 1, 10/14)
  sessionParams.subscription_data = {
    ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    metadata: { factory_customer_id: factoryCustomer.id, plan_id: planId },
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

// ── License checkout (one-time) ──────────────────────────────────────────────

export async function createLicenseCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; stripeCustomerId?: string },
  options: { planId?: string; amount?: number; description?: string }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const { planId = 'pro' } = options

  const priceId = getLicensePriceId(planId)
  if (!priceId) throw new Error('No Stripe price configured for license: ' + planId)

  const stripeCustomerId = await ensureCustomer(factoryCustomer)

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
    metadata: {
      factory_customer_id: factoryCustomer.id,
      plan_id: planId,
      billing_type: 'one_time',
    },
    invoice_creation: { enabled: true },
  })

  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

// ── Premium-website checkout (subscription + one-time build fee) ────────────
//
// The standalone website at a flat $49/mo (STRIPE_PRICE_V2_WEBSITE), no
// build fee. The old $75/mo + $1k-build prices are retired but left minted
// in Stripe for existing subscriptions. Legacy mechanics for reference:
//   - subscription line item: STRIPE_PRICE_PREMIUM_WEBSITE_MONTHLY or _ANNUAL
//   - add_invoice_items:      STRIPE_PRICE_PREMIUM_WEBSITE_BUILD (one-time
//                              fee added to the first invoice)
//   - discounts (optional):   STRIPE_COUPON_PREMIUM_WEBSITE_LAUNCH applied
//                              automatically when the env var is set
//                              (Stripe enforces the coupon's own valid_until
//                              window — if it's expired, Stripe rejects it)
//
// Webhook auto-deploys via the existing checkout.session.completed →
// triggerAutoDeploy path (routes/factory.ts:1777). The tenant's `products`
// column must already include 'website-premium' before payment so the
// generator picks the right template.
export async function createPremiumWebsiteCheckout(
  factoryCustomer: {
    id: string; email?: string; name?: string; phone?: string; stripeCustomerId?: string
  },
  options: {
    billingCycle?: 'monthly' | 'annual'
    intakeId?: string
    // Public self-serve prospects have no platform login — the intake route
    // passes its own public checkout-complete / preview URLs. The platform
    // /tenants/:id defaults below are only right for staff-driven checkouts.
    successUrl?: string
    cancelUrl?: string
  }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const cycle: 'monthly' | 'annual' = options.billingCycle === 'annual' ? 'annual' : 'monthly'

  // Pricing model v2 (2026-07): the standalone website is a flat $49/mo with
  // NO forced build fee — the optional $499 "true customization" is a separate
  // one-time charge, not bundled here. (Old $75/mo + $1k build retired.) Annual
  // isn't offered in v2 yet, so both cycles use the $49 monthly price.
  const recurringPriceId = (STRIPE_PRICES as any).STRIPE_PRICE_V2_WEBSITE as string | undefined
  if (!recurringPriceId) {
    throw new Error('Website price not minted yet — run scripts/create-stripe-products.ts to mint STRIPE_PRICE_V2_WEBSITE.')
  }

  const stripeCustomerId = await ensureCustomer(factoryCustomer)

  // Subscription mode with a one-time setup fee: per Stripe's docs
  // (https://docs.stripe.com/api/checkout/sessions/create — "For
  // subscription mode, there is a maximum of 20 line items with recurring
  // Prices and 20 line items with one-time Prices. Line items with
  // one-time Prices will be on the initial invoice only"), the supported
  // pattern is mixing recurring + one-time prices directly in line_items.
  //
  // `add_invoice_items` does NOT exist on Checkout Sessions — it's a
  // parameter on the raw Subscriptions/Invoices API. Earlier code tried
  // it both under subscription_data and at top level; Stripe rejected
  // both with "Received unknown parameter".
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [
      { price: recurringPriceId, quantity: 1 },
    ],
    success_url: options.successUrl || FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: options.cancelUrl || FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
    metadata: {
      factory_customer_id: factoryCustomer.id,
      product: 'website-premium',
      billing_type: 'subscription',
      billing_cycle: cycle,
      intake_id: options.intakeId || '',
    },
    subscription_data: {
      metadata: {
        factory_customer_id: factoryCustomer.id,
        product: 'website-premium',
      },
    },
  }

  const session = await stripe.checkout.sessions.create(sessionParams)
  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

// ── Deploy service checkout (one-time) ───────────────────────────────────────

export async function createDeployCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; stripeCustomerId?: string },
  options: { serviceId: string }
) {
  if (!stripe) throw new Error('Stripe not configured')

  const priceId = getDeployPriceId(options.serviceId)
  if (!priceId) throw new Error('No Stripe price configured for deploy service: ' + options.serviceId)

  const stripeCustomerId = await ensureCustomer(factoryCustomer)

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
    metadata: {
      factory_customer_id: factoryCustomer.id,
      billing_type: 'deploy_service',
      deploy_service_id: options.serviceId,
    },
    invoice_creation: { enabled: true },
  })

  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

// ── Auto-subscription on deploy ──────────────────────────────────────────────

export async function createAutoSubscription(
  factoryCustomer: {
    id: string; email?: string; name?: string; phone?: string
    stripeCustomerId?: string; plan?: string; monthlyAmount?: number; billingCycle?: string
  }
): Promise<{ stripeCustomerId?: string; subscriptionId?: string } | null> {
  if (!stripe) return null

  const plan = factoryCustomer.plan || 'starter'
  const cycle: 'monthly' | 'annual' = factoryCustomer.billingCycle === 'annual' ? 'annual' : 'monthly'

  const priceId = getPriceId(plan, cycle)
  if (!priceId) {
    console.warn('[Stripe] No price ID for plan:', plan, cycle, '— skipping auto-subscription')
    return null
  }

  const stripeCustomerId = await ensureCustomer(factoryCustomer)

  const subscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: priceId }],
    trial_period_days: 30,
    payment_behavior: 'default_incomplete',
    metadata: { factory_customer_id: factoryCustomer.id, plan_id: plan },
  })

  return { stripeCustomerId, subscriptionId: subscription.id }
}

// What the customer is actually charged each period: list price × quantity, less any
// active subscription discounts. monthly_amount used to be the raw list price, so a
// discounted tenant (a comp, a family rate) showed full price everywhere the factory
// reads it. Webhook payloads carry discounts as ids, so expand them. On any lookup
// failure, fall back to the list price — the previous behaviour — rather than throw.
/**
 * WEBHOOK PAYLOADS ARE SHAPED BY THE ENDPOINT'S API VERSION, NOT THIS SDK'S. (10/14)
 *
 * The Factory endpoint is on 2026-02-25.clover. Since 2025-03-31.basil an invoice names its subscription at
 * parent.subscription_details.subscription (invoice.subscription is gone), a line item says what it is in
 * parent.type (line.type is gone), and a subscription's period end is on each item (sub.current_period_end is
 * gone). Read as the SDK types them, invoice.paid and invoice.payment_failed matched no tenant at all — a
 * renewal was never recorded and a failed card never marked past_due. These read both shapes: the endpoint's,
 * and the older one this SDK's own API calls still return.
 */
export const invoiceSubscriptionId = (invoice: any): string | null => {
  const s = invoice?.subscription ?? invoice?.parent?.subscription_details?.subscription
  return typeof s === 'string' ? s : (s?.id ?? null)
}
export const subscriptionPeriodEnd = (sub: any): number | null =>
  sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null
export const invoicePeriodEnd = (invoice: any): number | null => {
  const lines: any[] = invoice?.lines?.data || []
  const line = lines.find((l) => l?.type === 'subscription' || l?.parent?.type === 'subscription_item_details') || null
  return line?.period?.end ?? null
}

async function effectiveMonthlyAmount(sub: Stripe.Subscription): Promise<number> {
  const item = sub.items.data[0]
  let amount = ((item.price.unit_amount || 0) * (item.quantity || 1)) / 100
  if (!stripe || !(sub.discounts && sub.discounts.length)) return amount
  try {
    const full = await stripe.subscriptions.retrieve(sub.id, { expand: ['discounts'] })
    for (const d of full.discounts || []) {
      const coupon = typeof d === 'string' ? null : d.coupon
      if (!coupon || coupon.valid === false) continue
      if (coupon.percent_off) amount = amount * (1 - coupon.percent_off / 100)
      else if (coupon.amount_off) amount = amount - coupon.amount_off / 100
    }
  } catch (e: any) {
    console.warn('[Stripe] Could not read subscription discounts for', sub.id, '-', e?.message)
  }
  return Math.max(0, Math.round(amount * 100) / 100)
}

// ── Webhook handling ─────────────────────────────────────────────────────────

/**
 * Which tenant a plan subscription event is about. The tenant id on the subscription's metadata when it has one;
 * otherwise the tenant whose stripe_subscription_id IS this subscription — every subscription made before the
 * metadata was set on all checkouts (10/14) has none. An add-on subscription (messaging, AI) carries `addon` and is
 * handled by the webhook route itself, so it is never mistaken for the plan.
 */
function planSubscriptionTarget(sub: Stripe.Subscription): { factoryCustomerId: string } | { lookupField: string; lookupValue: string } | null {
  const meta = sub.metadata || {}
  if (meta.addon) return null
  if (meta.factory_customer_id) return { factoryCustomerId: meta.factory_customer_id }
  return sub.id ? { lookupField: 'stripe_subscription_id', lookupValue: sub.id } : null
}

export async function handleFactoryWebhook(event: Stripe.Event): Promise<{
  handled: boolean; factoryCustomerId?: string; lookupField?: string; lookupValue?: string; updates?: Record<string, any>; reason?: string; crmAddonTenantId?: string
}> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata || {}
      // CRM add-on purchase from a premium tenant's /admin/billing page —
      // the route fires provisioning in the background
      if (meta.addon === 'crm' && meta.tenant_id) {
        return { handled: true, crmAddonTenantId: meta.tenant_id }
      }
      if (!meta.factory_customer_id) return { handled: false, reason: 'Not a factory checkout' }

      const updates: Record<string, any> = { stripe_customer_id: session.customer }
      if (meta.billing_type === 'subscription') {
        updates.billing_type = 'subscription'
        updates.billing_status = 'active'
        updates.stripe_subscription_id = session.subscription
        updates.status = 'active'
        if (meta.billing_cycle) updates.billing_cycle = meta.billing_cycle
        // The first charge date is known now — Settings › Billing showed "Next billing date —" until a renewal.
        // Read from the subscription itself; a failure here never blocks provisioning.
        if (stripe && typeof session.subscription === 'string') {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription)
            const end = subscriptionPeriodEnd(sub)
            if (end) updates.next_billing_date = new Date(end * 1000).toISOString()
          } catch (err: any) { console.warn('[Stripe] Could not read the new subscription for its billing date:', err?.message) }
        }
      } else if (meta.billing_type === 'one_time') {
        updates.billing_type = 'one_time'
        updates.billing_status = 'active'
        updates.paid_at = new Date().toISOString()
        updates.status = 'active'
      } else if (meta.billing_type === 'deploy_service') {
        updates.deploy_service_paid = true
        updates.deploy_service_id = meta.deploy_service_id
      }
      if (meta.plan_id) updates.plan = meta.plan_id
      return { handled: true, factoryCustomerId: meta.factory_customer_id, updates }
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const target = planSubscriptionTarget(sub)
      if (!target) return { handled: false, reason: 'Not a factory subscription' }

      const updates: Record<string, any> = {
        billing_status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status === 'canceled' ? 'canceled' : sub.status,
      }
      if (sub.items?.data?.[0]?.price?.unit_amount) {
        updates.monthly_amount = await effectiveMonthlyAmount(sub)
      }
      const end = subscriptionPeriodEnd(sub)
      if (end) updates.next_billing_date = new Date(end * 1000).toISOString()
      return { handled: true, ...target, updates }
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const target = planSubscriptionTarget(sub)
      if (!target) return { handled: false }
      return {
        handled: true,
        ...target,
        updates: { billing_status: 'canceled', status: 'suspended', stripe_subscription_id: null },
      }
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubscriptionId(invoice)
      if (!subId) return { handled: false }
      // The paid period's end is the next charge — kept current on every renewal, the first one included.
      const periodEnd = invoicePeriodEnd(invoice)
      return {
        handled: true,
        lookupField: 'stripe_subscription_id',
        lookupValue: subId,
        updates: {
          billing_status: 'active', paid_at: new Date().toISOString(),
          ...(periodEnd ? { next_billing_date: new Date(periodEnd * 1000).toISOString() } : {}),
        },
      }
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const subId = invoiceSubscriptionId(invoice)
      if (!subId) return { handled: false }
      return {
        handled: true,
        lookupField: 'stripe_subscription_id',
        lookupValue: subId,
        updates: { billing_status: 'past_due' },
      }
    }

    default:
      return { handled: false, reason: 'Unhandled event: ' + event.type }
  }
}

/**
 * Verify a Stripe webhook signature. We run on Bun, which doesn't allow
 * synchronous SubtleCrypto calls; Stripe's sync constructEvent() crashes
 * with "SubtleCryptoProvider cannot be used in a synchronous context."
 * The async variant works fine — same HMAC SHA-256, just resolved as a
 * Promise. All callers were already in async handlers so this is a
 * drop-in change.
 */
export async function verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<Stripe.Event> {
  if (!stripe) throw new Error('Stripe not configured')
  const secret = process.env.STRIPE_FACTORY_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('Stripe webhook secret not configured (set STRIPE_FACTORY_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET)')
  return await stripe.webhooks.constructEventAsync(payload, signature, secret)
}

/**
 * Verify a Stripe CONNECT webhook (events on connected accounts, delivered to the platform). A Connect
 * endpoint has its own signing secret — STRIPE_CONNECT_WEBHOOK_SECRET, printed by
 * scripts/register-connect-webhook.ts when it creates the endpoint.
 */
export async function verifyConnectWebhookSignature(payload: string | Buffer, signature: string): Promise<Stripe.Event> {
  if (!stripe) throw new Error('Stripe not configured')
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  if (!secret) throw new Error('Stripe Connect webhook secret not configured (set STRIPE_CONNECT_WEBHOOK_SECRET)')
  return await stripe.webhooks.constructEventAsync(payload, signature, secret)
}

export function isConfigured(): boolean {
  return !!stripe
}

export function getPublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY || null
}

export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<{ url: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  if (!stripeCustomerId) throw new Error('Customer has no Stripe ID')
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  })
  return { url: session.url }
}

/**
 * Inline-priced one-time payment Checkout session against an existing
 * customer. Used for the domain registration buy flow — every TLD has
 * its own price + markup that we don't want to pre-mint as a Stripe
 * Price object, so we pass price_data inline.
 *
 * Metadata is the only persistent record of *what* the customer paid
 * for — the webhook handler uses it to know which action to take on
 * checkout.session.completed.
 */
export async function createOneTimeCheckoutSession(opts: {
  customerId: string
  amountCents: number
  currency?: string
  productName: string
  description?: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}): Promise<{ url: string | null; sessionId: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  if (!opts.customerId) throw new Error('customerId required')
  if (!opts.amountCents || opts.amountCents < 50) throw new Error('amountCents must be ≥ 50')
  const session = await stripe.checkout.sessions.create({
    customer: opts.customerId,
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: (opts.currency || 'usd').toLowerCase(),
        unit_amount: opts.amountCents,
        product_data: {
          name: opts.productName,
          ...(opts.description ? { description: opts.description } : {}),
        },
      },
      quantity: 1,
    }],
    payment_intent_data: {
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: opts.metadata,
  })
  return { url: session.url, sessionId: session.id }
}

/**
 * Issue a full refund against a PaymentIntent. Used by the domain
 * registration flow when Namecheap fails to register after the
 * customer has already paid — we'd rather refund + apologize than
 * keep money for a domain they don't have.
 */
export async function refundPaymentIntent(paymentIntentId: string, reason?: string): Promise<{ refundId: string; status: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  if (!paymentIntentId) throw new Error('paymentIntentId required')
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(reason ? { reason: reason as any } : {}),
  })
  return { refundId: refund.id, status: refund.status || 'pending' }
}

/**
 * Refund the most recent PAID invoice of a subscription, in full — the money-back-guarantee refund behind the
 * Factory's "Cancel now". At most once: a payment that already has a refund is reported, not refunded again, so a
 * retried cancel can never pay the customer twice. Nothing paid (a $0 first month, a 100%-off code) is reported too.
 * `client` is the Stripe client — the module's own unless a test hands it a stand-in.
 */
export async function refundLatestSubscriptionPayment(
  subscriptionId: string,
  client: any = stripe,
): Promise<{ refunded: number; refundId?: string; invoiceId?: string; skipped?: string }> {
  if (!client) throw new Error('Stripe not configured')
  const { data } = await client.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 10 })
  const invoice = (data || []).find((i: any) => (i.amount_paid || 0) > 0)
  if (!invoice) return { refunded: 0, skipped: 'nothing has been paid on this subscription' }
  const pi = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id
  if (!pi) return { refunded: 0, invoiceId: invoice.id, skipped: 'the last payment was not a card payment Stripe can refund' }
  const prior = await client.refunds.list({ payment_intent: pi, limit: 1 })
  if (prior?.data?.length) return { refunded: 0, invoiceId: invoice.id, refundId: prior.data[0].id, skipped: 'that payment has already been refunded' }
  const refund = await client.refunds.create({ payment_intent: pi, reason: 'requested_by_customer' }, { idempotencyKey: 'cancel-now-refund-' + invoice.id })
  return { refunded: refund.amount || invoice.amount_paid, refundId: refund.id, invoiceId: invoice.id }
}

/**
 * Bill one year of a domain renewal (services/domainRenewal.ts). A Stripe invoice — so the customer gets a receipt
 * and, if the card fails, a page to pay it on — charged off-session to the card they already pay with: the
 * customer's default, else their subscription's, else any saved card. The renewal itself happens on invoice.paid.
 * Idempotent per tenant + expiry, so a cron that runs twice cannot bill twice.
 */
export async function createDomainRenewalInvoice(
  o: { customerId: string; amountCents: number; domain: string; tenantId: string; expiresAt: string },
  client: any = stripe,
): Promise<{ invoiceId: string; paid: boolean; hostedUrl?: string | null; error?: string }> {
  if (!client) throw new Error('Stripe not configured')
  const idOf = (pm: any) => (typeof pm === 'string' ? pm : pm?.id) || null
  const customer: any = await client.customers.retrieve(o.customerId)
  let pm = idOf(customer?.invoice_settings?.default_payment_method)
  if (!pm) {
    const subs = await client.subscriptions.list({ customer: o.customerId, status: 'all', limit: 10 })
    pm = idOf((subs.data || []).find((s: any) => s.default_payment_method)?.default_payment_method)
  }
  if (!pm) {
    const cards = await client.paymentMethods.list({ customer: o.customerId, type: 'card', limit: 1 })
    pm = idOf(cards.data?.[0])
  }
  const year = new Date(o.expiresAt).getUTCFullYear()
  const description = `Domain renewal — ${o.domain}, one year (renews ${new Date(o.expiresAt).toISOString().slice(0, 10)})`
  const key = 'domain-renewal-' + o.tenantId + '-' + o.expiresAt.slice(0, 10)
  const invoice = await client.invoices.create({
    customer: o.customerId,
    collection_method: 'charge_automatically',
    auto_advance: false,
    pending_invoice_items_behavior: 'exclude',
    description,
    metadata: { purpose: 'domain_renewal', tenant_id: o.tenantId, domain: o.domain, expires_at: o.expiresAt, renewal_year: String(year) },
    ...(pm ? { default_payment_method: pm } : {}),
  }, { idempotencyKey: key })
  await client.invoiceItems.create({ customer: o.customerId, invoice: invoice.id, amount: o.amountCents, currency: 'usd', description }, { idempotencyKey: key + '-item' })
  const finalized = await client.invoices.finalizeInvoice(invoice.id)
  if (!pm) return { invoiceId: invoice.id, paid: false, hostedUrl: finalized.hosted_invoice_url, error: 'no saved card' }
  try {
    const paid = await client.invoices.pay(invoice.id, { payment_method: pm, off_session: true })
    return { invoiceId: invoice.id, paid: paid.status === 'paid', hostedUrl: paid.hosted_invoice_url || finalized.hosted_invoice_url }
  } catch (e: any) {
    return { invoiceId: invoice.id, paid: false, hostedUrl: finalized.hosted_invoice_url, error: e.message }
  }
}

/**
 * Path A++ helper — build a Stripe Checkout session against an existing
 * customer (used for the CRM add-on upgrade, where the customer already
 * has a Premium subscription on the same Stripe customer). The new
 * subscription line is a separate sub on the same customer, so the
 * customer can cancel CRM without affecting their website.
 */
export async function createCheckoutSessionForExistingCustomer(opts: {
  customerId: string
  priceId: string
  mode: 'subscription' | 'payment'
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}): Promise<{ url: string | null; sessionId: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  if (!opts.customerId) throw new Error('customerId required')
  if (!opts.priceId) throw new Error('priceId required')
  const session = await stripe.checkout.sessions.create({
    customer: opts.customerId,
    mode: opts.mode,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    subscription_data: opts.mode === 'subscription' && opts.metadata
      ? { metadata: opts.metadata }
      : undefined,
    metadata: opts.metadata,
  })
  return { url: session.url, sessionId: session.id }
}

async function createCustomer(opts: { email: string; name: string; phone?: string; metadata?: Record<string, string> }): Promise<Stripe.Customer> {
  if (!stripe) throw new Error('Stripe not configured')
  return stripe.customers.create({
    email: opts.email,
    name: opts.name,
    phone: opts.phone || undefined,
    metadata: opts.metadata || {},
  })
}

async function cancelSubscription(subscriptionId: string, opts: { atPeriodEnd?: boolean } = {}): Promise<Stripe.Subscription> {
  if (!stripe) throw new Error('Stripe not configured')
  // atPeriodEnd=true is the offboard path — customer keeps access through the
  // end of the current billing period, no further charges. Immediate cancel
  // is the legacy behavior (atPeriodEnd unset or false).
  if (opts.atPeriodEnd) return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
  return stripe.subscriptions.cancel(subscriptionId)
}

async function reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  if (!stripe) throw new Error('Stripe not configured')
  // Reverses a cancel_at_period_end — restores the subscription so it
  // auto-renews normally. Only valid while subscription is still active
  // (i.e. before the period-end cancel has actually taken effect).
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false })
}

// ── Messaging enable ($10/mo) ────────────────────────────────────────────────
// Flat monthly enable fee on its OWN subscription (separate from the tenant's
// plan). Inline price_data so no pre-minted Stripe price is required. The wallet
// (at-cost usage) is billed separately and must never touch this line.
export async function createMessagingEnableCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; stripeCustomerId?: string },
  amountCents: number,
  // A public signup lands back on twomiah.com, not the staff console (same as subscription checkout).
  urls: { successUrl?: string; cancelUrl?: string } = {},
): Promise<{ sessionId: string; url: string | null; stripeCustomerId: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  const stripeCustomerId = await ensureCustomer(factoryCustomer)
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        recurring: { interval: 'month' },
        product_data: { name: 'Messaging (SMS) — monthly enable' },
      },
      quantity: 1,
    }],
    subscription_data: { metadata: { addon: 'messaging_enable', tenant_id: factoryCustomer.id } },
    success_url: urls.successUrl || FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?messaging=enabled',
    cancel_url: urls.cancelUrl || FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?messaging=canceled',
    metadata: { addon: 'messaging_enable', tenant_id: factoryCustomer.id },
  })
  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

// ── AI enable ($10/mo) ───────────────────────────────────────────────────────
// Same shape as messaging enable — own subscription, inline price_data.
export async function createAiEnableCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; stripeCustomerId?: string },
  amountCents: number,
): Promise<{ sessionId: string; url: string | null; stripeCustomerId: string }> {
  if (!stripe) throw new Error('Stripe not configured')
  const stripeCustomerId = await ensureCustomer(factoryCustomer)
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        recurring: { interval: 'month' },
        product_data: { name: 'AI Assistant — monthly enable' },
      },
      quantity: 1,
    }],
    subscription_data: { metadata: { addon: 'ai_enable', tenant_id: factoryCustomer.id } },
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?ai=enabled',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?ai=canceled',
    metadata: { addon: 'ai_enable', tenant_id: factoryCustomer.id },
  })
  return { sessionId: session.id, url: session.url, stripeCustomerId }
}

export default {
  createSubscriptionCheckout,
  createMessagingEnableCheckout,
  createAiEnableCheckout,
  createLicenseCheckout,
  createDeployCheckout,
  createPremiumWebsiteCheckout,
  createBillingPortalSession,
  createCheckoutSessionForExistingCustomer,
  createOneTimeCheckoutSession,
  refundPaymentIntent,
  refundLatestSubscriptionPayment,
  createDomainRenewalInvoice,
  createAutoSubscription,
  createCustomer,
  cancelSubscription,
  reactivateSubscription,
  handleFactoryWebhook,
  verifyWebhookSignature,
  verifyConnectWebhookSignature,
  isConfigured,
  getPublishableKey,
  getPriceId,
  getLicensePriceId,
  getDeployPriceId,
  STRIPE_PRICES,
}
