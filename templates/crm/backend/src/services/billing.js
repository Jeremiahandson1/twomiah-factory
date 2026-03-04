/**
 * Billing Service
 * 
 * Handles all billing operations:
 * - Subscription management
 * - One-time purchases
 * - Usage tracking & billing
 * - Invoice generation
 * - Stripe integration
 */

import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { SAAS_TIERS, SELF_HOSTED_PACKAGES, SELF_HOSTED_ADDONS, FEATURE_BUNDLES, calculateUserPrice } from '../config/pricing.js';

const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

if (!stripe) {
  console.log('⚠️  Stripe not configured - billing features disabled');
}

// Aliases for backward compatibility
const PACKAGES = SAAS_TIERS;
const ADDONS = SELF_HOSTED_ADDONS;

// ============================================
// SUBSCRIPTION MANAGEMENT
// ============================================

/**
 * Create a new subscription
 */
export async function createSubscription(companyId, {
  tierId,
  billingCycle = 'monthly',
  userCount = 1,
  addons = [],
  paymentMethodId,
}) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { subscription: true },
  });

  if (!company) throw new Error('Company not found');
  if (company.subscription?.status === 'active') {
    throw new Error('Company already has active subscription');
  }

  const tier = SAAS_TIERS[tierId];
  if (!tier) throw new Error('Invalid tier');

  // Calculate pricing
  const basePrice = billingCycle === 'yearly' ? tier.priceAnnual : tier.price;
  const totalPrice = calculateUserPrice(tierId, userCount);

  // Create or get Stripe customer
  let stripeCustomerId = company.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: company.email,
      name: company.name,
      metadata: { companyId },
    });
    stripeCustomerId = customer.id;
    await prisma.company.update({
      where: { id: companyId },
      data: { stripeCustomerId },
    });
  }

  // Attach payment method
  if (paymentMethodId) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // Create Stripe subscription
  const stripeSubscription = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `{{COMPANY_NAME}} ${tier.name}`,
            metadata: { tierId },
          },
          unit_amount: totalPrice,
          recurring: {
            interval: billingCycle === 'yearly' ? 'year' : 'month',
          },
        },
      },
    ],
    metadata: {
      companyId,
      tierId,
      userCount: String(userCount),
    },
  });

  // Create local subscription record
  const subscription = await prisma.subscription.create({
    data: {
      companyId,
      stripeSubscriptionId: stripeSubscription.id,
      
      tier: tierId,
      billingCycle,
      
      status: 'active',
      
      userCount,
      basePrice,
      totalPrice,
      
      addons,
      
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    },
  });

  // Update company with enabled features
  await prisma.company.update({
    where: { id: companyId },
    data: {
      enabledFeatures: tier.features,
      subscriptionTier: tierId,
    },
  });

  return { subscription, stripeSubscription };
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(companyId, { atPeriodEnd = true } = {}) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, status: 'active' },
  });

  if (!subscription) throw new Error('No active subscription');

  // Cancel in Stripe
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: atPeriodEnd,
  });

  // Update local record
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: atPeriodEnd ? 'canceling' : 'canceled',
      canceledAt: new Date(),
    },
  });

  return { success: true, endsAt: subscription.currentPeriodEnd };
}

/**
 * Change subscription tier
 */
export async function changeTier(companyId, newTierId, { immediate = false } = {}) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, status: 'active' },
  });

  if (!subscription) throw new Error('No active subscription');

  const newTier = SAAS_TIERS[newTierId];
  if (!newTier) throw new Error('Invalid tier');

  const totalPrice = calculateUserPrice(newTierId, subscription.userCount);

  // Update Stripe subscription
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{
      id: stripeSubscription.items.data[0].id,
      price_data: {
        currency: 'usd',
        product_data: { name: `{{COMPANY_NAME}} ${newTier.name}` },
        unit_amount: totalPrice,
        recurring: {
          interval: subscription.billingCycle === 'yearly' ? 'year' : 'month',
        },
      },
    }],
    proration_behavior: immediate ? 'create_prorations' : 'none',
    metadata: { tierId: newTierId },
  });

  // Update local
  const basePrice = subscription.billingCycle === 'yearly' ? newTier.priceAnnual : newTier.price;
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      tier: newTierId,
      basePrice,
      totalPrice,
    },
  });

  // Update company features
  await prisma.company.update({
    where: { id: companyId },
    data: {
      enabledFeatures: newTier.features,
      subscriptionTier: newTierId,
    },
  });

  return { success: true };
}

/**
 * Update user count
 */
export async function updateUserCount(companyId, newUserCount) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, status: 'active' },
  });

  if (!subscription) throw new Error('No active subscription');

  const totalPrice = calculateUserPrice(subscription.tier, newUserCount);
  const tier = SAAS_TIERS[subscription.tier];

  // Update Stripe
  const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{
      id: stripeSubscription.items.data[0].id,
      price_data: {
        currency: 'usd',
        product_data: { name: `{{COMPANY_NAME}} ${tier.name}` },
        unit_amount: totalPrice,
        recurring: {
          interval: subscription.billingCycle === 'yearly' ? 'year' : 'month',
        },
      },
    }],
    proration_behavior: 'create_prorations',
    metadata: { userCount: String(newUserCount) },
  });

  // Update local
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      userCount: newUserCount,
      totalPrice,
    },
  });

  return { success: true, newPrice: totalPrice };
}

// ============================================
// ONE-TIME PURCHASE
// ============================================

/**
 * Process one-time purchase (lifetime license)
 */
export async function processOneTimePurchase(companyId, {
  packageId,
  paymentMethodId,
}) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Company not found');

  const pkg = SELF_HOSTED_PACKAGES[packageId];
  if (!pkg) throw new Error('Package not available for one-time purchase');
  
  const amount = pkg.price;
  const enabledFeatures = pkg.features;
  const description = `{{COMPANY_NAME}} ${pkg.name} - Lifetime License`;

  // Create or get Stripe customer
  let stripeCustomerId = company.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: company.email,
      name: company.name,
      metadata: { companyId },
    });
    stripeCustomerId = customer.id;
    await prisma.company.update({
      where: { id: companyId },
      data: { stripeCustomerId },
    });
  }

  // Create payment intent
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: stripeCustomerId,
    payment_method: paymentMethodId,
    confirm: true,
    description,
    metadata: { companyId, packageId, type: 'lifetime' },
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment failed');
  }

  // Update company
  await prisma.company.update({
    where: { id: companyId },
    data: {
      enabledFeatures,
      subscriptionTier: packageId,
      lifetimeLicense: true,
    },
  });

  return { success: true, paymentIntent };
}

/**
 * Purchase addon
 */
export async function purchaseAddon(companyId, addonId, quantity = 1, paymentMethodId) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Company not found');

  const addon = SELF_HOSTED_ADDONS[addonId];
  if (!addon) throw new Error('Invalid addon');

  const amount = addon.price * quantity;

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: company.stripeCustomerId,
    payment_method: paymentMethodId,
    confirm: true,
    description: `${addon.name} x${quantity}`,
    metadata: { companyId, addonId, quantity: String(quantity) },
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment failed');
  }

  // Record purchase
  await prisma.addonPurchase.create({
    data: {
      companyId,
      addonId,
      quantity,
      amount,
      stripePaymentId: paymentIntent.id,
    },
  });

  return { success: true, paymentIntent };
}

// ============================================
// USAGE-BASED BILLING
// ============================================

/**
 * Track usage (SMS, calls, etc.)
 */
export async function trackUsage(companyId, usageType, quantity = 1, metadata = {}) {
  await prisma.usageRecord.create({
    data: {
      companyId,
      type: usageType,
      quantity,
      metadata,
      recordedAt: new Date(),
    },
  });
}

/**
 * Get current period usage
 */
export async function getCurrentUsage(companyId) {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, status: 'active' },
  });

  if (!subscription) return null;

  const usage = await prisma.usageRecord.groupBy({
    by: ['type'],
    where: {
      companyId,
      recordedAt: {
        gte: subscription.currentPeriodStart,
        lte: subscription.currentPeriodEnd,
      },
    },
    _sum: { quantity: true },
  });

  const tier = SAAS_TIERS[subscription.tier];
  
  return usage.map(u => ({
    type: u.type,
    used: u._sum.quantity,
    included: tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0,
    overage: Math.max(0, u._sum.quantity - (tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0)),
  }));
}

/**
 * Calculate usage charges for billing period
 */
export async function calculateUsageCharges(companyId, periodStart, periodEnd) {
  const usage = await prisma.usageRecord.groupBy({
    by: ['type'],
    where: {
      companyId,
      recordedAt: { gte: periodStart, lte: periodEnd },
    },
    _sum: { quantity: true },
  });

  const subscription = await prisma.subscription.findFirst({
    where: { companyId },
  });

  const tier = subscription ? SAAS_TIERS[subscription.tier] : null;
  let totalCharges = 0;
  const breakdown = [];

  // Usage rates
  const rates = {
    sms: 0.02, // $0.02 per SMS overage
    call_minute: 0.05, // $0.05 per minute overage
    email: 0.001, // $0.001 per email overage
  };

  for (const u of usage) {
    const included = tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0;
    const overage = Math.max(0, u._sum.quantity - included);
    const rate = rates[u.type] || 0;
    const charge = overage * rate * 100; // Convert to cents

    totalCharges += charge;

    breakdown.push({
      type: u.type,
      used: u._sum.quantity,
      included,
      overage,
      rate,
      charge,
    });
  }

  return { totalCharges, breakdown };
}

// ============================================
// INVOICING
// ============================================

/**
 * Generate invoice for a billing period
 */
export async function generateInvoice(companyId, { periodStart, periodEnd }) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { subscription: true },
  });

  if (!company) throw new Error('Company not found');

  const subscription = company.subscription;
  const tier = subscription ? SAAS_TIERS[subscription.tier] : null;

  // Line items
  const lineItems = [];

  // Subscription fee
  if (subscription) {
    lineItems.push({
      description: `${tier?.name || '{{COMPANY_NAME}}'} Subscription`,
      quantity: 1,
      unitPrice: subscription.totalPrice,
      total: subscription.totalPrice,
    });
  }

  // Usage charges
  const usageCharges = await calculateUsageCharges(companyId, periodStart, periodEnd);
  for (const item of usageCharges.breakdown) {
    if (item.charge > 0) {
      lineItems.push({
        description: `${item.type} overage (${item.overage} x $${item.rate})`,
        quantity: item.overage,
        unitPrice: item.rate * 100,
        total: item.charge,
      });
    }
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = 0;
  const total = subtotal + tax;

  // Create invoice
  const invoiceCount = await prisma.billingInvoice.count({ where: { companyId } });
  
  const invoice = await prisma.billingInvoice.create({
    data: {
      companyId,
      number: `INV-${String(invoiceCount + 1).padStart(6, '0')}`,
      
      periodStart,
      periodEnd,
      
      lineItems,
      
      subtotal,
      tax,
      total,
      
      status: 'pending',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return invoice;
}

// ============================================
// WEBHOOK HANDLERS
// ============================================

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(event) {
  switch (event.type) {
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object);
      break;
  }
}

async function handleInvoicePaid(stripeInvoice) {
  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeInvoice.subscription },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'active',
        currentPeriodStart: new Date(stripeInvoice.period_start * 1000),
        currentPeriodEnd: new Date(stripeInvoice.period_end * 1000),
      },
    });
  }
}

async function handlePaymentFailed(stripeInvoice) {
  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeInvoice.subscription },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due' },
    });
  }
}

async function handleSubscriptionUpdated(stripeSubscription) {
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: stripeSubscription.id },
    data: {
      status: stripeSubscription.status,
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
    },
  });
}

async function handleSubscriptionDeleted(stripeSubscription) {
  const subscription = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: stripeSubscription.id },
  });

  if (subscription) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'canceled' },
    });

    // Downgrade to core features only
    const tier = SAAS_TIERS.starter;
    await prisma.company.update({
      where: { id: subscription.companyId },
      data: {
        enabledFeatures: tier.features,
        subscriptionTier: null,
      },
    });
  }
}

export default {
  createSubscription,
  cancelSubscription,
  changeTier,
  updateUserCount,
  processOneTimePurchase,
  purchaseAddon,
  trackUsage,
  getCurrentUsage,
  calculateUsageCharges,
  generateInvoice,
  handleStripeWebhook,
};