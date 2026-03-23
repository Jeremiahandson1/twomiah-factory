/**
 * {{COMPANY_NAME}} Pricing Configuration — Cannabis Dispensary
 *
 * Subscription tiers for dispensary CRM.
 */

export const SAAS_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Everything you need to open day one',
    description: 'Compliant POS, inventory, cash management, and ID verification — more than most competitors charge $500/mo for',
    price: 29900, // $299/mo
    priceAnnual: 287000, // $2,870/yr (~$239/mo, save 20%)
    interval: 'month',
    users: { included: 5, max: 10, additionalPrice: 2900 },
    features: [
      'customers', 'products', 'orders', 'pos', 'inventory',
      'cash_management', 'team', 'dashboard', 'compliance',
      'audit_log', 'pin_login', 'id_verification', 'purchase_limits',
      'checkin_queue', 'documents', 'support', 'tip_management',
      'equivalency', 'eod_reports', 'receipt_templates',
    ],
    limits: { contacts: 2500, storage: 10, locations: 1 },
    highlight: false,
    cta: 'Start 14-Day Free Trial',
    comparison: 'More features than Cova at $200-500/mo',
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'The complete dispensary platform',
    description: 'Everything in Starter plus Metrc/BioTrack, delivery, loyalty, marketing, analytics, labels, and online ordering — all included, no add-ons',
    price: 49900, // $499/mo
    priceAnnual: 479000, // $4,790/yr (~$399/mo, save 20%)
    interval: 'month',
    users: { included: 15, max: 25, additionalPrice: 2900 },
    features: [
      'customers', 'products', 'orders', 'pos', 'inventory',
      'cash_management', 'team', 'dashboard', 'compliance',
      'audit_log', 'pin_login', 'id_verification', 'purchase_limits',
      'checkin_queue', 'documents', 'support', 'tip_management',
      'equivalency', 'eod_reports', 'receipt_templates',
      // Pro additions
      'loyalty', 'referrals', 'analytics', 'sms', 'email_marketing',
      'customer_portal', 'order_ahead', 'reports', 'labels',
      'metrc', 'biotrack', 'leaf_data', 'license_management',
      'compliance_reporting', 'waste_tracking', 'batches',
      'delivery', 'delivery_tracking', 'driver_app',
      'website_analytics', 'seo_pages', 'menu_sync',
      'scheduling', 'training', 'approvals',
      'qr_scanner', 'offline_mode', 'purchase_orders',
    ],
    limits: { contacts: 10000, storage: 50, locations: 3 },
    highlight: true,
    cta: 'Start 14-Day Free Trial',
    comparison: 'Same price as Dutchie with 3x the features',
  },

  business: {
    id: 'business',
    name: 'Business',
    tagline: 'Scale without limits',
    description: 'Everything in Pro plus multi-location, AI budtender, kiosk, RFID, BI dashboard, predictive inventory, gamified loyalty, fraud detection, and Pay by Bank',
    price: 79900, // $799/mo
    priceAnnual: 767000, // $7,670/yr (~$639/mo, save 20%)
    interval: 'month',
    users: { included: 30, max: 50, additionalPrice: 2900 },
    features: [
      'all_pro_features',
      // Business additions
      'multi_location', 'rfid', 'kiosk', 'ai_budtender', 'ai_recommendations',
      'bi_dashboard', 'custom_reports', 'budtender_performance',
      'predictive_inventory', 'gamified_loyalty', 'digital_signage',
      'curbside', 'pay_by_bank', 'wallet_passes',
      'fraud_detection', 'soc2_controls',
      'merch_store', 'advanced_reporting', 'api_access',
    ],
    limits: { contacts: 50000, storage: 250, locations: 10 },
    highlight: false,
    cta: 'Start 14-Day Free Trial',
    comparison: 'Replaces BLAZE + KayaPush + Alpine IQ — saves $1,000+/mo',
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Seed-to-sale. Multi-state. White-glove.',
    description: 'Everything in Business plus supply chain (cultivation, manufacturing, wholesale), franchise management, Open API, dedicated success manager, and SOC 2 compliance dashboard',
    price: 129900, // $1,299/mo
    priceAnnual: 1247000, // $12,470/yr (~$1,039/mo, save 20%)
    interval: 'month',
    users: { included: 100, max: null, additionalPrice: 1900 },
    features: [
      'all',
      'cultivation', 'manufacturing', 'wholesale', 'lab_testing',
      'multi_store', 'franchise', 'open_api', 'marketplace',
      'ach_payments', 'hardware_catalog',
      'dedicated_success_manager', 'priority_support',
      'soc2_dashboard', 'custom_integrations',
      'consumer_mobile_app', 'white_label',
    ],
    limits: { contacts: null, storage: null, locations: null },
    highlight: false,
    cta: 'Contact Sales',
    comparison: 'Replaces Treez + Canix + Distru — one platform for everything',
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
