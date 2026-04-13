/**
 * {{COMPANY_NAME}} Pricing Configuration — Field Service (Wrench)
 *
 * Single source of truth for all pricing:
 * - Website subscription tiers (standalone)
 * - SaaS CRM subscription tiers (with bundled websites at Pro+)
 * - Self-hosted license packages
 * - À la carte feature bundles
 * - Individual sub-features
 *
 * Wrench-specific tier naming:
 * - Top tier is "Fleet" (multi-location dispatch) not "Construction"
 *
 * Pricing philosophy:
 * - Annual = exactly 2 months free (monthly × 10)
 * - Pro+ tiers include a matching website tier at no extra cost
 */

// ============================================
// WEBSITE SUBSCRIPTION TIERS (standalone)
// ============================================

export const WEBSITE_TIERS = {
  presence: {
    id: 'presence',
    name: 'Presence',
    tagline: 'Get found online',
    description: 'One-page lead capture site with CMS — your phone number, service area, and a form, online and professional.',
    price: 1900,
    priceAnnual: 19000,
    interval: 'month',
    features: ['one_page_site', 'cms', 'lead_form', 'custom_domain_byo', 'mobile_responsive', 'ssl'],
    stripePriceId: process.env.STRIPE_PRICE_WEBSITE_PRESENCE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_WEBSITE_PRESENCE_ANNUAL,
    highlight: false,
    cta: 'Start Free Trial',
  },

  showcase: {
    id: 'showcase',
    name: 'Showcase',
    tagline: 'Show off your work',
    description: 'Full multi-page site with CMS, blog, and SEO — trust signals, service pages, and before/after galleries.',
    price: 4900,
    priceAnnual: 49000,
    interval: 'month',
    features: ['multi_page_site', 'cms', 'blog', 'seo_basics', 'photo_galleries', 'contact_forms', 'google_maps', 'reviews_widget', 'custom_domain_byo', 'mobile_responsive', 'ssl'],
    stripePriceId: process.env.STRIPE_PRICE_WEBSITE_SHOWCASE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_WEBSITE_SHOWCASE_ANNUAL,
    highlight: true,
    cta: 'Start Free Trial',
  },

  book_jobs: {
    id: 'book_jobs',
    name: 'Book Jobs',
    tagline: 'Turn visitors into booked jobs',
    description: 'Full site with online booking, quote requests, and service area pages — remove the phone tag that costs you jobs.',
    price: 9900,
    priceAnnual: 99000,
    interval: 'month',
    features: ['multi_page_site', 'cms', 'blog', 'seo_basics', 'photo_galleries', 'online_booking', 'quote_requests', 'service_area_pages', 'google_analytics', 'custom_domain_byo', 'mobile_responsive', 'ssl'],
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
    description: 'Everything you need to run a field service business',
    tagline: 'CRM only — pair with any website tier',
    price: 4900,
    priceAnnual: 49000, // $490/yr (2 months free)
    interval: 'month',
    bundledWebsite: null,
    heroFeatures: [
      'Jobs & scheduling',
      'Quotes & invoices',
      'Payments',
      'Customer portal',
      'Mobile tech app',
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
      'jobs',
      'scheduling',
      'quotes',
      'invoices',
      'payments',
      'time_tracking',
      'expenses',
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
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'GPS, routing, and a website — all included',
    tagline: 'CRM + Showcase website',
    price: 14900,
    priceAnnual: 149000, // $1,490/yr (2 months free)
    interval: 'month',
    bundledWebsite: 'showcase',
    heroFeatures: [
      'GPS tracking & geofencing',
      'Route optimization',
      'Flat-rate pricebook',
      'Service agreements',
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
      'jobs',
      'scheduling',
      'quotes',
      'invoices',
      'payments',
      'time_tracking',
      'expenses',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      // Pro additions
      'team_management',
      'sms',
      'sms_templates',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'route_optimization',
      'online_booking',
      'review_requests',
      'service_agreements',
      'pricebook',
      'quickbooks_sync',
      'recurring_jobs',
      'job_costing',
    ],
    limits: {
      contacts: 2500,
      jobs: 500,
      storage: 25,
      smsCredits: 500, // per month
    },
    highlight: true, // "Most Popular"
    cta: 'Start Free Trial',
  },

  business: {
    id: 'business',
    name: 'Business',
    description: 'Equipment, inventory, and fleet management',
    tagline: 'CRM + Book Jobs website',
    price: 29900,
    priceAnnual: 299000, // $2,990/yr (2 months free)
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Customer equipment tracking',
      'Parts inventory',
      'Fleet management',
      'Maintenance contracts',
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
      'jobs',
      'scheduling',
      'quotes',
      'invoices',
      'payments',
      'time_tracking',
      'expenses',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      'team_management',
      'sms',
      'sms_templates',
      'scheduled_sms',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'route_optimization',
      'online_booking',
      'review_requests',
      'service_agreements',
      'pricebook',
      'quickbooks_sync',
      'recurring_jobs',
      'job_costing',
      // Business additions
      'inventory',
      'inventory_locations',
      'stock_levels',
      'inventory_transfers',
      'purchase_orders',
      'equipment_tracking',
      'equipment_maintenance',
      'fleet_vehicles',
      'fleet_maintenance',
      'fleet_fuel',
      'warranties',
      'warranty_claims',
      'email_templates',
      'email_campaigns',
      'call_tracking',
      'automations',
      'custom_forms',
      'consumer_financing',
      'advanced_reporting',
    ],
    limits: {
      contacts: 10000,
      jobs: 2000,
      storage: 100,
      smsCredits: 2000,
    },
    highlight: false,
    cta: 'Start Free Trial',
  },

  // Top tier for Wrench is "Fleet" — multi-location dispatch, not construction.
  fleet: {
    id: 'fleet',
    name: 'Fleet',
    description: 'Multi-location dispatch at scale',
    tagline: 'Multi-location operations + full website',
    price: 59900,
    priceAnnual: 599000, // $5,990/yr (2 months free)
    interval: 'month',
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Multi-location dispatch',
      'Advanced scheduling & routing',
      'Call tracking & recording',
      'Commission tracking',
      'Service area pages on website',
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
      'jobs',
      'scheduling',
      'quotes',
      'invoices',
      'payments',
      'time_tracking',
      'expenses',
      'documents',
      'customer_portal',
      'dashboard',
      'mobile_app',
      'team_management',
      'sms',
      'sms_templates',
      'scheduled_sms',
      'gps_tracking',
      'geofencing',
      'auto_clock',
      'route_optimization',
      'online_booking',
      'review_requests',
      'service_agreements',
      'pricebook',
      'quickbooks_sync',
      'recurring_jobs',
      'job_costing',
      'inventory',
      'inventory_locations',
      'stock_levels',
      'inventory_transfers',
      'purchase_orders',
      'equipment_tracking',
      'equipment_maintenance',
      'fleet_vehicles',
      'fleet_maintenance',
      'fleet_fuel',
      'warranties',
      'warranty_claims',
      'email_templates',
      'email_campaigns',
      'call_tracking',
      'automations',
      'custom_forms',
      'consumer_financing',
      'advanced_reporting',
      // Fleet additions (multi-location dispatch focus)
      'multi_location',
      'advanced_dispatch',
      'call_recording',
      'commission_tracking',
      'territory_management',
      'technician_assignment_rules',
      'shift_scheduling',
      'on_call_rotation',
      'dispatch_board',
      'revenue_by_location',
      'revenue_by_technician',
      'service_area_pages',
    ],
    limits: {
      contacts: 25000,
      jobs: 5000,
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
    bundledWebsite: 'book_jobs',
    heroFeatures: [
      'Unlimited techs & locations',
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
    description: 'Core field service CRM for self-hosting',
    price: 176400, // $1,764 = $49 × 36
    features: SAAS_TIERS.starter.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '3 years of free updates',
      '90 days email support',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_STARTER,
  },

  pro: {
    id: 'pro',
    name: 'Pro License',
    description: 'GPS, routing, pricebook + Showcase website for self-hosting',
    price: 536400, // $5,364 = $149 × 36
    features: SAAS_TIERS.pro.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '3 years of free updates',
      '90 days email support',
      'Docker configuration',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_PRO,
  },

  business: {
    id: 'business',
    name: 'Business License',
    description: 'Equipment + inventory + fleet management for self-hosting',
    price: 1076400, // $10,764 = $299 × 36
    features: SAAS_TIERS.business.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '3 years of free updates',
      '90 days email support',
      'Docker configuration',
      'CI/CD templates',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_BUSINESS,
  },

  fleet: {
    id: 'fleet',
    name: 'Fleet License',
    description: 'Multi-location dispatch platform for self-hosting — all features',
    price: 2156400, // $21,564 = $599 × 36
    features: SAAS_TIERS.fleet.features,
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      '3 years of free updates',
      '90 days email support',
      'Docker configuration',
      'CI/CD templates',
      '1 hour setup call',
    ],
    stripePriceId: process.env.STRIPE_PRICE_LICENSE_CONSTRUCTION,
  },

  // Enterprise self-hosted: flat $71,640, unlimited users, lifetime updates.
  // Anchor math: $199 × 36 × 10 users, but we drop the per-user cap.
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise License',
    description: 'Full field service platform for self-hosting — unlimited users, 3 years updates + support',
    price: 7164000, // $71,640 flat = $199 × 36 × 10 users (anchor math, no cap)
    unlimitedUsers: true,
    features: ['all'],
    includes: [
      'Full source code',
      'Database schema',
      'Deployment documentation',
      'Unlimited users (no per-seat cap)',
      '3 years of free updates',
      '3 years of email + phone support',
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

export const FEATURE_BUNDLES = {
  sms: {
    id: 'sms',
    name: 'SMS Communication',
    description: 'Two-way texting with customers',
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

  gps_field: {
    id: 'gps_field',
    name: 'GPS & Field',
    description: 'Track techs, optimize routes',
    price: 4900,
    interval: 'month',
    features: ['gps_tracking', 'geofencing', 'auto_clock', 'route_optimization'],
    subFeatures: {
      gps_tracking: { name: 'GPS Tracking', price: 1500 },
      geofencing: { name: 'Geofencing', price: 1500 },
      auto_clock: { name: 'Auto Clock In/Out', price: 1000 },
      route_optimization: { name: 'Route Optimization', price: 1900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_GPS,
  },

  inventory: {
    id: 'inventory',
    name: 'Inventory Management',
    description: 'Track parts across locations',
    price: 4900,
    interval: 'month',
    features: ['inventory', 'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders'],
    subFeatures: {
      inventory: { name: 'Inventory Items', price: 1500 },
      inventory_locations: { name: 'Multiple Locations', price: 1000 },
      stock_levels: { name: 'Stock Tracking', price: 1000 },
      inventory_transfers: { name: 'Transfers', price: 1000 },
      purchase_orders: { name: 'Purchase Orders', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INVENTORY,
  },

  fleet: {
    id: 'fleet',
    name: 'Fleet Management',
    description: 'Vehicles, maintenance, fuel',
    price: 3900,
    interval: 'month',
    features: ['fleet_vehicles', 'fleet_maintenance', 'fleet_fuel'],
    subFeatures: {
      fleet_vehicles: { name: 'Vehicle Tracking', price: 1500 },
      fleet_maintenance: { name: 'Maintenance Logs', price: 1500 },
      fleet_fuel: { name: 'Fuel Tracking', price: 1000 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_FLEET,
  },

  equipment: {
    id: 'equipment',
    name: 'Equipment Tracking',
    description: 'Customer equipment & maintenance',
    price: 2900,
    interval: 'month',
    features: ['equipment_tracking', 'equipment_maintenance'],
    subFeatures: {
      equipment_tracking: { name: 'Equipment Tracking', price: 1500 },
      equipment_maintenance: { name: 'Maintenance Records', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_EQUIPMENT,
  },

  marketing: {
    id: 'marketing',
    name: 'Marketing Suite',
    description: 'Reviews, campaigns, call tracking',
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

  construction_pm: {
    id: 'construction_pm',
    name: 'Construction PM',
    description: 'Projects, change orders, RFIs, and more',
    price: 14900,
    interval: 'month',
    features: ['projects', 'change_orders', 'rfis', 'submittals', 'daily_logs', 'punch_lists', 'inspections', 'bids', 'gantt_charts'],
    subFeatures: {
      projects: { name: 'Project Management', price: 2500 },
      change_orders: { name: 'Change Orders', price: 1900 },
      rfis: { name: 'RFIs', price: 1500 },
      submittals: { name: 'Submittals', price: 1500 },
      daily_logs: { name: 'Daily Logs', price: 1500 },
      punch_lists: { name: 'Punch Lists', price: 1500 },
      inspections: { name: 'Inspections', price: 1500 },
      bids: { name: 'Bid Management', price: 1500 },
      gantt_charts: { name: 'Gantt Charts', price: 2500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_CONSTRUCTION,
  },

  compliance: {
    id: 'compliance',
    name: 'Compliance & Draws',
    description: 'Lien waivers, draw schedules, AIA forms',
    price: 7900,
    interval: 'month',
    features: ['lien_waivers', 'draw_schedules', 'draw_requests', 'aia_forms'],
    subFeatures: {
      lien_waivers: { name: 'Lien Waivers (4 types)', price: 3900 },
      draw_schedules: { name: 'Draw Schedules', price: 2900 },
      draw_requests: { name: 'Draw Requests', price: 1500 },
      aia_forms: { name: 'AIA G702/G703', price: 1500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_COMPLIANCE,
  },

  selections_takeoffs: {
    id: 'selections_takeoffs',
    name: 'Selections & Takeoffs',
    description: 'Client selections, material takeoffs',
    price: 4900,
    interval: 'month',
    features: ['selections', 'selection_portal', 'takeoffs'],
    subFeatures: {
      selections: { name: 'Selections', price: 2500 },
      selection_portal: { name: 'Selection Portal', price: 1000 },
      takeoffs: { name: 'Takeoffs', price: 2900 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_SELECTIONS,
  },

  service_contracts: {
    id: 'service_contracts',
    name: 'Service Contracts',
    description: 'Agreements, warranties',
    price: 3900,
    interval: 'month',
    features: ['service_agreements', 'warranties', 'warranty_claims'],
    subFeatures: {
      service_agreements: { name: 'Service Agreements', price: 2500 },
      warranties: { name: 'Warranties', price: 1900 },
      warranty_claims: { name: 'Warranty Claims', price: 1000 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_SERVICE,
  },

  forms: {
    id: 'forms',
    name: 'Custom Forms',
    description: 'Build custom checklists and forms',
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
    description: 'QuickBooks, financing',
    price: 4900,
    interval: 'month',
    features: ['quickbooks_sync', 'consumer_financing'],
    subFeatures: {
      quickbooks_sync: { name: 'QuickBooks Sync', price: 2900 },
      consumer_financing: { name: 'Wisetack Financing', price: 2500 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_INTEGRATIONS,
  },

  // Twomiah Ads — cross-vertical marketing add-on. Route already exists at
  // /api/ads with Google + Meta integration for field service shops.
  twomiah_ads: {
    id: 'twomiah_ads',
    name: 'Twomiah Ads',
    description: 'Automated Google + Meta ads for HVAC, plumbing, electrical',
    price: 9900,
    interval: 'month',
    features: ['paid_ads', 'ad_creative_generation', 'campaign_management', 'ad_roi_tracking'],
    subFeatures: {
      paid_ads: { name: 'Google + Meta ad management', price: 4900 },
      ad_creative_generation: { name: 'AI creative generation', price: 2500 },
      campaign_management: { name: 'Seasonal campaign automation', price: 1500 },
      ad_roi_tracking: { name: 'ROI + attribution tracking', price: 1000 },
    },
    stripePriceId: process.env.STRIPE_PRICE_BUNDLE_TWOMIAH_ADS,
  },
};


// ============================================
// INDUSTRY TEMPLATES
// ============================================

export const INDUSTRY_TEMPLATES = {
  plumber: {
    id: 'plumber',
    name: 'Plumber',
    description: 'Plumbing service company',
    recommendedTier: 'pro',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'gps_tracking', 'route_optimization', 'pricebook',
      'sms', 'review_requests', 'service_agreements', 'quickbooks_sync',
    ],
  },
  hvac: {
    id: 'hvac',
    name: 'HVAC',
    description: 'Heating, ventilation, air conditioning',
    recommendedTier: 'business',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'gps_tracking', 'route_optimization', 'pricebook',
      'sms', 'review_requests', 'service_agreements', 'quickbooks_sync',
      'equipment_tracking', 'equipment_maintenance', 'inventory', 'fleet_vehicles',
    ],
  },
  electrician: {
    id: 'electrician',
    name: 'Electrician',
    description: 'Electrical contractor',
    recommendedTier: 'pro',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'gps_tracking', 'route_optimization', 'pricebook',
      'sms', 'review_requests', 'quickbooks_sync',
    ],
  },
  remodeler: {
    id: 'remodeler',
    name: 'Remodeler',
    description: 'Home remodeling contractor',
    recommendedTier: 'fleet',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'projects', 'change_orders', 'selections', 'daily_logs', 'punch_lists',
      'sms', 'customer_portal', 'documents', 'photos',
    ],
  },
  general_contractor: {
    id: 'general_contractor',
    name: 'General Contractor',
    description: 'Commercial or residential GC',
    recommendedTier: 'fleet',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'projects', 'change_orders', 'rfis', 'submittals', 'daily_logs',
      'punch_lists', 'inspections', 'bids', 'gantt_charts',
      'lien_waivers', 'draw_schedules',
    ],
  },
  home_builder: {
    id: 'home_builder',
    name: 'Home Builder',
    description: 'New home construction',
    recommendedTier: 'fleet',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'projects', 'change_orders', 'selections', 'selection_portal',
      'daily_logs', 'punch_lists', 'inspections', 'warranties',
      'draw_schedules', 'customer_portal',
    ],
  },
  cleaning: {
    id: 'cleaning',
    name: 'Cleaning Service',
    description: 'Residential or commercial cleaning',
    recommendedTier: 'starter',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'recurring_jobs', 'online_booking', 'review_requests',
    ],
  },
  landscaping: {
    id: 'landscaping',
    name: 'Landscaping',
    description: 'Lawn care and landscaping',
    recommendedTier: 'pro',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'gps_tracking', 'route_optimization',
      'recurring_jobs', 'service_agreements', 'sms', 'review_requests',
    ],
  },
  pest_control: {
    id: 'pest_control',
    name: 'Pest Control',
    description: 'Pest management services',
    recommendedTier: 'pro',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'time_tracking', 'gps_tracking', 'route_optimization',
      'recurring_jobs', 'service_agreements', 'custom_forms', 'sms',
    ],
  },
  roofing: {
    id: 'roofing',
    name: 'Roofing',
    description: 'Roofing contractor',
    recommendedTier: 'business',
    features: [
      'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
      'projects', 'change_orders', 'photos', 'documents',
      'consumer_financing', 'sms', 'review_requests',
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
  const tierOrder = ['starter', 'pro', 'business', 'fleet', 'enterprise'];
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
  if (userCount <= 2) return 'starter';
  if (userCount <= 5) return 'pro';
  if (userCount <= 15) return 'business';
  if (userCount <= 20) return 'fleet';
  return 'enterprise';
}

/**
 * Check if user should be prompted to upgrade
 */
export function shouldPromptUpgrade(currentTier, addons = [], totalSpend) {
  const tier = SAAS_TIERS[currentTier];
  if (!tier) return null;

  const tierOrder = ['starter', 'pro', 'business', 'fleet', 'enterprise'];
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
