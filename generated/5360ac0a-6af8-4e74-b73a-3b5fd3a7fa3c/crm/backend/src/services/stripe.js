/**
 * Stripe Payment Service
 * 
 * Handles:
 * - Payment intents for invoices
 * - Customer creation/management
 * - Webhook processing
 * - Payment methods
 */

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    })
  : null;

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

/**
 * Create or get Stripe customer for a contact
 */
export async function getOrCreateCustomer(contact) {
  // Return existing if we have it
  if (contact.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(contact.stripeCustomerId);
      if (!customer.deleted) {
        return customer;
      }
    } catch (e) {
      // Customer doesn't exist, create new one
    }
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
    address: contact.address ? {
      line1: contact.address,
      city: contact.city,
      state: contact.state,
      postal_code: contact.zip,
      country: 'US',
    } : undefined,
    metadata: {
      twomiah_build_contact_id: contact.id,
      twomiah_build_company_id: contact.companyId,
    },
  });

  // Save Stripe customer ID
  await prisma.contact.update({
    where: { id: contact.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer;
}

/**
 * Update Stripe customer
 */
export async function updateCustomer(contact) {
  if (!contact.stripeCustomerId) {
    return getOrCreateCustomer(contact);
  }

  return stripe.customers.update(contact.stripeCustomerId, {
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
  });
}

// ============================================
// PAYMENT INTENTS
// ============================================

/**
 * Create payment intent for an invoice
 */
export async function createPaymentIntent(invoice, contact) {
  // Get or create Stripe customer
  const customer = await getOrCreateCustomer(contact);

  // Amount in cents
  const amount = Math.round(Number(invoice.balance) * 100);

  if (amount <= 0) {
    throw new Error('Invoice has no balance due');
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customer.id,
    description: `Invoice ${invoice.number}`,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      company_id: invoice.companyId,
      contact_id: contact.id,
    },
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
  };
}

/**
 * Create payment intent for partial payment
 */
export async function createPartialPaymentIntent(invoice, contact, amount) {
  const customer = await getOrCreateCustomer(contact);

  // Amount in cents
  const amountCents = Math.round(amount * 100);
  const maxAmount = Math.round(Number(invoice.balance) * 100);

  if (amountCents <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (amountCents > maxAmount) {
    throw new Error('Amount exceeds invoice balance');
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: customer.id,
    description: `Partial payment - Invoice ${invoice.number}`,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      company_id: invoice.companyId,
      contact_id: contact.id,
      partial_payment: 'true',
    },
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
  };
}

/**
 * Retrieve payment intent
 */
export async function getPaymentIntent(paymentIntentId) {
  return stripe.paymentIntents.retrieve(paymentIntentId);
}

// ============================================
// CHECKOUT SESSIONS
// ============================================

/**
 * Create checkout session for invoice payment
 */
export async function createCheckoutSession(invoice, contact, { successUrl, cancelUrl }) {
  const customer = await getOrCreateCustomer(contact);

  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Invoice ${invoice.number}`,
          description: invoice.notes || `Payment for Invoice ${invoice.number}`,
        },
        unit_amount: Math.round(Number(invoice.balance) * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      company_id: invoice.companyId,
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
  };
}

// ============================================
// WEBHOOK HANDLING
// ============================================

/**
 * Process Stripe webhook event
 */
export async function handleWebhook(event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      return handlePaymentSuccess(event.data.object);

    case 'payment_intent.payment_failed':
      return handlePaymentFailed(event.data.object);

    case 'checkout.session.completed':
      return handleCheckoutComplete(event.data.object);

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
      return { handled: false };
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentSuccess(paymentIntent) {
  const { invoice_id, invoice_number, company_id, contact_id } = paymentIntent.metadata;

  if (!invoice_id) {
    console.log('Payment without invoice metadata:', paymentIntent.id);
    return { handled: false };
  }

  // Find invoice
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoice_id },
    include: { contact: true, company: true },
  });

  if (!invoice) {
    console.error(`Invoice not found: ${invoice_id}`);
    return { handled: false, error: 'Invoice not found' };
  }

  // Calculate payment amount (convert from cents)
  const amount = paymentIntent.amount / 100;

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      amount,
      method: 'card',
      reference: paymentIntent.id,
      stripePaymentIntentId: paymentIntent.id,
      paidAt: new Date(),
      notes: `Stripe payment - ${paymentIntent.payment_method_types?.join(', ') || 'card'}`,
    },
  });

  // Update invoice
  const newAmountPaid = Number(invoice.amountPaid) + amount;
  const newBalance = Number(invoice.total) - newAmountPaid;
  const newStatus = newBalance <= 0 ? 'paid' : 'partial';

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid: newAmountPaid,
      balance: Math.max(0, newBalance),
      status: newStatus,
      paidAt: newStatus === 'paid' ? new Date() : undefined,
    },
  });

  // TODO: Send payment confirmation email
  // await emailService.sendPaymentReceived(invoice.contact.email, {...});

  return { 
    handled: true, 
    paymentId: payment.id,
    invoiceId: invoice.id,
    amount,
    newStatus,
  };
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(paymentIntent) {
  const { invoice_id } = paymentIntent.metadata;

  if (invoice_id) {
    // Log failed attempt
    console.log(`Payment failed for invoice ${invoice_id}:`, paymentIntent.last_payment_error?.message);
  }

  return { handled: true, failed: true };
}

/**
 * Handle checkout session complete
 */
async function handleCheckoutComplete(session) {
  // If payment_intent exists, it will be handled by payment_intent.succeeded
  // This is just for logging/tracking
  console.log('Checkout completed:', session.id);
  return { handled: true };
}

// ============================================
// PAYMENT LINKS
// ============================================

/**
 * Create a payment link for an invoice
 */
export async function createPaymentLink(invoice) {
  const product = await stripe.products.create({
    name: `Invoice ${invoice.number}`,
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(Number(invoice.balance) * 100),
    currency: 'usd',
  });

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: {
      invoice_id: invoice.id,
      invoice_number: invoice.number,
    },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${process.env.FRONTEND_URL}/portal/payment-success?invoice=${invoice.number}`,
      },
    },
  });

  // Save payment link to invoice
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { stripePaymentLink: paymentLink.url },
  });

  return {
    url: paymentLink.url,
    id: paymentLink.id,
  };
}

// ============================================
// REFUNDS
// ============================================

/**
 * Create refund for a payment
 */
export async function createRefund(payment, amount = null) {
  if (!payment.stripePaymentIntentId) {
    throw new Error('Payment was not made through Stripe');
  }

  const refund = await stripe.refunds.create({
    payment_intent: payment.stripePaymentIntentId,
    amount: amount ? Math.round(amount * 100) : undefined, // Full refund if no amount
  });

  // Update payment record
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      refundedAt: new Date(),
      refundAmount: refund.amount / 100,
      stripeRefundId: refund.id,
    },
  });

  // Update invoice balance
  const invoice = await prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
  const refundAmount = refund.amount / 100;
  
  await prisma.invoice.update({
    where: { id: payment.invoiceId },
    data: {
      amountPaid: Math.max(0, Number(invoice.amountPaid) - refundAmount),
      balance: Number(invoice.balance) + refundAmount,
      status: 'sent', // Reset to sent after refund
    },
  });

  return refund;
}

// ============================================
// CONNECT (for marketplace/platform)
// ============================================

/**
 * Create Stripe Connect account for a company (if using platform model)
 */
export async function createConnectAccount(company) {
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: company.email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'company',
    company: {
      name: company.name,
    },
    metadata: {
      twomiah_build_company_id: company.id,
    },
  });

  // Save Stripe account ID
  await prisma.company.update({
    where: { id: company.id },
    data: { stripeAccountId: account.id },
  });

  return account;
}

/**
 * Create account link for onboarding
 */
export async function createAccountLink(company) {
  if (!company.stripeAccountId) {
    await createConnectAccount(company);
  }

  const accountLink = await stripe.accountLinks.create({
    account: company.stripeAccountId,
    refresh_url: `${process.env.FRONTEND_URL}/settings/payments?refresh=true`,
    return_url: `${process.env.FRONTEND_URL}/settings/payments?success=true`,
    type: 'account_onboarding',
  });

  return accountLink;
}

/**
 * Get Connect account status
 */
export async function getAccountStatus(stripeAccountId) {
  const account = await stripe.accounts.retrieve(stripeAccountId);
  
  return {
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    requirements: account.requirements,
  };
}

// ============================================
// UTILITIES
// ============================================

/**
 * Verify webhook signature
 */
export function constructWebhookEvent(payload, signature) {
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Get Stripe publishable key (for frontend)
 */
export function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY;
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
};
