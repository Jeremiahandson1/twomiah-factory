// The store's subscription — mirrored from the Factory, so a store whose subscription ended is locked and its owner can
// restart it by paying. (10/14)
//
// The other CRMs run the shared createBillingRoutes / createSubscriptionSyncRoute against company.settings. The store has
// no company row (single-tenant, store_settings) and its users carry no companyId, so it keeps the same doors and the same
// summary keys here, against store_settings.subscription:
//   POST /api/internal/sync-subscription  the Factory pushes the summary (X-Factory-Key) — as in every CRM
//   GET  /api/billing/subscription        the summary, pulled afresh, and whether this person may restart it
//   POST /api/billing/restart-checkout    the owner's (billing:manage): a Stripe checkout to come back
// /api/billing stays open while the store is locked (shared auth/accountLock.ts) — it is the way back.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { createFactoryApiClient, forgetAccountLock } from '../shared/index.ts'

const factory = createFactoryApiClient() as any
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
  forgetAccountLock()
  return true
}

/** Pull the Factory's summary and mirror it. Null (and a log line) when the Factory cannot be reached. */
export async function refreshStoreSubscription(): Promise<any | null> {
  try {
    const sub = await factory.getSubscription()
    if (sub && STATUSES.includes(sub.status)) await applyStoreSubscription(sub)
    return sub
  } catch (err: any) {
    console.warn('[Subscription] Factory unreachable — keeping the last summary:', err?.message || err)
    return null
  }
}

const mayManage = async (c: any) => {
  const u = c.get('user')
  return !!u && hasPermission(u.role, 'billing:manage', await getExtraPermissions(u.userId))
}

export const billingRoutes = new Hono()
billingRoutes.use('*', authenticate)

billingRoutes.get('/subscription', async (c) => {
  const fresh = await refreshStoreSubscription()
  const [row] = await db.select({ subscription: storeSettings.subscription }).from(storeSettings).limit(1)
  const s: any = row?.subscription || null
  return c.json({
    subscription: fresh || (s ? { status: s.subscriptionStatus, billingStatus: s.billingStatus, plan: s.plan, planName: s.planName, nextBillingDate: s.nextBillingDate, trialEndsAt: s.trialEndsAt } : null),
    mayManage: await mayManage(c),
    managedBy: 'twomiah',
    supportEmail: 'support@twomiah.com',
  })
})

billingRoutes.post('/restart-checkout', async (c) => {
  if (!(await mayManage(c))) {
    return c.json({ error: "Restarting the subscription is the account owner's. Ask them to sign in and restart it.", code: 'owner_only', required: 'billing:manage' }, 403)
  }
  try {
    // The store's lock page is /paywall — its screens are not under /crm.
    const result = await factory.startRestartCheckout('/paywall')
    return c.json({ url: result?.url || null })
  } catch (err: any) {
    const status = err?.status === 409 || err?.status === 410 ? err.status : 502
    return c.json({ url: null, error: err?.message || 'Could not open the checkout', code: err?.upstream?.code || null }, status)
  }
})

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
