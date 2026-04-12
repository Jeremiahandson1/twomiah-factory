/**
 * {{COMPANY_NAME}} Pricing Configuration — Home Care (Care)
 *
 * Single source of truth for all pricing:
 * - Website subscription tiers (standalone)
 * - SaaS CRM subscription tiers (with bundled websites at Pro+)
 * - Self-hosted license packages
 * - À la carte feature bundles
 *
 * Care-specific tier naming:
 * - Top tier is "Agency" (full claims + reconciliation + multi-branch) not "Construction"
 *
 * Pricing philosophy:
 * - Annual = exactly 2 months free (monthly × 10)
 * - Pro+ tiers include a matching website tier at no extra cost
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
    description: 'Client records, schedules, and time tracking',
    tagline: 'CRM only — pair with any website tier',
    price: 4900,
    priceAnnual: 49000,
    interval: 'month',
    bundledWebsite: null,
    heroFeatures: [
      'Client & caregiver records',
      'Visit scheduling',
      'Time tracking & EVV',
      'Basic invoicing',
      'Caregiver mobile app',
    ],
    users: {
      included: 2,
      max: 2,
      additionalPrice: null, // Can't add users, must upgrade
    },
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    features: [
      'clients',
      'caregivers',
      'scheduling',
      'time_tracking',
      'evv',
      'documents',
      'basic_invoicing',
      'caregiver_mobile_app',
      'dashboard',
    ],
    limits: {
      clients: 50,
      caregivers: 10,
      visits: 500, // per month
      storage: 5, // GB
      smsCredits: 0,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Private-pay billing engine + website',
    tagline: 'CRM + Showcase website',
    price: 14900,
    priceAnnual: 149000,
    interval: 'month',
    bundledWebsite: 'showcase',
    heroFeatures: [
      'Private-pay rate engine',
      'Care types & rates',
      'Caregiver bio pages',
      'Referral tracking',
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
      'clients',
      'caregivers',
      'scheduling',
      'time_tracking',
      'evv',
      'documents',
      'basic_invoicing',
      'caregiver_mobile_app',
      'dashboard',
      // Pro additions
      'private_pay_billing',
      'care_types',
      'caregiver_bio_pages',
      'referral_tracking',
      'sms',
      'sms_templates',
      'review_requests',
      'family_portal',
      'caregiver_availability',
      'shift_swaps',
      'open_shifts',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'incidents',
      'care_plans',
    ],
    limits: {
      clients: 250,
      caregivers: 50,
      visits: 2500,
      storage: 25,
      smsCredits: 500,
    },
    highlight: true, // "Most Popular"
    cta: 'Start Free Trial',
  },

  business: {
    id: 'business',
    name: 'Business',
    description: 'Medicare & Medicaid claims',
    tagline: 'CRM + Book Jobs website',
    price: 29900,
    priceAnnual: 299000,
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Medicare / Medicaid billing',
      'Referral source rates',
      'Authorized units tracking',
      'Claim generation',
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
      'clients',
      'caregivers',
      'scheduling',
      'time_tracking',
      'evv',
      'documents',
      'basic_invoicing',
      'caregiver_mobile_app',
      'dashboard',
      'private_pay_billing',
      'care_types',
      'caregiver_bio_pages',
      'referral_tracking',
      'sms',
      'sms_templates',
      'review_requests',
      'family_portal',
      'caregiver_availability',
      'shift_swaps',
      'open_shifts',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'incidents',
      'care_plans',
      // Business additions — payer/claims workflow
      'medicare_billing',
      'medicaid_billing',
      'referral_source_rates',
      'authorized_units',
      'service_codes',
      'claim_generation',
      'edi_837',
      'remittance_835',
      'payers',
      'payroll',
      'training_records',
      'background_checks',
      'certifications',
      'compliance_tracking',
      'advanced_reporting',
      'medications',
      'adl_tracking',
    ],
    limits: {
      clients: 1000,
      caregivers: 200,
      visits: 10000,
      storage: 100,
      smsCredits: 2000,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  // Top tier for Care is "Agency" — full claims processing, reconciliation, multi-branch.
  agency: {
    id: 'agency',
    name: 'Agency',
    description: 'Full agency operations platform',
    tagline: 'Full claims + multi-branch + caregiver portal website',
    price: 59900,
    priceAnnual: 599000,
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Full claims processing',
      'Check scanning & reconciliation',
      'Multi-branch operations',
      'HIPAA-grade audit logs',
      'Caregiver portal website included',
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
      'clients',
      'caregivers',
      'scheduling',
      'time_tracking',
      'evv',
      'documents',
      'basic_invoicing',
      'caregiver_mobile_app',
      'dashboard',
      'private_pay_billing',
      'care_types',
      'caregiver_bio_pages',
      'referral_tracking',
      'sms',
      'sms_templates',
      'review_requests',
      'family_portal',
      'caregiver_availability',
      'shift_swaps',
      'open_shifts',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'incidents',
      'care_plans',
      'medicare_billing',
      'medicaid_billing',
      'referral_source_rates',
      'authorized_units',
      'service_codes',
      'claim_generation',
      'edi_837',
      'remittance_835',
      'payers',
      'payroll',
      'training_records',
      'background_checks',
      'certifications',
      'compliance_tracking',
      'advanced_reporting',
      'medications',
      'adl_tracking',
      // Agency additions — full agency operations
      'full_claims_processing',
      'check_scanning',
      'check_reconciliation',
      'multi_branch',
      'hipaa_audit_logs',
      'sandata_integration',
      'caregiver_portal',
      'route_optimizer',
      'schedule_optimizer',
      'forecast',
      'ai_receptionist',
      'gusto_integration',
      'performance_reviews',
      'no_show_tracking',
      'pto_management',
    ],
    limits: {
      clients: 5000,
      caregivers: 1000,
      visits: 50000,
      storage: 250,
      smsCredits: 5000,
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

export const SELF_HOSTED_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Starter License',
    description: 'Core CRM functionality for self-hosting',
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

  pro: {
    id: 'pro',
    name: 'Pro License',
    description: 'Field service features for self-hosting',
    price: 249700, // $2,497
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
    description: 'Complete operations platform for self-hosting',
    price: 499700, // $4,997
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

  agency: {
    id: 'agency',
    name: 'Agency License',
    description: 'Full home care agency platform for self-hosting',
    price: 999700, // $9,997
    features: SAAS_TIERS.agency.features,
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

  full: {
    id: 'full',
    name: 'Full Platform License',
    description: 'Everything - complete source code',
    price: 1499700, // $14,997
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

// À la carte feature bundles for home care agencies.
// Construction-PM/compliance/selections/inventory/fleet/equipment bundles
// from the generic CRM template have been removed — they don't apply.

export const FEATURE_BUNDLES = {
  sms: {
    id: 'sms',
    name: 'SMS Communication',
    description: 'Two-way texting with caregivers and family',
    price: 3900, // $39/mo
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
    description: 'Reviews, family campaigns, referral source outreach',
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

  forms: {
    id: 'forms',
    name: 'Care Assessments & Forms',
    description: 'Custom intake forms, assessments, and e-signatures',
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
    description: 'QuickBooks, Gusto payroll, Sandata EVV',
    price: 4900,
    interval: 'month',
    features: ['quickbooks_sync', 'gusto_integration', 'sandata_integration'],
    subFeatures: {
      quickbooks_sync: { name: 'QuickBooks Sync', price: 2500 },
      gusto_integration: { name: 'Gusto Payroll', price: 1900 },
      sandata_integration: { name: 'Sandata EVV', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INTEGRATIONS,
  },
};


// ============================================
// INDUSTRY TEMPLATES
// ============================================

export const INDUSTRY_TEMPLATES = {
  in_home_care: {
    id: 'in_home_care',
    name: 'In-Home Care',
    description: 'Non-medical companion and personal care',
    recommendedTier: 'pro',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'evv',
      'private_pay_billing', 'caregiver_bio_pages', 'family_portal',
      'sms', 'incidents', 'care_plans',
    ],
  },
  home_health: {
    id: 'home_health',
    name: 'Home Health Agency',
    description: 'Skilled nursing and therapy with Medicare billing',
    recommendedTier: 'business',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'evv',
      'medicare_billing', 'medicaid_billing', 'authorized_units',
      'service_codes', 'claim_generation', 'edi_837', 'remittance_835',
      'compliance_tracking', 'training_records', 'medications', 'adl_tracking',
    ],
  },
  hospice: {
    id: 'hospice',
    name: 'Hospice',
    description: 'End-of-life care with Medicare/Medicaid billing',
    recommendedTier: 'business',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking',
      'medicare_billing', 'medicaid_billing', 'care_plans', 'medications',
      'incidents', 'family_portal', 'compliance_tracking',
    ],
  },
  pediatric_home_care: {
    id: 'pediatric_home_care',
    name: 'Pediatric Home Care',
    description: 'In-home care for children with medical needs',
    recommendedTier: 'business',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'evv',
      'medicaid_billing', 'authorized_units', 'care_plans', 'medications',
      'family_portal', 'incidents', 'training_records',
    ],
  },
  multi_branch_agency: {
    id: 'multi_branch_agency',
    name: 'Multi-Branch Agency',
    description: 'Large agency operating multiple locations',
    recommendedTier: 'agency',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'evv',
      'medicare_billing', 'medicaid_billing', 'claim_generation',
      'full_claims_processing', 'check_reconciliation', 'multi_branch',
      'hipaa_audit_logs', 'caregiver_portal', 'route_optimizer',
      'gusto_integration', 'sandata_integration',
    ],
  },
  veterans_care: {
    id: 'veterans_care',
    name: 'Veterans Home Care',
    description: 'VA-funded home care services',
    recommendedTier: 'business',
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'evv',
      'authorized_units', 'service_codes', 'claim_generation',
      'compliance_tracking', 'family_portal',
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
  const tierOrder = ['starter', 'pro', 'business', 'agency', 'enterprise'];
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
  if (userCount <= 20) return 'agency';
  return 'enterprise';
}

/**
 * Check if user should be prompted to upgrade
 */
export function shouldPromptUpgrade(currentTier: string, addons: string[] = [], totalSpend: number) {
  const tier = SAAS_TIERS[currentTier];
  if (!tier) return null;

  const tierOrder = ['starter', 'pro', 'business', 'agency', 'enterprise'];
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
