/**
 * lib/square/webhook.ts — Square → us. Square only moves money now (the menu
 * and the orders are ours), so the subscription is for payments and refunds:
 * a refund made in Square's dashboard shows up here. The admin "Connect
 * webhooks" button creates the subscription and stores its signature key in
 * square_state; SQUARE_WEBHOOK_SIGNATURE_KEY in the env overrides it.
 */
import { eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { onlineOrders } from '../../db/schema'
import { squareApi, squareConfig } from './client'
import { getState, upsertState } from './state'

export const WEBHOOK_PATH = '/api/square/webhook'
export const WEBHOOK_EVENTS = ['payment.updated', 'refund.updated']

export async function webhookCredentials(db: typeof DB): Promise<{ key: string; url: string } | null> {
  const state = await getState(db)
  const key = (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || state?.webhookSignatureKey || '').trim()
  const url = (process.env.SQUARE_WEBHOOK_URL || state?.webhookUrl || '').trim()
  return key && url ? { key, url } : null
}

/** Create (or re-create) the webhook subscription pointing at this site. */
export async function connectWebhooks(db: typeof DB, siteOrigin: string): Promise<{ subscriptionId: string; url: string }> {
  if (!squareConfig()) throw new Error('Square is not configured')
  const url = siteOrigin.replace(/\/+$/, '') + WEBHOOK_PATH
  if (!/^https:\/\//.test(url)) throw new Error('Webhooks need the site on https (set SITE_URL).')
  const existing = await squareApi<{ subscriptions?: any[] }>('/v2/webhooks/subscriptions')
  for (const sub of existing.subscriptions || []) {
    if (sub.notification_url === url) await squareApi('/v2/webhooks/subscriptions/' + encodeURIComponent(sub.id), 'DELETE')
  }
  const res = await squareApi<{ subscription: any }>('/v2/webhooks/subscriptions', 'POST', {
    idempotency_key: crypto.randomUUID(),
    subscription: { name: 'Website — payments and refunds', event_types: WEBHOOK_EVENTS, notification_url: url },
  })
  const sub = res.subscription
  if (!sub?.id || !sub?.signature_key) throw new Error('Square did not return a webhook signature key')
  await upsertState(db, { webhookSubscriptionId: sub.id, webhookSignatureKey: sub.signature_key, webhookUrl: url })
  return { subscriptionId: sub.id, url }
}

/** A full refund in Square's dashboard marks the web order canceled, so the confirmation page and reports agree. */
export async function handleSquareEvent(db: typeof DB, event: any): Promise<string> {
  const type = String(event?.type || '')
  await upsertState(db, { lastWebhookAt: new Date() }).catch(() => {})
  if (type === 'refund.updated') {
    const refund = event?.data?.object?.refund
    if (refund?.status === 'COMPLETED' && refund?.payment_id) {
      const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.squarePaymentId, String(refund.payment_id))).limit(1)
      if (o && (refund.amount_money?.amount ?? 0) >= (o.totalCents || 0)) {
        await db.update(onlineOrders).set({ status: 'canceled', error: 'Refunded in Square', updatedAt: new Date() }).where(eq(onlineOrders.id, o.id))
        return 'order refunded'
      }
    }
    return 'refund noted'
  }
  return 'ignored ' + type
}
