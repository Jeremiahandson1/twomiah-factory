/**
 * Factory Pricing Configuration
 *
 * Default pricing used to seed the factory_pricing table (per-product).
 * Once seeded, all pricing is managed from the Factory admin UI.
 * The /plans API reads from the database, not these defaults.
 */

export const PRODUCTS = [
  { id: 'crm', name: 'General Contractor CRM' },
  { id: 'crm-fieldservice', name: 'Field Service CRM' },
  { id: 'crm-roof', name: 'Roofing CRM' },
  { id: 'crm-homecare', name: 'Home Care CRM' },
] as const

export type ProductId = typeof PRODUCTS[number]['id']

export const DEFAULT_SAAS_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 2 }, features: ['Contacts / CRM', 'Jobs & Work Orders', 'Quotes & Invoicing', 'Payment Processing', 'Time & Expense Tracking', 'Documents', 'Customer Portal', 'Mobile App'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 5, max: 10, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Route Optimization', 'Online Booking', 'Review Requests', 'Pricebook', 'QuickBooks Sync', 'Job Costing Reports'] },
  { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 15, max: 25, additionalPrice: 29 }, features: ['Everything in Pro', 'Inventory Management', 'Fleet Management', 'Equipment Tracking', 'Email Campaigns', 'Call Tracking', 'Automations', 'Custom Forms', 'Consumer Financing', 'Advanced Reporting'] },
  { id: 'construction', name: 'Construction', monthlyPrice: 599, annualPrice: 479, users: { included: 20, max: 50, additionalPrice: 29 }, features: ['Everything in Business', 'Project Management', 'Change Orders', 'RFIs & Submittals', 'Daily Logs', 'Punch Lists & Inspections', 'Bid Management', 'Gantt Charts', 'Selections Portal', 'Takeoffs', 'Lien Waivers', 'Draw Schedules (AIA)'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
]

export const DEFAULT_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 997 },
  { id: 'pro', name: 'Pro License', price: 2497 },
  { id: 'business', name: 'Business License', price: 4997 },
  { id: 'construction', name: 'Construction License', price: 9997 },
  { id: 'full', name: 'Full Platform License', price: 14997 },
]

export const DEFAULT_SELF_HOSTED_ADDONS = [
  { id: 'installation', name: 'Installation Service', price: 500, type: 'one_time' },
  { id: 'updates_yearly', name: 'Update Subscription', price: 999, type: 'yearly' },
  { id: 'support_monthly', name: 'Support Contract', price: 199, type: 'monthly' },
  { id: 'white_label', name: 'White-Label Setup', price: 500, type: 'one_time' },
  { id: 'custom_dev', name: 'Custom Development', price: 150, type: 'per_hour' },
]

export const DEFAULT_DEPLOY_SERVICES = [
  { id: 'basic', name: 'Basic', price: 299, description: 'CRM + website setup, login credentials, live URL' },
  { id: 'full', name: 'Full Setup', price: 499, description: 'Basic + data import, integrations, 30-min walkthrough' },
  { id: 'white-glove', name: 'White Glove', price: 699, description: 'Full concierge: website content, data migration, team training, 30-day support' },
]

export const DEFAULT_FEATURE_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'AI-powered exterior design visualization for customers' },
  { id: 'instant_estimator', name: 'Instant Roof Estimator', price: 79, description: 'Google Solar-powered instant roof estimates with lead capture' },
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with customers' },
  { id: 'gps_field', name: 'GPS & Field', price: 49, description: 'Track techs, optimize routes' },
  { id: 'inventory', name: 'Inventory Management', price: 49, description: 'Track parts across locations' },
  { id: 'fleet', name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel' },
  { id: 'equipment', name: 'Equipment Tracking', price: 29, description: 'Customer equipment & maintenance' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { id: 'construction_pm', name: 'Construction PM', price: 149, description: 'Projects, change orders, RFIs, and more' },
  { id: 'compliance', name: 'Compliance & Draws', price: 79, description: 'Lien waivers, draw schedules, AIA forms' },
  { id: 'selections_takeoffs', name: 'Selections & Takeoffs', price: 49, description: 'Client selections, material takeoffs' },
  { id: 'service_contracts', name: 'Service Contracts', price: 39, description: 'Agreements, warranties' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom checklists and forms' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, financing' },
]

// ─── Per-Product Defaults ────────────────────────────────────────────────────
// Each product gets its own tailored tiers and relevant add-ons.

const CRM_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 2 }, features: ['Contacts / CRM', 'Jobs & Work Orders', 'Quotes & Invoicing', 'Payment Processing', 'Time & Expense Tracking', 'Documents', 'Customer Portal', 'Mobile App'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 5, max: 10, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Route Optimization', 'Online Booking', 'Review Requests', 'Pricebook', 'QuickBooks Sync', 'Job Costing Reports'] },
  { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 15, max: 25, additionalPrice: 29 }, features: ['Everything in Pro', 'Inventory Management', 'Fleet Management', 'Equipment Tracking', 'Email Campaigns', 'Call Tracking', 'Automations', 'Custom Forms', 'Consumer Financing', 'Advanced Reporting'] },
  { id: 'construction', name: 'Construction', monthlyPrice: 599, annualPrice: 479, users: { included: 20, max: 50, additionalPrice: 29 }, features: ['Everything in Business', 'Project Management', 'Change Orders', 'RFIs & Submittals', 'Daily Logs', 'Punch Lists & Inspections', 'Bid Management', 'Gantt Charts', 'Selections Portal', 'Takeoffs', 'Lien Waivers', 'Draw Schedules (AIA)'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
]

const FIELDSERVICE_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 2 }, features: ['Contacts / CRM', 'Jobs & Work Orders', 'Quotes & Invoicing', 'Payment Processing', 'Time & Expense Tracking', 'Documents', 'Customer Portal', 'Mobile App'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 5, max: 10, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Route Optimization', 'Dispatch Board', 'Online Booking', 'Review Requests', 'Pricebook', 'QuickBooks Sync'] },
  { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 15, max: 25, additionalPrice: 29 }, features: ['Everything in Pro', 'Inventory Management', 'Fleet Management', 'Equipment Tracking', 'Service Agreements', 'Recurring Jobs', 'Email Campaigns', 'Call Tracking', 'Automations', 'Custom Forms', 'Advanced Reporting'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
]

const ROOF_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 2 }, features: ['Contacts / CRM', 'Jobs & Work Orders', 'Quotes & Invoicing', 'Payment Processing', 'Measurement Reports', 'Documents', 'Customer Portal', 'Mobile App'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 5, max: 10, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Insurance Workflow', 'Storm Lead Gen', 'Canvassing Tool', 'Pricebook', 'QuickBooks Sync', 'Job Costing Reports'] },
  { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 15, max: 25, additionalPrice: 29 }, features: ['Everything in Pro', 'Instant Roof Estimator', 'Exterior Visualizer', 'Inventory Management', 'Fleet Management', 'Email Campaigns', 'Call Tracking', 'Automations', 'Custom Forms', 'Advanced Reporting'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
]

const HOMECARE_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 39, users: { included: 2, max: 5 }, features: ['Contacts / CRM', 'Client Profiles', 'Care Plans', 'Scheduling', 'Visit Tracking', 'Documents', 'Family Portal', 'Mobile App'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 149, annualPrice: 119, users: { included: 10, max: 25, additionalPrice: 19 }, highlight: true, features: ['Everything in Starter', 'Team Management', 'Two-Way SMS', 'GPS & Geofencing', 'Caregiver Matching', 'EVV (Electronic Visit Verification)', 'Medication Tracking', 'QuickBooks Sync', 'Reporting'] },
  { id: 'business', name: 'Business', monthlyPrice: 299, annualPrice: 239, users: { included: 25, max: 50, additionalPrice: 19 }, features: ['Everything in Pro', 'Multi-Location', 'Payroll Integration', 'Insurance Billing', 'Compliance Dashboard', 'Email Campaigns', 'Automations', 'Custom Forms', 'Advanced Reporting'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 199, annualPrice: 159, perUser: true, users: { min: 10, max: null }, features: ['Everything Included', 'Unlimited Users', 'API Access', 'White-Label Options', 'Custom Domain', 'SSO Integration', 'Priority Support', 'Dedicated Account Manager', 'Custom Integrations', 'SLA & Uptime Guarantee'] },
]

// Per-product add-on bundles — only show what's relevant to each industry
const CRM_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'AI-powered exterior design visualization for customers' },
  { id: 'instant_estimator', name: 'Instant Roof Estimator', price: 79, description: 'Google Solar-powered instant roof estimates with lead capture' },
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with customers' },
  { id: 'gps_field', name: 'GPS & Field', price: 49, description: 'Track techs, optimize routes' },
  { id: 'inventory', name: 'Inventory Management', price: 49, description: 'Track parts across locations' },
  { id: 'fleet', name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel' },
  { id: 'equipment', name: 'Equipment Tracking', price: 29, description: 'Customer equipment & maintenance' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { id: 'construction_pm', name: 'Construction PM', price: 149, description: 'Projects, change orders, RFIs, and more' },
  { id: 'compliance', name: 'Compliance & Draws', price: 79, description: 'Lien waivers, draw schedules, AIA forms' },
  { id: 'selections_takeoffs', name: 'Selections & Takeoffs', price: 49, description: 'Client selections, material takeoffs' },
  { id: 'service_contracts', name: 'Service Contracts', price: 39, description: 'Agreements, warranties' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom checklists and forms' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, financing' },
]

const FIELDSERVICE_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with customers' },
  { id: 'gps_field', name: 'GPS & Field', price: 49, description: 'Track techs, optimize routes' },
  { id: 'inventory', name: 'Inventory Management', price: 49, description: 'Track parts across locations' },
  { id: 'fleet', name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel' },
  { id: 'equipment', name: 'Equipment Tracking', price: 29, description: 'Customer equipment & maintenance' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { id: 'service_contracts', name: 'Service Contracts', price: 39, description: 'Agreements, warranties, recurring maintenance' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom checklists and forms' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, financing' },
]

const ROOF_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'AI-powered exterior design visualization for customers' },
  { id: 'instant_estimator', name: 'Instant Roof Estimator', price: 79, description: 'Google Solar-powered instant roof estimates with lead capture' },
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with customers' },
  { id: 'gps_field', name: 'GPS & Field', price: 49, description: 'Track techs, optimize routes' },
  { id: 'inventory', name: 'Inventory Management', price: 49, description: 'Track parts across locations' },
  { id: 'fleet', name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom checklists and forms' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, financing' },
]

const HOMECARE_BUNDLES = [
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with clients and families' },
  { id: 'gps_field', name: 'GPS & Visit Tracking', price: 49, description: 'Track caregivers, verify visits' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, referral tracking' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom assessments and checklists' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, payroll, insurance billing' },
]

// Self-hosted licenses per product
const CRM_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 997 },
  { id: 'pro', name: 'Pro License', price: 2497 },
  { id: 'business', name: 'Business License', price: 4997 },
  { id: 'construction', name: 'Construction License', price: 9997 },
  { id: 'full', name: 'Full Platform License', price: 14997 },
]

const FIELDSERVICE_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 997 },
  { id: 'pro', name: 'Pro License', price: 2497 },
  { id: 'business', name: 'Business License', price: 4997 },
]

const ROOF_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 997 },
  { id: 'pro', name: 'Pro License', price: 2497 },
  { id: 'business', name: 'Business License', price: 4997 },
]

const HOMECARE_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 997 },
  { id: 'pro', name: 'Pro License', price: 2497 },
  { id: 'business', name: 'Business License', price: 4997 },
]

// Full per-product defaults map
export function getProductDefaults(product: string) {
  switch (product) {
    case 'crm':
      return {
        saas_tiers: CRM_TIERS,
        self_hosted: CRM_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: CRM_BUNDLES,
      }
    case 'crm-fieldservice':
      return {
        saas_tiers: FIELDSERVICE_TIERS,
        self_hosted: FIELDSERVICE_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: FIELDSERVICE_BUNDLES,
      }
    case 'crm-roof':
      return {
        saas_tiers: ROOF_TIERS,
        self_hosted: ROOF_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: ROOF_BUNDLES,
      }
    case 'crm-homecare':
      return {
        saas_tiers: HOMECARE_TIERS,
        self_hosted: HOMECARE_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: HOMECARE_BUNDLES,
      }
    default:
      return {
        saas_tiers: DEFAULT_SAAS_TIERS,
        self_hosted: DEFAULT_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: DEFAULT_FEATURE_BUNDLES,
      }
  }
}
