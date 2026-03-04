/**
 * Factory Stripe Service
 * 
 * Handles operator-level billing for Factory customers:
 * - Create Stripe Checkout sessions (subscription + one-time)
 * - Manage customer billing lifecycle
 * - Process webhooks for Factory billing events
 * - Customer portal for self-service billing management
 * 
 * This is SEPARATE from the CRM stripe service which handles
 * end-user invoice payments. This handles Twomiah Build → Customer billing.
 */

import { stripe } from '../../config/stripe.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================
// PRODUCT & PRICE MANAGEMENT
// ============================================

/**
 * Ensure Stripe products exist for our plans.
 * Creates them lazily on first use and caches IDs.
 * In production, you'd create these once in the Stripe dashboard.
 */
const productCache = {};

async function getOrCreateProduct(planId, planName, description, type = 'subscription') {
  const cacheKey = `${type}_${planId}`;
  if (productCache[cacheKey]) return productCache[cacheKey];

  // Search for existing product
  const existing = await stripe.products.search({
    query: `metadata["twomiah_build_plan_id"]:"${planId}" AND metadata["twomiah_build_type"]:"${type}"`,
  });

  if (existing.data.length > 0) {
    productCache[cacheKey] = existing.data[0].id;
    return existing.data[0].id;
  }

  // Create new product
  const product = await stripe.products.create({
    name: `Twomiah Build ${planName}${type === 'license' ? ' License' : ''}`,
    description,
    metadata: {
      twomiah_build_plan_id: planId,
      twomiah_build_type: type,
    },
  });

  productCache[cacheKey] = product.id;
  return product.id;
}


// ============================================
// SUBSCRIPTION CHECKOUT
// ============================================

/**
 * Create a Stripe Checkout Session for a subscription
 * 
 * @param {Object} factoryCustomer - The FactoryCustomer record
 * @param {Object} options - { planId, monthlyAmount, billingCycle }
 * @returns {Object} { sessionId, url }
 */
export async function createSubscriptionCheckout(factoryCustomer, {
  planId = 'custom',
  monthlyAmount, // in dollars
  billingCycle = 'monthly',
  trialDays = 0,
}) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!monthlyAmount || monthlyAmount <= 0) throw new Error('Amount required');

  const amountCents = Math.round(monthlyAmount * 100);
  const planName = planId.charAt(0).toUpperCase() + planId.slice(1);

  // Get or create product
  const productId = await getOrCreateProduct(
    planId,
    planName,
    `Twomiah Build ${planName} — ${factoryCustomer.products?.join(', ') || 'CRM'}`,
    'subscription'
  );

  // Create or reuse Stripe customer
  let stripeCustomerId = factoryCustomer.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: factoryCustomer.email,
      name: factoryCustomer.name,
      phone: factoryCustomer.phone || undefined,
      metadata: {
        twomiah_build_factory_customer_id: factoryCustomer.id,
        twomiah_build_operator_company_id: factoryCustomer.companyId,
      },
    });
    stripeCustomerId = customer.id;
  }

  // Build checkout session
  const sessionParams = {
    customer: stripeCustomerId,
    mode: 'subscription',
    line_items: [{
      price_data: {
        currency: 'usd',
        product: productId,
        unit_amount: amountCents,
        recurring: {
          interval: billingCycle === 'annual' ? 'year' : 'month',
        },
      },
      quantity: 1,
    }],
    success_url: `${FRONTEND_URL}/customers/${factoryCustomer.id}?payment=success`,
    cancel_url: `${FRONTEND_URL}/customers/${factoryCustomer.id}?payment=canceled`,
    metadata: {
      factory_customer_id: factoryCustomer.id,
      operator_company_id: factoryCustomer.companyId,
      plan_id: planId,
      billing_type: 'subscription',
    },
  };

  // Add trial if specified
  if (trialDays > 0) {
    sessionParams.subscription_data = {
      trial_period_days: trialDays,
      metadata: {
        factory_customer_id: factoryCustomer.id,
        plan_id: planId,
      },
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return {
    sessionId: session.id,
    url: session.url,
    stripeCustomerId,
  };
}


// ============================================
// ONE-TIME LICENSE CHECKOUT
// ============================================

/**
 * Create a Stripe Checkout Session for a one-time license purchase
 * 
 * @param {Object} factoryCustomer - The FactoryCustomer record
 * @param {Object} options - { planId, amount, description }
 * @returns {Object} { sessionId, url }
 */
export async function createLicenseCheckout(factoryCustomer, {
  planId = 'custom',
  amount, // in dollars
  description,
}) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!amount || amount <= 0) throw new Error('Amount required');

  const amountCents = Math.round(amount * 100);
  const planName = planId.charAt(0).toUpperCase() + planId.slice(1);

  const productId = await getOrCreateProduct(
    planId,
    planName,
    description || `Twomiah Build ${planName} License — One-time purchase`,
    'license'
  );

  // Create or reuse Stripe customer
  let stripeCustomerId = factoryCustomer.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: factoryCustomer.email,
      name: factoryCustomer.name,
      metadata: {
        twomiah_build_factory_customer_id: factoryCustomer.id,
        twomiah_build_operator_company_id: factoryCustomer.companyId,
      },
    });
    stripeCustomerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product: productId,
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    success_url: `${FRONTEND_URL}/customers/${factoryCustomer.id}?payment=success`,
    cancel_url: `${FRONTEND_URL}/customers/${factoryCustomer.id}?payment=canceled`,
    metadata: {
      factory_customer_id: factoryCustomer.id,
      operator_company_id: factoryCustomer.companyId,
      plan_id: planId,
      billing_type: 'one_time',
    },
    invoice_creation: {
      enabled: true, // Generate a Stripe invoice for one-time payments
    },
  });

  return {
    sessionId: session.id,
    url: session.url,
    stripeCustomerId,
  };
}


// ============================================
// CUSTOMER PORTAL
// ============================================

/**
 * Create a Stripe Customer Portal session.
 * Lets customers manage their own billing (update card, cancel, etc.)
 */
export async function createPortalSession(factoryCustomer) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!factoryCustomer.stripeCustomerId) {
    throw new Error('Customer has no Stripe account');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: factoryCustomer.stripeCustomerId,
    return_url: `${FRONTEND_URL}/customers/${factoryCustomer.id}`,
  });

  return { url: session.url };
}


// ============================================
// WEBHOOK HANDLING
// ============================================

/**
 * Process Stripe webhook events for Factory billing
 * Returns { handled, updates } where updates is a Prisma-ready patch
 * for the FactoryCustomer record.
 */
export async function handleFactoryWebhook(event) {
  switch (event.type) {
    // ── Checkout completed ──────────────────────────────
    case 'checkout.session.completed': {
      const session = event.data.object;
      const meta = session.metadata || {};

      if (!meta.factory_customer_id) {
        return { handled: false, reason: 'Not a factory checkout' };
      }

      const updates = {
        stripeCustomerId: session.customer,
      };

      if (meta.billing_type === 'subscription') {
        updates.billingType = 'subscription';
        updates.billingStatus = 'active';
        updates.stripeSubscriptionId = session.subscription;
        updates.status = 'active';
      } else if (meta.billing_type === 'one_time') {
        updates.billingType = 'one_time';
        updates.billingStatus = 'active';
        updates.paidAt = new Date();
        updates.status = 'active';
      }

      if (meta.plan_id) {
        updates.planId = meta.plan_id;
      }

      return {
        handled: true,
        factoryCustomerId: meta.factory_customer_id,
        updates,
      };
    }

    // ── Subscription updated ────────────────────────────
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const meta = sub.metadata || {};

      if (!meta.factory_customer_id) {
        return { handled: false, reason: 'Not a factory subscription' };
      }

      const updates = {
        billingStatus: sub.status === 'active' ? 'active' 
          : sub.status === 'past_due' ? 'past_due'
          : sub.status === 'canceled' ? 'canceled'
          : sub.status,
      };

      // Update amount from subscription
      if (sub.items?.data?.[0]?.price?.unit_amount) {
        updates.monthlyAmount = sub.items.data[0].price.unit_amount / 100;
      }

      // Track period
      if (sub.current_period_end) {
        updates.nextBillingDate = new Date(sub.current_period_end * 1000);
      }

      return {
        handled: true,
        factoryCustomerId: meta.factory_customer_id,
        updates,
      };
    }

    // ── Subscription deleted ────────────────────────────
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const meta = sub.metadata || {};

      if (!meta.factory_customer_id) {
        return { handled: false };
      }

      return {
        handled: true,
        factoryCustomerId: meta.factory_customer_id,
        updates: {
          billingStatus: 'canceled',
          status: 'suspended',
          stripeSubscriptionId: null,
        },
      };
    }

    // ── Invoice paid (for subscription renewals) ────────
    case 'invoice.paid': {
      const invoice = event.data.object;
      const sub = invoice.subscription;

      if (!sub) return { handled: false };

      // Look up by subscription ID
      return {
        handled: true,
        lookupField: 'stripeSubscriptionId',
        lookupValue: sub,
        updates: {
          billingStatus: 'active',
          paidAt: new Date(),
        },
      };
    }

    // ── Invoice payment failed ──────────────────────────
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const sub = invoice.subscription;

      if (!sub) return { handled: false };

      return {
        handled: true,
        lookupField: 'stripeSubscriptionId',
        lookupValue: sub,
        updates: {
          billingStatus: 'past_due',
        },
      };
    }

    default:
      return { handled: false, reason: `Unhandled event: ${event.type}` };
  }
}


// ============================================
// CANCEL / PAUSE
// ============================================

/**
 * Cancel a customer's subscription
 */
export async function cancelSubscription(factoryCustomer, { atPeriodEnd = true } = {}) {
  if (!stripe) throw new Error('Stripe not configured');
  if (!factoryCustomer.stripeSubscriptionId) {
    throw new Error('No active subscription to cancel');
  }

  if (atPeriodEnd) {
    await stripe.subscriptions.update(factoryCustomer.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    await stripe.subscriptions.cancel(factoryCustomer.stripeSubscriptionId);
  }

  return {
    canceled: true,
    immediate: !atPeriodEnd,
  };
}


// ============================================
// UTILITIES
// ============================================

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(payload, signature) {
  if (!stripe) throw new Error('Stripe not configured');
  return stripe.webhooks.constructEvent(
    payload,
    signature,
    process.env.STRIPE_FACTORY_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  );
}

/**
 * Get Stripe publishable key
 */
export function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

/**
 * Check if Stripe is configured
 */
export function isConfigured() {
  return !!stripe;
}

export default {
  createSubscriptionCheckout,
  createLicenseCheckout,
  createPortalSession,
  handleFactoryWebhook,
  cancelSubscription,
  verifyWebhookSignature,
  getPublishableKey,
  isConfigured,
};
