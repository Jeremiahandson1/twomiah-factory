import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { company, contact, unit, user } from '../../db/schema.ts'
import { eq, and, count } from 'drizzle-orm'

// RV + Powersports dealership feature tiers (mirrors FEATURE_PACKAGES in
// config/featureRegistry.ts). Core features are always available and are not
// listed in plans — see CORE_FEATURES below.
const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    // Sales Starter — get the sales floor off spreadsheets
    'unit_inventory',
    'deal_pipeline',
    'lead_inbox',
    'two_way_texting',
    'follow_up_sequences',
    'google_reviews',
    'online_payments',
  ],
  sales_pro: [
    // Sales Pro — full sales + F&I workflow with syndication
    'unit_inventory',
    'inventory_syndication',
    'recall_lookup',
    'deal_pipeline',
    'lead_inbox',
    'deal_desk',
    'trade_in',
    'esign',
    'two_way_texting',
    'follow_up_sequences',
    'google_reviews',
    'consumer_financing',
    'online_payments',
    'quickbooks',
    'reports',
  ],
  full: ['all'],
}

const PLAN_LIMITS: Record<string, Record<string, number | null>> = {
  starter: { users: 5, contacts: 2500, units: 500, storage: 25 },
  sales_pro: { users: 15, contacts: 10000, units: 2000, storage: 100 },
  full: { users: null, contacts: null, units: null, storage: null },
}

const PLAN_HIERARCHY = ['starter', 'sales_pro', 'full']
const CORE_FEATURES = ['contacts', 'dashboard', 'team']

// Subscription/billing state is derived from the company record. There is no
// separate `subscription` or `addonPurchase` table in this template; the plan,
// status, trial end, and manually-enabled features all live on `company`
// (subscriptionTier column + the `settings` / `enabledFeatures` JSON blobs).
async function getCompanySubscription(companyId: string) {
  const [comp] = await db.select({
    id: company.id,
    subscriptionTier: company.subscriptionTier,
    lifetimeAccess: company.lifetimeAccess,
    enabledFeatures: company.enabledFeatures,
    settings: company.settings,
  }).from(company).where(eq(company.id, companyId)).limit(1)

  if (!comp) return null

  const settings = (comp.settings as any) || {}
  const plan = comp.subscriptionTier || settings.plan || 'starter'
  // Lifetime-access companies are always treated as active.
  const status = comp.lifetimeAccess ? 'active' : (settings.subscriptionStatus || 'active')
  const trialEndsAt = settings.trialEndsAt

  return {
    companyId: comp.id,
    plan,
    status,
    trialEndsAt,
    enabledFeatures: (comp.enabledFeatures || []) as string[],
    limits: PLAN_LIMITS[plan] || PLAN_LIMITS.starter,
  }
}

function isSubscriptionValid(sub: any): boolean {
  if (!sub) return false
  if (sub.status === 'active') return true
  if (sub.status === 'trialing') {
    const trialEnd = new Date(sub.trialEndsAt)
    return trialEnd > new Date()
  }
  return false
}

function planHasFeature(plan: string, featureId: string): boolean {
  const features = PLAN_FEATURES[plan]
  if (!features) return false
  if (features.includes('all')) return true
  return features.includes(featureId)
}

function hasFeatureAccess(sub: any, featureId: string): boolean {
  if (!sub) return false
  if (CORE_FEATURES.includes(featureId)) return true
  if (planHasFeature(sub.plan, featureId)) return true
  if (sub.enabledFeatures?.includes(featureId)) return true
  return false
}

function getMinPlanForFeature(featureId: string): string | null {
  for (const plan of PLAN_HIERARCHY) {
    if (planHasFeature(plan, featureId)) return plan
  }
  return null
}

export function requireFeature(featureId: string) {
  return async (c: Context, next: Next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)

    const sub = await getCompanySubscription(u.companyId)
    if (!isSubscriptionValid(sub)) {
      return c.json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' }, 402)
    }
    if (!hasFeatureAccess(sub, featureId)) {
      const minPlan = getMinPlanForFeature(featureId)
      return c.json({
        error: 'Feature not available',
        code: 'FEATURE_NOT_AVAILABLE',
        feature: featureId,
        currentPlan: sub!.plan,
        requiredPlan: minPlan,
        message: `This feature requires the ${minPlan} plan or higher.`,
        upgradeUrl: '/settings/billing',
      }, 403)
    }
    c.set('subscription', sub)
    await next()
  }
}

export function requirePlan(minPlan: string) {
  return async (c: Context, next: Next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)

    const sub = await getCompanySubscription(u.companyId)
    if (!isSubscriptionValid(sub)) {
      return c.json({ error: 'Subscription required', code: 'SUBSCRIPTION_REQUIRED' }, 402)
    }
    const currentIdx = PLAN_HIERARCHY.indexOf(sub!.plan)
    const requiredIdx = PLAN_HIERARCHY.indexOf(minPlan)
    if (currentIdx < requiredIdx) {
      return c.json({
        error: 'Plan upgrade required',
        code: 'PLAN_UPGRADE_REQUIRED',
        currentPlan: sub!.plan,
        requiredPlan: minPlan,
        upgradeUrl: '/settings/billing',
      }, 403)
    }
    c.set('subscription', sub)
    await next()
  }
}

export function checkUsageLimits(limitType: string) {
  return async (c: Context, next: Next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)

    const sub = await getCompanySubscription(u.companyId)
    if (!isSubscriptionValid(sub)) {
      return c.json({ error: 'Subscription required' }, 402)
    }

    const limit = sub!.limits[limitType]
    if (limit === null) {
      c.set('subscription', sub)
      return next()
    }

    let currentUsage = 0
    switch (limitType) {
      case 'contacts':
        const [contactCount] = await db.select({ value: count() }).from(contact)
          .where(eq(contact.companyId, u.companyId))
        currentUsage = contactCount.value
        break
      case 'units':
        const [unitCount] = await db.select({ value: count() }).from(unit)
          .where(eq(unit.companyId, u.companyId))
        currentUsage = unitCount.value
        break
      case 'users':
        const [userCount] = await db.select({ value: count() }).from(user)
          .where(and(eq(user.companyId, u.companyId), eq(user.isActive, true)))
        currentUsage = userCount.value
        break
    }

    if (currentUsage >= limit) {
      return c.json({
        error: 'Limit reached',
        code: 'LIMIT_REACHED',
        limitType,
        currentUsage,
        limit,
        message: `You've reached your ${limitType} limit (${limit}). Please upgrade your plan for more.`,
        upgradeUrl: '/settings/billing',
      }, 403)
    }

    c.set('subscription', sub)
    await next()
  }
}

export async function getCompanyFeatures(companyId: string): Promise<string[]> {
  const sub = await getCompanySubscription(companyId)
  if (!sub || !isSubscriptionValid(sub)) return CORE_FEATURES

  const planFeatures = PLAN_FEATURES[sub.plan] || []
  const manualFeatures = sub.enabledFeatures || []

  return [...new Set([
    ...CORE_FEATURES,
    ...(planFeatures.includes('all') ? Object.values(PLAN_FEATURES).flat() : planFeatures),
    ...manualFeatures,
  ])]
}

export async function isFeatureEnabled(companyId: string, featureId: string): Promise<boolean> {
  const sub = await getCompanySubscription(companyId)
  return hasFeatureAccess(sub, featureId)
}

export { PLAN_FEATURES, PLAN_LIMITS, PLAN_HIERARCHY }
