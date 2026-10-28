// Lien waivers: the documents a contractor, sub or supplier signs to waive a mechanic's lien in exchange for
// payment — conditional/unconditional, progress/final — and their workflow (draft → requested → received →
// approved | rejected). Moved from templates/crm/backend/src/routes/lienWaivers.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { lienWaiver, project, contact } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const WAIVER_TYPES = [
  'conditional_progress',
  'unconditional_progress',
  'conditional_final',
  'unconditional_final',
] as const

const lienWaiverSchema = z.object({
  projectId: z.string(),
  vendorId: z.string().optional(),
  vendorName: z.string().min(1),
  vendorType: z.enum(['contractor', 'subcontractor', 'supplier', 'laborer', 'other']).optional(),
  waiverType: z.enum(WAIVER_TYPES),
  throughDate: z.string().optional(),
  amountPrevious: z.number().default(0),
  amountCurrent: z.number().default(0),
  amountTotal: z.number().default(0),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
})

export function createLienWaiverRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Reads gated like the writes: a lien waiver names a subcontractor and what they were paid (T34).
  app.use('*', requirePermission('lien-waivers:read'))

  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const projectId = c.req.query('projectId')
    const waiverType = c.req.query('waiverType')
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '50')

    const conditions = [eq(lienWaiver.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(lienWaiver.status, status))
    if (projectId) conditions.push(eq(lienWaiver.projectId, projectId))
    if (waiverType) conditions.push(eq(lienWaiver.waiverType, waiverType))

    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(lienWaiver).where(where).orderBy(desc(lienWaiver.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(lienWaiver).where(where),
    ]) as [any[], any[]]

    // Enriched with the project and the vendor.
    const projectIds = [...new Set(data.map((w) => w.projectId).filter(Boolean))]
    const vendorIds = [...new Set(data.map((w) => w.vendorId).filter(Boolean) as string[])]
    const projects: any[] = projectIds.length
      ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
      : []
    const vendors: any[] = vendorIds.length
      ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, currentUser.companyId))
      : []
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))
    const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]))

    const enriched = data.map((w) => ({
      ...w,
      project: projectMap[w.projectId] || null,
      vendor: w.vendorId ? vendorMap[w.vendorId] || null : null,
    }))

    return list(c, enriched, { page, limit, total: Number(total) })
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [found] = await db
      .select()
      .from(lienWaiver)
      .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
      .limit(1)
    if (!found) return fail(c, 404, 'Lien waiver not found')

    const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)
    return one(c, { ...found, project: proj || null })
  })

  app.post('/', requirePermission('lien-waivers:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = lienWaiverSchema.parse(await c.req.json())

    const [created] = await db
      .insert(lienWaiver)
      .values({
        ...data,
        amountPrevious: String(data.amountPrevious),
        amountCurrent: String(data.amountCurrent),
        amountTotal: String(data.amountTotal || data.amountPrevious + data.amountCurrent),
        throughDate: data.throughDate ? new Date(data.throughDate) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status: 'draft',
        requestedAt: new Date(),
        companyId: currentUser.companyId,
      } as any)
      .returning()

    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('lien-waivers:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = lienWaiverSchema.partial().parse(await c.req.json())
    const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
    if (data.throughDate) updateData.throughDate = new Date(data.throughDate)
    if (data.dueDate) updateData.dueDate = new Date(data.dueDate)
    if (data.amountPrevious !== undefined) updateData.amountPrevious = String(data.amountPrevious)
    if (data.amountCurrent !== undefined) updateData.amountCurrent = String(data.amountCurrent)
    if (data.amountTotal !== undefined) updateData.amountTotal = String(data.amountTotal)

    const [updated] = await db.update(lienWaiver).set(updateData).where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'Lien waiver not found')
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('lien-waivers:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(lienWaiver).where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Lien waiver not found')
    return c.body(null, 204)
  })

  app.post('/:id/request', requirePermission('lien-waivers:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [updated] = await db
      .update(lienWaiver)
      .set({ status: 'requested', requestedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Lien waiver not found')
    return one(c, updated)
  })

  app.post('/:id/receive', requirePermission('lien-waivers:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const { documentUrl, signedDate } = await c.req.json().catch(() => ({}))
    const [updated] = await db
      .update(lienWaiver)
      .set({
        status: 'received',
        receivedAt: new Date(),
        documentUrl,
        signedDate: signedDate ? new Date(signedDate) : new Date(),
        updatedAt: new Date(),
      } as any)
      .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Lien waiver not found')
    return one(c, updated)
  })

  app.post('/:id/approve', requirePermission('lien-waivers:update'), async (c) => {
    const id = c.req.param('id')
    const currentUser = c.get('user') as any
    const { notes } = await c.req.json().catch(() => ({}))
    const [updated] = await db
      .update(lienWaiver)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        approvedById: currentUser.userId,
        approvalNotes: notes,
        updatedAt: new Date(),
      } as any)
      .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Lien waiver not found')
    return one(c, updated)
  })

  app.post('/:id/reject', requirePermission('lien-waivers:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const { notes } = await c.req.json().catch(() => ({}))
    const [updated] = await db
      .update(lienWaiver)
      .set({ status: 'rejected', rejectedAt: new Date(), approvalNotes: notes, updatedAt: new Date() } as any)
      .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Lien waiver not found')
    return one(c, updated)
  })

  return app
}
