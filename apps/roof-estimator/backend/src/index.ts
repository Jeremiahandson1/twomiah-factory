// Twomiah Roof Estimator — Standalone Service
// Professional roof measurement reports with satellite imagery, AI detection, and 3D visualization.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import authRoutes from './routes/auth.ts'
import reportRoutes from './routes/reports.ts'

const app = new Hono()

// CORS
app.use('*', cors({ origin: '*' }))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'twomiah-roof-estimator' }))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/reports', reportRoutes)

// Serve frontend static files (built by Vite)
app.use('/*', serveStatic({ root: '../frontend/dist' }))
app.get('/*', serveStatic({ root: '../frontend/dist', path: 'index.html' }))

// Start
const port = Number(process.env.PORT) || 3002
console.log(`[Roof Estimator] Starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}
