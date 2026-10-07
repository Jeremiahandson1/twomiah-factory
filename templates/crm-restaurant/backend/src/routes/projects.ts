import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { project, contact, job, rfi, changeOrder, punchListItem, activity } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
// One numbering rule for every document in the product — locked, and only ever forwards.
import { nextNumber } from '../shared/invoicing/money.ts'

const app = new Hono()
app.use('*', authenticate)

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('planning'),
  type: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedValue: z.number().optional(),
  budget: z.number().optional(),
  contactId: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(project.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(project.status, status))
  if (search) {
    conditions.push(or(
      ilike(project.name, `%${search}%`),
      ilike(project.number, `%${search}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(project).where(where).orderBy(desc(project.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(project).where(where),
  ])

  // Fetch contacts for each project
  const contactIds = [...new Set(data.filter(p => p.contactId).map(p => p.contactId!))]
  const contacts = contactIds.length > 0
    ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(or(...contactIds.map(cid => eq(contact.id, cid)))!)
    : []
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))

  const dataWithContacts = data.map(p => ({ ...p, contact: p.contactId ? contactMap[p.contactId] || null : null }))

  return c.json({ data: dataWithContacts, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const projects = await db.select({ status: project.status, estimatedValue: project.estimatedValue, budget: project.budget }).from(project).where(eq(project.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: projects.length, planning: 0, active: 0, completed: 0, totalValue: 0 }
  projects.forEach(p => { stats[p.status] = (stats[p.status] || 0) + 1; stats.totalValue += Number(p.estimatedValue || 0) })
  return c.json(stats)
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundProject] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
  if (!foundProject) return c.json({ error: 'Project not found' }, 404)

  // Fetch related data separately
  const [projectContact, jobs, rfis, changeOrders, punchListItems] = await Promise.all([
    foundProject.contactId ? // NAMED columns, never select(). (T32 B2) The whole contact row was serialised here, including
    // `portalToken` — the credential that opens the customer portal AS that client. Anyone with
    // projects:read received it, field and viewer included. Confirmed live on the base CRM.
    db.select({
      id: contact.id, name: contact.name, type: contact.type, email: contact.email, phone: contact.phone, mobile: contact.mobile, address: contact.address, city: contact.city, state: contact.state, zip: contact.zip, company: contact.company, portalEnabled: contact.portalEnabled,
    }).from(contact).where(and(eq(contact.id, foundProject.contactId), eq(contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
    db.select().from(job).where(eq(job.projectId, id)).orderBy(desc(job.createdAt)).limit(10),
    db.select().from(rfi).where(eq(rfi.projectId, id)).limit(10),
    db.select().from(changeOrder).where(eq(changeOrder.projectId, id)).limit(10),
    db.select().from(punchListItem).where(eq(punchListItem.projectId, id)).limit(20),
  ])

  return c.json({ ...foundProject, contact: projectContact[0] || null, jobs, rfis, changeOrders, punchListItems })
})

app.post('/', requirePermission('projects:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = projectSchema.parse(await c.req.json())

  /**
   * PRJ NUMBERS ONLY GO FORWARDS. (T58k)
   *
   * This counted the company's projects and added one, so deleting any project handed its number to
   * the next — and the count ran unlocked, so two created together both saw the same total. The same
   * shape as the CO-030 duplicate the owner reported; found by sweeping EVERY generator rather than
   * only the ones that were named.
   */
  const newProject = await db.transaction(async (tx: any) => {
    const number = await nextNumber(tx, project, project.number, project.companyId, currentUser.companyId, { prefix: 'PRJ', pad: 4 })
    const [row] = await tx.insert(project).values({
    ...data,
      number,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    estimatedValue: data.estimatedValue?.toString(),
    budget: data.budget?.toString(),
    companyId: currentUser.companyId,
    }).returning()
    return row
  })

  return c.json(newProject, 201)
})

app.put('/:id', requirePermission('projects:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = projectSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Project not found' }, 404)

  const [updated] = await db.update(project).set({
    ...data,
    startDate: data.startDate ? new Date(data.startDate) : undefined,
    endDate: data.endDate ? new Date(data.endDate) : undefined,
    estimatedValue: data.estimatedValue !== undefined ? data.estimatedValue.toString() : undefined,
    budget: data.budget !== undefined ? data.budget.toString() : undefined,
    updatedAt: new Date(),
  }).where(eq(project.id, id)).returning()

  return c.json(updated)
})

// Activity timeline — rows either linked to this project directly
// (entityType='project') or via metadata.projectId (portal collaborator actions).
app.get('/:id/activity', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Project not found' }, 404)

  const rows = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.companyId, currentUser.companyId),
        or(
          and(eq(activity.entityType, 'project'), eq(activity.entityId, id)),
          sql`${activity.metadata}->>'projectId' = ${id}`
        )
      )
    )
    .orderBy(desc(activity.createdAt))
    .limit(200)

  return c.json(rows)
})

app.delete('/:id', requirePermission('projects:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Project not found' }, 404)

  await db.delete(project).where(eq(project.id, id))
  return c.body(null, 204)
})

export default app
