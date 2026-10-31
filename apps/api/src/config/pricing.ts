/**
 * Factory Pricing Configuration
 *
 * Default pricing used to seed the factory_pricing table (per-product).
 * Once seeded, all pricing is managed from the Factory admin UI.
 * The /plans API reads from the database, not these defaults.
 */

import { PLANS } from './planSeats'
import { MESSAGING_ENABLE_MONTHLY_CENTS, AI_ENABLE_MONTHLY_CENTS } from './messagingCosts'

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

/**
 * THE OFFER (owner, 10/27 and pricing v2) — what the Factory sells beyond a plan, in one place. Every standard feature is in every
 * plan, so no feature is sold as an add-on; the paid add-ons are the three with a price of their own, each billed where it is
 * switched on (texting and AI from Settings › Billing — factoryStripe messaging_enable / ai_enable; the Visualizer, contractor
 * and roofing only). The one paid custom service is the $499 one-time custom build. Support is free: no support contract and no
 * hourly custom development (both retired 10/27). The set-up tiers ($299 / $499 / $699) and the per-feature "bundles" were the
 * retired pricing and are gone (10/30).
 */
export const DEFAULT_SELF_HOSTED_ADDONS = [
  { id: 'installation', name: 'Installation Service', price: 500, type: 'one_time' },
  { id: 'updates_yearly', name: 'Update Subscription', price: 999, type: 'yearly' },
  { id: 'white_label', name: 'White-Label Setup', price: 500, type: 'one_time' },
]

export const DEFAULT_DEPLOY_SERVICES = [
  { id: 'custom_build', name: 'Custom build', price: 499, description: 'One time: we tailor your website and set-up to your business' },
]

/** The paid add-ons a product's customers can buy (monthly, in dollars). */
export function offeredAddons(product: string) {
  return [
    { id: 'texting', name: 'Texting', price: MESSAGING_ENABLE_MONTHLY_CENTS / 100, description: 'Two-way texting with your own business number (plus the messages you send)' },
    { id: 'ai', name: 'AI features', price: AI_ENABLE_MONTHLY_CENTS / 100, description: 'The AI assistant and AI writing tools (plus what they use)' },
    ...(product === 'crm' || product === 'crm-roof'
      ? [{ id: 'exterior_visualizer', name: 'Exterior Visualizer', price: 59, description: 'Show customers their home in new siding, roofing or paint colours' }]
      : []),
  ]
}

/** @deprecated name kept for callers: the add-ons of a product with no product of its own. */
export const DEFAULT_FEATURE_BUNDLES = offeredAddons('')

// ─── Per-Product Defaults ────────────────────────────────────────────────────

// Dispensary (Leaf) tiers
const DISPENSARY_TIERS = [
  { id: 'starter', name: 'Starter', monthlyPrice: 299, annualPrice: 239, users: { included: 5, max: 10, additionalPrice: 29 }, features: ['POS System', 'Inventory Management', 'Cash Sessions + Reconciliation', 'ID Scanning + Verification', 'Customer Check-In Queue', 'Purchase Limit Enforcement', 'Product Equivalency Calculator', 'Tip Management', 'EOD Reconciliation Reports', 'QR Code Scanning', 'Offline POS Mode', 'Team Management', 'Compliance Basics', 'Audit Trail'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 499, annualPrice: 399, users: { included: 15, max: 25, additionalPrice: 29 }, highlight: true, features: ['Everything in Starter', 'Metrc / BioTrack / Leaf Data', 'Delivery + GPS Driver Tracking', 'Loyalty Program (4 Tiers + Referrals)', 'Label Printing + QR Codes', 'SMS + Email Marketing', 'Analytics Dashboard', 'Employee Scheduling + Payroll Export', 'Budtender Training LMS', 'Online Ordering + Website', 'SEO Product Pages', 'Marketplace Menu Sync', 'Batch/Lot Tracking', 'Grow Input Tracking', 'Approval Workflows', 'Purchase Orders'] },
  { id: 'business', name: 'Business', monthlyPrice: 799, annualPrice: 639, users: { included: 30, max: 50, additionalPrice: 29 }, features: ['Everything in Pro', 'Multi-Location (Up to 10)', 'AI Budtender (Claude-Powered)', 'Self-Service Kiosk', 'RFID Inventory Scanning', 'BI Dashboard + Custom Reports', 'Predictive Inventory + Auto-Reorder', 'Gamified Loyalty (Challenges + Streaks)', 'Digital Signage', 'Curbside Pickup', 'Pay by Bank (Plaid ACH)', 'Apple/Google Wallet Passes', 'Fraud + Theft Detection', 'SOC 2 Security Controls', 'API Access'] },
  { id: 'enterprise', name: 'Enterprise', monthlyPrice: 1299, annualPrice: 1039, users: { included: 100, max: null }, features: ['Everything in Business', 'Cultivation / Grow Tracking', 'Manufacturing / Processing', 'Wholesale / Distribution', 'Lab Testing + CoA', 'Franchise Management', 'Open API + Marketplace', 'Dedicated Success Manager', 'Unlimited Locations', 'Consumer Mobile App', 'White-Label Option'] },
]

const DISPENSARY_BUNDLES: ReturnType<typeof offeredAddons> = []  // All-inclusive, no add-ons

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
        feature_bundles: offeredAddons('crm'),
      }
    case 'crm-fieldservice':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: offeredAddons('crm-fieldservice'),
      }
    case 'crm-roof':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: offeredAddons('crm-roof'),
      }
    case 'crm-homecare':
      return {
        saas_tiers: seatPlanTiers(),
        self_hosted: seatPlanLicenses(),
        self_hosted_addons: DEFAULT_SELF_HOSTED_ADDONS,
        deploy_services: DEFAULT_DEPLOY_SERVICES,
        feature_bundles: offeredAddons('crm-homecare'),
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
export function publicPlans(product: string, stored: { saas_tiers?: unknown; self_hosted?: unknown; self_hosted_addons?: unknown; deploy_services?: unknown; feature_bundles?: unknown } | null | undefined) {
  // A seat product's whole offer is code (the plans, the add-ons, the custom build): the stored row still holds the retired
  // tiers, set-up tiers and per-feature bundles (10/30). Another product (the dispensary) keeps what its row says.
  if (usesSeatPlans(product)) {
    const d = getProductDefaults(product)
    return { plans: seatPlanTiers(), selfHosted: seatPlanLicenses(), selfHostedAddons: d.self_hosted_addons, deployServices: d.deploy_services, addons: d.feature_bundles }
  }
  const d = getProductDefaults(product)
  return {
    plans: stored?.saas_tiers ?? d.saas_tiers, selfHosted: stored?.self_hosted ?? d.self_hosted,
    selfHostedAddons: stored?.self_hosted_addons ?? d.self_hosted_addons, deployServices: stored?.deploy_services ?? d.deploy_services, addons: stored?.feature_bundles ?? d.feature_bundles,
  }
}

/** Where the seat plans are set. The admin Pricing page shows this next to the read-only plans. */
export const SEAT_PLANS_SET_IN = 'packages/tenant-backend/src/plans.ts'

/**
 * One factory_pricing row as the admin Pricing page sees it. A seat product's plans (and its self-hosted licences, which are
 * 36× the monthly) come from plans.ts, never from the stored row — the row still holds the old feature tiers and nothing reads
 * them — and are marked read-only with where they are set. Everything else on the row (add-ons, set-up services) is as stored.
 * Another product's row is returned as it is.
 */
export function adminPricingRow<T extends { product: string }>(row: T) {
  if (!usesSeatPlans(row.product)) return row
  const d = getProductDefaults(row.product)
  return { ...row, saas_tiers: seatPlanTiers(), self_hosted: seatPlanLicenses(), self_hosted_addons: d.self_hosted_addons, deploy_services: d.deploy_services, feature_bundles: d.feature_bundles, seat_plans_read_only: true, seat_plans_set_in: SEAT_PLANS_SET_IN }
}

/**
 * The columns an admin save may write for a product. A seat product's plans and licences are not the admin page's to change
 * (they are set in plans.ts), so a save never writes them — whatever the page, or an old copy of it, sent.
 */
export function adminPricingWrite(product: string, body: Record<string, unknown>) {
  const all = {
    saas_tiers: body.saas_tiers,
    self_hosted: body.self_hosted,
    self_hosted_addons: body.self_hosted_addons,
    deploy_services: body.deploy_services,
    feature_bundles: body.feature_bundles,
  }
  // A seat product's offer is code (plans.ts and the offer above): nothing on its row is the admin page's to change.
  if (!usesSeatPlans(product)) return all
  return {}
}
