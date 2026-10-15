// The store's subscription summary, mirrored from the Factory into store_settings.subscription. (10/14)
//
// The other CRMs mirror it into company.settings with the shared createSubscriptionSyncRoute; the store has no company
// row. The summary locks the admin when the subscription ends (shared auth/accountLock.ts reads exactly these keys).
//   POST /api/internal/sync-subscription — the Factory pushes it, authenticated by the Factory's key (no session)
//   refreshStoreSubscription()           — pulled at boot and whenever Billing is opened
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { createFactoryApiClient, forgetAccountLock } from '../shared/index.ts'

export const factoryClient = createFactoryApiClient() as any
const STATUSES = ['active', 'trialing', 'past_due', 'canceled']

/** Mirror a Factory summary into store_settings.subscription, in the keys the lock reads. False when there is no store row yet. */
export async function applyStoreSubscription(sub: any): Promise<boolean> {
  const [row] = await db.select({ id: storeSettings.id }).from(storeSettings).limit(1)
  if (!row) return false
  const subscription = {
    subscriptionStatus: sub.status, billingStatus: sub.billingStatus ?? null, trialEndsAt: sub.trialEndsAt ?? null,
    plan: sub.plan ?? null, planName: sub.planName ?? null, nextBillingDate: sub.nextBillingDate ?? null,
    hasStripeCustomer: !!sub.hasStripeCustomer, syncedAt: sub.syncedAt || new Date().toISOString(),
  }
  await db.update(storeSettings).set({ subscription, updatedAt: new Date() } as any).where(eq(storeSettings.id, row.id))
  // A lock or an unlock takes effect on the very next request.
  forgetAccountLock()
  return true
}

/** Pull the Factory's summary and mirror it. Null (and a log line) when the Factory cannot be reached. */
export async function refreshStoreSubscription(): Promise<any | null> {
  try {
    const sub = await factoryClient.getSubscription()
    if (sub && STATUSES.includes(sub.status)) await applyStoreSubscription(sub)
    return sub
  } catch (err: any) {
    console.warn('[Subscription] Factory unreachable — keeping the last summary:', err?.message || err)
    return null
  }
}

export const subscriptionSyncRoute = new Hono()
subscriptionSyncRoute.post('/', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  if ((c.req.header('X-Factory-Key') || '') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => null)
  const sub = body?.subscription
  if (!sub || typeof sub !== 'object' || !STATUSES.includes(sub.status)) return c.json({ error: 'subscription with a valid status is required' }, 400)
  if (!(await applyStoreSubscription(sub))) return c.json({ error: 'No store settings yet' }, 404)
  return c.json({ success: true })
})
