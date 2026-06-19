/**
 * {{COMPANY_NAME}} Pricing Configuration
 * 
 * Single source of truth for all pricing:
 * - SaaS subscription tiers
 * - Self-hosted license packages
 * - À la carte feature bundles
 * - Individual sub-features
 */

// ============================================
// SAAS SUBSCRIPTION TIERS
// ============================================

export const SAAS_TIERS = {
  starter: {
    id: 'starter',
    name: 'Sales Starter',
    description: 'Get the sales floor off spreadsheets and personal phones',
    price: 4900, // cents
    priceAnnual: 47000, // cents ($470/yr = ~20% savings)
    interval: 'month',
    users: {
      included: 5,
      max: 5,
      additionalPrice: null, // Can't add users, must upgrade
    },
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    features: [
      'contacts',
      'dashboard',
      'team',
      'unit_inventory',
      'deal_pipeline',
      'lead_inbox',
      'two_way_texting',
      'follow_up_sequences',
      'google_reviews',
      'online_payments',
    ],
    limits: {
      contacts: 2500,
      jobs: 500, // per month
      storage: 25, // GB
      smsCredits: 500,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  sales_pro: {
    id: 'sales_pro',
    name: 'Sales Pro',
    description: 'Full sales + F&I workflow with marketplace syndication',
    price: 14900,
    priceAnnual: 143000, // ~20% savings
    interval: 'month',
    users: {
      included: 15,
      max: 25,
      additionalPrice: 2900, // $29/user/mo
    },
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL,
    features: [
      // Core
      'contacts',
      'dashboard',
      'team',
      // Sales + F&I
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
    limits: {
      contacts: 10000,
      jobs: 2000,
      storage: 100,
      smsCredits: 2000, // per month
    },
    highlight: true, // "Most Popular"
    cta: 'Start Free Trial',
  },

  full: {
    id: 'full',
    name: 'Full Platform',
    description: 'Every feature enabled — sales, service, parts and F&I',
    price: 29900,
    priceAnnual: 287000,
    interval: 'month',
    users: {
      included: 25,
      max: null, // Unlimited
      additionalPrice: 2900,
    },
    stripePriceId: process.env.STRIPE_PRICE_FULL,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_FULL_ANNUAL,
    features: [
      'all', // Everything in the registry
    ],
    limits: {
      contacts: null, // Unlimited
      jobs: null,
      storage: null,
      smsCredits: 5000,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },
};


// ============================================
// SELF-HOSTED LICENSE PACKAGES
// ============================================

export const SELF_HOSTED_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Sales Starter License',
    description: 'Core sales CRM functionality for self-hosting',
    price: 99700, // $997
    features: SAAS_TIERS.starter.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_STARTER,
  },

  sales_pro: {
    id: 'sales_pro',
    name: 'Sales Pro License',
    description: 'Full sales + F&I workflow for self-hosting',
    price: 249700, // $2,497
    features: SAAS_TIERS.sales_pro.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
      'Docker configuration',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_PRO,
  },

  full: {
    id: 'full',
    name: 'Full Platform License',
    description: 'Everything - complete source code',
    price: 499700, // $4,997
    features: ['all'],
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
      'Docker configuration',
      'CI/CD templates',
      '2 hour setup call',
      'White-label ready',
      'Multi-tenant support',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_FULL,
  },
};


// ============================================
// SELF-HOSTED ADD-ONS
// ============================================

export const SELF_HOSTED_ADDONS = {
  installation: {
    id: 'installation',
    name: 'Installation Service',
    description: 'We deploy it for you on your server',
    price: 50000, // $500
    stripePriceId: process.env.STRIPE_PRICE_ADDON_INSTALLATION,
  },
  updates_yearly: {
    id: 'updates_yearly',
    name: 'Update Subscription (1 Year)',
    description: 'Get all new features and bug fixes for 1 year',
    price: 99900, // $999/yr
    interval: 'year',
    stripePriceId: process.env.STRIPE_PRICE_ADDON_UPDATES,
  },
  support_monthly: {
    id: 'support_monthly',
    name: 'Support Contract',
    description: 'Email and phone support',
    price: 19900, // $199/mo
    interval: 'month',
    stripePriceId: process.env.STRIPE_PRICE_ADDON_SUPPORT,
  },
  white_label: {
    id: 'white_label',
    name: 'White-Label Setup',
    description: 'Remove branding, add yours',
    price: 50000, // $500
    stripePriceId: process.env.STRIPE_PRICE_ADDON_WHITELABEL,
  },
  custom_dev: {
    id: 'custom_dev',
    name: 'Custom Development',
    description: 'Custom feature development',
    price: 15000, // $150/hr
    unit: 'hour',
    stripePriceId: process.env.STRIPE_PRICE_ADDON_CUSTOMDEV,
  },
};


// ============================================
// À LA CARTE FEATURE BUNDLES (SaaS)
// ============================================

export const FEATURE_BUNDLES = {
  texting: {
    id: 'texting',
    name: 'Customer Texting',
    description: 'Two-way texting and automated follow-up cadences',
    price: 3900, // $39/mo
    interval: 'month',
    features: ['two_way_texting', 'follow_up_sequences'],
    subFeatures: {
      two_way_texting: { name: 'Two-Way Texting', price: 1900 },
      follow_up_sequences: { name: 'Automated Follow-Up', price: 2500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_TEXTING,
  },

  inventory: {
    id: 'inventory',
    name: 'Inventory & Syndication',
    description: 'Unit inventory, marketplace feeds and recall lookup',
    price: 4900,
    interval: 'month',
    features: ['unit_inventory', 'inventory_syndication', 'recall_lookup'],
    subFeatures: {
      unit_inventory: { name: 'Unit Inventory', price: 2500 },
      inventory_syndication: { name: 'Marketplace Syndication', price: 1900 },
      recall_lookup: { name: 'Recall Lookup', price: 1000 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INVENTORY,
  },

  deal_desk: {
    id: 'deal_desk',
    name: 'Deal Desk & Trade-In',
    description: 'Structure deals, appraise trades and e-sign paperwork',
    price: 5900,
    interval: 'month',
    features: ['deal_desk', 'trade_in', 'esign'],
    subFeatures: {
      deal_desk: { name: 'Deal Desk', price: 2900 },
      trade_in: { name: 'Trade-In Management', price: 1900 },
      esign: { name: 'eSignature', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_DEALDESK,
  },

  service: {
    id: 'service',
    name: 'Service & Parts',
    description: 'Service department, status texts, parts counter and warranty claims',
    price: 7900,
    interval: 'month',
    features: ['service_dept', 'service_status_texts', 'parts_counter', 'warranty_claims'],
    subFeatures: {
      service_dept: { name: 'Service Department', price: 2900 },
      service_status_texts: { name: 'Service Status Updates', price: 1900 },
      parts_counter: { name: 'Parts Counter', price: 1900 },
      warranty_claims: { name: 'Warranty Claims', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_SERVICE,
  },

  marketing: {
    id: 'marketing',
    name: 'Reviews & Reputation',
    description: 'Automated Google review requests after sale or service',
    price: 2900,
    interval: 'month',
    features: ['google_reviews'],
    subFeatures: {
      google_reviews: { name: 'Review Requests', price: 2900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_MARKETING,
  },

  reporting: {
    id: 'reporting',
    name: 'Reporting & Trends',
    description: 'Drill-down sales/service reports and seasonal trend analysis',
    price: 3900,
    interval: 'month',
    features: ['reports', 'seasonal_trends'],
    subFeatures: {
      reports: { name: 'Reports', price: 2500 },
      seasonal_trends: { name: 'Seasonal Trends', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_REPORTING,
  },

  integrations: {
    id: 'integrations',
    name: 'Payments & Integrations',
    description: 'Payment processing, F&I financing and QuickBooks sync',
    price: 4900,
    interval: 'month',
    features: ['online_payments', 'consumer_financing', 'quickbooks'],
    subFeatures: {
      online_payments: { name: 'Payment Processing', price: 1900 },
      consumer_financing: { name: 'F&I / Financing', price: 2500 },
      quickbooks: { name: 'QuickBooks Sync', price: 2900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INTEGRATIONS,
  },
};


// ============================================
// INDUSTRY TEMPLATES
// ============================================

export const INDUSTRY_TEMPLATES = {
  rv_dealer: {
    id: 'rv_dealer',
    name: 'RV Dealership',
    description: 'Motorhome & towable RV sales and service',
    recommendedTier: 'sales_pro',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory', 'inventory_syndication', 'recall_lookup',
      'deal_pipeline', 'lead_inbox', 'deal_desk', 'trade_in', 'esign',
      'two_way_texting', 'follow_up_sequences', 'google_reviews',
      'consumer_financing', 'online_payments', 'quickbooks', 'reports',
    ],
  },
  powersports_dealer: {
    id: 'powersports_dealer',
    name: 'Powersports Dealership',
    description: 'Motorcycle, ATV, UTV & watercraft sales and service',
    recommendedTier: 'sales_pro',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory', 'inventory_syndication', 'recall_lookup',
      'deal_pipeline', 'lead_inbox', 'deal_desk', 'trade_in', 'esign',
      'two_way_texting', 'follow_up_sequences', 'google_reviews',
      'consumer_financing', 'online_payments', 'quickbooks', 'reports',
    ],
  },
  marine_dealer: {
    id: 'marine_dealer',
    name: 'Marine / Boat Dealership',
    description: 'Boat & watercraft sales and service',
    recommendedTier: 'sales_pro',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory', 'inventory_syndication',
      'deal_pipeline', 'lead_inbox', 'deal_desk', 'trade_in', 'esign',
      'two_way_texting', 'follow_up_sequences', 'google_reviews',
      'consumer_financing', 'online_payments', 'quickbooks', 'reports',
    ],
  },
  sales_only: {
    id: 'sales_only',
    name: 'Sales-Only Lot',
    description: 'Independent dealer focused on the sales floor',
    recommendedTier: 'starter',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory', 'deal_pipeline', 'lead_inbox',
      'two_way_texting', 'follow_up_sequences', 'google_reviews', 'online_payments',
    ],
  },
  full_dealership: {
    id: 'full_dealership',
    name: 'Full Dealership',
    description: 'Sales, service, parts and F&I under one roof',
    recommendedTier: 'full',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory', 'inventory_syndication', 'recall_lookup',
      'deal_pipeline', 'lead_inbox', 'deal_desk', 'trade_in', 'esign',
      'service_dept', 'service_status_texts', 'parts_counter', 'warranty_claims',
      'two_way_texting', 'follow_up_sequences', 'google_reviews',
      'consumer_financing', 'online_payments', 'quickbooks',
      'reports', 'seasonal_trends',
    ],
  },
};


// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get tier by ID
 */
export function getTier(tierId) {
  return SAAS_TIERS[tierId] || null;
}

/**
 * Get all tiers as array
 */
export function getAllTiers() {
  return Object.values(SAAS_TIERS);
}

/**
 * Check if a feature is included in a tier
 */
export function tierHasFeature(tierId, featureId) {
  const tier = SAAS_TIERS[tierId];
  if (!tier) return false;
  if (tier.features.includes('all')) return true;
  return tier.features.includes(featureId);
}

/**
 * Get the minimum tier that includes a feature
 */
export function getMinTierForFeature(featureId) {
  const tierOrder = ['starter', 'sales_pro', 'full'];
  for (const tierId of tierOrder) {
    if (tierHasFeature(tierId, featureId)) {
      return tierId;
    }
  }
  return null;
}

/**
 * Calculate price for additional users
 */
export function calculateUserPrice(tierId, userCount) {
  const tier = SAAS_TIERS[tierId];
  if (!tier) return null;

  if (tier.perUser) {
    return tier.price * userCount;
  }

  if (userCount <= tier.users.included) {
    return tier.price;
  }

  const additionalUsers = userCount - tier.users.included;
  return tier.price + (additionalUsers * tier.users.additionalPrice);
}

/**
 * Get bundle price vs individual price
 */
export function getBundleSavings(bundleId) {
  const bundle = FEATURE_BUNDLES[bundleId];
  if (!bundle || !bundle.subFeatures) return null;

  const individualTotal = Object.values(bundle.subFeatures)
    .reduce((sum, f) => sum + f.price, 0);

  return {
    bundlePrice: bundle.price,
    individualPrice: individualTotal,
    savings: individualTotal - bundle.price,
    savingsPercent: Math.round((1 - bundle.price / individualTotal) * 100),
  };
}

/**
 * Format price in cents to display string
 */
export function formatPrice(cents, options = {}) {
  const { showCents = false, interval = null } = options;
  const dollars = cents / 100;

  let formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(dollars);

  if (interval) {
    formatted += `/${interval}`;
  }

  return formatted;
}

/**
 * Get recommended tier for user count
 */
export function getRecommendedTier(userCount) {
  if (userCount <= 5) return 'starter';
  if (userCount <= 25) return 'sales_pro';
  return 'full';
}

/**
 * Check if user should be prompted to upgrade
 */
export function shouldPromptUpgrade(currentTier, addons = [], totalSpend) {
  const tier = SAAS_TIERS[currentTier];
  if (!tier) return null;

  const tierOrder = ['starter', 'sales_pro', 'full'];
  const currentIndex = tierOrder.indexOf(currentTier);
  if (currentIndex >= tierOrder.length - 1) return null;

  const nextTier = SAAS_TIERS[tierOrder[currentIndex + 1]];
  
  // If spending >80% of next tier price with add-ons, suggest upgrade
  if (totalSpend > nextTier.price * 0.8) {
    return {
      suggestedTier: nextTier.id,
      currentSpend: totalSpend,
      tierPrice: nextTier.price,
      savings: totalSpend - nextTier.price,
    };
  }

  return null;
}


export default {
  SAAS_TIERS,
  SELF_HOSTED_PACKAGES,
  SELF_HOSTED_ADDONS,
  FEATURE_BUNDLES,
  INDUSTRY_TEMPLATES,
  getTier,
  getAllTiers,
  tierHasFeature,
  getMinTierForFeature,
  calculateUserPrice,
  getBundleSavings,
  formatPrice,
  getRecommendedTier,
  shouldPromptUpgrade,
};
