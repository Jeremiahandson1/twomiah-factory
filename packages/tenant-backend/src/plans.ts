// The plan catalog — the ONE place plan ids, names, list prices and seat counts are defined.
//
// Consumed by the Factory (apps/api re-exports it: checkout, seat limits, the subscription summary it
// sends to tenants) and vendored into every tenant (backend/src/shared/plans.ts) so Settings → Billing
// shows the same names and prices the Factory bills. Live amounts still come from Stripe through the
// Factory (tenants.monthly_amount); `monthlyPrice` here is the list price used when Stripe has not
// reported one yet.
//
// v2 rail (2026-07): the website is $49/mo with no build fee; the CRM is seat-tiered. Legacy v1 tier
// names (starter / pro / business / construction / fleet / storm) still exist on old tenant rows and
// resolve to `null` here on purpose — see seatsForPlan().
export type PlanDef = {
  id: string
  name: string
  product: 'crm' | 'website'
  monthlyPrice: number
  /** CRM logins included; null = not a seated product. */
  seats: number | null
}

export const PLANS: Record<string, PlanDef> = {
  website:    { id: 'website',    name: 'Website',  product: 'website', monthlyPrice: 49,  seats: null },
  starter10:  { id: 'starter10',  name: 'Starter',  product: 'crm',     monthlyPrice: 99,  seats: 10 },
  team25:     { id: 'team25',     name: 'Team',     product: 'crm',     monthlyPrice: 139, seats: 25 },
  business50: { id: 'business50', name: 'Business', product: 'crm',     monthlyPrice: 199, seats: 50 },
}

export function planFor(planId: string | null | undefined): PlanDef | null {
  if (!planId) return null
  return PLANS[planId] ?? null
}

/**
 * Seats for a plan id, or null when we have no trustworthy number.
 *
 * ONLY v2 plan ids map to a number, on purpose. The legacy v1 ladder was much tighter (starter = 2,
 * pro = 5, business = 15); mapping those here would hand an existing customer a sudden 2-seat cap on
 * their next redeploy. An unmapped plan emits no SEAT_LIMIT and the CRM enforces no cap — a missed cap
 * is recoverable; wrongly refusing a paying customer's teammate is not.
 */
export function seatsForPlan(planId: string | null | undefined): number | null {
  return planFor(planId)?.seats ?? null
}

/** What the Factory tells a tenant about its subscription — mirrored into company.settings there. */
export type TenantSubscription = {
  plan: string | null
  planName: string | null
  product: 'crm' | 'website' | null
  monthlyAmount: number | null
  billingCycle: 'monthly' | 'annual' | 'yearly' | string | null
  billingType: 'subscription' | 'one_time' | string | null
  /** The state the tenant's trial gate reads: active | trialing | past_due | canceled */
  status: 'active' | 'trialing' | 'past_due' | 'canceled'
  billingStatus: string | null
  nextBillingDate: string | null
  trialEndsAt: string | null
  seats: number | null
  hasStripeCustomer: boolean
  syncedAt: string
}
