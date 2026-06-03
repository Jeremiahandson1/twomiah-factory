import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import recurringService from '../services/recurring.ts'
import audit from '../services/audit.ts'
import { db } from '../../db/index.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'

const app = new Hono()
app.use('*', authenticate)

// Get all recurring invoices
app.get('/', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')
  const page = c.req.query('page') || '1'
  const limit = c.req.query('limit') || '25'

  const pageNum = parseInt(page)
  const limitNum = parseInt(limit)

  // Delegate to service since recurringInvoice table is not in schema
  // The service handles the complex query with includes
  const data = await recurringService.getRecurringList(user.companyId, {
    status,
    contactId,
    page: pageNum,
    limit: limitNum,
  })

  return c.json(data)
})

// Get recurring invoice stats
app.get('/stats', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const stats = await recurringService.getRecurringStats(user.companyId)
  return c.json(stats)
})

// Get single recurring invoice
app.get('/:id', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  return c.json(recurring)
})

// Create recurring invoice
app.post('/', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const {
    contactId,
    projectId,
    frequency,
    startDate,
    endDate,
    dayOfMonth,
    dayOfWeek,
    lineItems,
    notes,
    terms,
    taxRate,
    discount,
    autoSend,
    paymentTermsDays,
  } = await c.req.json()

  if (!contactId) {
    return c.json({ error: 'Contact is required' }, 400)
  }
  if (!frequency) {
    return c.json({ error: 'Frequency is required' }, 400)
  }
  if (!lineItems || lineItems.length === 0) {
    return c.json({ error: 'At least one line item is required' }, 400)
  }

  const recurring = await recurringService.createRecurring({
    companyId: user.companyId,
    contactId,
    projectId,
    frequency,
    startDate: startDate || new Date(),
    endDate,
    dayOfMonth,
    dayOfWeek,
    lineItems,
    notes,
    terms,
    taxRate,
    discount,
    autoSend,
    paymentTermsDays,
  })

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    entityName: `${recurring.frequency} - $${recurring.total}`,
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(recurring, 201)
})

// Update recurring invoice
app.put('/:id', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const recurring = await recurringService.updateRecurring(id, user.companyId, body)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(recurring)
})

// Pause recurring invoice
app.post('/:id/pause', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  const updated = await recurringService.updateRecurringStatus(id, 'paused')

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    metadata: { from: recurring.status, to: 'paused' },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(updated)
})

// Resume recurring invoice
app.post('/:id/resume', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  const nextRunDate = new Date()
  const updated = await recurringService.updateRecurringStatus(id, 'active', { nextRunDate })

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    metadata: { from: recurring.status, to: 'active' },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(updated)
})

// Cancel recurring invoice
app.post('/:id/cancel', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  const updated = await recurringService.updateRecurringStatus(id, 'cancelled')

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    metadata: { from: recurring.status, to: 'cancelled' },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(updated)
})

// Generate invoice now (manual trigger)
app.post('/:id/generate', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  const { invoice } = await recurringService.generateInvoice(id)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'invoice',
    entityId: invoice.id,
    entityName: invoice.number,
    metadata: { source: 'recurring', recurringId: recurring.id },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(invoice, 201)
})

// Delete recurring invoice
app.delete('/:id', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const recurring = await recurringService.getRecurringById(id, user.companyId)

  if (!recurring) {
    return c.json({ error: 'Recurring invoice not found' }, 404)
  }

  await recurringService.deleteRecurring(id)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'recurring_invoice',
    entityId: recurring.id,
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.body(null, 204)
})

// Process all due recurring (cron endpoint - should be called by scheduler)
app.post('/process', async (c) => {
  // In production, secure this with an API key or internal-only access
  const cronSecret = c.req.header('x-cron-secret')
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const results = await recurringService.processDueRecurring()
  return c.json(results)
})

export default app
