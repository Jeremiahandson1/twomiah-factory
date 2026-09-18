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

  if (provider !== 'stripe') {
    return c.json({ error: `${provider} support is coming soon` }, 400)
  }

  // Verify the key actually works before we save it (Stripe: cheap balance read).
  try {
    const stripe = new Stripe(secretKey)
    await stripe.balance.retrieve()
  } catch (err: any) {
    logger.warn('payment connect verification failed', { provider, error: err?.message })
    return c.json({ error: 'These credentials were rejected by the provider. Double-check the secret key.' }, 400)
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
