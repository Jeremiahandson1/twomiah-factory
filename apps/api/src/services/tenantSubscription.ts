// The subscription summary a tenant CRM shows on Settings → Billing and gates its trial on.
//
// Tenants do NOT compute billing state themselves any more (they used to run their own Stripe
// checkout at prices we no longer sell, and paywalled themselves 30 days after creation). The Factory
// is the billing system: it derives this summary from the tenants row, serves it on
// GET /api/v1/factory/customers/:id/subscription (tenant pulls at boot and when the page opens) and
// pushes it to /api/internal/sync-subscription whenever Stripe or the trial cron changes the row.
import { supabase } from '../middleware/auth'
import { planFor, seatsForPlan, type TenantSubscription } from '../config/planSeats'

export const TENANT_SUBSCRIPTION_COLUMNS =
  'id, slug, status, plan, products, billing_type, billing_status, billing_cycle, monthly_amount, next_billing_date, paid_at, trial_ends_at, trial_expired_at, stripe_customer_id, stripe_subscription_id, factory_sync_key, render_backend_url'

export function buildTenantSubscription(t: any): TenantSubscription {
  const plan = planFor(t?.plan)
  const paid = t?.billing_status === 'active' || (t?.billing_type === 'one_time' && !!t?.paid_at)
  const trialEndsAt: string | null = t?.trial_ends_at || null
  let status: TenantSubscription['status']
  if (t?.billing_status === 'past_due') status = 'past_due'
  else if (t?.billing_status === 'canceled' || ['suspended', 'offboarded', 'canceled', 'trial_expired'].includes(t?.status)) status = 'canceled'
  else if (paid) status = 'active'
  else if (trialEndsAt) status = (t?.trial_expired_at || new Date(trialEndsAt).getTime() < Date.now()) ? 'canceled' : 'trialing'
  // Provisioned without a checkout (platform admin / manual). The Factory decides suspension — a
  // tenant must never lock a customer out on its own guess.
  else status = 'active'
  const products: string[] = Array.isArray(t?.products) ? t.products : []
  return {
    plan: t?.plan || null,
    planName: plan?.name || t?.plan || null,
    product: plan?.product || (products.includes('crm') ? 'crm' : products.includes('website') ? 'website' : null),
    monthlyAmount: t?.monthly_amount != null && t.monthly_amount !== '' ? Number(t.monthly_amount) : (plan?.monthlyPrice ?? null),
    billingCycle: t?.billing_cycle || (t?.billing_type === 'one_time' ? null : 'monthly'),
    billingType: t?.billing_type || null,
    status,
    billingStatus: t?.billing_status || null,
    nextBillingDate: t?.next_billing_date || null,
    trialEndsAt,
    seats: seatsForPlan(t?.plan),
    hasStripeCustomer: !!t?.stripe_customer_id,
    syncedAt: new Date().toISOString(),
  }
}

/** Push the current summary to the running tenant CRM. Never throws — billing must not fail because a CRM is asleep. */
export async function pushSubscriptionToTenant(tenantId: string): Promise<boolean> {
  try {
    const { data: t } = await supabase.from('tenants').select(TENANT_SUBSCRIPTION_COLUMNS).eq('id', tenantId).single()
    if (!t?.render_backend_url || !t?.factory_sync_key) return false
    const res = await fetch(t.render_backend_url.replace(/\/$/, '') + '/api/internal/sync-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': t.factory_sync_key },
      body: JSON.stringify({ subscription: buildTenantSubscription(t) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) console.warn('[Subscription] tenant sync HTTP', res.status, 'for', t.slug)
    return res.ok
  } catch (err: any) {
    console.warn('[Subscription] tenant sync failed (CRM may be asleep):', err?.message)
    return false
  }
}
