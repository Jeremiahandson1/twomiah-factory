// /api/selections: selection categories, the option library, a project's selections and their lifecycle (select,
// approve, ordered, received), and the due-soon / overdue reports. Moved from the CRM template's routes/selections.ts
// (templates/crm/backend/src/routes). The registry signs the person in and gates 'selections'; every action, reads
// included, checks selections:* (the template's T32 H1, on the mount).
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createSelectionsService, type SelectionsService } from './selectionsService.ts'

/** What the INSERTs require: the fields the SQL has no fallback for (an empty body is a 400, never a 500). */
const categoryBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough()
const optionBody = z.object({
  categoryId: z.string().min(1, 'Pick a category'),
  name: z.string().min(1, 'Name is required'),
}).passthrough()
const projectSelectionBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough()

const all = <T,>(c: any, rows: T[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

/** `service`: the one the portal also uses, when the caller built it; otherwise built here. */
export function createSelectionsRoutes(d: CrmDeps, service?: SelectionsService) {
  const { requirePermission } = d.permissions
  const selections = service ?? createSelectionsService(d)
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('selections:read'))

  // ── categories ─────────────────────────────────────────────────────────────────────────────────

  app.get('/categories', async (c) => {
    const user = c.get('user')
    let categories = await selections.getCategories(user.companyId)
    // The default categories are seeded on first access when there are none.
    if (categories.length === 0) {
      await selections.seedDefaultCategories(user.companyId)
      categories = await selections.getCategories(user.companyId)
    }
    return all(c, categories)
  })

  app.post('/categories', requirePermission('selections:create'), async (c) => {
    const user = c.get('user')
    const parsed = categoryBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, await selections.createCategory(user.companyId, parsed.data), 201)
  })

  app.post('/categories/seed', requirePermission('selections:create'), async (c) => {
    const user = c.get('user')
    await selections.seedDefaultCategories(user.companyId)
    return done(c)
  })

  // ── options (the product library) ──────────────────────────────────────────────────────────────

  app.get('/options', async (c) => {
    const user = c.get('user')
    const active = c.req.query('active')
    return all(c, await selections.getOptions(user.companyId, {
      categoryId: c.req.query('categoryId'),
      search: c.req.query('search'),
      active: active === 'false' ? false : active === 'all' ? null : true,
    }))
  })

  app.post('/options', requirePermission('selections:create'), async (c) => {
    const user = c.get('user')
    const parsed = optionBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, await selections.createOption(user.companyId, parsed.data), 201)
  })

  // ── project selections ─────────────────────────────────────────────────────────────────────────

  app.get('/project/:projectId', async (c) => {
    const user = c.get('user')
    return all(c, await selections.getProjectSelections(c.req.param('projectId'), user.companyId))
  })

  app.get('/project/:projectId/summary', async (c) => {
    const user = c.get('user')
    return one(c, await selections.getSelectionsSummary(c.req.param('projectId'), user.companyId))
  })

  app.post('/project/:projectId', requirePermission('selections:create'), async (c) => {
    const user = c.get('user')
    const parsed = projectSelectionBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const selection = await selections.createProjectSelection(user.companyId, { ...parsed.data, projectId: c.req.param('projectId') })
    return one(c, selection, 201)
  })

  app.post('/:id/select', requirePermission('selections:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const selection = await selections.makeSelection(c.req.param('id'), user.companyId, { ...body, selectedBy: user.userId })
    return one(c, selection)
  })

  app.post('/:id/approve', requirePermission('selections:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const result = await selections.approveSelection(c.req.param('id'), user.companyId, {
      approvedBy: user.userId,
      createChangeOrder: body.createChangeOrder !== false,
    })
    return one(c, result)
  })

  // A selection that is not this company's (or not there) answered 200 with an empty body in the template; a 404 here.
  app.post('/:id/ordered', requirePermission('selections:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const selection = await selections.markOrdered(c.req.param('id'), user.companyId, { orderedBy: user.userId, ...body })
    if (!selection) return fail(c, 404, 'Selection not found')
    return one(c, selection)
  })

  app.post('/:id/received', requirePermission('selections:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const selection = await selections.markReceived(c.req.param('id'), user.companyId, { receivedBy: user.userId, ...body })
    if (!selection) return fail(c, 404, 'Selection not found')
    return one(c, selection)
  })

  // ── reports ────────────────────────────────────────────────────────────────────────────────────

  app.get('/due-soon', async (c) => {
    const user = c.get('user')
    const days = c.req.query('days')
    return all(c, await selections.getSelectionsDueSoon(user.companyId, { days: parseInt(days!) || 7 }))
  })

  app.get('/overdue', async (c) => {
    const user = c.get('user')
    return all(c, await selections.getOverdueSelections(user.companyId))
  })

  return app
}
