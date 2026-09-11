import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { FactoryApiClient } from './types'
import type { TenantSubscription } from './plans'

// READ-ONLY billing for a tenant CRM.
//
// Plans are sold, changed and cancelled in the Twomiah Factory (Stripe lives there). This CRM only
// mirrors the Factory's subscription summary into company.settings — which is what the trial gate and
// Settings → Billing read — and hands the admin a link to the Factory's Stripe billing portal.
// The tenant never computes billing state on its own.

export interface BillingFactoryClient extends FactoryApiClient {
  getSubscription(): Promise<TenantSubscription>
  getBillingPortalLink(): Promise<{ url: string | null; reason?: string }>
}

export interface BillingDeps {
  db: any
  companyTable: any
  userTable: any
  factoryApiClient: BillingFactoryClient
  /** process.env.SEAT_LIMIT — written by the Factory at deploy; wins over the plan's seat count. */
  seatLimitEnv?: string
}

const SETTINGS_KEYS = ['plan', 'planName', 'product', 'subscriptionStatus', 'billingStatus', 'billingType', 'billingCycle', 'monthlyAmount', 'nextBillingDate', 'trialEndsAt', 'seatLimit', 'hasStripeCustomer', 'subscriptionSyncedAt'] as const

/** Mirror a Factory subscription summary into company.settings (the single company row of this tenant). */
export async function applySubscriptionToCompany(deps: BillingDeps, sub: TenantSubscription): Promise<any> {
  const { db, companyTable } = deps
  const [comp] = await db.select().from(companyTable).limit(1)
  if (!comp) return null
  const prev = (comp.settings as any) || {}
  const settings = {
    ...prev,
    plan: sub.plan,
    planName: sub.planName,
    product: sub.product,
    subscriptionStatus: sub.status,
    billingStatus: sub.billingStatus,
    billingType: sub.billingType,
    billingCycle: sub.billingCycle,
    monthlyAmount: sub.monthlyAmount,
    nextBillingDate: sub.nextBillingDate,
    trialEndsAt: sub.trialEndsAt,
    seatLimit: sub.seats ?? prev.seatLimit ?? null,
    hasStripeCustomer: sub.hasStripeCustomer,
    subscriptionSyncedAt: sub.syncedAt,
  }
  const [updated] = await db.update(companyTable).set({ settings, subscriptionTier: sub.plan ?? null, updatedAt: new Date() } as any).where(eq(companyTable.id, comp.id)).returning()
  return updated
}

/** Pull the summary from the Factory and mirror it. Returns null (and logs) when the Factory is unreachable. */
export async function refreshSubscriptionFromFactory(deps: BillingDeps): Promise<TenantSubscription | null> {
  try {
    const sub = await deps.factoryApiClient.getSubscription()
    await applySubscriptionToCompany(deps, sub)
    return sub
  } catch (err: any) {
    console.warn('[billing] subscription refresh from Factory failed:', err?.message)
    return null
  }
}

function cachedSubscription(comp: any): TenantSubscription | null {
  const s = (comp?.settings as any) || {}
  if (!s.subscriptionSyncedAt) return null
  return {
    plan: s.plan ?? null, planName: s.planName ?? null, product: s.product ?? null, monthlyAmount: s.monthlyAmount ?? null,
    billingCycle: s.billingCycle ?? null, billingType: s.billingType ?? null, status: s.subscriptionStatus || 'active',
    billingStatus: s.billingStatus ?? null, nextBillingDate: s.nextBillingDate ?? null, trialEndsAt: s.trialEndsAt ?? null,
    seats: s.seatLimit ?? null, hasStripeCustomer: !!s.hasStripeCustomer, syncedAt: s.subscriptionSyncedAt,
  }
}

export function createBillingRoutes(deps: BillingDeps): Hono {
  const app = new Hono()
  const { db, companyTable, userTable } = deps

  // GET /subscription — live from the Factory when reachable, otherwise the last mirrored copy.
  app.get('/subscription', async (c) => {
    const currentUser = c.get('user') as any
    const fresh = await refreshSubscriptionFromFactory(deps)
    const [comp] = await db.select().from(companyTable).where(eq(companyTable.id, currentUser.companyId)).limit(1)
    const subscription = fresh || cachedSubscription(comp)
    const active = await db.select({ id: userTable.id }).from(userTable).where(and(eq(userTable.companyId, currentUser.companyId), eq(userTable.isActive, true)))
    const envSeats = Number.parseInt(deps.seatLimitEnv || '', 10)
    const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : (subscription?.seats ?? null)
    return c.json({
      subscription,
      source: fresh ? 'factory' : subscription ? 'cache' : 'unavailable',
      seatsUsed: active.length,
      seatLimit,
      managedBy: 'twomiah',
      supportEmail: 'support@twomiah.com',
    })
  })

  // POST /portal-link — Stripe billing portal session minted by the Factory for this tenant's customer.
  app.post('/portal-link', async (c) => {
    try {
      const result = await deps.factoryApiClient.getBillingPortalLink()
      return c.json(result)
    } catch (err: any) {
      return c.json({ url: null, error: err?.message || 'Could not open billing portal' }, 502)
    }
  })

  return app
}

/**
 * POST /api/internal/sync-subscription — the Factory pushes the summary here whenever Stripe or the
 * trial cron changes it. Same X-Factory-Key as /api/internal/sync-features. Mount WITHOUT user auth.
 */
export function createSubscriptionSyncRoute(deps: BillingDeps): Hono {
  const app = new Hono()
  app.post('/', async (c) => {
    const syncKey = process.env.FACTORY_SYNC_KEY
    if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
    if ((c.req.header('X-Factory-Key') || '') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
    const body = await c.req.json().catch(() => null)
    const sub = body?.subscription
    if (!sub || typeof sub !== 'object' || !['active', 'trialing', 'past_due', 'canceled'].includes(sub.status)) {
      return c.json({ error: 'subscription with a valid status is required' }, 400)
    }
    const updated = await applySubscriptionToCompany(deps, sub as TenantSubscription)
    if (!updated) return c.json({ error: 'No company found' }, 404)
    const s = (updated.settings as any) || {}
    return c.json({ success: true, mirrored: Object.fromEntries(SETTINGS_KEYS.map(k => [k, s[k] ?? null])) })
  })
  return app
}
