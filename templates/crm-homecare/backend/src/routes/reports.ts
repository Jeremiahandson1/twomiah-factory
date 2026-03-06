import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()

// TODO: Convert from raw SQL to Drizzle queries
// Original reports.js has full implementation

app.get('/summary', authenticate, async (c) => {
  return c.json({ message: 'Reports coming soon', data: {} })
})

app.get('/hours', authenticate, async (c) => {
  return c.json({ data: [] })
})

app.get('/billing', authenticate, requireAdmin, async (c) => {
  return c.json({ data: [] })
})

app.get('/payroll', authenticate, requireAdmin, async (c) => {
  return c.json({ data: [] })
})

export default app
