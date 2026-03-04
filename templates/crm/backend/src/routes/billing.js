/**
 * Billing Routes
 * 
 * API endpoints for:
 * - View pricing/packages
 * - Subscribe/cancel
 * - One-time purchase
 * - Usage & invoices
 * - Stripe webhooks
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import billing from '../services/billing.js';
import { prisma } from '../index.js';
import Stripe from 'stripe';

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// Plan pricing in cents
const PLAN_PRICING = {
  starter: { monthly: 4900, annual: 3900 },
  pro: { monthly: 14900, annual: 11900 },
  business: { monthly: 29900, annual: 23900 },
  construction: { monthly: 59900, annual: 47900 },
  enterprise: { monthly: 19900, annual: 15900 }, // per user
};

// Add-on pricing in cents (monthly)
const ADDON_PRICING = {
  sms: { price: 3900, name: 'SMS Communication', features: ['sms', 'sms_templates', 'scheduled_sms'] },
  gps_field: { price: 4900, name: 'GPS & Field', features: ['gps_tracking', 'geofencing', 'route_optimization', 'auto_clock'] },
  inventory: { price: 4900, name: 'Inventory', features: ['inventory', 'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders'] },
  fleet: { price: 3900, name: 'Fleet Management', features: ['fleet_vehicles', 'fleet_maintenance', 'fleet_fuel'] },
  equipment: { price: 2900, name: 'Equipment Tracking', features: ['equipment_tracking', 'equipment_maintenance'] },
  marketing: { price: 5900, name: 'Marketing Suite', features: ['review_requests', 'email_campaigns', 'call_tracking'] },
  construction_pm: { price: 14900, name: 'Construction PM', features: ['projects', 'change_orders', 'rfis', 'submittals', 'daily_logs', 'punch_lists', 'inspections'] },
  compliance: { price: 7900, name: 'Compliance & Draws', features: ['lien_waivers', 'draw_schedules', 'draw_requests', 'aia_forms'] },
  forms: { price: 2900, name: 'Custom Forms', features: ['custom_forms'] },
  integrations: { price: 4900, name: 'Integrations', features: ['quickbooks_sync', 'consumer_financing'] },
};

// Self-hosted license pricing in cents (one-time)
const SELF_HOSTED_PRICING = {
  starter: { price: 99700, name: 'Starter License' },
  pro: { price: 249700, name: 'Pro License' },
  business: { price: 499700, name: 'Business License' },
  construction: { price: 999700, name: 'Construction License' },
  full: { price: 1499700, name: 'Full Platform License' },
};

// Self-hosted add-ons
const SELF_HOSTED_ADDONS = {
  installation: { price: 50000, name: 'Installation Service' },
  updates: { price: 99900, name: 'Annual Updates', recurring: true },
  support: { price: 19900, name: 'Monthly Support', recurring: true },
  whitelabel: { price: 50000, name: 'White-Label Setup' },
};

const PLAN_HIERARCHY = ['starter', 'pro', 'business', 'construction', 'enterprise'];

// ============================================
// PUBLIC - Pricing Info
// ============================================

/**
 * Get all pricing information
 */
router.get('/pricing', (req, res) => {
  res.json({
    plans: PLAN_PRICING,
    trialDays: 14,
  });
});

// ============================================
// AUTHENTICATED - Trial & Checkout
// ============================================

/**
 * Start free trial (after signup)
 */
router.post('/start-trial', authenticate, async (req, res, next) => {
  try {
    const { plan } = req.body;
    
    // Validate plan
    if (!PLAN_PRICING[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get company
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Check if already has active subscription
    const existingSub = await prisma.subscription.findFirst({
      where: {
        companyId: req.user.companyId,
        status: { in: ['active', 'trialing'] },
      },
    });

    if (existingSub) {
      return res.status(400).json({ error: 'Already has active subscription' });
    }

    // Calculate trial end
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    // Update/create subscription
    const subscription = await prisma.subscription.upsert({
      where: {
        id: (await prisma.subscription.findFirst({
          where: { companyId: req.user.companyId },
        }))?.id || 'new',
      },
      create: {
        companyId: req.user.companyId,
        plan,
        status: 'trialing',
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
        cancelAtPeriodEnd: false,
      },
      update: {
        plan,
        status: 'trialing',
        currentPeriodStart: new Date(),
        currentPeriodEnd: trialEnd,
        cancelAtPeriodEnd: false,
      },
    });

    // Update company settings
    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        settings: {
          ...(company.settings || {}),
          plan,
          subscriptionStatus: 'trialing',
          trialEndsAt: trialEnd.toISOString(),
        },
      },
    });

    res.json({
      subscription,
      trialEndsAt: trialEnd,
      message: 'Trial started successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create Stripe checkout session
 */
router.post('/create-checkout', authenticate, async (req, res, next) => {
  try {
    const { plan, billingCycle, successUrl, cancelUrl } = req.body;
    
    // Validate
    if (!PLAN_PRICING[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    // Get company
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Get or create Stripe customer
    let customerId = company.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email,
        name: company.name,
        metadata: {
          companyId: company.id,
        },
      });
      customerId = customer.id;
      
      await prisma.company.update({
        where: { id: company.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // Get price ID from environment or create one-time price
    const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`];
    const amount = PLAN_PRICING[plan][billingCycle];

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        priceId
          ? { price: priceId, quantity: 1 }
          : {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `Twomiah Build ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
                  description: billingCycle === 'annual' ? 'Billed annually' : 'Billed monthly',
                },
                unit_amount: amount,
                recurring: {
                  interval: billingCycle === 'annual' ? 'year' : 'month',
                },
              },
              quantity: 1,
            },
      ],
      success_url: successUrl || `${process.env.FRONTEND_URL}/signup/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/signup?canceled=true`,
      metadata: {
        companyId: company.id,
        plan,
        billingCycle,
      },
      subscription_data: {
        metadata: {
          companyId: company.id,
          plan,
        },
      },
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Handle successful checkout (redirect endpoint)
 */
router.get('/checkout/success', authenticate, async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    // Retrieve checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    if (session.metadata.companyId !== req.user.companyId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get subscription details
    const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);

    // Update our subscription record
    await prisma.subscription.upsert({
      where: {
        stripeSubscriptionId: stripeSubscription.id,
      },
      create: {
        companyId: req.user.companyId,
        stripeSubscriptionId: stripeSubscription.id,
        plan: session.metadata.plan,
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
      update: {
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    });

    // Update company
    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        settings: {
          plan: session.metadata.plan,
          subscriptionStatus: 'active',
          billingCycle: session.metadata.billingCycle,
        },
      },
    });

    res.json({
      success: true,
      subscription: {
        plan: session.metadata.plan,
        status: 'active',
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// AUTHENTICATED - Subscription Management
// ============================================

/**
 * Get current subscription
 */
router.get('/subscription', authenticate, async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return res.json({ subscription: null });
    }
    
    res.json({ subscription });
  } catch (error) {
    next(error);
  }
});

/**
 * Create subscription
 */
router.post('/subscription', authenticate, async (req, res, next) => {
  try {
    const { packageId, billingCycle, userCount, addons, paymentMethodId } = req.body;

    const result = await billing.createSubscription(req.user.companyId, {
      packageId,
      billingCycle,
      userCount,
      addons,
      paymentMethodId,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Cancel subscription
 */
router.post('/subscription/cancel', authenticate, async (req, res, next) => {
  try {
    const { immediate } = req.body;
    
    const subscription = await prisma.subscription.findFirst({
      where: { companyId: req.user.companyId, status: { in: ['active', 'trialing'] } },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // If has Stripe subscription, cancel there
    if (subscription.stripeSubscriptionId) {
      if (immediate) {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      } else {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      }
    }

    // Update our record
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: immediate 
        ? { status: 'canceled', canceledAt: new Date() }
        : { cancelAtPeriodEnd: true },
    });

    res.json({ 
      success: true,
      message: immediate 
        ? 'Subscription canceled immediately'
        : 'Subscription will cancel at end of billing period',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Reactivate canceled subscription
 */
router.post('/subscription/reactivate', authenticate, async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    if (subscription.stripeSubscriptionId && subscription.cancelAtPeriodEnd) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, status: 'active' },
    });

    res.json({ success: true, message: 'Subscription reactivated' });
  } catch (error) {
    next(error);
  }
});

/**
 * Change plan (upgrade/downgrade)
 */
router.post('/subscription/change-plan', authenticate, async (req, res, next) => {
  try {
    const { plan, immediate = true } = req.body;

    if (!PLAN_PRICING[plan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const subscription = await prisma.subscription.findFirst({
      where: { companyId: req.user.companyId, status: { in: ['active', 'trialing'] } },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription' });
    }

    const currentPlanIndex = PLAN_HIERARCHY.indexOf(subscription.plan);
    const newPlanIndex = PLAN_HIERARCHY.indexOf(plan);
    const isUpgrade = newPlanIndex > currentPlanIndex;
    const isDowngrade = newPlanIndex < currentPlanIndex;

    // If no Stripe subscription (trial), just update plan
    if (!subscription.stripeSubscriptionId) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { plan },
      });

      await prisma.company.update({
        where: { id: req.user.companyId },
        data: {
          settings: { ...(company.settings || {}), plan },
        },
      });

      return res.json({ success: true, plan, message: 'Plan updated' });
    }

    // Get Stripe subscription
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const billingCycle = stripeSub.items.data[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly';
    const newAmount = PLAN_PRICING[plan][billingCycle];

    // Create new price or use existing
    const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`];

    if (isUpgrade) {
      // Upgrade: Charge prorated amount immediately
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{
          id: stripeSub.items.data[0].id,
          price_data: priceId ? undefined : {
            currency: 'usd',
            product: stripeSub.items.data[0].price.product,
            unit_amount: newAmount,
            recurring: { interval: billingCycle === 'annual' ? 'year' : 'month' },
          },
          price: priceId || undefined,
        }],
        proration_behavior: 'create_prorations',
        metadata: { plan },
      });
    } else if (isDowngrade) {
      // Downgrade: Apply at end of current period
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{
          id: stripeSub.items.data[0].id,
          price_data: priceId ? undefined : {
            currency: 'usd',
            product: stripeSub.items.data[0].price.product,
            unit_amount: newAmount,
            recurring: { interval: billingCycle === 'annual' ? 'year' : 'month' },
          },
          price: priceId || undefined,
        }],
        proration_behavior: immediate ? 'create_prorations' : 'none',
        metadata: { plan },
      });
    }

    // Update our records
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { plan },
    });

    await prisma.company.update({
      where: { id: req.user.companyId },
      data: {
        settings: { ...(company.settings || {}), plan },
      },
    });

    res.json({
      success: true,
      plan,
      isUpgrade,
      isDowngrade,
      message: isUpgrade 
        ? 'Upgraded successfully. Prorated charge applied.'
        : 'Downgraded. Changes apply at next billing cycle.',
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ADD-ON PURCHASING
// ============================================

/**
 * Get available add-ons
 */
router.get('/addons', authenticate, async (req, res, next) => {
  try {
    // Get current add-ons
    const purchased = await prisma.addonPurchase.findMany({
      where: { 
        companyId: req.user.companyId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    const purchasedIds = purchased.map(p => p.addonId);

    const available = Object.entries(ADDON_PRICING).map(([id, addon]) => ({
      id,
      ...addon,
      price: addon.price / 100,
      purchased: purchasedIds.includes(id),
    }));

    res.json({ addons: available, purchased });
  } catch (error) {
    next(error);
  }
});

/**
 * Purchase add-on
 */
router.post('/addons/purchase', authenticate, async (req, res, next) => {
  try {
    const { addonId } = req.body;

    const addon = ADDON_PRICING[addonId];
    if (!addon) {
      return res.status(400).json({ error: 'Invalid add-on' });
    }

    // Check if already purchased
    const existing = await prisma.addonPurchase.findFirst({
      where: {
        companyId: req.user.companyId,
        addonId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (existing) {
      return res.status(400).json({ error: 'Add-on already purchased' });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    // Get or create Stripe customer
    let customerId = company.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email,
        name: company.name,
        metadata: { companyId: company.id },
      });
      customerId = customer.id;
      await prisma.company.update({
        where: { id: company.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // Create checkout session for add-on
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Twomiah Build ${addon.name}`,
            description: `Monthly add-on subscription`,
          },
          unit_amount: addon.price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/settings/billing?addon_success=${addonId}`,
      cancel_url: `${process.env.FRONTEND_URL}/settings/billing?addon_canceled=${addonId}`,
      metadata: {
        companyId: company.id,
        addonId,
        type: 'addon',
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    next(error);
  }
});

/**
 * Cancel add-on
 */
router.post('/addons/:addonId/cancel', authenticate, async (req, res, next) => {
  try {
    const { addonId } = req.params;

    const purchase = await prisma.addonPurchase.findFirst({
      where: {
        companyId: req.user.companyId,
        addonId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (!purchase) {
      return res.status(404).json({ error: 'Add-on not found' });
    }

    // Cancel Stripe subscription if exists
    if (purchase.stripeSubscriptionId) {
      await stripe.subscriptions.update(purchase.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    await prisma.addonPurchase.update({
      where: { id: purchase.id },
      data: { cancelAtPeriodEnd: true },
    });

    res.json({ success: true, message: 'Add-on will cancel at end of billing period' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// SELF-HOSTED PURCHASE
// ============================================

/**
 * Get self-hosted pricing
 */
router.get('/self-hosted/pricing', (req, res) => {
  const licenses = Object.entries(SELF_HOSTED_PRICING).map(([id, license]) => ({
    id,
    ...license,
    price: license.price / 100,
  }));

  const addons = Object.entries(SELF_HOSTED_ADDONS).map(([id, addon]) => ({
    id,
    ...addon,
    price: addon.price / 100,
  }));

  res.json({ licenses, addons });
});

/**
 * Create self-hosted purchase checkout
 */
router.post('/self-hosted/purchase', async (req, res, next) => {
  try {
    const { licenseId, addons = [], email, companyName } = req.body;

    const license = SELF_HOSTED_PRICING[licenseId];
    if (!license) {
      return res.status(400).json({ error: 'Invalid license' });
    }

    // Build line items
    const lineItems = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Twomiah Build ${license.name}`,
            description: 'Self-hosted perpetual license',
          },
          unit_amount: license.price,
        },
        quantity: 1,
      },
    ];

    // Add selected add-ons
    for (const addonId of addons) {
      const addon = SELF_HOSTED_ADDONS[addonId];
      if (addon) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Twomiah Build ${addon.name}`,
              description: addon.recurring ? 'Recurring service' : 'One-time service',
            },
            unit_amount: addon.price,
            ...(addon.recurring && {
              recurring: { interval: addonId === 'updates' ? 'year' : 'month' },
            }),
          },
          quantity: 1,
        });
      }
    }

    // Create or get customer
    let customer;
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        name: companyName,
        metadata: { type: 'self-hosted' },
      });
    }

    // Check if any recurring items
    const hasRecurring = addons.some(id => SELF_HOSTED_ADDONS[id]?.recurring);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: hasRecurring ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: `${process.env.FRONTEND_URL}/self-hosted/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?self-hosted=canceled`,
      metadata: {
        licenseId,
        addons: JSON.stringify(addons),
        type: 'self-hosted',
        email,
        companyName,
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    next(error);
  }
});

/**
 * Handle self-hosted purchase success
 */
router.get('/self-hosted/success', async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'Session ID required' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Create license record
    const license = await prisma.selfHostedLicense.create({
      data: {
        email: session.metadata.email,
        companyName: session.metadata.companyName,
        licenseType: session.metadata.licenseId,
        stripeSessionId: session.id,
        stripeCustomerId: session.customer,
        purchasedAt: new Date(),
        // Generate license key
        licenseKey: generateLicenseKey(),
      },
    });

    // Send license email (async)
    // await emailService.sendLicenseEmail(...)

    res.json({
      success: true,
      license: {
        id: license.id,
        licenseKey: license.licenseKey,
        licenseType: license.licenseType,
        downloadUrl: `${process.env.API_URL}/api/billing/self-hosted/download/${license.id}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Download self-hosted package
 */
router.get('/self-hosted/download/:licenseId', async (req, res, next) => {
  try {
    const { licenseId } = req.params;
    const { key } = req.query;

    const license = await prisma.selfHostedLicense.findUnique({
      where: { id: licenseId },
    });

    if (!license || license.licenseKey !== key) {
      return res.status(403).json({ error: 'Invalid license' });
    }

    // In production, this would serve the actual download
    // For now, return download info
    res.json({
      downloadUrl: `https://github.com/yourusername/twomiah-build/releases/latest`,
      documentation: 'https://docs.twomiah-build.app/self-hosted',
      licenseKey: license.licenseKey,
      instructions: [
        '1. Download the release package',
        '2. Extract to your server',
        '3. Run: npm install',
        '4. Configure .env with your license key',
        '5. Run: npm run setup',
        '6. Start with: npm start',
      ],
    });
  } catch (error) {
    next(error);
  }
});

// Helper function to generate license key
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = 4;
  const segmentLength = 5;
  const parts = [];
  
  for (let i = 0; i < segments; i++) {
    let segment = '';
    for (let j = 0; j < segmentLength; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(segment);
  }
  
  return parts.join('-');
}

/**
 * Change package (legacy endpoint)
 */
router.post('/subscription/change-package', authenticate, async (req, res, next) => {
  try {
    const { packageId, immediate } = req.body;
    const result = await billing.changePackage(req.user.companyId, packageId, { immediate });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Update user count
 */
router.post('/subscription/users', authenticate, async (req, res, next) => {
  try {
    const { userCount } = req.body;
    const result = await billing.updateUserCount(req.user.companyId, userCount);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ONE-TIME PURCHASE
// ============================================

/**
 * Process one-time purchase
 */
router.post('/purchase', authenticate, async (req, res, next) => {
  try {
    const { packageId, features, paymentMethodId } = req.body;

    const result = await billing.processOneTimePurchase(req.user.companyId, {
      packageId,
      features,
      paymentMethodId,
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Purchase add-on
 */
router.post('/purchase/addon', authenticate, async (req, res, next) => {
  try {
    const { addonId, quantity, paymentMethodId } = req.body;

    const result = await billing.purchaseAddon(req.user.companyId, addonId, {
      quantity,
      paymentMethodId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// USAGE & INVOICES
// ============================================

/**
 * Get current usage
 */
router.get('/usage', authenticate, async (req, res, next) => {
  try {
    const usage = await billing.getCurrentUsage(req.user.companyId);
    res.json(usage);
  } catch (error) {
    next(error);
  }
});

/**
 * Get invoices
 */
router.get('/invoices', authenticate, async (req, res, next) => {
  try {
    const invoices = await prisma.billingInvoice.findMany({
      where: { companyId: req.user.companyId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invoices);
  } catch (error) {
    next(error);
  }
});

/**
 * Get single invoice
 */
router.get('/invoices/:id', authenticate, async (req, res, next) => {
  try {
    const invoice = await prisma.billingInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PAYMENT METHODS
// ============================================

/**
 * Get payment methods
 */
router.get('/payment-methods', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    if (!company?.stripeCustomerId) {
      return res.json({ paymentMethods: [] });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: company.stripeCustomerId,
      type: 'card',
    });

    res.json({ paymentMethods: paymentMethods.data });
  } catch (error) {
    next(error);
  }
});

/**
 * Create setup intent for adding payment method
 */
router.post('/payment-methods/setup', authenticate, async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    let customerId = company?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: company.email,
        name: company.name,
        metadata: { companyId: req.user.companyId },
      });
      customerId = customer.id;
      await prisma.company.update({
        where: { id: req.user.companyId },
        data: { stripeCustomerId: customerId },
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    res.json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    next(error);
  }
});

/**
 * Remove payment method
 */
router.delete('/payment-methods/:id', authenticate, async (req, res, next) => {
  try {
    await stripe.paymentMethods.detach(req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// STRIPE WEBHOOK
// ============================================

router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await billing.handleStripeWebhook(event);
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

export default router;
