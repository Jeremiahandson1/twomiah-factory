/**
 * AIA G702/G703 Forms — Construction tier feature.
 *
 * G702: Application and Certificate for Payment (summary of pay app)
 * G703: Continuation Sheet (line-item detail by schedule of values row)
 *
 * In construction, a GC submits a pay app monthly listing completed work
 * against the schedule of values. The architect certifies it and the
 * owner pays. These are the actual AIA-standard forms used across the
 * industry.
 *
 * Table created in migration 0010_add_construction_compliance.sql.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { aiaForm, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// G703 line items are stored as JSON. Each row is one item from the
// schedule of values: work description, scheduled value, previous + current
// + stored work, percent complete, balance to finish, retainage.
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

// Compute the G702 summary values from line items
function computeSummary(input: z.infer<typeof aiaFormSchema>) {
  const contractSumToDate = input.contractSum + input.netChangeByChangeOrders
  const totalCompletedAndStored = input.lineItems.reduce((s, li) => s + li.totalCompletedAndStored, 0)
  const retainageAmount = (totalCompletedAndStored * input.retainagePercent) / 100
  const totalEarnedLessRetainage = totalCompletedAndStored - retainageAmount
  const currentPaymentDue = totalEarnedLessRetainage - input.lessPreviousCertificates
  const balanceToFinish = contractSumToDate - totalCompletedAndStored

  return {
    contractSumToDate,
    totalCompletedAndStored,
    retainageAmount,
    totalEarnedLessRetainage,
    currentPaymentDue,
    balanceToFinish,
  }
}

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
  const forms = await db.select().from(aiaForm).where(where).orderBy(desc(aiaForm.applicationNumber))

  const projectIds = [...new Set(forms.map((f) => f.projectId))]
  const projects = projectIds.length
    ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
    : []
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

  return c.json({ data: forms.map((f) => ({ ...f, project: projectMap[f.projectId] || null })) })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(aiaForm)
    .where(and(eq(aiaForm.id, id), eq(aiaForm.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'AIA form not found' }, 404)

  const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)
  return c.json({ ...found, project: proj || null })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = aiaFormSchema.parse(await c.req.json())

  const summary = computeSummary(data)

  const [created] = await db
    .insert(aiaForm)
    .values({
      companyId: currentUser.companyId,
      projectId: data.projectId,
      formType: data.formType,
      applicationNumber: data.applicationNumber,
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
    } as any)
    .returning()

  return c.json(created, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = aiaFormSchema.partial().parse(await c.req.json())

  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.lineItems !== undefined) updateData.lineItems = data.lineItems

  // Recompute summary if any monetary input changed
  if (data.contractSum !== undefined || data.netChangeByChangeOrders !== undefined ||
      data.retainagePercent !== undefined || data.lessPreviousCertificates !== undefined ||
      data.lineItems !== undefined) {
    const [existing] = await db.select().from(aiaForm).where(eq(aiaForm.id, id)).limit(1)
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

  const [updated] = await db.update(aiaForm).set(updateData).where(eq(aiaForm.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(aiaForm).where(eq(aiaForm.id, id))
  return c.body(null, 204)
})

// Workflow: draft → signed → submitted → paid
app.post('/:id/sign', async (c) => {
  const id = c.req.param('id')
  const { signedBy } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(aiaForm)
    .set({ status: 'signed', signedBy, signedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(aiaForm.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(aiaForm).set({ status: 'submitted', updatedAt: new Date() } as any).where(eq(aiaForm.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/mark-paid', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(aiaForm).set({ status: 'paid', updatedAt: new Date() } as any).where(eq(aiaForm.id, id)).returning()
  return c.json(updated)
})

export default app
