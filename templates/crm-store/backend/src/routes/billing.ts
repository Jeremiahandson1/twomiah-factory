// The store's subscription, for its owner: what it is, and the way back after it ends. (10/14)
//
//   GET  /api/billing/subscription      the summary, pulled afresh from the Factory
//   POST /api/billing/restart-checkout  a Stripe checkout for the store's own plan — pay and the store unlocks
//
// What the store pays for is the owner's: billing:manage, on the mount. The other CRMs show the plan to admins too, but a
// shop has no admin seat, and a manager or staff member is told only THAT the store is locked (/api/auth/me), never the
// bill. /api/billing stays open while the store is locked (shared auth/accountLock.ts) — it is the way back.
// The Factory's push lands in routes/subscriptionSync.ts, on the Factory's key.
import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { factoryClient, refreshStoreSubscription } from './subscriptionSync.ts'

export const billingRoutes = new Hono()
billingRoutes.use('*', authenticate, requirePermission('billing:manage'))

billingRoutes.get('/subscription', async (c) => {
  const fresh = await refreshStoreSubscription()
  const [row] = await db.select({ subscription: storeSettings.subscription }).from(storeSettings).limit(1)
  const s: any = row?.subscription || null
  return c.json({
    subscription: fresh || (s ? { status: s.subscriptionStatus, billingStatus: s.billingStatus, plan: s.plan, planName: s.planName, nextBillingDate: s.nextBillingDate, trialEndsAt: s.trialEndsAt } : null),
    // Everyone who reaches this holds billing:manage — the lock page offers Restart exactly to them.
    mayManage: true,
    managedBy: 'twomiah',
    supportEmail: 'support@twomiah.com',
  })
})

billingRoutes.post('/restart-checkout', async (c) => {
  try {
    // The store's lock page is /paywall — its screens are not under /crm.
    const result = await factoryClient.startRestartCheckout('/paywall')
    return c.json({ url: result?.url || null })
  } catch (err: any) {
    const status = err?.status === 409 || err?.status === 410 ? err.status : 502
    return c.json({ url: null, error: err?.message || 'Could not open the checkout', code: err?.upstream?.code || null }, status)
  }
})
