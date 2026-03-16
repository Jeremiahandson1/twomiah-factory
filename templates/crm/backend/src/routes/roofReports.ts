import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { roofReport, contact, company } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { generateRoofReport } from '../services/roofReport.ts'
import { generateReportHTML, generateReportPDF } from '../services/roofReportRenderer.ts'
import { geocodeAddress, getBuildingInsights } from '../services/googleSolar.ts'
import logger from '../services/logger.ts'
import Stripe from 'stripe'

const REPORT_PRICE_CENTS = 999 // $9.99

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2023-10-16' as any })
}

const app = new Hono()

// ============================================
// LIST REPORTS
// ============================================

app.get('/', authenticate, async (c) => {
  const user = c.get('user') as any
  const { page = '1', limit = '20', contactId } = c.req.query() as any

  const pageNum = +page
  const limitNum = +limit
  const conditions: any[] = [eq(roofReport.companyId, user.companyId)]
  if (contactId) conditions.push(eq(roofReport.contactId, contactId))

  const where = and(...conditions)

  const data = await db.select({
    id: roofReport.id,
    address: roofReport.address,
    city: roofReport.city,
    state: roofReport.state,
    zip: roofReport.zip,
    totalSquares: roofReport.totalSquares,
    totalAreaSqft: roofReport.totalAreaSqft,
    segmentCount: roofReport.segmentCount,
    imageryQuality: roofReport.imageryQuality,
    status: roofReport.status,
    contactId: roofReport.contactId,
    createdAt: roofReport.createdAt,
  })
    .from(roofReport)
    .where(where)
    .orderBy(desc(roofReport.createdAt))
    .offset((pageNum - 1) * limitNum)
    .limit(limitNum)

  return c.json({ data, pagination: { page: pageNum, limit: limitNum } })
})

// ============================================
// GET SINGLE REPORT
// ============================================

app.get('/:id', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)

  return c.json(report)
})

// ============================================
// SHARED GENERATION LOGIC
// ============================================

export async function generateAndSaveReport(
  companyId: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  contactId?: string,
  stripePaymentIntentId?: string,
) {
  const geo = await geocodeAddress(address, city, state, zip)
  const buildingInsights = await getBuildingInsights(geo.lat, geo.lng)
  const result = generateRoofReport(buildingInsights)

  const edges = result.edges.map((edge: any) => ({
    type: edge.type,
    lengthFt: edge.lengthFt,
    startLat: edge.start.lat,
    startLng: edge.start.lng,
    endLat: edge.end.lat,
    endLng: edge.end.lng,
    segmentIndex: edge.segmentA,
  }))

  const measurements = {
    totalAreaSqft: result.totalAreaSqft,
    totalSquares: result.totalSquares,
    ridgeLF: result.measurements.totalRidgeLF,
    valleyLF: result.measurements.totalValleyLF,
    hipLF: result.measurements.totalHipLF,
    rakeLF: result.measurements.totalRakeLF,
    eaveLF: result.measurements.totalEaveLF,
    totalPerimeterLF: result.measurements.totalPerimeterLF,
    wasteFactor: result.measurements.wasteFactorPct,
    squaresWithWaste: result.measurements.suggestedSquaresWithWaste,
    iceWaterShieldSqft: result.measurements.iceWaterShieldSqft,
  }

  const segmentsForDb = result.segments.map(s => ({
    name: s.name,
    area: s.area,
    pitch: s.pitch,
    pitchDegrees: s.pitchDegrees,
    azimuthDegrees: s.azimuthDegrees,
    polygon: s.polygon.vertices,
  }))

  const quality = buildingInsights.imageryQuality || 'MEDIUM'

  const [report] = await db.insert(roofReport).values({
    companyId,
    address,
    city,
    state,
    zip,
    lat: geo.lat,
    lng: geo.lng,
    formattedAddress: `${address}, ${city}, ${state} ${zip}`,
    totalSquares: result.totalSquares,
    totalAreaSqft: result.totalAreaSqft,
    segmentCount: result.segments.length,
    imageryQuality: quality,
    segments: segmentsForDb,
    edges,
    measurements,
    rawSolarData: buildingInsights,
    status: 'paid',
    amountCharged: '9.99',
    stripePaymentIntentId: stripePaymentIntentId || null,
    contactId: contactId || null,
  }).returning()

  return report
}

// ============================================
// PURCHASE REPORT — Stripe Checkout ($9.99)
// ============================================

app.post('/purchase', authenticate, async (c) => {
  const user = c.get('user') as any
  const { address, city, state, zip, contactId } = await c.req.json()

  if (!address || !city || !state || !zip) {
    return c.json({ error: 'Address, city, state, and zip are required' }, 400)
  }

  const stripe = getStripe()
  if (!stripe) {
    // No Stripe configured — generate for free (dev mode / self-hosted)
    try {
      const report = await generateAndSaveReport(user.companyId, address, city, state, zip, contactId)
      return c.json({ report, free: true }, 201)
    } catch (err: any) {
      logger.error('Roof report generation failed', err)
      return c.json({ error: 'Failed to generate roof report', details: err.message }, 500)
    }
  }

  // Create Stripe Checkout Session
  const frontendUrl = process.env.FRONTEND_URL || ''
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: REPORT_PRICE_CENTS,
        product_data: {
          name: 'Professional Roof Measurement Report',
          description: `${address}, ${city}, ${state} ${zip} — Satellite-based roof analysis with ridge, valley, hip, rake, eave measurements, waste factor, and ice & water shield calculations.`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      type: 'roof_report',
      companyId: user.companyId,
      address,
      city,
      state,
      zip,
      contactId: contactId || '',
    },
    success_url: `${frontendUrl}/roof-reports?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/roof-reports?cancelled=true`,
  })

  return c.json({ checkoutUrl: session.url, sessionId: session.id })
})

// ============================================
// CONFIRM PURCHASE — called after Stripe success redirect
// ============================================

app.post('/confirm-purchase', authenticate, async (c) => {
  const user = c.get('user') as any
  const { sessionId } = await c.req.json()

  if (!sessionId) return c.json({ error: 'Session ID required' }, 400)

  const stripe = getStripe()
  if (!stripe) return c.json({ error: 'Stripe not configured' }, 503)

  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.payment_status !== 'paid') {
    return c.json({ error: 'Payment not completed' }, 402)
  }

  const meta = session.metadata || {}
  if (meta.companyId !== user.companyId) {
    return c.json({ error: 'Session does not belong to this company' }, 403)
  }

  // Check if report already generated for this session (idempotent)
  const [existing] = await db.select({ id: roofReport.id }).from(roofReport)
    .where(eq(roofReport.stripePaymentIntentId, session.payment_intent as string))
    .limit(1)

  if (existing) {
    return c.json({ report: existing, alreadyGenerated: true })
  }

  try {
    const report = await generateAndSaveReport(
      meta.companyId,
      meta.address || '',
      meta.city || '',
      meta.state || '',
      meta.zip || '',
      meta.contactId || undefined,
      session.payment_intent as string,
    )
    return c.json({ report }, 201)
  } catch (err: any) {
    logger.error('Roof report generation after payment failed', err)
    return c.json({ error: 'Report generation failed after payment — contact support for a refund', details: err.message }, 500)
  }
})

// ============================================
// GENERATE FOR CONTACT (with payment)
// ============================================

app.post('/purchase-for-contact/:contactId', authenticate, async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [contactRecord] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!contactRecord) return c.json({ error: 'Contact not found' }, 404)
  if (!contactRecord.address) return c.json({ error: 'Contact has no address on file' }, 400)

  const address = contactRecord.address
  const city = contactRecord.city || ''
  const state = contactRecord.state || ''
  const zip = contactRecord.zip || ''

  const stripe = getStripe()
  if (!stripe) {
    // No Stripe — generate free
    try {
      const report = await generateAndSaveReport(user.companyId, address, city, state, zip, contactId)
      return c.json({ report, free: true }, 201)
    } catch (err: any) {
      return c.json({ error: 'Failed to generate roof report', details: err.message }, 500)
    }
  }

  const frontendUrl = process.env.FRONTEND_URL || ''
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: REPORT_PRICE_CENTS,
        product_data: {
          name: 'Professional Roof Measurement Report',
          description: `${address}, ${city}, ${state} ${zip}`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      type: 'roof_report',
      companyId: user.companyId,
      address,
      city,
      state,
      zip,
      contactId,
    },
    success_url: `${frontendUrl}/roof-reports?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/contacts/${contactId}`,
  })

  return c.json({ checkoutUrl: session.url, sessionId: session.id })
})

// ============================================
// PUBLIC HTML VIEW (no auth — shareable link)
// ============================================

app.get('/:id/html', async (c) => {
  const id = c.req.param('id')

  try {
    const [report] = await db.select().from(roofReport)
      .where(eq(roofReport.id, id))
      .limit(1)

    if (!report) return c.json({ error: 'Report not found' }, 404)

    const [companyRecord] = await db.select().from(company)
      .where(eq(company.id, report.companyId))
      .limit(1)

    const reportData = {
      center: { lat: Number(report.lat), lng: Number(report.lng) },
      segments: (report.segments || []) as any[],
      edges: (report.edges || []) as any[],
      measurements: (report.measurements || {}) as any,
      imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
    }

    const fullAddress = `${report.address}, ${report.city}, ${report.state} ${report.zip}`
    const html = await generateReportHTML(reportData, companyRecord, fullAddress)

    return c.html(html)
  } catch (err: any) {
    logger.error('Roof report HTML generation failed', { id, error: err.message, stack: err.stack })
    return c.json({ error: 'Failed to generate report HTML', details: err.message }, 500)
  }
})

// ============================================
// PDF / PRINT VIEW (authenticated)
// ============================================

app.get('/:id/pdf', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  try {
    const [report] = await db.select().from(roofReport)
      .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
      .limit(1)

    if (!report) return c.json({ error: 'Report not found' }, 404)

    const [companyRecord] = await db.select().from(company)
      .where(eq(company.id, report.companyId))
      .limit(1)

    const reportData = {
      center: { lat: Number(report.lat), lng: Number(report.lng) },
      segments: (report.segments || []) as any[],
      edges: (report.edges || []) as any[],
      measurements: (report.measurements || {}) as any,
      imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
    }

    const fullAddress = `${report.address}, ${report.city}, ${report.state} ${report.zip}`
    const html = await generateReportPDF(reportData, companyRecord, fullAddress)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="roof-report-${id}.html"`,
      },
    })
  } catch (err: any) {
    logger.error('Roof report PDF generation failed', { id, error: err.message })
    return c.json({ error: 'Failed to generate report PDF', details: err.message }, 500)
  }
})

// ============================================
// DELETE REPORT
// ============================================

app.delete('/:id', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)

  await db.delete(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))

  return c.json({ success: true })
})

export default app
