// Roof report routes — standalone estimator version
// Simplified from crm-roof's roofReports.ts. No Stripe (billing handled at tenant level).

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { roofReport, tenant } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/tenantAuth.ts'
import {
  geocodeAddress, getBuildingInsights, getDataLayers, downloadGeoTiff, formatSolarDate, isSummerImagery,
  generateRoofReport, generateRoofReportFromDSM, processDsm,
  generateReportHTML, generateReportPDF, generatePdfReadyHTML, computeOptimalZoom,
  fetchSatelliteImageBase64, MAP_WIDTH, MAP_HEIGHT,
  getBestElevationData, getNearmapRollup,
  downloadNearmapImage, getNearmapTileConfig, fetchNearmapImageBase64,
  generatePdfFromHtml,
} from '../../../../../packages/roof-core/src/index.ts'
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const UPLOADS_DIR = process.env.UPLOAD_DIR || './uploads'
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const app = new Hono()

// ============================================
// LIST REPORTS
// ============================================

app.get('/', authenticate, async (c) => {
  const t = c.get('tenant') as any
  const { page = '1', limit = '20' } = c.req.query()

  const pageNum = Math.max(1, +page)
  const limitNum = Math.min(100, Math.max(1, +limit))

  const reports = await db.select({
    id: roofReport.id,
    address: roofReport.address,
    city: roofReport.city,
    state: roofReport.state,
    zip: roofReport.zip,
    totalSquares: roofReport.totalSquares,
    segmentCount: roofReport.segmentCount,
    imageryQuality: roofReport.imageryQuality,
    imageryDate: roofReport.imageryDate,
    roofCondition: roofReport.roofCondition,
    roofMaterial: roofReport.roofMaterial,
    status: roofReport.status,
    createdAt: roofReport.createdAt,
  }).from(roofReport)
    .where(eq(roofReport.tenantId, t.id))
    .orderBy(desc(roofReport.createdAt))
    .offset((pageNum - 1) * limitNum)
    .limit(limitNum)

  return c.json({ reports, page: pageNum, limit: limitNum })
})

// ============================================
// GET SINGLE REPORT
// ============================================

app.get('/:id', authenticate, async (c) => {
  const t = c.get('tenant') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.tenantId, t.id)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)
  return c.json(report)
})

// ============================================
// GENERATE REPORT (the main flow)
// ============================================

app.post('/generate', authenticate, async (c) => {
  const t = c.get('tenant') as any

  // Check report limit
  if (t.reportsUsedThisMonth >= t.monthlyReportLimit && t.plan === 'free') {
    return c.json({ error: 'Monthly report limit reached. Upgrade your plan for more reports.' }, 429)
  }

  const { address, city, state, zip } = await c.req.json()
  if (!address || !city || !state || !zip) {
    return c.json({ error: 'address, city, state, and zip required' }, 400)
  }

  try {
    // Step 1: Geocode
    const geo = await geocodeAddress(address, city, state, zip)
    const buildingInsights = await getBuildingInsights(geo.lat, geo.lng)
    const quality = buildingInsights.imageryQuality || 'MEDIUM'

    let aerialImagePath: string | null = null
    let imageryDate: string | null = null
    let dsmBuffer: Buffer | null = null
    let maskBuffer: Buffer | null = null
    let imagerySource = 'google_solar'
    let elevationSource = 'google_dsm'

    // Step 2: Try Nearmap imagery
    try {
      const nearmapResult = await downloadNearmapImage(geo.lat, geo.lng, MAP_WIDTH, MAP_HEIGHT, 20)
      if (nearmapResult) {
        imagerySource = 'nearmap'
        imageryDate = nearmapResult.captureDate
        const fPath = path.join(UPLOADS_DIR, `${t.slug}-${Date.now()}-nearmap.png`)
        fs.writeFileSync(fPath, nearmapResult.buffer)
        aerialImagePath = fPath
      }
    } catch { /* fallback to Google */ }

    // Step 3: Google Solar data layers
    try {
      const dataLayers = await getDataLayers(geo.lat, geo.lng)
      if (!imageryDate) imageryDate = formatSolarDate(dataLayers.imageryDate)

      if (!aerialImagePath && dataLayers.rgbUrl) {
        const rgbBuf = await downloadGeoTiff(dataLayers.rgbUrl)
        const fPath = path.join(UPLOADS_DIR, `${t.slug}-${Date.now()}-aerial.png`)
        await sharp(rgbBuf).png().toFile(fPath)
        aerialImagePath = fPath
      }

      if (dataLayers.dsmUrl) {
        try { dsmBuffer = await downloadGeoTiff(dataLayers.dsmUrl) } catch {}
      }
      if (dataLayers.maskUrl) {
        try { maskBuffer = await downloadGeoTiff(dataLayers.maskUrl) } catch {}
      }
    } catch {}

    // Step 4: Best elevation data
    try {
      const elevData = await getBestElevationData(geo.lat, geo.lng, 75, dsmBuffer)
      elevationSource = elevData.source.type
      if (elevData.dsmBuffer) dsmBuffer = elevData.dsmBuffer
    } catch {}

    // Step 5: Generate geometry
    let result: any

    if (dsmBuffer && maskBuffer) {
      try {
        const dsmResult = await processDsm(dsmBuffer, maskBuffer, geo.lat, geo.lng)
        result = generateRoofReportFromDSM(dsmResult, geo.lat, geo.lng)
      } catch {
        result = generateRoofReport(buildingInsights)
      }
    } else {
      result = generateRoofReport(buildingInsights)
    }

    // Step 6: AI property facts
    let roofCondition: number | null = null
    let roofMaterial: string | null = null
    let treeOverhangPct: number | null = null
    try {
      const rollup = await getNearmapRollup(geo.lat, geo.lng)
      if (rollup.available) {
        roofCondition = rollup.roofCondition
        roofMaterial = rollup.roofMaterial
        treeOverhangPct = rollup.treeOverhangPct
      }
    } catch {}

    // Step 7: Format and save
    const edges = result.edges.map((e: any) => ({
      type: e.type, lengthFt: e.lengthFt,
      startLat: e.start.lat, startLng: e.start.lng,
      endLat: e.end.lat, endLng: e.end.lng,
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

    const [report] = await db.insert(roofReport).values({
      tenantId: t.id,
      address, city, state, zip,
      lat: geo.lat, lng: geo.lng,
      formattedAddress: `${address}, ${city}, ${state} ${zip}`,
      totalSquares: result.totalSquares, totalAreaSqft: result.totalAreaSqft,
      segmentCount: segments.length,
      imageryQuality: quality, imageryDate,
      aerialImagePath,
      segments, edges, measurements,
      rawSolarData: buildingInsights,
      imagerySource, elevationSource,
      roofCondition, roofMaterial, treeOverhangPct,
    }).returning()

    // Increment usage
    await db.update(tenant).set({
      reportsUsedThisMonth: t.reportsUsedThisMonth + 1,
      updatedAt: new Date(),
    }).where(eq(tenant.id, t.id))

    return c.json({ report }, 201)
  } catch (err: any) {
    console.error('Report generation failed:', err)
    return c.json({ error: 'Report generation failed', details: err.message }, 500)
  }
})

// ============================================
// HTML VIEW (public, shareable)
// ============================================

app.get('/:id/html', async (c) => {
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport).where(eq(roofReport.id, id)).limit(1)
  if (!report) return c.json({ error: 'Report not found' }, 404)

  const [t] = await db.select().from(tenant).where(eq(tenant.id, report.tenantId)).limit(1)

  const reportData = {
    center: { lat: Number(report.lat), lng: Number(report.lng) },
    segments: (report.segments || []) as any[],
    edges: (report.edges || []) as any[],
    measurements: (report.measurements || {}) as any,
    imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
    imageryDate: report.imageryDate || null,
    roofCondition: report.roofCondition,
    roofMaterial: report.roofMaterial,
    treeOverhangPct: report.treeOverhangPct,
    imagerySource: report.imagerySource,
    elevationSource: report.elevationSource,
  }

  const html = await generateReportHTML(reportData, t || {}, `${report.address}, ${report.city}, ${report.state} ${report.zip}`)
  return c.html(html)
})

// ============================================
// PDF DOWNLOAD
// ============================================

app.get('/:id/pdf', authenticate, async (c) => {
  const t = c.get('tenant') as any
  const id = c.req.param('id')

  const [report] = await db.select().from(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.tenantId, t.id)))
    .limit(1)

  if (!report) return c.json({ error: 'Report not found' }, 404)

  const reportData = {
    center: { lat: Number(report.lat), lng: Number(report.lng) },
    segments: (report.segments || []) as any[],
    edges: (report.edges || []) as any[],
    measurements: (report.measurements || {}) as any,
    imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
    imageryDate: report.imageryDate || null,
    roofCondition: report.roofCondition,
    roofMaterial: report.roofMaterial,
    treeOverhangPct: report.treeOverhangPct,
    imagerySource: report.imagerySource,
    elevationSource: report.elevationSource,
  }

  const fullAddress = `${report.address}, ${report.city}, ${report.state} ${report.zip}`

  try {
    const html = await generatePdfReadyHTML(reportData, t, fullAddress)
    const pdfBuffer = await generatePdfFromHtml(html)
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="roof-report-${id}.pdf"`,
      },
    })
  } catch {
    const html = await generateReportPDF(reportData, t, fullAddress)
    return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }
})

// ============================================
// DELETE
// ============================================

app.delete('/:id', authenticate, async (c) => {
  const t = c.get('tenant') as any
  const id = c.req.param('id')

  await db.delete(roofReport)
    .where(and(eq(roofReport.id, id), eq(roofReport.tenantId, t.id)))

  return c.json({ success: true })
})

export default app
