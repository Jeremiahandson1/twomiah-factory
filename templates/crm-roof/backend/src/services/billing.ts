/**
 * SaaS Billing Service — Roofing (Roof)
 *
 * Handles contractor-level SaaS subscription billing (NOT per-customer
 * invoices — that's handled by routes/invoices.ts).
 *
 * - Subscription management
 * - One-time purchases (self-hosted licenses)
 * - Usage tracking & overage billing
 * - Invoice generation (for the contractor's own Twomiah Roof subscription)
 * - Stripe integration
 *
 * Ported from crm/backend/src/services/billing.ts unchanged — Roof schema
 * has a `company` table matching Build's shape, so no aliasing needed.
 *
 * NOTE: subscription, billing_invoice, usage_record, addon_purchase tables
 * are created by migration 0007_add_saas_subscription_tables.sql and accessed
 * via raw SQL.
 */

import Stripe from 'stripe';
import { db } from '../../db/index.ts';
import { company } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { SAAS_TIERS, SELF_HOSTED_PACKAGES, SELF_HOSTED_ADDONS, FEATURE_BUNDLES, calculateUserPrice } from '../config/pricing.ts';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

if (!stripe) {
  console.log('Stripe not configured - billing features disabled');
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
export async function createSubscription(companyId: string, {
  tierId,
  billingCycle = 'monthly',
  userCount = 1,
  addons = [],
  paymentMethodId,
}: {
  tierId: string;
  billingCycle?: string;
  userCount?: number;
  addons?: string[];
  paymentMethodId?: string;
}) {
  const [comp] = await db.select()
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);

  if (!comp) throw new Error('Company not found');

  // Check existing active subscription via raw query
  const existingSub = await db.execute(sql`
    SELECT id, status FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const existingRows = (existingSub as any).rows || existingSub;
  if (existingRows.length > 0) {
    throw new Error('Company already has active subscription');
  }

  const tier = (SAAS_TIERS as any)[tierId];
  if (!tier) throw new Error('Invalid tier');

  const basePrice = billingCycle === 'yearly' ? tier.priceAnnual : tier.price;
  const totalPrice = calculateUserPrice(tierId, userCount);

  // Create or get Stripe customer
  let stripeCustomerId = comp.stripeCustomerId;
  if (!stripeCustomerId && stripe) {
    const customer = await stripe.customers.create({
      email: comp.email || undefined,
      name: comp.name,
      metadata: { companyId },
    });
    stripeCustomerId = customer.id;
    await db.update(company)
      .set({ stripeCustomerId, updatedAt: new Date() })
      .where(eq(company.id, companyId));
  }

  // Attach payment method
  if (paymentMethodId && stripe && stripeCustomerId) {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }

  // Create Stripe subscription
  const stripeSubscription = stripe ? await stripe.subscriptions.create({
    customer: stripeCustomerId!,
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
  }) : null;

  // Create local subscription record
  await db.execute(sql`
    INSERT INTO subscription (id, company_id, stripe_subscription_id, tier, billing_cycle, status, user_count, base_price, total_price, addons, current_period_start, current_period_end, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      ${companyId},
      ${stripeSubscription?.id || null},
      ${tierId},
      ${billingCycle},
      'active',
      ${userCount},
      ${basePrice},
      ${totalPrice},
      ${JSON.stringify(addons)}::jsonb,
      ${stripeSubscription ? new Date(stripeSubscription.current_period_start * 1000) : new Date()},
      ${stripeSubscription ? new Date(stripeSubscription.current_period_end * 1000) : new Date()},
      NOW(),
      NOW()
    )
  `);

  // Update company with enabled features
  await db.update(company)
    .set({
      enabledFeatures: tier.features,
      subscriptionTier: tierId,
      updatedAt: new Date(),
    })
    .where(eq(company.id, companyId));

  return { stripeSubscription };
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(companyId: string, { atPeriodEnd = true } = {}) {
  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const rows = (subResult as any).rows || subResult;
  const subscription = rows[0];

  if (!subscription) throw new Error('No active subscription');

  if (stripe) {
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: atPeriodEnd,
    });
  }

  await db.execute(sql`
    UPDATE subscription SET status = ${atPeriodEnd ? 'canceling' : 'canceled'}, canceled_at = NOW(), updated_at = NOW()
    WHERE id = ${subscription.id}
  `);

  return { success: true, endsAt: subscription.current_period_end };
}

/**
 * Change subscription tier
 */
export async function changeTier(companyId: string, newTierId: string, { immediate = false } = {}) {
  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const rows = (subResult as any).rows || subResult;
  const subscription = rows[0];

  if (!subscription) throw new Error('No active subscription');

  const newTier = (SAAS_TIERS as any)[newTierId];
  if (!newTier) throw new Error('Invalid tier');

  const totalPrice = calculateUserPrice(newTierId, subscription.user_count);

  if (stripe) {
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price_data: {
          currency: 'usd',
          product_data: { name: `{{COMPANY_NAME}} ${newTier.name}` },
          unit_amount: totalPrice,
          recurring: {
            interval: subscription.billing_cycle === 'yearly' ? 'year' : 'month',
          },
        },
      }],
      proration_behavior: immediate ? 'create_prorations' : 'none',
      metadata: { tierId: newTierId },
    });
  }

  const basePrice = subscription.billing_cycle === 'yearly' ? newTier.priceAnnual : newTier.price;
  await db.execute(sql`
    UPDATE subscription SET tier = ${newTierId}, base_price = ${basePrice}, total_price = ${totalPrice}, updated_at = NOW()
    WHERE id = ${subscription.id}
  `);

  await db.update(company)
    .set({
      enabledFeatures: newTier.features,
      subscriptionTier: newTierId,
      updatedAt: new Date(),
    })
    .where(eq(company.id, companyId));

  return { success: true };
}

/**
 * Update user count
 */
export async function updateUserCount(companyId: string, newUserCount: number) {
  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const rows = (subResult as any).rows || subResult;
  const subscription = rows[0];

  if (!subscription) throw new Error('No active subscription');

  const totalPrice = calculateUserPrice(subscription.tier, newUserCount);
  const tier = (SAAS_TIERS as any)[subscription.tier];

  if (stripe) {
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price_data: {
          currency: 'usd',
          product_data: { name: `{{COMPANY_NAME}} ${tier.name}` },
          unit_amount: totalPrice,
          recurring: {
            interval: subscription.billing_cycle === 'yearly' ? 'year' : 'month',
          },
        },
      }],
      proration_behavior: 'create_prorations',
      metadata: { userCount: String(newUserCount) },
    });
  }

  await db.execute(sql`
    UPDATE subscription SET user_count = ${newUserCount}, total_price = ${totalPrice}, updated_at = NOW()
    WHERE id = ${subscription.id}
  `);

  return { success: true, newPrice: totalPrice };
}

// ============================================
// ONE-TIME PURCHASE
// ============================================

/**
 * Process one-time purchase (lifetime license)
 */
export async function processOneTimePurchase(companyId: string, {
  packageId,
  paymentMethodId,
}: {
  packageId: string;
  paymentMethodId: string;
}) {
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1);
  if (!comp) throw new Error('Company not found');

  const pkg = (SELF_HOSTED_PACKAGES as any)[packageId];
  if (!pkg) throw new Error('Package not available for one-time purchase');

  const amount = pkg.price;
  const enabledFeatures = pkg.features;
  const description = `{{COMPANY_NAME}} ${pkg.name} - Lifetime License`;

  let stripeCustomerId = comp.stripeCustomerId;
  if (!stripeCustomerId && stripe) {
    const customer = await stripe.customers.create({
      email: comp.email || undefined,
      name: comp.name,
      metadata: { companyId },
    });
    stripeCustomerId = customer.id;
    await db.update(company)
      .set({ stripeCustomerId, updatedAt: new Date() })
      .where(eq(company.id, companyId));
  }

  if (!stripe) throw new Error('Stripe not configured');

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: stripeCustomerId!,
    payment_method: paymentMethodId,
    confirm: true,
    description,
    metadata: { companyId, packageId, type: 'lifetime' },
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment failed');
  }

  await db.update(company)
    .set({
      enabledFeatures,
      subscriptionTier: packageId,
      lifetimeAccess: true,
      updatedAt: new Date(),
    })
    .where(eq(company.id, companyId));

  return { success: true, paymentIntent };
}

/**
 * Purchase addon
 */
export async function purchaseAddon(companyId: string, addonId: string, quantity = 1, paymentMethodId: string) {
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1);
  if (!comp) throw new Error('Company not found');

  const addon = (SELF_HOSTED_ADDONS as any)[addonId];
  if (!addon) throw new Error('Invalid addon');

  const amount = addon.price * quantity;

  if (!stripe) throw new Error('Stripe not configured');

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: comp.stripeCustomerId!,
    payment_method: paymentMethodId,
    confirm: true,
    description: `${addon.name} x${quantity}`,
    metadata: { companyId, addonId, quantity: String(quantity) },
  });

  if (paymentIntent.status !== 'succeeded') {
    throw new Error('Payment failed');
  }

  await db.execute(sql`
    INSERT INTO addon_purchase (id, company_id, addon_id, quantity, amount, stripe_payment_id, created_at)
    VALUES (gen_random_uuid(), ${companyId}, ${addonId}, ${quantity}, ${amount}, ${paymentIntent.id}, NOW())
  `);

  return { success: true, paymentIntent };
}

// ============================================
// USAGE-BASED BILLING
// ============================================

/**
 * Track usage (SMS, calls, etc.)
 */
export async function trackUsage(companyId: string, usageType: string, quantity = 1, metadata: Record<string, unknown> = {}) {
  await db.execute(sql`
    INSERT INTO usage_record (id, company_id, type, quantity, metadata, recorded_at, created_at)
    VALUES (gen_random_uuid(), ${companyId}, ${usageType}, ${quantity}, ${JSON.stringify(metadata)}::jsonb, NOW(), NOW())
  `);
}

/**
 * Get current period usage
 */
export async function getCurrentUsage(companyId: string) {
  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const rows = (subResult as any).rows || subResult;
  const subscription = rows[0];

  if (!subscription) return null;

  const usageResult = await db.execute(sql`
    SELECT type, SUM(quantity)::int as total_quantity
    FROM usage_record
    WHERE company_id = ${companyId}
      AND recorded_at >= ${subscription.current_period_start}
      AND recorded_at <= ${subscription.current_period_end}
    GROUP BY type
  `);
  const usage = (usageResult as any).rows || usageResult;

  const tier = (SAAS_TIERS as any)[subscription.tier];

  return (usage as any[]).map((u: any) => ({
    type: u.type,
    used: u.total_quantity,
    included: tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0,
    overage: Math.max(0, u.total_quantity - (tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0)),
  }));
}

/**
 * Calculate usage charges for billing period
 */
export async function calculateUsageCharges(companyId: string, periodStart: Date, periodEnd: Date) {
  const usageResult = await db.execute(sql`
    SELECT type, SUM(quantity)::int as total_quantity
    FROM usage_record
    WHERE company_id = ${companyId}
      AND recorded_at >= ${periodStart}
      AND recorded_at <= ${periodEnd}
    GROUP BY type
  `);
  const usage = (usageResult as any).rows || usageResult;

  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} LIMIT 1
  `);
  const subRows = (subResult as any).rows || subResult;
  const subscription = subRows[0];

  const tier = subscription ? (SAAS_TIERS as any)[subscription.tier] : null;
  let totalCharges = 0;
  const breakdown: Array<{
    type: string;
    used: number;
    included: number;
    overage: number;
    rate: number;
    charge: number;
  }> = [];

  const rates: Record<string, number> = {
    sms: 0.02,
    call_minute: 0.05,
    email: 0.001,
  };

  for (const u of usage as any[]) {
    const included = tier?.limits?.[u.type === 'sms' ? 'smsCredits' : u.type] || 0;
    const overage = Math.max(0, u.total_quantity - included);
    const rate = rates[u.type] || 0;
    const charge = overage * rate * 100;

    totalCharges += charge;

    breakdown.push({
      type: u.type,
      used: u.total_quantity,
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
export async function generateInvoice(companyId: string, { periodStart, periodEnd }: { periodStart: Date; periodEnd: Date }) {
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1);
  if (!comp) throw new Error('Company not found');

  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE company_id = ${companyId} AND status = 'active' LIMIT 1
  `);
  const subRows = (subResult as any).rows || subResult;
  const subscription = subRows[0];
  const tier = subscription ? (SAAS_TIERS as any)[subscription.tier] : null;

  const lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }> = [];

  if (subscription) {
    lineItems.push({
      description: `${tier?.name || '{{COMPANY_NAME}}'} Subscription`,
      quantity: 1,
      unitPrice: subscription.total_price,
      total: subscription.total_price,
    });
  }

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

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as cnt FROM billing_invoice WHERE company_id = ${companyId}
  `);
  const invoiceCount = Number((countResult as any).rows?.[0]?.cnt || 0);

  await db.execute(sql`
    INSERT INTO billing_invoice (id, company_id, number, period_start, period_end, line_items, subtotal, tax, total, status, due_date, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      ${companyId},
      ${`INV-${String(invoiceCount + 1).padStart(6, '0')}`},
      ${periodStart},
      ${periodEnd},
      ${JSON.stringify(lineItems)}::jsonb,
      ${subtotal},
      ${tax},
      ${total},
      'pending',
      ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)},
      NOW(),
      NOW()
    )
  `);

  return { number: `INV-${String(invoiceCount + 1).padStart(6, '0')}`, subtotal, tax, total };
}

// ============================================
// WEBHOOK HANDLERS
// ============================================

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(event: { type: string; data: { object: any } }) {
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

async function handleInvoicePaid(stripeInvoice: any) {
  await db.execute(sql`
    UPDATE subscription SET
      status = 'active',
      current_period_start = ${new Date(stripeInvoice.period_start * 1000)},
      current_period_end = ${new Date(stripeInvoice.period_end * 1000)},
      updated_at = NOW()
    WHERE stripe_subscription_id = ${stripeInvoice.subscription}
  `);
}

async function handlePaymentFailed(stripeInvoice: any) {
  await db.execute(sql`
    UPDATE subscription SET status = 'past_due', updated_at = NOW()
    WHERE stripe_subscription_id = ${stripeInvoice.subscription}
  `);
}

async function handleSubscriptionUpdated(stripeSubscription: any) {
  await db.execute(sql`
    UPDATE subscription SET
      status = ${stripeSubscription.status},
      current_period_end = ${new Date(stripeSubscription.current_period_end * 1000)},
      updated_at = NOW()
    WHERE stripe_subscription_id = ${stripeSubscription.id}
  `);
}

async function handleSubscriptionDeleted(stripeSubscription: any) {
  const subResult = await db.execute(sql`
    SELECT * FROM subscription WHERE stripe_subscription_id = ${stripeSubscription.id} LIMIT 1
  `);
  const rows = (subResult as any).rows || subResult;
  const subscription = rows[0];

  if (subscription) {
    await db.execute(sql`
      UPDATE subscription SET status = 'canceled', updated_at = NOW()
      WHERE id = ${subscription.id}
    `);

    const tier = (SAAS_TIERS as any).starter;
    await db.update(company)
      .set({
        enabledFeatures: tier.features,
        subscriptionTier: null,
        updatedAt: new Date(),
      })
      .where(eq(company.id, subscription.company_id));
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
