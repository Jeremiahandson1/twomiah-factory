// AIA G702/G703 pay applications: the G702 summary computed from the G703 continuation-sheet lines, and the
// workflow draft → signed → submitted → paid. Moved from templates/crm/backend/src/routes/aiaForms.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { aiaForm, project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

// One G703 row: a schedule-of-values item with its scheduled value, work to date, percent, balance and retainage.
const lineItemSchema = z.object({
  itemNumber: z.string(),
  description: z.string(),
  scheduledValue: z.number(),
  workPreviouslyCompleted: z.number().default(0),
  workThisPeriod: z.number().default(0),
  materialsStored: z.number().default(0),
  totalCompletedAndStored: z.number(),
  percentComplete: z.number(),
  balanceToFinish: z.number(),
  retainage: z.number().default(0),
})

const aiaFormSchema = z.object({
  projectId: z.string(),
  formType: z.enum(['G702', 'G703']),
  applicationNumber: z.number().int().positive(),
  periodTo: z.string(), // ISO date
  contractSum: z.number(),
  netChangeByChangeOrders: z.number().default(0),
  retainagePercent: z.number().default(10),
  lessPreviousCertificates: z.number().default(0),
  lineItems: z.array(lineItemSchema),
  notes: z.string().optional(),
})

/** The G702 summary from the line items. */
function computeSummary(input: z.infer<typeof aiaFormSchema>) {
  const contractSumToDate = input.contractSum + input.netChangeByChangeOrders
  const totalCompletedAndStored = input.lineItems.reduce((s, li) => s + li.totalCompletedAndStored, 0)
  const retainageAmount = (totalCompletedAndStored * input.retainagePercent) / 100
  const totalEarnedLessRetainage = totalCompletedAndStored - retainageAmount
  const currentPaymentDue = totalEarnedLessRetainage - input.lessPreviousCertificates
  // G702 line 9, BALANCE TO FINISH INCLUDING RETAINAGE = line 3 less line 6 (contract sum to date less total earned
  // less retainage), so the retainage held back is still in what the owner owes.
  const balanceToFinish = contractSumToDate - totalEarnedLessRetainage

  return {
    contractSumToDate,
    totalCompletedAndStored,
    retainageAmount,
    totalEarnedLessRetainage,
    currentPaymentDue,
    balanceToFinish,
  }
}

export function createAiaFormRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // READS are gated too, above the routes: an AIA form is the billing position with the owner (T34).
  app.use('*', requirePermission('aia-forms:read'))

  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const projectId = c.req.query('projectId')
    const status = c.req.query('status')
    const formType = c.req.query('formType')

    const conditions = [eq(aiaForm.companyId, currentUser.companyId)]
    if (projectId) conditions.push(eq(aiaForm.projectId, projectId))
    if (status) conditions.push(eq(aiaForm.status, status))
    if (formType) conditions.push(eq(aiaForm.formType, formType))

    const where = and(...conditions)
    const forms: any[] = await db.select().from(aiaForm).where(where).orderBy(desc(aiaForm.applicationNumber))

    const projects: any[] = forms.length
      ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
      : []
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

    const rows = forms.map((f) => ({ ...f, project: projectMap[f.projectId] || null }))
    return listAll(c, rows)
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [found] = await db
      .select()
      .from(aiaForm)
      .where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId)))
      .limit(1)
    if (!found) return fail(c, 404, 'AIA form not found')

    const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)
    return one(c, { ...found, project: proj || null })
  })

  app.post('/', requirePermission('aia-forms:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = aiaFormSchema.parse(await c.req.json())

    // The application number moves past any already used for this project and form type.
    const [existing] = await db.select({ value: count() }).from(aiaForm)
      .where(and(eq(aiaForm.companyId, currentUser.companyId), eq(aiaForm.projectId, data.projectId), eq(aiaForm.formType, data.formType)))
    const appNum = Math.max(data.applicationNumber, Number(existing.value) + 1)

    const summary = computeSummary(data)

    const [created] = await db
      .insert(aiaForm)
      .values({
        id: createId(),
        companyId: currentUser.companyId,
        projectId: data.projectId,
        formType: data.formType,
        applicationNumber: appNum,
        periodTo: new Date(data.periodTo),
        contractSum: String(data.contractSum),
        netChangeByChangeOrders: String(data.netChangeByChangeOrders),
        contractSumToDate: String(summary.contractSumToDate),
        totalCompletedAndStored: String(summary.totalCompletedAndStored),
        retainagePercent: String(data.retainagePercent),
        retainageAmount: String(summary.retainageAmount),
        totalEarnedLessRetainage: String(summary.totalEarnedLessRetainage),
        lessPreviousCertificates: String(data.lessPreviousCertificates),
        currentPaymentDue: String(summary.currentPaymentDue),
        balanceToFinish: String(summary.balanceToFinish),
        lineItems: data.lineItems,
        notes: data.notes,
        status: 'draft',
      })
      .returning()

    return one(c, created, 201)
  })

  app.put('/:id', requirePermission('aia-forms:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = aiaFormSchema.partial().parse(await c.req.json())

    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (data.notes !== undefined) updateData.notes = data.notes
    if (data.lineItems !== undefined) updateData.lineItems = data.lineItems

    // The summary is recomputed when any money input changed.
    if (data.contractSum !== undefined || data.netChangeByChangeOrders !== undefined ||
        data.retainagePercent !== undefined || data.lessPreviousCertificates !== undefined ||
        data.lineItems !== undefined) {
      const [existing] = await db.select().from(aiaForm).where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId))).limit(1)
      if (existing) {
        const merged = {
          ...data,
          projectId: existing.projectId,
          formType: existing.formType as 'G702' | 'G703',
          applicationNumber: existing.applicationNumber,
          periodTo: (existing.periodTo as Date).toISOString(),
          contractSum: data.contractSum ?? Number(existing.contractSum),
          netChangeByChangeOrders: data.netChangeByChangeOrders ?? Number(existing.netChangeByChangeOrders),
          retainagePercent: data.retainagePercent ?? Number(existing.retainagePercent),
          lessPreviousCertificates: data.lessPreviousCertificates ?? Number(existing.lessPreviousCertificates),
          lineItems: (data.lineItems ?? existing.lineItems) as any[],
        } as z.infer<typeof aiaFormSchema>
        const summary = computeSummary(merged)
        updateData.contractSum = String(merged.contractSum)
        updateData.netChangeByChangeOrders = String(merged.netChangeByChangeOrders)
        updateData.contractSumToDate = String(summary.contractSumToDate)
        updateData.totalCompletedAndStored = String(summary.totalCompletedAndStored)
        updateData.retainagePercent = String(merged.retainagePercent)
        updateData.retainageAmount = String(summary.retainageAmount)
        updateData.totalEarnedLessRetainage = String(summary.totalEarnedLessRetainage)
        updateData.lessPreviousCertificates = String(merged.lessPreviousCertificates)
        updateData.currentPaymentDue = String(summary.currentPaymentDue)
        updateData.balanceToFinish = String(summary.balanceToFinish)
      }
    }

    const [updated] = await db.update(aiaForm).set(updateData).where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'AIA form not found')
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('aia-forms:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(aiaForm).where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'AIA form not found')
    return c.body(null, 204)
  })

  app.post('/:id/sign', requirePermission('aia-forms:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const { signedBy } = await c.req.json().catch(() => ({}))
    const [updated] = await db
      .update(aiaForm)
      .set({ status: 'signed', signedBy, signedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'AIA form not found')
    return one(c, updated)
  })

  app.post('/:id/submit', requirePermission('aia-forms:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [updated] = await db.update(aiaForm).set({ status: 'submitted', updatedAt: new Date() } as any).where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'AIA form not found')
    return one(c, updated)
  })

  app.post('/:id/mark-paid', requirePermission('aia-forms:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [updated] = await db.update(aiaForm).set({ status: 'paid', updatedAt: new Date() } as any).where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'AIA form not found')
    return one(c, updated)
  })

  return app
}
