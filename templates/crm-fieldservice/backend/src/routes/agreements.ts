import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import agreements from '../services/agreements.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// PLANS (Templates)
// ============================================

app.get('/plans', async (c) => {
  const user = c.get('user') as any
  const active = c.req.query('active')
  const plans = await agreements.getPlans(user.companyId, {
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(plans)
})

app.post('/plans', requirePermission('agreements:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const plan = await agreements.createPlan(user.companyId, body)
  return c.json(plan, 201)
})

app.put('/plans/:id', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await agreements.updatePlan(id, user.companyId, body)
  return c.json({ success: true })
})

// ============================================
// CUSTOMER AGREEMENTS
// ============================================

app.get('/', async (c) => {
  const user = c.get('user') as any
  const { status, contactId, expiringSoon, page, limit } = c.req.query() as any
  const data = await agreements.getAgreements(user.companyId, {
    status,
    contactId,
    expiringSoon: expiringSoon === 'true',
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
  })
  return c.json(data)
})

app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const agreement = await agreements.getAgreement(id, user.companyId)
  if (!agreement) return c.json({ error: 'Agreement not found' }, 404)
  return c.json(agreement)
})

app.post('/', requirePermission('agreements:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const agreement = await agreements.createAgreement(user.companyId, body)
  return c.json(agreement, 201)
})

app.put('/:id', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await agreements.updateAgreement(id, user.companyId, body)
  const agreement = await agreements.getAgreement(id, user.companyId)
  return c.json(agreement)
})

app.post('/:id/cancel', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { reason } = await c.req.json()
  await agreements.cancelAgreement(id, user.companyId, reason)
  return c.json({ success: true })
})

app.post('/:id/renew', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const agreement = await agreements.renewAgreement(id, user.companyId)
  return c.json(agreement)
})

// ============================================
// VISITS
// ============================================

app.get('/visits/upcoming', async (c) => {
  const user = c.get('user') as any
  const days = c.req.query('days')
  const visits = await agreements.getUpcomingVisits(user.companyId, {
    days: parseInt(days as string) || 30,
  })
  return c.json(visits)
})

app.post('/:id/visits', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const visit = await agreements.scheduleVisit(id, user.companyId, body)
  return c.json(visit, 201)
})

app.post('/visits/:visitId/complete', requirePermission('agreements:update'), async (c) => {
  const user = c.get('user') as any
  const visitId = c.req.param('visitId')
  const body = await c.req.json()
  const visit = await agreements.completeVisit(visitId, user.companyId, body)
  return c.json(visit)
})

// ============================================
// BILLING
// ============================================

app.get('/billing/due', async (c) => {
  const user = c.get('user') as any
  const due = await agreements.getAgreementsDueForBilling(user.companyId)
  return c.json(due)
})

app.post('/:id/bill', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const invoice = await agreements.processAgreementBilling(id, user.companyId)
  return c.json(invoice)
})

// ============================================
// REPORTS
// ============================================

app.get('/reports/stats', async (c) => {
  const user = c.get('user') as any
  const stats = await agreements.getAgreementStats(user.companyId)
  return c.json(stats)
})

app.get('/reports/expiring', async (c) => {
  const user = c.get('user') as any
  const days = c.req.query('days')
  const expiring = await agreements.getExpiringAgreements(user.companyId, parseInt(days as string) || 60)
  return c.json(expiring)
})

export default app
