/**
 * Vertical Pricing — Central Source of Truth
 *
 * Maps each Twomiah vertical (Build, Wrench, Care, Roof) to:
 *   - Tier structure (names, prices, included website)
 *   - Stripe price ID keys to inject as env vars at tenant deploy time
 *   - Vertical-specific top-tier naming and hero features
 *
 * The Factory deploy pipeline reads this file when provisioning a new tenant
 * and writes the appropriate STRIPE_PRICE_* env vars into the tenant's .env
 * based on its vertical.
 *
 * Pricing philosophy:
 *   - Same price points across all verticals ($49/$149/$299/$599)
 *   - Different top-tier names and hero features per vertical
 *   - Annual = exactly 2 months free (monthly × 10)
 *   - Higher CRM tiers bundle a matching website tier:
 *       Starter  → no website (BYO or buy separately)
 *       Pro      → Showcase ($49 value)
 *       Business → Book Jobs ($99 value)
 *       Top tier → Book Jobs + vertical-specific extras
 *
 * See: create-stripe-products.ts for the actual Stripe product creation.
 * See: stripe-prices.ts for the generated price ID map.
 */

import STRIPE_PRICES from './stripe-prices'

export type WebsiteTierId = 'presence' | 'showcase' | 'book_jobs'
export type CrmTierId = 'starter' | 'pro' | 'business' | 'top' | 'enterprise'
export type VerticalId = 'build' | 'wrench' | 'care' | 'roof'

export interface WebsiteTier {
  id: WebsiteTierId
  name: string
  tagline: string
  priceMonthly: number // cents
  priceAnnual: number // cents (monthly × 10 = 2 months free)
  stripePriceKey: string
  stripePriceKeyAnnual: string
}

export interface VerticalCrmTier {
  id: CrmTierId
  /** Display name in this vertical (e.g. "Storm" for Roof's top tier) */
  displayName: string
  /** Generic internal name (e.g. "construction" — shared across verticals) */
  internalName: string
  tagline: string
  priceMonthly: number // cents
  priceAnnual: number // cents
  /** Which website tier is bundled with this CRM tier (null = no site included) */
  bundledWebsite: WebsiteTierId | null
  /** Vertical-specific hero features to highlight on the pricing page */
  heroFeatures: string[]
  stripePriceKey: string
  stripePriceKeyAnnual: string
  users: { included: number; max: number | null; additionalPriceMonthly?: number }
  highlight?: boolean
}

export interface VerticalPricing {
  id: VerticalId
  displayName: string
  websiteTiers: WebsiteTier[]
  crmTiers: VerticalCrmTier[]
}

// ═════════════════════════════════════════════════════════════════
// SHARED WEBSITE TIERS (identical across all verticals)
// ═════════════════════════════════════════════════════════════════

export const WEBSITE_TIERS: WebsiteTier[] = [
  {
    id: 'presence',
    name: 'Presence',
    tagline: 'Get found online',
    priceMonthly: 1900,
    priceAnnual: 19000,
    stripePriceKey: 'STRIPE_PRICE_WEBSITE_PRESENCE',
    stripePriceKeyAnnual: 'STRIPE_PRICE_WEBSITE_PRESENCE_ANNUAL',
  },
  {
    id: 'showcase',
    name: 'Showcase',
    tagline: 'Show off your work',
    priceMonthly: 4900,
    priceAnnual: 49000,
    stripePriceKey: 'STRIPE_PRICE_WEBSITE_SHOWCASE',
    stripePriceKeyAnnual: 'STRIPE_PRICE_WEBSITE_SHOWCASE_ANNUAL',
  },
  {
    id: 'book_jobs',
    name: 'Book Jobs',
    tagline: 'Turn visitors into booked jobs',
    priceMonthly: 9900,
    priceAnnual: 99000,
    stripePriceKey: 'STRIPE_PRICE_WEBSITE_BOOK_JOBS',
    stripePriceKeyAnnual: 'STRIPE_PRICE_WEBSITE_BOOK_JOBS_ANNUAL',
  },
]

// ═════════════════════════════════════════════════════════════════
// SHARED CRM PRICE POINTS
// ═════════════════════════════════════════════════════════════════

const CRM_BASE = {
  starter: {
    priceMonthly: 4900,
    priceAnnual: 49000,
    stripePriceKey: 'STRIPE_PRICE_STARTER',
    stripePriceKeyAnnual: 'STRIPE_PRICE_STARTER_ANNUAL',
    users: { included: 2, max: 2 },
    bundledWebsite: null,
  },
  pro: {
    priceMonthly: 14900,
    priceAnnual: 149000,
    stripePriceKey: 'STRIPE_PRICE_PRO',
    stripePriceKeyAnnual: 'STRIPE_PRICE_PRO_ANNUAL',
    users: { included: 5, max: 10, additionalPriceMonthly: 2900 },
    bundledWebsite: 'showcase' as WebsiteTierId,
  },
  business: {
    priceMonthly: 29900,
    priceAnnual: 299000,
    stripePriceKey: 'STRIPE_PRICE_BUSINESS',
    stripePriceKeyAnnual: 'STRIPE_PRICE_BUSINESS_ANNUAL',
    users: { included: 15, max: 25, additionalPriceMonthly: 2900 },
    bundledWebsite: 'book_jobs' as WebsiteTierId,
  },
  top: {
    priceMonthly: 59900,
    priceAnnual: 599000,
    stripePriceKey: 'STRIPE_PRICE_CONSTRUCTION',
    stripePriceKeyAnnual: 'STRIPE_PRICE_CONSTRUCTION_ANNUAL',
    users: { included: 20, max: 50, additionalPriceMonthly: 2900 },
    bundledWebsite: 'book_jobs' as WebsiteTierId,
  },
  enterprise: {
    priceMonthly: 19900, // per user
    priceAnnual: 199000, // per user
    stripePriceKey: 'STRIPE_PRICE_ENTERPRISE',
    stripePriceKeyAnnual: 'STRIPE_PRICE_ENTERPRISE_ANNUAL',
    users: { included: 0, max: null, additionalPriceMonthly: 19900 },
    bundledWebsite: 'book_jobs' as WebsiteTierId,
  },
}

// ═════════════════════════════════════════════════════════════════
// VERTICAL DEFINITIONS
// ═════════════════════════════════════════════════════════════════

export const VERTICALS: Record<VerticalId, VerticalPricing> = {
  build: {
    id: 'build',
    displayName: 'Twomiah Build',
    websiteTiers: WEBSITE_TIERS,
    crmTiers: [
      {
        id: 'starter',
        displayName: 'Starter',
        internalName: 'starter',
        tagline: 'Everything you need to run a contracting business',
        ...CRM_BASE.starter,
        heroFeatures: ['Contacts & jobs', 'Scheduling', 'Quotes & invoices', 'Payments', 'Customer portal'],
      },
      {
        id: 'pro',
        displayName: 'Pro',
        internalName: 'pro',
        tagline: 'Scale your crew — website included',
        ...CRM_BASE.pro,
        heroFeatures: ['Team management', 'Job costing', 'Pricebook', 'QuickBooks sync', 'Showcase website included'],
        highlight: true,
      },
      {
        id: 'business',
        displayName: 'Business',
        internalName: 'business',
        tagline: 'Run your entire operation',
        ...CRM_BASE.business,
        heroFeatures: ['Inventory', 'Change orders', 'Consumer financing', 'Advanced reporting', 'Book Jobs website included'],
      },
      {
        id: 'top',
        displayName: 'Construction',
        internalName: 'construction',
        tagline: 'Full construction management',
        ...CRM_BASE.top,
        heroFeatures: ['Projects, RFIs, submittals', 'Draw schedules & lien waivers', 'AIA G702/G703 forms', 'Takeoffs & selections', 'Portfolio website included'],
      },
      {
        id: 'enterprise',
        displayName: 'Enterprise',
        internalName: 'enterprise',
        tagline: 'Unlimited scale, white-label',
        ...CRM_BASE.enterprise,
        heroFeatures: ['Unlimited everything', 'White-label', 'SSO', 'API access', 'Dedicated support'],
      },
    ],
  },

  wrench: {
    id: 'wrench',
    displayName: 'Twomiah Wrench',
    websiteTiers: WEBSITE_TIERS,
    crmTiers: [
      {
        id: 'starter',
        displayName: 'Starter',
        internalName: 'starter',
        tagline: 'Everything you need for a field service business',
        ...CRM_BASE.starter,
        heroFeatures: ['Jobs & scheduling', 'Quotes & invoices', 'Payments', 'Customer portal', 'Mobile app'],
      },
      {
        id: 'pro',
        displayName: 'Pro',
        internalName: 'pro',
        tagline: 'GPS, routing, and a website — all included',
        ...CRM_BASE.pro,
        heroFeatures: ['GPS tracking & geofencing', 'Route optimization', 'Flat-rate pricebook', 'Service agreements', 'Showcase website included'],
        highlight: true,
      },
      {
        id: 'business',
        displayName: 'Business',
        internalName: 'business',
        tagline: 'Equipment, inventory, and fleet management',
        ...CRM_BASE.business,
        heroFeatures: ['Customer equipment tracking', 'Parts inventory', 'Fleet management', 'Maintenance contracts', 'Book Jobs website included'],
      },
      {
        id: 'top',
        displayName: 'Fleet',
        internalName: 'fleet',
        tagline: 'Multi-location dispatch at scale',
        ...CRM_BASE.top,
        heroFeatures: ['Multi-location dispatch', 'Advanced scheduling', 'Call tracking', 'Commission tracking', 'Service area pages on website'],
      },
      {
        id: 'enterprise',
        displayName: 'Enterprise',
        internalName: 'enterprise',
        tagline: 'Unlimited scale, white-label',
        ...CRM_BASE.enterprise,
        heroFeatures: ['Unlimited techs', 'White-label', 'SSO', 'API access', 'Dedicated support'],
      },
    ],
  },

  care: {
    id: 'care',
    displayName: 'Twomiah Care',
    websiteTiers: WEBSITE_TIERS,
    crmTiers: [
      {
        id: 'starter',
        displayName: 'Starter',
        internalName: 'starter',
        tagline: 'Client records, scheduling, and time tracking',
        ...CRM_BASE.starter,
        heroFeatures: ['Client & caregiver records', 'Visit scheduling', 'Time tracking', 'Basic invoicing', 'Caregiver mobile app'],
      },
      {
        id: 'pro',
        displayName: 'Pro',
        internalName: 'pro',
        tagline: 'Private-pay billing engine + website',
        ...CRM_BASE.pro,
        heroFeatures: ['Private-pay rate engine', 'Care type rates', 'Caregiver bio pages', 'Referral tracking', 'Showcase website included'],
        highlight: true,
      },
      {
        id: 'business',
        displayName: 'Business',
        internalName: 'business',
        tagline: 'Medicare & Medicaid claims',
        ...CRM_BASE.business,
        heroFeatures: ['Medicare / Medicaid billing', 'Referral source rates', 'Authorized units tracking', 'Claim generation', 'Book Jobs website included'],
      },
      {
        id: 'top',
        displayName: 'Agency',
        internalName: 'agency',
        tagline: 'Full agency operations platform',
        ...CRM_BASE.top,
        heroFeatures: ['Full claims processing', 'Check scanning & reconciliation', 'Multi-branch operations', 'HIPAA-grade audit logs', 'Caregiver portal website'],
      },
      {
        id: 'enterprise',
        displayName: 'Enterprise',
        internalName: 'enterprise',
        tagline: 'Unlimited scale, white-label',
        ...CRM_BASE.enterprise,
        heroFeatures: ['Unlimited caregivers', 'White-label', 'SSO', 'API access', 'Dedicated support'],
      },
    ],
  },

  roof: {
    id: 'roof',
    displayName: 'Twomiah Roof',
    websiteTiers: WEBSITE_TIERS,
    crmTiers: [
      {
        id: 'starter',
        displayName: 'Starter',
        internalName: 'starter',
        tagline: 'Leads, jobs, and invoicing',
        ...CRM_BASE.starter,
        heroFeatures: ['Lead intake', 'Job tracking', 'Quotes & invoices', 'Payments', 'Customer portal'],
      },
      {
        id: 'pro',
        displayName: 'Pro',
        internalName: 'pro',
        tagline: 'Good-Better-Best pricing + website',
        ...CRM_BASE.pro,
        heroFeatures: ['Good-Better-Best pricing', 'Pricebook', 'Measurement reports (3/mo)', 'Review requests', 'Showcase website included'],
        highlight: true,
      },
      {
        id: 'business',
        displayName: 'Business',
        internalName: 'business',
        tagline: 'Instant estimator + insurance workflow',
        ...CRM_BASE.business,
        heroFeatures: ['Instant estimator on website ($350–$550/sq)', '10 measurement reports/mo', 'Insurance workflow', 'Consumer financing', 'Book Jobs website included'],
      },
      {
        id: 'top',
        displayName: 'Storm',
        internalName: 'storm',
        tagline: 'Built for storm chasers and busy seasons',
        ...CRM_BASE.top,
        heroFeatures: ['Unlimited measurement reports', 'Storm lead generation', 'Full insurance workflow + supplements', 'Door-knock canvassing tool', 'Estimator + service area pages'],
      },
      {
        id: 'enterprise',
        displayName: 'Enterprise',
        internalName: 'enterprise',
        tagline: 'Unlimited scale, white-label',
        ...CRM_BASE.enterprise,
        heroFeatures: ['Unlimited crews', 'White-label', 'SSO', 'API access', 'Dedicated support'],
      },
    ],
  },
}

// ═════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════

/** Get the pricing definition for a vertical. */
export function getVerticalPricing(verticalId: VerticalId): VerticalPricing {
  return VERTICALS[verticalId]
}

/** Get the actual Stripe price ID for a vertical + tier + interval. */
export function getStripePriceId(
  verticalId: VerticalId,
  tierId: CrmTierId,
  interval: 'month' | 'year',
): string | undefined {
  const vertical = VERTICALS[verticalId]
  const tier = vertical.crmTiers.find((t) => t.id === tierId)
  if (!tier) return undefined
  const key = interval === 'year' ? tier.stripePriceKeyAnnual : tier.stripePriceKey
  return (STRIPE_PRICES as Record<string, string>)[key]
}

/** Get the actual Stripe price ID for a website tier. */
export function getWebsiteStripePriceId(
  tierId: WebsiteTierId,
  interval: 'month' | 'year',
): string | undefined {
  const tier = WEBSITE_TIERS.find((t) => t.id === tierId)
  if (!tier) return undefined
  const key = interval === 'year' ? tier.stripePriceKeyAnnual : tier.stripePriceKey
  return (STRIPE_PRICES as Record<string, string>)[key]
}

/**
 * Build the STRIPE_PRICE_* env var set to inject into a tenant deployment
 * for a given vertical. The deploy pipeline writes these into the tenant's
 * .env so the tenant's pricing.ts reads the correct IDs at runtime.
 */
export function getTenantEnvVars(verticalId: VerticalId): Record<string, string> {
  const vertical = VERTICALS[verticalId]
  const env: Record<string, string> = {}
  const prices = STRIPE_PRICES as Record<string, string>

  // CRM tier prices (monthly + annual)
  for (const tier of vertical.crmTiers) {
    if (prices[tier.stripePriceKey]) env[tier.stripePriceKey] = prices[tier.stripePriceKey]
    if (prices[tier.stripePriceKeyAnnual]) env[tier.stripePriceKeyAnnual] = prices[tier.stripePriceKeyAnnual]
  }

  // Website tier prices (monthly + annual) — same across all verticals
  for (const tier of WEBSITE_TIERS) {
    if (prices[tier.stripePriceKey]) env[tier.stripePriceKey] = prices[tier.stripePriceKey]
    if (prices[tier.stripePriceKeyAnnual]) env[tier.stripePriceKeyAnnual] = prices[tier.stripePriceKeyAnnual]
  }

  return env
}

/** Format cents as a USD display string. */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default VERTICALS
