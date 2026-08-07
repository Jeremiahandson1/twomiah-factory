// Cron job: calls the /cleanup endpoint on the API
// Designed to run as a Render Cron Job every hour

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

async function runCleanup() {
  console.log('[Cron] Running cleanup at', new Date().toISOString())
  try {
    const res = await fetch(API_URL + '/api/v1/factory/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET || '' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('[Cron] Cleanup failed:', res.status, data)
      process.exit(1)
    }
    console.log('[Cron] Cleanup result:', JSON.stringify(data))
  } catch (err: any) {
    console.error('[Cron] Cleanup error:', err.message)
    process.exit(1)
  }
}

runCleanup()
