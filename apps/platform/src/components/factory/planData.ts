// ═══════════════════════════════════════════════════════════════════
// Plan definitions for all Twomiah products
// ═══════════════════════════════════════════════════════════════════

export type ProductLine = 'build' | 'care' | 'wrench' | 'roof'

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

// Canonical 5-tier structure matching templates/crm/backend/src/config/pricing.ts
const BUILD_PLANS: Plan[] = [
  {
    id: 'build-starter',
    name: 'Starter',
    monthly: 49,
    annual: 39,
    features: ['contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'documents', 'time_tracking', 'expense_tracking', 'client_portal'],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead capture (1 page)',
  },
  {
    id: 'build-pro',
    name: 'Pro',
    monthly: 149,
    annual: 119,
    highlight: true,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'documents', 'time_tracking', 'expense_tracking', 'client_portal',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'quickbooks', 'recurring_jobs', 'job_costing',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Showcase (3–5 pages)',
  },
  {
    id: 'build-business',
    name: 'Business',
    monthly: 299,
    annual: 239,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'documents', 'time_tracking', 'expense_tracking', 'client_portal',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'quickbooks', 'recurring_jobs', 'job_costing',
      'inventory', 'equipment_tracking', 'fleet', 'warranties', 'change_orders',
      'email_marketing', 'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'reports',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Book Jobs (full site)',
  },
  {
    id: 'build-construction',
    name: 'Construction',
    monthly: 599,
    annual: 479,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'documents', 'time_tracking', 'expense_tracking', 'client_portal',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'quickbooks', 'recurring_jobs', 'job_costing',
      'inventory', 'equipment_tracking', 'fleet', 'warranties', 'change_orders',
      'email_marketing', 'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'reports',
      'projects', 'rfis', 'submittals', 'daily_logs', 'punch_lists', 'inspections',
      'bids', 'gantt_charts', 'selections', 'takeoffs', 'lien_waivers', 'draw_schedules', 'aia_forms',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'portfolio'],
    websiteDesc: 'Book Jobs + portfolio with project gallery',
  },
  {
    id: 'build-enterprise',
    name: 'Enterprise',
    monthly: 199, // per user
    annual: 159,
    features: ['all', 'api_access', 'white_label', 'custom_domain', 'sso', 'priority_support', 'dedicated_account_manager', 'custom_integrations', 'sla'],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'portfolio'],
    websiteDesc: 'White-label + custom domain',
  },
]

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH CARE — Home Care Agency CRM
// ═══════════════════════════════════════════════════════════════════

// Canonical 5-tier structure matching templates/crm-homecare/backend/src/config/pricing.ts
const CARE_PLANS: Plan[] = [
  {
    id: 'care-starter',
    name: 'Starter',
    monthly: 49,
    annual: 39,
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'basic_evv',
      'documents', 'basic_invoicing', 'caregiver_mobile_app', 'dashboard',
    ],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead capture + caregiver application',
  },
  {
    id: 'care-pro',
    name: 'Pro',
    monthly: 149,
    annual: 119,
    highlight: true,
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'basic_evv',
      'documents', 'basic_invoicing', 'caregiver_mobile_app', 'dashboard',
      'private_pay_billing', 'care_types', 'caregiver_bio_pages', 'referral_tracking',
      'two_way_texting', 'family_portal', 'caregiver_availability', 'open_shifts',
      'incidents', 'care_plans',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Showcase (3–5 pages)',
  },
  {
    id: 'care-business',
    name: 'Business',
    monthly: 299,
    annual: 239,
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'basic_evv',
      'documents', 'basic_invoicing', 'caregiver_mobile_app', 'dashboard',
      'private_pay_billing', 'care_types', 'caregiver_bio_pages', 'referral_tracking',
      'two_way_texting', 'family_portal', 'caregiver_availability', 'open_shifts',
      'incidents', 'care_plans',
      'medicare_billing', 'medicaid_billing', 'authorized_units', 'claim_generation',
      'edi_837', 'remittance_835', 'payroll', 'training_records', 'background_checks',
      'certifications', 'compliance_tracking', 'medications', 'adl_tracking', 'reports',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Book Jobs (full site)',
  },
  {
    id: 'care-agency',
    name: 'Agency',
    monthly: 599,
    annual: 479,
    features: [
      'clients', 'caregivers', 'scheduling', 'time_tracking', 'basic_evv',
      'documents', 'basic_invoicing', 'caregiver_mobile_app', 'dashboard',
      'private_pay_billing', 'care_types', 'caregiver_bio_pages', 'referral_tracking',
      'two_way_texting', 'family_portal', 'caregiver_availability', 'open_shifts',
      'incidents', 'care_plans',
      'medicare_billing', 'medicaid_billing', 'authorized_units', 'claim_generation',
      'edi_837', 'remittance_835', 'payroll', 'training_records', 'background_checks',
      'certifications', 'compliance_tracking', 'medications', 'adl_tracking', 'reports',
      'full_claims_processing', 'check_scanning', 'check_reconciliation', 'hipaa_audit_logs',
      'sandata_integration', 'caregiver_portal', 'route_optimizer', 'forecast',
      'ai_receptionist', 'gusto_integration', 'performance_reviews', 'no_show_tracking', 'pto_management',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'caregiver_pages'],
    websiteDesc: 'Book Jobs + caregiver portal website',
  },
  {
    id: 'care-enterprise',
    name: 'Enterprise',
    monthly: 199,
    annual: 159,
    features: ['all', 'api_access', 'white_label', 'custom_domain', 'sso', 'priority_support', 'dedicated_account_manager', 'custom_integrations', 'sla'],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'caregiver_pages'],
    websiteDesc: 'White-label + custom domain',
  },
]

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH WRENCH — Field Service CRM
// ═══════════════════════════════════════════════════════════════════

// Canonical 5-tier structure matching templates/crm-fieldservice/backend/src/config/pricing.ts
const WRENCH_PLANS: Plan[] = [
  {
    id: 'wrench-starter',
    name: 'Starter',
    monthly: 49,
    annual: 39,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard',
      'documents', 'time_tracking', 'customer_portal', 'tech_mobile_view',
    ],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead capture + booking widget',
  },
  {
    id: 'wrench-pro',
    name: 'Pro',
    monthly: 149,
    annual: 119,
    highlight: true,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard',
      'documents', 'time_tracking', 'customer_portal', 'tech_mobile_view',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'service_agreements',
      'recurring_jobs', 'quickbooks',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Showcase (3–5 pages) + real-time tech tracker',
  },
  {
    id: 'wrench-business',
    name: 'Business',
    monthly: 299,
    annual: 239,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard',
      'documents', 'time_tracking', 'customer_portal', 'tech_mobile_view',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'service_agreements',
      'recurring_jobs', 'quickbooks',
      'customer_equipment', 'parts_inventory', 'fleet', 'maintenance_contracts',
      'warranties', 'email_marketing', 'call_tracking', 'automations', 'reports',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Book Jobs (full site)',
  },
  {
    id: 'wrench-fleet',
    name: 'Fleet',
    monthly: 599,
    annual: 479,
    features: [
      'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard',
      'documents', 'time_tracking', 'customer_portal', 'tech_mobile_view',
      'team', 'two_way_texting', 'gps_tracking', 'geofencing', 'route_optimization',
      'online_booking', 'google_reviews', 'pricebook', 'service_agreements',
      'recurring_jobs', 'quickbooks',
      'customer_equipment', 'parts_inventory', 'fleet', 'maintenance_contracts',
      'warranties', 'email_marketing', 'call_tracking', 'automations', 'reports',
      'multi_location_dispatch', 'advanced_dispatch', 'call_recording',
      'commission_tracking', 'territory_management', 'revenue_by_location',
      'revenue_by_technician', 'service_area_pages',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'service_areas'],
    websiteDesc: 'Book Jobs + per-city service area pages',
  },
  {
    id: 'wrench-enterprise',
    name: 'Enterprise',
    monthly: 199,
    annual: 159,
    features: ['all', 'api_access', 'white_label', 'custom_domain', 'sso', 'priority_support', 'dedicated_account_manager', 'custom_integrations', 'sla'],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'service_areas'],
    websiteDesc: 'White-label + custom domain',
  },
]

// ═══════════════════════════════════════════════════════════════════
// TWOMIAH ROOF — Roofing CRM
// ═══════════════════════════════════════════════════════════════════

// Canonical 5-tier structure matching templates/crm-roof/backend/src/config/pricing.ts
const ROOF_PLANS: Plan[] = [
  {
    id: 'roof-starter',
    name: 'Starter',
    monthly: 49,
    annual: 39,
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'documents',
      'customer_portal', 'dashboard', 'mobile_app',
    ],
    websiteFeatures: ['contact_form'],
    websiteDesc: 'Lead capture (1 page)',
  },
  {
    id: 'roof-pro',
    name: 'Pro',
    monthly: 149,
    annual: 119,
    highlight: true,
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'documents',
      'customer_portal', 'dashboard', 'mobile_app',
      'good_better_best_pricing', 'pricebook', 'measurement_reports', 'google_reviews',
      'two_way_texting', 'photos', 'before_after_galleries', 'team', 'quickbooks_sync',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'testimonials'],
    websiteDesc: 'Showcase (3–5 pages)',
  },
  {
    id: 'roof-business',
    name: 'Business',
    monthly: 299,
    annual: 239,
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'documents',
      'customer_portal', 'dashboard', 'mobile_app',
      'good_better_best_pricing', 'pricebook', 'measurement_reports', 'google_reviews',
      'two_way_texting', 'photos', 'before_after_galleries', 'team', 'quickbooks_sync',
      'instant_estimator', 'insurance_workflow', 'insurance_claims', 'adjuster_directory',
      'consumer_financing', 'materials_management', 'crews', 'job_costing',
      'call_tracking', 'automations', 'email_campaigns', 'reports',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics'],
    websiteDesc: 'Book Jobs (full site)',
  },
  {
    id: 'roof-storm',
    name: 'Storm',
    monthly: 599,
    annual: 479,
    features: [
      'contacts', 'leads', 'jobs', 'quotes', 'invoices', 'documents',
      'customer_portal', 'dashboard', 'mobile_app',
      'good_better_best_pricing', 'pricebook', 'measurement_reports', 'google_reviews',
      'two_way_texting', 'photos', 'before_after_galleries', 'team', 'quickbooks_sync',
      'instant_estimator', 'insurance_workflow', 'insurance_claims', 'adjuster_directory',
      'consumer_financing', 'materials_management', 'crews', 'job_costing',
      'call_tracking', 'automations', 'email_campaigns', 'reports',
      'unlimited_measurement_reports', 'storm_lead_generation', 'storms_dashboard',
      'door_knock_canvassing', 'canvassing_routes', 'insurance_supplements',
      'depreciation_recovery', 'ai_receptionist', 'multi_crew_dispatch', 'service_area_pages',
    ],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'service_areas'],
    websiteDesc: 'Book Jobs + instant estimator + service area pages',
  },
  {
    id: 'roof-enterprise',
    name: 'Enterprise',
    monthly: 199,
    annual: 159,
    features: ['all', 'api_access', 'white_label', 'custom_domain', 'sso', 'priority_support', 'dedicated_account_manager', 'custom_integrations', 'sla'],
    websiteFeatures: ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'service_areas'],
    websiteDesc: 'White-label + custom domain',
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
  roof: { name: 'Twomiah Roof', tagline: 'Roofing CRM', icon: '🏠', color: '#dc2626' },
}

export const PLANS_BY_PRODUCT: Record<ProductLine, Plan[]> = {
  build: BUILD_PLANS,
  care: CARE_PLANS,
  wrench: WRENCH_PLANS,
  roof: ROOF_PLANS,
}

// Map product line to products array and industry for FactoryConfig
export const PRODUCT_CONFIG_MAP: Record<ProductLine, { products: string[]; industry: string }> = {
  build: { products: ['website', 'crm'], industry: 'general_contractor' },
  care: { products: ['website', 'crm'], industry: 'home_care' },
  wrench: { products: ['website', 'crm'], industry: 'field_service' },
  roof: { products: ['website', 'crm'], industry: 'roofing' },
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
