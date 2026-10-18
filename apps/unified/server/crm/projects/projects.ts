// Projects: the list, the roll-up, one project with its work and money, its activity timeline. Moved from
// templates/crm/backend/src/routes/projects.ts; the money tiers and their reasons are as the template wrote them.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { nextNumber } from '@twomiah/tenant-backend'
import { project, contact, job, rfi, changeOrder, punchListItem } from '../../db/schema/index.ts'
import { changeOrderTotalsByStatus, projectActivity } from '../../data/projects.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

/**
 * WHO MAY SEE WHAT A PROJECT IS WORTH (T34): `invoices:read` is the line between the people who see money and
 * the people who do the work, so a project's money sits behind it — on the detail, the list and the roll-up.
 */
const MONEY_PERMISSION = 'invoices:read'

/**
 * The change-order rows every caller gets: the work, never the money or the signing record (T37 N6 / N9). An
 * allow-list, so a column added later stays hidden until somebody decides otherwise.
 */
const CHANGE_ORDER_WORK_FIELDS = [
  'id', 'projectId', 'number', 'title', 'description', 'reason', 'status',
  'daysAdded', 'submittedDate', 'approvedDate', 'approvedBy', 'createdAt', 'updatedAt',
] as const
const changeOrderForWork = (row: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const k of CHANGE_ORDER_WORK_FIELDS) if (k in row) out[k] = row[k]
  return out
}

/**
 * Three tiers (T42): no invoices:read → the work; + invoices:read → and what it is worth; + change-orders:update
 * → and who signed it, from where, with what hash. The middle tier is built by ADDING to the allow-list.
 */
const CHANGE_ORDER_MONEY_FIELDS = ['amount'] as const
const changeOrderWithMoney = (row: Record<string, any>): Record<string, any> => {
  const out = changeOrderForWork(row)
  for (const k of CHANGE_ORDER_MONEY_FIELDS) if (k in row) out[k] = row[k]
  return out
}

/**
 * The activity feed puts the figure in the prose and the signing evidence in the metadata (T42): a currency
 * amount is redacted without invoices:read, the signing metadata is withheld without change-orders:update, and
 * `companyId` is dropped for everybody.
 */
const ACTIVITY_FIELDS = ['id', 'userId', 'entityType', 'entityId', 'action', 'description', 'metadata', 'createdAt'] as const
const ACTIVITY_META_FIELDS = ['actorName', 'actorRole', 'projectId', 'notes'] as const
const MONEY_IN_PROSE = /\$\s?\d[\d,]*(?:\.\d{2})?/g
// A function, not a replacement string: a literal $ in String.replace is a substitution token.
const redactMoney = (v: unknown) => (typeof v === 'string' ? v.replace(MONEY_IN_PROSE, () => '$—') : v)
const activityFor = (row: Record<string, any>, opts: { money: boolean; signoff: boolean }) => {
  const out: Record<string, any> = {}
  for (const k of ACTIVITY_FIELDS) if (k in row) out[k] = row[k]
  if (!opts.signoff && out.metadata && typeof out.metadata === 'object') {
    const meta: Record<string, any> = {}
    for (const k of ACTIVITY_META_FIELDS) if (k in out.metadata) meta[k] = out.metadata[k]
    out.metadata = meta
  }
  if (!opts.money) {
    out.description = redactMoney(out.description)
    if (out.metadata && typeof out.metadata === 'object' && 'notes' in out.metadata) {
      out.metadata = { ...out.metadata, notes: redactMoney(out.metadata.notes) }
    }
  }
  return out
}

/** The money columns the `project` table has, stripped together so none is forgotten separately. */
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
  // An unselected client dropdown posts contactId:"" — coerced to undefined so it doesn't hit the contact FK.
  contactId: z.string().optional().transform(v => (v === '' ? undefined : v)),
  notes: z.string().optional(),
})

// The cross-field rule lives on the create schema; updates use projectFields.partial().
const dateOrderCheck = (d: { startDate?: string; endDate?: string }) =>
  !d.startDate || !d.endDate || new Date(d.endDate) >= new Date(d.startDate)
const projectSchema = projectFields.refine(dateOrderCheck, {
  message: 'End date must be on or after the start date', path: ['endDate'],
})

export function createProjectRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const maySeeMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user') as any
    try { return hasPermission(u?.role, MONEY_PERMISSION, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const maySignOffChangeOrders = async (c: any): Promise<boolean> => {
    const u = c.get('user') as any
    try { return hasPermission(u?.role, 'change-orders:update', await getExtraPermissions(u?.userId)) } catch { return false }
  }

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

    const contactIds = [...new Set((data as any[]).filter(p => p.contactId).map(p => p.contactId!))]
    const contacts: any[] = contactIds.length > 0
      ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(or(...contactIds.map(cid => eq(contact.id, cid)))!)
      : []
    const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))

    const dataWithContacts = (data as any[]).map(p => ({ ...p, contact: p.contactId ? contactMap[p.contactId] || null : null }))
    // The list carries budget and estimatedValue on every row — the same figures as the page.
    const money = await maySeeMoney(c)
    const rows = money ? dataWithContacts : dataWithContacts.map(withoutMoney)

    return list(c, rows, { page, limit, total: Number(total) })
  })

  app.get('/stats', async (c) => {
    const currentUser = c.get('user') as any
    const projects: any[] = await db.select({ status: project.status, estimatedValue: project.estimatedValue, budget: project.budget }).from(project).where(eq(project.companyId, currentUser.companyId))
    const stats: Record<string, number> = { total: projects.length, planning: 0, active: 0, completed: 0, totalValue: 0 }
    projects.forEach(p => { stats[p.status] = (stats[p.status] || 0) + 1; stats.totalValue += Number(p.estimatedValue || 0) })
    // The counts are work; the VALUE is the contract total of every project, the most sensitive figure here.
    if (!(await maySeeMoney(c))) delete stats.totalValue
    return one(c, stats)
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [foundProject] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
    if (!foundProject) return fail(c, 404, 'Project not found')

    const [projectContact, jobs, rfis, changeOrders, punchListItems] = await Promise.all([
      // NAMED columns, never select(): the contact row carries `portalToken`, the customer portal's credential (T32 B2).
      foundProject.contactId ? db.select({
        id: contact.id, name: contact.name, type: contact.type, email: contact.email, phone: contact.phone,
        mobile: contact.mobile, address: contact.address, city: contact.city, state: contact.state,
        zip: contact.zip, company: contact.company, portalEnabled: contact.portalEnabled,
      }).from(contact).where(and(eq(contact.id, foundProject.contactId), eq(contact.companyId, currentUser.companyId))).limit(1) : Promise.resolve([]),
      db.select().from(job).where(eq(job.projectId, id)).orderBy(desc(job.createdAt)).limit(10),
      db.select().from(rfi).where(eq(rfi.projectId, id)).limit(10),
      // Every change order, newest first; the money comes off below for whoever may not see it (T37 N6, T58d).
      db.select().from(changeOrder).where(eq(changeOrder.projectId, id)).orderBy(desc(changeOrder.createdAt)),
      db.select().from(punchListItem).where(eq(punchListItem.projectId, id)).limit(20),
    ]) as any[][]

    // The contract value is computed here, over ALL change orders, never on the screen (T32 H4). `pending` counts
    // as not-yet-agreed beside draft and submitted.
    const coTotals = await changeOrderTotalsByStatus(db, id, currentUser.companyId)

    const sumWhere = (statuses: string[]) => coTotals
      .filter((r) => statuses.includes(r.status))
      .reduce((s, r) => s + Number(r.amount || 0), 0)
    const countWhere = (statuses: string[]) => coTotals
      .filter((r) => statuses.includes(r.status))
      .reduce((s, r) => s + Number(r.n || 0), 0)

    const approvedChangeOrders = Math.round(sumWhere(['approved']) * 100) / 100
    const pendingChangeOrders = Math.round(sumWhere(['draft', 'submitted', 'pending']) * 100) / 100
    const originalValue = Number(foundProject.estimatedValue || 0)

    // How many there really are, not how many the capped lists returned (T48).
    const [jobCount, rfiCount, punchCount] = await Promise.all([
      db.select({ n: count() }).from(job).where(eq(job.projectId, id)),
      db.select({ n: count() }).from(rfi).where(eq(rfi.projectId, id)),
      db.select({ n: count() }).from(punchListItem).where(eq(punchListItem.projectId, id)),
    ]) as any[][]
    const counts = {
      jobs: Number(jobCount[0]?.n || 0),
      rfis: Number(rfiCount[0]?.n || 0),
      changeOrders: coTotals.reduce((s, r) => s + Number(r.n || 0), 0),
      punchListItems: Number(punchCount[0]?.n || 0),
    }

    // No money for somebody who may not see it: the `financials` block AND the raw columns the spread carries (T34).
    if (!(await maySeeMoney(c))) {
      return one(c, {
        ...withoutMoney(foundProject),
        contact: projectContact[0] || null,
        jobs, rfis, punchListItems,
        changeOrders: changeOrders.map(changeOrderForWork),
        counts,
      })
    }

    // The money tier. The signing record needs its own answer — see changeOrderWithMoney (T42).
    const signoff = await maySignOffChangeOrders(c)
    return one(c, {
      ...foundProject,
      contact: projectContact[0] || null,
      jobs, rfis, punchListItems,
      changeOrders: signoff ? changeOrders : changeOrders.map(changeOrderWithMoney),
      counts,
      financials: {
        budget: foundProject.budget === null ? null : Number(foundProject.budget),
        /** What the project was worth before anybody changed it — the value less what approval added. */
        originalValue: Math.round((originalValue - approvedChangeOrders) * 100) / 100,
        /** Agreed changes only. */
        approvedChangeOrders,
        approvedCount: countWhere(['approved']),
        /** In flight: raised, not agreed. */
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

    // PRJ numbers only go forwards: locked, never reissued after a delete (T58k).
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

    return one(c, newProject, 201)
  })

  app.put('/:id', requirePermission('projects:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = projectFields.partial().parse(await c.req.json())

    const [existing] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Project not found')

    const [updated] = await db.update(project).set({
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      estimatedValue: data.estimatedValue !== undefined ? data.estimatedValue.toString() : undefined,
      budget: data.budget !== undefined ? data.budget.toString() : undefined,
      updatedAt: new Date(),
    }).where(eq(project.id, id)).returning()

    return one(c, updated)
  })

  // The activity timeline: rows linked to this project directly or through metadata.projectId.
  app.get('/:id/activity', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId)))
      .limit(1)
    if (!existing) return fail(c, 404, 'Project not found')

    const rows = await projectActivity(db, currentUser.companyId, id)

    const money = await maySeeMoney(c)
    const signoff = await maySignOffChangeOrders(c)
    const shown = rows.map((r) => activityFor(r, { money, signoff }))
    return list(c, shown, { page: 1, limit: shown.length, total: shown.length })
  })

  app.delete('/:id', requirePermission('projects:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [existing] = await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Project not found')

    await db.delete(project).where(eq(project.id, id))
    return c.body(null, 204)
  })

  return app
}
