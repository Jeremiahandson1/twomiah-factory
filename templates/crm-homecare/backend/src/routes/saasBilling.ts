/**
 * SaaS Billing Routes — Home Care (Care)
 *
 * API endpoints for AGENCY-level subscription management. Separate from
 * routes/billing.ts which handles per-client invoice billing.
 *
 * - GET  /pricing          — Public pricing for the pricing page
 * - POST /start-trial      — 30-day free trial
 * - POST /create-checkout  — Stripe checkout for subscription
 * - GET  /subscription     — Current subscription status
 * - POST /subscription/*   — Change/cancel/reactivate
 * - POST /webhook          — Stripe subscription webhooks
 *
 * NOTE: This file was copied from crm/backend/src/routes/billing.ts and
 * renamed top-tier "construction" → "agency". It references a billing
 * service at ../services/billing.ts which may need to be ported from crm/
 * and adapted to the homecare schema (subscription/addon_purchase/
 * usage_record/billing_invoice tables may not exist yet).
 */

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
// Care's tenant table is `agencies` — aliased to `company` so the rest of
// this ported file reads unchanged.
import { agencies as company } from '../../db/schema.ts'
import { SAAS_TIERS, WEBSITE_TIERS, FEATURE_BUNDLES } from '../config/pricing.ts'
import { eq, and, or, gt, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import billing from '../services/billing.ts'
import Stripe from 'stripe'

const app = new Hono()
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

// Built dynamically from canonical config in pricing.ts so values can't drift.
// Care's top tier is "agency".
const PLAN_PRICING: Record<string, { monthly: number; annual: number; bundledWebsite: string | null; displayName: string; description: string; heroFeatures: string[]; users: any }> = Object.fromEntries(
  Object.entries(SAAS_TIERS).map(([id, tier]: [string, any]) => [
    id,
    {
      monthly: tier.price,
      annual: tier.priceAnnual,
      bundledWebsite: tier.bundledWebsite ?? null,
      displayName: tier.name,
      description: tier.description,
      heroFeatures: tier.heroFeatures ?? [],
      users: tier.users,
    },
  ])
)

const WEBSITE_PRICING: Record<string, { monthly: number; annual: number; name: string; tagline: string; description: string; features: string[] }> = Object.fromEntries(
  Object.entries(WEBSITE_TIERS).map(([id, tier]: [string, any]) => [
    id,
    {
      monthly: tier.price,
      annual: tier.priceAnnual,
      name: tier.name,
      tagline: tier.tagline,
      description: tier.description,
      features: tier.features ?? [],
    },
  ])
)

const ADDON_PRICING: Record<string, any> = Object.fromEntries(
  Object.entries(FEATURE_BUNDLES).map(([id, bundle]: [string, any]) => [
    id,
    {
      price: bundle.price,
      name: bundle.name,
      description: bundle.description,
      features: bundle.features ?? [],
      subFeatures: bundle.subFeatures ?? null,
    },
  ])
)

// Self-hosted license pricing in cents (one-time)
const SELF_HOSTED_PRICING: Record<string, any> = {
  starter: { price: 99700, name: 'Starter License' },
  pro: { price: 249700, name: 'Pro License' },
  business: { price: 499700, name: 'Business License' },
  agency: { price: 999700, name: 'Agency License' },
  full: { price: 1499700, name: 'Full Platform License' },
}

// Self-hosted add-ons
const SELF_HOSTED_ADDONS: Record<string, any> = {
  installation: { price: 50000, name: 'Installation Service' },
  updates: { price: 99900, name: 'Annual Updates', recurring: true },
  support: { price: 19900, name: 'Monthly Support', recurring: true },
  whitelabel: { price: 50000, name: 'White-Label Setup' },
}

const PLAN_HIERARCHY = ['starter', 'pro', 'business', 'agency', 'enterprise']

// ============================================
// PUBLIC - Pricing Info
// ============================================

app.get('/pricing', (c) => {
  return c.json({
    plans: PLAN_PRICING,
    websiteTiers: WEBSITE_PRICING,
    trialDays: 30,
    moneyBackGuaranteeDays: 60,
  })
})

// ============================================
// AUTHENTICATED - Trial & Checkout
// ============================================

app.post('/start-trial', authenticate, async (c) => {
  const user = c.get('user') as any
  const { plan } = await c.req.json()

  if (!PLAN_PRICING[plan]) {
    return c.json({ error: 'Invalid plan' }, 400)
  }

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)

  // Check if already has active subscription (using raw SQL since subscription table not in schema)
  const existingSub = await db.execute(sql`SELECT id FROM subscription WHERE company_id = ${user.companyId} AND status IN ('active', 'trialing') LIMIT 1`)
  if ((existingSub as any).rows?.length > 0) {
    return c.json({ error: 'Already has active subscription' }, 400)
  }

  const trialEnd = new Date()
  trialEnd.setDate(trialEnd.getDate() + 30)

  // Check for existing subscription
  const existingSubRow = await db.execute(sql`SELECT id FROM subscription WHERE company_id = ${user.companyId} LIMIT 1`)
  const existingId = (existingSubRow as any).rows?.[0]?.id

  let subscription
  if (existingId) {
    const result = await db.execute(sql`UPDATE subscription SET plan = ${plan}, status = 'trialing', current_period_start = NOW(), current_period_end = ${trialEnd}, cancel_at_period_end = false, updated_at = NOW() WHERE id = ${existingId} RETURNING *`)
    subscription = (result as any).rows?.[0]
  } else {
    const result = await db.execute(sql`INSERT INTO subscription (company_id, plan, status, current_period_start, current_period_end, cancel_at_period_end) VALUES (${user.companyId}, ${plan}, 'trialing', NOW(), ${trialEnd}, false) RETURNING *`)
    subscription = (result as any).rows?.[0]
  }

  await db.update(company).set({
    settings: {
      ...(comp.settings as any || {}),
      plan,
      subscriptionStatus: 'trialing',
      trialEndsAt: trialEnd.toISOString(),
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({
    subscription,
    trialEndsAt: trialEnd,
    message: 'Trial started successfully',
  })
})

app.post('/create-checkout', authenticate, async (c) => {
  const user = c.get('user') as any
  const { plan, billingCycle, successUrl, cancelUrl } = await c.req.json()

  if (!PLAN_PRICING[plan]) return c.json({ error: 'Invalid plan' }, 400)
  if (!['monthly', 'annual'].includes(billingCycle)) return c.json({ error: 'Invalid billing cycle' }, 400)

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)

  let customerId = comp.stripeCustomerId
  if (!customerId) {
    const customer = await stripe!.customers.create({
      email: comp.email!,
      name: comp.name,
      metadata: { companyId: comp.id },
    })
    customerId = customer.id
    await db.update(company).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(company.id, comp.id))
  }

  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`]
  const amount = PLAN_PRICING[plan][billingCycle]

  const session = await stripe!.checkout.sessions.create({
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
                name: `{{COMPANY_NAME}} ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
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
    metadata: { companyId: comp.id, plan, billingCycle },
    subscription_data: { metadata: { companyId: comp.id, plan } },
  })

  return c.json({ checkoutUrl: session.url, sessionId: session.id })
})

app.get('/checkout/success', authenticate, async (c) => {
  const user = c.get('user') as any
  const session_id = c.req.query('session_id')

  if (!session_id) return c.json({ error: 'Session ID required' }, 400)

  const session = await stripe!.checkout.sessions.retrieve(session_id)
  if (session.metadata!.companyId !== user.companyId) return c.json({ error: 'Unauthorized' }, 403)

  const stripeSubscription = await stripe!.subscriptions.retrieve(session.subscription as string)

  // Upsert subscription via raw SQL (table not in drizzle schema)
  await db.execute(sql`
    INSERT INTO subscription (stripe_subscription_id, company_id, plan, status, current_period_start, current_period_end, cancel_at_period_end)
    VALUES (${stripeSubscription.id}, ${user.companyId}, ${session.metadata!.plan}, ${stripeSubscription.status}, ${new Date(stripeSubscription.current_period_start * 1000)}, ${new Date(stripeSubscription.current_period_end * 1000)}, ${stripeSubscription.cancel_at_period_end})
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW()
  `)

  await db.update(company).set({
    settings: {
      plan: session.metadata!.plan,
      subscriptionStatus: 'active',
      billingCycle: session.metadata!.billingCycle,
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({
    success: true,
    subscription: { plan: session.metadata!.plan, status: 'active' },
  })
})

// ============================================
// AUTHENTICATED - Subscription Management
// ============================================

app.get('/subscription', authenticate, async (c) => {
  const user = c.get('user') as any
  const result = await db.execute(sql`SELECT * FROM subscription WHERE company_id = ${user.companyId} ORDER BY created_at DESC LIMIT 1`)
  const subscription = (result as any).rows?.[0] || null
  return c.json({ subscription })
})

app.post('/subscription', authenticate, async (c) => {
  const user = c.get('user') as any
  const { packageId, billingCycle, userCount, addons, paymentMethodId } = await c.req.json()
  const result = await billing.createSubscription(user.companyId, { packageId, billingCycle, userCount, addons, paymentMethodId })
  return c.json(result, 201)
})

app.post('/subscription/cancel', authenticate, async (c) => {
  const user = c.get('user') as any
  const { immediate } = await c.req.json()

  const subResult = await db.execute(sql`SELECT * FROM subscription WHERE company_id = ${user.companyId} AND status IN ('active', 'trialing') LIMIT 1`)
  const subscription = (subResult as any).rows?.[0]
  if (!subscription) return c.json({ error: 'No active subscription found' }, 404)

  if (subscription.stripe_subscription_id) {
    if (immediate) {
      await stripe!.subscriptions.cancel(subscription.stripe_subscription_id)
    } else {
      await stripe!.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true })
    }
  }

  if (immediate) {
    await db.execute(sql`UPDATE subscription SET status = 'canceled', canceled_at = NOW(), updated_at = NOW() WHERE id = ${subscription.id}`)
  } else {
    await db.execute(sql`UPDATE subscription SET cancel_at_period_end = true, updated_at = NOW() WHERE id = ${subscription.id}`)
  }

  return c.json({
    success: true,
    message: immediate
      ? 'Subscription canceled immediately'
      : 'Subscription will cancel at end of billing period',
  })
})

app.post('/subscription/reactivate', authenticate, async (c) => {
  const user = c.get('user') as any
  const subResult = await db.execute(sql`SELECT * FROM subscription WHERE company_id = ${user.companyId} ORDER BY created_at DESC LIMIT 1`)
  const subscription = (subResult as any).rows?.[0]
  if (!subscription) return c.json({ error: 'No subscription found' }, 404)

  if (subscription.stripe_subscription_id && subscription.cancel_at_period_end) {
    await stripe!.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: false })
  }

  await db.execute(sql`UPDATE subscription SET cancel_at_period_end = false, status = 'active', updated_at = NOW() WHERE id = ${subscription.id}`)
  return c.json({ success: true, message: 'Subscription reactivated' })
})

app.post('/subscription/change-plan', authenticate, async (c) => {
  const user = c.get('user') as any
  const { plan, immediate = true } = await c.req.json()

  if (!PLAN_PRICING[plan]) return c.json({ error: 'Invalid plan' }, 400)

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)

  const subResult = await db.execute(sql`SELECT * FROM subscription WHERE company_id = ${user.companyId} AND status IN ('active', 'trialing') LIMIT 1`)
  const subscription = (subResult as any).rows?.[0]
  if (!subscription) return c.json({ error: 'No active subscription' }, 404)

  const currentPlanIndex = PLAN_HIERARCHY.indexOf(subscription.plan)
  const newPlanIndex = PLAN_HIERARCHY.indexOf(plan)
  const isUpgrade = newPlanIndex > currentPlanIndex
  const isDowngrade = newPlanIndex < currentPlanIndex

  if (!subscription.stripe_subscription_id) {
    await db.execute(sql`UPDATE subscription SET plan = ${plan}, updated_at = NOW() WHERE id = ${subscription.id}`)
    await db.update(company).set({
      settings: { ...(comp!.settings as any || {}), plan },
      updatedAt: new Date(),
    }).where(eq(company.id, user.companyId))
    return c.json({ success: true, plan, message: 'Plan updated' })
  }

  const stripeSub = await stripe!.subscriptions.retrieve(subscription.stripe_subscription_id)
  const billingCycle = stripeSub.items.data[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly'
  const newAmount = PLAN_PRICING[plan][billingCycle]
  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${billingCycle.toUpperCase()}`]

  const itemUpdate: any = {
    id: stripeSub.items.data[0].id,
    ...(priceId ? { price: priceId } : {
      price_data: {
        currency: 'usd',
        product: stripeSub.items.data[0].price.product as string,
        unit_amount: newAmount,
        recurring: { interval: billingCycle === 'annual' ? 'year' as const : 'month' as const },
      },
    }),
  }

  if (isUpgrade) {
    await stripe!.subscriptions.update(subscription.stripe_subscription_id, {
      items: [itemUpdate],
      proration_behavior: 'create_prorations',
      metadata: { plan },
    })
  } else if (isDowngrade) {
    await stripe!.subscriptions.update(subscription.stripe_subscription_id, {
      items: [itemUpdate],
      proration_behavior: immediate ? 'create_prorations' : 'none',
      metadata: { plan },
    })
  }

  await db.execute(sql`UPDATE subscription SET plan = ${plan}, updated_at = NOW() WHERE id = ${subscription.id}`)
  await db.update(company).set({
    settings: { ...(comp!.settings as any || {}), plan },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({
    success: true,
    plan,
    isUpgrade,
    isDowngrade,
    message: isUpgrade
      ? 'Upgraded successfully. Prorated charge applied.'
      : 'Downgraded. Changes apply at next billing cycle.',
  })
})

// ============================================
// ADD-ON PURCHASING
// ============================================

app.get('/addons', authenticate, async (c) => {
  const user = c.get('user') as any
  const purchasedResult = await db.execute(sql`SELECT * FROM addon_purchase WHERE company_id = ${user.companyId} AND (expires_at IS NULL OR expires_at > NOW())`)
  const purchased = (purchasedResult as any).rows || []
  const purchasedIds = purchased.map((p: any) => p.addon_id)

  const available = Object.entries(ADDON_PRICING).map(([id, addon]: [string, any]) => ({
    id,
    ...addon,
    price: addon.price / 100,
    purchased: purchasedIds.includes(id),
  }))

  return c.json({ addons: available, purchased })
})

app.post('/addons/purchase', authenticate, async (c) => {
  const user = c.get('user') as any
  const { addonId } = await c.req.json()

  const addon = ADDON_PRICING[addonId]
  if (!addon) return c.json({ error: 'Invalid add-on' }, 400)

  const existingResult = await db.execute(sql`SELECT id FROM addon_purchase WHERE company_id = ${user.companyId} AND addon_id = ${addonId} AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`)
  if ((existingResult as any).rows?.length > 0) return c.json({ error: 'Add-on already purchased' }, 400)

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)

  let customerId = comp!.stripeCustomerId
  if (!customerId) {
    const customer = await stripe!.customers.create({
      email: comp!.email!,
      name: comp!.name,
      metadata: { companyId: comp!.id },
    })
    customerId = customer.id
    await db.update(company).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(company.id, comp!.id))
  }

  const session = await stripe!.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `{{COMPANY_NAME}} ${addon.name}`,
          description: 'Monthly add-on subscription',
        },
        unit_amount: addon.price,
        recurring: { interval: 'month' },
      },
      quantity: 1,
    }],
    success_url: `${process.env.FRONTEND_URL}/settings/billing?addon_success=${addonId}`,
    cancel_url: `${process.env.FRONTEND_URL}/settings/billing?addon_canceled=${addonId}`,
    metadata: { companyId: comp!.id, addonId, type: 'addon' },
  })

  return c.json({ checkoutUrl: session.url, sessionId: session.id })
})

app.post('/addons/:addonId/cancel', authenticate, async (c) => {
  const user = c.get('user') as any
  const addonId = c.req.param('addonId')

  const purchaseResult = await db.execute(sql`SELECT * FROM addon_purchase WHERE company_id = ${user.companyId} AND addon_id = ${addonId} AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`)
  const purchase = (purchaseResult as any).rows?.[0]
  if (!purchase) return c.json({ error: 'Add-on not found' }, 404)

  if (purchase.stripe_subscription_id) {
    await stripe!.subscriptions.update(purchase.stripe_subscription_id, { cancel_at_period_end: true })
  }

  await db.execute(sql`UPDATE addon_purchase SET cancel_at_period_end = true, updated_at = NOW() WHERE id = ${purchase.id}`)
  return c.json({ success: true, message: 'Add-on will cancel at end of billing period' })
})

// ============================================
// SELF-HOSTED PURCHASE
// ============================================

app.get('/self-hosted/pricing', (c) => {
  const licenses = Object.entries(SELF_HOSTED_PRICING).map(([id, license]: [string, any]) => ({
    id,
    ...license,
    price: license.price / 100,
  }))

  const addons = Object.entries(SELF_HOSTED_ADDONS).map(([id, addon]: [string, any]) => ({
    id,
    ...addon,
    price: addon.price / 100,
  }))

  return c.json({ licenses, addons })
})

app.post('/self-hosted/purchase', async (c) => {
  const { licenseId, addons = [], email, companyName } = await c.req.json()

  const license = SELF_HOSTED_PRICING[licenseId]
  if (!license) return c.json({ error: 'Invalid license' }, 400)

  const lineItems: any[] = [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: `{{COMPANY_NAME}} ${license.name}`,
          description: 'Self-hosted perpetual license',
        },
        unit_amount: license.price,
      },
      quantity: 1,
    },
  ]

  for (const addonId of addons) {
    const addon = SELF_HOSTED_ADDONS[addonId]
    if (addon) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `{{COMPANY_NAME}} ${addon.name}`,
            description: addon.recurring ? 'Recurring service' : 'One-time service',
          },
          unit_amount: addon.price,
          ...(addon.recurring && {
            recurring: { interval: addonId === 'updates' ? 'year' : 'month' },
          }),
        },
        quantity: 1,
      })
    }
  }

  let customer
  const existingCustomers = await stripe!.customers.list({ email, limit: 1 })
  if (existingCustomers.data.length > 0) {
    customer = existingCustomers.data[0]
  } else {
    customer = await stripe!.customers.create({
      email,
      name: companyName,
      metadata: { type: 'self-hosted' },
    })
  }

  const hasRecurring = addons.some((id: string) => SELF_HOSTED_ADDONS[id]?.recurring)

  const session = await stripe!.checkout.sessions.create({
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
  })

  return c.json({ checkoutUrl: session.url, sessionId: session.id })
})

app.get('/self-hosted/success', async (c) => {
  const session_id = c.req.query('session_id')
  if (!session_id) return c.json({ error: 'Session ID required' }, 400)

  const session = await stripe!.checkout.sessions.retrieve(session_id)
  if (session.payment_status !== 'paid') return c.json({ error: 'Payment not completed' }, 400)

  const licenseKey = generateLicenseKey()
  const result = await db.execute(sql`
    INSERT INTO self_hosted_license (email, company_name, license_type, stripe_session_id, stripe_customer_id, purchased_at, license_key)
    VALUES (${session.metadata!.email}, ${session.metadata!.companyName}, ${session.metadata!.licenseId}, ${session.id}, ${session.customer}, NOW(), ${licenseKey})
    RETURNING *
  `)
  const licenseRecord = (result as any).rows?.[0]

  return c.json({
    success: true,
    license: {
      id: licenseRecord.id,
      licenseKey: licenseRecord.license_key,
      licenseType: licenseRecord.license_type,
      downloadUrl: `${process.env.API_URL}/api/billing/self-hosted/download/${licenseRecord.id}`,
    },
  })
})

app.get('/self-hosted/download/:licenseId', async (c) => {
  const licenseId = c.req.param('licenseId')
  const key = c.req.query('key')

  const result = await db.execute(sql`SELECT * FROM self_hosted_license WHERE id = ${licenseId} LIMIT 1`)
  const licenseRecord = (result as any).rows?.[0]

  if (!licenseRecord || licenseRecord.license_key !== key) {
    return c.json({ error: 'Invalid license' }, 403)
  }

  return c.json({
    downloadUrl: 'https://{{COMPANY_DOMAIN}}/download',
    documentation: 'https://{{COMPANY_DOMAIN}}/docs/self-hosted',
    licenseKey: licenseRecord.license_key,
    instructions: [
      '1. Download the release package',
      '2. Extract to your server',
      '3. Run: npm install',
      '4. Configure .env with your license key',
      '5. Run: npm run setup',
      '6. Start with: npm start',
    ],
  })
})

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const segments = 4
  const segmentLength = 5
  const parts = []

  for (let i = 0; i < segments; i++) {
    let segment = ''
    for (let j = 0; j < segmentLength; j++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    parts.push(segment)
  }

  return parts.join('-')
}

app.post('/subscription/change-package', authenticate, async (c) => {
  const user = c.get('user') as any
  const { packageId, immediate } = await c.req.json()
  const result = await billing.changePackage(user.companyId, packageId, { immediate })
  return c.json(result)
})

app.post('/subscription/users', authenticate, async (c) => {
  const user = c.get('user') as any
  const { userCount } = await c.req.json()
  const result = await billing.updateUserCount(user.companyId, userCount)
  return c.json(result)
})

// ============================================
// ONE-TIME PURCHASE
// ============================================

app.post('/purchase', authenticate, async (c) => {
  const user = c.get('user') as any
  const { packageId, features, paymentMethodId } = await c.req.json()
  const result = await billing.processOneTimePurchase(user.companyId, { packageId, features, paymentMethodId })
  return c.json(result, 201)
})

app.post('/purchase/addon', authenticate, async (c) => {
  const user = c.get('user') as any
  const { addonId, quantity, paymentMethodId } = await c.req.json()
  const result = await billing.purchaseAddon(user.companyId, addonId, { quantity, paymentMethodId })
  return c.json(result)
})

// ============================================
// USAGE & INVOICES
// ============================================

app.get('/usage', authenticate, async (c) => {
  const user = c.get('user') as any
  const usage = await billing.getCurrentUsage(user.companyId)
  return c.json(usage)
})

app.get('/invoices', authenticate, async (c) => {
  const user = c.get('user') as any
  const result = await db.execute(sql`SELECT * FROM billing_invoice WHERE company_id = ${user.companyId} ORDER BY created_at DESC`)
  return c.json((result as any).rows || [])
})

app.get('/invoices/:id', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const result = await db.execute(sql`SELECT * FROM billing_invoice WHERE id = ${id} AND company_id = ${user.companyId} LIMIT 1`)
  const inv = (result as any).rows?.[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  return c.json(inv)
})

// ============================================
// PAYMENT METHODS
// ============================================

app.get('/payment-methods', authenticate, async (c) => {
  const user = c.get('user') as any
  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
  if (!comp?.stripeCustomerId) return c.json({ paymentMethods: [] })

  const paymentMethods = await stripe!.paymentMethods.list({
    customer: comp.stripeCustomerId,
    type: 'card',
  })
  return c.json({ paymentMethods: paymentMethods.data })
})

app.post('/payment-methods/setup', authenticate, async (c) => {
  const user = c.get('user') as any
  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)

  let customerId = comp?.stripeCustomerId
  if (!customerId) {
    const customer = await stripe!.customers.create({
      email: comp!.email!,
      name: comp!.name,
      metadata: { companyId: user.companyId },
    })
    customerId = customer.id
    await db.update(company).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(company.id, user.companyId))
  }

  const setupIntent = await stripe!.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
  })

  return c.json({ clientSecret: setupIntent.client_secret })
})

app.delete('/payment-methods/:id', authenticate, async (c) => {
  const id = c.req.param('id')
  await stripe!.paymentMethods.detach(id)
  return c.json({ success: true })
})

// ============================================
// STRIPE WEBHOOK
// ============================================

app.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const rawBody = await c.req.text()

  let event
  try {
    event = stripe!.webhooks.constructEvent(
      rawBody,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return c.text(`Webhook Error: ${err.message}`, 400)
  }

  try {
    await billing.handleStripeWebhook(event)
    return c.json({ received: true })
  } catch (error) {
    console.error('Webhook handler error:', error)
    return c.json({ error: 'Webhook handler failed' }, 500)
  }
})

export default app
