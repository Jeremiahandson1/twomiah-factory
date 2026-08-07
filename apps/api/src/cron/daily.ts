// Cron job: the daily tenant lifecycle sweep.
//
// /internal/trial-check and /internal/renewal-check were both written to be
// "run daily by an external scheduler" — and no such scheduler existed. The
// only cron on the account was the hourly cleanup, so trial warnings, the
// 60/30/7-day domain and subscription renewal warnings, offboard teardown
// pickup and preview follow-ups had never fired once.
//
// Runs both endpoints and fails loudly if either does. Both are idempotent
// (sentinel columns per tenant per window), so a retry never double-emails.

const rawUrl = process.env.RENDER_API_URL || process.env.API_URL || 'https://twomiah-factory-api.onrender.com'
// Render wires API_URL from the web service's hostport — an INTERNAL address
// like "twomiah-factory-api:3001", which serves plain HTTP. Prefixing https://
// onto it makes every request fail with "Unable to connect", which is exactly
// what the hourly cleanup cron has been doing on every run. Only a real
// hostname (with a dot) gets TLS.
const API_URL = /^https?:\/\//.test(rawUrl)
  ? rawUrl
  : (rawUrl.split(':')[0].includes('.') ? 'https://' : 'http://') + rawUrl
const CRON_SECRET = process.env.CRON_SECRET

if (!CRON_SECRET) {
  console.error('[Cron] CRON_SECRET is not set')
  process.exit(1)
}

async function call(path: string): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET || '' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body }
}

async function run() {
  console.log('[Cron] Daily lifecycle sweep at', new Date().toISOString())
  let failed = false

  for (const path of ['/api/v1/factory/internal/trial-check', '/api/v1/factory/internal/renewal-check']) {
    try {
      const { ok, body } = await call(path)
      console.log(`[Cron] ${path}:`, ok ? 'ok' : 'FAILED', JSON.stringify(body))
      // The endpoints collect their own per-tenant errors rather than throwing,
      // so surface those too instead of reporting a false success.
      if (!ok || (Array.isArray(body?.errors) && body.errors.length > 0)) failed = true
    } catch (err: any) {
      console.error(`[Cron] ${path} error:`, err?.message || err)
      failed = true
    }
  }

  if (failed) process.exit(1)
  console.log('[Cron] Daily lifecycle sweep complete')
}

run()
