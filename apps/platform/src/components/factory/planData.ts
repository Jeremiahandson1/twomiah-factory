// ═══════════════════════════════════════════════════════════════════
// Plan definitions for all Twomiah products
// ═══════════════════════════════════════════════════════════════════

export type ProductLine = 'build' | 'care' | 'wrench' | 'roof' | 'landscaping'

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
// THE PLANS — seats only
// ═══════════════════════════════════════════════════════════════════
//
// Pricing is SEATS ONLY: every standard feature is included and the plans differ in how many people log in. The catalog (ids,
// names, list prices, seats) is packages/tenant-backend/src/plans.ts — the one place — and every product line offers those
// three plans. (This file held five feature-tier ladders per product, with prices that no Stripe price stood behind.)
//
// `features` is empty on purpose: a plan locks nothing and upgrades nothing. A sign-up that names no features starts with its
// industry's whole ready CRM (the Factory's intake: startingFeaturesFor), and the website is the full site.
import { PLANS } from '../../../../../packages/tenant-backend/src/plans'

const SEAT_PLAN_IDS = ['starter10', 'team25', 'business50'] as const
const FULL_SITE = ['contact_form', 'services_pages', 'gallery', 'blog', 'testimonials', 'analytics', 'service_areas']

/** Annual billing is not offered on the seat plans (the Factory's annual slot is the monthly price), so annual equals monthly. */
export const SEAT_PLANS: Plan[] = SEAT_PLAN_IDS.map((id) => {
  const p = PLANS[id]
  return {
    id, name: p.name, monthly: p.monthlyPrice, annual: p.monthlyPrice,
    features: [], websiteFeatures: FULL_SITE, websiteDesc: `Up to ${p.seats} people logging in`,
    ...(id === 'team25' ? { highlight: true } : {}),
  }
})

// ═══════════════════════════════════════════════════════════════════
// SETUP TIERS (one-time, same for all products)
// ═══════════════════════════════════════════════════════════════════

// The owner's offer (10/27): the one paid custom service is the $499 one-time custom build; support is free. The $299 / $699
// set-up tiers were the retired pricing (10/30). Same list as apps/api/src/config/pricing.ts DEFAULT_DEPLOY_SERVICES.
export const SETUP_TIERS: SetupTier[] = [
  { id: 'none', name: 'No custom build', price: 0, description: 'Set up from the signup answers; support is free' },
  { id: 'custom_build', name: 'Custom build', price: 499, description: 'One time: we tailor the website and set-up to the business' },
]

// ═══════════════════════════════════════════════════════════════════
// ADD-ONS (monthly)
// ═══════════════════════════════════════════════════════════════════

// The paid add-ons (apps/api/src/config/pricing.ts offeredAddons): every standard feature is in every plan. The Ads Hub is not
// ready and is not sold; the Visualizer is one $59 add-on, contractor and roofing only (10/30).
export const ADDONS: Addon[] = [
  { id: 'texting', name: 'Texting', monthly: 10, description: 'Two-way texting with the business’s own number (plus messages sent)' },
  { id: 'ai', name: 'AI features', monthly: 10, description: 'The AI assistant and writing tools (plus what they use)' },
  { id: 'exterior_visualizer', name: 'Exterior Visualizer', monthly: 59, description: 'Homes shown in new siding, roofing or paint colours', products: ['build', 'roof'] },
]

// ═══════════════════════════════════════════════════════════════════
// PRODUCT METADATA
// ═══════════════════════════════════════════════════════════════════

export const PRODUCT_META: Record<ProductLine, { name: string; tagline: string; icon: string; color: string }> = {
  build: { name: 'Twomiah Build', tagline: 'Construction CRM', icon: '🏗️', color: '#f97316' },
  care: { name: 'Twomiah Care', tagline: 'Home Care Agency CRM', icon: '🏡', color: '#10b981' },
  wrench: { name: 'Twomiah Wrench', tagline: 'Field Service CRM', icon: '🔧', color: '#3b82f6' },
  roof: { name: 'Twomiah Roof', tagline: 'Roofing CRM', icon: '🏠', color: '#dc2626' },
  landscaping: { name: 'Twomiah Landscaping', tagline: 'Lawn & Landscape CRM', icon: '🌳', color: '#22c55e' },
}

export const PLANS_BY_PRODUCT: Record<ProductLine, Plan[]> = {
  build: SEAT_PLANS,
  care: SEAT_PLANS,
  wrench: SEAT_PLANS,
  roof: SEAT_PLANS,
  landscaping: SEAT_PLANS,
}

// Map product line to products array and industry for FactoryConfig
export const PRODUCT_CONFIG_MAP: Record<ProductLine, { products: string[]; industry: string }> = {
  build: { products: ['website', 'crm'], industry: 'general_contractor' },
  care: { products: ['website', 'crm'], industry: 'home_care' },
  wrench: { products: ['website', 'crm'], industry: 'field_service' },
  roof: { products: ['website', 'crm'], industry: 'roofing' },
  landscaping: { products: ['website', 'crm'], industry: 'landscaping' },
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
