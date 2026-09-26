/**
 * Submittals — Construction tier feature.
 *
 * Submittals are shop drawings, product data, samples, and mockups that
 * a contractor submits to an architect/owner for approval before ordering
 * materials or fabricating. Core construction workflow.
 *
 * The `submittal` table was already defined in db/schema.ts but had no
 * routes exposing it. This file is the missing CRUD + workflow API.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { submittal, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

const submittalSchema = z.object({
  projectId: z.string(),
  subject: z.string().min(1),
  specSection: z.string().optional(),
  description: z.string().optional(),
  submittalType: z.enum(['shop_drawing', 'product_data', 'sample', 'mockup', 'other']).default('product_data'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
  attachments: z.array(z.string()).optional(),
})

// List submittals for the tenant, with optional status/project filters
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(submittal.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(submittal.status, status))
  if (projectId) conditions.push(eq(submittal.projectId, projectId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(submittal).where(where).orderBy(desc(submittal.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(submittal).where(where),
  ])

  // Enrich with project names
  const projectIds = [...new Set(data.map((s) => s.projectId))]
  const projects = projectIds.length
    ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
    : []
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

  const enriched = data.map((s) => ({ ...s, project: projectMap[s.projectId] || null }))

  return c.json({ data: enriched, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [found] = await db
    .select()
    .from(submittal)
    .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Submittal not found' }, 404)

  const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)

  return c.json({ ...found, project: proj || null })
})

app.post('/', requirePermission('submittals:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = submittalSchema.parse(await c.req.json())

  // Auto-assign the next submittal number for this project
  const [{ value: cnt }] = await db
    .select({ value: count() })
    .from(submittal)
    .where(and(eq(submittal.companyId, currentUser.companyId), eq(submittal.projectId, data.projectId)))

  const [created] = await db
    .insert(submittal)
    .values({
      title: data.subject,
      projectId: data.projectId,
      specSection: data.specSection,
      description: data.description,
      number: `SUB-${String(Number(cnt) + 1).padStart(3, '0')}`,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      notes: [data.submittalType, data.priority, data.assignedTo].filter(Boolean).join(' | ') || null,
      companyId: currentUser.companyId,
    } as any)
    .returning()

  return c.json(created, 201)
})

app.put('/:id', requirePermission('submittals:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = submittalSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [updated] = await db.update(submittal).set(updateData).where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).returning()
  if (!updated) return c.json({ error: 'Submittal not found' }, 404)
  return c.json(updated)
})

app.delete('/:id', requirePermission('submittals:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(submittal).where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Submittal not found' }, 404)
  return c.body(null, 204)
})

// Workflow: submitted → reviewed → approved / revise_resubmit / rejected
app.post('/:id/submit', requirePermission('submittals:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [updated] = await db
    .update(submittal)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() } as any)
    .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Submittal not found' }, 404)
  return c.json(updated)
})

app.post('/:id/approve', requirePermission('submittals:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(submittal)
    .set({ status: 'approved', approvedAt: new Date(), reviewNotes: notes, updatedAt: new Date() } as any)
    .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Submittal not found' }, 404)
  return c.json(updated)
})

app.post('/:id/reject', requirePermission('submittals:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(submittal)
    .set({ status: 'rejected', reviewNotes: notes, updatedAt: new Date() } as any)
    .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Submittal not found' }, 404)
  return c.json(updated)
})

app.post('/:id/revise', requirePermission('submittals:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(submittal)
    .set({ status: 'revise_resubmit', reviewNotes: notes, updatedAt: new Date() } as any)
    .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Submittal not found' }, 404)
  return c.json(updated)
})

export default app
