/**
 * Register the Factory's Stripe CONNECT webhook endpoint — the one Stripe uses for events on tenants'
 * connected accounts (a business that clicked "Connect Stripe" in its CRM). The Factory forwards each
 * event to the owning tenant (routes/factory/billing.ts POST /stripe/connect-webhook).
 *
 *   bun run scripts/register-connect-webhook.ts
 *
 * Reads STRIPE_SECRET_KEY from apps/api/.env (test or live — the endpoint lives in whichever mode the
 * key is). An endpoint already at the URL gains any missing event in place (its secret unchanged — nothing
 * else to do). With `--recreate`, or when there is none, it is (re)created — a signing secret is only
 * returned at creation. Then it prints the secret; if RENDER_API_KEY is set it also writes
 * STRIPE_CONNECT_WEBHOOK_SECRET onto the Factory Render service (per-key PUT — never the whole list)
 * so the next Factory deploy picks it up. Idempotent: safe to re-run.
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = raw.replace(/\r$/, '').match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
  }
}

const secretKey = process.env.STRIPE_SECRET_KEY
if (!secretKey) { console.error('STRIPE_SECRET_KEY missing (apps/api/.env)'); process.exit(1) }
const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'
const factoryUrl = (process.env.FACTORY_PUBLIC_URL || 'https://twomiah-factory-api.onrender.com').replace(/\/$/, '')
const webhookUrl = factoryUrl + '/api/v1/factory/stripe/connect-webhook'
// The events the tenant Stripe module handles (packages/tenant-backend/src/payments/stripe.ts handleWebhook), and the
// unified store's on a connected account (apps/unified server/crm/store/checkout/paymentRoutes.ts STRIPE_WEBHOOK_EVENTS:
// its chargebacks too — 2026-10-26, when the store moved onto Connect) and the owner removing Twomiah from their Stripe
// (account.application.deauthorized, which the module and billing.ts already act on).
const EVENTS = [
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'checkout.session.completed', 'charge.refunded',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated',
  'account.application.deauthorized',
]

const sh = (p: string, init?: RequestInit) => fetch('https://api.stripe.com/v1' + p, {
  ...init,
  headers: { Authorization: 'Bearer ' + secretKey, ...(init?.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
})

console.log(`Stripe mode: ${mode}`)
console.log(`Connect webhook URL: ${webhookUrl}`)

const listRes = await sh('/webhook_endpoints?limit=100')
const list = await listRes.json() as any
if (!listRes.ok) { console.error('list failed:', list?.error?.message || listRes.status); process.exit(1) }
// An endpoint already there gains the missing events IN PLACE (POST /v1/webhook_endpoints/:id): its signing secret stays
// the same, so STRIPE_CONNECT_WEBHOOK_SECRET and the Factory need nothing. Only `--recreate` deletes and makes it anew.
const existing = (list.data || []).find((ep: any) => ep.url === webhookUrl)
if (existing && !process.argv.includes('--recreate')) {
  const has: string[] = existing.enabled_events || []
  const want = [...new Set([...has, ...EVENTS])]
  if (has.includes('*') || EVENTS.every((e) => has.includes(e))) { console.log('Connect endpoint', existing.id, 'already listens to every event — nothing changed.'); process.exit(0) }
  const up = new URLSearchParams()
  for (const ev of want) up.append('enabled_events[]', ev)
  const upRes = await sh('/webhook_endpoints/' + existing.id, { method: 'POST', body: up.toString() })
  const upd = await upRes.json() as any
  if (!upRes.ok) { console.error('update failed:', upd?.error?.message || upRes.status); process.exit(1) }
  console.log('Updated Connect endpoint', existing.id, 'in place — events:', (upd.enabled_events || want).join(', '))
  console.log('The signing secret is unchanged: nothing to set on the Factory.')
  process.exit(0)
}
for (const ep of list.data || []) {
  if (ep.url === webhookUrl) {
    console.log('Deleting existing endpoint (secret is unrecoverable):', ep.id)
    const d = await sh('/webhook_endpoints/' + ep.id, { method: 'DELETE' })
    if (!d.ok) { console.error('delete failed:', d.status); process.exit(1) }
  }
}

const body = new URLSearchParams()
body.set('url', webhookUrl)
body.set('connect', 'true')
body.set('description', `Factory Connect webhook (${mode}) — tenants' connected-account events, forwarded per tenant`)
for (const ev of EVENTS) body.append('enabled_events[]', ev)
const createRes = await sh('/webhook_endpoints', { method: 'POST', body: body.toString() })
const created = await createRes.json() as any
if (!createRes.ok) { console.error('create failed:', created?.error?.message || createRes.status); process.exit(1) }
console.log('Created Connect endpoint:', created.id, 'events:', EVENTS.join(', '))
console.log('')
console.log('STRIPE_CONNECT_WEBHOOK_SECRET=' + created.secret)
console.log('')

const render = process.env.RENDER_API_KEY
const FACTORY_SERVICE = process.env.FACTORY_RENDER_SERVICE_ID || 'srv-d6kkernafjfc73egdn10'
if (render) {
  const r = await fetch('https://api.render.com/v1/services/' + FACTORY_SERVICE + '/env-vars/STRIPE_CONNECT_WEBHOOK_SECRET', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + render, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ value: created.secret }),
  })
  console.log(r.ok ? 'Wrote STRIPE_CONNECT_WEBHOOK_SECRET on the Factory Render service (applies from the next deploy).' : 'Render env write failed: HTTP ' + r.status + ' — set STRIPE_CONNECT_WEBHOOK_SECRET on the Factory service by hand.')
} else {
  console.log('RENDER_API_KEY not set — set STRIPE_CONNECT_WEBHOOK_SECRET on the Factory Render service by hand, then redeploy the Factory.')
}
console.log('Verify in Stripe → Developers → Webhooks: the endpoint is listed under "Listen to events on Connected accounts".')
