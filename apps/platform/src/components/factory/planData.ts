// ═══════════════════════════════════════════════════════════════════
// Plan definitions for all Twomiah products
// ═══════════════════════════════════════════════════════════════════

export type ProductLine = 'build' | 'care' | 'wrench'

export type Plan = {
  id: string
  name: string
  monthly: number
  annual: number
  features: string[]
  websiteFeatures: string[]
  websiteDesc: string
  highlight?: boolean
}

export type SetupTier = {
  id: string
  name: string
  price: number
  description: string
}

export type Addon = {
  id: string
  name: string
  monthly: number
  description: string
  products?: ProductLine[] // if omitted, available for all
}

export type PlanSelection = {
  product: ProductLine
  planId: string
  billingCycle: 'monthly' | 'annual'
  setupTierId: string
  addonIds: string[]
}

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH BUILD — Construction CRM
// ═══════════════════════════════════════════════════════════════════

const BUILD_PLANS: Plan[] = [
  {
    id: 'build-solo',
    name: 'Solo',
    monthly: 49,
    annual: 42,
    features: ['contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team', 'dashboard'],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead Capture (1 page)',
  },
  {
    id: 'build-small-crew',
    name: 'Small Crew',
    monthly: 129,
    annual: 110,
    highlight: true,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team', 'dashboard',
      'change_orders', 'daily_logs', 'time_tracking', 'gps_tracking', 'photo_capture',
      'expense_tracking', 'online_payments', 'client_portal', 'two_way_texting',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Brochure (3–5 pages)',
  },
  {
    id: 'build-growing',
    name: 'Growing Contractor',
    monthly: 199,
    annual: 169,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team', 'dashboard',
      'change_orders', 'daily_logs', 'time_tracking', 'gps_tracking', 'photo_capture',
      'expense_tracking', 'online_payments', 'client_portal', 'two_way_texting',
      'projects', 'rfis', 'punch_lists', 'inspections', 'job_costing',
      'equipment_tracking', 'quickbooks', 'reports', 'google_reviews',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Full site (gallery, blog, testimonials)',
  },
  {
    id: 'build-established',
    name: 'Established GC',
    monthly: 499,
    annual: 424,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team', 'dashboard',
      'change_orders', 'daily_logs', 'time_tracking', 'gps_tracking', 'photo_capture',
      'expense_tracking', 'online_payments', 'client_portal', 'two_way_texting',
      'projects', 'rfis', 'punch_lists', 'inspections', 'job_costing',
      'equipment_tracking', 'quickbooks', 'reports', 'google_reviews',
      'bid_management', 'takeoff_tools', 'selections', 'lead_inbox',
      'paid_ads', 'email_marketing', 'referral_program', 'custom_dashboards',
      'ai_receptionist', 'documents', 'inventory', 'map_view', 'consumer_financing',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Full site + Twomiah Vision visualizer',
  },
]

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH CARE — Home Care Agency CRM
// ═══════════════════════════════════════════════════════════════════

const CARE_PLANS: Plan[] = [
  {
    id: 'care-small',
    name: 'Small Agency',
    monthly: 99,
    annual: 84,
    features: [
      'contacts', 'scheduling', 'basic_evv', 'caregiver_portal', 'client_portal',
      'invoices', 'dashboard', 'documents',
    ],
    websiteFeatures: ['contact_form'],
    websiteDesc: '2-page agency site (lead capture + caregiver application)',
  },
  {
    id: 'care-established',
    name: 'Established Agency',
    monthly: 199,
    annual: 169,
    highlight: true,
    features: [
      'contacts', 'scheduling', 'basic_evv', 'caregiver_portal', 'client_portal',
      'invoices', 'dashboard', 'documents',
      'full_evv_sandata', 'medicaid_billing', 'payroll_enforcement',
      'gps_tracking', 'open_shift_alerts', 'referral_crm',
      'two_way_texting', 'incident_reporting', 'compliance_dashboard',
      'quickbooks', 'google_reviews', 'caregiver_recruitment_ads',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials', 'analytics'],
    websiteDesc: 'Full agency site + SEO',
  },
]

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH WRENCH — Field Service CRM
// ═══════════════════════════════════════════════════════════════════

const WRENCH_PLANS: Plan[] = [
  {
    id: 'wrench-solo',
    name: 'Solo',
    monthly: 59,
    annual: 50,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'pricebook',
      'online_booking', 'scheduling', 'dashboard',
    ],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead capture + booking widget',
  },
  {
    id: 'wrench-small-shop',
    name: 'Small Shop',
    monthly: 149,
    annual: 127,
    highlight: true,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'pricebook',
      'online_booking', 'scheduling', 'dashboard',
      'team', 'drag_drop_calendar', 'recurring_jobs', 'service_dispatch',
      'service_agreements', 'warranties', 'two_way_texting', 'online_payments',
      'time_tracking', 'gps_tracking', 'photo_capture', 'google_reviews',
      'tech_mobile_view', 'customer_portal',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Brochure (3–5 pages) + real-time tech tracker',
  },
  {
    id: 'wrench-growing',
    name: 'Growing Operation',
    monthly: 279,
    annual: 237,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'pricebook',
      'online_booking', 'scheduling', 'dashboard',
      'team', 'drag_drop_calendar', 'recurring_jobs', 'service_dispatch',
      'service_agreements', 'warranties', 'two_way_texting', 'online_payments',
      'time_tracking', 'gps_tracking', 'photo_capture', 'google_reviews',
      'tech_mobile_view', 'customer_portal',
      'route_optimization', 'job_costing', 'expense_tracking', 'quickbooks',
      'reports', 'lead_inbox', 'email_marketing', 'referral_program',
      'paid_ads', 'ai_receptionist',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Full site + seasonal ad automation',
  },
]

// ═══════════════════════════════════════════════════════════════════
// SETUP TIERS (one-time, same for all products)
// ═══════════════════════════════════════════════════════════════════

export const SETUP_TIERS: SetupTier[] = [
  { id: 'basic', name: 'Basic', price: 299, description: 'Guided setup docs + 1 onboarding call' },
  { id: 'full', name: 'Full Setup', price: 499, description: 'We configure CRM, import contacts, build website' },
  { id: 'white-glove', name: 'White Glove', price: 699, description: 'Full setup + team training + 30-day hands-on support' },
]

// ═══════════════════════════════════════════════════════════════════
// ADD-ONS (monthly)
// ═══════════════════════════════════════════════════════════════════

export const ADDONS: Addon[] = [
  { id: 'ads-single', name: 'Ads Hub — 1 Platform', monthly: 99, description: 'Google OR Meta automated campaigns' },
  { id: 'ads-both', name: 'Ads Hub — Both Platforms', monthly: 199, description: 'Google AND Meta automated campaigns' },
  { id: 'vision-starter', name: 'Vision Starter', monthly: 29, description: '25 renders/mo', products: ['build'] },
  { id: 'vision-pro', name: 'Vision Pro', monthly: 59, description: '100 renders/mo', products: ['build'] },
]

// ═══════════════════════════════════════════════════════════════════
// PRODUCT METADATA
// ═══════════════════════════════════════════════════════════════════

export const PRODUCT_META: Record<ProductLine, { name: string; tagline: string; icon: string; color: string }> = {
  build: { name: 'Twomiah Build', tagline: 'Construction CRM', icon: '🏗️', color: '#f97316' },
  care: { name: 'Twomiah Care', tagline: 'Home Care Agency CRM', icon: '🏥', color: '#10b981' },
  wrench: { name: 'Twomiah Wrench', tagline: 'Field Service CRM', icon: '🔧', color: '#3b82f6' },
}

export const PLANS_BY_PRODUCT: Record<ProductLine, Plan[]> = {
  build: BUILD_PLANS,
  care: CARE_PLANS,
  wrench: WRENCH_PLANS,
}

// Map product line to products array and industry for FactoryConfig
export const PRODUCT_CONFIG_MAP: Record<ProductLine, { products: string[]; industry: string }> = {
  build: { products: ['website', 'crm'], industry: 'general_contractor' },
  care: { products: ['website', 'crm'], industry: 'home_care' },
  wrench: { products: ['website', 'crm'], industry: 'field_service' },
}

/** Get the tier index for a plan (0-based). Used to determine locked vs upgrade features. */
export function getPlanTierIndex(product: ProductLine, planId: string): number {
  return PLANS_BY_PRODUCT[product].findIndex(p => p.id === planId)
}

/** Get the minimum tier that includes a given feature. Returns -1 if not in any tier. */
export function getFeatureTier(product: ProductLine, featureId: string): number {
  const plans = PLANS_BY_PRODUCT[product]
  for (let i = 0; i < plans.length; i++) {
    if (plans[i].features.includes(featureId)) return i
  }
  return -1
}
