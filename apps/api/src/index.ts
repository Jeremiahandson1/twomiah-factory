import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import factoryRoutes from './routes/factory.ts'
import qbwcRoutes from './routes/qbwc.ts'
import briefRoutes from './routes/brief.ts'
import { startScheduler } from './services/scheduler.ts'

const app = new Hono()

// Health check before logger so it doesn't flood logs (Render pings every 5s)
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// Outbound-IP echo — used to find this service's external IP when
// configuring API whitelists (Namecheap, etc.) on third-party
// vendors. Calls api.ipify.org from inside the service so the
// reported IP is whatever IP the third party will see us hit them
// from. Public — no secret data, just an IPv4 string.
app.get('/internal/whoami-ip', async (c) => {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) })
    const j = await r.json() as { ip?: string }
    return c.json({ ip: j.ip || null, source: 'ipify' })
  } catch (e: any) {
    return c.json({ error: e.message }, 502)
  }
})

app.use('*', logger())
// Limit request body to 15 MB (covers branding data URLs)
app.use('*', bodyLimit({ maxSize: 15 * 1024 * 1024, onError: (c) => c.json({ error: 'Request body too large (max 15 MB)' }, 413) }))
app.use('*', cors({
  origin: (origin) => {
    // No origin = non-browser client (QBWC, curl, etc.) — allow through
    if (!origin) return '*'
    const allowed = [
      'https://twomiah-factory-platform.onrender.com',
      'https://twomiah.com',
      'https://www.twomiah.com',
    ]
    if (process.env.NODE_ENV !== 'production') {
      allowed.push('http://localhost:5173', 'http://localhost:3000')
    }
    if (process.env.PLATFORM_URL) allowed.push(process.env.PLATFORM_URL)
    return allowed.includes(origin) ? origin : ''
  },
  credentials: true,
}))

// Curated hero library — self-hosted, immutable stock imagery the composer
// references (see config/heroLibrary.ts). Public by design.
app.get('/hero-library/:group/:file', async (c) => {
  const group = c.req.param('group')
  const file = c.req.param('file')
  if (!/^[a-z0-9-]+$/.test(group) || !/^[a-z0-9.-]+\.(jpg|jpeg|png|webp)$/.test(file) || file.includes('..')) return c.text('Not found', 404)
  const fs = await import('fs')
  const path = await import('path')
  const p = path.join(import.meta.dir, '..', 'assets', 'hero-library', group, file)
  if (!fs.existsSync(p)) return c.text('Not found', 404)
  const ext = file.split('.').pop()
  c.header('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(fs.readFileSync(p))
})

app.route('/api/v1/factory', factoryRoutes)
app.route('/api/v1/qbwc', qbwcRoutes)
app.route('/api/v1/brief', briefRoutes)

// Also expose factory routes at root so the public OAuth + internal
// cron endpoints work at their canonical URLs (e.g. /calendar/google/auth,
// /internal/booking-reminders). Tenants and external schedulers build
// these URLs without a /api/v1/factory prefix; the prefixed mount
// above is retained for the platform admin SPA's existing calls.
app.route('/', factoryRoutes)

const port = Number(process.env.PORT || '3001') || 3001
console.log(`[API] Twomiah Factory API running on port ${port}`)

startScheduler(port)

export default {
  port,
  fetch: app.fetch,
}
