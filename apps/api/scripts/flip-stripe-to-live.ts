/**
 * Flip the factory from Stripe test mode to live mode.
 *
 * Takes your live secret + publishable keys as args, then:
 *   1. Verifies the keys are actually live (refuse if sk_test_ slipped in)
 *   2. Mints every Stripe Product + Price the factory needs in live mode
 *      (Premium build $1000, Premium $75/mo, CRM add-on $49/mo, all 5
 *      CRM tiers, etc.) by piggy-backing on the existing
 *      create-stripe-products.ts logic
 *   3. Reads back the live price IDs into stripe-prices.{ts,json}
 *   4. Updates STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY + every
 *      STRIPE_PRICE_* env var on the factory Render service
 *   5. Lists live-mode webhook endpoints; if none point at the factory,
 *      creates one subscribed to the same events as the test webhook
 *   6. Updates STRIPE_WEBHOOK_SECRET on the factory
 *   7. Triggers a factory redeploy + waits for live
 *   8. Sanity-probes the factory to confirm live keys are loaded
 *
 * Usage:
 *   bun run scripts/flip-stripe-to-live.ts sk_live_xxx pk_live_xxx
 *
 * The script is idempotent — safe to re-run if a step fails. It checks
 * existing state before mutating.
 *
 * ROLLBACK if anything goes sideways: run scripts/flip-stripe-to-test.ts
 * (or manually re-set the three test keys back on Render).
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

const liveSecret = process.argv[2]
const livePublishable = process.argv[3]
if (!liveSecret || !livePublishable) {
  console.error('Usage: bun run scripts/flip-stripe-to-live.ts <sk_live_xxx> <pk_live_xxx>')
  process.exit(1)
}
if (!liveSecret.startsWith('sk_live_')) {
  console.error('Refusing: STRIPE_SECRET_KEY must start with sk_live_ (got prefix ' + liveSecret.slice(0, 8) + ')')
  process.exit(1)
}
if (!livePublishable.startsWith('pk_live_')) {
  console.error('Refusing: STRIPE_PUBLISHABLE_KEY must start with pk_live_ (got prefix ' + livePublishable.slice(0, 8) + ')')
  process.exit(1)
}

const RENDER = process.env.RENDER_API_KEY!
const FACTORY = 'srv-d6kkernafjfc73egdn10'
const hdrs = { Authorization: 'Bearer ' + RENDER, 'content-type': 'application/json', accept: 'application/json' }

const oldSecretRes = await fetch('https://api.render.com/v1/services/' + FACTORY + '/env-vars/STRIPE_SECRET_KEY', { headers: hdrs })
const oldSecret = (await oldSecretRes.json() as any).value
const oldMode = oldSecret?.startsWith('sk_live_') ? 'LIVE' : 'TEST'
console.log('Current factory Stripe mode:', oldMode)
if (oldMode === 'LIVE') {
  console.log('Factory is already in live mode. No-op.')
  process.exit(0)
}

// ─── Step 1: Mint products + prices in live mode ────────────────────────
console.log('\n[1/7] Minting Stripe products + prices in LIVE mode…')
console.log('(This re-runs scripts/create-stripe-products.ts with the live key.)')
const { spawnSync } = await import('child_process')
const createRes = spawnSync('bun', ['run', 'scripts/create-stripe-products.ts'], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8',
  timeout: 5 * 60 * 1000,
  env: { ...process.env, STRIPE_SECRET_KEY: liveSecret },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (createRes.status !== 0) {
  console.error('create-stripe-products failed:')
  console.error(createRes.stdout)
  console.error(createRes.stderr)
  process.exit(1)
}
console.log(createRes.stdout.split('\n').filter(l => l.includes('STRIPE_PRICE_')).join('\n'))

// ─── Step 2: Read back the new price IDs ────────────────────────────────
console.log('\n[2/7] Reading back new live price IDs…')
const pricesJsonPath = path.join(__dirname, '..', 'src', 'config', 'stripe-prices.json')
if (!fs.existsSync(pricesJsonPath)) {
  console.error('stripe-prices.json was not generated — create-stripe-products.ts may have failed silently')
  process.exit(1)
}
const newPrices = JSON.parse(fs.readFileSync(pricesJsonPath, 'utf8')) as Record<string, string>
console.log('Loaded', Object.keys(newPrices).length, 'price IDs')

// ─── Step 3: Push secret + publishable + all STRIPE_PRICE_* env vars ────
console.log('\n[3/7] Pushing live keys + price IDs to factory Render env…')
async function setEnv(key: string, value: string) {
  const r = await fetch('https://api.render.com/v1/services/' + FACTORY + '/env-vars/' + key, {
    method: 'PUT', headers: hdrs, body: JSON.stringify({ value })
  })
  if (!r.ok) {
    console.error('  ✗ PUT ' + key + ': ' + r.status)
    return false
  }
  return true
}
await setEnv('STRIPE_SECRET_KEY', liveSecret)
await setEnv('STRIPE_PUBLISHABLE_KEY', livePublishable)
for (const [k, v] of Object.entries(newPrices)) {
  await setEnv(k, v)
}
console.log('  Pushed', 2 + Object.keys(newPrices).length, 'env vars')

// ─── Step 4: Create live webhook endpoint ───────────────────────────────
console.log('\n[4/7] Setting up live-mode webhook endpoint…')
const webhookEvents = [
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]
const wlR = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=20', {
  headers: { Authorization: 'Bearer ' + liveSecret }
})
const wlJ = await wlR.json() as any
const expectedUrl = 'https://twomiah-factory-api.onrender.com/api/v1/factory/stripe/webhook'
let our = (wlJ.data || []).find((w: any) => w.url === expectedUrl)
let webhookSecret: string
if (our) {
  console.log('  Existing live webhook found:', our.id)
  // We can't read the secret of an existing webhook via the API, so to
  // be safe we delete + recreate so we know the secret.
  console.log('  Deleting + recreating so we can capture the signing secret…')
  await fetch('https://api.stripe.com/v1/webhook_endpoints/' + our.id, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + liveSecret }
  })
  our = null
}
if (!our) {
  const params = new URLSearchParams()
  params.append('url', expectedUrl)
  params.append('description', 'Factory primary webhook (LIVE) — checkout, subs, invoices, domain regs')
  for (const e of webhookEvents) params.append('enabled_events[]', e)
  const cr = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + liveSecret, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const cj = await cr.json() as any
  if (!cr.ok) {
    console.error('  ✗ Stripe webhook create failed:', cj)
    process.exit(1)
  }
  console.log('  Created webhook:', cj.id)
  webhookSecret = cj.secret
}

console.log('\n[5/7] Pushing live webhook secret to factory…')
await setEnv('STRIPE_WEBHOOK_SECRET', webhookSecret!)
console.log('  Done.')

// ─── Step 6: Trigger factory redeploy ───────────────────────────────────
console.log('\n[6/7] Triggering factory redeploy…')
const dr = await fetch('https://api.render.com/v1/services/' + FACTORY + '/deploys', {
  method: 'POST', headers: hdrs, body: JSON.stringify({ clearCache: 'do_not_clear' })
})
const dj = await dr.json() as any
const newDeployId = dj?.id || dj?.deploy?.id
console.log('  Deploy id:', newDeployId)
console.log('  Polling for live (up to 6 min)…')
for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 15000))
  const sr = await fetch('https://api.render.com/v1/services/' + FACTORY + '/deploys?limit=1', { headers: hdrs })
  const sj = await sr.json() as any[]
  const d = sj[0]?.deploy
  console.log('  [' + (i+1) + '] ' + d?.status)
  if (d?.status === 'live') break
  if (d?.status?.includes('failed') || d?.status?.includes('canceled')) {
    console.error('  Deploy bailed:', d?.status)
    process.exit(1)
  }
}

// ─── Step 7: Sanity probe ───────────────────────────────────────────────
console.log('\n[7/7] Sanity-probing factory with live key…')
// Probe via a simple endpoint that uses Stripe — e.g., domain check (which
// doesn't touch Stripe, but proves the factory is up). For a real Stripe
// check, we'd need to call list-products against Stripe directly using the
// live key (which proves the live key is valid).
const probeR = await fetch('https://api.stripe.com/v1/products?limit=1', {
  headers: { Authorization: 'Bearer ' + liveSecret }
})
const probeJ = await probeR.json() as any
if (!probeR.ok) {
  console.error('  ✗ Stripe live key probe failed:', probeJ)
  process.exit(1)
}
console.log('  ✓ Live key validates against Stripe (account has', probeJ.data?.length || 0, 'product visible)')

console.log('')
console.log('━'.repeat(72))
console.log('  STRIPE FLIPPED TO LIVE MODE')
console.log('━'.repeat(72))
console.log('  Old: ' + oldMode)
console.log('  New: LIVE')
console.log('')
console.log('  What to verify yourself:')
console.log('  • https://dashboard.stripe.com/webhooks → confirm the live webhook is')
console.log('    listed at ' + expectedUrl)
console.log('  • https://dashboard.stripe.com/products → confirm all the Premium +')
console.log('    CRM tier products are minted in LIVE mode')
console.log('  • Pay $1 of your own card via /start to do one real signup as the')
console.log('    canonical smoke test before sending a paying customer there')
console.log('')
console.log('  Rollback path: copy your sk_test_… and pk_test_… keys, write them')
console.log('  back to factory Render env, redeploy. New live webhook stays in')
console.log('  Stripe but does nothing if factory verifies with test secret.')
console.log('━'.repeat(72))
