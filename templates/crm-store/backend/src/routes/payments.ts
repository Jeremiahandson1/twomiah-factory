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

  const credentialsEnc = encryptJSON({ secretKey, publishableKey })
  const webhookSecretEnc = webhookSecret ? encrypt(webhookSecret) : null

  const [existing] = await db.select().from(paymentConfig).limit(1)
  const values = {
    provider, mode, credentialsEnc, webhookSecretEnc,
    publishableKey: publishableKey ?? null,
    connected: true, updatedAt: new Date(),
  }
  const [saved] = existing
    ? await db.update(paymentConfig).set(values).where(eq(paymentConfig.id, existing.id)).returning()
    : await db.insert(paymentConfig).values(values).returning()

  return c.json({ config: { provider: saved.provider, mode: saved.mode, connected: saved.connected } })
})

admin.post('/disconnect', async (c) => {
  const [existing] = await db.select().from(paymentConfig).limit(1)
  if (existing) {
    await db.update(paymentConfig).set({ connected: false, updatedAt: new Date() }).where(eq(paymentConfig.id, existing.id))
  }
  return c.json({ ok: true })
})

export default admin
