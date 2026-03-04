import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import factoryRoutes from './routes/factory.ts'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.PLATFORM_URL || '',
    ].filter(Boolean)
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
