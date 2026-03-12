import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { measurementReport, job } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// Order a measurement report
app.post('/order', async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zip: z.string().min(1),
    provider: z.string().min(1),
    jobId: z.string().optional().transform(v => v === '' ? undefined : v),
  })

  const data = orderSchema.parse(await c.req.json())

  const [report] = await db.insert(measurementReport).values({
    companyId: currentUser.companyId,
    jobId: data.jobId || null,
    address: data.address,
    city: data.city,
    state: data.state,
    zip: data.zip,
    provider: data.provider,
    status: 'processing',
  }).returning()

  // If linked to a job, update the job's measurementReportId
  if (data.jobId) {
    await db.update(job).set({
      measurementReportId: report.id,
      updatedAt: new Date(),
    }).where(and(eq(job.id, data.jobId), eq(job.companyId, currentUser.companyId)))
  }

  return c.json(report, 201)
})

// Get measurement report by ID
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(measurementReport)
    .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, currentUser.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Measurement report not found' }, 404)

  return c.json(report)
})

// Get measurement report for a specific job
app.get('/job/:jobId', async (c) => {
  const currentUser = c.get('user') as any
  const jobId = c.req.param('jobId')

  const [report] = await db.select().from(measurementReport)
    .where(and(eq(measurementReport.jobId, jobId), eq(measurementReport.companyId, currentUser.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'No measurement report found for this job' }, 404)

  return c.json(report)
})

export default app
