import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { roofReport, contact, company } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { generateRoofReport, generateRoofReportFromDSM } from '../services/roofReport.ts'
import { generateReportHTML, generateReportPDF } from '../services/roofReportRenderer.ts'
import { geocodeAddress, getBuildingInsights, getDataLayers, downloadGeoTiff, formatSolarDate, isSummerImagery } from '../services/googleSolar.ts'
import { processDsm } from '../services/dsmProcessor.ts'
import logger from '../services/logger.ts'
import Stripe from 'stripe'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

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
    imageryDate: roofReport.imageryDate,
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

// Ensure uploads directory for aerial imagery exists
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'roof-imagery')
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }) } catch {}

/**
 * Download Solar API aerial GeoTIFF and convert to PNG via sharp.
 * Returns the saved file path, or null on failure.
 */
async function downloadAndConvertToPng(geoTiffUrl: string, outputPath: string): Promise<string | null> {
  try {
    const tiffBuffer = await downloadGeoTiff(geoTiffUrl)
    await sharp(tiffBuffer).png({ quality: 90 }).toFile(outputPath)
    return outputPath
  } catch (err: any) {
    logger.warn('Failed to download/convert GeoTIFF', { error: err.message })
    return null
  }
}

/**
 * Create a composite image: aerial RGB with roof mask overlay.
 * Uses raw pixel manipulation for reliable compositing — no complex sharp pipelines.
 */
async function compositeAerialWithMask(
  rgbPath: string,
  maskTiffBuffer: Buffer,
  outputPath: string,
): Promise<string | null> {
  try {
    const rgbMeta = await sharp(rgbPath).metadata()
    const w = rgbMeta.width || 800
    const h = rgbMeta.height || 600

    // Get RGB pixels as raw RGBA
    const rgbRaw = await sharp(rgbPath)
      .ensureAlpha()
      .raw()
      .toBuffer()

    // Get mask pixels, resized to match RGB, as single-channel grayscale
    const maskRaw = await sharp(maskTiffBuffer)
      .resize(w, h, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer()

    // Composite: tint rooftop pixels (mask > 128) with a subtle highlight
    const result = Buffer.from(rgbRaw)
    for (let i = 0; i < w * h; i++) {
      const maskVal = maskRaw[i] || 0
      if (maskVal > 128) {
        // Lighten + blue-tint rooftop pixels for visibility
        const ri = i * 4
        result[ri + 0] = Math.min(255, Math.round(result[ri + 0] * 0.85 + 40))  // R: slight boost
        result[ri + 1] = Math.min(255, Math.round(result[ri + 1] * 0.85 + 55))  // G: moderate boost
        result[ri + 2] = Math.min(255, Math.round(result[ri + 2] * 0.85 + 70))  // B: strong boost
      }
    }

    await sharp(result, { raw: { width: w, height: h, channels: 4 } })
      .png({ quality: 90 })
      .toFile(outputPath)

    return outputPath
  } catch (err: any) {
    logger.warn('Failed to composite aerial with mask', { error: err.message })
    // Fall back to plain aerial image
    try {
      fs.copyFileSync(rgbPath, outputPath)
      return outputPath
    } catch { return null }
  }
}

export async function generateAndSaveReport(
  companyId: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  contactId?: string,
  stripePaymentIntentId?: string,
  eaveOverhangInches = 12,
) {
  const geo = await geocodeAddress(address, city, state, zip)
  const buildingInsights = await getBuildingInsights(geo.lat, geo.lng)
  const quality = buildingInsights.imageryQuality || 'MEDIUM'

  // ---------------------------------------------------------------------------
  // Fetch high-resolution aerial imagery, roof mask, and DSM from dataLayers
  // ---------------------------------------------------------------------------
  let aerialImagePath: string | null = null
  let roofMaskPath: string | null = null
  let imageryDate: string | null = null
  let dsmBuffer: Buffer | null = null
  let maskBuffer: Buffer | null = null

  try {
    const dataLayers = await getDataLayers(geo.lat, geo.lng)
    imageryDate = formatSolarDate(dataLayers.imageryDate)

    if (isSummerImagery(dataLayers.imageryDate)) {
      logger.info('Roof report imagery is from summer months — tree obstruction possible', {
        address, imageryDate, month: dataLayers.imageryDate.month,
      })
    }

    const filePrefix = `${companyId.slice(0, 8)}-${Date.now()}`

    // Download aerial RGB GeoTIFF → convert to PNG
    const rgbPngPath = path.join(UPLOADS_DIR, `${filePrefix}-aerial.png`)
    aerialImagePath = await downloadAndConvertToPng(dataLayers.rgbUrl, rgbPngPath)

    // Download DSM GeoTIFF (elevation data for plane fitting)
    if (dataLayers.dsmUrl) {
      try {
        dsmBuffer = await downloadGeoTiff(dataLayers.dsmUrl)
        logger.info('DSM GeoTIFF downloaded', { address, bytes: dsmBuffer.length })
      } catch (dsmErr: any) {
        logger.warn('DSM download failed (non-blocking)', { error: dsmErr.message })
      }
    }

    // Download roof mask GeoTIFF (for footprint + composite image)
    if (dataLayers.maskUrl) {
      try {
        maskBuffer = await downloadGeoTiff(dataLayers.maskUrl)

        const maskPngPath = path.join(UPLOADS_DIR, `${filePrefix}-mask.png`)
        await sharp(maskBuffer).png().toFile(maskPngPath)
        roofMaskPath = maskPngPath

        // Create composite: aerial + roof mask highlight
        if (aerialImagePath) {
          const compositePath = path.join(UPLOADS_DIR, `${filePrefix}-composite.png`)
          const compositeResult = await compositeAerialWithMask(rgbPngPath, maskBuffer, compositePath)
          if (compositeResult) {
            aerialImagePath = compositeResult
          }
        }
      } catch (maskErr: any) {
        logger.warn('Roof mask download/processing failed (non-blocking)', { error: maskErr.message })
      }
    }

    logger.info('Solar API data layers downloaded', {
      address, imageryDate, quality: dataLayers.imageryQuality,
      hasAerial: !!aerialImagePath, hasMask: !!maskBuffer, hasDsm: !!dsmBuffer,
    })
  } catch (dataLayerErr: any) {
    logger.warn('DataLayers API failed — falling back to metadata-based geometry', {
      error: dataLayerErr.message, address,
    })
    if (buildingInsights.imageryDate) {
      imageryDate = formatSolarDate(buildingInsights.imageryDate)
    }
  }

  // ---------------------------------------------------------------------------
  // Generate roof geometry — DSM-based (primary) or metadata-based (fallback)
  // ---------------------------------------------------------------------------
  let result
  let geometrySource = 'metadata'

  if (dsmBuffer && maskBuffer) {
    try {
      const dsmResult = await processDsm(dsmBuffer, maskBuffer, geo.lat, geo.lng)
      result = generateRoofReportFromDSM(dsmResult, geo.lat, geo.lng, eaveOverhangInches)
      geometrySource = 'dsm'
      logger.info('Roof geometry computed from DSM elevation data', {
        address,
        planes: dsmResult.planes.length,
        footprintVertices: dsmResult.footprint.length,
        segments: result.segments.length,
      })
    } catch (dsmErr: any) {
      logger.warn('DSM processing failed — falling back to metadata geometry', {
        error: dsmErr.message, address,
      })
      result = generateRoofReport(buildingInsights, eaveOverhangInches)
    }
  } else {
    result = generateRoofReport(buildingInsights, eaveOverhangInches)
  }

  logger.info('Roof report generated', {
    address, geometrySource,
    segments: result.segments.length,
    totalSquares: result.totalSquares,
  })

  // ---------------------------------------------------------------------------
  // Serialize for DB
  // ---------------------------------------------------------------------------
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
    imageryDate,
    aerialImagePath,
    roofMaskPath,
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
  const { address, city, state, zip, contactId, eaveOverhangInches } = await c.req.json()
  const overhang = typeof eaveOverhangInches === 'number' ? Math.max(0, Math.min(36, eaveOverhangInches)) : 12

  if (!address || !city || !state || !zip) {
    return c.json({ error: 'Address, city, state, and zip are required' }, 400)
  }

  const stripe = getStripe()
  if (!stripe) {
    // No Stripe configured — generate for free (dev mode / self-hosted)
    try {
      const report = await generateAndSaveReport(user.companyId, address, city, state, zip, contactId, undefined, overhang)
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
      eaveOverhangInches: String(overhang),
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
      meta.eaveOverhangInches ? Number(meta.eaveOverhangInches) : 12,
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
// SERVE AERIAL IMAGERY (public — used by HTML report)
// ============================================

app.get('/:id/aerial.png', async (c) => {
  const id = c.req.param('id')
  const [report] = await db.select({ aerialImagePath: roofReport.aerialImagePath })
    .from(roofReport).where(eq(roofReport.id, id)).limit(1)

  if (!report?.aerialImagePath || !fs.existsSync(report.aerialImagePath)) {
    return c.json({ error: 'Aerial image not available' }, 404)
  }

  const imgBuffer = fs.readFileSync(report.aerialImagePath)
  return new Response(imgBuffer, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  })
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

    // Read stored aerial image as base64 if available
    let aerialBase64 = ''
    if (report.aerialImagePath && fs.existsSync(report.aerialImagePath)) {
      try {
        const imgBuf = fs.readFileSync(report.aerialImagePath)
        aerialBase64 = `data:image/png;base64,${imgBuf.toString('base64')}`
      } catch {}
    }

    const reportData = {
      center: { lat: Number(report.lat), lng: Number(report.lng) },
      segments: (report.segments || []) as any[],
      edges: (report.edges || []) as any[],
      measurements: (report.measurements || {}) as any,
      imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      imageryDate: report.imageryDate || null,
      aerialImageBase64: aerialBase64 || null,
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

    let aerialBase64 = ''
    if (report.aerialImagePath && fs.existsSync(report.aerialImagePath)) {
      try {
        const imgBuf = fs.readFileSync(report.aerialImagePath)
        aerialBase64 = `data:image/png;base64,${imgBuf.toString('base64')}`
      } catch {}
    }

    const reportData = {
      center: { lat: Number(report.lat), lng: Number(report.lng) },
      segments: (report.segments || []) as any[],
      edges: (report.edges || []) as any[],
      measurements: (report.measurements || {}) as any,
      imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      imageryDate: report.imageryDate || null,
      aerialImageBase64: aerialBase64 || null,
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
