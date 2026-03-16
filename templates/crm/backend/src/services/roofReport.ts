// Roof Report Computation Service
// Takes Google Solar API data and computes a full roof measurement report
// with segment polygons, classified edges, and material measurements.

import type { BuildingInsightsResponse } from './googleSolar'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number
  lng: number
}

export interface Polygon {
  vertices: LatLng[]
}

export interface ReportSegment {
  index: number
  name: string
  area: number           // sqft
  pitch: string          // "6/12"
  pitchDegrees: number
  azimuthDegrees: number
  polygon: Polygon       // 4-vertex oriented polygon from bounding box
}

export interface ClassifiedEdge {
  type: 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'
  start: LatLng
  end: LatLng
  lengthFt: number
  segmentA?: number      // index of segment A (undefined for perimeter edges)
  segmentB?: number      // index of segment B (undefined for perimeter edges)
}

export interface ReportMeasurements {
  totalRidgeLF: number
  totalValleyLF: number
  totalHipLF: number
  totalRakeLF: number
  totalEaveLF: number
  totalPerimeterLF: number
  wasteFactorPct: number
  iceWaterShieldSqft: number
  suggestedSquaresWithWaste: number
}

export interface RoofReportData {
  segments: ReportSegment[]
  edges: ClassifiedEdge[]
  measurements: ReportMeasurements
  center: LatLng
  totalAreaSqft: number
  totalSquares: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EARTH_RADIUS_FT = 20_902_231 // mean Earth radius in feet
const SQM_TO_SQFT = 10.7639
const ADJACENCY_TOLERANCE = 0.00002 // ~2 meters in degrees
const ICE_WATER_SHIELD_VALLEY_WIDTH_FT = 3 // 3 ft each side of valley
const LOW_PITCH_THRESHOLD_DEGREES = 18.4 // roughly 4/12

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance between two lat/lng points, returned in feet.
 */
function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_FT * c
}

/**
 * Convert pitch degrees to rise/run notation (e.g. "6/12").
 */
function pitchToRiseRun(degrees: number): string {
  const rise = Math.round(Math.tan(toRadians(degrees)) * 12)
  return `${rise}/12`
}

/**
 * Convert square meters to square feet.
 */
function sqmToSqft(m2: number): number {
  return m2 * SQM_TO_SQFT
}

/**
 * Normalize an angle to 0-360 range.
 */
function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * Compute the absolute angular difference between two azimuths (0-180).
 */
function azimuthDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b))
  return diff > 180 ? 360 - diff : diff
}

// ---------------------------------------------------------------------------
// Bounding box → Polygon
// ---------------------------------------------------------------------------

interface BBox {
  sw: { latitude: number; longitude: number }
  ne: { latitude: number; longitude: number }
}

/**
 * Convert an axis-aligned bounding box to a 4-vertex polygon.
 * Vertices are ordered: SW, SE, NE, NW (counter-clockwise from bottom-left).
 */
function boundingBoxToPolygon(bbox: BBox): Polygon {
  const sw: LatLng = { lat: bbox.sw.latitude, lng: bbox.sw.longitude }
  const se: LatLng = { lat: bbox.sw.latitude, lng: bbox.ne.longitude }
  const ne: LatLng = { lat: bbox.ne.latitude, lng: bbox.ne.longitude }
  const nw: LatLng = { lat: bbox.ne.latitude, lng: bbox.sw.longitude }
  return { vertices: [sw, se, ne, nw] }
}

/**
 * Create an azimuth-rotated polygon for visual display.
 *
 * The Solar API gives axis-aligned bounding boxes, but real roof segments
 * are oriented along the ridge/slope direction. By rotating the rectangle
 * around its center to align with the azimuth, the overlay looks much
 * closer to the actual roof shape on satellite imagery.
 *
 * azimuthDeg = direction the segment faces (downhill). The ridge runs
 * perpendicular to this, so we rotate the long axis of the rectangle
 * to be perpendicular to azimuth.
 */
function boundingBoxToRotatedPolygon(bbox: BBox, azimuthDeg: number, pitchDeg: number): Polygon {
  const centerLat = (bbox.sw.latitude + bbox.ne.latitude) / 2
  const centerLng = (bbox.sw.longitude + bbox.ne.longitude) / 2

  // Half-widths of the bounding box in degrees
  const halfLat = (bbox.ne.latitude - bbox.sw.latitude) / 2
  const halfLng = (bbox.ne.longitude - bbox.sw.longitude) / 2

  // The azimuth points downhill. The ridge (long axis of the segment) runs
  // perpendicular to the azimuth. We rotate so the rectangle's long side
  // aligns with the ridge direction.
  // Rotation angle: azimuth is 0=N, 90=E. We want the rectangle's width
  // to align perpendicular to azimuth (along the ridge).
  const angle = toRadians(azimuthDeg)

  // Correct for longitude compression at this latitude
  const cosLat = Math.cos(toRadians(centerLat))

  // Unrotated corners (relative to center, in "equalized" space)
  const corners = [
    { dlat: -halfLat, dlng: -halfLng },  // SW
    { dlat: -halfLat, dlng: halfLng },   // SE
    { dlat: halfLat, dlng: halfLng },    // NE
    { dlat: halfLat, dlng: -halfLng },   // NW
  ]

  // Rotate each corner around center
  const vertices: LatLng[] = corners.map(({ dlat, dlng }) => {
    // Normalize lng to comparable scale
    const dx = dlng * cosLat
    const dy = dlat

    // Rotate
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle)
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle)

    // Convert back
    return {
      lat: centerLat + ry,
      lng: centerLng + rx / cosLat,
    }
  })

  return { vertices }
}

// ---------------------------------------------------------------------------
// Shared-edge detection
// ---------------------------------------------------------------------------

interface OverlapRange {
  /** The axis along which the overlap occurs: 'lat' or 'lng' */
  axis: 'lat' | 'lng'
  /** Fixed coordinate on the perpendicular axis where the two boxes meet */
  fixedValue: number
  /** Start of overlap range on the parallel axis */
  rangeStart: number
  /** End of overlap range on the parallel axis */
  rangeEnd: number
}

/**
 * Determine if two axis-aligned bounding boxes share an edge (are adjacent).
 * Returns the overlap description or null if they don't share an edge.
 */
function findBBoxOverlap(
  a: { swLat: number; swLng: number; neLat: number; neLng: number },
  b: { swLat: number; swLng: number; neLat: number; neLng: number },
): OverlapRange | null {
  // Check if box A's east side meets box B's west side (or vice versa)
  // along longitude axis
  const eastWestAdjacentAB = Math.abs(a.neLng - b.swLng) < ADJACENCY_TOLERANCE
  const eastWestAdjacentBA = Math.abs(b.neLng - a.swLng) < ADJACENCY_TOLERANCE
  // Check if box A's north side meets box B's south side (or vice versa)
  const northSouthAdjacentAB = Math.abs(a.neLat - b.swLat) < ADJACENCY_TOLERANCE
  const northSouthAdjacentBA = Math.abs(b.neLat - a.swLat) < ADJACENCY_TOLERANCE

  // Also check for actual overlap (one box partially inside the other)
  const lngOverlap = a.swLng < b.neLng + ADJACENCY_TOLERANCE && b.swLng < a.neLng + ADJACENCY_TOLERANCE
  const latOverlap = a.swLat < b.neLat + ADJACENCY_TOLERANCE && b.swLat < a.neLat + ADJACENCY_TOLERANCE

  if ((eastWestAdjacentAB || eastWestAdjacentBA) && latOverlap) {
    // Shared edge runs along latitude (vertical edge)
    const fixedLng = eastWestAdjacentAB
      ? (a.neLng + b.swLng) / 2
      : (b.neLng + a.swLng) / 2
    const rangeStart = Math.max(a.swLat, b.swLat)
    const rangeEnd = Math.min(a.neLat, b.neLat)
    if (rangeEnd - rangeStart < ADJACENCY_TOLERANCE) return null
    return { axis: 'lat', fixedValue: fixedLng, rangeStart, rangeEnd }
  }

  if ((northSouthAdjacentAB || northSouthAdjacentBA) && lngOverlap) {
    // Shared edge runs along longitude (horizontal edge)
    const fixedLat = northSouthAdjacentAB
      ? (a.neLat + b.swLat) / 2
      : (b.neLat + a.swLat) / 2
    const rangeStart = Math.max(a.swLng, b.swLng)
    const rangeEnd = Math.min(a.neLng, b.neLng)
    if (rangeEnd - rangeStart < ADJACENCY_TOLERANCE) return null
    return { axis: 'lng', fixedValue: fixedLat, rangeStart, rangeEnd }
  }

  return null
}

/**
 * Convert an OverlapRange into start/end LatLng points.
 */
function overlapToEdge(overlap: OverlapRange): { start: LatLng; end: LatLng } {
  if (overlap.axis === 'lat') {
    // Edge runs vertically (constant lng, varying lat)
    return {
      start: { lat: overlap.rangeStart, lng: overlap.fixedValue },
      end: { lat: overlap.rangeEnd, lng: overlap.fixedValue },
    }
  }
  // Edge runs horizontally (constant lat, varying lng)
  return {
    start: { lat: overlap.fixedValue, lng: overlap.rangeStart },
    end: { lat: overlap.fixedValue, lng: overlap.rangeEnd },
  }
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

/**
 * Classify a shared edge between two segments based on their azimuth difference.
 */
function classifySharedEdge(azimuthA: number, azimuthB: number): 'ridge' | 'valley' | 'hip' {
  const diff = azimuthDifference(azimuthA, azimuthB)
  if (diff > 150) return 'ridge'
  if (diff < 30) return 'valley'
  return 'hip'
}

/**
 * Determine which polygon edges are perimeter edges (not shared with another segment).
 * Classify each as 'rake' or 'eave' based on the segment's azimuth.
 *
 * The azimuth indicates the direction the segment faces (downhill direction).
 * - The "bottom" edge (perpendicular to slope, at the low side) is the EAVE.
 * - Side edges running roughly parallel to slope direction are RAKES.
 * - The "top" edge (perpendicular to slope, at the high side) could be a ridge
 *   but if it's a perimeter edge, we treat it as an eave (exposed edge).
 */
function classifyPerimeterEdge(
  edgeStart: LatLng,
  edgeEnd: LatLng,
  azimuthDeg: number,
): 'rake' | 'eave' {
  // Compute bearing of the edge
  const dLng = edgeEnd.lng - edgeStart.lng
  const dLat = edgeEnd.lat - edgeStart.lat
  const edgeBearing = normalizeAngle(
    (Math.atan2(dLng * Math.cos(toRadians((edgeStart.lat + edgeEnd.lat) / 2)), dLat) * 180) / Math.PI,
  )

  // The azimuth is the downhill direction. Eaves run perpendicular to azimuth;
  // rakes run parallel to azimuth.
  const diff = azimuthDifference(edgeBearing, azimuthDeg)

  // If the edge bearing is roughly parallel to the azimuth (±30°) or anti-parallel,
  // the edge runs along the slope → RAKE
  // If roughly perpendicular (60-120°), the edge runs across the slope → EAVE
  if (diff < 30 || diff > 150) {
    return 'rake'
  }
  return 'eave'
}

// ---------------------------------------------------------------------------
// Check if a polygon edge is "consumed" by a shared edge
// ---------------------------------------------------------------------------

/**
 * Check if a polygon edge segment is approximately covered by any shared edge.
 * We check if both endpoints of the polygon edge are close to the shared edge line.
 */
function isEdgeCoveredByShared(
  polyStart: LatLng,
  polyEnd: LatLng,
  sharedEdges: Array<{ start: LatLng; end: LatLng }>,
  tolerance: number,
): boolean {
  for (const shared of sharedEdges) {
    // Check if the polygon edge overlaps with the shared edge
    // by verifying proximity of midpoints and endpoints
    const polyMid: LatLng = {
      lat: (polyStart.lat + polyEnd.lat) / 2,
      lng: (polyStart.lng + polyEnd.lng) / 2,
    }
    const sharedMid: LatLng = {
      lat: (shared.start.lat + shared.end.lat) / 2,
      lng: (shared.start.lng + shared.end.lng) / 2,
    }

    // Check if midpoints are close and edges are roughly collinear
    const midDist = Math.sqrt(
      (polyMid.lat - sharedMid.lat) ** 2 + (polyMid.lng - sharedMid.lng) ** 2,
    )
    if (midDist < tolerance * 10) {
      // Check if at least one coordinate axis is nearly the same
      // (edges share a constant lat or lng line)
      const latDiffStart = Math.abs(polyStart.lat - shared.start.lat)
      const lngDiffStart = Math.abs(polyStart.lng - shared.start.lng)
      const latDiffEnd = Math.abs(polyEnd.lat - shared.end.lat)
      const lngDiffEnd = Math.abs(polyEnd.lng - shared.end.lng)

      const isHorizontalMatch =
        Math.abs(polyStart.lat - polyEnd.lat) < tolerance &&
        Math.abs(shared.start.lat - shared.end.lat) < tolerance &&
        Math.abs(polyStart.lat - shared.start.lat) < tolerance

      const isVerticalMatch =
        Math.abs(polyStart.lng - polyEnd.lng) < tolerance &&
        Math.abs(shared.start.lng - shared.end.lng) < tolerance &&
        Math.abs(polyStart.lng - shared.start.lng) < tolerance

      if (isHorizontalMatch || isVerticalMatch) {
        return true
      }

      // Fallback: if all endpoints are very close, consider it covered
      if (
        latDiffStart < tolerance && lngDiffStart < tolerance &&
        latDiffEnd < tolerance && lngDiffEnd < tolerance
      ) {
        return true
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Waste factor & ice-water shield
// ---------------------------------------------------------------------------

/**
 * Compute waste factor percentage.
 * Base 10% + 2% per valley/hip, capped at 25%.
 * Add 1% per 2/12 pitch above 6/12.
 */
function computeWasteFactor(
  numValleys: number,
  numHips: number,
  maxPitchDegrees: number,
): number {
  let waste = 10

  // Add 2% per valley or hip
  waste += (numValleys + numHips) * 2

  // Cap complexity-based waste at 25%
  waste = Math.min(waste, 25)

  // Add pitch penalty: 1% per 2/12 above 6/12
  // 6/12 = 26.57 degrees; each 2/12 step is ~9.46 degrees
  const pitchOf6_12 = Math.atan(6 / 12) * (180 / Math.PI) // ~26.57°
  const pitchOf2_12 = Math.atan(2 / 12) * (180 / Math.PI) // ~9.46°
  if (maxPitchDegrees > pitchOf6_12) {
    const stepsAbove = Math.floor((maxPitchDegrees - pitchOf6_12) / pitchOf2_12)
    waste += stepsAbove
  }

  return waste
}

/**
 * Compute ice-and-water shield coverage in sqft.
 * - Valley areas: 3 ft each side × valley length = 6 ft width × length
 * - Full area of any segment with pitch below 4/12 (~18.4°)
 */
function computeIceWaterShield(
  edges: ClassifiedEdge[],
  segments: ReportSegment[],
): number {
  let sqft = 0

  // Valley areas: 6 ft total width along each valley
  for (const edge of edges) {
    if (edge.type === 'valley') {
      sqft += ICE_WATER_SHIELD_VALLEY_WIDTH_FT * 2 * edge.lengthFt
    }
  }

  // Full area of low-pitch segments
  for (const seg of segments) {
    if (seg.pitchDegrees < LOW_PITCH_THRESHOLD_DEGREES) {
      sqft += seg.area
    }
  }

  return Math.round(sqft)
}

// ---------------------------------------------------------------------------
// Main report generation
// ---------------------------------------------------------------------------

/**
 * Generate a full roof measurement report from Google Solar API building insights.
 *
 * @param insights - Raw BuildingInsightsResponse from the Google Solar API
 * @returns RoofReportData with segments, classified edges, and measurements
 */
/**
 * Expand a polygon outward from its centroid by a given distance in feet.
 * Each vertex is pushed away from the centroid along the line from centroid → vertex.
 */
function expandPolygon(polygon: Polygon, expandFt: number, centerLat: number): Polygon {
  if (polygon.vertices.length < 3 || expandFt <= 0) return polygon

  // Compute centroid
  const cx = polygon.vertices.reduce((s, v) => s + v.lat, 0) / polygon.vertices.length
  const cy = polygon.vertices.reduce((s, v) => s + v.lng, 0) / polygon.vertices.length

  // Degrees per foot at this latitude
  const latDegPerFt = 1 / (EARTH_RADIUS_FT * (Math.PI / 180))
  const lngDegPerFt = latDegPerFt / Math.cos(toRadians(centerLat))

  const vertices = polygon.vertices.map(v => {
    const dLat = v.lat - cx
    const dLng = v.lng - cy

    // Distance from centroid in feet (approximate)
    const distFt = Math.sqrt((dLat / latDegPerFt) ** 2 + (dLng / lngDegPerFt) ** 2)
    if (distFt < 0.01) return v // skip degenerate

    // Expand by moving vertex further from centroid
    const scale = (distFt + expandFt) / distFt
    return {
      lat: cx + dLat * scale,
      lng: cy + dLng * scale,
    }
  })

  return { vertices }
}

/**
 * Compute polygon area in square feet using the Shoelace formula on lat/lng.
 */
function polygonAreaSqft(polygon: Polygon, centerLat: number): number {
  const verts = polygon.vertices
  if (verts.length < 3) return 0

  const latFtPerDeg = EARTH_RADIUS_FT * (Math.PI / 180)
  const lngFtPerDeg = latFtPerDeg * Math.cos(toRadians(centerLat))

  // Convert to feet-based coordinates
  const pts = verts.map(v => ({
    x: v.lng * lngFtPerDeg,
    y: v.lat * latFtPerDeg,
  }))

  // Shoelace formula
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y
    area -= pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

export function generateRoofReport(insights: BuildingInsightsResponse, eaveOverhangInches = 12): RoofReportData {
  const rawSegments = insights.solarPotential?.roofSegmentStats
  if (!rawSegments || rawSegments.length === 0) {
    return emptyReport(insights)
  }

  // -------------------------------------------------------------------------
  // 1. Build report segments with polygons
  // -------------------------------------------------------------------------
  // Build axis-aligned polygons (for edge detection) and rotated polygons (for visual display)
  const axisAlignedPolygons: Polygon[] = rawSegments.map(seg =>
    seg.boundingBox ? boundingBoxToPolygon(seg.boundingBox) : { vertices: [] }
  )

  const segments: ReportSegment[] = rawSegments.map((seg, i) => {
    const areaSqft = Math.round(sqmToSqft(seg.stats.areaMeters2))
    // Rotated polygon aligns with the actual roof slope for better visual display
    const polygon = seg.boundingBox
      ? boundingBoxToRotatedPolygon(seg.boundingBox, seg.azimuthDegrees, seg.pitchDegrees)
      : { vertices: [] }

    return {
      index: i,
      name: `Segment ${i + 1}`,
      area: areaSqft,
      pitch: pitchToRiseRun(seg.pitchDegrees),
      pitchDegrees: Math.round(seg.pitchDegrees * 10) / 10,
      azimuthDegrees: Math.round(seg.azimuthDegrees),
      polygon,
    }
  })

  // -------------------------------------------------------------------------
  // 1b. Expand polygons outward by eave overhang and recalculate areas
  // -------------------------------------------------------------------------
  const buildingCenter: LatLng = {
    lat: insights.center.latitude,
    lng: insights.center.longitude,
  }
  const overhangFt = eaveOverhangInches / 12

  if (overhangFt > 0) {
    for (const seg of segments) {
      const originalPoly = seg.polygon
      const expandedPoly = expandPolygon(originalPoly, overhangFt, buildingCenter.lat)
      const expandedArea = Math.round(polygonAreaSqft(expandedPoly, buildingCenter.lat))

      // Use expanded area if reasonable (within 30% of original — prevents bad expansions on tiny segments)
      if (expandedArea > 0 && expandedArea < seg.area * 1.3) {
        seg.area = expandedArea
      }

      seg.polygon = expandedPoly
    }
  }

  // -------------------------------------------------------------------------
  // 2. Find shared edges between all segment pairs
  // -------------------------------------------------------------------------
  const edges: ClassifiedEdge[] = []
  // Track shared edges per segment for perimeter detection
  const sharedEdgesPerSegment: Map<number, Array<{ start: LatLng; end: LatLng }>> = new Map()

  for (let i = 0; i < segments.length; i++) {
    sharedEdgesPerSegment.set(i, [])
  }

  for (let i = 0; i < rawSegments.length; i++) {
    for (let j = i + 1; j < rawSegments.length; j++) {
      const bboxA = rawSegments[i].boundingBox
      const bboxB = rawSegments[j].boundingBox
      if (!bboxA || !bboxB) continue

      const a = {
        swLat: bboxA.sw.latitude,
        swLng: bboxA.sw.longitude,
        neLat: bboxA.ne.latitude,
        neLng: bboxA.ne.longitude,
      }
      const b = {
        swLat: bboxB.sw.latitude,
        swLng: bboxB.sw.longitude,
        neLat: bboxB.ne.latitude,
        neLng: bboxB.ne.longitude,
      }

      const overlap = findBBoxOverlap(a, b)
      if (!overlap) continue

      const { start, end } = overlapToEdge(overlap)
      const lengthFt = haversineDistance(start, end)

      // Skip very short edges (likely noise)
      if (lengthFt < 1) continue

      const type = classifySharedEdge(
        rawSegments[i].azimuthDegrees,
        rawSegments[j].azimuthDegrees,
      )

      edges.push({
        type,
        start,
        end,
        lengthFt: Math.round(lengthFt * 10) / 10,
        segmentA: i,
        segmentB: j,
      })

      sharedEdgesPerSegment.get(i)!.push({ start, end })
      sharedEdgesPerSegment.get(j)!.push({ start, end })
    }
  }

  // -------------------------------------------------------------------------
  // 3. Find perimeter edges (polygon edges not shared with another segment)
  // Uses axis-aligned polygons for accurate shared-edge matching,
  // then maps results to rotated polygon edges for visual display.
  // -------------------------------------------------------------------------
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const axisVerts = axisAlignedPolygons[i].vertices
    const rotatedVerts = seg.polygon.vertices
    if (axisVerts.length < 4) continue

    const sharedForSeg = sharedEdgesPerSegment.get(i) || []

    for (let v = 0; v < axisVerts.length; v++) {
      const edgeStart = axisVerts[v]
      const edgeEnd = axisVerts[(v + 1) % axisVerts.length]

      // Check if this polygon edge is covered by any shared edge
      if (isEdgeCoveredByShared(edgeStart, edgeEnd, sharedForSeg, ADJACENCY_TOLERANCE)) {
        continue
      }

      const lengthFt = haversineDistance(edgeStart, edgeEnd)
      if (lengthFt < 0.5) continue

      const type = classifyPerimeterEdge(edgeStart, edgeEnd, seg.azimuthDegrees)

      // Use rotated polygon vertices for the visual edge display
      const displayStart = rotatedVerts.length > v ? rotatedVerts[v] : edgeStart
      const displayEnd = rotatedVerts.length > v ? rotatedVerts[(v + 1) % rotatedVerts.length] : edgeEnd

      edges.push({
        type,
        start: displayStart,
        end: displayEnd,
        lengthFt: Math.round(lengthFt * 10) / 10,
        segmentA: i,
        segmentB: undefined,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 4. Compute measurements
  // -------------------------------------------------------------------------
  const totalAreaSqft = segments.reduce((sum, s) => sum + s.area, 0)
  const totalSquares = Math.round((totalAreaSqft / 100) * 100) / 100

  const ridgeEdges = edges.filter((e) => e.type === 'ridge')
  const valleyEdges = edges.filter((e) => e.type === 'valley')
  const hipEdges = edges.filter((e) => e.type === 'hip')
  const rakeEdges = edges.filter((e) => e.type === 'rake')
  const eaveEdges = edges.filter((e) => e.type === 'eave')

  const sumLF = (arr: ClassifiedEdge[]) =>
    Math.round(arr.reduce((s, e) => s + e.lengthFt, 0) * 10) / 10

  const totalRidgeLF = sumLF(ridgeEdges)
  const totalValleyLF = sumLF(valleyEdges)
  const totalHipLF = sumLF(hipEdges)
  const totalRakeLF = sumLF(rakeEdges)
  const totalEaveLF = sumLF(eaveEdges)
  const totalPerimeterLF = Math.round((totalRakeLF + totalEaveLF) * 10) / 10

  const maxPitch = segments.reduce((max, s) => Math.max(max, s.pitchDegrees), 0)
  const wasteFactorPct = computeWasteFactor(valleyEdges.length, hipEdges.length, maxPitch)

  const iceWaterShieldSqft = computeIceWaterShield(edges, segments)

  const suggestedSquaresWithWaste =
    Math.round(totalSquares * (1 + wasteFactorPct / 100) * 100) / 100

  const measurements: ReportMeasurements = {
    totalRidgeLF,
    totalValleyLF,
    totalHipLF,
    totalRakeLF,
    totalEaveLF,
    totalPerimeterLF,
    wasteFactorPct,
    iceWaterShieldSqft,
    suggestedSquaresWithWaste,
  }

  const center: LatLng = {
    lat: insights.center.latitude,
    lng: insights.center.longitude,
  }

  return {
    segments,
    edges,
    measurements,
    center,
    totalAreaSqft,
    totalSquares,
  }
}

// ---------------------------------------------------------------------------
// Empty report fallback
// ---------------------------------------------------------------------------

function emptyReport(insights: BuildingInsightsResponse): RoofReportData {
  return {
    segments: [],
    edges: [],
    measurements: {
      totalRidgeLF: 0,
      totalValleyLF: 0,
      totalHipLF: 0,
      totalRakeLF: 0,
      totalEaveLF: 0,
      totalPerimeterLF: 0,
      wasteFactorPct: 10,
      iceWaterShieldSqft: 0,
      suggestedSquaresWithWaste: 0,
    },
    center: {
      lat: insights.center?.latitude ?? 0,
      lng: insights.center?.longitude ?? 0,
    },
    totalAreaSqft: 0,
    totalSquares: 0,
  }
}
