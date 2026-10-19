// The roof-report engine's glue: geometry and imagery for an address (a preview the roofer can correct), and the saved
// report. Moved from templates/crm-roof/backend/src/routes/roofReports.ts (generateReportPreview, saveReportToDb,
// generateAndSaveReport and the imagery helpers); the measuring, imagery, elevation and AI are packages/roof-core's.
//
// Changes from the template:
//   · the imagery (the aerial, the roof mask, their composite) is kept in the company's file store under
//     roof-imagery/<companyId>/, not on the server's disk: the disk of a deployed service is wiped at every deploy, so a
//     report's aerial vanished with the next release. A report holds its image's KEY;
//   · a key is only ever one the server wrote for this company (imageKeyFor): the template saved whatever path a client's
//     /finalize preview carried and the PUBLIC /:id/aerial.png and /:id/html then read that path off the disk — any file
//     on the server, for anyone with roof-reports:create;
//   · what a report was charged is what was charged (`amountCharged` is the caller's figure): the template wrote $9.99 on
//     every report, the free hand-drawn ones included.
import crypto from 'node:crypto'
import sharp from 'sharp'
import { and, eq } from 'drizzle-orm'
import {
  geocodeAddress, getBuildingInsights, getDataLayers, downloadGeoTiff, formatSolarDate, isSummerImagery,
  processDsm, generateRoofReport, generateRoofReportFromDSM, computeOptimalZoom, fetchSatelliteImageBase64,
  MAP_WIDTH, MAP_HEIGHT, downloadNearmapImage, getNearmapTileConfig, fetchNearmapImageBase64, getBestElevationData,
  getNearmapRollup,
} from '@twomiah/roof-core'
import { roofReport } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { fetchOsmBuildings, osmPolygonToLocal } from './osmFootprint.ts'

/** The professional report's price, $9.99 (templates/crm-roof REPORT_PRICE_CENTS). */
export const REPORT_PRICE_CENTS = 999

export interface PreviewData {
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

/** Where a company's roof imagery lives in the file store. */
export const imageryPrefix = (companyId: string) => `roof-imagery/${companyId}/`

/** A stored image key, only if it is one the server wrote for this company; anything else is no image. */
export const imageKeyFor = (companyId: string, key: unknown): string | null =>
  typeof key === 'string' && key.startsWith(imageryPrefix(companyId)) && /^[a-zA-Z0-9._-]+$/.test(key.slice(imageryPrefix(companyId).length)) ? key : null

export function createRoofReportService(d: CrmDeps) {
  const { db, logger } = d

  /** Keep an image in the store; its key, or null when it can't be kept (imagery never fails a report). */
  async function keep(key: string, body: Buffer): Promise<string | null> {
    try { await d.services.storage.put(key, body, 'image/png'); return key } catch (err: any) {
      logger.warn('Roof imagery not stored (non-blocking)', { key, error: err?.message })
      return null
    }
  }

  /** A stored image's bytes, or null. */
  async function imageBytes(key: string | null | undefined): Promise<Buffer | null> {
    if (!key) return null
    try { const o = await d.services.storage.getObject(key); return o ? Buffer.from(o.body) : null } catch { return null }
  }

  /** The Solar API's aerial GeoTIFF as a PNG, or null. */
  async function downloadAsPng(geoTiffUrl: string): Promise<Buffer | null> {
    try {
      return await sharp(await downloadGeoTiff(geoTiffUrl)).png({ quality: 90 }).toBuffer()
    } catch (err: any) {
      logger.warn('Failed to download/convert GeoTIFF', { error: err?.message })
      return null
    }
  }

  /** The aerial with its rooftop pixels (mask > 128) tinted, so the roof stands out; the plain aerial if that fails. */
  async function compositeAerialWithMask(rgbPng: Buffer, maskTiff: Buffer): Promise<Buffer> {
    try {
      const meta = await sharp(rgbPng).metadata()
      const w = meta.width || 800
      const h = meta.height || 600
      const rgbRaw = await sharp(rgbPng).ensureAlpha().raw().toBuffer()
      const maskRaw = await sharp(maskTiff).resize(w, h, { fit: 'fill' }).grayscale().raw().toBuffer()
      const out = Buffer.from(rgbRaw)
      for (let i = 0; i < w * h; i++) {
        if ((maskRaw[i] || 0) > 128) {
          const ri = i * 4
          out[ri] = Math.min(255, Math.round(out[ri] * 0.85 + 40))
          out[ri + 1] = Math.min(255, Math.round(out[ri + 1] * 0.85 + 55))
          out[ri + 2] = Math.min(255, Math.round(out[ri + 2] * 0.85 + 70))
        }
      }
      return await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png({ quality: 90 }).toBuffer()
    } catch (err: any) {
      logger.warn('Failed to composite aerial with mask', { error: err?.message })
      return rgbPng
    }
  }

  /** Step 1: geometry and imagery for an address, nothing saved to the database — the roofer reviews it first. */
  async function generateReportPreview(companyId: string, address: string, city: string, state: string, zip: string, eaveOverhangInches = 12): Promise<PreviewData> {
    const geo = await geocodeAddress(address, city, state, zip)
    const buildingInsights = await getBuildingInsights(geo.lat, geo.lng)
    const quality = buildingInsights.imageryQuality || 'MEDIUM'
    const base = `${imageryPrefix(companyId)}${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

    let aerialImagePath: string | null = null
    let roofMaskPath: string | null = null
    let imageryDate: string | null = null
    let dsmBuffer: Buffer | null = null
    let maskBuffer: Buffer | null = null
    let rgbPng: Buffer | null = null
    let imagerySource = 'google_solar'
    let elevationSource = 'google_dsm'
    let nearmapTileUrl: string | null = null
    let nearmapSurveyId: string | null = null

    // Nearmap (5-7cm), preferred where it covers the address.
    try {
      const nearmap = await downloadNearmapImage(geo.lat, geo.lng, MAP_WIDTH, MAP_HEIGHT, 20)
      if (nearmap) {
        imagerySource = 'nearmap'
        nearmapSurveyId = nearmap.surveyId
        imageryDate = nearmap.captureDate
        aerialImagePath = await keep(`${base}-nearmap.png`, nearmap.buffer)
        logger.info('Nearmap imagery downloaded', { address, captureDate: nearmap.captureDate })
        const tileConfig = await getNearmapTileConfig(geo.lat, geo.lng, nearmap.surveyId)
        if (tileConfig) nearmapTileUrl = tileConfig.tileUrl
      }
    } catch (err: any) {
      logger.info('Nearmap not available, using Google Solar', { error: err?.message, address })
    }

    try {
      const dataLayers = await getDataLayers(geo.lat, geo.lng)
      if (!imageryDate) imageryDate = formatSolarDate(dataLayers.imageryDate)
      if (isSummerImagery(dataLayers.imageryDate)) {
        logger.info('Roof report imagery is from summer months — tree obstruction possible', { address, imageryDate, month: dataLayers.imageryDate.month })
      }
      // Google's aerial only where Nearmap had none.
      if (!aerialImagePath) {
        rgbPng = await downloadAsPng(dataLayers.rgbUrl)
        if (rgbPng) aerialImagePath = await keep(`${base}-aerial.png`, rgbPng)
      }
      if (dataLayers.dsmUrl) {
        try {
          dsmBuffer = await downloadGeoTiff(dataLayers.dsmUrl)
          logger.info('DSM GeoTIFF downloaded', { address, bytes: dsmBuffer.length })
        } catch (err: any) {
          logger.warn('DSM download failed (non-blocking)', { error: err?.message })
        }
      }
      if (dataLayers.maskUrl) {
        try {
          maskBuffer = await downloadGeoTiff(dataLayers.maskUrl)
          roofMaskPath = await keep(`${base}-mask.png`, await sharp(maskBuffer).png().toBuffer())
          if (rgbPng && imagerySource !== 'nearmap') {
            const composite = await keep(`${base}-composite.png`, await compositeAerialWithMask(rgbPng, maskBuffer))
            if (composite) aerialImagePath = composite
          }
        } catch (err: any) {
          logger.warn('Roof mask download/processing failed (non-blocking)', { error: err?.message })
        }
      }
      logger.info('Solar API data layers downloaded', { address, imageryDate, imagerySource, hasAerial: !!aerialImagePath, hasMask: !!maskBuffer, hasDsm: !!dsmBuffer })
    } catch (err: any) {
      logger.warn('DataLayers API failed — falling back to metadata-based geometry', { error: err?.message, address })
      if (buildingInsights.imageryDate) imageryDate = formatSolarDate(buildingInsights.imageryDate)
    }

    // The best elevation (USGS 3DEP LiDAR where it exists) — named on the report as its source.
    try {
      const elev = await getBestElevationData(geo.lat, geo.lng, 75, dsmBuffer)
      elevationSource = elev.source.type
      if (elev.lidarGrid) logger.info('USGS 3DEP LiDAR available', { address, resolution: elev.source.resolution, description: elev.source.description })
    } catch (err: any) {
      logger.info('LiDAR check failed (non-blocking)', { error: err?.message })
    }

    let result: any
    let geometrySource = 'metadata'
    if (dsmBuffer && maskBuffer) {
      try {
        let osmLocal: Array<{ polygon: Array<{ x: number; y: number }> }> = []
        try {
          const buildings = await fetchOsmBuildings(geo.lat, geo.lng)
          osmLocal = buildings.map((b) => ({ polygon: osmPolygonToLocal(b.polygon, geo.lat, geo.lng) }))
        } catch { /* non-blocking */ }
        const dsmResult = await processDsm(dsmBuffer, maskBuffer, geo.lat, geo.lng, osmLocal, null)
        result = generateRoofReportFromDSM(dsmResult, geo.lat, geo.lng, eaveOverhangInches)
        geometrySource = elevationSource === 'google_dsm' ? 'dsm' : `dsm+${elevationSource}`
        logger.info('Roof geometry computed from DSM elevation data', { address, planes: dsmResult.planes.length, segments: result.segments.length, elevationSource })
      } catch (err: any) {
        logger.warn('DSM processing failed — falling back to metadata geometry', { error: err?.message, address })
        result = generateRoofReport(buildingInsights, eaveOverhangInches)
      }
    } else {
      result = generateRoofReport(buildingInsights, eaveOverhangInches)
    }
    logger.info('Roof report preview generated', { address, geometrySource, segments: result.segments.length, totalSquares: result.totalSquares })

    const edges = result.edges.map((e: any) => ({
      type: e.type, lengthFt: e.lengthFt,
      startLat: e.start.lat, startLng: e.start.lng, endLat: e.end.lat, endLng: e.end.lng,
      segmentIndex: e.segmentA,
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
      name: s.name, area: s.area, pitch: s.pitch, pitchDegrees: s.pitchDegrees, azimuthDegrees: s.azimuthDegrees, polygon: s.polygon.vertices,
    }))

    // The editor's backdrop: Nearmap where it covered the address, else Google Static Maps, at a zoom that fits the roof.
    const zoom = computeOptimalZoom(segments, MAP_WIDTH, MAP_HEIGHT)
    let nearmapBase64: string | null = null
    if (imagerySource === 'nearmap') {
      const nm = await fetchNearmapImageBase64(geo.lat, geo.lng, zoom)
      if (nm) nearmapBase64 = nm.dataUrl
    }
    const satelliteImageBase64 = await fetchSatelliteImageBase64(geo.lat, geo.lng, zoom, nearmapBase64)

    // Nearmap AI's read of the property (condition, material, tree overhang), where it has one.
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
      }
    } catch { /* non-blocking */ }

    return {
      geo, quality, imageryDate, aerialImagePath, roofMaskPath, edges, segments, measurements,
      totalAreaSqft: result.totalAreaSqft, totalSquares: result.totalSquares,
      rawSolarData: buildingInsights, geometrySource, zoom, satelliteImageBase64, mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT,
      imagerySource, elevationSource, nearmapTileUrl, nearmapSurveyId, roofCondition, roofMaterial, treeOverhangPct, aiSource,
    }
  }

  /** Step 2: the finished report, saved. `amountCharged` is what the company was actually charged for it. */
  async function saveReportToDb(preview: PreviewData, o: {
    companyId: string; address: string; city: string; state: string; zip: string; edges: any[]; measurements: any;
    contactId?: string | null; stripePaymentIntentId?: string | null; amountCharged: string; status?: string
  }) {
    const [report] = await db.insert(roofReport).values({
      companyId: o.companyId, address: o.address, city: o.city, state: o.state, zip: o.zip,
      lat: preview.geo.lat, lng: preview.geo.lng,
      formattedAddress: `${o.address}, ${o.city}, ${o.state} ${o.zip}`,
      totalSquares: preview.totalSquares, totalAreaSqft: preview.totalAreaSqft,
      segmentCount: preview.segments.length,
      imageryQuality: preview.quality, imageryDate: preview.imageryDate,
      aerialImagePath: imageKeyFor(o.companyId, preview.aerialImagePath), roofMaskPath: imageKeyFor(o.companyId, preview.roofMaskPath),
      segments: preview.segments, edges: o.edges, measurements: o.measurements,
      rawSolarData: preview.rawSolarData,
      status: o.status || 'paid', amountCharged: o.amountCharged,
      stripePaymentIntentId: o.stripePaymentIntentId || null,
      contactId: o.contactId || null,
      imagerySource: preview.imagerySource || 'google_solar',
      elevationSource: preview.elevationSource || 'google_dsm',
      nearmapSurveyId: preview.nearmapSurveyId || null,
      roofCondition: preview.roofCondition || null,
      roofMaterial: preview.roofMaterial || null,
      treeOverhangPct: preview.treeOverhangPct || null,
      aiSource: preview.aiSource || null,
    } as any).returning()
    return report
  }

  /** Generate and save in one step (the paid and contact flows, which have no editing step). */
  async function generateAndSaveReport(o: {
    companyId: string; address: string; city: string; state: string; zip: string; contactId?: string | null
    stripePaymentIntentId?: string | null; eaveOverhangInches?: number; amountCharged: string; status?: string
  }) {
    const preview = await generateReportPreview(o.companyId, o.address, o.city, o.state, o.zip, o.eaveOverhangInches ?? 12)
    return saveReportToDb(preview, { ...o, edges: preview.edges, measurements: preview.measurements })
  }

  /** A saved report as the renderer draws it, its stored aerial inlined. */
  async function renderData(report: any) {
    const aerial = await imageBytes(imageKeyFor(report.companyId, report.aerialImagePath))
    return {
      center: { lat: Number(report.lat), lng: Number(report.lng) },
      segments: (report.segments || []) as any[],
      edges: (report.edges || []) as any[],
      measurements: (report.measurements || {}) as any,
      imageryQuality: (report.imageryQuality || 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      imageryDate: report.imageryDate || null,
      aerialImageBase64: aerial ? `data:image/png;base64,${aerial.toString('base64')}` : null,
      roofCondition: report.roofCondition || null,
      roofMaterial: report.roofMaterial || null,
      treeOverhangPct: report.treeOverhangPct || null,
      imagerySource: report.imagerySource || null,
      elevationSource: report.elevationSource || null,
    }
  }

  /** The Factory's review queue is told of a report that needs a person to check it (non-blocking). */
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
      logger.warn('Factory notification failed (non-blocking)', { error: err?.message })
    }
  }

  /** A report by id, within the company. */
  async function ownReport(companyId: string, id: string) {
    return (await db.select().from(roofReport).where(and(eq(roofReport.id, id), eq(roofReport.companyId, companyId))).limit(1))[0] || null
  }

  return { generateReportPreview, saveReportToDb, generateAndSaveReport, renderData, imageBytes, notifyFactoryNewReport, ownReport }
}

export type RoofReportService = ReturnType<typeof createRoofReportService>
