// Cron job: calls the /cleanup endpoint on the API
// Designed to run as a Render Cron Job every hour

const rawUrl = process.env.API_URL || 'http://localhost:3001'
const API_URL = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl
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
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
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
