// /api/admin/payments — the merchant connects their OWN Square or PayPal account (its keys verified against the
// provider, encrypted at rest, never sent back), the payment webhook is made for them, and an older store's webhook is
// brought up to date at boot. Moved from templates/crm-store/backend/src/routes/payments.ts.
//
// Stripe (owner's decision, 2026-10-26): the business's CONNECTED account, created or linked with Connect Stripe as
// everywhere else in the app (Settings › Integrations; the Payments page offers the same two buttons). No Stripe secret
// key is accepted here any more. A store that pasted Stripe keys before keeps them working until it connects; then the
// connected account is used (core.getActiveProvider) and ensureStripeWebhookEvents below only ever touches those keys.
//
// Changes from the template:
//   · the registry signs the person in (access 'user'), so the router does not apply authenticate itself;
//   · the payment connection is the company's (payment_config.company_id), read and written by it;
//   · ensureStripeWebhookEvents / ensurePayPalWebhookEvents take the app's dependencies and read the shop's own
//     connection (core.shop());
//   · replies through reply.ts: disconnect is { success: true } (was { ok: true }); a refused connect is
//     400 { error, code: 'validation_failed', fields } with the template's sentence;
//   · GET / still has no permission of its own (the template's: any signed-in seat may see WHICH processor is
//     connected and in which mode — never a key). Reported as a finding, kept as it was.
import { Hono } from 'hono'
import { z } from 'zod'
import Stripe from 'stripe'
import { and, eq } from 'drizzle-orm'
import { paymentConfig } from '../../../db/schema/store.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { encryptJSON, encrypt, decrypt, decryptJSON } from '../../../core/crypto.ts'
import { REFUND_EVENTS as PAYPAL_REFUND_EVENTS } from '../payments/paypal.ts'

const webhookBase = () => (process.env.BACKEND_URL || '').replace(/\/$/, '')

/**
 * What the store listens to on Stripe: a completed checkout (the order is paid) and a refund (one made here, or in
 * Stripe's own dashboard — the orders group's applyProviderRefund). charge.refunded joined on 10/12; a store connected
 * before then is brought up to date by ensureStripeWebhookEvents at startup.
 */
// A connected account's store gets the same events through the Factory's Connect endpoint, which must list them as
// well. That endpoint is set up by apps/api scripts/register-connect-webhook.ts. On 2026-10-26 its list was missing
// the charge.dispute.* events, and they have to be added to the endpoint in Stripe.
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed', 'charge.refunded',
  // A chargeback: opened (the owner is emailed), changed, closed — the Disputes screen keeps each as Stripe last said
  // (2026-10-24, the store upgrade). A store connected before then is brought up to date at startup, as above.
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated',
] as const

/**
 * What the store listens to on PayPal: a completed capture (the order is paid) and every refund event PayPal documents
 * for Payments v2 — a refund made here or in PayPal's dashboard (PAYMENT.CAPTURE.REFUNDED), a reversal
 * (PAYMENT.CAPTURE.REVERSED), and a held eCheck refund pending or failing (PAYMENT.REFUND.PENDING / .FAILED). The
 * refund events joined on 10/17; a store connected before then is brought up to date by ensurePayPalWebhookEvents.
 */
export const PAYPAL_WEBHOOK_EVENTS = ['PAYMENT.CAPTURE.COMPLETED', ...PAYPAL_REFUND_EVENTS] as const

async function connectedConfig(d: CrmDeps, core: StoreCore) {
  const co = await core.shop()
  if (!co) return null
  const [cfg] = await d.db.select().from(paymentConfig)
    .where(and(eq(paymentConfig.companyId, co.id), eq(paymentConfig.connected, true))).limit(1)
  return (cfg as typeof paymentConfig.$inferSelect) || null
}

/**
 * Add any missing event to the webhook this store already has on Stripe. An UPDATE, never a re-create: the signing
 * secret stays the same, so verification goes on working. Best-effort — a store that cannot be reached is left as it
 * was, and says so in the log.
 */
export async function ensureStripeWebhookEvents(d: CrmDeps, core: StoreCore): Promise<'updated' | 'current' | 'skipped'> {
  try {
    const cfg = await connectedConfig(d, core)
    const backendUrl = webhookBase()
    if (!cfg || cfg.provider !== 'stripe' || !backendUrl) return 'skipped'
    const { secretKey } = decryptJSON<{ secretKey: string }>(cfg.credentialsEnc)
    const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
    const url = backendUrl + '/api/public/webhooks/payment'
    const ep = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((e) => e.url === url)
    if (!ep) return 'skipped'
    const has = new Set(ep.enabled_events)
    if (has.has('*') || STRIPE_WEBHOOK_EVENTS.every((e) => has.has(e))) return 'current'
    await stripe.webhookEndpoints.update(ep.id, { enabled_events: [...new Set([...ep.enabled_events, ...STRIPE_WEBHOOK_EVENTS])] as any })
    d.logger.info('[store] stripe webhook events brought up to date', { events: STRIPE_WEBHOOK_EVENTS.join(',') })
    return 'updated'
  } catch (e: any) {
    d.logger.warn('[store] stripe webhook events not checked', { error: e?.message })
    return 'skipped'
  }
}

/**
 * Add any missing event to the webhook this store already has on PayPal — PATCH /v1/notifications/webhooks/{id},
 * replace /event_types. An UPDATE, never a re-create: the webhook id (what verification is checked against) stays the
 * same. Best-effort, like the Stripe one.
 */
export async function ensurePayPalWebhookEvents(d: CrmDeps, core: StoreCore): Promise<'updated' | 'current' | 'skipped'> {
  try {
    const cfg = await connectedConfig(d, core)
    if (!cfg || cfg.provider !== 'paypal' || !cfg.webhookSecretEnc) return 'skipped'
    const creds = decryptJSON<{ secretKey: string; publishableKey?: string }>(cfg.credentialsEnc)
    const webhookId = decrypt(cfg.webhookSecretEnc)
    const base = cfg.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
    const auth = Buffer.from(`${cfg.publishableKey ?? creds.publishableKey ?? ''}:${creds.secretKey}`).toString('base64')
    const tok: any = await (await fetch(base + '/v1/oauth2/token', {
      method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
    })).json().catch(() => ({}))
    if (!tok.access_token) return 'skipped'
    const H = { 'Authorization': `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }
    const res = await fetch(base + '/v1/notifications/webhooks/' + encodeURIComponent(webhookId), { headers: H })
    if (!res.ok) return 'skipped'
    const hook: any = await res.json().catch(() => ({}))
    const has = new Set<string>((hook?.event_types || []).map((e: any) => e?.name))
    if (has.has('*') || PAYPAL_WEBHOOK_EVENTS.every((e) => has.has(e))) return 'current'
    const names = [...new Set([...has, ...PAYPAL_WEBHOOK_EVENTS])]
    const up = await fetch(base + '/v1/notifications/webhooks/' + encodeURIComponent(webhookId), {
      method: 'PATCH', headers: H, body: JSON.stringify([{ op: 'replace', path: '/event_types', value: names.map((name) => ({ name })) }]),
    })
    if (!up.ok) { d.logger.warn('[store] paypal webhook events not updated', { status: up.status }); return 'skipped' }
    d.logger.info('[store] paypal webhook events brought up to date', { events: names.join(',') })
    return 'updated'
  } catch (e: any) {
    d.logger.warn('[store] paypal webhook events not checked', { error: e?.message })
    return 'skipped'
  }
}

// ── Webhook auto-configuration ──────────────────────────────────────────────
// Most merchants have never created a webhook — so when they don't paste one, create it FOR them via the provider's
// API using the credentials they just verified, and store the returned secret. Idempotent: any prior endpoint we
// created at this URL is deleted first (Stripe only reveals the signing secret at creation, so reuse is impossible).
// Failure is non-fatal — credentials still save; the caller surfaces a note telling the merchant orders will confirm
// via the slower success-page fallback until webhooks are set up.
// (Stripe has none to make: a connected account's events come through the Factory's Connect endpoint.)
async function autoCreateWebhook(
  provider: 'square' | 'paypal',
  mode: 'test' | 'live',
  secretKey: string,
  publishableKey: string | undefined,
): Promise<{ secret: string } | { warning: string }> {
  const backendUrl = webhookBase()
  // Shown to the merchant (Payments: "payment notifications need attention: …"), so in their words; the missing setting
  // is BACKEND_URL.
  if (!backendUrl) return { warning: 'this service has no public address for them yet — email support@twomiah.com' }
  const webhookUrl = backendUrl + '/api/public/webhooks/payment'
  try {
    if (provider === 'square') {
      const base = mode === 'live' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'
      const H = { 'Authorization': `Bearer ${secretKey}`, 'Square-Version': '2024-10-17', 'Content-Type': 'application/json' }
      const listRes = await fetch(base + '/v2/webhooks/subscriptions', { headers: H })
      if (listRes.ok) {
        const subs = ((await listRes.json()) as any)?.subscriptions || []
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
      const hooks = ((await listRes.json()) as any)?.webhooks || []
      for (const h of hooks) {
        if (h.url === webhookUrl) await fetch(base + '/v1/notifications/webhooks/' + h.id, { method: 'DELETE', headers: PH })
      }
    }
    const res = await fetch(base + '/v1/notifications/webhooks', {
      method: 'POST', headers: PH,
      body: JSON.stringify({ url: webhookUrl, event_types: PAYPAL_WEBHOOK_EVENTS.map((name) => ({ name })) }),
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || !data.id) return { warning: 'PayPal webhook creation failed: ' + (data?.message || res.status) }
    return { secret: data.id }
  } catch (err: any) {
    return { warning: err?.message || 'webhook auto-configuration failed' }
  }
}

// Square and PayPal only: Stripe is never connected by a key (STRIPE_USES_CONNECT, above the schema's check).
const connectSchema = z.object({
  provider: z.enum(['square', 'paypal']),
  mode: z.enum(['test', 'live']).default('test'),
  secretKey: z.string().min(1),
  publishableKey: z.string().optional(),
  webhookSecret: z.string().optional(),
})

/** Test or live: a connected account is in the platform key's mode (its Stripe-Account calls are made with that key). */
const platformMode = (): 'test' | 'live' => ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test')

/** The refusal a Stripe secret key gets: Stripe is connected, never pasted (owner's decision, 2026-10-26). */
export const STRIPE_USES_CONNECT = 'Stripe connects with "Connect Stripe" (or "I already have a Stripe account") — there is no key to paste. Press it above.'

export function createStorePaymentRoutes(d: CrmDeps, core: StoreCore) {
  const { db, logger, audit } = d
  const { requirePermission } = d.permissions
  const admin = new Hono<AppEnv>()

  // Status only — NEVER returns the encrypted secret/webhook material, nor the connected account's id. The owner's alone,
  // as connecting is: the store's seats leave payments with the owner (owner's decision, 2026-10-10), and which account
  // takes the money, in which mode, is not the staff's to read. The template asked nothing here (found in the browser
  // check, 2026-10-19).
  //
  // `config` is the processor the store takes money through NOW (core.getActiveProvider's rule): Square or PayPal by
  // their keys; else Stripe on the business's connected account (via: 'connect' — its notices come through the Factory's
  // Connect forwarder, so they are always set up); else a Stripe connection by keys pasted before Connect (via: 'keys'),
  // which the page asks the owner to replace with Connect (`stripeKeysToReplace`).
  admin.get('/', requirePermission('payments:update'), async (c) => {
    const companyId = c.get('user').companyId
    const [cfg] = await db.select({
      provider: paymentConfig.provider,
      mode: paymentConfig.mode,
      publishableKey: paymentConfig.publishableKey,
      connected: paymentConfig.connected,
      hasWebhookSecret: paymentConfig.webhookSecretEnc,
      updatedAt: paymentConfig.updatedAt,
    }).from(paymentConfig).where(eq(paymentConfig.companyId, companyId)).limit(1)
    const keysInUse = !!cfg?.connected && cfg.provider !== 'stripe'
    const connected = keysInUse ? null : await core.connectedStripe(companyId).catch(() => null)

    return one(c, {
      config: connected
        ? { provider: 'stripe', via: 'connect', mode: platformMode(), publishableKey: null, connected: true, hasWebhookSecret: true, updatedAt: null }
        : cfg ? {
          provider: cfg.provider,
          ...(cfg.provider === 'stripe' ? { via: 'keys' } : {}),
          mode: cfg.mode,
          publishableKey: cfg.publishableKey,
          connected: cfg.connected,
          hasWebhookSecret: !!cfg.hasWebhookSecret,
          updatedAt: cfg.updatedAt,
        } : null,
      // A store still on Stripe keys pasted before Connect: they work until the owner connects, then are not used.
      stripeKeysToReplace: !connected && !!cfg?.connected && cfg.provider === 'stripe',
      // The URL the merchant pastes into their provider dashboard (Square, PayPal).
      webhookUrl: `${process.env.BACKEND_URL || ''}/api/public/webhooks/payment`,
    })
  })

  admin.post('/connect', requirePermission('payments:update'), async (c) => {
    const companyId = c.get('user').companyId
    const body = await c.req.json().catch(() => null)
    // Stripe is the business's connected account, as everywhere else in the app: a secret key is refused before it is
    // read, verified or stored — the owner is pointed at Connect Stripe instead.
    if (body && typeof body === 'object' && (body as any).provider === 'stripe') {
      return fail(c, 400, STRIPE_USES_CONNECT, 'stripe_uses_connect', { provider: 'Use Connect Stripe' })
    }
    const parsed = connectSchema.safeParse(body)
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const i of parsed.error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
      return fail(c, 400, 'Invalid payment credentials', 'validation_failed', fields)
    }
    const { provider, mode, secretKey, publishableKey, webhookSecret } = parsed.data

    // Verify the merchant's credentials actually work before saving them — a cheap authenticated read against their
    // own account. Field mapping per provider:
    //   square: secretKey = Access Token, publishableKey = Location ID
    //   paypal: secretKey = Client Secret, publishableKey = Client ID
    try {
      if (provider === 'square') {
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
      logger.warn('[store] payment connect verification failed', { provider, error: err?.message })
      return fail(c, 400, 'These credentials were rejected by the provider. Double-check them.')
    }

    // Merchant pasted a webhook secret → respect it. Otherwise create the webhook for them (most merchants have never
    // made one).
    let finalWebhookSecret = webhookSecret || null
    let webhookNote: string | null = null
    if (!finalWebhookSecret) {
      const auto = await autoCreateWebhook(provider, mode, secretKey, publishableKey)
      if ('secret' in auto) {
        finalWebhookSecret = auto.secret
        logger.info('[store] webhook auto-created', { provider, mode })
      } else {
        webhookNote = auto.warning
        logger.warn('[store] webhook auto-create failed', { provider, error: auto.warning })
      }
    }

    const credentialsEnc = encryptJSON({ secretKey, publishableKey })
    const webhookSecretEnc = finalWebhookSecret ? encrypt(finalWebhookSecret) : null

    const [existing] = await db.select().from(paymentConfig).where(eq(paymentConfig.companyId, companyId)).limit(1)
    const values = {
      provider, mode, credentialsEnc, webhookSecretEnc,
      publishableKey: publishableKey ?? null,
      connected: true, updatedAt: new Date(),
    }
    const [saved] = existing
      ? await db.update(paymentConfig).set(values).where(and(eq(paymentConfig.id, existing.id), eq(paymentConfig.companyId, companyId))).returning()
      : await db.insert(paymentConfig).values({ ...values, companyId }).returning()
    // Which processor and which mode — never a key.
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'payment_config', entityId: saved.id, entityName: saved.provider, metadata: { description: `Payment processor connected — ${saved.provider}, ${saved.mode} mode${existing?.connected ? ' (keys replaced)' : ''}` }, req: c })

    return one(c, { config: { provider: saved.provider, mode: saved.mode, connected: saved.connected }, webhookConfigured: !!finalWebhookSecret, webhookNote })
  })

  admin.post('/disconnect', requirePermission('payments:update'), async (c) => {
    const companyId = c.get('user').companyId
    const [existing] = await db.select().from(paymentConfig).where(eq(paymentConfig.companyId, companyId)).limit(1)
    if (existing) {
      await db.update(paymentConfig).set({ connected: false, updatedAt: new Date() }).where(and(eq(paymentConfig.id, existing.id), eq(paymentConfig.companyId, companyId)))
      await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'payment_config', entityId: existing.id, entityName: existing.provider, metadata: { description: `Payment processor disconnected — ${existing.provider}; the store stops taking orders` }, req: c })
    }
    return done(c)
  })

  return admin
}
