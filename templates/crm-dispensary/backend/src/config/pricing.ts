/**
 * {{COMPANY_NAME}} Pricing Configuration — Cannabis Dispensary
 *
 * Subscription tiers for dispensary CRM.
 */

export const SAAS_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Essential dispensary POS and inventory',
    price: 9900, // $99/mo
    priceAnnual: 95000,
    interval: 'month',
    users: { included: 3, max: 5, additionalPrice: 1900 },
    features: [
      'customers', 'products', 'orders', 'pos', 'inventory',
      'cash_management', 'team', 'dashboard', 'compliance',
    ],
    limits: { contacts: 1000, storage: 5 },
    highlight: false,
    cta: 'Start Free Trial',
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Loyalty, analytics, and marketing',
    price: 19900, // $199/mo
    priceAnnual: 191000,
    interval: 'month',
    users: { included: 10, max: 15, additionalPrice: 1900 },
    features: [
      'customers', 'products', 'orders', 'pos', 'inventory',
      'cash_management', 'team', 'dashboard', 'compliance',
      'loyalty', 'analytics', 'sms', 'email_marketing',
      'documents', 'customer_portal', 'order_ahead', 'reports',
    ],
    limits: { contacts: 5000, storage: 25 },
    highlight: true,
    cta: 'Start Free Trial',
  },

  business: {
    id: 'business',
    name: 'Business',
    description: 'Delivery, merch, and advanced analytics',
    price: 39900, // $399/mo
    priceAnnual: 383000,
    interval: 'month',
    users: { included: 20, max: 30, additionalPrice: 1900 },
    features: [
      'customers', 'products', 'orders', 'pos', 'inventory',
      'cash_management', 'team', 'dashboard', 'compliance',
      'loyalty', 'analytics', 'sms', 'email_marketing',
      'documents', 'customer_portal', 'order_ahead', 'reports',
      'delivery', 'merch_store', 'advanced_reporting', 'api_access',
    ],
    limits: { contacts: 25000, storage: 100 },
    highlight: false,
    cta: 'Start Free Trial',
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Multi-location, custom integrations',
    price: 79900, // $799/mo
    priceAnnual: 767000,
    interval: 'month',
    users: { included: 50, max: null, additionalPrice: 1900 },
    features: [
      'all',
      'multi_location', 'custom_integrations', 'priority_support',
    ],
    limits: { contacts: null, storage: null },
    highlight: false,
    cta: 'Contact Sales',
  },
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getTier(tierId: string) {
  return (SAAS_TIERS as any)[tierId] || null
}

export function getAllTiers() {
  return Object.values(SAAS_TIERS)
}

export function tierHasFeature(tierId: string, featureId: string) {
  const tier = (SAAS_TIERS as any)[tierId]
  if (!tier) return false
  if (tier.features.includes('all')) return true
  return tier.features.includes(featureId)
}

export function formatPrice(cents: number, options: any = {}) {
  const { showCents = false, interval = null } = options
  const dollars = cents / 100
  let formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(dollars)
  if (interval) formatted += `/${interval}`
  return formatted
}

export default {
  SAAS_TIERS,
  getTier,
  getAllTiers,
  tierHasFeature,
  formatPrice,
}
