import { Hono } from 'hono'
import Stripe from 'stripe'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { company, contact, user, order } from '../../db/schema.ts'
import { eq, and, count, gte } from 'drizzle-orm'

// ============================================
// Billing module for crm-dispensary Settings→Billing page.
//
// The frontend (frontend/src/pages/settings/BillingSettingsPage.tsx) calls
// /api/billing/* — these endpoints did not exist, so the whole page 404'd.
//
// Design goals:
//  - NEVER 500. When Stripe is not configured (STRIPE_SECRET_KEY unset — the
//    test tenant) every endpoint still returns a usable shape from the DB.
//  - All plan/cancel/status state lives on company.settings (json) — the same
//    place featureGate.ts already reads it (settings.plan / subscriptionStatus /
//    trialEndsAt). We keep company.subscriptionTier in sync too so the whole app
//    reflects a plan change, but never touch schema.ts.
//  - Add-ons are gated the same way the rest of the app gates features:
//    company.enabledFeatures (a string[] of feature ids).
// ============================================

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })
  : null

// Mirrors the public PricingPage / BillingSettingsPage PLANS map. The page reads
// name/price/users from its own local copy; we only need plan/status/period here,
// but return name+price for completeness.
// Per-seat overage model (source of truth = Factory pricing DB for crm-dispensary):
//   base price includes `included` seats; each additional seat up to `max` costs
//   +`additionalPrice`/mo; you cannot exceed `max` (must upgrade). Enterprise is
//   flat/unlimited (max null, no overage).
const PLANS: Record<string, { id: string; name: string; price: number; annualPrice: number; users: { included: number; max: number | null; additionalPrice: number } }> = {
  starter: { id: 'starter', name: 'Starter', price: 299, annualPrice: 239, users: { included: 5, max: 10, additionalPrice: 29 } },
  pro: { id: 'pro', name: 'Pro', price: 499, annualPrice: 399, users: { included: 15, max: 25, additionalPrice: 29 } },
  business: { id: 'business', name: 'Business', price: 799, annualPrice: 639, users: { included: 30, max: 50, additionalPrice: 29 } },
  enterprise: { id: 'enterprise', name: 'Enterprise', price: 1299, annualPrice: 1039, users: { included: 100, max: null, additionalPrice: 0 } },
}
const PLAN_ORDER = ['starter', 'pro', 'business', 'enterprise']

// Usage limits per plan (mirrors featureGate.ts PLAN_LIMITS; null = unlimited).
// users here is the HARD cap (the plan MAX) — overage seats live between included
// and max; contacts/orders unchanged.
const PLAN_LIMITS: Record<string, { users: number | null; contacts: number | null; orders: number | null }> = {
  starter: { users: 10, contacts: 500, orders: 500 },
  pro: { users: 25, contacts: 2500, orders: 5000 },
  business: { users: 50, contacts: 10000, orders: 25000 },
  enterprise: { users: null, contacts: null, orders: null },
}

// Add-on catalog. `featureKey` is the id stored in company.enabledFeatures that
// activates the add-on — the same gating mechanism used everywhere else.
const ADDON_CATALOG: Array<{ id: string; name: string; price: number; featureKey: string; features: string[] }> = [
  { id: 'loyalty', name: 'Loyalty & Rewards', price: 49, featureKey: 'loyalty', features: ['Points program', 'Rewards catalog', 'Tiered members'] },
  { id: 'delivery', name: 'Delivery Management', price: 79, featureKey: 'delivery', features: ['Driver dispatch', 'Delivery zones', 'Live tracking'] },
  { id: 'analytics', name: 'Advanced Analytics', price: 59, featureKey: 'analytics', features: ['Sales reports', 'Product trends', 'Custom dashboards'] },
  { id: 'marketing', name: 'Marketing Suite', price: 69, featureKey: 'marketing', features: ['Email campaigns', 'SMS blasts', 'Automations'] },
  { id: 'extra_sms', name: 'Extra SMS Credits', price: 25, featureKey: 'extra_sms', features: ['+1,000 SMS / month', 'At-cost overage'] },
]

const app = new Hono()

// Billing is owner/admin-only — reads AND writes. A 'user'-role staff account could read
// invoices/payment methods and flip the subscription plan because this router only
// authenticated; the rest of the settings surface is role-gated. (QA F-05)
app.use('*', authenticate, requireAdmin)

// ---- helpers ---------------------------------------------------------------

async function getCompanyRow(companyId: string) {
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  return comp || null
}

function resolvePlan(comp: any): string {
  const settings = (comp?.settings as any) || {}
  const raw = comp?.subscriptionTier || settings.plan || 'starter'
  return PLANS[raw] ? raw : 'starter'
}

// Build the exact shape BillingSettingsPage reads off subData.subscription:
//   plan, status, cancelAtPeriodEnd, currentPeriodEnd (+ name/price for extra).
// Also surfaces the per-seat overage model: basePrice, includedSeats,
// additionalSeatPrice, extraSeats (active users beyond included, capped at max),
// and effectiveMonthly (base + overage). Enterprise (max null) is flat/unlimited.
function buildSubscriptionShape(comp: any, activeUsers = 0) {
  const settings = (comp?.settings as any) || {}
  const plan = resolvePlan(comp)
  const status = settings.subscriptionStatus || (comp?.lifetimeAccess ? 'active' : 'active')
  const seat = PLANS[plan].users
  const basePrice = PLANS[plan].price
  const included = seat.included
  const additionalPrice = seat.additionalPrice
  // Enterprise (max null) never bills overage. Otherwise cap extras at max so we
  // never imply a bill for seats the plan cannot hold.
  const extraSeats = seat.max === null ? 0 : Math.max(0, Math.min(activeUsers, seat.max) - included)
  const effectiveMonthly = basePrice + extraSeats * additionalPrice
  return {
    plan,
    name: PLANS[plan].name,
    price: basePrice,
    status,
    cancelAtPeriodEnd: !!settings.cancelAtPeriodEnd,
    currentPeriodEnd: settings.currentPeriodEnd || null,
    basePrice,
    includedSeats: included,
    additionalSeatPrice: additionalPrice,
    extraSeats,
    effectiveMonthly,
  }
}

// Merge a partial patch into company.settings (json) and persist.
async function patchSettings(comp: any, patch: Record<string, any>) {
  const settings = { ...((comp?.settings as any) || {}), ...patch }
  await db.update(company).set({ settings, updatedAt: new Date() }).where(eq(company.id, comp.id))
  return { ...comp, settings }
}

// ---- GET /subscription -----------------------------------------------------
// Satisfies: subscription.plan, .status, .cancelAtPeriodEnd, .currentPeriodEnd
app.get('/subscription', async (c) => {
  const u = c.get('user') as any
  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ subscription: buildSubscriptionShape(null) })
    // Count active seats the same way /usage does, so effectiveMonthly reflects
    // real seat usage (base + overage).
    const [activeUsers] = await db.select({ value: count() }).from(user)
      .where(and(eq(user.companyId, u.companyId), eq(user.isActive, true)))
    return c.json({ subscription: buildSubscriptionShape(comp, activeUsers?.value || 0) })
  } catch {
    // Never 500 — fall back to a default active starter subscription.
    return c.json({ subscription: { plan: 'starter', name: 'Starter', price: 299, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null, basePrice: 299, includedSeats: 5, additionalSeatPrice: 29, extraSeats: 0, effectiveMonthly: 299 } })
  }
})

// ---- GET /pricing ----------------------------------------------------------
// Public plan catalog for frontend/src/pages/billing/PricingPage.tsx, which reads
// pricing.packages[id].{name,monthlyPrice,yearlyPrice,usersIncluded}. We do NOT
// attach a per-package `features` array — the page's comparison table falls back
// to its own tier matrix (packages[pkg]?.features?.includes(...) ?? tierFeatures),
// and returning [] would make every feature read as excluded.
app.get('/pricing', (c) => {
  const packages: Record<string, any> = {}
  for (const id of PLAN_ORDER) {
    const p = PLANS[id]
    packages[id] = {
      id: p.id,
      name: p.name,
      price: p.price,
      monthlyPrice: p.price,
      yearlyPrice: p.annualPrice * 12, // annual per-month rate × 12
      users: p.users.included,
      usersIncluded: p.users.included,
      usersMax: p.users.max,
      additionalSeatPrice: p.users.additionalPrice,
    }
  }
  return c.json({ packages, features: {} })
})

// ---- GET /usage ------------------------------------------------------------
// Satisfies: usage.users.{current,limit}, usage.contacts.{...}, usage.orders.{...}
app.get('/usage', async (c) => {
  const u = c.get('user') as any
  try {
    const comp = await getCompanyRow(u.companyId)
    const plan = resolvePlan(comp)
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter

    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const [[users], [contacts], [orders]] = await Promise.all([
      db.select({ value: count() }).from(user).where(and(eq(user.companyId, u.companyId), eq(user.isActive, true))),
      db.select({ value: count() }).from(contact).where(eq(contact.companyId, u.companyId)),
      db.select({ value: count() }).from(order).where(and(eq(order.companyId, u.companyId), gte(order.createdAt, startOfMonth))),
    ])

    const seat = (PLANS[plan] || PLANS.starter).users
    const currentUsers = users?.value || 0
    const billableExtra = Math.max(0, currentUsers - seat.included)
    return c.json({
      // Per-seat overage model: base includes `included` seats; extra seats up to
      // `max` bill at `additionalPrice` each. `limit` = max (null = unlimited).
      users: {
        current: currentUsers,
        included: seat.included,
        max: seat.max,
        additionalPrice: seat.additionalPrice,
        limit: seat.max ?? null,
        billableExtra,
        extraCost: billableExtra * seat.additionalPrice,
      },
      contacts: { current: contacts?.value || 0, limit: limits.contacts },
      orders: { current: orders?.value || 0, limit: limits.orders },
    })
  } catch {
    return c.json({
      users: { current: 0, limit: null },
      contacts: { current: 0, limit: null },
      orders: { current: 0, limit: null },
    })
  }
})

// ---- GET /invoices ---------------------------------------------------------
// Frontend expects an ARRAY of { id, number, total, status, createdAt }.
app.get('/invoices', async (c) => {
  const u = c.get('user') as any
  try {
    if (!stripe) return c.json([])
    const comp = await getCompanyRow(u.companyId)
    const customerId = (comp as any)?.stripeCustomerId
    if (!customerId) return c.json([])
    const list = await stripe.invoices.list({ customer: customerId, limit: 20 })
    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number || inv.id,
      total: (inv.total || 0) / 100,
      status: inv.status || 'open',
      createdAt: new Date((inv.created || 0) * 1000).toISOString(),
    }))
    return c.json(invoices)
  } catch {
    return c.json([])
  }
})

// ---- GET /payment-methods --------------------------------------------------
// Frontend expects { paymentMethods: [{ id, card:{ last4, exp_month, exp_year } }] }
app.get('/payment-methods', async (c) => {
  const u = c.get('user') as any
  try {
    if (!stripe) return c.json({ paymentMethods: [] })
    const comp = await getCompanyRow(u.companyId)
    const customerId = (comp as any)?.stripeCustomerId
    if (!customerId) return c.json({ paymentMethods: [] })
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
    const paymentMethods = list.data.map((pm) => ({
      id: pm.id,
      card: {
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '••••',
        exp_month: pm.card?.exp_month || null,
        exp_year: pm.card?.exp_year || null,
      },
    }))
    return c.json({ paymentMethods })
  } catch {
    return c.json({ paymentMethods: [] })
  }
})

// ---- GET /addons -----------------------------------------------------------
// Frontend expects { addons: [{ id, name, price, features:[], purchased:bool }] }
app.get('/addons', async (c) => {
  const u = c.get('user') as any
  try {
    const comp = await getCompanyRow(u.companyId)
    const enabled = ((comp?.enabledFeatures as any) || []) as string[]
    const addons = ADDON_CATALOG.map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
      features: a.features,
      purchased: enabled.includes(a.featureKey),
    }))
    return c.json({ addons })
  } catch {
    return c.json({ addons: ADDON_CATALOG.map((a) => ({ id: a.id, name: a.name, price: a.price, features: a.features, purchased: false })) })
  }
})

// ---- POST /subscription/change-plan ----------------------------------------
// Body: { plan }. Persists plan on company row (subscriptionTier + settings.plan).
// Returns { subscription, message } (frontend reads data.message / data.checkoutUrl).
app.post('/subscription/change-plan', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as { plan?: string }
  const plan = String(body.plan || '').trim()
  if (!plan) return c.json({ error: 'plan is required' }, 400)
  if (!PLANS[plan]) return c.json({ error: `Invalid plan: ${plan}` }, 400)

  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    // Downgrade guard: never move to a plan whose seat cap is below the current active
    // users — that would strand seats the customer is already using. Fires regardless of
    // Stripe (real, always-on rule), unlike the payment guard below. (retest#14)
    const target = PLANS[plan]
    if (target?.users?.max != null) {
      const [au] = await db.select({ value: count() }).from(user)
        .where(and(eq(user.companyId, u.companyId), eq(user.isActive, true)))
      const active = Number(au?.value || 0)
      if (active > (target.users.max as number)) {
        return c.json({ error: `Cannot switch to ${target.name}: you have ${active} active users, above its ${target.users.max}-seat limit. Remove users or choose a higher plan.` }, 402)
      }
    }

    // Upgrade guard: moving to a HIGHER-priced plan requires a payment method on file — a
    // customer can't take on a bigger recurring bill with no card. Fires REGARDLESS of Stripe
    // config: with billing unconfigured there are no cards, so upgrades are held. Downgrades
    // and lateral (same-price) moves are always allowed. (retest#15)
    const curPlanKey = String((comp as any).subscriptionTier || (comp.settings as any)?.plan || 'starter').toLowerCase()
    const isUpgrade = (PLANS[plan]?.price || 0) > (PLANS[curPlanKey]?.price || 0)
    if (isUpgrade) {
      let hasPaymentMethod = false
      const customerId = (comp as any)?.stripeCustomerId as string | null
      if (stripe && customerId) {
        try {
          const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
          hasPaymentMethod = (pms.data?.length || 0) > 0
        } catch { hasPaymentMethod = false }
      }
      if (!hasPaymentMethod) {
        return c.json({ error: 'Add a payment method before upgrading to a higher plan.' }, 402)
      }
    }

    // If Stripe is configured and this company already has a live subscription,
    // best-effort update it. Never let a Stripe hiccup 500 the request — we still
    // persist the plan locally below.
    const settings = (comp.settings as any) || {}
    if (stripe && settings.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(settings.stripeSubscriptionId, {
          metadata: { plan },
        })
      } catch { /* fall through to local persist */ }
    }

    // Persist plan everywhere the app reads it: subscriptionTier + settings.plan.
    // Clearing cancelAtPeriodEnd on an explicit plan change is the expected UX.
    const updatedSettings = { ...settings, plan, cancelAtPeriodEnd: false, subscriptionStatus: settings.subscriptionStatus || 'active' }
    await db.update(company).set({ subscriptionTier: plan, settings: updatedSettings, updatedAt: new Date() }).where(eq(company.id, comp.id))

    const fresh = await getCompanyRow(u.companyId)
    return c.json({ subscription: buildSubscriptionShape(fresh), message: 'Plan updated successfully' })
  } catch {
    return c.json({ error: 'Could not change plan' }, 400)
  }
})

// ---- POST /addons/purchase -------------------------------------------------
// Body: { addonId }. Activates the add-on by adding its featureKey to
// company.enabledFeatures — the same gate the rest of the app uses.
app.post('/addons/purchase', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as { addonId?: string }
  const addonId = String(body.addonId || '').trim()
  if (!addonId) return c.json({ error: 'addonId is required' }, 400)
  const addon = ADDON_CATALOG.find((a) => a.id === addonId)
  if (!addon) return c.json({ error: `Unknown addon: ${addonId}` }, 400)

  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    const enabled = ((comp.enabledFeatures as any) || []) as string[]
    if (!enabled.includes(addon.featureKey)) {
      const next = [...new Set([...enabled, addon.featureKey])]
      await db.update(company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(company.id, comp.id))
    }
    return c.json({ success: true, message: `${addon.name} activated`, addonId: addon.id })
  } catch {
    return c.json({ error: 'Could not activate add-on' }, 400)
  }
})

// ---- POST /addons/remove ---------------------------------------------------
// Body: { addonId }. Deactivates the add-on by removing its featureKey from
// company.enabledFeatures — the mirror of /addons/purchase.
app.post('/addons/remove', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as { addonId?: string }
  const addonId = String(body.addonId || '').trim()
  if (!addonId) return c.json({ error: 'addonId is required' }, 400)
  const addon = ADDON_CATALOG.find((a) => a.id === addonId)
  if (!addon) return c.json({ error: `Unknown addon: ${addonId}` }, 400)

  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    const enabled = ((comp.enabledFeatures as any) || []) as string[]
    if (enabled.includes(addon.featureKey)) {
      const next = enabled.filter((f) => f !== addon.featureKey)
      await db.update(company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(company.id, comp.id))
    }
    return c.json({ success: true, message: `${addon.name} removed`, addonId: addon.id })
  } catch {
    return c.json({ error: 'Could not remove add-on' }, 400)
  }
})

// ---- POST /subscription/cancel ---------------------------------------------
// Body: { immediate }. Records cancel state on company.settings. Never 500.
app.post('/subscription/cancel', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json().catch(() => ({})) as { immediate?: boolean }
  const immediate = !!body.immediate

  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    const settings = (comp.settings as any) || {}
    // Best-effort Stripe cancel if configured + live subscription present.
    if (stripe && settings.stripeSubscriptionId) {
      try {
        if (immediate) await stripe.subscriptions.cancel(settings.stripeSubscriptionId)
        else await stripe.subscriptions.update(settings.stripeSubscriptionId, { cancel_at_period_end: true })
      } catch { /* fall through */ }
    }

    // Give the UI a period-end date to display if none is stored yet.
    const periodEnd = settings.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const patch = immediate
      ? { subscriptionStatus: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd }
      : { cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd }

    const updated = await patchSettings(comp, patch)
    return c.json({ subscription: buildSubscriptionShape(updated) })
  } catch {
    return c.json({ subscription: buildSubscriptionShape(null) })
  }
})

// ---- POST /subscription/reactivate -----------------------------------------
app.post('/subscription/reactivate', async (c) => {
  const u = c.get('user') as any
  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    const settings = (comp.settings as any) || {}
    if (stripe && settings.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(settings.stripeSubscriptionId, { cancel_at_period_end: false })
      } catch { /* fall through */ }
    }

    const updated = await patchSettings(comp, { cancelAtPeriodEnd: false, subscriptionStatus: 'active' })
    return c.json({ subscription: buildSubscriptionShape(updated) })
  } catch {
    return c.json({ subscription: buildSubscriptionShape(null) })
  }
})

// ---- POST /payment-methods/setup -------------------------------------------
// Stripe configured → SetupIntent client_secret. Else 400 with a clear message.
app.post('/payment-methods/setup', async (c) => {
  const u = c.get('user') as any
  if (!stripe) return c.json({ error: 'Payment setup requires billing configuration' }, 400)
  try {
    const comp = await getCompanyRow(u.companyId)
    if (!comp) return c.json({ error: 'Company not found' }, 404)

    let customerId = (comp as any).stripeCustomerId as string | null
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: comp.name,
        email: comp.email || undefined,
        metadata: { company_id: comp.id },
      })
      customerId = customer.id
      await db.update(company).set({ stripeCustomerId: customerId, updatedAt: new Date() }).where(eq(company.id, comp.id))
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    })
    return c.json({ clientSecret: setupIntent.client_secret })
  } catch (err: any) {
    return c.json({ error: err?.message || 'Could not start payment setup' }, 400)
  }
})

export default app
