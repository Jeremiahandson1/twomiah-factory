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
  full:         STRIPE_PRICES.STRIPE_PRICE_LICENSE_FULL,
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
  const cycle = (factoryCustomer.billingCycle === 'annual' ? 'annual' : 'monthly') as const

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

export function verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event {
  if (!stripe) throw new Error('Stripe not configured')
  const secret = process.env.STRIPE_FACTORY_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('Stripe webhook secret not configured (set STRIPE_FACTORY_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET)')
  return stripe.webhooks.constructEvent(payload, signature, secret)
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

export default {
  createSubscriptionCheckout,
  createLicenseCheckout,
  createDeployCheckout,
  createBillingPortalSession,
  createAutoSubscription,
  handleFactoryWebhook,
  verifyWebhookSignature,
  isConfigured,
  getPublishableKey,
  getPriceId,
  getLicensePriceId,
  getDeployPriceId,
  STRIPE_PRICES,
}
