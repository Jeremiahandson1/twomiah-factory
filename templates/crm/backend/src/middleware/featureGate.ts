import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { company, subscription, addonPurchase, contact, job, user } from '../../db/schema.ts'
import { eq, and, or, gt, isNull, count, gte } from 'drizzle-orm'
import { PLAN_FEATURES, PLAN_LIMITS } from '../shared/plans.ts'

const PLAN_HIERARCHY = ['starter', 'pro', 'business', 'construction', 'enterprise']
const CORE_FEATURES = ['contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'dashboard']

async function getCompanySubscription(companyId: string) {
  const [comp] = await db.select({
    id: company.id,
    enabledFeatures: company.enabledFeatures,
    settings: company.settings,
  }).from(company).where(eq(company.id, companyId)).limit(1)

  if (!comp) return null

  const [sub] = await db.select().from(subscription)
    .where(eq(subscription.companyId, companyId))
    .limit(1)

  const addons = await db.select().from(addonPurchase)
    .where(and(
      eq(addonPurchase.companyId, companyId),
      or(isNull(addonPurchase.expiresAt), gt(addonPurchase.expiresAt, new Date()))
    ))

  const plan = sub?.packageId || (comp.settings as any)?.plan || 'starter'
  const status = sub?.status || (comp.settings as any)?.subscriptionStatus || 'none'
  const trialEndsAt = sub?.currentPeriodEnd || (comp.settings as any)?.trialEndsAt

  return {
    companyId: comp.id,
    plan,
    status,
    trialEndsAt,
    enabledFeatures: (comp.enabledFeatures || []) as string[],
    addons: addons || [],
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
      case 'jobs':
        const startOfMonth = new Date()
        startOfMonth.setDate(1)
        startOfMonth.setHours(0, 0, 0, 0)
        const [jobCount] = await db.select({ value: count() }).from(job)
          .where(and(eq(job.companyId, u.companyId), gte(job.createdAt, startOfMonth)))
        currentUsage = jobCount.value
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
