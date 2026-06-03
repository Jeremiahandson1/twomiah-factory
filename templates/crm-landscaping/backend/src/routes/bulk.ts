import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import bulk from '../services/bulk.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Contacts bulk operations
app.post('/contacts/update', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, updates } = await c.req.json()
  if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

  const allowedFields = ['type', 'status', 'source']
  const safeUpdates: Record<string, any> = {}
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field]
    }
  }

  const count = await bulk.bulkUpdateContacts(user.companyId, ids, safeUpdates)

  audit.log({
    action: 'BULK_UPDATE',
    entity: 'contacts',
    metadata: { count, updates: safeUpdates },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ updated: count })
})

app.post('/contacts/delete', requirePermission('contacts:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

  const count = await bulk.bulkDeleteContacts(user.companyId, ids)

  audit.log({
    action: 'BULK_DELETE',
    entity: 'contacts',
    metadata: { count },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ deleted: count })
})

// Projects bulk operations
app.post('/projects/update', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, updates } = await c.req.json()
  if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

  const allowedFields = ['status', 'managerId']
  const safeUpdates: Record<string, any> = {}
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field]
    }
  }

  const count = await bulk.bulkUpdateProjects(user.companyId, ids, safeUpdates)

  audit.log({
    action: 'BULK_UPDATE',
    entity: 'projects',
    metadata: { count, updates: safeUpdates },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ updated: count })
})

app.post('/projects/delete', requirePermission('projects:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

  const count = await bulk.bulkDeleteProjects(user.companyId, ids)

  audit.log({
    action: 'BULK_DELETE',
    entity: 'projects',
    metadata: { count },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ deleted: count })
})

app.post('/projects/archive', requirePermission('projects:update'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkArchiveProjects(user.companyId, ids)
  return c.json({ archived: count })
})

// Jobs bulk operations
app.post('/jobs/update', requirePermission('jobs:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, updates } = await c.req.json()
  if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)

  const allowedFields = ['status', 'priority', 'type', 'assignedToId']
  const safeUpdates: Record<string, any> = {}
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field]
    }
  }

  const count = await bulk.bulkUpdateJobs(user.companyId, ids, safeUpdates)

  audit.log({
    action: 'BULK_UPDATE',
    entity: 'jobs',
    metadata: { count, updates: safeUpdates },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ updated: count })
})

app.post('/jobs/delete', requirePermission('jobs:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkDeleteJobs(user.companyId, ids)

  audit.log({
    action: 'BULK_DELETE',
    entity: 'jobs',
    metadata: { count },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ deleted: count })
})

app.post('/jobs/assign', requirePermission('jobs:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, assignedToId } = await c.req.json()
  const count = await bulk.bulkAssignJobs(user.companyId, ids, assignedToId)
  return c.json({ updated: count })
})

app.post('/jobs/reschedule', requirePermission('jobs:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, scheduledDate } = await c.req.json()
  const count = await bulk.bulkRescheduleJobs(user.companyId, ids, scheduledDate)
  return c.json({ updated: count })
})

app.post('/jobs/status', requirePermission('jobs:update'), async (c) => {
  const user = c.get('user') as any
  const { ids, status } = await c.req.json()
  const count = await bulk.bulkUpdateJobStatus(user.companyId, ids, status)
  return c.json({ updated: count })
})

// Invoices bulk operations
app.post('/invoices/delete', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkDeleteInvoices(user.companyId, ids)

  audit.log({
    action: 'BULK_DELETE',
    entity: 'invoices',
    metadata: { count },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ deleted: count })
})

app.post('/invoices/mark-paid', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkMarkInvoicesPaid(user.companyId, ids)
  return c.json({ updated: count })
})

// Quotes bulk operations
app.post('/quotes/delete', requirePermission('quotes:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkDeleteQuotes(user.companyId, ids)
  return c.json({ deleted: count })
})

// Time entries bulk operations
app.post('/time/approve', requirePermission('time:update'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkApproveTimeEntries(user.companyId, ids, user.userId)
  return c.json({ approved: count })
})

app.post('/time/delete', requirePermission('time:delete'), async (c) => {
  const user = c.get('user') as any
  const { ids } = await c.req.json()
  const count = await bulk.bulkDeleteTimeEntries(user.companyId, ids)
  return c.json({ deleted: count })
})

export default app
