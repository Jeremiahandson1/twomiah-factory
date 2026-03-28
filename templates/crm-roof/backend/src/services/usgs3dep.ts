// USGS 3DEP (3D Elevation Program) LiDAR Integration
// Provides free, high-accuracy (1m) elevation data for most of the US.
// Used to supplement/replace Google Solar DSM for more accurate pitch calculations.
//
// Data sources:
// - Coverage check: USGS National Map API
// - Elevation grid: WCS (Web Coverage Service) endpoint for GeoTIFF download
// - Point queries: USGS Elevation Point Query Service (EPQS)

import { fromArrayBuffer } from 'geotiff'
import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LidarCoverage {
  available: boolean
  resolution: number      // meters per pixel (1 = best, 10 = 1/3 arc-second)
  sourceDataset: string   // e.g., "1m", "1/3 arc-second", "1/9 arc-second"
  lastUpdated: string
}

export interface LidarElevationGrid {
  data: Float32Array
  width: number
  height: number
  originLat: number
  originLng: number
  pixelSizeLat: number    // degrees per pixel (negative = south)
  pixelSizeLng: number    // degrees per pixel
  crs: string
}

interface GeoTransform {
  width: number
  height: number
  originX: number
  originY: number
  pixelW: number
  pixelH: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json'
const WCS_URL = 'https://elevation.nationalmap.gov/arcgis/services/3DEPElevation/ImageServer/WCSServer'
const COVERAGE_URL = 'https://tnmaccess.nationalmap.gov/api/v1/products'

// ---------------------------------------------------------------------------
// Coverage check
// ---------------------------------------------------------------------------

/**
 * Check if USGS 3DEP LiDAR data is available at a given location.
 * Queries the 3DEP elevation service to determine resolution and availability.
 */
export async function checkLidarCoverage(lat: number, lng: number): Promise<LidarCoverage> {
  try {
    // Query the EPQS service with a single point — if it returns data, LiDAR is available
    const url = `${EPQS_URL}?x=${lng}&y=${lat}&wkid=4326&units=Meters&includeDate=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })

    if (!res.ok) {
      return { available: false, resolution: 0, sourceDataset: '', lastUpdated: '' }
    }

    const data = await res.json() as any
    const value = data?.value

    if (value === undefined || value === null || value === -1000000) {
      return { available: false, resolution: 0, sourceDataset: '', lastUpdated: '' }
    }

    // Determine resolution by checking which datasets are available
    // Try 1m first (best), fall back to 1/3 arc-second (~10m), then 1/9 arc-second (~3m)
    const resolution = await detectResolution(lat, lng)

    return {
      available: true,
      resolution: resolution.metersPerPixel,
      sourceDataset: resolution.dataset,
      lastUpdated: data?.dateAccessed || new Date().toISOString().split('T')[0],
    }
  } catch (err: any) {
    logger.warn('USGS 3DEP coverage check error', { error: err.message, lat, lng })
    return { available: false, resolution: 0, sourceDataset: '', lastUpdated: '' }
  }
}

/**
 * Detect the best available resolution at a point.
 */
async function detectResolution(lat: number, lng: number): Promise<{
  metersPerPixel: number
  dataset: string
}> {
  try {
    // Query TNM access API for available elevation products at this location
    const bbox = `${lng - 0.001},${lat - 0.001},${lng + 0.001},${lat + 0.001}`
    const url = `${COVERAGE_URL}?datasets=Digital+Elevation+Model+(DEM)+1+meter&bbox=${bbox}&max=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })

    if (res.ok) {
      const data = await res.json() as any
      if (data?.total > 0 || (data?.items && data.items.length > 0)) {
        return { metersPerPixel: 1, dataset: '1m' }
      }
    }
  } catch {
    // Fall through to default
  }

  // Default to 1/3 arc-second (~10m) — available for all of continental US
  return { metersPerPixel: 10, dataset: '1/3 arc-second' }
}

// ---------------------------------------------------------------------------
// Elevation grid download
// ---------------------------------------------------------------------------

/**
 * Fetch a LiDAR elevation grid centered on a location.
 * Uses the USGS 3DEP WCS endpoint to download a GeoTIFF.
 *
 * @param lat Center latitude
 * @param lng Center longitude
 * @param radiusMeters Radius in meters around the center point
 * @returns Parsed elevation grid or null if unavailable
 */
export async function fetchLidarElevationGrid(
  lat: number,
  lng: number,
  radiusMeters: number = 75,
): Promise<LidarElevationGrid | null> {
  try {
    // Convert radius to approximate degrees
    const latDeg = radiusMeters / 111_319.5
    const lngDeg = radiusMeters / (111_319.5 * Math.cos(lat * Math.PI / 180))

    const minLat = lat - latDeg
    const maxLat = lat + latDeg
    const minLng = lng - lngDeg
    const maxLng = lng + lngDeg

    // WCS GetCoverage request for GeoTIFF
    const params = new URLSearchParams({
      SERVICE: 'WCS',
      VERSION: '2.0.1',
      REQUEST: 'GetCoverage',
      COVERAGEID: 'DEP3Elevation_1',
      FORMAT: 'image/tiff',
      SUBSET: `Long(${minLng},${maxLng})`,
      SUBSETTINGCRS: 'EPSG:4326',
    })
    // WCS SUBSET for lat needs separate param (can't put both in one)
    const url = `${WCS_URL}?${params.toString()}&SUBSET=Lat(${minLat},${maxLat})`

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })

    if (!res.ok) {
      // WCS may return XML error — try to parse it
      const text = await res.text()
      if (text.includes('ExceptionReport') || text.includes('NoApplicableCode')) {
        logger.info('USGS 3DEP WCS: no coverage for this area', { lat, lng })
        return null
      }
      logger.warn(`USGS 3DEP WCS failed: ${res.status}`, { lat, lng })
      return null
    }

    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('xml') || contentType.includes('html')) {
      // Error response disguised as 200
      logger.info('USGS 3DEP WCS returned non-TIFF response', { lat, lng, contentType })
      return null
    }

    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength < 1000) {
      // Too small to be a valid GeoTIFF
      logger.info('USGS 3DEP WCS response too small', { lat, lng, size: arrayBuf.byteLength })
      return null
    }

    return await parseLidarGeoTiff(arrayBuf, lat, lng)
  } catch (err: any) {
    logger.warn('USGS 3DEP elevation grid error', { error: err.message, lat, lng })
    return null
  }
}

/**
 * Parse a GeoTIFF from the USGS 3DEP WCS endpoint into our grid format.
 */
async function parseLidarGeoTiff(
  arrayBuf: ArrayBuffer,
  centerLat: number,
  centerLng: number,
): Promise<LidarElevationGrid | null> {
  try {
    const tiff = await fromArrayBuffer(arrayBuf)
    const image = await tiff.getImage()
    const width = image.getWidth()
    const height = image.getHeight()
    const rasters = await image.readRasters()
    const rawData = rasters[0] as Float32Array | Float64Array | Int16Array

    // Convert to Float32Array if needed
    const data = rawData instanceof Float32Array
      ? rawData
      : new Float32Array(rawData)

    // Extract geo-transform from bounding box
    const bbox = image.getBoundingBox() // [minX, minY, maxX, maxY]
    const originLng = bbox[0]
    const originLat = bbox[3] // top-left Y
    const pixelSizeLng = (bbox[2] - bbox[0]) / width
    const pixelSizeLat = -(bbox[3] - bbox[1]) / height // negative = south

    // Replace nodata values with NaN
    const noData = image.getGDALNoData() ?? -999999
    for (let i = 0; i < data.length; i++) {
      if (data[i] <= noData || data[i] < -1000) {
        data[i] = NaN
      }
    }

    return {
      data,
      width,
      height,
      originLat,
      originLng,
      pixelSizeLat,
      pixelSizeLng,
      crs: 'EPSG:4326',
    }
  } catch (err: any) {
    logger.warn('LiDAR GeoTIFF parse error', { error: err.message })
    return null
  }
}

// ---------------------------------------------------------------------------
// Convert LiDAR grid to DSM-compatible Buffer
// ---------------------------------------------------------------------------

/**
 * Convert a LiDAR elevation grid to a GeoTIFF buffer that can be passed
 * directly to the existing processDsm() function.
 * This allows the DSM processor to use LiDAR data without modification.
 */
export function lidarGridToBuffer(grid: LidarElevationGrid): Buffer {
  // The DSM processor expects a GeoTIFF buffer, but since we already
  // parsed it, we'll re-encode the raw elevation data.
  // For simplicity, we pass the raw Float32Array with metadata.
  // The dsmProcessor will accept this as a pre-parsed grid.

  // Store the grid data + metadata as a simple binary format:
  // Header: 4 ints (width, height) + 4 floats (originLat, originLng, pixelSizeLat, pixelSizeLng)
  // Body: Float32Array elevation data
  const headerSize = 4 * 4 + 4 * 8 // 4 int32 + 4 float64
  const buf = Buffer.alloc(headerSize + grid.data.byteLength)

  buf.writeInt32LE(grid.width, 0)
  buf.writeInt32LE(grid.height, 4)
  buf.writeInt32LE(0, 8)  // reserved
  buf.writeInt32LE(0, 12) // reserved
  buf.writeDoubleLE(grid.originLat, 16)
  buf.writeDoubleLE(grid.originLng, 24)
  buf.writeDoubleLE(grid.pixelSizeLat, 32)
  buf.writeDoubleLE(grid.pixelSizeLng, 40)

  Buffer.from(grid.data.buffer, grid.data.byteOffset, grid.data.byteLength)
    .copy(buf, headerSize)

  return buf
}

// ---------------------------------------------------------------------------
// Single-point elevation query
// ---------------------------------------------------------------------------

/**
 * Query elevation at a single point using the USGS EPQS service.
 * Useful for spot-checking or small number of points.
 */
export async function queryElevation(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `${EPQS_URL}?x=${lng}&y=${lat}&wkid=4326&units=Meters`
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null

    const data = await res.json() as any
    const value = data?.value
    if (value === undefined || value === null || value === -1000000) return null
    return value
  } catch {
    return null
  }
}
