// The plans the public care sign-up page (/care/signup) offers, and what a pick turns into. Pricing is SEATS ONLY — every standard
// feature is included and the plans differ in how many people log in — so the catalog is packages/tenant-backend/src/plans.ts, the
// one place ids, names, prices and seats live. The page asks the Factory (/api/v1/factory/plans?product=crm-homecare, which sends
// the same seat plans); this is what it shows if that cannot be reached, and how an answer becomes the page's cards.
//
// The id on a card is the real plan id (starter10, team25, business50): it is what the sign-up posts and what the Factory maps to
// a Stripe price. (The page used to build its ids from the tier's name, and no tier id it sent had a price behind it.)
import { PLANS } from '../../../../packages/tenant-backend/src/plans'

export type PlanData = {
  id: string
  name: string
  price: number
  priceAnnual: number
  description: string
  users: number
  popular?: boolean
  features: string[]
}

export const SEAT_PLAN_IDS = ['starter10', 'team25', 'business50'] as const
export const DEFAULT_PLAN_ID = 'team25'

const SEAT_FEATURES = (seats: number) => [
  `Up to ${seats} users`,
  'Every standard feature included — nothing is locked behind a higher plan',
  'Your website, hosting and support',
]

export const FALLBACK_PLANS: Record<string, PlanData> = Object.fromEntries(SEAT_PLAN_IDS.map((id) => {
  const p = PLANS[id]
  return [id, {
    id, name: p.name, price: p.monthlyPrice, priceAnnual: p.monthlyPrice,
    description: `Up to ${p.seats} people logging in`, users: p.seats as number, popular: id === DEFAULT_PLAN_ID,
    features: SEAT_FEATURES(p.seats as number),
  }]
}))

/** The Factory's answer as the page's cards, keyed by the plan's own id. */
export function mapApiPlansToLocal(apiPlans: any[]): Record<string, PlanData> {
  const result: Record<string, PlanData> = {}
  for (const p of apiPlans) {
    const id = String(p.id)
    result[id] = {
      id,
      name: p.name,
      price: p.monthlyPrice,
      priceAnnual: p.annualPrice ?? p.monthlyPrice,
      description: p.description || (p.users?.max ? `Up to ${p.users.max} people logging in` : `${p.name} plan`),
      users: p.users?.included ?? p.users?.max ?? 5,
      popular: p.highlight === true,
      features: p.features || [],
    }
  }
  return result
}

/** Every plan has every home-care feature; the add-ons picked are extra. */
export const careFeatures = (selectedAddons: string[]) => [
  'scheduling', 'care_plans', 'caregiver_app', 'messaging',
  'evv_basic', 'billing', 'family_portal_basic', 'assessments',
  'multi_location', 'analytics', 'api_access', 'payroll_export',
  ...selectedAddons,
]

/** Annual billing is offered only if some plan is cheaper by the year; on the seat plans it is not, so no toggle and no "Save 20%". */
export const annualOffered = (plans: Record<string, PlanData>) => Object.values(plans).some((p) => p.priceAnnual < p.price)
