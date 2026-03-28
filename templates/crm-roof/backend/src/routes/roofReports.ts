import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { roofReport, contact, company } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { generateRoofReport, generateRoofReportFromDSM } from '../services/roofReport.ts'
import { generateReportHTML, generateReportPDF, generatePdfReadyHTML, computeOptimalZoom, fetchSatelliteImageBase64, MAP_WIDTH, MAP_HEIGHT } from '../services/roofReportRenderer.ts'
import { geocodeAddress, getBuildingInsights, getDataLayers, downloadGeoTiff, formatSolarDate, isSummerImagery } from '../services/googleSolar.ts'
import { processDsm } from '../services/dsmProcessor.ts'

// --- New service imports for upgraded estimator ---
import { checkNearmapCoverage, getNearmapTileConfig, downloadNearmapImage, fetchNearmapImageBase64 } from '../services/nearmapImagery.ts'
import { getBestElevationData } from '../services/elevationProvider.ts'
import { generatePdfFromHtml } from '../services/pdfGenerator.ts'
import { getNearmapRoofAI, getNearmapRollup, type NearmapAIResult, type NearmapRollupResult } from '../services/nearmapAI.ts'

// SAM 2 — fallback when Nearmap AI is unavailable
let segmentRoof: any = null
let processSamSegments: any = null
try {
  const sam2 = await import('../services/sam2Segmentation.ts')
  segmentRoof = sam2.segmentRoof
  const sam2pp = await import('../services/sam2PostProcessor.ts')
  processSamSegments = sam2pp.processSamSegments
} catch { /* SAM 2 not deployed yet */ }

// OSM footprint fetching — optional, non-fatal if missing
let fetchOsmBuildings: any = async () => []
let osmPolygonToLocal: any = () => []
try {
  const osm = await import('../services/osmFootprint.ts')
  fetchOsmBuildings = osm.fetchOsmBuildings
  osmPolygonToLocal = osm.osmPolygonToLocal
} catch { /* module not deployed yet */ }
import logger from '../services/logger.ts'

/** Notify the factory platform that a new report needs human review. */
async function notifyFactoryNewReport(reportId: string, address: string, city: string, state: string, companyId: string) {
  const factoryUrl = process.env.FACTORY_API_URL || process.env.FACTORY_SYNC_URL
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !factoryKey) return

  try {
    await fetch(`${factoryUrl}/api/v1/factory/roof-review/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': factoryKey },
      body: JSON.stringify({ reportId, address: `${address}, ${city}, ${state}`, companyId, backendUrl: process.env.RENDER_EXTERNAL_URL || '' }),
      signal: AbortSignal.timeout(5000),
    })
  } catch (err: any) {
    logger.warn('Factory notification failed (non-blocking)', { error: err.message })
  }
}
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

// ---------------------------------------------------------------------------
// Step 1: Generate preview data (geometry + imagery) without saving to DB
// ---------------------------------------------------------------------------

interface PreviewData {
  geo: { lat: number; lng: number }
  quality: string
  imageryDate: string | null
  aerialImagePath: string | null
  roofMaskPath: string | null
  edges: any[]
  segments: any[]
  measurements: any
  totalAreaSqft: number
  totalSquares: number
  rawSolarData: any
  geometrySource: string
  zoom: number
  satelliteImageBase64: string
  mapWidth: number
  mapHeight: number
  imagerySource: string
  elevationSource: string
  nearmapTileUrl: string | null
  nearmapSurveyId: string | null
  roofCondition: number | null
  roofMaterial: string | null
  treeOverhangPct: number | null
  aiSource: string | null
}

async function generateReportPreview(
  companyId: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  eaveOverhangInches = 12,
): Promise<PreviewData> {
  const geo = await geocodeAddress(address, city, state, zip)
  const buildingInsights = await getBuildingInsights(geo.lat, geo.lng)
  const quality = buildingInsights.imageryQuality || 'MEDIUM'

  let aerialImagePath: string | null = null
  let roofMaskPath: string | null = null
  let imageryDate: string | null = null
  let dsmBuffer: Buffer | null = null
  let maskBuffer: Buffer | null = null
  let imagerySource = 'google_solar'
  let elevationSource = 'google_dsm'
  let nearmapTileUrl: string | null = null
  let nearmapSurveyId: string | null = null

  // --- Check Nearmap coverage (5-7cm resolution, preferred) ---
  try {
    const nearmapResult = await downloadNearmapImage(geo.lat, geo.lng, MAP_WIDTH, MAP_HEIGHT, 20)
    if (nearmapResult) {
      imagerySource = 'nearmap'
      nearmapSurveyId = nearmapResult.surveyId
      imageryDate = nearmapResult.captureDate
      const filePrefix = `${companyId.slice(0, 8)}-${Date.now()}`
      const nearmapPath = path.join(UPLOADS_DIR, `${filePrefix}-nearmap.png`)
      fs.writeFileSync(nearmapPath, nearmapResult.buffer)
      aerialImagePath = nearmapPath
      logger.info('Nearmap imagery downloaded', { address, captureDate: nearmapResult.captureDate })

      // Get tile URL for MapLibre editor
      const tileConfig = await getNearmapTileConfig(geo.lat, geo.lng, nearmapResult.surveyId)
      if (tileConfig) nearmapTileUrl = tileConfig.tileUrl
    }
  } catch (nearmapErr: any) {
    logger.info('Nearmap not available, using Google Solar', { error: nearmapErr.message, address })
  }

  try {
    const dataLayers = await getDataLayers(geo.lat, geo.lng)
    if (!imageryDate) imageryDate = formatSolarDate(dataLayers.imageryDate)

    if (isSummerImagery(dataLayers.imageryDate)) {
      logger.info('Roof report imagery is from summer months — tree obstruction possible', {
        address, imageryDate, month: dataLayers.imageryDate.month,
      })
    }

    const filePrefix = `${companyId.slice(0, 8)}-${Date.now()}`

    // Only download Google aerial if Nearmap wasn't available
    if (!aerialImagePath) {
      const rgbPngPath = path.join(UPLOADS_DIR, `${filePrefix}-aerial.png`)
      aerialImagePath = await downloadAndConvertToPng(dataLayers.rgbUrl, rgbPngPath)
    }

    if (dataLayers.dsmUrl) {
      try {
        dsmBuffer = await downloadGeoTiff(dataLayers.dsmUrl)
        logger.info('DSM GeoTIFF downloaded', { address, bytes: dsmBuffer.length })
      } catch (dsmErr: any) {
        logger.warn('DSM download failed (non-blocking)', { error: dsmErr.message })
      }
    }

    if (dataLayers.maskUrl) {
      try {
        maskBuffer = await downloadGeoTiff(dataLayers.maskUrl)
        const maskPngPath = path.join(UPLOADS_DIR, `${filePrefix}-mask.png`)
        await sharp(maskBuffer).png().toFile(maskPngPath)
        roofMaskPath = maskPngPath

        if (aerialImagePath && imagerySource !== 'nearmap') {
          const rgbPngPath = path.join(UPLOADS_DIR, `${filePrefix}-aerial.png`)
          const compositePath = path.join(UPLOADS_DIR, `${filePrefix}-composite.png`)
          const compositeResult = await compositeAerialWithMask(rgbPngPath, maskBuffer, compositePath)
          if (compositeResult) aerialImagePath = compositeResult
        }
      } catch (maskErr: any) {
        logger.warn('Roof mask download/processing failed (non-blocking)', { error: maskErr.message })
      }
    }

    logger.info('Solar API data layers downloaded', {
      address, imageryDate, quality: dataLayers.imageryQuality, imagerySource,
      hasAerial: !!aerialImagePath, hasMask: !!maskBuffer, hasDsm: !!dsmBuffer,
    })
  } catch (dataLayerErr: any) {
    logger.warn('DataLayers API failed — falling back to metadata-based geometry', { error: dataLayerErr.message, address })
    if (buildingInsights.imageryDate) imageryDate = formatSolarDate(buildingInsights.imageryDate)
  }

  // --- Get best elevation data (USGS 3DEP LiDAR when available) ---
  let lidarBuffer: Buffer | null = null
  try {
    const elevData = await getBestElevationData(geo.lat, geo.lng, 75, dsmBuffer)
    elevationSource = elevData.source.type
    if (elevData.lidarGrid) {
      // Store LiDAR grid for potential 3D viewer use
      logger.info('USGS 3DEP LiDAR available', {
        address, resolution: elevData.source.resolution, description: elevData.source.description,
      })
    }
  } catch (elevErr: any) {
    logger.info('LiDAR check failed (non-blocking)', { error: elevErr.message })
  }

  let result: any
  let geometrySource = 'metadata'

  if (dsmBuffer && maskBuffer) {
    try {
      // Fetch OSM building footprints for extension detection
      let osmLocal: Array<{ polygon: Array<{ x: number; y: number }> }> = []
      try {
        const osmBuildings = await fetchOsmBuildings(geo.lat, geo.lng)
        osmLocal = osmBuildings.map(b => ({ polygon: osmPolygonToLocal(b.polygon, geo.lat, geo.lng) }))
      } catch (e) { /* non-blocking */ }

      const dsmResult = await processDsm(dsmBuffer, maskBuffer, geo.lat, geo.lng, osmLocal, lidarBuffer)
      result = generateRoofReportFromDSM(dsmResult, geo.lat, geo.lng, eaveOverhangInches)
      geometrySource = elevationSource === 'google_dsm' ? 'dsm' : `dsm+${elevationSource}`
      logger.info('Roof geometry computed from DSM elevation data', {
        address, planes: dsmResult.planes.length, footprintVertices: dsmResult.footprint.length, segments: result.segments.length, elevationSource,
      })
    } catch (dsmErr: any) {
      logger.warn('DSM processing failed — falling back to metadata geometry', { error: dsmErr.message, address })
      result = generateRoofReport(buildingInsights, eaveOverhangInches)
    }
  } else {
    result = generateRoofReport(buildingInsights, eaveOverhangInches)
  }

  logger.info('Roof report preview generated', { address, geometrySource, segments: result.segments.length, totalSquares: result.totalSquares })

  const edges = result.edges.map((edge: any) => ({
    type: edge.type, lengthFt: edge.lengthFt,
    startLat: edge.start.lat, startLng: edge.start.lng,
    endLat: edge.end.lat, endLng: edge.end.lng,
    segmentIndex: edge.segmentA,
  }))

  const measurements = {
    totalAreaSqft: result.totalAreaSqft, totalSquares: result.totalSquares,
    ridgeLF: result.measurements.totalRidgeLF, valleyLF: result.measurements.totalValleyLF,
    hipLF: result.measurements.totalHipLF, rakeLF: result.measurements.totalRakeLF,
    eaveLF: result.measurements.totalEaveLF, totalPerimeterLF: result.measurements.totalPerimeterLF,
    wasteFactor: result.measurements.wasteFactorPct, squaresWithWaste: result.measurements.suggestedSquaresWithWaste,
    iceWaterShieldSqft: result.measurements.iceWaterShieldSqft,
  }

  const segments = result.segments.map((s: any) => ({
    name: s.name, area: s.area, pitch: s.pitch,
    pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees,
    polygon: s.polygon.vertices,
  }))

  // Compute zoom and fetch satellite image for the editor overlay
  const zoom = computeOptimalZoom(segments, MAP_WIDTH, MAP_HEIGHT)

  // Use Nearmap image for report if available, otherwise Google Static Maps
  let nearmapBase64: string | null = null
  if (imagerySource === 'nearmap') {
    const nmResult = await fetchNearmapImageBase64(geo.lat, geo.lng, zoom)
    if (nmResult) nearmapBase64 = nmResult.dataUrl
  }
  const satelliteImageBase64 = await fetchSatelliteImageBase64(geo.lat, geo.lng, zoom, nearmapBase64)

  // --- Fetch Nearmap AI property facts (condition, material, tree overhang) ---
  let roofCondition: number | null = null
  let roofMaterial: string | null = null
  let treeOverhangPct: number | null = null
  let aiSource: string | null = null

  try {
    const rollup = await getNearmapRollup(geo.lat, geo.lng)
    if (rollup.available) {
      roofCondition = rollup.roofCondition
      roofMaterial = rollup.roofMaterial
      treeOverhangPct = rollup.treeOverhangPct
      aiSource = 'nearmap_rollup'
      logger.info('Nearmap AI Rollup data fetched', {
        address, condition: roofCondition, material: roofMaterial, treeOverhang: treeOverhangPct,
      })
    }
  } catch { /* non-blocking */ }

  return {
    geo, quality, imageryDate, aerialImagePath, roofMaskPath, edges, segments, measurements,
    totalAreaSqft: result.totalAreaSqft, totalSquares: result.totalSquares,
    rawSolarData: buildingInsights, geometrySource, zoom, satelliteImageBase64,
    mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT,
    // New fields for upgraded estimator
    imagerySource, elevationSource, nearmapTileUrl, nearmapSurveyId,
    roofCondition, roofMaterial, treeOverhangPct, aiSource,
  }
}

// ---------------------------------------------------------------------------
// Step 2: Save finalized report to DB (after user review/edit)
// ---------------------------------------------------------------------------

async function saveReportToDb(
  preview: PreviewData,
  companyId: string,
  address: string, city: string, state: string, zip: string,
  edges: any[], measurements: any,
  contactId?: string, stripePaymentIntentId?: string,
) {
  const [report] = await db.insert(roofReport).values({
    companyId, address, city, state, zip,
    lat: preview.geo.lat, lng: preview.geo.lng,
    formattedAddress: `${address}, ${city}, ${state} ${zip}`,
    totalSquares: preview.totalSquares, totalAreaSqft: preview.totalAreaSqft,
    segmentCount: preview.segments.length,
    imageryQuality: preview.quality, imageryDate: preview.imageryDate,
    aerialImagePath: preview.aerialImagePath, roofMaskPath: preview.roofMaskPath,
    segments: preview.segments, edges, measurements,
    rawSolarData: preview.rawSolarData,
    status: 'paid', amountCharged: '9.99',
    stripePaymentIntentId: stripePaymentIntentId || null,
    contactId: contactId || null,
    // New fields for upgraded estimator
    imagerySource: preview.imagerySource || 'google_solar',
    elevationSource: preview.elevationSource || 'google_dsm',
    nearmapSurveyId: preview.nearmapSurveyId || null,
    roofCondition: preview.roofCondition || null,
    roofMaterial: preview.roofMaterial || null,
    treeOverhangPct: preview.treeOverhangPct || null,
    aiSource: preview.aiSource || null,
  }).returning()
  return report
}

// Legacy wrapper for backwards compatibility (Stripe confirm flow)
export async function generateAndSaveReport(
  companyId: string, address: string, city: string, state: string, zip: string,
  contactId?: string, stripePaymentIntentId?: string, eaveOverhangInches = 12,
) {
  const preview = await generateReportPreview(companyId, address, city, state, zip, eaveOverhangInches)
  return saveReportToDb(preview, companyId, address, city, state, zip, preview.edges, preview.measurements, contactId, stripePaymentIntentId)
}

// ============================================
// PURCHASE REPORT — Stripe Checkout ($9.99)
// ============================================

app.post('/purchase', authenticate, async (c) => {
  const user = c.get('user') as any
  const { address, city, state, zip, contactId, eaveOverhangInches, mode } = await c.req.json()
  const overhang = typeof eaveOverhangInches === 'number' ? Math.max(0, Math.min(36, eaveOverhangInches)) : 12
  const isManual = mode === 'manual' // free manual tool vs beta auto-detect

  if (!address || !city || !state || !zip) {
    return c.json({ error: 'Address, city, state, and zip are required' }, 400)
  }

  // Manual (Free): generate preview with blank edges, user draws from scratch
  if (isManual) {
    try {
      const preview = await generateReportPreview(user.companyId, address, city, state, zip, overhang)
      preview.edges = []
      preview.measurements = {
        ...preview.measurements,
        ridgeLF: 0, valleyLF: 0, hipLF: 0, rakeLF: 0, eaveLF: 0,
        totalPerimeterLF: 0, wasteFactor: 0, iceWaterShieldSqft: 0,
      }
      return c.json({ preview: { ...preview, address, city, state, zip, contactId, mode: 'manual' }, free: true }, 200)
    } catch (err: any) {
      logger.error('Roof report generation failed', err)
      return c.json({ error: 'Failed to generate roof report', details: err.message }, 500)
    }
  }

  // Professional Report ($9.99): Stripe payment required, then auto-detect + human review
  const stripe = getStripe()
  if (!stripe) {
    // No Stripe configured (dev mode): generate and save immediately
    try {
      const preview = await generateReportPreview(user.companyId, address, city, state, zip, overhang)
      const report = await saveReportToDb(
        preview, user.companyId, address, city, state, zip,
        preview.edges, preview.measurements, contactId, undefined,
      )
      await db.update(roofReport).set({ status: 'pending_review' }).where(eq(roofReport.id, report.id))
      notifyFactoryNewReport(report.id, address, city, state, user.companyId).catch(() => {})
      return c.json({ report: { ...report, status: 'pending_review' }, pendingReview: true }, 201)
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
    // Set to pending_review for human verification before customer sees it
    await db.update(roofReport).set({ status: 'pending_review' }).where(eq(roofReport.id, report.id))
    notifyFactoryNewReport(report.id, meta.address || '', meta.city || '', meta.state || '', meta.companyId).catch(() => {})
    return c.json({ report: { ...report, status: 'pending_review' }, pendingReview: true }, 201)
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
// SERVE PREVIEW AERIAL IMAGE (for editor before report is saved)
// ============================================

app.get('/preview-aerial/:filename', authenticate, async (c) => {
  const filename = c.req.param('filename')
  // Sanitize — only allow alphanumeric, dash, dot
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return c.json({ error: 'Invalid filename' }, 400)
  const filePath = path.join(UPLOADS_DIR, filename)
  if (!fs.existsSync(filePath)) return c.json({ error: 'Image not found' }, 404)
  const imgBuffer = fs.readFileSync(filePath)
  return new Response(imgBuffer, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
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
      roofCondition: (report as any).roofCondition || null,
      roofMaterial: (report as any).roofMaterial || null,
      treeOverhangPct: (report as any).treeOverhangPct || null,
      imagerySource: (report as any).imagerySource || null,
      elevationSource: (report as any).elevationSource || null,
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
      roofCondition: (report as any).roofCondition || null,
      roofMaterial: (report as any).roofMaterial || null,
      treeOverhangPct: (report as any).treeOverhangPct || null,
      imagerySource: (report as any).imagerySource || null,
      elevationSource: (report as any).elevationSource || null,
    }

    const fullAddress = `${report.address}, ${report.city}, ${report.state} ${report.zip}`

    // Try server-side PDF via Puppeteer first, fall back to print-ready HTML
    try {
      const html = await generatePdfReadyHTML(reportData, companyRecord, fullAddress)
      const pdfBuffer = await generatePdfFromHtml(html)

      return new Response(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="roof-report-${id}.pdf"`,
        },
      })
    } catch (puppeteerErr: any) {
      logger.warn('Puppeteer PDF failed, falling back to print-ready HTML', { error: puppeteerErr.message })
      // Fallback: return printable HTML (legacy behavior)
      const html = await generateReportPDF(reportData, companyRecord, fullAddress)
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="roof-report-${id}.html"`,
        },
      })
    }
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

// ============================================
// FINALIZE REPORT — save preview + user edits to DB
// ============================================

app.post('/finalize', authenticate, async (c) => {
  const user = c.get('user') as any
  const { preview, edges, measurements } = await c.req.json()

  if (!preview || !edges) return c.json({ error: 'Preview data and edges required' }, 400)

  try {
    const report = await saveReportToDb(
      preview, user.companyId,
      preview.address, preview.city, preview.state, preview.zip,
      edges, measurements || preview.measurements,
      preview.contactId, preview.stripePaymentIntentId,
    )
    return c.json({ report }, 201)
  } catch (err: any) {
    logger.error('Report finalization failed', err)
    return c.json({ error: 'Failed to save report', details: err.message }, 500)
  }
})

// ============================================
// EDIT EDGES (manual corrections on existing report)
// ============================================

app.patch('/:id/edges', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)

  const body = await c.req.json()
  const { edges, measurements } = body

  if (!edges || !Array.isArray(edges)) {
    return c.json({ error: 'edges array required' }, 400)
  }

  // On first edit, snapshot the original auto-generated data for revert
  const updateData: Record<string, any> = {
    edges,
    measurements: measurements || report.measurements,
    userEdited: true,
    updatedAt: new Date(),
  }

  if (!report.userEdited) {
    updateData.originalEdges = report.edges
    updateData.originalMeasurements = report.measurements
  }

  await db.update(roofReport).set(updateData).where(eq(roofReport.id, id))

  return c.json({ success: true })
})

// ============================================
// REVERT TO ORIGINAL (undo all manual edits)
// ============================================

app.post('/:id/revert', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)
  if (!report.userEdited || !report.originalEdges) {
    return c.json({ error: 'No manual edits to revert' }, 400)
  }

  await db.update(roofReport).set({
    edges: report.originalEdges,
    measurements: report.originalMeasurements || report.measurements,
    userEdited: false,
    originalEdges: null,
    originalMeasurements: null,
    updatedAt: new Date(),
  }).where(eq(roofReport.id, id))

  return c.json({ success: true })
})

// ============================================
// AI ROOF DETECTION — Nearmap AI (primary) + SAM 2 (fallback)
// ============================================

app.post('/sam-segment', authenticate, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { imageBase64, clickPoints, labels, imageWidth, imageHeight, centerLat, centerLng, zoom } = body

  if (!centerLat || !centerLng) {
    return c.json({ error: 'centerLat and centerLng required' }, 400)
  }

  try {
    // --- Try Nearmap AI Feature API first (purpose-built roof detection) ---
    const nearmapAI = await getNearmapRoofAI(centerLat, centerLng)

    if (nearmapAI.available && nearmapAI.planes.length > 0) {
      logger.info('Using Nearmap AI for roof detection', {
        planes: nearmapAI.planes.length,
        edges: nearmapAI.edges.length,
        condition: nearmapAI.overallCondition,
        material: nearmapAI.primaryMaterial,
      })

      // Convert Nearmap AI edges to our format
      const edges = nearmapAI.edges.map(e => ({
        type: e.type,
        startLat: e.start.lat, startLng: e.start.lng,
        endLat: e.end.lat, endLng: e.end.lng,
        lengthFt: Math.round(e.lengthMeters * 3.28084 * 10) / 10,
      }))

      // Convert planes to polygons
      const polygons = nearmapAI.planes.map(p => ({
        vertices: p.polygon,
        area: p.areaSqm * 10.7639, // sqm to sqft
        pitch: p.pitchDeg,
        azimuth: p.azimuthDeg,
        material: p.material,
        condition: p.conditionScore,
      }))

      // Also fetch rollup for property-level facts
      const rollup = await getNearmapRollup(centerLat, centerLng)

      return c.json({
        source: 'nearmap_ai',
        polygons,
        edges,
        roofCondition: nearmapAI.overallCondition,
        roofMaterial: nearmapAI.primaryMaterial,
        treeOverhangPct: nearmapAI.treeOverhangPct,
        rollup: rollup.available ? rollup : null,
        processingTimeMs: 0, // Nearmap AI is pre-computed
      })
    }

    // --- Fallback to SAM 2 (generic segmentation) ---
    if (!segmentRoof) {
      return c.json({ error: 'AI segmentation not available (no Nearmap AI coverage and missing REPLICATE_API_TOKEN)' }, 503)
    }

    if (!imageBase64 || !clickPoints || !labels) {
      return c.json({ error: 'imageBase64, clickPoints, and labels required for SAM 2 fallback' }, 400)
    }

    const sam2Result = await segmentRoof({
      imageBase64,
      points: clickPoints,
      labels,
      imageWidth: imageWidth || 800,
      imageHeight: imageHeight || 600,
    })

    // Convert pixel polygons to geographic polygons
    const polygons = sam2Result.masks.map((mask: any) => {
      const geoVertices = mask.polygon.map((p: any) => {
        const scale = Math.pow(2, zoom) * 256
        const centerWorldX = (centerLng + 180) / 360 * scale
        const centerWorldY = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * scale
        const worldX = centerWorldX + (p.x - imageWidth / 2)
        const worldY = centerWorldY + (p.y - imageHeight / 2)
        const lng = worldX / scale * 360 - 180
        const n = Math.PI - 2 * Math.PI * worldY / scale
        const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
        return { lat, lng }
      })
      return { vertices: geoVertices, confidence: mask.confidence, area: mask.area }
    })

    const edges: any[] = []
    if (polygons.length > 0) {
      const verts = polygons[0].vertices
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length
        const lengthFt = haversineFeet(verts[i].lat, verts[i].lng, verts[j].lat, verts[j].lng)
        edges.push({
          type: 'eave',
          startLat: verts[i].lat, startLng: verts[i].lng,
          endLat: verts[j].lat, endLng: verts[j].lng,
          lengthFt: Math.round(lengthFt * 10) / 10,
        })
      }
    }

    return c.json({
      source: 'sam2',
      polygons,
      edges,
      processingTimeMs: sam2Result.processingTimeMs,
    })
  } catch (err: any) {
    logger.error('AI roof detection failed', { error: err.message })
    return c.json({ error: 'AI detection failed', details: err.message }, 500)
  }
})

// Haversine helper for SAM edge length calculation
function haversineFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 3.28084
}

// ============================================
// DSM GRID — elevation data for 3D viewer
// ============================================

app.get('/:id/dsm-grid', authenticate, async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')

  try {
    const [report] = await db.select().from(roofReport)
      .where(and(eq(roofReport.id, id), eq(roofReport.companyId, user.companyId)))
      .limit(1)

    if (!report) return c.json({ error: 'Report not found' }, 404)

    // Check if we have a cached DSM grid file
    if (report.dsmGridPath && fs.existsSync(report.dsmGridPath)) {
      const gridData = JSON.parse(fs.readFileSync(report.dsmGridPath, 'utf-8'))
      return c.json(gridData)
    }

    // Try to regenerate from the raw solar data
    // For now, return a synthetic grid based on segment geometry
    const segments = (report.segments || []) as any[]
    if (segments.length === 0) {
      return c.json({ error: 'No segment data available for 3D view' }, 404)
    }

    // Build a simple elevation grid from segment pitch/azimuth data
    const lat = Number(report.lat)
    const lng = Number(report.lng)
    const gridSize = 50
    const pixelSize = 0.0001 // ~11m per pixel

    const grid = {
      data: new Array(gridSize * gridSize).fill(0),
      width: gridSize,
      height: gridSize,
      originLat: lat - gridSize * pixelSize / 2,
      originLng: lng - gridSize * pixelSize / 2,
      pixelSizeLat: pixelSize,
      pixelSizeLng: pixelSize,
    }

    // Assign elevation based on segment pitch angles
    for (const seg of segments) {
      if (!seg.polygon || seg.polygon.length < 3) continue
      const pitchRad = (seg.pitchDegrees || 0) * Math.PI / 180
      const azRad = (seg.azimuthDegrees || 0) * Math.PI / 180
      const baseHeight = 8 // 8 meters base height

      for (let r = 0; r < gridSize; r++) {
        for (let col = 0; col < gridSize; col++) {
          const pLat = grid.originLat + r * pixelSize
          const pLng = grid.originLng + col * pixelSize

          // Simple point-in-polygon check
          if (pointInPolygonSimple(pLat, pLng, seg.polygon)) {
            // Height varies based on pitch/azimuth
            const dx = (pLng - lng) * 111319 * Math.cos(lat * Math.PI / 180)
            const dy = (pLat - lat) * 111319
            const slopeHeight = (dx * Math.sin(azRad) + dy * Math.cos(azRad)) * Math.tan(pitchRad)
            grid.data[r * gridSize + col] = baseHeight + slopeHeight
          }
        }
      }
    }

    return c.json(grid)
  } catch (err: any) {
    logger.error('DSM grid generation failed', { id, error: err.message })
    return c.json({ error: 'Failed to generate DSM grid' }, 500)
  }
})

function pointInPolygonSimple(lat: number, lng: number, polygon: any[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat, xi = polygon[i].lng
    const yj = polygon[j].lat, xj = polygon[j].lng
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export default app
