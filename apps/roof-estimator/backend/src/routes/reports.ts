// Roof report routes — standalone estimator version
// Simplified from crm-roof's roofReports.ts. No Stripe (billing handled at tenant level).

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { roofReport, tenant, trainingExample } from '../../db/schema.ts'
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
// PREVIEW — fetch satellite + auto-detect (returns data for editor, does NOT save)
// ============================================

app.post('/preview', authenticate, async (c) => {
  const t = c.get('tenant') as any
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

    // Step 5: Auto-detect geometry (suggestion only — user will edit)
    let autoEdges: any[] = []
    let autoSegments: any[] = []
    let totalAreaSqft = 0
    let totalSquares = 0

    if (dsmBuffer && maskBuffer) {
      try {
        const dsmResult = await processDsm(dsmBuffer, maskBuffer, geo.lat, geo.lng)
        const result = generateRoofReportFromDSM(dsmResult, geo.lat, geo.lng)
        totalAreaSqft = result.totalAreaSqft
        totalSquares = result.totalSquares
        autoEdges = result.edges.map((e: any) => ({
          type: e.type, lengthFt: e.lengthFt,
          startLat: e.start.lat, startLng: e.start.lng,
          endLat: e.end.lat, endLng: e.end.lng,
        }))
        autoSegments = result.segments.map((s: any) => ({
          name: s.name, area: s.area, pitch: s.pitch,
          pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees,
          polygon: s.polygon.vertices,
        }))
      } catch { /* auto-detect failed — user will draw from scratch */ }
    }

    if (autoSegments.length === 0) {
      try {
        const result = generateRoofReport(buildingInsights)
        totalAreaSqft = result.totalAreaSqft
        totalSquares = result.totalSquares
        autoSegments = result.segments.map((s: any) => ({
          name: s.name, area: s.area, pitch: s.pitch,
          pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees,
          polygon: s.polygon?.vertices || [],
        }))
      } catch {}
    }

    // Step 6: Get satellite image for editor
    const zoom = computeOptimalZoom(autoSegments, MAP_WIDTH, MAP_HEIGHT)
    const satelliteImageBase64 = await fetchSatelliteImageBase64(geo.lat, geo.lng, zoom)

    // Serve aerial image if we have one
    let aerialUrl: string | null = null
    if (aerialImagePath) {
      const filename = path.basename(aerialImagePath)
      aerialUrl = `/api/reports/aerial/${filename}`
    }

    return c.json({
      // Address + geo
      address, city, state, zip,
      geo, quality, imageryDate, imagerySource, elevationSource,
      // For the editor
      zoom,
      satelliteImageBase64,
      aerialUrl,
      mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT,
      // Auto-detected (editable suggestions)
      autoEdges,
      autoSegments,
      totalAreaSqft, totalSquares,
      // Internal (for finalize)
      aerialImagePath,
    })
  } catch (err: any) {
    console.error('Preview generation failed:', err)
    return c.json({ error: 'Preview generation failed', details: err.message }, 500)
  }
})

// ============================================
// SERVE AERIAL IMAGES
// ============================================

app.get('/aerial/:filename', async (c) => {
  const filename = c.req.param('filename')
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return c.json({ error: 'Invalid filename' }, 400)
  }
  const filePath = path.join(UPLOADS_DIR, filename)
  if (!fs.existsSync(filePath)) return c.json({ error: 'Image not found' }, 404)

  const buf = fs.readFileSync(filePath)
  return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } })
})

// ============================================
// FINALIZE — save user-edited report to DB
// ============================================

app.post('/finalize', authenticate, async (c) => {
  const t = c.get('tenant') as any

  // Check report limit
  if (t.reportsUsedThisMonth >= t.monthlyReportLimit && t.plan === 'free') {
    return c.json({ error: 'Monthly report limit reached. Upgrade your plan for more reports.' }, 429)
  }

  const { preview, edges, measurements } = await c.req.json()
  if (!preview || !edges) return c.json({ error: 'preview and edges required' }, 400)

  try {
    const autoEdges = preview.autoEdges || []
    const correctedEdges = edges || []

    const [report] = await db.insert(roofReport).values({
      tenantId: t.id,
      address: preview.address, city: preview.city, state: preview.state, zip: preview.zip,
      lat: preview.geo.lat, lng: preview.geo.lng,
      formattedAddress: `${preview.address}, ${preview.city}, ${preview.state} ${preview.zip}`,
      totalSquares: measurements?.totalSquares || preview.totalSquares || 0,
      totalAreaSqft: measurements?.totalAreaSqft || preview.totalAreaSqft || 0,
      segmentCount: preview.autoSegments?.length || 0,
      imageryQuality: preview.quality || 'MEDIUM',
      imageryDate: preview.imageryDate,
      aerialImagePath: preview.aerialImagePath,
      segments: preview.autoSegments || [],
      edges: correctedEdges,
      measurements: measurements || {},
      originalEdges: autoEdges,
      originalMeasurements: null,
      imagerySource: preview.imagerySource || 'google_solar',
      elevationSource: preview.elevationSource || 'google_dsm',
      userEdited: true,
    }).returning()

    // --- Save training data (auto-detected vs user-corrected) ---
    try {
      // Calculate edit metrics
      const autoSet = new Set(autoEdges.map((e: any) => `${e.startLat},${e.startLng}-${e.endLat},${e.endLng}`))
      const correctedSet = new Set(correctedEdges.map((e: any) => `${e.startLat},${e.startLng}-${e.endLat},${e.endLng}`))

      let edgesDeleted = 0, edgesAdded = 0
      for (const key of autoSet) { if (!correctedSet.has(key)) edgesDeleted++ }
      for (const key of correctedSet) { if (!autoSet.has(key)) edgesAdded++ }

      // Edit score: 1.0 = no corrections, 0.0 = everything changed
      const totalEdges = Math.max(autoEdges.length, correctedEdges.length, 1)
      const editScore = Math.max(0, 1 - (edgesAdded + edgesDeleted) / totalEdges)

      // Roof complexity based on segment count
      const segCount = preview.autoSegments?.length || 0
      const roofComplexity = segCount <= 2 ? 'simple' : segCount <= 5 ? 'moderate' : 'complex'

      await db.insert(trainingExample).values({
        reportId: report.id,
        lat: preview.geo.lat,
        lng: preview.geo.lng,
        state: preview.state,
        aerialImagePath: preview.aerialImagePath,
        imagerySource: preview.imagerySource || 'google_solar',
        imageryQuality: preview.quality || 'MEDIUM',
        zoom: preview.zoom || 20,
        imageWidth: preview.mapWidth || 800,
        imageHeight: preview.mapHeight || 600,
        autoEdges,
        autoSegments: preview.autoSegments || [],
        detectionMethod: 'ransac',
        correctedEdges,
        correctedMeasurements: measurements || {},
        edgesAdded,
        edgesDeleted,
        edgesModified: 0,
        editScore,
        roofComplexity,
        buildingCount: 1,
      })

      console.log(`[Training] Saved example: ${edgesAdded} added, ${edgesDeleted} deleted, score=${editScore.toFixed(2)}`)
    } catch (trainErr: any) {
      // Non-blocking — don't fail the report if training data save fails
      console.warn('[Training] Failed to save training example:', trainErr.message)
    }

    // Increment usage
    await db.update(tenant).set({
      reportsUsedThisMonth: t.reportsUsedThisMonth + 1,
      updatedAt: new Date(),
    }).where(eq(tenant.id, t.id))

    return c.json({ report }, 201)
  } catch (err: any) {
    console.error('Report finalization failed:', err)
    return c.json({ error: 'Failed to save report', details: err.message }, 500)
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

// ============================================
// TRAINING DATA — export for ML model training
// ============================================

app.get('/training/stats', authenticate, async (c) => {
  const factoryKey = c.req.header('X-Factory-Key')
  if (factoryKey !== process.env.FACTORY_SYNC_KEY) {
    return c.json({ error: 'Factory key required for training data access' }, 403)
  }

  const examples = await db.select({
    total: trainingExample.id,
  }).from(trainingExample)

  const totalCount = examples.length

  return c.json({
    totalExamples: totalCount,
    message: totalCount < 500
      ? `${totalCount}/500 examples collected. Need ${500 - totalCount} more before training is viable.`
      : `${totalCount} examples ready for training. Run: bun scripts/export-training-data.ts`,
  })
})

app.get('/training/export', async (c) => {
  const factoryKey = c.req.header('X-Factory-Key')
  if (factoryKey !== process.env.FACTORY_SYNC_KEY) {
    return c.json({ error: 'Factory key required' }, 403)
  }

  const { limit = '1000', offset = '0', minEditScore, maxEditScore } = c.req.query()

  const examples = await db.select().from(trainingExample)
    .orderBy(desc(trainingExample.createdAt))
    .offset(+offset)
    .limit(Math.min(+limit, 5000))

  // Filter by edit score if requested (e.g., only examples where user made corrections)
  let filtered = examples
  if (minEditScore) filtered = filtered.filter(e => (e.editScore || 0) >= +minEditScore)
  if (maxEditScore) filtered = filtered.filter(e => (e.editScore || 1) <= +maxEditScore)

  return c.json({
    count: filtered.length,
    examples: filtered.map(e => ({
      id: e.id,
      lat: e.lat,
      lng: e.lng,
      state: e.state,
      imagerySource: e.imagerySource,
      imageryQuality: e.imageryQuality,
      zoom: e.zoom,
      imageWidth: e.imageWidth,
      imageHeight: e.imageHeight,
      aerialImagePath: e.aerialImagePath,
      autoEdges: e.autoEdges,
      autoSegments: e.autoSegments,
      detectionMethod: e.detectionMethod,
      correctedEdges: e.correctedEdges,
      correctedMeasurements: e.correctedMeasurements,
      edgesAdded: e.edgesAdded,
      edgesDeleted: e.edgesDeleted,
      editScore: e.editScore,
      roofComplexity: e.roofComplexity,
      createdAt: e.createdAt,
    })),
  })
})

export default app
