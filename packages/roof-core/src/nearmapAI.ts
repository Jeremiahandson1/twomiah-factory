// Nearmap AI Feature API — purpose-built roof detection
// Returns pre-classified roof planes, edges, condition scores, material types.
// Much more accurate than generic segmentation (SAM 2) since it's trained on roofing.
//
// API Docs: https://docs.nearmap.com/display/ND/AI+Feature+API
//
// Hierarchy: Nearmap AI (best) → SAM 2 (fallback) → RANSAC (always available)

import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NearmapRoofPlane {
  /** Polygon vertices in [lng, lat] format */
  polygon: Array<{ lat: number; lng: number }>
  /** Area in square meters */
  areaSqm: number
  /** Pitch angle in degrees */
  pitchDeg: number
  /** Azimuth (compass direction the slope faces) */
  azimuthDeg: number
  /** Roof material detected by AI */
  material: string | null  // 'shingle', 'tile', 'metal', 'flat', 'unknown'
  /** Roof condition score (0-100, higher = better) */
  conditionScore: number | null
}

export interface NearmapRoofEdge {
  type: 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'
  start: { lat: number; lng: number }
  end: { lat: number; lng: number }
  lengthMeters: number
}

export interface NearmapAIResult {
  available: boolean
  planes: NearmapRoofPlane[]
  edges: NearmapRoofEdge[]
  /** Overall roof condition (0-100) */
  overallCondition: number | null
  /** Primary material detected */
  primaryMaterial: string | null
  /** Tree overhang percentage */
  treeOverhangPct: number | null
  /** Total roof area from AI (sqm) */
  totalAreaSqm: number
  /** Imagery date used for AI analysis */
  imageryDate: string | null
}

export interface NearmapRollupResult {
  available: boolean
  roofAreaSqm: number
  roofCondition: number | null      // 0-100
  roofMaterial: string | null
  treeOverhangPct: number | null
  poolPresent: boolean
  solarPanelPresent: boolean
  buildingCount: number
  vegetationPct: number | null
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
// AI Feature API — per-building roof detection
// ---------------------------------------------------------------------------

/**
 * Fetch AI-detected roof features for a specific building.
 * Returns roof planes with classified edges, material, and condition.
 */
export async function getNearmapRoofAI(
  lat: number,
  lng: number,
  radiusMeters: number = 30,
): Promise<NearmapAIResult> {
  if (!isConfigured()) {
    return emptyAIResult()
  }

  try {
    const apiKey = getApiKey()

    // Build a small bounding polygon around the point
    const latOffset = radiusMeters / 111_319.5
    const lngOffset = radiusMeters / (111_319.5 * Math.cos(lat * Math.PI / 180))

    // AI Feature API: POST with AOI polygon
    const aoi = {
      type: 'Polygon',
      coordinates: [[
        [lng - lngOffset, lat - latOffset],
        [lng + lngOffset, lat - latOffset],
        [lng + lngOffset, lat + latOffset],
        [lng - lngOffset, lat + latOffset],
        [lng - lngOffset, lat - latOffset],
      ]],
    }

    // Request roof features within the AOI
    const url = `${BASE_URL}/ai/features/v4/buildings.json?apikey=${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aoi,
        packs: ['roof_character', 'roof_condition', 'building_character'],
        since: '2020-01-01',
        limit: 5,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      if (res.status === 404 || res.status === 204) {
        logger.info('Nearmap AI: no building features found', { lat, lng })
        return emptyAIResult()
      }
      const text = await res.text()
      logger.warn(`Nearmap AI Feature API error: ${res.status}`, { body: text.slice(0, 200) })
      return emptyAIResult()
    }

    const data = await res.json() as any
    return parseAIFeatureResponse(data, lat, lng)
  } catch (err: any) {
    logger.warn('Nearmap AI Feature API error', { error: err.message, lat, lng })
    return emptyAIResult()
  }
}

// ---------------------------------------------------------------------------
// AI Rollup API — property-level summary facts
// ---------------------------------------------------------------------------

/**
 * Get AI-detected property summary facts (condition, material, tree overhang, etc.)
 * Simpler than the Feature API — returns aggregate stats, not geometry.
 */
export async function getNearmapRollup(
  lat: number,
  lng: number,
): Promise<NearmapRollupResult> {
  if (!isConfigured()) {
    return emptyRollupResult()
  }

  try {
    const apiKey = getApiKey()

    // Small AOI around the property
    const offset = 0.0003 // ~30m
    const aoi = {
      type: 'Polygon',
      coordinates: [[
        [lng - offset, lat - offset],
        [lng + offset, lat - offset],
        [lng + offset, lat + offset],
        [lng - offset, lat + offset],
        [lng - offset, lat - offset],
      ]],
    }

    const url = `${BASE_URL}/ai/rollup/v1/query.json?apikey=${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aoi,
        packs: ['roof_character', 'roof_condition', 'building_character', 'vegetation', 'solar'],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      logger.info('Nearmap AI Rollup not available', { status: res.status, lat, lng })
      return emptyRollupResult()
    }

    const data = await res.json() as any
    return parseRollupResponse(data)
  } catch (err: any) {
    logger.warn('Nearmap AI Rollup error', { error: err.message, lat, lng })
    return emptyRollupResult()
  }
}

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

function parseAIFeatureResponse(data: any, centerLat: number, centerLng: number): NearmapAIResult {
  const features = data?.features || data?.results || []
  if (features.length === 0) return emptyAIResult()

  // Find the building closest to our target point
  let bestBuilding: any = null
  let bestDist = Infinity

  for (const feature of features) {
    const geom = feature.geometry
    if (!geom) continue

    // Compute distance to center of building
    const centroid = computeCentroid(geom)
    if (!centroid) continue

    const dist = Math.sqrt((centroid.lat - centerLat) ** 2 + (centroid.lng - centerLng) ** 2)
    if (dist < bestDist) {
      bestDist = dist
      bestBuilding = feature
    }
  }

  if (!bestBuilding) return emptyAIResult()

  const props = bestBuilding.properties || {}
  const planes: NearmapRoofPlane[] = []
  const edges: NearmapRoofEdge[] = []

  // Parse roof planes from AI response
  const roofFaces = props.roof_faces || props.roofFaces || bestBuilding.roof_planes || []
  for (const face of roofFaces) {
    const polygon = parseGeoJsonPolygon(face.geometry || face.polygon)
    if (polygon.length < 3) continue

    planes.push({
      polygon,
      areaSqm: face.area_sqm || face.areaSqm || computePolygonAreaSqm(polygon),
      pitchDeg: face.pitch_deg || face.pitchDeg || face.slope || 0,
      azimuthDeg: face.azimuth_deg || face.azimuthDeg || face.aspect || 0,
      material: face.material || face.roof_material || null,
      conditionScore: face.condition_score || face.conditionScore || null,
    })
  }

  // Parse roof edges (ridges, valleys, hips, etc.)
  const roofEdges = props.roof_edges || props.roofEdges || bestBuilding.roof_lines || []
  for (const edge of roofEdges) {
    const lineCoords = parseGeoJsonLine(edge.geometry || edge.line)
    if (lineCoords.length < 2) continue

    const edgeType = mapNearmapEdgeType(edge.type || edge.edge_type || edge.classification || '')

    for (let i = 0; i < lineCoords.length - 1; i++) {
      edges.push({
        type: edgeType,
        start: lineCoords[i],
        end: lineCoords[i + 1],
        lengthMeters: haversineMeters(lineCoords[i].lat, lineCoords[i].lng, lineCoords[i + 1].lat, lineCoords[i + 1].lng),
      })
    }
  }

  // If no edges returned but we have planes, generate edges from plane boundaries
  if (edges.length === 0 && planes.length > 0) {
    for (const plane of planes) {
      for (let i = 0; i < plane.polygon.length; i++) {
        const j = (i + 1) % plane.polygon.length
        edges.push({
          type: 'eave', // Default to eave for perimeter
          start: plane.polygon[i],
          end: plane.polygon[j],
          lengthMeters: haversineMeters(
            plane.polygon[i].lat, plane.polygon[i].lng,
            plane.polygon[j].lat, plane.polygon[j].lng,
          ),
        })
      }
    }
  }

  const totalAreaSqm = planes.reduce((s, p) => s + p.areaSqm, 0)

  return {
    available: true,
    planes,
    edges,
    overallCondition: props.roof_condition_score || props.roofConditionScore || null,
    primaryMaterial: props.roof_material || props.roofMaterial || planes[0]?.material || null,
    treeOverhangPct: props.tree_overhang_pct || props.treeOverhangPct || null,
    totalAreaSqm,
    imageryDate: props.imagery_date || props.imageryDate || null,
  }
}

function parseRollupResponse(data: any): NearmapRollupResult {
  const result = data?.results?.[0] || data?.summary || data || {}
  const roof = result.roof || result.roof_character || {}
  const condition = result.roof_condition || result.condition || {}
  const building = result.building || result.building_character || {}
  const vegetation = result.vegetation || {}
  const solar = result.solar || {}

  return {
    available: true,
    roofAreaSqm: roof.area_sqm || roof.areaSqm || roof.total_area || 0,
    roofCondition: condition.score || condition.condition_score || null,
    roofMaterial: roof.material || roof.primary_material || null,
    treeOverhangPct: vegetation.tree_overhang_pct || vegetation.canopy_pct || null,
    poolPresent: !!(building.pool_present || building.hasPool),
    solarPanelPresent: !!(solar.panel_present || solar.hasPanels),
    buildingCount: building.count || building.building_count || 1,
    vegetationPct: vegetation.coverage_pct || vegetation.vegetationPct || null,
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function parseGeoJsonPolygon(geom: any): Array<{ lat: number; lng: number }> {
  if (!geom) return []
  const coords = geom.coordinates?.[0] || geom || []
  return coords.map((c: any) => {
    if (Array.isArray(c)) return { lat: c[1], lng: c[0] }
    return { lat: c.lat || c.latitude, lng: c.lng || c.longitude }
  }).filter((p: any) => p.lat && p.lng)
}

function parseGeoJsonLine(geom: any): Array<{ lat: number; lng: number }> {
  if (!geom) return []
  const coords = geom.coordinates || geom || []
  return coords.map((c: any) => {
    if (Array.isArray(c)) return { lat: c[1], lng: c[0] }
    return { lat: c.lat || c.latitude, lng: c.lng || c.longitude }
  }).filter((p: any) => p.lat && p.lng)
}

function computeCentroid(geom: any): { lat: number; lng: number } | null {
  const coords = geom?.coordinates?.[0] || geom?.coordinates || []
  if (coords.length === 0) return null

  let sumLat = 0, sumLng = 0
  const points = Array.isArray(coords[0]?.[0]) ? coords[0] : coords
  for (const c of points) {
    if (Array.isArray(c)) { sumLng += c[0]; sumLat += c[1] }
    else { sumLng += c.lng || 0; sumLat += c.lat || 0 }
  }
  return { lat: sumLat / points.length, lng: sumLng / points.length }
}

function computePolygonAreaSqm(vertices: Array<{ lat: number; lng: number }>): number {
  if (vertices.length < 3) return 0
  const cx = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
  const metersPerDeg = 111_319.5
  const cosLat = Math.cos(cx * Math.PI / 180)

  const pts = vertices.map(v => ({
    x: (v.lng - vertices[0].lng) * metersPerDeg * cosLat,
    y: (v.lat - vertices[0].lat) * metersPerDeg,
  }))

  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

function mapNearmapEdgeType(type: string): 'ridge' | 'valley' | 'hip' | 'rake' | 'eave' {
  const t = type.toLowerCase()
  if (t.includes('ridge')) return 'ridge'
  if (t.includes('valley')) return 'valley'
  if (t.includes('hip')) return 'hip'
  if (t.includes('rake')) return 'rake'
  if (t.includes('eave') || t.includes('gutter') || t.includes('fascia')) return 'eave'
  if (t.includes('edge') || t.includes('perimeter')) return 'eave'
  return 'eave'
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------------------
// Empty results
// ---------------------------------------------------------------------------

function emptyAIResult(): NearmapAIResult {
  return {
    available: false, planes: [], edges: [],
    overallCondition: null, primaryMaterial: null, treeOverhangPct: null,
    totalAreaSqm: 0, imageryDate: null,
  }
}

function emptyRollupResult(): NearmapRollupResult {
  return {
    available: false, roofAreaSqm: 0, roofCondition: null, roofMaterial: null,
    treeOverhangPct: null, poolPresent: false, solarPanelPresent: false,
    buildingCount: 0, vegetationPct: null,
  }
}
