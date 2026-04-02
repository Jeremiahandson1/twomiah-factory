// Google Solar API integration for roof measurement reports
// Docs: https://developers.google.com/maps/documentation/solar

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
const SOLAR_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest'

function getApiKey(): string {
  const key = process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!key) throw new Error('Missing GOOGLE_SOLAR_API_KEY environment variable')
  return key
}

export interface GeocodedLocation {
  lat: number
  lng: number
  formattedAddress: string
}

export interface RoofSegment {
  name: string
  area: number         // sqft
  pitch: string        // e.g. "6/12"
  pitchDegrees: number
  azimuthDegrees: number
  boundingBox?: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } }
}

export interface ProcessedRoofData {
  totalAreaSqft: number
  totalSquares: number  // area / 100
  segments: RoofSegment[]
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
  imageryDate: string | null
  maxSunshineHoursPerYear: number | null
  carbonOffsetFactor: number | null
  center: { lat: number; lng: number }
}

export interface BuildingInsightsResponse {
  name: string
  center: { latitude: number; longitude: number }
  imageryDate: { year: number; month: number; day: number }
  imageryQuality: string
  regionCode: string
  solarPotential: {
    maxArrayPanelsCount: number
    maxArrayAreaMeters2: number
    maxSunshineHoursPerYear: number
    carbonOffsetFactorKgPerMwh: number
    roofSegmentStats: Array<{
      pitchDegrees: number
      azimuthDegrees: number
      stats: {
        areaMeters2: number
        sunshineQuantiles: number[]
        groundAreaMeters2: number
      }
      center: { latitude: number; longitude: number }
      boundingBox: {
        sw: { latitude: number; longitude: number }
        ne: { latitude: number; longitude: number }
      }
      planeHeightAtCenterMeters: number
    }>
    buildingStats: {
      areaMeters2: number
      sunshineQuantiles: number[]
      groundAreaMeters2: number
    }
    wholeRoofStats: {
      areaMeters2: number
      sunshineQuantiles: number[]
      groundAreaMeters2: number
    }
  }
}

/**
 * Geocode an address to lat/lng
 */
export async function geocodeAddress(address: string, city: string, state: string, zip: string): Promise<GeocodedLocation> {
  const fullAddress = `${address}, ${city}, ${state} ${zip}`
  const params = new URLSearchParams({ address: fullAddress, key: getApiKey() })
  const res = await fetch(`${GEOCODE_URL}?${params}`)
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)
  const data = await res.json()
  if (!data.results?.length) throw new Error('Address not found')
  const loc = data.results[0]
  return {
    lat: loc.geometry.location.lat,
    lng: loc.geometry.location.lng,
    formattedAddress: loc.formatted_address,
  }
}

/**
 * Fetch building insights from Google Solar API
 */
export async function getBuildingInsights(lat: number, lng: number): Promise<BuildingInsightsResponse> {
  const params = new URLSearchParams({
    'location.latitude': String(lat),
    'location.longitude': String(lng),
    requiredQuality: 'HIGH',
    key: getApiKey(),
  })
  let res = await fetch(`${SOLAR_URL}?${params}`)
  // Fall back to MEDIUM if HIGH not available
  if (!res.ok && res.status === 404) {
    params.set('requiredQuality', 'MEDIUM')
    res = await fetch(`${SOLAR_URL}?${params}`)
  }
  // Fall back to LOW as last resort
  if (!res.ok && res.status === 404) {
    params.set('requiredQuality', 'LOW')
    res = await fetch(`${SOLAR_URL}?${params}`)
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Solar API error ${res.status}: ${errBody}`)
  }
  return res.json()
}

// Helper: convert pitch degrees to rise/run notation
function pitchToRiseRun(degrees: number): string {
  const rise = Math.round(Math.tan((degrees * Math.PI) / 180) * 12)
  return `${rise}/12`
}

// Helper: square meters to square feet
function sqmToSqft(m2: number): number {
  return m2 * 10.7639
}

/**
 * Process raw Solar API response into roofing-specific data
 */
export function processRoofData(data: BuildingInsightsResponse): ProcessedRoofData {
  const segments: RoofSegment[] = (data.solarPotential?.roofSegmentStats || []).map((seg, i) => {
    const areaSqft = sqmToSqft(seg.stats.areaMeters2)
    return {
      name: `Segment ${i + 1}`,
      area: Math.round(areaSqft),
      pitch: pitchToRiseRun(seg.pitchDegrees),
      pitchDegrees: Math.round(seg.pitchDegrees * 10) / 10,
      azimuthDegrees: Math.round(seg.azimuthDegrees),
      boundingBox: seg.boundingBox ? {
        sw: { lat: seg.boundingBox.sw.latitude, lng: seg.boundingBox.sw.longitude },
        ne: { lat: seg.boundingBox.ne.latitude, lng: seg.boundingBox.ne.longitude },
      } : undefined,
    }
  })

  const totalAreaSqft = segments.reduce((sum, s) => sum + s.area, 0)
  const totalSquares = Math.round((totalAreaSqft / 100) * 100) / 100

  const imageryDate = data.imageryDate
    ? `${data.imageryDate.year}-${String(data.imageryDate.month).padStart(2, '0')}-${String(data.imageryDate.day).padStart(2, '0')}`
    : null

  return {
    totalAreaSqft,
    totalSquares,
    segments,
    imageryQuality: (data.imageryQuality || 'LOW') as ProcessedRoofData['imageryQuality'],
    imageryDate,
    maxSunshineHoursPerYear: data.solarPotential?.maxSunshineHoursPerYear ?? null,
    carbonOffsetFactor: data.solarPotential?.carbonOffsetFactorKgPerMwh ?? null,
    center: {
      lat: data.center.latitude,
      lng: data.center.longitude,
    },
  }
}

/**
 * Full pipeline: geocode → Solar API → process
 */
export async function getFullRoofReport(address: string, city: string, state: string, zip: string) {
  const geo = await geocodeAddress(address, city, state, zip)
  const insights = await getBuildingInsights(geo.lat, geo.lng)
  const roofData = processRoofData(insights)
  return { geo, insights, roofData }
}

// ---------------------------------------------------------------------------
// Data Layers API — high-resolution aerial imagery + roof mask
// ---------------------------------------------------------------------------

const DATA_LAYERS_URL = 'https://solar.googleapis.com/v1/dataLayers:get'
const GEOTIFF_URL = 'https://solar.googleapis.com/v1/geoTiff:get'

export interface DataLayersResponse {
  imageryDate: { year: number; month: number; day: number }
  imageryProcessedDate?: { year: number; month: number; day: number }
  dsmUrl: string
  rgbUrl: string
  maskUrl: string
  annualFluxUrl?: string
  monthlyFluxUrl?: string
  hourlyShadeUrls?: string[]
  imageryQuality: string
}

/**
 * Fetch data layers (aerial RGB + roof mask) from Google Solar API.
 * Uses IMAGERY_LAYERS view — returns DSM, RGB, and mask only (smallest payload).
 */
export async function getDataLayers(lat: number, lng: number, radiusMeters = 75): Promise<DataLayersResponse> {
  const params = new URLSearchParams({
    'location.latitude': String(lat),
    'location.longitude': String(lng),
    radiusMeters: String(radiusMeters),
    view: 'IMAGERY_LAYERS',
    requiredQuality: 'HIGH',
    pixelSizeMeters: '0.25',
    key: getApiKey(),
  })
  let res = await fetch(`${DATA_LAYERS_URL}?${params}`)
  if (!res.ok && res.status === 404) {
    params.set('requiredQuality', 'MEDIUM')
    res = await fetch(`${DATA_LAYERS_URL}?${params}`)
  }
  if (!res.ok && res.status === 404) {
    params.set('requiredQuality', 'LOW')
    res = await fetch(`${DATA_LAYERS_URL}?${params}`)
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`DataLayers API error ${res.status}: ${errBody}`)
  }
  return res.json()
}

/**
 * Download a GeoTIFF from a Solar API data layer URL.
 * Returns raw binary buffer. URLs expire after ~1 hour.
 */
export async function downloadGeoTiff(url: string): Promise<Buffer> {
  // Append API key if not already present
  const separator = url.includes('?') ? '&' : '?'
  const fullUrl = url.includes('key=') ? url : `${url}${separator}key=${getApiKey()}`
  const res = await fetch(fullUrl)
  if (!res.ok) {
    throw new Error(`GeoTIFF download failed: ${res.status} ${res.statusText}`)
  }
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

/**
 * Format a Solar API date object to YYYY-MM-DD string.
 */
export function formatSolarDate(d: { year: number; month: number; day: number }): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
}

/**
 * Check if an imagery date falls in summer months (Jun-Aug) when deciduous
 * trees are most likely to obscure roof structures.
 */
export function isSummerImagery(d: { year: number; month: number; day: number }): boolean {
  return d.month >= 6 && d.month <= 8
}

/**
 * Check if an imagery date falls in winter months (Dec-Feb) — best for
 * roof visibility with deciduous trees bare.
 */
export function isWinterImagery(d: { year: number; month: number; day: number }): boolean {
  return d.month === 12 || d.month <= 2
}
