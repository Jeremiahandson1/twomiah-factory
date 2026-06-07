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

// ── Stripe customer helper ───────────────────────────────────────────────────

async function ensureCustomer(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; stripeCustomerId?: string }
): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')
  if (factoryCustomer.stripeCustomerId) return factoryCustomer.stripeCustomerId
  const customer = await stripe.customers.create({
    email: factoryCustomer.email,
    name: factoryCustomer.name,
    phone: factoryCustomer.phone || undefined,
    metadata: { twomiah_build_factory_customer_id: factoryCustomer.id },
  })
  return customer.id
}

// ── Subscription checkout ────────────────────────────────────────────────────

export async function createSubscriptionCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; products?: string[]; stripeCustomerId?: string; companyId?: string },
  options: { planId?: string; monthlyAmount?: number; billingCycle?: string; trialDays?: number }
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
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
    metadata: {
      factory_customer_id: factoryCustomer.id,
      plan_id: planId,
      billing_type: 'subscription',
      billing_cycle: cycle,
    },
  }

  if (trialDays > 0) {
    sessionParams.subscription_data = {
      trial_period_days: trialDays,
      metadata: { factory_customer_id: factoryCustomer.id, plan_id: planId },
    }
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
// The standalone $75/mo + $1k one-time build product. One checkout session
// combines:
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
  options: { billingCycle?: 'monthly' | 'annual'; intakeId?: string }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const cycle: 'monthly' | 'annual' = options.billingCycle === 'annual' ? 'annual' : 'monthly'

  const monthlyPriceId = (STRIPE_PRICES as any).STRIPE_PRICE_PREMIUM_WEBSITE_MONTHLY as string | undefined
  const annualPriceId = (STRIPE_PRICES as any).STRIPE_PRICE_PREMIUM_WEBSITE_ANNUAL as string | undefined
  const buildPriceId = (STRIPE_PRICES as any).STRIPE_PRICE_PREMIUM_WEBSITE_BUILD as string | undefined
  const launchCoupon = (STRIPE_PRICES as any).STRIPE_COUPON_PREMIUM_WEBSITE_LAUNCH as string | undefined

  const recurringPriceId = cycle === 'annual' ? annualPriceId : monthlyPriceId
  if (!recurringPriceId) {
    throw new Error(
      'Premium website price not minted in Stripe yet. Set STRIPE_PRICE_PREMIUM_WEBSITE_' +
      (cycle === 'annual' ? 'ANNUAL' : 'MONTHLY') + ' (and STRIPE_PRICE_PREMIUM_WEBSITE_BUILD) in env, ' +
      'then redeploy. See project_v1_deploy_config memory.'
    )
  }
  if (!buildPriceId) {
    throw new Error('Premium build fee price not set. Mint STRIPE_PRICE_PREMIUM_WEBSITE_BUILD on the Stripe dashboard.')
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
      { price: buildPriceId, quantity: 1 },
    ],
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
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

  // Launch coupon (e.g. $499 off the build fee). Stripe rejects expired
  // coupons automatically — they expire on the coupon's own valid_until,
  // not ours.
  if (launchCoupon) {
    sessionParams.discounts = [{ coupon: launchCoupon }]
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

// ── Webhook handling ─────────────────────────────────────────────────────────

export async function handleFactoryWebhook(event: Stripe.Event): Promise<{
  handled: boolean; factoryCustomerId?: string; lookupField?: string; lookupValue?: string; updates?: Record<string, any>; reason?: string
}> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata || {}
      if (!meta.factory_customer_id) return { handled: false, reason: 'Not a factory checkout' }

      const updates: Record<string, any> = { stripe_customer_id: session.customer }
      if (meta.billing_type === 'subscription') {
        updates.billing_type = 'subscription'
        updates.billing_status = 'active'
        updates.stripe_subscription_id = session.subscription
        updates.status = 'active'
        if (meta.billing_cycle) updates.billing_cycle = meta.billing_cycle
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
      const meta = sub.metadata || {}
      if (!meta.factory_customer_id) return { handled: false, reason: 'Not a factory subscription' }

      const updates: Record<string, any> = {
        billing_status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : sub.status === 'canceled' ? 'canceled' : sub.status,
      }
      if (sub.items?.data?.[0]?.price?.unit_amount) {
        updates.monthly_amount = sub.items.data[0].price.unit_amount / 100
      }
      if (sub.current_period_end) {
        updates.next_billing_date = new Date(sub.current_period_end * 1000).toISOString()
      }
      return { handled: true, factoryCustomerId: meta.factory_customer_id, updates }
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const meta = sub.metadata || {}
      if (!meta.factory_customer_id) return { handled: false }
      return {
        handled: true,
        factoryCustomerId: meta.factory_customer_id,
        updates: { billing_status: 'canceled', status: 'suspended', stripe_subscription_id: null },
      }
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.subscription) return { handled: false }
      return {
        handled: true,
        lookupField: 'stripe_subscription_id',
        lookupValue: invoice.subscription as string,
        updates: { billing_status: 'active', paid_at: new Date().toISOString() },
      }
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.subscription) return { handled: false }
      return {
        handled: true,
        lookupField: 'stripe_subscription_id',
        lookupValue: invoice.subscription as string,
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

export default {
  createSubscriptionCheckout,
  createLicenseCheckout,
  createDeployCheckout,
  createPremiumWebsiteCheckout,
  createBillingPortalSession,
  createCheckoutSessionForExistingCustomer,
  createOneTimeCheckoutSession,
  refundPaymentIntent,
  createAutoSubscription,
  createCustomer,
  cancelSubscription,
  reactivateSubscription,
  handleFactoryWebhook,
  verifyWebhookSignature,
  isConfigured,
  getPublishableKey,
  getPriceId,
  getLicensePriceId,
  getDeployPriceId,
  STRIPE_PRICES,
}
