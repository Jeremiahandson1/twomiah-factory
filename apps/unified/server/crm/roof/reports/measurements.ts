// /api/measurements — a roof measured from Google Solar for a credit, read back, regenerated when it failed, or entered
// by hand where the imagery is too poor. Moved from templates/crm-roof/backend/src/routes/measurements.ts; the measuring
// is packages/roof-core's (getFullRoofReport). Mounted 'user' and ungated, as the template mounted it and as its menu
// shows it (Measurements carries no feature in AppLayout).
//
// Changes from the template:
//   · a credit is spent in one statement that takes it only where one is left (data/roofReports.ts), before the report
//     is written and in the same transaction: the template read the balance, wrote the report, then subtracted, so two
//     orders at one credit both went through and the balance went to -1;
//   · a job named on an order must be this company's (404 otherwise): the template linked the report to any job id;
//   · the list is { data, pagination: { page, limit, total, pages } } (the template's `totalPages` is `pages`);
//   · a bad body is the rulebook's validation reply (400, `fields`), not a thrown ZodError.
// Kept: every permission (the reads asked only that you were signed in, and still do — reported), the 402 at no
// credits, the credit purchase that adds credits without a payment (reported: it charges nothing).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, count, desc, eq } from 'drizzle-orm'
import { getFullRoofReport } from '@twomiah/roof-core'
import { company, job, measurementReport } from '../../../db/schema/index.ts'
import { spendReportCredit, addReportCredits } from '../../../data/roofReports.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'

const orderSchema = z.object({
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  jobId: z.string().optional().transform((v) => (v === '' ? undefined : v)),
})

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

/** What a report cost comes off it for a reader without margin:read (T62, T68). */
export const withoutCost = <T extends Record<string, any>>(r: T): T => { const { cost: _c, ...rest } = r as any; return rest as T }

export function createMeasurementRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  /**
   * WHAT A REPORT COST IS WHAT THE COMPANY PAYS (T62, T68): `cost` comes off every report a read returns, and
   * `pricePerReport` off the credits read, for anyone without margin:read. A crew reads the squares, the pitch and the
   * area; owner, admin and manager hold margin:read; the read-only seat (which reads revenue) does not.
   */
  const maySeeMoney = async (c: any): Promise<boolean> => {
    const u = c.get('user')
    try { return !!(await canSee(u?.role, 'margin:read', u?.userId)) } catch { return false }
  }
  const shaped = async (c: any, r: any) => ((await maySeeMoney(c)) ? r : withoutCost(r))

  /** Measure the address and file the result on the report (and its job's squares). Runs after the reply. */
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
        pitchDegrees: roofData.segments.map((s) => s.pitchDegrees),
        center: roofData.center,
        rawData: result.insights,
      } as any).where(and(eq(measurementReport.id, reportId), eq(measurementReport.companyId, companyId)))
      if (data.jobId) {
        await db.update(job).set({ totalSquares: String(roofData.totalSquares), updatedAt: new Date() } as any)
          .where(and(eq(job.id, data.jobId), eq(job.companyId, companyId)))
      }
      logger.info('Measurement report complete', { reportId, squares: roofData.totalSquares, quality: roofData.imageryQuality })
    } catch (err: any) {
      logger.error('Measurement report failed', { reportId, error: err?.message })
      await db.update(measurementReport).set({ status: 'failed', rawData: { error: err?.message } } as any)
        .where(and(eq(measurementReport.id, reportId), eq(measurementReport.companyId, companyId)))
    }
  }

  // GET / — this company's measurement reports, newest first.
  app.get('/', async (c) => {
    const me = c.get('user')
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '25') || 25, 1), 100)
    const where = eq(measurementReport.companyId, me.companyId)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(measurementReport).where(where).orderBy(desc(measurementReport.createdAt), desc(measurementReport.id)).limit(limit).offset((page - 1) * limit),
      db.select({ value: count() }).from(measurementReport).where(where),
    ])
    const money = await maySeeMoney(c)
    return list(c, money ? rows : rows.map(withoutCost), { page, limit, total: Number(total) })
  })

  // POST /order — one credit buys a Google Solar measurement; it is measured after the reply (status `processing`).
  app.post('/order', requirePermission('measurements:create'), async (c) => {
    const me = c.get('user')
    const parsed = orderSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [comp] = await db.select({ id: company.id, price: company.reportPricePerReport }).from(company).where(eq(company.id, me.companyId)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    if (data.jobId) {
      const [own] = await db.select({ id: job.id }).from(job).where(and(eq(job.id, data.jobId), eq(job.companyId, me.companyId))).limit(1)
      if (!own) return fail(c, 404, 'Job not found')
    }
    const report = await db.transaction(async (tx: any) => {
      if (!(await spendReportCredit(tx, me.companyId))) return null
      const [row] = await tx.insert(measurementReport).values({
        companyId: me.companyId, jobId: data.jobId || null,
        address: data.address, city: data.city, state: data.state, zip: data.zip,
        provider: 'google_solar', status: 'processing', cost: String(comp.price),
      } as any).returning()
      if (data.jobId) {
        await tx.update(job).set({ measurementReportId: row.id, updatedAt: new Date() } as any)
          .where(and(eq(job.id, data.jobId), eq(job.companyId, me.companyId)))
      }
      return row
    })
    if (!report) return fail(c, 402, 'No measurement credits remaining. Purchase more in Settings.', 'no_credits')
    processReport(report.id, me.companyId, data).catch((err) => logger.error('Background report processing failed', { reportId: report.id, error: err?.message }))
    return one(c, await shaped(c, report), 201)
  })

  // ── Static paths before /:id ──

  // GET /credits/info — the balance; the price per report only to whoever reads cost.
  app.get('/credits/info', async (c) => {
    const me = c.get('user')
    const [comp] = await db.select({ credits: company.reportCredits, pricePerReport: company.reportPricePerReport })
      .from(company).where(eq(company.id, me.companyId)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    return one(c, (await maySeeMoney(c)) ? comp : { credits: comp.credits })
  })

  // POST /credits/purchase — adds credits straight to the balance, as the template's "demo mode" did (no payment).
  app.post('/credits/purchase', requirePermission('measurements:purchase'), async (c) => {
    const me = c.get('user')
    const parsed = z.object({ quantity: z.number().int().min(1).max(1000) }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const credits = await addReportCredits(db, me.companyId, parsed.data.quantity)
    return one(c, { credits, message: `${parsed.data.quantity} credits added` })
  })

  // GET /job/:jobId — the measurement filed on a job.
  app.get('/job/:jobId', async (c) => {
    const me = c.get('user')
    const [report] = await db.select().from(measurementReport)
      .where(and(eq(measurementReport.jobId, c.req.param('jobId')), eq(measurementReport.companyId, me.companyId))).limit(1)
    if (!report) return fail(c, 404, 'No measurement report found for this job')
    return one(c, await shaped(c, report))
  })

  // ── By id ──

  app.get('/:id', async (c) => {
    const me = c.get('user')
    const [report] = await db.select().from(measurementReport)
      .where(and(eq(measurementReport.id, c.req.param('id')), eq(measurementReport.companyId, me.companyId))).limit(1)
    if (!report) return fail(c, 404, 'Measurement report not found')
    return one(c, await shaped(c, report))
  })

  // POST /:id/regenerate — a failed report measured again (no further credit).
  app.post('/:id/regenerate', requirePermission('measurements:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const [report] = await db.select().from(measurementReport)
      .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, me.companyId))).limit(1)
    if (!report) return fail(c, 404, 'Report not found')
    if (report.status !== 'failed') return fail(c, 400, 'Only failed reports can be regenerated')
    await db.update(measurementReport).set({ status: 'processing', rawData: null } as any)
      .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, me.companyId)))
    processReport(id, me.companyId, { address: report.address, city: report.city, state: report.state, zip: report.zip, jobId: report.jobId || undefined })
      .catch((err) => logger.error('Regeneration failed', { reportId: id, error: err?.message }))
    return done(c, 'Regeneration started')
  })

  // POST /:id/manual — squares entered by hand where the imagery is too poor to measure.
  app.post('/:id/manual', requirePermission('measurements:update'), async (c) => {
    const me = c.get('user')
    const id = c.req.param('id')
    const parsed = manualSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [report] = await db.select().from(measurementReport)
      .where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, me.companyId))).limit(1)
    if (!report) return fail(c, 404, 'Report not found')
    await db.update(measurementReport).set({
      status: 'complete', totalSquares: String(data.totalSquares), totalArea: String(data.totalSquares * 100),
      segments: data.segments || null, imageryQuality: 'MANUAL',
    } as any).where(and(eq(measurementReport.id, id), eq(measurementReport.companyId, me.companyId)))
    if (report.jobId) {
      await db.update(job).set({ totalSquares: String(data.totalSquares), updatedAt: new Date() } as any)
        .where(and(eq(job.id, report.jobId), eq(job.companyId, me.companyId)))
    }
    return done(c, 'Manual measurements saved')
  })

  return app
}
