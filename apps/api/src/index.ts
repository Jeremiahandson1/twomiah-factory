import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { bodyLimit } from 'hono/body-limit'
import factoryRoutes from './routes/factory.ts'

const app = new Hono()

app.use('*', logger())
// Limit request body to 15 MB (covers branding data URLs)
app.use('*', bodyLimit({ maxSize: 15 * 1024 * 1024, onError: (c) => c.json({ error: 'Request body too large (max 15 MB)' }, 413) }))
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:3000',
    ]
    if (process.env.PLATFORM_URL) allowed.push(process.env.PLATFORM_URL)
    return allowed.includes(origin) ? origin : ''
  },
  credentials: true,
}))

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

app.route('/api/v1/factory', factoryRoutes)

const port = parseInt(process.env.PORT || '3001')
console.log(`[API] Twomiah Factory API running on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
