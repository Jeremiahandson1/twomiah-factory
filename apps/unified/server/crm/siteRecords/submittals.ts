// Submittals: shop drawings, product data, samples and mockups a contractor sends an architect or owner for approval
// before ordering or fabricating. Moved from templates/crm/backend/src/routes/submittals.ts. The registry signs the
// person in and applies the 'submittals' feature gate; reading is gated too (the viewer and field seats have no
// submittals:read — E2E run 1, 10/14).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { submittal, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'

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

// The page and the form say "subject"; the table says title. One mapping, used by every reply.
const shape = <T extends { title: string }>(s: T) => ({ ...s, subject: s.title })
// A submittal is written as a draft and goes out on Submit. (The column's default is 'pending', which no screen
// offered a button for: an office submittal could never be submitted, so never approved.)
const DRAFTS = ['draft', 'pending']

// Workflow: draft → submitted → approved / revise_resubmit / rejected; a revised one is submitted again. The review's
// notes are kept on the row and also added to its running notes, with who and when, the way the architect's portal
// records a revision request (packages/tenant-backend/src/portal/portal.ts).
const FROM: Record<string, string[]> = {
  submit: [...DRAFTS, 'revise_resubmit', 'revise'],
  approve: ['submitted'],
  reject: ['submitted'],
  revise: ['submitted'],
}
const TO: Record<string, string> = { submit: 'submitted', approve: 'approved', reject: 'rejected', revise: 'revise_resubmit' }
const VERB: Record<string, string> = { approve: 'Approved', reject: 'Rejected', revise: 'Revision requested' }

export function createSubmittalRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // List submittals for the tenant, with optional status/project filters
  app.get('/', requirePermission('submittals:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const projectId = c.req.query('projectId')
    const page = Math.max(1, Math.floor(+(c.req.query('page') || '1')) || 1)
    const limit = Math.min(200, Math.max(1, Math.floor(+(c.req.query('limit') || '50')) || 50))

    const conditions = [eq(submittal.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(submittal.status, status))
    if (projectId) conditions.push(eq(submittal.projectId, projectId))

    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(submittal).where(where).orderBy(desc(submittal.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(submittal).where(where),
    ])

    // Enrich with project names
    const projectIds = [...new Set(data.map((s: any) => s.projectId))]
    const projects: any[] = projectIds.length
      ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
      : []
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

    const enriched = data.map((s: any) => ({ ...shape(s), project: projectMap[s.projectId] || null }))

    return list(c, enriched, { page, limit, total: Number(total) })
  })

  app.get('/:id', requirePermission('submittals:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [found] = await db
      .select()
      .from(submittal)
      .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId)))
      .limit(1)
    if (!found) return fail(c, 404, 'Submittal not found')

    const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)

    return one(c, { ...shape(found), project: proj || null })
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
        submittalType: data.submittalType,
        priority: data.priority,
        assignedTo: data.assignedTo || null,
        status: 'draft',
        companyId: currentUser.companyId,
      })
      .returning()

    return one(c, shape(created), 201)
  })

  app.put('/:id', requirePermission('submittals:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const { subject, dueDate, attachments: _attachments, ...rest } = submittalSchema.partial().parse(await c.req.json())
    const updateData: Partial<typeof submittal.$inferInsert> = { ...rest, updatedAt: new Date() }
    if (subject !== undefined) updateData.title = subject
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null

    // Scoped to the caller's company like the reads above, not matched on id alone.
    const [updated] = await db.update(submittal).set(updateData).where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'Submittal not found')
    return one(c, shape(updated))
  })

  app.delete('/:id', requirePermission('submittals:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(submittal).where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Submittal not found')
    return c.body(null, 204)
  })

  for (const action of Object.keys(TO)) {
    app.post(`/:id/${action}`, requirePermission('submittals:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({})) as { notes?: unknown }
      const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 4000) : null
      const [found] = await db.select().from(submittal)
        .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).limit(1)
      if (!found) return fail(c, 404, 'Submittal not found')
      if (!FROM[action].includes(found.status)) {
        return fail(c, 409, `A submittal that is ${found.status.replace(/_/g, ' ')} cannot be ${action === 'submit' ? 'submitted' : TO[action].replace(/_/g, ' ')}.`)
      }
      const now = new Date()
      const set: Partial<typeof submittal.$inferInsert> = { status: TO[action], updatedAt: now }
      if (action === 'submit') set.submittedDate = now
      else {
        const [me] = await db.select({ firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.id, currentUser.userId)).limit(1)
        const who = [me?.firstName, me?.lastName].filter(Boolean).join(' ') || currentUser.email || 'the office'
        set.reviewNotes = notes
        if (action === 'approve') { set.approvedDate = now; set.approvedBy = who }
        if (notes) set.notes = (found.notes ? `${found.notes}\n\n` : '') + `[${VERB[action]} by ${who} on ${now.toISOString().slice(0, 10)}] ${notes}`
      }
      const [updated] = await db.update(submittal).set(set)
        .where(and(eq(submittal.id, id), eq(submittal.companyId, currentUser.companyId))).returning()
      return one(c, shape(updated))
    })
  }

  return app
}
