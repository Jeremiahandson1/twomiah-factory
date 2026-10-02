import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { project, contact, job, rfi, changeOrder, punchListItem, activity } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * WHO MAY SEE WHAT A PROJECT IS WORTH. (T34)
 *
 * The project page showed a FIELD user Budget $40,000, approved change orders +$3,327 and Contract
 * value $48,450. `projects:read` is the permission a technician needs to open the job they are
 * standing on; it was also the only thing between them and the contract.
 *
 * `invoices:read` is the line that already exists for exactly this: owner, admin, manager and
 * viewer have it, field does not. It is the permission that separates the people who see money from
 * the people who do the work, so the money on a project moves behind it rather than inventing a new
 * verb nobody has been granted.
 *
 * Three places leaked, not one — the detail, the list and the stats roll-up. Fixing only the page
 * the report named would have left the same figures on the list behind it. (feedback: fix by rule)
 */
const MONEY_PERMISSION = 'invoices:read'
const maySeeMoney = async (c: any): Promise<boolean> => {
  const u = c.get('user') as any
  try { return hasPermission(u?.role, MONEY_PERMISSION, await getExtraPermissions(u?.userId)) } catch { return false }
}

/**
 * THE MONEY IS WHAT IS WITHHELD — NOT THE FACT THAT THE WORK CHANGED. (T35-6, corrected in T37 N6)
 *
 * Two wrong answers before this one, in opposite directions.
 *
 * T34 stripped the project's own money and left the embedded change-order rows alone, claiming their
 * `amount` was "gated one layer up" by `change-orders:read`. It was not — this route selects the
 * rows itself — so field read $2,877 / $680 / $300 / −$615 off the project page and could add the
 * approved ones up to recover the contract change the stripping had just removed.
 *
 * T35-6 then gated the whole list on `change-orders:read` and handed field an empty array. That
 * stopped the leak and printed a FALSEHOOD: the project page's summary read "Change Orders 0" on a
 * project carrying eight of them, which is worse than withholding, because a zero is an answer.
 *
 * So: every caller gets the rows — the count, the number, the title, the status, the days — and only
 * a caller who may see money gets `amount`. A technician standing on the job can know that the scope
 * changed and what the change is called; what the client agreed to pay for it is money, and money is
 * what `invoices:read` draws the line on.
 */
const CO_MONEY_FIELDS = ['amount'] as const
const withoutChangeOrderMoney = <T extends Record<string, any>>(row: T): T => {
  const out: Record<string, any> = { ...row }
  for (const k of CO_MONEY_FIELDS) if (k in out) delete out[k]
  return out as T
}

/**
 * The money columns the `project` table actually has — checked against the schema, not guessed.
 * Stripped together, so none of them can be forgotten separately.
 */
const MONEY_FIELDS = ['budget', 'estimatedValue'] as const
const withoutMoney = <T extends Record<string, any>>(row: T): T => {
  const out: Record<string, any> = { ...row }
  for (const k of MONEY_FIELDS) if (k in out) delete out[k]
  return out as T
}

const projectFields = z.object({
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
  estimatedValue: z.number().min(0, 'Estimated value cannot be negative').optional(),
  budget: z.number().min(0, 'Budget cannot be negative').optional(),
  // An unselected client dropdown posts contactId:"" — coerce it to undefined
  // so it doesn't hit the contact FK and throw a 500.
  contactId: z.string().optional().transform(v => (v === '' ? undefined : v)),
  notes: z.string().optional(),
})

// Cross-field rule lives on the create schema. Updates use projectFields.partial()
// (a ZodEffects can't be made partial), which is fine — a partial update rarely
// carries both dates to compare.
const dateOrderCheck = (d: { startDate?: string; endDate?: string }) =>
  !d.startDate || !d.endDate || new Date(d.endDate) >= new Date(d.startDate)
const projectSchema = projectFields.refine(dateOrderCheck, {
  message: 'End date must be on or after the start date', path: ['endDate'],
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = Math.min(+(c.req.query('limit') || '50'), 100)

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
  // The list carries budget and estimatedValue on every row — the same figures as the page.
  const money = await maySeeMoney(c)
  const rows = money ? dataWithContacts : dataWithContacts.map(withoutMoney)

  return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const projects = await db.select({ status: project.status, estimatedValue: project.estimatedValue, budget: project.budget }).from(project).where(eq(project.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: projects.length, planning: 0, active: 0, completed: 0, totalValue: 0 }
  projects.forEach(p => { stats[p.status] = (stats[p.status] || 0) + 1; stats.totalValue += Number(p.estimatedValue || 0) })
  // The counts are work, not money — a technician may know how many projects are active. The VALUE
  // is the contract total of every project the company holds, which is the most sensitive figure on
  // the roll-up and was the one nobody thought to gate.
  if (!(await maySeeMoney(c))) delete stats.totalValue
  return c.json(stats)
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundProject] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
  if (!foundProject) return c.json({ error: 'Project not found' }, 404)

  // Fetch related data separately
  const [projectContact, jobs, rfis, changeOrders, punchListItems] = await Promise.all([
    // NAMED columns, never select(). (T32 B2)
    //
    // This was `db.select().from(contact)`, so the response carried every column the contact row has
    // — including `portalToken`, the credential that opens the customer portal AS that client: their
    // quotes, invoices, saved payment method, change-order approvals. Verified on the live tenant: a
    // 64-character token in the body of GET /api/projects/:id, handed to anyone with projects:read,
    // which includes field and viewer.
    //
    // The project LIST was already safe because it selects id and name explicitly. A projection makes
    // "what a client may see about a client" a decision in one visible place rather than whatever the
    // table happens to hold.
    foundProject.contactId ? db.select({
      id: contact.id, name: contact.name, type: contact.type, email: contact.email, phone: contact.phone,
      mobile: contact.mobile, address: contact.address, city: contact.city, state: contact.state,
      zip: contact.zip, company: contact.company, portalEnabled: contact.portalEnabled,
    }).from(contact).where(and(eq(contact.id, foundProject.contactId), eq(contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
    db.select().from(job).where(eq(job.projectId, id)).orderBy(desc(job.createdAt)).limit(10),
    db.select().from(rfi).where(eq(rfi.projectId, id)).limit(10),
    // Every caller gets the rows; the money comes off below for whoever may not see it. (T37 N6)
    db.select().from(changeOrder).where(eq(changeOrder.projectId, id)).limit(10),
    db.select().from(punchListItem).where(eq(punchListItem.projectId, id)).limit(20),
  ])

  /**
   * THE CONTRACT VALUE IS COMPUTED HERE, NOT ON THE SCREEN. (T32 H4)
   *
   * The project page added up `changeOrders` and printed "Change Orders +$2,262" — every change
   * order it had been sent, drafts and pending ones included. A draft is a thing somebody is still
   * typing; a pending one is a thing the client has not agreed to. Neither is contract money, and
   * showing them as contract money overstated the job by whatever was in flight.
   *
   * Two faults, one cause. The sum was done on the screen over `changeOrders`, which is also capped
   * at 10 rows above — so on a project with eleven change orders the figure was wrong for a second,
   * quieter reason. A money figure is now computed once, on the server, over ALL of them.
   *
   * `pending` is counted as not-yet-agreed alongside draft and submitted, because that is what the
   * selections flow used to stamp (T32 H3).
   */
  const coTotals = await db.select({
    status: changeOrder.status,
    amount: sql<string>`COALESCE(SUM(${changeOrder.amount}), 0)`,
    n: count(),
  })
    .from(changeOrder)
    .where(and(eq(changeOrder.projectId, id), eq(changeOrder.companyId, currentUser.companyId)))
    .groupBy(changeOrder.status)

  const sumWhere = (statuses: string[]) => coTotals
    .filter((r) => statuses.includes(r.status))
    .reduce((s, r) => s + Number(r.amount || 0), 0)
  const countWhere = (statuses: string[]) => coTotals
    .filter((r) => statuses.includes(r.status))
    .reduce((s, r) => s + Number(r.n || 0), 0)

  const approvedChangeOrders = Math.round(sumWhere(['approved']) * 100) / 100
  const pendingChangeOrders = Math.round(sumWhere(['draft', 'submitted', 'pending']) * 100) / 100
  const originalValue = Number(foundProject.estimatedValue || 0)

  /*
   * No money for somebody who may not see it — and that means the whole `financials` block AND the
   * raw columns `...foundProject` spreads, which is where Budget $40,000 came from. Returning the
   * block and forgetting the spread would have been a fix that changed nothing. (T34)
   *
   * The change-order list is NOT the exception I first thought it was. This comment used to say the
   * amounts on those rows were "already answered one layer up" by change-orders:read — they were
   * not, because this route selected them itself. T35-6: field read every amount off the project
   * page and could add the approved ones back up to the contract change. The list is gated above
   * now, on the module's own permission.
   */
  if (!(await maySeeMoney(c))) {
    return c.json({
      ...withoutMoney(foundProject),
      contact: projectContact[0] || null,
      jobs, rfis, punchListItems,
      // The changes themselves, without what they cost. See withoutChangeOrderMoney. (T37 N6)
      changeOrders: changeOrders.map(withoutChangeOrderMoney),
    })
  }

  return c.json({
    ...foundProject,
    contact: projectContact[0] || null,
    jobs, rfis, changeOrders, punchListItems,
    financials: {
      budget: foundProject.budget === null ? null : Number(foundProject.budget),
      /** What the project was worth before anybody changed it — the value less what approval added. */
      originalValue: Math.round((originalValue - approvedChangeOrders) * 100) / 100,
      /** Agreed changes only. This is the figure that belongs next to the contract. */
      approvedChangeOrders,
      approvedCount: countWhere(['approved']),
      /** In flight: raised, not agreed. Shown separately so nobody adds it in by eye. */
      pendingChangeOrders,
      pendingCount: countWhere(['draft', 'submitted', 'pending']),
      /** `estimatedValue` already carries every approved change order — approval moves it. */
      revisedContractValue: Math.round(originalValue * 100) / 100,
    },
  })
})

app.post('/', requirePermission('projects:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = projectSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db.select({ value: count() }).from(project).where(eq(project.companyId, currentUser.companyId))
  const [newProject] = await db.insert(project).values({
    ...data,
    number: `PRJ-${String(Number(cnt) + 1).padStart(4, '0')}`,
    startDate: data.startDate ? new Date(data.startDate) : null,
    endDate: data.endDate ? new Date(data.endDate) : null,
    estimatedValue: data.estimatedValue?.toString(),
    budget: data.budget?.toString(),
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newProject, 201)
})

app.put('/:id', requirePermission('projects:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = projectFields.partial().parse(await c.req.json())

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
