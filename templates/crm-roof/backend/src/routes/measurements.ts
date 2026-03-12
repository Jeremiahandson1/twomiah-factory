import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { measurementReport, job, company } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { getFullRoofReport } from '../services/googleSolar.ts'
import logger from '../services/logger.ts'

const app = new Hono()

// ── Authenticated routes ────────────────────────────────

app.use('*', authenticate)

// List all measurement reports
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const page = Number(c.req.query('page') || '1')
  const limit = Math.min(Number(c.req.query('limit') || '25'), 100)
  const offset = (page - 1) * limit

  const reports = await db.select().from(measurementReport)
    .where(eq(measurementReport.companyId, currentUser.companyId))
    .orderBy(desc(measurementReport.createdAt))
    .limit(limit)
    .offset(offset)

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(measurementReport)
    .where(eq(measurementReport.companyId, currentUser.companyId))

  return c.json({ data: reports, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } })
})

// Order a measurement report via Google Solar API
app.post('/order', async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    address: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    zip: z.string().min(1),
    jobId: z.string().optional().transform(v => v === '' ? undefined : v),
  })

  const data = orderSchema.parse(await c.req.json())

  // Check credits
  const [comp] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  if (comp.reportCredits <= 0) {
    return c.json({ error: 'No measurement credits remaining. Purchase more in Settings.' }, 402)
  }

  // Create report record as processing
  const [report] = await db.insert(measurementReport).values({
    companyId: currentUser.companyId,
    jobId: data.jobId || null,
    address: data.address,
    city: data.city,
    state: data.state,
    zip: data.zip,
    provider: 'google_solar',
    status: 'processing',
    cost: String(comp.reportPricePerReport),
  }).returning()

  // Deduct credit
  await db.update(company).set({
    reportCredits: sql`${company.reportCredits} - 1`,
    updatedAt: new Date(),
  }).where(eq(company.id, currentUser.companyId))

  // Link to job if provided
  if (data.jobId) {
    await db.update(job).set({
      measurementReportId: report.id,
      updatedAt: new Date(),
    }).where(and(eq(job.id, data.jobId), eq(job.companyId, currentUser.companyId)))
  }

  // Fetch from Google Solar API asynchronously
  processReport(report.id, currentUser.companyId, data).catch((err) => {
    logger.error('Background report processing failed', { reportId: report.id, error: err.message })
  })

  return c.json(report, 201)
})

async function processReport(reportId: string, companyId: string, data: { address: string; city: string; state: string; zip: string; jobId?: string }) {
  try {
    const result = await getFullRoofReport(data.address, data.city, data.state, data.zip)
    const { roofData } = result

    await db.update(measurementReport).set({
      status: 'complete',
      totalSquares: String(roofData.totalSquares),
      totalArea: String(roofData.totalAreaSqft),
      segments: roofData.segments,
      imageryQuality: roofData.imageryQuality,
      imageryDate: roofData.imageryDate,
      pitchDegrees: roofData.segments.map(s => s.pitchDegrees),
      center: roofData.center,
      rawData: result.insights,
    }).where(eq(measurementReport.id, reportId))

    // Update linked job with total squares
    if (data.jobId) {
      await db.update(job).set({
        totalSquares: String(roofData.totalSquares),
        updatedAt: new Date(),
      }).where(and(eq(job.id, data.jobId), eq(job.companyId, companyId)))
    }

    logger.info('Measurement report complete', { reportId, squares: roofData.totalSquares, quality: roofData.imageryQuality })
  } catch (err: any) {
    logger.error('Measurement report failed', { reportId, error: err.message })
    await db.update(measurementReport).set({
      status: 'failed',
      rawData: { error: err.message },
    }).where(eq(measurementReport.id, reportId))
  }
}

// ── Static-path routes BEFORE parameterized /:id routes ──

// Get company credits info
app.get('/credits/info', async (c) => {
  const currentUser = c.get('user') as any
  const [comp] = await db.select({
    credits: company.reportCredits,
    pricePerReport: company.reportPricePerReport,
  }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)
  return c.json(comp)
})

// Purchase credits (creates Stripe checkout or adds directly in demo mode)
app.post('/credits/purchase', async (c) => {
  const currentUser = c.get('user') as any
  const schema = z.object({ quantity: z.number().int().min(1).max(1000) })
  const { quantity } = schema.parse(await c.req.json())

  // In demo/dev mode: add credits directly
  await db.update(company).set({
    reportCredits: sql`${company.reportCredits} + ${quantity}`,
    updatedAt: new Date(),
  }).where(eq(company.id, currentUser.companyId))

  const [comp] = await db.select({ credits: company.reportCredits }).from(company)
    .where(eq(company.id, currentUser.companyId)).limit(1)

  return c.json({ credits: comp?.credits || 0, message: `${quantity} credits added` })
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

// ── Parameterized routes ──

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

// Regenerate a failed report
app.post('/:id/regenerate', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(measurementReport)
    .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, currentUser.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)
  if (report.status !== 'failed') return c.json({ error: 'Only failed reports can be regenerated' }, 400)

  await db.update(measurementReport).set({ status: 'processing', rawData: null }).where(eq(measurementReport.id, id))

  processReport(id, currentUser.companyId, {
    address: report.address,
    city: report.city,
    state: report.state,
    zip: report.zip,
    jobId: report.jobId || undefined,
  }).catch((err) => {
    logger.error('Regeneration failed', { reportId: id, error: err.message })
  })

  return c.json({ message: 'Regeneration started' })
})

// Manual entry for LOW quality imagery fallback
app.post('/:id/manual', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const manualSchema = z.object({
    totalSquares: z.number().positive(),
    segments: z.array(z.object({
      name: z.string(),
      area: z.number().positive(),
      pitch: z.string(),
      pitchDegrees: z.number().optional(),
      azimuthDegrees: z.number().optional(),
    })).optional(),
  })

  const data = manualSchema.parse(await c.req.json())

  const [report] = await db.select().from(measurementReport)
    .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, currentUser.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)

  const totalArea = data.totalSquares * 100

  await db.update(measurementReport).set({
    status: 'complete',
    totalSquares: String(data.totalSquares),
    totalArea: String(totalArea),
    segments: data.segments || null,
    imageryQuality: 'MANUAL',
  }).where(eq(measurementReport.id, id))

  // Update linked job
  if (report.jobId) {
    await db.update(job).set({
      totalSquares: String(data.totalSquares),
      updatedAt: new Date(),
    }).where(and(eq(job.id, report.jobId), eq(job.companyId, currentUser.companyId)))
  }

  return c.json({ message: 'Manual measurements saved' })
})

export default app
