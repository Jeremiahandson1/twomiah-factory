/**
 * Feature Gate Middleware
 * 
 * Comprehensive feature gating based on:
 * - Subscription plan tier
 * - Add-on purchases
 * - Usage limits
 * - Trial status
 * 
 * Usage:
 *   router.use('/inventory', requireFeature('inventory'), inventoryRoutes);
 *   router.use(requirePlan('pro')); // Require minimum plan
 *   router.use(checkUsageLimits); // Check usage limits
 */

import { prisma } from '../index.js';

// Plan feature sets (matches pricing.js)
const PLAN_FEATURES = {
  starter: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
  ],
  pro: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'gps_tracking', 'geofencing', 'auto_clock',
    'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing',
  ],
  business: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
  ],
  construction: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
    'projects', 'project_budgets', 'project_phases', 'change_orders', 'rfis', 'submittals',
    'daily_logs', 'punch_lists', 'inspections', 'bids', 'gantt_charts', 'selections',
    'selection_portal', 'takeoffs', 'lien_waivers', 'draw_schedules', 'draw_requests', 'aia_forms',
  ],
  enterprise: ['all'],
};

// Plan limits
const PLAN_LIMITS = {
  starter: { users: 2, contacts: 500, jobs: 100, storage: 5 },
  pro: { users: 5, contacts: 2500, jobs: 500, storage: 25 },
  business: { users: 15, contacts: 10000, jobs: 2000, storage: 100 },
  construction: { users: 20, contacts: 25000, jobs: 5000, storage: 250 },
  enterprise: { users: null, contacts: null, jobs: null, storage: null },
};

// Plan hierarchy for comparison
const PLAN_HIERARCHY = ['starter', 'pro', 'business', 'construction', 'enterprise'];

// Core features always enabled
const CORE_FEATURES = [
  'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'dashboard',
];

/**
 * Get company subscription info with caching
 */
async function getCompanySubscription(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      enabledFeatures: true,
      settings: true,
      subscriptions: {
        where: { status: { in: ['active', 'trialing'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      addonPurchases: {
        where: { 
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      },
    },
  });

  if (!company) return null;

  const subscription = company.subscriptions[0];
  const plan = subscription?.plan || company.settings?.plan || 'starter';
  const status = subscription?.status || company.settings?.subscriptionStatus || 'none';
  const trialEndsAt = subscription?.currentPeriodEnd || company.settings?.trialEndsAt;

  return {
    companyId: company.id,
    plan,
    status,
    trialEndsAt,
    enabledFeatures: company.enabledFeatures || [],
    addons: company.addonPurchases || [],
    limits: PLAN_LIMITS[plan] || PLAN_LIMITS.starter,
  };
}

/**
 * Check if subscription is valid (active or in trial)
 */
function isSubscriptionValid(sub) {
  if (!sub) return false;
  if (sub.status === 'active') return true;
  if (sub.status === 'trialing') {
    const trialEnd = new Date(sub.trialEndsAt);
    return trialEnd > new Date();
  }
  return false;
}

/**
 * Check if a feature is included in a plan
 */
function planHasFeature(plan, featureId) {
  const features = PLAN_FEATURES[plan];
  if (!features) return false;
  if (features.includes('all')) return true;
  return features.includes(featureId);
}

/**
 * Check if company has feature via plan or add-on
 */
function hasFeatureAccess(sub, featureId) {
  if (!sub) return false;
  
  // Core features always available
  if (CORE_FEATURES.includes(featureId)) return true;
  
  // Check plan features
  if (planHasFeature(sub.plan, featureId)) return true;
  
  // Check add-on purchases
  const hasAddon = sub.addons?.some(addon => 
    addon.features?.includes(featureId) || addon.featureId === featureId
  );
  if (hasAddon) return true;
  
  // Check manually enabled features
  if (sub.enabledFeatures?.includes(featureId)) return true;
  
  return false;
}

/**
 * Get minimum plan required for a feature
 */
function getMinPlanForFeature(featureId) {
  for (const plan of PLAN_HIERARCHY) {
    if (planHasFeature(plan, featureId)) {
      return plan;
    }
  }
  return null;
}

/**
 * Middleware: Require a specific feature
 */
export function requireFeature(featureId) {
  return async (req, res, next) => {
    try {
      if (!req.user?.companyId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const sub = await getCompanySubscription(req.user.companyId);
      
      // Check subscription validity
      if (!isSubscriptionValid(sub)) {
        return res.status(402).json({
          error: 'Subscription required',
          code: 'SUBSCRIPTION_REQUIRED',
          message: 'Your subscription has expired. Please renew to continue.',
        });
      }

      // Check feature access
      if (!hasFeatureAccess(sub, featureId)) {
        const minPlan = getMinPlanForFeature(featureId);
        return res.status(403).json({
          error: 'Feature not available',
          code: 'FEATURE_NOT_AVAILABLE',
          feature: featureId,
          currentPlan: sub.plan,
          requiredPlan: minPlan,
          message: `This feature requires the ${minPlan} plan or higher.`,
          upgradeUrl: '/settings/billing',
        });
      }

      // Attach subscription info to request
      req.subscription = sub;
      next();
    } catch (error) {
      console.error('Feature gate error:', error);
      next(error);
    }
  };
}

/**
 * Middleware: Require minimum plan level
 */
export function requirePlan(minPlan) {
  return async (req, res, next) => {
    try {
      if (!req.user?.companyId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const sub = await getCompanySubscription(req.user.companyId);
      
      if (!isSubscriptionValid(sub)) {
        return res.status(402).json({
          error: 'Subscription required',
          code: 'SUBSCRIPTION_REQUIRED',
        });
      }

      const currentPlanIndex = PLAN_HIERARCHY.indexOf(sub.plan);
      const requiredPlanIndex = PLAN_HIERARCHY.indexOf(minPlan);

      if (currentPlanIndex < requiredPlanIndex) {
        return res.status(403).json({
          error: 'Plan upgrade required',
          code: 'PLAN_UPGRADE_REQUIRED',
          currentPlan: sub.plan,
          requiredPlan: minPlan,
          message: `This feature requires the ${minPlan} plan or higher.`,
          upgradeUrl: '/settings/billing',
        });
      }

      req.subscription = sub;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: Check usage limits
 */
export function checkUsageLimits(limitType) {
  return async (req, res, next) => {
    try {
      if (!req.user?.companyId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const sub = await getCompanySubscription(req.user.companyId);
      
      if (!isSubscriptionValid(sub)) {
        return res.status(402).json({ error: 'Subscription required' });
      }

      const limit = sub.limits[limitType];
      
      // No limit (enterprise)
      if (limit === null) {
        req.subscription = sub;
        return next();
      }

      // Get current usage
      let currentUsage = 0;
      switch (limitType) {
        case 'contacts':
          currentUsage = await prisma.contact.count({
            where: { companyId: req.user.companyId },
          });
          break;
        case 'jobs':
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          currentUsage = await prisma.job.count({
            where: {
              companyId: req.user.companyId,
              createdAt: { gte: startOfMonth },
            },
          });
          break;
        case 'users':
          currentUsage = await prisma.user.count({
            where: { companyId: req.user.companyId, isActive: true },
          });
          break;
        default:
          break;
      }

      // Check if at or over limit
      if (currentUsage >= limit) {
        return res.status(403).json({
          error: 'Limit reached',
          code: 'LIMIT_REACHED',
          limitType,
          currentUsage,
          limit,
          message: `You've reached your ${limitType} limit (${limit}). Please upgrade your plan for more.`,
          upgradeUrl: '/settings/billing',
        });
      }

      req.subscription = sub;
      req.usage = { [limitType]: { current: currentUsage, limit } };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware: Check trial status and warn if expiring
 */
export async function checkTrialStatus(req, res, next) {
  try {
    if (!req.user?.companyId) {
      return next();
    }

    const sub = await getCompanySubscription(req.user.companyId);
    
    if (sub?.status === 'trialing' && sub.trialEndsAt) {
      const trialEnd = new Date(sub.trialEndsAt);
      const now = new Date();
      const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      
      // Add warning header if trial ending soon
      if (daysLeft <= 3 && daysLeft > 0) {
        res.set('X-Trial-Warning', `Trial ends in ${daysLeft} days`);
        res.set('X-Trial-Days-Left', daysLeft.toString());
      }
      
      // Trial expired
      if (daysLeft <= 0) {
        return res.status(402).json({
          error: 'Trial expired',
          code: 'TRIAL_EXPIRED',
          message: 'Your free trial has ended. Please subscribe to continue.',
          subscribeUrl: '/settings/billing',
        });
      }
    }

    req.subscription = sub;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware: Attach features to request (for frontend)
 */
export async function attachFeatures(req, res, next) {
  try {
    if (!req.user?.companyId) {
      req.enabledFeatures = CORE_FEATURES;
      return next();
    }

    const sub = await getCompanySubscription(req.user.companyId);
    
    if (!sub || !isSubscriptionValid(sub)) {
      req.enabledFeatures = CORE_FEATURES;
      req.subscription = sub;
      return next();
    }

    // Get all features from plan + addons + manual
    const planFeatures = PLAN_FEATURES[sub.plan] || [];
    const addonFeatures = sub.addons?.flatMap(a => a.features || []) || [];
    const manualFeatures = sub.enabledFeatures || [];

    req.enabledFeatures = [...new Set([
      ...CORE_FEATURES,
      ...(planFeatures.includes('all') ? Object.values(PLAN_FEATURES).flat() : planFeatures),
      ...addonFeatures,
      ...manualFeatures,
    ])];
    
    req.subscription = sub;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Get all enabled features for a company
 */
export async function getCompanyFeatures(companyId) {
  const sub = await getCompanySubscription(companyId);
  
  if (!sub || !isSubscriptionValid(sub)) {
    return CORE_FEATURES;
  }

  const planFeatures = PLAN_FEATURES[sub.plan] || [];
  const addonFeatures = sub.addons?.flatMap(a => a.features || []) || [];
  const manualFeatures = sub.enabledFeatures || [];

  return [...new Set([
    ...CORE_FEATURES,
    ...(planFeatures.includes('all') ? Object.values(PLAN_FEATURES).flat() : planFeatures),
    ...addonFeatures,
    ...manualFeatures,
  ])];
}

/**
 * Check if feature is enabled (utility function)
 */
export async function isFeatureEnabled(companyId, featureId) {
  const sub = await getCompanySubscription(companyId);
  return hasFeatureAccess(sub, featureId);
}

export default {
  requireFeature,
  requirePlan,
  checkUsageLimits,
  checkTrialStatus,
  attachFeatures,
  getCompanyFeatures,
  isFeatureEnabled,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_HIERARCHY,
};
