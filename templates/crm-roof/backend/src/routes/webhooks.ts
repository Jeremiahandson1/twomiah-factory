import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { measurementReport, providerIntegration, job } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import * as eagleview from '../services/eagleview.ts'
import * as hover from '../services/hover.ts'
import logger from '../services/logger.ts'

const app = new Hono()

// POST /eagleview — EagleView report completion webhook
app.post('/eagleview', async (c) => {
  try {
    const body = await c.req.json()
    const orderId = String(body.OrderId || body.orderId || body.order_id || '')
    const status = body.Status || body.status || ''

    if (!orderId) return c.json({ error: 'Missing order ID' }, 400)

    logger.info('EagleView webhook received', { orderId, status })

    // Find the measurement report by external order ID
    const [report] = await db.select().from(measurementReport)
      .where(and(
        eq(measurementReport.externalOrderId, orderId),
        eq(measurementReport.externalProvider, 'eagleview'),
      )).limit(1)

    if (!report) {
      logger.warn('EagleView webhook: no matching report', { orderId })
      return c.json({ ok: true })
    }

    // Update external status
    await db.update(measurementReport).set({
      externalStatus: status,
    }).where(eq(measurementReport.id, report.id))

    // If complete, fetch the full report data
    const isComplete = ['complete', 'completed', 'delivered'].includes(status.toLowerCase())
    if (isComplete) {
      try {
        const evData = await eagleview.getReport(report.companyId, orderId)
        const mapped = eagleview.mapToMeasurementReport(evData)

        await db.update(measurementReport).set({
          status: 'complete',
          totalSquares: mapped.totalSquares,
          totalArea: mapped.totalArea,
          segments: mapped.segments,
          pitchDegrees: mapped.pitchDegrees,
          rawData: mapped.rawData,
          externalStatus: 'complete',
        }).where(eq(measurementReport.id, report.id))

        // Update linked job's totalSquares
        if (report.jobId) {
          await db.update(job).set({
            totalSquares: mapped.totalSquares,
            updatedAt: new Date(),
          }).where(eq(job.id, report.jobId))
        }

        logger.info('EagleView report completed', { reportId: report.id, squares: mapped.totalSquares })
      } catch (err: any) {
        logger.error('Failed to fetch EagleView report data', { reportId: report.id, error: err.message })
        await db.update(measurementReport).set({
          status: 'failed',
          rawData: { error: err.message },
          externalStatus: 'fetch_failed',
        }).where(eq(measurementReport.id, report.id))
      }
    }

    // If failed
    const isFailed = ['failed', 'error', 'cancelled'].includes(status.toLowerCase())
    if (isFailed) {
      await db.update(measurementReport).set({
        status: 'failed',
        rawData: { error: `EagleView order ${status}`, webhookBody: body },
        externalStatus: status,
      }).where(eq(measurementReport.id, report.id))
      logger.warn('EagleView report failed', { reportId: report.id, status })
    }

    return c.json({ ok: true })
  } catch (err: any) {
    logger.error('EagleView webhook error', { error: err.message })
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// POST /hover — HOVER job status webhook
app.post('/hover', async (c) => {
  try {
    const body = await c.req.json()
    const jobId = String(body.id || body.job_id || body.jobId || '')
    const status = body.state || body.status || ''

    if (!jobId) return c.json({ error: 'Missing job ID' }, 400)

    logger.info('HOVER webhook received', { jobId, status })

    // Find the measurement report by external order ID
    const [report] = await db.select().from(measurementReport)
      .where(and(
        eq(measurementReport.externalOrderId, jobId),
        eq(measurementReport.externalProvider, 'hover'),
      )).limit(1)

    if (!report) {
      logger.warn('HOVER webhook: no matching report', { jobId })
      return c.json({ ok: true })
    }

    // Update external status
    await db.update(measurementReport).set({
      externalStatus: status,
    }).where(eq(measurementReport.id, report.id))

    // If complete, fetch measurements
    const isComplete = ['complete', 'completed'].includes(status.toLowerCase())
    if (isComplete) {
      try {
        const hoverData = await hover.getJobMeasurements(report.companyId, jobId)
        const mapped = hover.mapToMeasurementReport(hoverData)

        await db.update(measurementReport).set({
          status: 'complete',
          totalSquares: mapped.totalSquares,
          totalArea: mapped.totalArea,
          segments: mapped.segments,
          pitchDegrees: mapped.pitchDegrees,
          rawData: mapped.rawData,
          externalStatus: 'complete',
        }).where(eq(measurementReport.id, report.id))

        // Update linked job's totalSquares
        if (report.jobId) {
          await db.update(job).set({
            totalSquares: mapped.totalSquares,
            updatedAt: new Date(),
          }).where(eq(job.id, report.jobId))
        }

        logger.info('HOVER report completed', { reportId: report.id, squares: mapped.totalSquares })
      } catch (err: any) {
        logger.error('Failed to fetch HOVER measurements', { reportId: report.id, error: err.message })
        await db.update(measurementReport).set({
          status: 'failed',
          rawData: { error: err.message },
          externalStatus: 'fetch_failed',
        }).where(eq(measurementReport.id, report.id))
      }
    }

    // If failed
    const isFailed = ['failed', 'error', 'cancelled'].includes(status.toLowerCase())
    if (isFailed) {
      await db.update(measurementReport).set({
        status: 'failed',
        rawData: { error: `HOVER job ${status}`, webhookBody: body },
        externalStatus: status,
      }).where(eq(measurementReport.id, report.id))
      logger.warn('HOVER job failed', { reportId: report.id, status })
    }

    return c.json({ ok: true })
  } catch (err: any) {
    logger.error('HOVER webhook error', { error: err.message })
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

export default app
