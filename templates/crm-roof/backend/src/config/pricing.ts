/**
 * {{COMPANY_NAME}} Pricing Configuration — Roofing (Roof)
 *
 * Single source of truth for all pricing:
 * - Website subscription tiers (standalone)
 * - SaaS CRM subscription tiers (with bundled websites at Pro+)
 * - Self-hosted license packages
 * - À la carte feature bundles
 *
 * Roof-specific tier naming:
 * - Top tier is "Storm" (built for storm chasers — unlimited reports, canvassing,
 *   full insurance workflow with supplements) not "Construction"
 *
 * Pricing philosophy:
 * - Annual = exactly 2 months free (monthly × 10)
 * - Pro+ tiers include a matching website tier at no extra cost
 * - Business tier includes the instant estimator ON the website — the killer
 *   roofing feature that turns web visitors into booked inspections
 */

// ============================================
// WEBSITE SUBSCRIPTION TIERS (standalone)
// ============================================
// Outcome-named tiers for customers who want just a website and CMS.
// Each CRM tier above Starter bundles one of these automatically.

export const WEBSITE_TIERS = {
  presence: {
    id: 'presence',
    name: 'Presence',
    tagline: 'Get found online',
    description: 'One-page lead capture site with CMS — your phone number, services, and a form, online and professional.',
    price: 1900, // $19/mo
    priceAnnual: 19000, // $190/yr (2 months free)
    interval: 'month',
    features: [
      'one_page_site',
      'cms',
      'lead_form',
      'custom_domain_byo',
      'mobile_responsive',
      'ssl',
    ],
    stripePriceId: process.env.STRIPE_PRICE_WEBSITE_PRESENCE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_WEBSITE_PRESENCE_ANNUAL,
    highlight: false,
    cta: 'Start Free Trial',
  },

  showcase: {
    id: 'showcase',
    name: 'Showcase',
    tagline: 'Show off your work',
    description: 'Full multi-page website with CMS, blog, and SEO basics — the kind of site contractors pay freelancers $2,000 for.',
    price: 4900, // $49/mo
    priceAnnual: 49000, // $490/yr
    interval: 'month',
    features: [
      'multi_page_site',
      'cms',
      'blog',
      'seo_basics',
      'photo_galleries',
      'contact_forms',
      'google_maps',
      'reviews_widget',
      'custom_domain_byo',
      'mobile_responsive',
      'ssl',
    ],
    stripePriceId: process.env.STRIPE_PRICE_WEBSITE_SHOWCASE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_WEBSITE_SHOWCASE_ANNUAL,
    highlight: true, // Most popular website tier
    cta: 'Start Free Trial',
  },

  book_jobs: {
    id: 'book_jobs',
    name: 'Book Jobs',
    tagline: 'Turn visitors into booked jobs',
    description: 'Full site with online booking, quote requests, and service area pages — remove the phone tag that costs you jobs.',
    price: 9900, // $99/mo
    priceAnnual: 99000, // $990/yr
    interval: 'month',
    features: [
      'multi_page_site',
      'cms',
      'blog',
      'seo_basics',
      'photo_galleries',
      'online_booking',
      'quote_requests',
      'service_area_pages',
      'google_analytics',
      'custom_domain_byo',
      'mobile_responsive',
      'ssl',
    ],
    stripePriceId: process.env.STRIPE_PRICE_WEBSITE_BOOK_JOBS,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_WEBSITE_BOOK_JOBS_ANNUAL,
    highlight: false,
    cta: 'Start Free Trial',
  },
};


// ============================================
// SAAS SUBSCRIPTION TIERS
// ============================================
// Annual pricing = monthly × 10 (exactly 2 months free).
// Pro+ tiers include a bundled website tier automatically.

export const SAAS_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Leads, jobs, quotes, and invoicing',
    tagline: 'CRM only — pair with any website tier',
    price: 4900,
    priceAnnual: 49000,
    interval: 'month',
    bundledWebsite: null,
    heroFeatures: [
      'Lead intake',
      'Job tracking',
      'Quotes & invoices',
      'Payments',
      'Customer portal',
    ],
    users: {
      included: 2,
      max: 2,
      additionalPrice: null, // Can't add users, must upgrade
    },
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    features: [
      'contacts',
      'leads',
      'jobs',
      'quotes',
      'invoices',
      'payments',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
    ],
    limits: {
      contacts: 500,
      jobs: 100, // per month
      storage: 5, // GB
      smsCredits: 0,
      measurementCredits: 0,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Good-Better-Best pricing + website',
    tagline: 'CRM + Showcase website',
    price: 14900,
    priceAnnual: 149000,
    interval: 'month',
    bundledWebsite: 'showcase',
    heroFeatures: [
      'Good-Better-Best pricing',
      'Pricebook',
      'Measurement reports (3/mo)',
      'Review requests',
      'Showcase website included',
    ],
    users: {
      included: 5,
      max: 10,
      additionalPrice: 2900, // $29/user/mo
    },
    stripePriceId: process.env.STRIPE_PRICE_PRO,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL,
    features: [
      // All Starter features
      'contacts',
      'leads',
      'jobs',
      'quotes',
      'invoices',
      'payments',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      // Pro additions
      'good_better_best_pricing',
      'pricebook',
      'measurement_reports',
      'review_requests',
      'sms',
      'sms_templates',
      'quickbooks_sync',
      'photos',
      'before_after_galleries',
      'team_management',
    ],
    limits: {
      contacts: 2500,
      jobs: 500,
      storage: 25,
      smsCredits: 500, // per month
      measurementCredits: 3, // 3 reports/month
    },
    highlight: true, // "Most Popular"
    cta: 'Start Free Trial',
  },

  business: {
    id: 'business',
    name: 'Business',
    description: 'Instant estimator + insurance workflow',
    tagline: 'CRM + Book Jobs website with estimator',
    price: 29900,
    priceAnnual: 299000,
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Instant estimator on website ($350–$550/sq)',
      '10 measurement reports/mo',
      'Insurance workflow',
      'Consumer financing',
      'Book Jobs website included',
    ],
    users: {
      included: 15,
      max: 25,
      additionalPrice: 2900,
    },
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
    features: [
      // All Pro features
      'contacts',
      'leads',
      'jobs',
      'quotes',
      'invoices',
      'payments',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      'good_better_best_pricing',
      'pricebook',
      'measurement_reports',
      'review_requests',
      'sms',
      'sms_templates',
      'quickbooks_sync',
      'photos',
      'before_after_galleries',
      'team_management',
      // Business additions — estimator + insurance workflow
      'instant_estimator',
      'estimator_on_website',
      'insurance_workflow',
      'insurance_claims',
      'adjuster_directory',
      'consumer_financing',
      'materials_management',
      'crews',
      'job_costing',
      'call_tracking',
      'automations',
      'email_campaigns',
      'advanced_reporting',
    ],
    limits: {
      contacts: 10000,
      jobs: 2000,
      storage: 100,
      smsCredits: 2000,
      measurementCredits: 10, // 10 reports/month
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  // Top tier for Roof is "Storm" — built for storm chasers.
  // Unlimited reports, canvassing, full insurance workflow with supplements.
  storm: {
    id: 'storm',
    name: 'Storm',
    description: 'Built for storm chasers and busy seasons',
    tagline: 'Unlimited reports + canvassing + full insurance workflow',
    price: 59900,
    priceAnnual: 599000,
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Unlimited measurement reports',
      'Storm lead generation',
      'Full insurance workflow + supplements',
      'Door-knock canvassing tool',
      'Estimator + service area pages',
    ],
    users: {
      included: 20,
      max: 50,
      additionalPrice: 2900,
    },
    stripePriceId: process.env.STRIPE_PRICE_CONSTRUCTION,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_CONSTRUCTION_ANNUAL,
    features: [
      // All Business features
      'contacts',
      'leads',
      'jobs',
      'quotes',
      'invoices',
      'payments',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      'good_better_best_pricing',
      'pricebook',
      'measurement_reports',
      'review_requests',
      'sms',
      'sms_templates',
      'quickbooks_sync',
      'photos',
      'before_after_galleries',
      'team_management',
      'instant_estimator',
      'estimator_on_website',
      'insurance_workflow',
      'insurance_claims',
      'adjuster_directory',
      'consumer_financing',
      'materials_management',
      'crews',
      'job_costing',
      'call_tracking',
      'automations',
      'email_campaigns',
      'advanced_reporting',
      // Storm additions — built for storm chasers
      'unlimited_measurement_reports',
      'storm_lead_generation',
      'storms_dashboard',
      'storm_radar_overlay',
      'door_knock_canvassing',
      'canvassing_routes',
      'canvassing_dashboard',
      'insurance_supplements',
      'supplement_tracking',
      'depreciation_recovery',
      'ai_receptionist',
      'service_area_pages',
      'multi_crew_dispatch',
    ],
    limits: {
      contacts: 25000,
      jobs: 5000,
      storage: 250,
      smsCredits: 5000,
      measurementCredits: -1, // unlimited
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale, white-glove support',
    tagline: 'Everything, unlimited, white-label',
    price: 19900, // per user
    priceAnnual: 199000, // $1,990/user/yr (2 months free)
    interval: 'month',
    bundledWebsite: 'book_jobs', // Book Jobs + white-label
    heroFeatures: [
      'Unlimited everything',
      'White-label + custom domain',
      'SSO',
      'API access',
      'Dedicated account manager',
    ],
    perUser: true,
    users: {
      included: 0,
      min: 10,
      max: null, // Unlimited
      additionalPrice: 19900,
    },
    stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL,
    features: [
      'all', // Everything
      // Enterprise exclusives
      'api_access',
      'white_label',
      'custom_domain',
      'sso',
      'priority_support',
      'dedicated_account_manager',
      'custom_integrations',
      'sla',
    ],
    limits: {
      contacts: null, // Unlimited
      jobs: null,
      storage: null,
      smsCredits: 10000,
    },
    highlight: false,
    cta: 'Contact Sales',
  },
};


// ============================================
// SELF-HOSTED LICENSE PACKAGES
// ============================================

// One-time license = monthly SaaS × 36 (3 years equivalent), uniform across tiers.
// "Full Platform" SKU removed — Enterprise self-hosted now uses proper per-user math.

export const SELF_HOSTED_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Starter License',
    description: 'Core roofing CRM for self-hosting',
    price: 176400, // $1,764 = $49 × 36
    features: SAAS_TIERS.starter.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_STARTER,
  },

  pro: {
    id: 'pro',
    name: 'Pro License',
    description: 'Good-Better-Best pricing + Showcase website for self-hosting',
    price: 536400, // $5,364 = $149 × 36
    features: SAAS_TIERS.pro.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
      'Docker configuration',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_PRO,
  },

  business: {
    id: 'business',
    name: 'Business License',
    description: 'Instant estimator + insurance workflow for self-hosting',
    price: 1076400, // $10,764 = $299 × 36
    features: SAAS_TIERS.business.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
      'Docker configuration',
      'CI/CD templates',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_BUSINESS,
  },

  storm: {
    id: 'storm',
    name: 'Storm License',
    description: 'Full storm-chaser platform for self-hosting',
    price: 2156400, // $21,564 = $599 × 36
    features: SAAS_TIERS.storm.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '90 days email support',
      'Docker configuration',
      'CI/CD templates',
      '1 hour setup call',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise License',
    description: 'Enterprise roofing for self-hosting — per user, 10 user minimum',
    price: 716400, // $7,164/user = $199 × 36
    perUser: true,
    minUsers: 10, // $71,640 minimum
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
      'SSO + SAML setup',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_ENTERPRISE,
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

// À la carte feature bundles for roofing contractors.
// Construction-PM/compliance/selections/fleet/equipment bundles from the
// generic CRM template have been removed — they don't apply to roofing.

export const FEATURE_BUNDLES = {
  sms: {
    id: 'sms',
    name: 'SMS Communication',
    description: 'Two-way texting with leads and customers',
    price: 3900,
    interval: 'month',
    features: ['sms', 'sms_templates', 'scheduled_sms'],
    subFeatures: {
      sms: { name: 'Two-Way SMS', price: 1900 },
      sms_templates: { name: 'SMS Templates', price: 1000 },
      scheduled_sms: { name: 'Scheduled SMS', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_SMS,
  },

  marketing: {
    id: 'marketing',
    name: 'Marketing Suite',
    description: 'Reviews, campaigns, call tracking, automations',
    price: 5900,
    interval: 'month',
    features: ['review_requests', 'email_campaigns', 'call_tracking', 'automations'],
    subFeatures: {
      review_requests: { name: 'Review Requests', price: 1900 },
      email_campaigns: { name: 'Email Campaigns', price: 1900 },
      call_tracking: { name: 'Call Tracking', price: 1900 },
      automations: { name: 'Automations', price: 1900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_MARKETING,
  },

  insurance_workflow: {
    id: 'insurance_workflow',
    name: 'Insurance Workflow',
    description: 'Insurance claims, adjuster directory, supplements',
    price: 7900,
    interval: 'month',
    features: ['insurance_claims', 'adjuster_directory', 'insurance_supplements', 'depreciation_recovery'],
    subFeatures: {
      insurance_claims: { name: 'Claims Tracking', price: 2500 },
      adjuster_directory: { name: 'Adjuster Directory', price: 1500 },
      insurance_supplements: { name: 'Supplements', price: 2500 },
      depreciation_recovery: { name: 'Depreciation Recovery', price: 1900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INSURANCE,
  },

  storm_canvassing: {
    id: 'storm_canvassing',
    name: 'Storm & Canvassing',
    description: 'Storm leads, door-knocking, radar overlay',
    price: 9900,
    interval: 'month',
    features: ['storm_lead_generation', 'door_knock_canvassing', 'storm_radar_overlay', 'canvassing_routes'],
    subFeatures: {
      storm_lead_generation: { name: 'Storm Lead Gen', price: 3900 },
      door_knock_canvassing: { name: 'Canvassing Tool', price: 2500 },
      storm_radar_overlay: { name: 'Radar Overlay', price: 1900 },
      canvassing_routes: { name: 'Route Planning', price: 1900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_STORM,
  },

  measurements: {
    id: 'measurements',
    name: 'Measurement Reports',
    description: 'Roof measurement reports — buy in bulk',
    price: 4900,
    interval: 'month',
    features: ['measurement_reports'],
    subFeatures: {
      measurement_reports: { name: '20 reports/mo', price: 4900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_MEASUREMENTS,
  },

  forms: {
    id: 'forms',
    name: 'Custom Forms',
    description: 'Inspection forms, customer agreements, e-sigs',
    price: 2900,
    interval: 'month',
    features: ['custom_forms', 'form_submissions', 'form_signatures'],
    subFeatures: {
      custom_forms: { name: 'Form Builder', price: 1500 },
      form_submissions: { name: 'Form Submissions', price: 1000 },
      form_signatures: { name: 'E-Signatures', price: 1000 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_FORMS,
  },

  integrations: {
    id: 'integrations',
    name: 'Integrations',
    description: 'QuickBooks, consumer financing (Wisetack/GreenSky)',
    price: 4900,
    interval: 'month',
    features: ['quickbooks_sync', 'consumer_financing'],
    subFeatures: {
      quickbooks_sync: { name: 'QuickBooks Sync', price: 2900 },
      consumer_financing: { name: 'Wisetack Financing', price: 2500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INTEGRATIONS,
  },
};


// ============================================
// INDUSTRY TEMPLATES
// ============================================

export const INDUSTRY_TEMPLATES = {
  residential_roofing: {
    id: 'residential_roofing',
    name: 'Residential Roofing',
    description: 'Single-family homes — repairs, replacements, inspections',
    recommendedTier: 'pro',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'good_better_best_pricing', 'pricebook', 'photos', 'measurement_reports',
      'sms', 'review_requests', 'quickbooks_sync',
    ],
  },
  commercial_roofing: {
    id: 'commercial_roofing',
    name: 'Commercial Roofing',
    description: 'Commercial buildings, flat roofs, large-scale projects',
    recommendedTier: 'business',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'good_better_best_pricing', 'measurement_reports', 'photos',
      'instant_estimator', 'materials_management', 'crews', 'job_costing',
      'consumer_financing', 'advanced_reporting',
    ],
  },
  storm_restoration: {
    id: 'storm_restoration',
    name: 'Storm Restoration',
    description: 'Hail/wind damage, insurance claims, supplements, canvassing',
    recommendedTier: 'storm',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'measurement_reports', 'unlimited_measurement_reports', 'photos',
      'insurance_workflow', 'insurance_claims', 'adjuster_directory',
      'insurance_supplements', 'depreciation_recovery',
      'storm_lead_generation', 'storms_dashboard', 'storm_radar_overlay',
      'door_knock_canvassing', 'canvassing_routes', 'sms', 'crews',
    ],
  },
  metal_roofing: {
    id: 'metal_roofing',
    name: 'Metal Roofing',
    description: 'Standing seam, corrugated, specialty metal installs',
    recommendedTier: 'business',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'good_better_best_pricing', 'pricebook', 'measurement_reports',
      'instant_estimator', 'materials_management', 'photos',
      'consumer_financing', 'sms', 'review_requests',
    ],
  },
  flat_roofing: {
    id: 'flat_roofing',
    name: 'Flat / Low-Slope Roofing',
    description: 'TPO, EPDM, modified bitumen, built-up roofing',
    recommendedTier: 'business',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'measurement_reports', 'instant_estimator', 'materials_management',
      'crews', 'job_costing', 'photos', 'sms',
    ],
  },
  insurance_restoration: {
    id: 'insurance_restoration',
    name: 'Insurance Restoration',
    description: 'Insurance-only contractor — claims, supplements, adjusters',
    recommendedTier: 'business',
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'payments',
      'insurance_workflow', 'insurance_claims', 'adjuster_directory',
      'insurance_supplements', 'depreciation_recovery', 'measurement_reports',
      'photos', 'sms',
    ],
  },
};


// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get tier by ID
 */
export function getTier(tierId: string) {
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
export function tierHasFeature(tierId: string, featureId: string) {
  const tier = SAAS_TIERS[tierId];
  if (!tier) return false;
  if (tier.features.includes('all')) return true;
  return tier.features.includes(featureId);
}

/**
 * Get the minimum tier that includes a feature
 */
export function getMinTierForFeature(featureId: string) {
  const tierOrder = ['starter', 'pro', 'business', 'storm', 'enterprise'];
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
export function calculateUserPrice(tierId: string, userCount: number) {
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
export function getBundleSavings(bundleId: string) {
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
export function formatPrice(cents: number, options: { showCents?: boolean; interval?: string | null } = {}) {
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
export function getRecommendedTier(userCount: number) {
  if (userCount <= 2) return 'starter';
  if (userCount <= 5) return 'pro';
  if (userCount <= 15) return 'business';
  if (userCount <= 20) return 'storm';
  return 'enterprise';
}

/**
 * Check if user should be prompted to upgrade
 */
export function shouldPromptUpgrade(currentTier: string, addons: string[] = [], totalSpend: number) {
  const tier = SAAS_TIERS[currentTier];
  if (!tier) return null;

  const tierOrder = ['starter', 'pro', 'business', 'storm', 'enterprise'];
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


/**
 * Get a website tier by ID
 */
export function getWebsiteTier(tierId: string) {
  return WEBSITE_TIERS[tierId] || null;
}

/**
 * Get all website tiers as array
 */
export function getAllWebsiteTiers() {
  return Object.values(WEBSITE_TIERS);
}

/**
 * Get the website tier bundled with a given CRM tier (null if none)
 */
export function getBundledWebsiteForCrmTier(crmTierId: string) {
  const tier = SAAS_TIERS[crmTierId];
  if (!tier || !tier.bundledWebsite) return null;
  return WEBSITE_TIERS[tier.bundledWebsite] || null;
}

export default {
  WEBSITE_TIERS,
  SAAS_TIERS,
  SELF_HOSTED_PACKAGES,
  SELF_HOSTED_ADDONS,
  FEATURE_BUNDLES,
  INDUSTRY_TEMPLATES,
  getTier,
  getAllTiers,
  getWebsiteTier,
  getAllWebsiteTiers,
  getBundledWebsiteForCrmTier,
  tierHasFeature,
  getMinTierForFeature,
  calculateUserPrice,
  getBundleSavings,
  formatPrice,
  getRecommendedTier,
  shouldPromptUpgrade,
};
