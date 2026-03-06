import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import reporting from '../services/reporting.ts'

const app = new Hono()
app.use('*', authenticate)

// Dashboard summary
app.get('/dashboard', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const summary = await reporting.getDashboardSummary(user.companyId)
  return c.json(summary)
})

// Revenue overview
app.get('/revenue', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getRevenueOverview(user.companyId, { startDate, endDate })
  return c.json(data)
})

// Revenue by month
app.get('/revenue/monthly', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const months = c.req.query('months') || '12'
  const data = await reporting.getRevenueByMonth(user.companyId, { months: parseInt(months) })
  return c.json(data)
})

// Revenue by customer
app.get('/revenue/customers', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const limit = c.req.query('limit') || '10'
  const data = await reporting.getRevenueByCustomer(user.companyId, {
    startDate,
    endDate,
    limit: parseInt(limit),
  })
  return c.json(data)
})

// Job statistics
app.get('/jobs', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getJobStats(user.companyId, { startDate, endDate })
  return c.json(data)
})

// Jobs by type
app.get('/jobs/types', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getJobsByType(user.companyId, { startDate, endDate })
  return c.json(data)
})

// Jobs by assignee
app.get('/jobs/assignees', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getJobsByAssignee(user.companyId, { startDate, endDate })
  return c.json(data)
})

// Project statistics
app.get('/projects', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const data = await reporting.getProjectStats(user.companyId)
  return c.json(data)
})

// Project profitability
app.get('/projects/profitability', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const limit = c.req.query('limit') || '10'
  const data = await reporting.getProjectProfitability(user.companyId, { limit: parseInt(limit) })
  return c.json(data)
})

// Team productivity
app.get('/team', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getTeamProductivity(user.companyId, { startDate, endDate })
  return c.json(data)
})

// Quote statistics
app.get('/quotes', requirePermission('reports:read'), async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const data = await reporting.getQuoteStats(user.companyId, { startDate, endDate })
  return c.json(data)
})

export default app
