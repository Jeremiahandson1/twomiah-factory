/**
 * Stripe Payment Service
 *
 * Handles:
 * - Payment intents for invoices
 * - Customer creation/management
 * - Webhook processing
 * - Payment methods
 */

import Stripe from 'stripe'
import { db } from '../../db/index.ts'
import { contact, invoice, payment, company, roofReport } from '../../db/schema.ts'
import { eq, sql } from 'drizzle-orm'
import { generateAndSaveReport } from '../routes/roofReports.ts'

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
  if (contactRow.stripeCustomerId) {
    try {
      const customer = await stripe!.customers.retrieve(contactRow.stripeCustomerId)
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
  const fields = (existing?.customFields as any) || {}
  fields.stripeCustomerId = customer.id

  await db
    .update(contact)
    .set({ customFields: fields })
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
// PAYMENT INTENTS
// ============================================

/**
 * Create payment intent for an invoice
 */
export async function createPaymentIntent(invoiceRow: any, contactRow: any) {
  const customer = await getOrCreateCustomer(contactRow)

  const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)
  const amount = Math.round(balance * 100)

  if (amount <= 0) {
    throw new Error('Invoice has no balance due')
  }

  const paymentIntent = await stripe!.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customer.id,
    description: `Invoice ${invoiceRow.number}`,
    metadata: {
      invoice_id: invoiceRow.id,
      invoice_number: invoiceRow.number,
      company_id: invoiceRow.companyId,
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
 * Create payment intent for partial payment
 */
export async function createPartialPaymentIntent(invoiceRow: any, contactRow: any, amount: number) {
  const customer = await getOrCreateCustomer(contactRow)

  const amountCents = Math.round(amount * 100)
  const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)
  const maxAmount = Math.round(balance * 100)

  if (amountCents <= 0) throw new Error('Amount must be greater than 0')
  if (amountCents > maxAmount) throw new Error('Amount exceeds invoice balance')

  const paymentIntent = await stripe!.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customer.id,
    description: `Partial payment - Invoice ${invoiceRow.number}`,
    metadata: {
      invoice_id: invoiceRow.id,
      invoice_number: invoiceRow.number,
      company_id: invoiceRow.companyId,
      contact_id: contactRow.id,
      partial_payment: 'true',
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
 * Create checkout session for invoice payment
 */
export async function createCheckoutSession(
  invoiceRow: any,
  contactRow: any,
  { successUrl, cancelUrl }: { successUrl: string; cancelUrl: string }
) {
  const customer = await getOrCreateCustomer(contactRow)
  const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)

  const session = await stripe!.checkout.sessions.create({
    customer: customer.id,
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Invoice ${invoiceRow.number}`,
            description: invoiceRow.notes || `Payment for Invoice ${invoiceRow.number}`,
          },
          unit_amount: Math.round(balance * 100),
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      invoice_id: invoiceRow.id,
      invoice_number: invoiceRow.number,
      company_id: invoiceRow.companyId,
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
 * Handle successful payment
 */
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const { invoice_id } = paymentIntent.metadata

  if (!invoice_id) {
    console.log('Payment without invoice metadata:', paymentIntent.id)
    return { handled: false }
  }

  const [invoiceRow] = await db.select().from(invoice).where(eq(invoice.id, invoice_id))

  if (!invoiceRow) {
    console.error(`Invoice not found: ${invoice_id}`)
    return { handled: false, error: 'Invoice not found' }
  }

  const amount = paymentIntent.amount / 100

  // Create payment record
  const [paymentRow] = await db
    .insert(payment)
    .values({
      invoiceId: invoiceRow.id,
      amount: String(amount),
      method: 'card',
      reference: paymentIntent.id,
      paidAt: new Date(),
      notes: `Stripe payment - ${paymentIntent.payment_method_types?.join(', ') || 'card'}`,
    })
    .returning()

  // Update invoice
  const newAmountPaid = Number(invoiceRow.amountPaid) + amount
  const newBalance = Number(invoiceRow.total) - newAmountPaid
  const newStatus = newBalance <= 0 ? 'paid' : 'partial'

  await db
    .update(invoice)
    .set({
      amountPaid: String(newAmountPaid),
      status: newStatus,
      ...(newStatus === 'paid' ? { paidAt: new Date() } : {}),
    })
    .where(eq(invoice.id, invoiceRow.id))

  return {
    handled: true,
    paymentId: paymentRow.id,
    invoiceId: invoiceRow.id,
    amount,
    newStatus,
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const { invoice_id } = paymentIntent.metadata
  if (invoice_id) {
    console.log(`Payment failed for invoice ${invoice_id}:`, paymentIntent.last_payment_error?.message)
  }
  return { handled: true, failed: true }
}

/**
 * Handle checkout session complete
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const meta = session.metadata || {}

  // Roof report purchase
  if (meta.type === 'roof_report') {
    return handleRoofReportCheckout(session)
  }

  console.log('Checkout completed:', session.id)
  return { handled: true }
}

/**
 * Handle roof report checkout — reliable fallback for the success-redirect confirm-purchase flow
 */
async function handleRoofReportCheckout(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') {
    console.log('Roof report checkout not paid yet:', session.id)
    return { handled: true, roofReport: false, reason: 'not_paid' }
  }

  const meta = session.metadata || {}
  const paymentIntentId = session.payment_intent as string

  if (!paymentIntentId) {
    console.error('Roof report checkout missing payment_intent:', session.id)
    return { handled: true, roofReport: false, reason: 'no_payment_intent' }
  }

  // Idempotency check — don't generate twice
  const [existing] = await db.select({ id: roofReport.id }).from(roofReport)
    .where(eq(roofReport.stripePaymentIntentId, paymentIntentId))
    .limit(1)

  if (existing) {
    console.log('Roof report already generated for payment:', paymentIntentId)
    return { handled: true, roofReport: true, reportId: existing.id, alreadyGenerated: true }
  }

  try {
    const report = await generateAndSaveReport(
      meta.companyId,
      meta.address || '',
      meta.city || '',
      meta.state || '',
      meta.zip || '',
      meta.contactId || undefined,
      paymentIntentId,
    )

    console.log('Roof report generated via webhook:', report.id)
    return { handled: true, roofReport: true, reportId: report.id }
  } catch (err: any) {
    console.error('Roof report generation failed in webhook:', err.message)
    return { handled: true, roofReport: false, error: err.message }
  }
}

// ============================================
// PAYMENT LINKS
// ============================================

/**
 * Create a payment link for an invoice
 */
export async function createPaymentLink(invoiceRow: any) {
  const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)

  const product = await stripe!.products.create({
    name: `Invoice ${invoiceRow.number}`,
  })

  const price = await stripe!.prices.create({
    product: product.id,
    unit_amount: Math.round(balance * 100),
    currency: 'usd',
  })

  const paymentLink = await stripe!.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: {
      invoice_id: invoiceRow.id,
      invoice_number: invoiceRow.number,
    },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${process.env.FRONTEND_URL}/portal/payment-success?invoice=${invoiceRow.number}`,
      },
    },
  })

  // Save payment link (store in notes or a custom field since schema has no stripePaymentLink column)
  await db
    .update(invoice)
    .set({ notes: sql`coalesce(${invoice.notes}, '') || E'\nPayment link: ' || ${paymentLink.url}` })
    .where(eq(invoice.id, invoiceRow.id))

  return { url: paymentLink.url, id: paymentLink.id }
}

// ============================================
// REFUNDS
// ============================================

/**
 * Create refund for a payment
 */
export async function createRefund(paymentRow: any, amount: number | null = null) {
  if (!paymentRow.reference) {
    throw new Error('Payment was not made through Stripe')
  }

  const refund = await stripe!.refunds.create({
    payment_intent: paymentRow.reference,
    amount: amount ? Math.round(amount * 100) : undefined,
  })

  // Update invoice balance
  const [invoiceRow] = await db.select().from(invoice).where(eq(invoice.id, paymentRow.invoiceId))
  const refundAmount = refund.amount / 100

  await db
    .update(invoice)
    .set({
      amountPaid: String(Math.max(0, Number(invoiceRow.amountPaid) - refundAmount)),
      status: 'sent',
    })
    .where(eq(invoice.id, paymentRow.invoiceId))

  return refund
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
  createPartialPaymentIntent,
  getPaymentIntent,
  createCheckoutSession,
  handleWebhook,
  createPaymentLink,
  createRefund,
  createConnectAccount,
  createAccountLink,
  getAccountStatus,
  constructWebhookEvent,
  getPublishableKey,
}
