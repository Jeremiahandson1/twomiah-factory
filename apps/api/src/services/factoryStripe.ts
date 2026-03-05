/**
 * Factory Stripe Service
 *
 * Handles operator-level billing for Factory customers:
 * - Create Stripe Checkout sessions (subscription + one-time)
 * - Process webhooks for Factory billing events
 *
 * This is SEPARATE from the CRM stripe service which handles
 * end-user invoice payments. This handles Twomiah → Customer billing.
 */

import Stripe from 'stripe'

const FRONTEND_URL = process.env.PLATFORM_URL || 'http://localhost:5173'

let stripe: Stripe | null = null
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
}

const productCache: Record<string, string> = {}

async function getOrCreateProduct(planId: string, planName: string, description: string, type = 'subscription'): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured')
  const cacheKey = type + '_' + planId
  if (productCache[cacheKey]) return productCache[cacheKey]

  const existing = await stripe.products.search({
    query: 'metadata["twomiah_build_plan_id"]:"' + planId + '" AND metadata["twomiah_build_type"]:"' + type + '"',
  })
  if (existing.data.length > 0) {
    productCache[cacheKey] = existing.data[0].id
    return existing.data[0].id
  }

  const product = await stripe.products.create({
    name: 'Twomiah Factory ' + planName + (type === 'license' ? ' License' : ''),
    description,
    metadata: { twomiah_build_plan_id: planId, twomiah_build_type: type },
  })
  productCache[cacheKey] = product.id
  return product.id
}

export async function createSubscriptionCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; phone?: string; products?: string[]; stripeCustomerId?: string; companyId?: string },
  options: { planId?: string; monthlyAmount: number; billingCycle?: string; trialDays?: number }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const { planId = 'custom', monthlyAmount, billingCycle = 'monthly', trialDays = 0 } = options
  if (!monthlyAmount || monthlyAmount <= 0) throw new Error('Amount required')

  const amountCents = Math.round(monthlyAmount * 100)
  const planName = planId.charAt(0).toUpperCase() + planId.slice(1)

  const productId = await getOrCreateProduct(planId, planName, 'Twomiah Factory ' + planName + ' — ' + (factoryCustomer.products?.join(', ') || 'CRM'), 'subscription')

  let stripeCustomerId = factoryCustomer.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: factoryCustomer.email,
      name: factoryCustomer.name,
      phone: factoryCustomer.phone || undefined,
      metadata: { twomiah_build_factory_customer_id: factoryCustomer.id },
    })
    stripeCustomerId = customer.id
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        product: productId,
        unit_amount: amountCents,
        recurring: { interval: billingCycle === 'annual' ? 'year' : 'month' },
      },
      quantity: 1,
    }],
    success_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=success',
    cancel_url: FRONTEND_URL + '/tenants/' + factoryCustomer.id + '?payment=canceled',
    metadata: {
      factory_customer_id: factoryCustomer.id,
      plan_id: planId,
      billing_type: 'subscription',
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

export async function createLicenseCheckout(
  factoryCustomer: { id: string; email?: string; name?: string; stripeCustomerId?: string },
  options: { planId?: string; amount: number; description?: string }
) {
  if (!stripe) throw new Error('Stripe not configured')
  const { planId = 'custom', amount, description } = options
  if (!amount || amount <= 0) throw new Error('Amount required')

  const amountCents = Math.round(amount * 100)
  const planName = planId.charAt(0).toUpperCase() + planId.slice(1)

  const productId = await getOrCreateProduct(planId, planName, description || 'Twomiah Factory ' + planName + ' License', 'license')

  let stripeCustomerId = factoryCustomer.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: factoryCustomer.email,
      name: factoryCustomer.name,
      metadata: { twomiah_build_factory_customer_id: factoryCustomer.id },
    })
    stripeCustomerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{
      price_data: { currency: 'usd', product: productId, unit_amount: amountCents },
      quantity: 1,
    }],
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
      } else if (meta.billing_type === 'one_time') {
        updates.billing_type = 'one_time'
        updates.billing_status = 'active'
        updates.paid_at = new Date().toISOString()
        updates.status = 'active'
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

export default {
  createSubscriptionCheckout,
  createLicenseCheckout,
  handleFactoryWebhook,
  verifyWebhookSignature,
  isConfigured,
  getPublishableKey,
}
