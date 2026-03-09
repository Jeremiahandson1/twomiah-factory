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

// GET /reports/:type — dynamic report by type (hours, billing, payroll, compliance, etc.)
app.get('/:type', authenticate, async (c) => {
  const type = c.req.param('type')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  // Known types handled by specific routes above will never reach here
  return c.json({ type, startDate, endDate, data: [], message: `Report type "${type}" — data pending implementation` })
})

// GET /reports/:type/export — CSV/Excel export for a report
app.get('/:type/export', authenticate, async (c) => {
  const type = c.req.param('type')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  return c.json({ type, format: 'csv', startDate, endDate, data: [], message: 'Export pending implementation' })
})

// GET /reports/:type/export-pdf — PDF export for a report
app.get('/:type/export-pdf', authenticate, async (c) => {
  const type = c.req.param('type')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  return c.json({ type, format: 'pdf', startDate, endDate, data: [], message: 'PDF export pending implementation' })
})

export default app
