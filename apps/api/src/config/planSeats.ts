/**
 * How many CRM logins each plan includes — the seat ladder the pricing page
 * sells (twomiah.com: "$99 up to 10 users; scales to $139 (25) / $199 (50)").
 *
 * Deploy writes the matching number into the tenant backend's SEAT_LIMIT env
 * var, and the CRM's create-user route refuses to exceed it.
 *
 * ONLY the v2 plan ids appear here, on purpose. The legacy v1 ladder in the
 * templates' shared/plans.ts is much tighter (starter = 2, pro = 5,
 * business = 15); mapping those here would hand an existing customer a sudden
 * 2-seat cap on their next redeploy. An unmapped plan emits no SEAT_LIMIT, and
 * the CRM then enforces no cap — see routes/company.ts POST /users. A missed
 * cap is recoverable; wrongly refusing a paying customer's teammate is not.
 *
 * 'website' is absent deliberately: that product has no CRM to seat.
 */
export const PLAN_SEATS: Record<string, number> = {
  starter10: 10,
  team25: 25,
  business50: 50,
}

/** Seats for a plan id, or null when we have no trustworthy number. */
export function seatsForPlan(planId: string | null | undefined): number | null {
  if (!planId) return null
  return PLAN_SEATS[planId] ?? null
}
