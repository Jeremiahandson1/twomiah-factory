// Nearmap Imagery Provider — high-resolution (5-7cm) aerial imagery
// Used as primary imagery source when available, with Google Solar as fallback.
// Nearmap API docs: https://docs.nearmap.com/

import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearmapSurvey {
  id: string
  captureDate: string     // ISO date
  resolution: number      // cm/pixel
  type: 'Vert' | 'North' | 'South' | 'East' | 'West'
}

export interface NearmapCoverage {
  available: boolean
  surveys: NearmapSurvey[]
  bestSurvey: NearmapSurvey | null
}

export interface NearmapTileConfig {
  tileUrl: string         // XYZ tile URL template for MapLibre: {z}/{x}/{y}
  attribution: string
  maxZoom: number
  captureDate: string
  surveyId: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEARMAP_BASE_URL || 'https://api.nearmap.com'

function getApiKey(): string {
  const key = process.env.NEARMAP_API_KEY || ''
  if (!key) throw new Error('Missing NEARMAP_API_KEY environment variable')
  return key
}

function isConfigured(): boolean {
  return !!process.env.NEARMAP_API_KEY
}

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Check if Nearmap has aerial imagery coverage at a given location.
 * Queries the coverage API and returns available surveys sorted by recency.
 */
export async function checkNearmapCoverage(lat: number, lng: number): Promise<NearmapCoverage> {
  if (!isConfigured()) {
    return { available: false, surveys: [], bestSurvey: null }
  }

  try {
    const apiKey = getApiKey()
    // Coverage API: GET /coverage/v2/coord/{lat},{lng}
    const url = `${BASE_URL}/coverage/v2/coord/${lat},${lng}?apikey=${apiKey}&limit=10&fields=captureDate,pixelSize,photoType`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (!res.ok) {
      if (res.status === 404) {
        // No coverage at this location
        return { available: false, surveys: [], bestSurvey: null }
      }
      logger.warn(`Nearmap coverage check failed: ${res.status}`, { lat, lng })
      return { available: false, surveys: [], bestSurvey: null }
    }

    const data = await res.json() as any

    // Parse surveys from response
    const surveys: NearmapSurvey[] = []
    const surveyList = data?.surveys || data?.results || []

    for (const s of surveyList) {
      const type = s.photoType || s.type || 'Vert'
      // Only use vertical (nadir) imagery for roof measurement
      if (type !== 'Vert') continue

      surveys.push({
        id: s.id || s.surveyId || `${s.captureDate}`,
        captureDate: s.captureDate || '',
        resolution: s.pixelSize ? s.pixelSize * 100 : 7, // meters → cm
        type: 'Vert',
      })
    }

    // Sort by capture date descending (most recent first)
    surveys.sort((a, b) => b.captureDate.localeCompare(a.captureDate))

    const bestSurvey = surveys[0] || null

    return {
      available: surveys.length > 0,
      surveys,
      bestSurvey,
    }
  } catch (err: any) {
    logger.warn('Nearmap coverage check error', { error: err.message, lat, lng })
    return { available: false, surveys: [], bestSurvey: null }
  }
}

// ---------------------------------------------------------------------------
// Tile configuration (for MapLibre frontend)
// ---------------------------------------------------------------------------

/**
 * Get XYZ tile URL configuration for MapLibre raster source.
 * Returns null if Nearmap is not available at this location.
 */
export async function getNearmapTileConfig(
  lat: number,
  lng: number,
  surveyId?: string,
): Promise<NearmapTileConfig | null> {
  if (!isConfigured()) return null

  const coverage = await checkNearmapCoverage(lat, lng)
  if (!coverage.available || !coverage.bestSurvey) return null

  const survey = surveyId
    ? coverage.surveys.find(s => s.id === surveyId) || coverage.bestSurvey
    : coverage.bestSurvey

  const apiKey = getApiKey()

  // Nearmap XYZ tile URL with survey date filter
  const tileUrl = `${BASE_URL}/tiles/v3/Vert/{z}/{x}/{y}.img?apikey=${apiKey}&until=${survey.captureDate}`

  return {
    tileUrl,
    attribution: `&copy; Nearmap ${survey.captureDate}`,
    maxZoom: 23,
    captureDate: survey.captureDate,
    surveyId: survey.id,
  }
}

// ---------------------------------------------------------------------------
// Static image download (for reports & SAM 2)
// ---------------------------------------------------------------------------

/**
 * Download a high-resolution static aerial image from Nearmap.
 * Returns a PNG buffer or null if unavailable.
 */
export async function downloadNearmapImage(
  lat: number,
  lng: number,
  width: number = 800,
  height: number = 600,
  zoom: number = 20,
  surveyId?: string,
): Promise<{ buffer: Buffer; captureDate: string; surveyId: string } | null> {
  if (!isConfigured()) return null

  try {
    const coverage = await checkNearmapCoverage(lat, lng)
    if (!coverage.available || !coverage.bestSurvey) return null

    const survey = surveyId
      ? coverage.surveys.find(s => s.id === surveyId) || coverage.bestSurvey
      : coverage.bestSurvey

    const apiKey = getApiKey()

    // Nearmap static map image API
    const url = `${BASE_URL}/staticmap/v3/image?point=${lat},${lng}&size=${width}x${height}&zoom=${zoom}&apikey=${apiKey}&until=${survey.captureDate}`

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) {
      logger.warn(`Nearmap image download failed: ${res.status}`, { lat, lng, zoom })
      return null
    }

    const arrayBuf = await res.arrayBuffer()
    return {
      buffer: Buffer.from(arrayBuf),
      captureDate: survey.captureDate,
      surveyId: survey.id,
    }
  } catch (err: any) {
    logger.warn('Nearmap image download error', { error: err.message, lat, lng })
    return null
  }
}

// ---------------------------------------------------------------------------
// Image as base64 data URL (for HTML reports)
// ---------------------------------------------------------------------------

/**
 * Download Nearmap aerial image and return as base64 data URL.
 * Convenience wrapper around downloadNearmapImage for the renderer.
 */
export async function fetchNearmapImageBase64(
  lat: number,
  lng: number,
  zoom: number,
  width: number = 800,
  height: number = 600,
): Promise<{ dataUrl: string; captureDate: string; surveyId: string } | null> {
  const result = await downloadNearmapImage(lat, lng, width, height, zoom)
  if (!result) return null

  const base64 = result.buffer.toString('base64')
  return {
    dataUrl: `data:image/png;base64,${base64}`,
    captureDate: result.captureDate,
    surveyId: result.surveyId,
  }
}

// ---------------------------------------------------------------------------
// Transactional Content API — DSM/DTM at 5cm resolution
// ---------------------------------------------------------------------------

/**
 * Download a high-resolution Digital Surface Model (DSM) from Nearmap.
 * 5cm resolution — far superior to Google Solar (~25cm) or USGS 3DEP (1m).
 * Returns a GeoTIFF buffer compatible with the existing dsmProcessor.
 */
export async function downloadNearmapDSM(
  lat: number,
  lng: number,
  radiusMeters: number = 75,
): Promise<{ buffer: Buffer; captureDate: string } | null> {
  if (!isConfigured()) return null

  try {
    const apiKey = getApiKey()

    // Convert radius to bbox
    const latDeg = radiusMeters / 111_319.5
    const lngDeg = radiusMeters / (111_319.5 * Math.cos(lat * Math.PI / 180))

    const south = lat - latDeg
    const north = lat + latDeg
    const west = lng - lngDeg
    const east = lng + lngDeg

    // Transactional Content API for DSM GeoTIFF
    const url = `${BASE_URL}/content/v4/dsm?apikey=${apiKey}&polygon=${west},${south},${east},${south},${east},${north},${west},${north},${west},${south}&format=geotiff`

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })

    if (!res.ok) {
      if (res.status === 404 || res.status === 204) {
        logger.info('Nearmap DSM not available for this area', { lat, lng })
        return null
      }
      logger.warn(`Nearmap DSM download failed: ${res.status}`, { lat, lng })
      return null
    }

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('tiff') && !contentType.includes('octet')) {
      logger.info('Nearmap DSM returned non-TIFF response', { lat, lng, contentType })
      return null
    }

    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength < 1000) {
      logger.info('Nearmap DSM response too small', { lat, lng, size: arrayBuf.byteLength })
      return null
    }

    // Get capture date from response headers
    const captureDate = res.headers.get('x-nearmap-capture-date') ||
                        res.headers.get('x-capture-date') ||
                        new Date().toISOString().split('T')[0]

    logger.info('Nearmap DSM downloaded', {
      lat, lng, bytes: arrayBuf.byteLength, captureDate,
    })

    return {
      buffer: Buffer.from(arrayBuf),
      captureDate,
    }
  } catch (err: any) {
    logger.warn('Nearmap DSM download error', { error: err.message, lat, lng })
    return null
  }
}

/**
 * Download a Digital Terrain Model (DTM) from Nearmap.
 * DTM = ground-level elevation (buildings removed).
 * Useful for computing true building height (DSM - DTM = building height).
 */
export async function downloadNearmapDTM(
  lat: number,
  lng: number,
  radiusMeters: number = 75,
): Promise<{ buffer: Buffer; captureDate: string } | null> {
  if (!isConfigured()) return null

  try {
    const apiKey = getApiKey()

    const latDeg = radiusMeters / 111_319.5
    const lngDeg = radiusMeters / (111_319.5 * Math.cos(lat * Math.PI / 180))

    const south = lat - latDeg
    const north = lat + latDeg
    const west = lng - lngDeg
    const east = lng + lngDeg

    const url = `${BASE_URL}/content/v4/dtm?apikey=${apiKey}&polygon=${west},${south},${east},${south},${east},${north},${west},${north},${west},${south}&format=geotiff`

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })

    if (!res.ok) return null

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('tiff') && !contentType.includes('octet')) return null

    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength < 1000) return null

    const captureDate = res.headers.get('x-nearmap-capture-date') || new Date().toISOString().split('T')[0]

    return { buffer: Buffer.from(arrayBuf), captureDate }
  } catch (err: any) {
    logger.warn('Nearmap DTM download error', { error: err.message, lat, lng })
    return null
  }
}
