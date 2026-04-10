import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import factoryRoutes from './routes/factory.ts'
import qbwcRoutes from './routes/qbwc.ts'

const app = new Hono()

// Health check before logger so it doesn't flood logs (Render pings every 5s)
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

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

app.route('/api/v1/factory', factoryRoutes)
app.route('/api/v1/qbwc', qbwcRoutes)

const port = Number(process.env.PORT || '3001') || 3001
console.log(`[API] Twomiah Factory API running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
