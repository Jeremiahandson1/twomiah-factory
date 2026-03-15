/**
 * Stripe Payment Service
 *
 * Handles:
 * - Payment intents for orders (merch payments)
 * - Customer creation/management
 * - Webhook processing
 */

import Stripe from 'stripe'
import { db } from '../../db/index.ts'
import { contact, company, order } from '../../db/schema.ts'
import { eq, sql } from 'drizzle-orm'

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })
  : null

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

/**
 * Create or get Stripe customer for a contact
 */
export async function getOrCreateCustomer(contactRow: any) {
  const fields = (contactRow.customFields as any) || {}
  if (fields.stripeCustomerId) {
    try {
      const customer = await stripe!.customers.retrieve(fields.stripeCustomerId)
      if (!(customer as any).deleted) {
        return customer
      }
    } catch {
      // Customer doesn't exist, create new one
    }
  }

  const customer = await stripe!.customers.create({
    email: contactRow.email,
    name: contactRow.name,
    phone: contactRow.phone,
    address: contactRow.address
      ? {
          line1: contactRow.address,
          city: contactRow.city,
          state: contactRow.state,
          postal_code: contactRow.zip,
          country: 'US',
        }
      : undefined,
    metadata: {
      contact_id: contactRow.id,
      company_id: contactRow.companyId,
    },
  })

  // Save Stripe customer ID to contact custom fields
  const [existing] = await db.select({ customFields: contact.customFields }).from(contact).where(eq(contact.id, contactRow.id))
  const updatedFields = (existing?.customFields as any) || {}
  updatedFields.stripeCustomerId = customer.id

  await db
    .update(contact)
    .set({ customFields: updatedFields })
    .where(eq(contact.id, contactRow.id))

  return customer
}

/**
 * Update Stripe customer
 */
export async function updateCustomer(contactRow: any) {
  const fields = (contactRow.customFields as any) || {}
  if (!fields.stripeCustomerId) {
    return getOrCreateCustomer(contactRow)
  }

  return stripe!.customers.update(fields.stripeCustomerId, {
    email: contactRow.email,
    name: contactRow.name,
    phone: contactRow.phone,
  })
}

// ============================================
// PAYMENT INTENTS (for merch orders)
// ============================================

/**
 * Create payment intent for an order
 */
export async function createPaymentIntent(orderRow: any, contactRow: any) {
  const customer = await getOrCreateCustomer(contactRow)

  const amount = Math.round(Number(orderRow.total) * 100)

  if (amount <= 0) {
    throw new Error('Order has no balance due')
  }

  const paymentIntent = await stripe!.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customer.id,
    description: `Order ${orderRow.orderNumber || orderRow.number || orderRow.id}`,
    metadata: {
      order_id: orderRow.id,
      order_number: String(orderRow.orderNumber || orderRow.number || ''),
      company_id: orderRow.companyId,
      contact_id: contactRow.id,
    },
    automatic_payment_methods: { enabled: true },
  })

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
  }
}

/**
 * Retrieve payment intent
 */
export async function getPaymentIntent(paymentIntentId: string) {
  return stripe!.paymentIntents.retrieve(paymentIntentId)
}

// ============================================
// CHECKOUT SESSIONS
// ============================================

/**
 * Create checkout session for order payment
 */
export async function createCheckoutSession(
  orderRow: any,
  contactRow: any,
  { successUrl, cancelUrl }: { successUrl: string; cancelUrl: string }
) {
  const customer = await getOrCreateCustomer(contactRow)
  const total = Number(orderRow.total)

  const session = await stripe!.checkout.sessions.create({
    customer: customer.id,
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Order ${orderRow.orderNumber || orderRow.number || orderRow.id}`,
            description: orderRow.notes || `Payment for order`,
          },
          unit_amount: Math.round(total * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      order_id: orderRow.id,
      order_number: String(orderRow.orderNumber || orderRow.number || ''),
      company_id: orderRow.companyId,
    },
  })

  return { sessionId: session.id, url: session.url }
}

// ============================================
// WEBHOOK HANDLING
// ============================================

/**
 * Process Stripe webhook event
 */
export async function handleWebhook(event: Stripe.Event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return handlePaymentSuccess(event.data.object as Stripe.PaymentIntent)
    case 'payment_intent.payment_failed':
      return handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
    case 'checkout.session.completed':
      return handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
    default:
      console.log(`Unhandled Stripe event: ${event.type}`)
      return { handled: false }
  }
}

/**
 * Handle successful payment — update order status
 */
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const { order_id } = paymentIntent.metadata

  if (!order_id) {
    console.log('Payment without order metadata:', paymentIntent.id)
    return { handled: false }
  }

  const [orderRow] = await db.select().from(order).where(eq(order.id, order_id))

  if (!orderRow) {
    console.error(`Order not found: ${order_id}`)
    return { handled: false, error: 'Order not found' }
  }

  // Update order payment status
  await db
    .update(order)
    .set({
      paymentStatus: 'paid',
      paymentMethod: 'card',
    })
    .where(eq(order.id, orderRow.id))

  return {
    handled: true,
    orderId: orderRow.id,
    amount: paymentIntent.amount / 100,
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const { order_id } = paymentIntent.metadata
  if (order_id) {
    console.log(`Payment failed for order ${order_id}:`, paymentIntent.last_payment_error?.message)
  }
  return { handled: true, failed: true }
}

/**
 * Handle checkout session complete
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  console.log('Checkout completed:', session.id)
  return { handled: true }
}

// ============================================
// CONNECT (for marketplace/platform)
// ============================================

/**
 * Create Stripe Connect account for a company
 */
export async function createConnectAccount(companyRow: any) {
  const account = await stripe!.accounts.create({
    type: 'express',
    country: 'US',
    email: companyRow.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'company',
    company: { name: companyRow.name },
    metadata: { company_id: companyRow.id },
  })

  // Save in company settings
  const [existing] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyRow.id))
  const settings = (existing?.settings as any) || {}
  settings.stripeAccountId = account.id

  await db.update(company).set({ settings }).where(eq(company.id, companyRow.id))

  return account
}

/**
 * Create account link for onboarding
 */
export async function createAccountLink(companyRow: any) {
  const settings = (companyRow.settings as any) || {}
  if (!settings.stripeAccountId) {
    await createConnectAccount(companyRow)
  }

  const accountLink = await stripe!.accountLinks.create({
    account: settings.stripeAccountId,
    refresh_url: `${process.env.FRONTEND_URL}/settings/payments?refresh=true`,
    return_url: `${process.env.FRONTEND_URL}/settings/payments?success=true`,
    type: 'account_onboarding',
  })

  return accountLink
}

/**
 * Get Connect account status
 */
export async function getAccountStatus(stripeAccountId: string) {
  const account = await stripe!.accounts.retrieve(stripeAccountId)

  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirements: account.requirements,
  }
}

// ============================================
// REFUNDS
// ============================================

/**
 * Create refund for an order payment
 */
export async function createRefund(paymentIntentId: string, amount: number | null = null) {
  const refund = await stripe!.refunds.create({
    payment_intent: paymentIntentId,
    amount: amount ? Math.round(amount * 100) : undefined,
  })

  return refund
}

// ============================================
// UTILITIES
// ============================================

/**
 * Verify webhook signature
 */
export function constructWebhookEvent(payload: string | Buffer, signature: string) {
  return stripe!.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!)
}

/**
 * Get Stripe publishable key (for frontend)
 */
export function getPublishableKey(): string | undefined {
  return process.env.STRIPE_PUBLISHABLE_KEY
}

export default {
  getOrCreateCustomer,
  updateCustomer,
  createPaymentIntent,
  getPaymentIntent,
  createCheckoutSession,
  handleWebhook,
  createRefund,
  createConnectAccount,
  createAccountLink,
  getAccountStatus,
  constructWebhookEvent,
  getPublishableKey,
}
