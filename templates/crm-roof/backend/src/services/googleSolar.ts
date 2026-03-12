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
    requiredQuality: 'LOW', // accept any quality; we'll surface it to the user
    key: getApiKey(),
  })
  const res = await fetch(`${SOLAR_URL}?${params}`)
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
