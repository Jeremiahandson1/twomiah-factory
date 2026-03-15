import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { company, contact, user, order } from '../../db/schema.ts'
import { eq, and, count, gte } from 'drizzle-orm'

const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'dashboard',
    'cash_management', 'audit_log', 'documents', 'support',
  ],
  pro: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'dashboard',
    'cash_management', 'audit_log', 'documents', 'support',
    'loyalty', 'team_management', 'sms', 'sms_templates', 'analytics',
    'delivery', 'merch', 'leads', 'marketing',
  ],
  business: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'dashboard',
    'cash_management', 'audit_log', 'documents', 'support',
    'loyalty', 'team_management', 'sms', 'sms_templates', 'analytics',
    'delivery', 'merch', 'leads', 'marketing',
    'scheduled_sms', 'advanced_reporting', 'automations',
    'custom_forms', 'email_templates', 'email_campaigns',
  ],
  enterprise: ['all'],
}

const PLAN_LIMITS: Record<string, Record<string, number | null>> = {
  starter: { users: 2, contacts: 500, orders: 500, storage: 5 },
  pro: { users: 5, contacts: 2500, orders: 5000, storage: 25 },
  business: { users: 15, contacts: 10000, orders: 25000, storage: 100 },
  enterprise: { users: null, contacts: null, orders: null, storage: null },
}

const PLAN_HIERARCHY = ['starter', 'pro', 'business', 'enterprise']
const CORE_FEATURES = ['customers', 'products', 'orders', 'pos', 'inventory', 'dashboard']

async function getCompanySubscription(companyId: string) {
  const [comp] = await db.select({
    id: company.id,
    enabledFeatures: company.enabledFeatures,
    settings: company.settings,
    lifetimeAccess: company.lifetimeAccess,
    subscriptionTier: company.subscriptionTier,
  }).from(company).where(eq(company.id, companyId)).limit(1)

  if (!comp) return null

  const plan = comp.subscriptionTier || (comp.settings as any)?.plan || 'starter'
  const status = comp.lifetimeAccess ? 'active' : ((comp.settings as any)?.subscriptionStatus || 'none')
  const trialEndsAt = (comp.settings as any)?.trialEndsAt

  return {
    companyId: comp.id,
    plan,
    status,
    trialEndsAt,
    enabledFeatures: (comp.enabledFeatures || []) as string[],
    addons: [],
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
      case 'orders':
        const startOfMonth = new Date()
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        const [orderCount] = await db.select({ value: count() }).from(order)
          .where(and(eq(order.companyId, u.companyId), gte(order.createdAt, startOfMonth)))
        currentUsage = orderCount.value
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
