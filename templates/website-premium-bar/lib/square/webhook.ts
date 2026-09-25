/**
 * lib/square/webhook.ts — Square → us.
 *
 *   catalog.version.updated    → re-pull the menu (debounced; the register saves in bursts)
 *   order.fulfillment.updated  → RESERVED = the kitchen accepted it → "on the grill" text
 *                                PREPARED = ready → "it's up" text
 *   order.updated              → a canceled order shows canceled on the confirmation page
 *
 * The subscription is created from the admin ("Connect webhooks"), which
 * stores the signature key in square_state; SQUARE_WEBHOOK_SIGNATURE_KEY in
 * the env overrides it.
 */
import { eq } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { onlineOrders, settings as settingsTbl } from '../../db/schema'
import { sendSms } from '../sms/twilio'
import { bustSiteData } from '../site-data'
import { getState, syncFromSquare, upsertState } from './catalog'
import { squareApi, squareConfig } from './client'
import { firedText, readyText } from './texts'

export const WEBHOOK_PATH = '/api/square/webhook'
export const WEBHOOK_EVENTS = ['catalog.version.updated', 'order.fulfillment.updated', 'order.updated']

export async function webhookCredentials(db: typeof DB): Promise<{ key: string; url: string } | null> {
  const state = await getState(db)
  const key = (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || state?.webhookSignatureKey || '').trim()
  const url = (process.env.SQUARE_WEBHOOK_URL || state?.webhookUrl || '').trim()
  return key && url ? { key, url } : null
}

/** Create (or re-create) the webhook subscription pointing at this site. Returns what was stored. */
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
    subscription: { name: 'Website — menu sync and order texts', event_types: WEBHOOK_EVENTS, notification_url: url },
  })
  const sub = res.subscription
  if (!sub?.id || !sub?.signature_key) throw new Error('Square did not return a webhook signature key')
  await upsertState(db, { webhookSubscriptionId: sub.id, webhookSignatureKey: sub.signature_key, webhookUrl: url })
  return { subscriptionId: sub.id, url }
}

// ─── Catalog: debounce a burst of edits into one sync ──────────────────────
let syncTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleCatalogSync(db: typeof DB, delayMs = 4000): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    syncFromSquare(db)
      .then(r => { bustSiteData(); console.log('[square] catalog synced:', JSON.stringify(r)) })
      .catch(async (e) => { console.error('[square] catalog sync failed:', e?.message || e); await upsertState(db, { lastSyncResult: 'FAILED: ' + (e?.message || e) }).catch(() => {}) })
  }, delayMs)
}

// ─── Orders ────────────────────────────────────────────────────────────────
const STATE_TO_STATUS: Record<string, string> = { RESERVED: 'in_progress', PREPARED: 'ready', COMPLETED: 'completed', CANCELED: 'canceled', FAILED: 'canceled' }

async function companyAndTz(db: typeof DB): Promise<{ name: string; tz: string }> {
  const [s] = await db.select({ name: settingsTbl.companyName, tz: settingsTbl.timezone }).from(settingsTbl).limit(1)
  return { name: s?.name || 'The bar', tz: s?.tz || 'America/Chicago' }
}

export async function applyFulfillmentState(db: typeof DB, squareOrderId: string, newState: string): Promise<void> {
  const [row] = await db.select().from(onlineOrders).where(eq(onlineOrders.squareOrderId, squareOrderId)).limit(1)
  if (!row) return   // an order rung up at the register, not ours
  const status = STATE_TO_STATUS[newState]
  if (!status || row.status === status) return
  const patch: Partial<typeof onlineOrders.$inferInsert> = { status, updatedAt: new Date() }
  const { name, tz } = await companyAndTz(db)
  if (row.textUpdates && status === 'in_progress' && !row.firedSmsAt) {
    const r = await sendSms(row.phone, firedText(name, row.pickupAt, tz))
    if (r.ok) patch.firedSmsAt = new Date(); else if (!r.skipped) console.warn('[square] fired text failed:', r.error)
  }
  if (row.textUpdates && status === 'ready' && !row.readySmsAt) {
    const r = await sendSms(row.phone, readyText(name))
    if (r.ok) patch.readySmsAt = new Date(); else if (!r.skipped) console.warn('[square] ready text failed:', r.error)
  }
  await db.update(onlineOrders).set(patch).where(eq(onlineOrders.id, row.id))
}

export async function handleSquareEvent(db: typeof DB, event: any): Promise<string> {
  const type = String(event?.type || '')
  await upsertState(db, { lastWebhookAt: new Date() }).catch(() => {})
  if (type === 'catalog.version.updated') { scheduleCatalogSync(db); return 'catalog sync scheduled' }
  if (type === 'order.fulfillment.updated') {
    const o = event?.data?.object?.order_fulfillment_updated || {}
    const updates: any[] = Array.isArray(o.fulfillment_update) ? o.fulfillment_update : []
    const newState = updates.map(u => u?.new_state).filter(Boolean).pop()
    if (o.order_id && newState) await applyFulfillmentState(db, String(o.order_id), String(newState))
    return 'fulfillment ' + (newState || 'unchanged')
  }
  if (type === 'order.updated') {
    const o = event?.data?.object?.order_updated || {}
    if (o.order_id && o.state === 'CANCELED') await applyFulfillmentState(db, String(o.order_id), 'CANCELED')
    return 'order ' + (o.state || '')
  }
  return 'ignored ' + type
}
