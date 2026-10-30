/**
 * Factory Pricing Configuration
 *
 * Default pricing used to seed the factory_pricing table (per-product).
 * Once seeded, all pricing is managed from the Factory admin UI.
 * The /plans API reads from the database, not these defaults.
 */

import { PLANS } from './planSeats'

const SEAT_PLAN_IDS = ['starter10', 'team25', 'business50'] as const

export const PRODUCTS = [
  { id: 'crm', name: 'General Contractor CRM' },
  { id: 'crm-fieldservice', name: 'Field Service CRM' },
  { id: 'crm-roof', name: 'Roofing CRM' },
  { id: 'crm-homecare', name: 'Home Care CRM' },
  { id: 'crm-dispensary', name: 'Dispensary CRM (Leaf)' },
] as const

export type ProductId = typeof PRODUCTS[number]['id']

/**
 * PRICING IS SEATS ONLY: every feature is included, and the plans differ in how many people log in. The catalog (ids, names, list
 * prices, seats) is packages/tenant-backend/src/plans.ts — the ONE place; this file, the public /plans list, the sign-up pages
 * and the Factory wizard all read it. These are what a NEW sign-up is offered. What an existing customer pays is their Stripe
 * subscription, which nothing here touches.
 *
 * Annual billing is not offered on the seat plans yet (factoryStripe.ts points the annual slot at the monthly price), so the
 * annual figure equals the monthly one and nothing is promised as a discount.
 */
export function seatPlanTiers() {
  return SEAT_PLAN_IDS.map((id) => {
    const p = PLANS[id]
    return {
      id: p.id, name: p.name, monthlyPrice: p.monthlyPrice, annualPrice: p.monthlyPrice,
      users: { included: p.seats as number, max: p.seats as number },
      ...(id === 'team25' ? { highlight: true } : {}),
      features: [`Up to ${p.seats} users`, 'Every standard feature included — nothing is locked behind a higher plan', 'Your website, hosting and support', 'Optional add-ons (like texting or the Exterior Visualizer) are extra'],
    }
  })
}

/** The own-it licence for each seat plan: 36 months of the monthly price, as create-stripe-products.ts mints it. */
export function seatPlanLicenses() {
  return SEAT_PLAN_IDS.map((id) => ({ id, name: `${PLANS[id].name} License`, price: PLANS[id].monthlyPrice * 36 }))
}

export const DEFAULT_SAAS_TIERS = seatPlanTiers()

export const DEFAULT_SELF_HOSTED = seatPlanLicenses()

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
  // exterior_visualizer AND instant_estimator intentionally NOT in the fallback bundle — both are
  // offered only via CRM_BUNDLES (contractor) and ROOF_BUNDLES (roofer), so no other product surfaces them.
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
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks' },
]

// ─── Per-Product Defaults ────────────────────────────────────────────────────
// Each product gets its own tailored tiers and relevant add-ons.

// Per-product add-on bundles — only show what's relevant to each industry
const CRM_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'AI-powered exterior design visualization for customers' },
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
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks' },
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
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks' },
]

const ROOF_BUNDLES = [
  { id: 'pricebook', name: 'Pricebook', price: 49, description: 'Flat-rate pricing, good/better/best proposals' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'AI-powered exterior design visualization for customers' },
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with customers' },
  { id: 'gps_field', name: 'GPS & Field', price: 49, description: 'Track techs, optimize routes' },
  { id: 'inventory', name: 'Inventory Management', price: 49, description: 'Track parts across locations' },
  { id: 'fleet', name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom checklists and forms' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks' },
]

const HOMECARE_BUNDLES = [
  { id: 'sms', name: 'SMS Communication', price: 39, description: 'Two-way texting with clients and families' },
  { id: 'gps_field', name: 'GPS & Visit Tracking', price: 49, description: 'Track caregivers, verify visits' },
  { id: 'marketing', name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, referral tracking' },
  { id: 'forms', name: 'Custom Forms', price: 29, description: 'Build custom assessments and checklists' },
  { id: 'integrations', name: 'Integrations', price: 49, description: 'QuickBooks, payroll, insurance billing' },
]

// Dispensary (Leaf) tiers
const DISPENSARY_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 299, annualPrice: 239, users: { included: 5, max: 10, additionalPrice: 29 }, features: ['POS System', 'Inventory Management', 'Cash Sessions + Reconciliation', 'ID Scanning + Verification', 'Customer Check-In Queue', 'Purchase Limit Enforcement', 'Product Equivalency Calculator', 'Tip Management', 'EOD Reconciliation Reports', 'QR Code Scanning', 'Offline POS Mode', 'Team Management', 'Compliance Basics', 'Audit Trail'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 499, annualPrice: 399, users: { included: 15, max: 25, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Metrc / BioTrack / Leaf Data', 'Delivery + GPS Driver Tracking', 'Loyalty Program (4 Tiers + Referrals)', 'Label Printing + QR Codes', 'SMS + Email Marketing', 'Analytics Dashboard', 'Employee Scheduling + Payroll Export', 'Budtender Training LMS', 'Online Ordering + Website', 'SEO Product Pages', 'Marketplace Menu Sync', 'Batch/Lot Tracking', 'Grow Input Tracking', 'Approval Workflows', 'Purchase Orders'] },
  { id: 'business', name: 'Business', monthlyPrice: 799, annualPrice: 639, users: { included: 30, max: 50, additionalPrice: 29 }, features: ['Everything in Pro', 'Multi-Location (Up to 10)', 'AI Budtender (Claude-Powered)', 'Self-Service Kiosk', 'RFID Inventory Scanning', 'BI Dashboard + Custom Reports', 'Predictive Inventory + Auto-Reorder', 'Gamified Loyalty (Challenges + Streaks)', 'Digital Signage', 'Curbside Pickup', 'Pay by Bank (Plaid ACH)', 'Apple/Google Wallet Passes', 'Fraud + Theft Detection', 'SOC 2 Security Controls', 'API Access'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 1299, annualPrice: 1039, users: { included: 100, max: null }, features: ['Everything in Business', 'Cultivation / Grow Tracking', 'Manufacturing / Processing', 'Wholesale / Distribution', 'Lab Testing + CoA', 'Franchise Management', 'Open API + Marketplace', 'Dedicated Success Manager', 'Unlimited Locations', 'Consumer Mobile App', 'White-Label Option'] },
]

const DISPENSARY_BUNDLES: typeof DEFAULT_FEATURE_BUNDLES = []  // All-inclusive, no add-ons

const DISPENSARY_SELF_HOSTED = [
  { id: 'starter', name: 'Starter License', price: 10764 },
  { id: 'pro', name: 'Pro License', price: 17964 },
  { id: 'business', name: 'Business License', price: 28764 },
  { id: 'enterprise', name: 'Enterprise License', price: 46764 },
]

// Full per-product defaults map
export function getProductDefaults(product: string) {
  switch (product) {
    case 'crm':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: CRM_BUNDLES,
      }
    case 'crm-fieldservice':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: FIELDSERVICE_BUNDLES,
      }
    case 'crm-roof':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: ROOF_BUNDLES,
      }
    case 'crm-homecare':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: HOMECARE_BUNDLES,
      }
    case 'crm-dispensary':
      return {
        saas_tiers: DISPENSARY_TIERS,
        self_hosted: DISPENSARY_SELF_HOSTED,
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: DISPENSARY_BUNDLES,
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

/**
 * The products whose public plan list is the seat plans. The home care, field service, roofing and general-contractor CRMs
 * (and the default) are; the dispensary (Leaf) keeps its own tiers until the owner decides otherwise — it has no seat-plan
 * Stripe price to send a new sign-up to.
 */
export const SEAT_PLAN_PRODUCTS: ReadonlySet<string> = new Set(['crm', 'crm-fieldservice', 'crm-roof', 'crm-homecare'])
export const usesSeatPlans = (product: string) => SEAT_PLAN_PRODUCTS.has(product) || !PRODUCTS.some((p) => p.id === product)

/**
 * What the public /plans list sends for a product: the seat plans, whatever the stored factory_pricing row says (it was seeded
 * with the old feature tiers and the admin page can still edit it). Everything else on the row (add-ons, set-up services)
 * is passed through as stored.
 */
export function publicPlans(product: string, stored: { saas_tiers?: unknown; self_hosted?: unknown } | null | undefined) {
  if (usesSeatPlans(product)) return { plans: seatPlanTiers(), selfHosted: seatPlanLicenses() }
  return { plans: stored?.saas_tiers ?? getProductDefaults(product).saas_tiers, selfHosted: stored?.self_hosted ?? getProductDefaults(product).self_hosted }
}
