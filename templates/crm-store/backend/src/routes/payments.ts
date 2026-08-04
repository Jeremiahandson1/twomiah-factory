import { Hono } from 'hono'
import { z } from 'zod'
import Stripe from 'stripe'
import { db } from '../../db/index.ts'
import { paymentConfig } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { encryptJSON, encrypt } from '../lib/crypto.ts'
import logger from '../services/logger.ts'

const admin = new Hono()
admin.use('*', authenticate)

// Status only — NEVER returns the encrypted secret/webhook material.
admin.get('/', async (c) => {
  const [cfg] = await db.select({
    id: paymentConfig.id,
    provider: paymentConfig.provider,
    mode: paymentConfig.mode,
    publishableKey: paymentConfig.publishableKey,
    connected: paymentConfig.connected,
    hasWebhookSecret: paymentConfig.webhookSecretEnc,
    updatedAt: paymentConfig.updatedAt,
  }).from(paymentConfig).limit(1)

  const backendUrl = process.env.BACKEND_URL || ''
  return c.json({
    config: cfg ? {
      provider: cfg.provider,
      mode: cfg.mode,
      publishableKey: cfg.publishableKey,
      connected: cfg.connected,
      hasWebhookSecret: !!cfg.hasWebhookSecret,
      updatedAt: cfg.updatedAt,
    } : null,
    // The URL the merchant pastes into their provider dashboard.
    webhookUrl: `${backendUrl}/api/public/webhooks/payment`,
  })
})

const connectSchema = z.object({
  provider: z.enum(['stripe', 'square', 'paypal']),
  mode: z.enum(['test', 'live']).default('test'),
  secretKey: z.string().min(1),
  publishableKey: z.string().optional(),
  webhookSecret: z.string().optional(),
})


// ── Webhook auto-configuration ──────────────────────────────────────────────
// Most merchants have never created a webhook — so when they don't paste one,
// create it FOR them via the provider's API using the credentials they just
// verified, and store the returned secret. Idempotent: any prior endpoint we
// created at this URL is deleted first (Stripe only reveals the signing secret
// at creation, so reuse is impossible). Failure is non-fatal — credentials
// still save; the caller surfaces a note telling the merchant orders will
// confirm via the slower success-page fallback until webhooks are set up.
async function autoCreateWebhook(
  provider: 'stripe' | 'square' | 'paypal',
  mode: 'test' | 'live',
  secretKey: string,
  publishableKey: string | undefined,
): Promise<{ secret: string } | { warning: string }> {
  const backendUrl = (process.env.BACKEND_URL || '').replace(/\/$/, '')
  if (!backendUrl) return { warning: 'BACKEND_URL not configured on this service' }
  const webhookUrl = backendUrl + '/api/public/webhooks/payment'
  try {
    if (provider === 'stripe') {
      const stripe = new Stripe(secretKey)
      const existing = await stripe.webhookEndpoints.list({ limit: 100 })
      for (const ep of existing.data) {
        if (ep.url === webhookUrl) await stripe.webhookEndpoints.del(ep.id)
      }
      const ep = await stripe.webhookEndpoints.create({
        url: webhookUrl,
        enabled_events: ['checkout.session.completed'],
        description: 'Twomiah store — order payment notifications (auto-created)',
      })
      if (!ep.secret) return { warning: 'Stripe did not return a signing secret' }
      return { secret: ep.secret }
    }
    if (provider === 'square') {
      const base = mode === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'
      const H = { 'Authorization': `Bearer ${secretKey}`, 'Square-Version': '2024-10-17', 'Content-Type': 'application/json' }
      const listRes = await fetch(base + '/v2/webhooks/subscriptions', { headers: H })
      if (listRes.ok) {
        const subs = (await listRes.json())?.subscriptions || []
        for (const sub of subs) {
          if (sub.notification_url === webhookUrl) {
            await fetch(base + '/v2/webhooks/subscriptions/' + sub.id, { method: 'DELETE', headers: H })
          }
        }
      }
      const res = await fetch(base + '/v2/webhooks/subscriptions', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          subscription: { name: 'Twomiah store payments', event_types: ['payment.updated'], notification_url: webhookUrl },
        }),
      })
      const data: any = await res.json().catch(() => ({}))
      const key = data?.subscription?.signature_key
      if (!res.ok || !key) return { warning: 'Square webhook subscription failed: ' + (data?.errors?.[0]?.detail || res.status) }
      return { secret: key }
    }
    // paypal — the stored "secret" is the webhook ID, which verification uses.
    const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
    const auth = Buffer.from(`${publishableKey || ''}:${secretKey}`).toString('base64')
    const tokRes = await fetch(base + '/v1/oauth2/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    const tok: any = await tokRes.json().catch(() => ({}))
    if (!tok.access_token) return { warning: 'PayPal token request failed' }
    const PH = { 'Authorization': `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }
    const listRes = await fetch(base + '/v1/notifications/webhooks', { headers: PH })
    if (listRes.ok) {
      const hooks = (await listRes.json())?.webhooks || []
      for (const h of hooks) {
        if (h.url === webhookUrl) await fetch(base + '/v1/notifications/webhooks/' + h.id, { method: 'DELETE', headers: PH })
      }
    }
    const res = await fetch(base + '/v1/notifications/webhooks', {
      method: 'POST', headers: PH,
      body: JSON.stringify({ url: webhookUrl, event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }] }),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || !data.id) return { warning: 'PayPal webhook creation failed: ' + (data?.message || res.status) }
    return { secret: data.id }
  } catch (err: any) {
    return { warning: err?.message || 'webhook auto-configuration failed' }
  }
}

admin.post('/connect', async (c) => {
  const parsed = connectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid payment credentials' }, 400)
  const { provider, mode, secretKey, publishableKey, webhookSecret } = parsed.data

  // Verify the merchant's credentials actually work before saving them — a cheap
  // authenticated read against their own account. Field mapping per provider:
  //   stripe: secretKey = Secret Key
  //   square: secretKey = Access Token, publishableKey = Location ID
  //   paypal: secretKey = Client Secret, publishableKey = Client ID
  try {
    if (provider === 'stripe') {
      const stripe = new Stripe(secretKey)
      await stripe.balance.retrieve()
    } else if (provider === 'square') {
      const base = mode === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'
      const res = await fetch(base + '/v2/locations', {
        headers: { 'Authorization': `Bearer ${secretKey}`, 'Square-Version': '2024-10-17' },
      })
      if (!res.ok) throw new Error('Square rejected the access token')
    } else if (provider === 'paypal') {
      const base = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
      const auth = Buffer.from(`${publishableKey || ''}:${secretKey}`).toString('base64')
      const res = await fetch(base + '/v1/oauth2/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      })
      if (!res.ok) throw new Error('PayPal rejected the client credentials')
    }
  } catch (err: any) {
    logger.warn('payment connect verification failed', { provider, error: err?.message })
    return c.json({ error: 'These credentials were rejected by the provider. Double-check them.' }, 400)
  }

  // Merchant pasted a webhook secret → respect it. Otherwise create the
  // webhook for them (most merchants have never made one).
  let finalWebhookSecret = webhookSecret || null
  let webhookNote: string | null = null
  if (!finalWebhookSecret) {
    const auto = await autoCreateWebhook(provider, mode, secretKey, publishableKey)
    if ('secret' in auto) {
      finalWebhookSecret = auto.secret
      logger.info('webhook auto-created', { provider, mode })
    } else {
      webhookNote = auto.warning
      logger.warn('webhook auto-create failed', { provider, error: auto.warning })
    }
  }

  const credentialsEnc = encryptJSON({ secretKey, publishableKey })
  const webhookSecretEnc = finalWebhookSecret ? encrypt(finalWebhookSecret) : null

  const [existing] = await db.select().from(paymentConfig).limit(1)
  const values = {
    provider, mode, credentialsEnc, webhookSecretEnc,
    publishableKey: publishableKey ?? null,
    connected: true, updatedAt: new Date(),
  }
  const [saved] = existing
    ? await db.update(paymentConfig).set(values).where(eq(paymentConfig.id, existing.id)).returning()
    : await db.insert(paymentConfig).values(values).returning()

  return c.json({ config: { provider: saved.provider, mode: saved.mode, connected: saved.connected }, webhookConfigured: !!finalWebhookSecret, webhookNote })
})

admin.post('/disconnect', async (c) => {
  const [existing] = await db.select().from(paymentConfig).limit(1)
  if (existing) {
    await db.update(paymentConfig).set({ connected: false, updatedAt: new Date() }).where(eq(paymentConfig.id, existing.id))
  }
  return c.json({ ok: true })
})

export default admin
