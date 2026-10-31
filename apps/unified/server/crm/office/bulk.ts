// Bulk changes from the list screens: update, delete, assign, reschedule, archive, approve many records at once.
// Moved from templates/crm/backend/src/routes/bulk.ts; the work is the shared bulk service (d.services.bulk). The
// registry signs the person in; each action keeps the template's permission and audit row.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { JOB_DISPATCH_PERMISSION } from '@twomiah/tenant-backend'
import { and, eq } from 'drizzle-orm'
import { contact } from '../../db/schema/index.ts'
import { completionRefusal, jobsForCompletion } from '../field/checklistRoutes.ts'

/** Only the named fields of `updates`, the ones a bulk change may set. */
const pick = (updates: Record<string, any>, allowedFields: string[]) => {
  const safeUpdates: Record<string, any> = {}
  for (const field of allowedFields) if (updates[field] !== undefined) safeUpdates[field] = updates[field]
  return safeUpdates
}

export function createBulkRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const bulk = d.services.bulk
  const app = new Hono<AppEnv>()
  const noIds = (c: any) => fail(c, 400, 'No IDs provided')

  // Contacts
  app.post('/contacts/update', requirePermission('contacts:update'), async (c) => {
    const user = c.get('user') as any
    const { ids, updates } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const safeUpdates = pick(updates, ['type', 'status', 'source'])
    const count = await bulk.bulkUpdateContacts(user.companyId, ids, safeUpdates)
    d.audit.log({ req: c, action: 'BULK_UPDATE', entity: 'contacts', metadata: { count, updates: safeUpdates }, userId: user.userId, companyId: user.companyId })
    return one(c, { updated: count })
  })

  app.post('/contacts/delete', requirePermission('contacts:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!Array.isArray(ids) || !ids.length) return noIds(c)
    /**
     * EACH CONTACT BY THE ONE CONTACT-DELETE RULE (CrmDeps.contactDeleter — tenant-backend createContactDeleter, with the
     * vertical's guards, built in modules/crm.ts). This door used to delete the lot with no guard at all: a salon client
     * with appointments, visits and a membership went, which the contact's own Delete refuses (salon live test,
     * 2026-10-25). Now one by one: those that pass are deleted (their visits' photo files with them — the deleter's
     * beforeDelete), the rest are refused, each with the single Delete's own sentence.
     */
    const deleter = d.contactDeleter
    if (!deleter) throw new Error('The contact-delete rule is not wired (CrmDeps.contactDeleter).')
    const deletedIds: string[] = []
    const refused: Array<{ id: string; name: string | null; error: string }> = []
    for (const id of [...new Set(ids.map(String))]) {
      const out = await deleter.remove(user.companyId, id)
      if (out.deleted) {
        deletedIds.push(id)
        d.realtime.emitToCompany(user.companyId, d.realtime.EVENTS.CONTACT_DELETED, { id })
      } else {
        const [row] = out.status === 404 ? [] : await d.db.select({ name: contact.name }).from(contact).where(and(eq(contact.id, id), eq(contact.companyId, user.companyId))).limit(1)
        refused.push({ id, name: row?.name ?? null, error: out.body.error })
      }
    }
    d.audit.log({ req: c, action: 'BULK_DELETE', entity: 'contacts', metadata: { count: deletedIds.length, deletedIds, refused: refused.map((r) => r.id) }, userId: user.userId, companyId: user.companyId })
    return one(c, { deleted: deletedIds.length, deletedIds, refused })
  })

  // Projects
  app.post('/projects/update', requirePermission('projects:update'), async (c) => {
    const user = c.get('user') as any
    const { ids, updates } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const safeUpdates = pick(updates, ['status', 'managerId'])
    const count = await bulk.bulkUpdateProjects(user.companyId, ids, safeUpdates)
    d.audit.log({ req: c, action: 'BULK_UPDATE', entity: 'projects', metadata: { count, updates: safeUpdates }, userId: user.userId, companyId: user.companyId })
    return one(c, { updated: count })
  })

  app.post('/projects/delete', requirePermission('projects:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const count = await bulk.bulkDeleteProjects(user.companyId, ids)
    d.audit.log({ req: c, action: 'BULK_DELETE', entity: 'projects', metadata: { count }, userId: user.userId, companyId: user.companyId })
    return one(c, { deleted: count })
  })

  app.post('/projects/archive', requirePermission('projects:update'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const count = await bulk.bulkArchiveProjects(user.companyId, ids)
    return one(c, { archived: count })
  })

  // Jobs
  app.post('/jobs/update', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const user = c.get('user') as any
    const { ids, updates } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const safeUpdates = pick(updates, ['status', 'priority', 'type', 'assignedToId'])
    // A required checklist unfinished: no job is completed by a bulk move either (crm/field/checklistRoutes.ts completionRefusal).
    if (safeUpdates.status === 'completed') {
      const why = await completionRefusal(d, user.companyId, await jobsForCompletion(d, user.companyId, ids))
      if (why) return fail(c, 400, why, 'checklist_outstanding')
    }
    const count = await bulk.bulkUpdateJobs(user.companyId, ids, safeUpdates)
    d.audit.log({ req: c, action: 'BULK_UPDATE', entity: 'jobs', metadata: { count, updates: safeUpdates }, userId: user.userId, companyId: user.companyId })
    return one(c, { updated: count })
  })

  app.post('/jobs/delete', requirePermission('jobs:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const count = await bulk.bulkDeleteJobs(user.companyId, ids)
    d.audit.log({ req: c, action: 'BULK_DELETE', entity: 'jobs', metadata: { count }, userId: user.userId, companyId: user.companyId })
    return one(c, { deleted: count })
  })

  app.post('/jobs/assign', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const user = c.get('user') as any
    const { ids, assignedToId } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { updated: await bulk.bulkAssignJobs(user.companyId, ids, assignedToId) })
  })

  app.post('/jobs/reschedule', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const user = c.get('user') as any
    const { ids, scheduledDate } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { updated: await bulk.bulkRescheduleJobs(user.companyId, ids, scheduledDate) })
  })

  app.post('/jobs/status', requirePermission('jobs:update'), requirePermission(JOB_DISPATCH_PERMISSION), async (c) => {
    const user = c.get('user') as any
    const { ids, status } = await c.req.json()
    if (!ids?.length) return noIds(c)
    if (status === 'completed') {
      const why = await completionRefusal(d, user.companyId, await jobsForCompletion(d, user.companyId, ids))
      if (why) return fail(c, 400, why, 'checklist_outstanding')
    }
    // Moving INTO a status runs its moment for each job, as the job routes do (packages/tenant-backend jobs.ts jobHookFor).
    return one(c, { updated: await bulk.bulkUpdateJobStatus(user.companyId, ids, status, user.userId) })
  })

  // Invoices
  app.post('/invoices/delete', requirePermission('invoices:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    const count = await bulk.bulkDeleteInvoices(user.companyId, ids)
    d.audit.log({ req: c, action: 'BULK_DELETE', entity: 'invoices', metadata: { count }, userId: user.userId, companyId: user.companyId })
    return one(c, { deleted: count })
  })

  app.post('/invoices/mark-paid', requirePermission('invoices:update'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { updated: await bulk.bulkMarkInvoicesPaid(user.companyId, ids) })
  })

  // Quotes
  app.post('/quotes/delete', requirePermission('quotes:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { deleted: await bulk.bulkDeleteQuotes(user.companyId, ids) })
  })

  // Time entries
  app.post('/time/approve', requirePermission('time:update'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { approved: await bulk.bulkApproveTimeEntries(user.companyId, ids, user.userId) })
  })

  app.post('/time/delete', requirePermission('time:delete'), async (c) => {
    const user = c.get('user') as any
    const { ids } = await c.req.json()
    if (!ids?.length) return noIds(c)
    return one(c, { deleted: await bulk.bulkDeleteTimeEntries(user.companyId, ids) })
  })

  return app
}
