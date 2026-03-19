// Roof Report Computation Service
// Takes Google Solar API data and computes a full roof measurement report
// using 3D plane intersection geometry for accurate polygon shapes.
//
// Algorithm: Each roof segment defines a 3D plane from its pitch, azimuth,
// and height. The building footprint (convex hull of all bounding boxes) is
// partitioned by "highest plane wins" — each point on the footprint belongs
// to whichever segment's plane is highest there. Plane-plane intersection
// lines become ridges, hips, and valleys. Footprint edges become eaves/rakes.

import type { BuildingInsightsResponse } from './googleSolar'
// DsmResult type inlined to avoid hard dependency on dsmProcessor module
interface DsmPlane {
  a: number
  b: number
  c0: number
  pitchDeg: number
  azimuthDeg: number
  inlierCount: number
  groundAreaSqm: number
}
interface DsmResult {
  footprint: Array<{ x: number; y: number }>
  planes: DsmPlane[]
  segmentPolygons: Array<Array<{ x: number; y: number }>>
}

// ---------------------------------------------------------------------------
// Exported types
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
  area: number           // sqft (slope area from Solar API)
  pitch: string          // "6/12"
  pitchDegrees: number
  azimuthDegrees: number
  polygon: Polygon       // actual roof facet shape (trapezoid, triangle, etc.)
}

export interface ClassifiedEdge {
  type: 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'
  start: LatLng
  end: LatLng
  lengthFt: number
  segmentA?: number      // index of segment A
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

const EARTH_RADIUS_FT = 20_902_231
const METERS_PER_DEGREE_LAT = 111_319.5
const SQM_TO_SQFT = 10.7639
const M_TO_FT = 3.28084
const ICE_WATER_SHIELD_VALLEY_WIDTH_FT = 3
const LOW_PITCH_THRESHOLD_DEGREES = 18.4 // ~4/12

// ---------------------------------------------------------------------------
// Internal 2D point type (local meters coordinates)
// ---------------------------------------------------------------------------

interface Pt {
  x: number // East, meters
  y: number // North, meters
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI
}

function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng
  return EARTH_RADIUS_FT * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function pitchToRiseRun(degrees: number): string {
  return `${Math.round(Math.tan(toRadians(degrees)) * 12)}/12`
}

function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function azimuthDifference(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b))
  return diff > 180 ? 360 - diff : diff
}

function dist2D(a: Pt, b: Pt): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

// ---------------------------------------------------------------------------
// Coordinate conversion (lat/lng ↔ local meters with origin at building center)
// ---------------------------------------------------------------------------

function latLngToLocal(lat: number, lng: number, originLat: number, originLng: number): Pt {
  return {
    x: (lng - originLng) * METERS_PER_DEGREE_LAT * Math.cos(toRadians(originLat)),
    y: (lat - originLat) * METERS_PER_DEGREE_LAT,
  }
}

function localToLatLng(p: Pt, originLat: number, originLng: number): LatLng {
  return {
    lat: originLat + p.y / METERS_PER_DEGREE_LAT,
    lng: originLng + p.x / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(originLat))),
  }
}

// ---------------------------------------------------------------------------
// 2D computational geometry
// ---------------------------------------------------------------------------

/** Cross product of vectors OA and OB. Positive if CCW. */
function cross2D(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** Convex hull via Andrew's monotone chain. Returns CCW-ordered vertices. */
function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  // Remove duplicates
  const unique: Pt[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (dist2D(sorted[i], sorted[i - 1]) > 0.01) unique.push(sorted[i])
  }
  if (unique.length < 3) return unique

  const lower: Pt[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Signed polygon area via shoelace. Positive for CCW winding. */
function polygonAreaSigned(pts: Pt[]): number {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

/**
 * Sutherland–Hodgman polygon clipping by half-plane A*x + B*y >= C.
 * Returns the clipped polygon vertices, or [] if fully clipped away.
 */
function clipPolygonByHalfPlane(poly: Pt[], A: number, B: number, C: number): Pt[] {
  if (poly.length === 0) return []
  const EPS = 1e-9
  const out: Pt[] = []

  function val(p: Pt): number { return A * p.x + B * p.y - C }
  function inside(p: Pt): boolean { return val(p) >= -EPS }
  function intersect(p1: Pt, p2: Pt): Pt {
    const d1 = val(p1)
    const d2 = val(p2)
    const t = d1 / (d1 - d2)
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
  }

  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]
    const next = poly[(i + 1) % poly.length]
    const curIn = inside(cur)
    const nextIn = inside(next)

    if (curIn) {
      out.push(cur)
      if (!nextIn) out.push(intersect(cur, next))
    } else if (nextIn) {
      out.push(intersect(cur, next))
    }
  }
  return out
}

/**
 * Check if two segment polygons are geometrically adjacent (have vertices
 * close to each other).  Non-adjacent segments (e.g. N and S triangles on a
 * hip roof) should NOT produce an internal edge even though their plane
 * intersection line crosses the footprint.
 */
function areSegmentsAdjacent(polyA: Pt[], polyB: Pt[], threshold = 3): boolean {
  for (const a of polyA) {
    for (const b of polyB) {
      if (dist2D(a, b) < threshold) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Trim internal edges at mutual crossings
// ---------------------------------------------------------------------------

/**
 * Trim overlapping internal edges so they meet at junction points instead
 * of spanning the full footprint.
 *
 * On a hip roof, the ridge (W-E intersection) spans the full N-S extent
 * of the footprint, but should stop at the two hip junctions.  Each hip
 * similarly extends past the ridge.
 *
 * Algorithm:
 * 1. Convert all edges to local coordinates
 * 2. For each pair of edges, find where they cross
 * 3. For each edge, collect all crossing points along it
 * 4. Trim the edge to the segment between its two outermost crossings
 *    (or between a crossing and the nearest footprint intersection)
 *
 * In practice, for a standard hip roof this trims the ridge from
 * full-footprint-span down to just the section between the two hip junctions.
 */
function trimEdgesAtCrossings(
  edges: ClassifiedEdge[],
  originLat: number,
  originLng: number,
  segmentPolygons: Pt[][] = [],
): void {
  if (edges.length < 2) return

  // Convert to local coords for intersection math
  const locals = edges.map(e => ({
    p1: latLngToLocal(e.start.lat, e.start.lng, originLat, originLng),
    p2: latLngToLocal(e.end.lat, e.end.lng, originLat, originLng),
  }))

  // For each edge, collect t-parameters where other edges cross it
  const crossings: number[][] = edges.map(() => [])

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const hit = segmentSegmentIntersect(
        locals[i].p1, locals[i].p2,
        locals[j].p1, locals[j].p2,
      )
      if (hit) {
        crossings[i].push(hit.tA)
        crossings[j].push(hit.tB)
      }
    }
  }

  // Trim each edge that has crossings.
  // - Ridge with 2 crossings: trim to span between crossings only
  // - Hip with 1 crossing: keep from crossing to footprint boundary (DON'T trim)
  for (let i = 0; i < edges.length; i++) {
    const pts = crossings[i]
    if (pts.length < 2) continue // Only trim edges with 2+ crossings (ridges)

    pts.sort((a, b) => a - b)

    const e = edges[i]
    const lp = locals[i]
    const tMin = Math.max(0, pts[0])
    const tMax = Math.min(1, pts[pts.length - 1])
    if (tMax - tMin < 0.05) continue

    const newP1: Pt = {
      x: lp.p1.x + tMin * (lp.p2.x - lp.p1.x),
      y: lp.p1.y + tMin * (lp.p2.y - lp.p1.y),
    }
    const newP2: Pt = {
      x: lp.p1.x + tMax * (lp.p2.x - lp.p1.x),
      y: lp.p1.y + tMax * (lp.p2.y - lp.p1.y),
    }

    e.start = localToLatLng(newP1, originLat, originLng)
    e.end = localToLatLng(newP2, originLat, originLng)
    e.lengthFt = Math.round(dist2D(newP1, newP2) * M_TO_FT * 10) / 10
  }

  // For hips with 1 crossing (meets the ridge), trim the spurious end
  // that extends past the ridge onto the wrong side.
  for (let i = 0; i < edges.length; i++) {
    if (crossings[i].length !== 1) continue
    const e = edges[i]
    if (e.type !== 'hip') continue

    const t = crossings[i][0]
    const lp = locals[i]

    // Two candidate segments: [0, t] and [t, 1]
    // The real hip is the one whose midpoint is in the region of both
    // bordering segments. Use segment polygon centroids as proxy.
    const segA = e.segmentA ?? 0
    const segB = e.segmentB ?? 0
    const cA = polygonCentroid(segmentPolygons[segA])
    const cB = polygonCentroid(segmentPolygons[segB])

    const midLow: Pt = { x: lp.p1.x + (t / 2) * (lp.p2.x - lp.p1.x), y: lp.p1.y + (t / 2) * (lp.p2.y - lp.p1.y) }
    const midHigh: Pt = { x: lp.p1.x + ((t + 1) / 2) * (lp.p2.x - lp.p1.x), y: lp.p1.y + ((t + 1) / 2) * (lp.p2.y - lp.p1.y) }

    // Score: sum of distances to both segment centroids (lower = better)
    const scoreLow = dist2D(midLow, cA) + dist2D(midLow, cB)
    const scoreHigh = dist2D(midHigh, cA) + dist2D(midHigh, cB)

    let tMin: number, tMax: number
    if (scoreLow < scoreHigh) {
      tMin = 0; tMax = t
    } else {
      tMin = t; tMax = 1
    }

    if (tMax - tMin < 0.05) continue

    const newP1: Pt = {
      x: lp.p1.x + tMin * (lp.p2.x - lp.p1.x),
      y: lp.p1.y + tMin * (lp.p2.y - lp.p1.y),
    }
    const newP2: Pt = {
      x: lp.p1.x + tMax * (lp.p2.x - lp.p1.x),
      y: lp.p1.y + tMax * (lp.p2.y - lp.p1.y),
    }

    e.start = localToLatLng(newP1, originLat, originLng)
    e.end = localToLatLng(newP2, originLat, originLng)
    e.lengthFt = Math.round(dist2D(newP1, newP2) * M_TO_FT * 10) / 10
  }
}

/** Find where two line segments cross. Returns t-parameters on each segment, or null. */
function segmentSegmentIntersect(
  a1: Pt, a2: Pt, b1: Pt, b2: Pt,
): { tA: number; tB: number; point: Pt } | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-10) return null // parallel

  const tA = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom
  const tB = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom

  // Must be within both segments (with small margin)
  if (tA < 0.01 || tA > 0.99 || tB < 0.01 || tB > 0.99) return null

  return {
    tA, tB,
    point: { x: a1.x + tA * dx1, y: a1.y + tA * dy1 },
  }
}

// ---------------------------------------------------------------------------
// Footprint-based valley detection
// ---------------------------------------------------------------------------

/**
 * Detect valleys from concave vertices in the footprint polygon.
 *
 * On a hip roof with an L/T-shaped footprint, valleys form at concave corners
 * where two wings of the building meet.  The valley line runs inward from the
 * concave vertex along the angle bisector until it hits the opposite footprint
 * edge or an existing internal edge (ridge/hip).
 *
 * This is deterministic and doesn't depend on RANSAC plane separation.
 */
function detectFootprintValleys(
  footprint: Pt[],
  existingEdges: { type: string; p1: Pt; p2: Pt }[],
  segmentPolygons: Pt[][],
  planes: { azimuthDeg: number }[],
  originLat: number,
  originLng: number,
): ClassifiedEdge[] {
  console.log(`[Roof] Valley detection: footprint has ${footprint.length} vertices`)
  if (footprint.length < 5) return []

  const valleys: ClassifiedEdge[] = []

  // Ensure CCW winding (positive signed area)
  const signedArea = polygonAreaSigned(footprint)
  const poly = signedArea >= 0 ? footprint : [...footprint].reverse()
  console.log(`[Roof] Valley detection: signed area=${signedArea.toFixed(2)}, winding=${signedArea >= 0 ? 'CCW' : 'CW→reversed'}`)

  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]

    // Cross product: positive = CCW (convex), negative = CW (concave)
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x)
    console.log(`[Roof] Vertex ${i}: cross=${cross.toFixed(4)} (${cross < -0.01 ? 'CONCAVE' : 'convex'}) at (${curr.x.toFixed(2)}, ${curr.y.toFixed(2)})`)
    if (cross >= -0.01) continue // not concave

    // Compute inward bisector direction
    const d1x = prev.x - curr.x, d1y = prev.y - curr.y
    const d2x = next.x - curr.x, d2y = next.y - curr.y
    const len1 = Math.sqrt(d1x * d1x + d1y * d1y) || 1
    const len2 = Math.sqrt(d2x * d2x + d2y * d2y) || 1
    const bisX = d1x / len1 + d2x / len2
    const bisY = d1y / len1 + d2y / len2
    const bisLen = Math.sqrt(bisX * bisX + bisY * bisY)
    if (bisLen < 1e-6) continue
    const dirX = bisX / bisLen
    const dirY = bisY / bisLen

    // Ray-cast from concave vertex in bisector direction.
    // Find the nearest intersection with a footprint edge (excluding the two
    // edges adjacent to this vertex) or an existing internal edge.
    let bestT = Infinity
    let bestHit: Pt | null = null

    // Intersect with footprint edges
    for (let e = 0; e < poly.length; e++) {
      // Skip edges adjacent to the concave vertex
      if (e === i || e === (i - 1 + poly.length) % poly.length) continue
      const ep1 = poly[e]
      const ep2 = poly[(e + 1) % poly.length]
      const hit = raySegmentIntersect(curr, dirX, dirY, ep1, ep2)
      if (hit !== null && hit.t > 0.3 && hit.t < bestT) {
        bestT = hit.t
        bestHit = hit.point
      }
    }

    // Intersect with existing internal edges (ridge/hip)
    for (const edge of existingEdges) {
      if (edge.type !== 'ridge' && edge.type !== 'hip') continue
      const hit = raySegmentIntersect(curr, dirX, dirY, edge.p1, edge.p2)
      if (hit !== null && hit.t > 0.3 && hit.t < bestT) {
        bestT = hit.t
        bestHit = hit.point
      }
    }

    if (!bestHit || bestT < 0.5) continue // too short

    const lengthM = dist2D(curr, bestHit)
    if (lengthM < 0.5) continue

    const lengthFt = Math.round(lengthM * M_TO_FT * 10) / 10
    const start = localToLatLng(curr, originLat, originLng)
    const end = localToLatLng(bestHit, originLat, originLng)

    // Determine which segments border this valley
    const mid: Pt = { x: (curr.x + bestHit.x) / 2, y: (curr.y + bestHit.y) / 2 }
    const perpX = -dirY, perpY = dirX // perpendicular to valley line
    const testA: Pt = { x: mid.x + perpX * 0.5, y: mid.y + perpY * 0.5 }
    const testB: Pt = { x: mid.x - perpX * 0.5, y: mid.y - perpY * 0.5 }
    const segA = nearestSegment(testA, segmentPolygons)
    const segB = nearestSegment(testB, segmentPolygons)

    valleys.push({ type: 'valley', start, end, lengthFt, segmentA: segA, segmentB: segB })
    console.log(`[Roof] Footprint valley detected: ${lengthFt}' from concave vertex ${i}`)
  }

  return valleys
}

/** Find nearest segment polygon to a point (by centroid distance). */
function nearestSegment(pt: Pt, segmentPolygons: Pt[][]): number {
  let best = 0, bestDist = Infinity
  for (let s = 0; s < segmentPolygons.length; s++) {
    if (segmentPolygons[s].length < 3) continue
    const c = polygonCentroid(segmentPolygons[s])
    const d = dist2D(pt, c)
    if (d < bestDist) { bestDist = d; best = s }
  }
  return best
}

/** Ray-segment intersection. Ray from origin in direction (dx,dy), segment p1→p2. */
function raySegmentIntersect(
  origin: Pt, dx: number, dy: number, p1: Pt, p2: Pt,
): { t: number; point: Pt } | null {
  const ex = p2.x - p1.x, ey = p2.y - p1.y
  const denom = dx * ey - dy * ex
  if (Math.abs(denom) < 1e-10) return null // parallel

  const t = ((p1.x - origin.x) * ey - (p1.y - origin.y) * ex) / denom
  const u = ((p1.x - origin.x) * dy - (p1.y - origin.y) * dx) / denom

  if (t < 0 || u < 0 || u > 1) return null
  return { t, point: { x: origin.x + dx * t, y: origin.y + dy * t } }
}

/** Centroid of a polygon (average of vertices). */
function polygonCentroid(poly: Pt[]): Pt {
  if (poly.length === 0) return { x: 0, y: 0 }
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  }
}

/**
 * Clip the line A*x + B*y = C to a convex (or roughly convex) polygon.
 * Returns the two intersection points where the line enters/exits the polygon,
 * or null if the line doesn't cross the polygon.
 */
function clipLineToPolygon(
  A: number, B: number, C: number, poly: Pt[],
): { p1: Pt; p2: Pt } | null {
  const intersections: Pt[] = []

  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]
    const p2 = poly[(i + 1) % poly.length]
    const d1 = A * p1.x + B * p1.y - C
    const d2 = A * p2.x + B * p2.y - C

    // Edge crosses the line if d1 and d2 have different signs
    if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
      const t = d1 / (d1 - d2)
      intersections.push({
        x: p1.x + t * (p2.x - p1.x),
        y: p1.y + t * (p2.y - p1.y),
      })
    } else if (Math.abs(d1) < 1e-6) {
      // p1 is on the line
      intersections.push({ x: p1.x, y: p1.y })
    }
  }

  if (intersections.length < 2) return null

  // Find the two most distant intersection points (handles duplicates)
  let maxDist = 0
  let best: { p1: Pt; p2: Pt } | null = null
  for (let i = 0; i < intersections.length; i++) {
    for (let j = i + 1; j < intersections.length; j++) {
      const d = dist2D(intersections[i], intersections[j])
      if (d > maxDist) {
        maxDist = d
        best = { p1: intersections[i], p2: intersections[j] }
      }
    }
  }

  return best
}

/**
 * Scale a polygon around its centroid by a given factor.
 * factor < 1 shrinks, factor > 1 grows.
 */
function scalePolygonAroundCentroid(poly: Pt[], factor: number): Pt[] {
  if (poly.length < 3) return poly
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
  return poly.map(p => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }))
}

/**
 * Expand a convex polygon outward from its centroid by a distance in meters.
 * Simple radial expansion — accurate for convex shapes with small offsets.
 */
function expandPolygonMeters(poly: Pt[], expandM: number): Pt[] {
  if (poly.length < 3 || expandM <= 0) return poly
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
  return poly.map(p => {
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d < 0.01) return p
    const scale = (d + expandM) / d
    return { x: cx + dx * scale, y: cy + dy * scale }
  })
}

// ---------------------------------------------------------------------------
// 3D roof plane definition
// ---------------------------------------------------------------------------

interface RoofPlane {
  // z(x,y) = c0 + a*x + b*y  (global form: eliminates per-query center offsets)
  a: number
  b: number
  c0: number
}

/**
 * Build a 3D plane from Solar API segment data.
 *
 * Azimuth = direction the slope faces (downhill). The plane height decreases
 * in the azimuth direction at rate tan(pitch).
 *
 * z(x,y) = heightAtCenter - tan(pitch) * [ sin(az)*(x - cx) + cos(az)*(y - cy) ]
 *        = (heightAtCenter + tan(pitch)*(sin(az)*cx + cos(az)*cy))  // c0
 *          - tan(pitch)*sin(az) * x                                  // a*x
 *          - tan(pitch)*cos(az) * y                                  // b*y
 */
function makeRoofPlane(
  centerX: number,
  centerY: number,
  pitchDeg: number,
  azimuthDeg: number,
  heightAtCenter: number,
): RoofPlane {
  const slope = Math.tan(toRadians(pitchDeg))
  const azRad = toRadians(azimuthDeg)
  const a = -slope * Math.sin(azRad)
  const b = -slope * Math.cos(azRad)
  const c0 = heightAtCenter - a * centerX - b * centerY
  return { a, b, c0 }
}

function planeZ(plane: RoofPlane, x: number, y: number): number {
  return plane.c0 + plane.a * x + plane.b * y
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

/**
 * Classify a shared edge between two segments.
 *
 * Uses sideI (= z_i(centroid_i) - z_j(centroid_i)) to determine whether
 * the intersection line is a peak or trough:
 *   - sideI < 0 → peak: the "other" plane extrapolates above the own plane
 *     at its centroid, meaning the intersection line is at a local maximum.
 *     Use azimuth diff to distinguish ridge (>150°) from hip.
 *   - sideI > 0 → valley: own plane is higher at its centroid, meaning the
 *     intersection line is at a local minimum (trough).
 *
 * This correctly handles L-shaped extensions where azimuth diff is ~90°
 * but the edge is a valley, not a hip.
 */
function classifySharedEdge(
  azA: number, azB: number, sideI?: number,
): 'ridge' | 'valley' | 'hip' {
  // If sideI is provided, use it for peak/trough detection
  if (sideI !== undefined && sideI > 0) {
    return 'valley'
  }

  // Peak edge (sideI <= 0): distinguish ridge from hip by azimuth
  const diff = azimuthDifference(azA, azB)
  if (diff > 150) return 'ridge'
  if (diff < 30) return 'valley'  // fallback for near-parallel planes
  return 'hip'
}

/**
 * Classify a perimeter (non-shared) edge as eave or rake.
 * Eaves run perpendicular to the slope direction (across the bottom/top).
 * Rakes run parallel to the slope direction (up the sides).
 *
 * @param isHipRoof - if true, all perimeter edges are eave (hip roofs have
 *   no rakes — the gable end is replaced by hip faces)
 */
function classifyPerimeterEdge(start: Pt, end: Pt, azimuthDeg: number, isHipRoof = false): 'rake' | 'eave' {
  if (isHipRoof) return 'eave'
  const edgeDx = end.x - start.x
  const edgeDy = end.y - start.y
  const edgeBearing = normalizeAngle(toDegrees(Math.atan2(edgeDx, edgeDy)))
  const diff = azimuthDifference(edgeBearing, azimuthDeg)
  // Parallel to slope direction → rake; perpendicular → eave
  return (diff < 25 || diff > 155) ? 'rake' : 'eave'
}

// ---------------------------------------------------------------------------
// Waste factor & ice-water shield
// ---------------------------------------------------------------------------

function computeWasteFactor(
  numValleys: number,
  numHips: number,
  maxPitchDeg: number,
): number {
  let waste = 10
  waste += (numValleys + numHips) * 2
  waste = Math.min(waste, 25)
  const pitchOf6_12 = toDegrees(Math.atan(6 / 12)) // ~26.57°
  const pitchOf2_12 = toDegrees(Math.atan(2 / 12)) // ~9.46°
  if (maxPitchDeg > pitchOf6_12) {
    waste += Math.floor((maxPitchDeg - pitchOf6_12) / pitchOf2_12)
  }
  return waste
}

function computeIceWaterShield(
  edges: ClassifiedEdge[],
  segments: ReportSegment[],
): number {
  let sqft = 0
  for (const edge of edges) {
    if (edge.type === 'valley') {
      sqft += ICE_WATER_SHIELD_VALLEY_WIDTH_FT * 2 * edge.lengthFt
    }
  }
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

export function generateRoofReport(
  insights: BuildingInsightsResponse,
  eaveOverhangInches = 12,
): RoofReportData {
  const rawSegments = insights.solarPotential?.roofSegmentStats
  if (!rawSegments || rawSegments.length === 0) {
    return emptyReport(insights)
  }

  const originLat = insights.center.latitude
  const originLng = insights.center.longitude
  const overhangMeters = (eaveOverhangInches / 12) * 0.3048

  // -----------------------------------------------------------------------
  // 1. Build 3D plane for each roof segment
  // -----------------------------------------------------------------------
  const planes: RoofPlane[] = rawSegments.map(seg => {
    const local = latLngToLocal(
      seg.center.latitude, seg.center.longitude,
      originLat, originLng,
    )
    return makeRoofPlane(
      local.x, local.y,
      seg.pitchDegrees, seg.azimuthDegrees,
      seg.planeHeightAtCenterMeters,
    )
  })

  // -----------------------------------------------------------------------
  // 2. Compute building footprint
  //    Solar API bounding boxes are axis-aligned and much larger than the
  //    actual building. We take the convex hull of all bbox corners, then
  //    scale it to match the known ground area from wholeRoofStats.
  // -----------------------------------------------------------------------
  const allCorners: Pt[] = []
  for (const seg of rawSegments) {
    if (!seg.boundingBox) continue
    const sw = latLngToLocal(
      seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude,
      originLat, originLng,
    )
    const ne = latLngToLocal(
      seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude,
      originLat, originLng,
    )
    allCorners.push(
      sw,
      { x: ne.x, y: sw.y }, // SE
      ne,
      { x: sw.x, y: ne.y }, // NW
    )
  }

  let footprint = convexHull(allCorners)
  if (footprint.length < 3) return emptyReport(insights)

  // Ensure CCW winding
  if (polygonAreaSigned(footprint) < 0) footprint.reverse()

  // Scale hull to match the actual building ground area.
  // The convex hull of axis-aligned bounding boxes is typically 2-4x too large.
  const knownGroundArea = insights.solarPotential?.wholeRoofStats?.groundAreaMeters2
    || insights.solarPotential?.buildingStats?.groundAreaMeters2
    || 0
  if (knownGroundArea > 0) {
    const hullArea = Math.abs(polygonAreaSigned(footprint))
    if (hullArea > knownGroundArea * 1.1) {
      const scale = Math.sqrt(knownGroundArea / hullArea)
      footprint = scalePolygonAroundCentroid(footprint, scale)
    }
  }

  // Expand footprint by eave overhang
  if (overhangMeters > 0) {
    footprint = expandPolygonMeters(footprint, overhangMeters)
  }

  // -----------------------------------------------------------------------
  // 3. Partition footprint: each segment "owns" the region where its plane
  //    is highest. Clip footprint by z_i >= z_j for all j ≠ i.
  // -----------------------------------------------------------------------
  const segmentPolygons: Pt[][] = []

  for (let i = 0; i < planes.length; i++) {
    let poly = [...footprint]

    for (let j = 0; j < planes.length; j++) {
      if (i === j) continue

      // Half-plane: z_i(x,y) >= z_j(x,y)
      // (a_i - a_j)*x + (b_i - b_j)*y >= c0_j - c0_i
      const A = planes[i].a - planes[j].a
      const B = planes[i].b - planes[j].b
      const C = planes[j].c0 - planes[i].c0

      // Skip near-parallel planes (same slope/direction) — no meaningful boundary
      if (Math.abs(A) < 1e-8 && Math.abs(B) < 1e-8) continue

      poly = clipPolygonByHalfPlane(poly, A, B, C)
      if (poly.length < 3) break
    }

    segmentPolygons.push(poly)
  }

  // -----------------------------------------------------------------------
  // 4. Build ReportSegment array
  // -----------------------------------------------------------------------
  const segments: ReportSegment[] = rawSegments.map((seg, i) => {
    const localPoly = segmentPolygons[i]
    const vertices = localPoly.map(p => localToLatLng(p, originLat, originLng))

    // Use Solar API's slope area (more accurate than projected polygon area)
    const areaSqft = Math.round(seg.stats.areaMeters2 * SQM_TO_SQFT)

    return {
      index: i,
      name: `Segment ${i + 1}`,
      area: areaSqft,
      pitch: pitchToRiseRun(seg.pitchDegrees),
      pitchDegrees: Math.round(seg.pitchDegrees * 10) / 10,
      azimuthDegrees: Math.round(seg.azimuthDegrees),
      polygon: { vertices },
    }
  })

  // -----------------------------------------------------------------------
  // 5. Classify edges from each segment polygon
  // -----------------------------------------------------------------------
  const edges: ClassifiedEdge[] = []

  // Track which (i,j) shared edges we've already emitted to avoid duplicates
  const emittedSharedEdges = new Set<string>()

  for (let i = 0; i < segmentPolygons.length; i++) {
    const poly = segmentPolygons[i]
    if (poly.length < 3) continue

    for (let v = 0; v < poly.length; v++) {
      const p1 = poly[v]
      const p2 = poly[(v + 1) % poly.length]
      const lengthM = dist2D(p1, p2)
      if (lengthM < 0.15) continue // skip degenerate edges

      const edgeMid: Pt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const lengthFt = Math.round(lengthM * M_TO_FT * 10) / 10
      const start = localToLatLng(p1, originLat, originLng)
      const end = localToLatLng(p2, originLat, originLng)

      // Determine if this edge is shared with another segment polygon.
      // Two segment polygons share an edge along their plane-plane intersection.
      let sharedWith = -1
      for (let j = 0; j < segmentPolygons.length; j++) {
        if (j === i) continue
        const otherPoly = segmentPolygons[j]
        if (otherPoly.length < 3) continue

        for (let w = 0; w < otherPoly.length; w++) {
          const q1 = otherPoly[w]
          const q2 = otherPoly[(w + 1) % otherPoly.length]
          const qMid: Pt = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 }
          // Shared edges have matching midpoints and similar lengths
          if (dist2D(edgeMid, qMid) < 0.5 && Math.abs(lengthM - dist2D(q1, q2)) < 0.5) {
            sharedWith = j
            break
          }
        }
        if (sharedWith >= 0) break
      }

      if (sharedWith >= 0) {
        // Shared edge — emit only once per pair (lower index first)
        const lo = Math.min(i, sharedWith)
        const hi = Math.max(i, sharedWith)
        const key = `${lo}-${hi}-${Math.round(edgeMid.x * 100)}-${Math.round(edgeMid.y * 100)}`
        if (emittedSharedEdges.has(key)) continue
        emittedSharedEdges.add(key)

        const type = classifySharedEdge(
          rawSegments[i].azimuthDegrees,
          rawSegments[sharedWith].azimuthDegrees,
        )
        edges.push({ type, start, end, lengthFt, segmentA: lo, segmentB: hi })
      } else {
        // Perimeter edge — classify as rake or eave
        const type = classifyPerimeterEdge(p1, p2, rawSegments[i].azimuthDegrees)
        edges.push({ type, start, end, lengthFt, segmentA: i })
      }
    }
  }

  // -----------------------------------------------------------------------
  // 6. Compute measurements
  // -----------------------------------------------------------------------
  const totalAreaSqft = segments.reduce((sum, s) => sum + s.area, 0)
  const totalSquares = Math.round((totalAreaSqft / 100) * 100) / 100

  const sumLF = (type: ClassifiedEdge['type']) =>
    Math.round(
      edges.filter(e => e.type === type).reduce((s, e) => s + e.lengthFt, 0) * 10,
    ) / 10

  const totalRidgeLF = sumLF('ridge')
  const totalValleyLF = sumLF('valley')
  const totalHipLF = sumLF('hip')
  const totalRakeLF = sumLF('rake')
  const totalEaveLF = sumLF('eave')
  const totalPerimeterLF = Math.round((totalRakeLF + totalEaveLF) * 10) / 10

  const maxPitch = segments.reduce((max, s) => Math.max(max, s.pitchDegrees), 0)
  const numValleys = edges.filter(e => e.type === 'valley').length
  const numHips = edges.filter(e => e.type === 'hip').length
  const wasteFactorPct = computeWasteFactor(numValleys, numHips, maxPitch)
  const iceWaterShieldSqft = computeIceWaterShield(edges, segments)
  const suggestedSquaresWithWaste =
    Math.round(totalSquares * (1 + wasteFactorPct / 100) * 100) / 100

  return {
    segments,
    edges,
    measurements: {
      totalRidgeLF,
      totalValleyLF,
      totalHipLF,
      totalRakeLF,
      totalEaveLF,
      totalPerimeterLF,
      wasteFactorPct,
      iceWaterShieldSqft,
      suggestedSquaresWithWaste,
    },
    center: { lat: originLat, lng: originLng },
    totalAreaSqft,
    totalSquares,
  }
}

// ---------------------------------------------------------------------------
// DSM-based report generation (primary path — uses real elevation data)
// ---------------------------------------------------------------------------

/**
 * Generate a roof report from DSM-processed data (real 3D geometry).
 * Uses the same "highest plane wins" polygon clipping as the metadata path,
 * but with actual roof planes from RANSAC and real footprint from mask contour.
 *
 * Falls back to generateRoofReport() if DSM processing didn't yield usable data.
 */
export function generateRoofReportFromDSM(
  dsm: DsmResult,
  originLat: number,
  originLng: number,
  eaveOverhangInches = 12,
): RoofReportData {
  const overhangMeters = (eaveOverhangInches / 12) * 0.3048

  // Use DSM footprint directly (already in local meters, CCW)
  let footprint = [...dsm.footprint]

  // Expand footprint by eave overhang
  if (overhangMeters > 0) {
    footprint = expandPolygonMeters(footprint, overhangMeters)
  }

  // -----------------------------------------------------------------------
  // Use pre-computed segment polygons from DSM processor.
  // These are built by assigning each footprint point to the plane whose
  // predicted z best matches the actual DSM elevation — this correctly
  // handles hip roofs where "highest plane wins" fails.
  // Expand each by eave overhang to match the expanded footprint.
  // -----------------------------------------------------------------------
  const segmentPolygons: Pt[][] = dsm.segmentPolygons.map(poly => {
    if (poly.length < 3) return []
    let expanded = poly.map(p => ({ x: p.x, y: p.y }))
    if (overhangMeters > 0) {
      expanded = expandPolygonMeters(expanded, overhangMeters)
    }
    return expanded
  })

  // -----------------------------------------------------------------------
  // Build segments
  // -----------------------------------------------------------------------
  const segments: ReportSegment[] = dsm.planes.map((plane, i) => {
    const localPoly = segmentPolygons[i]
    const vertices = localPoly.map(p => localToLatLng(p, originLat, originLng))

    // Compute slope area from polygon ground area and pitch
    // slope_area = ground_area / cos(pitch) = ground_area * sqrt(1 + a² + b²)
    const groundAreaSqm = Math.abs(polygonAreaSigned(localPoly))
    const slopeMultiplier = Math.sqrt(1 + plane.a * plane.a + plane.b * plane.b)
    const slopeAreaSqm = groundAreaSqm * slopeMultiplier
    const areaSqft = Math.round(slopeAreaSqm * SQM_TO_SQFT)

    return {
      index: i,
      name: `Segment ${i + 1}`,
      area: areaSqft,
      pitch: pitchToRiseRun(plane.pitchDeg),
      pitchDegrees: Math.round(plane.pitchDeg * 10) / 10,
      azimuthDegrees: Math.round(plane.azimuthDeg),
      polygon: { vertices },
    }
  })

  // -----------------------------------------------------------------------
  // Classify edges from segment polygon boundaries.
  //
  // Instead of computing all pairwise plane intersections (which generates
  // spurious lines), we find edges where segment polygons ACTUALLY share a
  // boundary.  For each pair of adjacent segments, we find the contact zone
  // (closest points between the two polygons) and draw a single edge there.
  //
  // Perimeter edges come from the footprint boundary, classified as eave
  // (hip roof) or rake/eave (gable roof).
  // -----------------------------------------------------------------------
  const edges: ClassifiedEdge[] = []

  // --- Internal edges: find where segment polygons share boundaries ---
  for (let i = 0; i < segmentPolygons.length; i++) {
    for (let j = i + 1; j < segmentPolygons.length; j++) {
      if (segmentPolygons[i].length < 3 || segmentPolygons[j].length < 3) continue
      if (!areSegmentsAdjacent(segmentPolygons[i], segmentPolygons[j])) continue

      // Find the boundary between these two segment polygons.
      // Collect vertices from each polygon that are close to the other polygon.
      const boundaryPts: Pt[] = []

      for (const p of segmentPolygons[i]) {
        const minDist = Math.min(...segmentPolygons[j].map(q => dist2D(p, q)))
        if (minDist < 3.5) boundaryPts.push(p)
      }
      for (const p of segmentPolygons[j]) {
        const minDist = Math.min(...segmentPolygons[i].map(q => dist2D(p, q)))
        if (minDist < 3.5) boundaryPts.push(p)
      }

      if (boundaryPts.length < 2) continue

      // Find the two most distant boundary points — these define the edge
      let maxDist = 0
      let edgeP1 = boundaryPts[0], edgeP2 = boundaryPts[1]
      for (let a = 0; a < boundaryPts.length; a++) {
        for (let b = a + 1; b < boundaryPts.length; b++) {
          const d = dist2D(boundaryPts[a], boundaryPts[b])
          if (d > maxDist) {
            maxDist = d
            edgeP1 = boundaryPts[a]
            edgeP2 = boundaryPts[b]
          }
        }
      }

      const lengthM = dist2D(edgeP1, edgeP2)
      if (lengthM < 0.5) continue

      const lengthFt = Math.round(lengthM * M_TO_FT * 10) / 10
      const start = localToLatLng(edgeP1, originLat, originLng)
      const end = localToLatLng(edgeP2, originLat, originLng)

      // Classify using azimuth difference + elevation (sideI)
      const pi = dsm.planes[i], pj = dsm.planes[j]
      const A = pi.a - pj.a, B = pi.b - pj.b, C = pj.c0 - pi.c0
      const ci = polygonCentroid(segmentPolygons[i])
      const sideI = A * ci.x + B * ci.y - C
      const type = classifySharedEdge(pi.azimuthDeg, pj.azimuthDeg, sideI)

      edges.push({ type, start, end, lengthFt, segmentA: i, segmentB: j })
    }
  }

  // --- Footprint-based valley detection ---
  // Use the ORIGINAL footprint (before overhang expansion) so concave vertices
  // from extensions aren't smoothed away by the expansion.
  const internalEdgesLocal = edges.map(e => ({
    type: e.type,
    p1: latLngToLocal(e.start.lat, e.start.lng, originLat, originLng),
    p2: latLngToLocal(e.end.lat, e.end.lng, originLat, originLng),
  }))
  const originalFootprint = [...dsm.footprint]
  const footprintValleys = detectFootprintValleys(
    originalFootprint, internalEdgesLocal, segmentPolygons, dsm.planes, originLat, originLng,
  )
  edges.push(...footprintValleys)

  // --- Perimeter edges: footprint boundary ---
  // Detect hip roof: 4+ segments with azimuths covering N, S, E, W quadrants
  const azQuadrants = new Set(dsm.planes.map(p => Math.floor(((p.azimuthDeg + 45) % 360) / 90)))
  const isHipRoof = dsm.planes.length >= 4 && azQuadrants.size >= 4

  for (let v = 0; v < footprint.length; v++) {
    const p1 = footprint[v]
    const p2 = footprint[(v + 1) % footprint.length]
    const lengthM = dist2D(p1, p2)
    if (lengthM < 0.15) continue

    const lengthFt = Math.round(lengthM * M_TO_FT * 10) / 10
    const start = localToLatLng(p1, originLat, originLng)
    const end = localToLatLng(p2, originLat, originLng)

    // Determine which segment this edge belongs to (nearest centroid)
    const edgeMid: Pt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    let nearestSeg = 0
    let nearestDist = Infinity
    for (let s = 0; s < segmentPolygons.length; s++) {
      if (segmentPolygons[s].length < 3) continue
      const c = polygonCentroid(segmentPolygons[s])
      const d = dist2D(edgeMid, c)
      if (d < nearestDist) { nearestDist = d; nearestSeg = s }
    }

    const type = classifyPerimeterEdge(p1, p2, dsm.planes[nearestSeg].azimuthDeg, isHipRoof)
    edges.push({ type, start, end, lengthFt, segmentA: nearestSeg })
  }

  // -----------------------------------------------------------------------
  // Compute measurements
  // -----------------------------------------------------------------------
  const totalAreaSqft = segments.reduce((sum, s) => sum + s.area, 0)
  const totalSquares = Math.round((totalAreaSqft / 100) * 100) / 100

  const sumLF = (type: ClassifiedEdge['type']) =>
    Math.round(
      edges.filter(e => e.type === type).reduce((s, e) => s + e.lengthFt, 0) * 10,
    ) / 10

  const totalRidgeLF = sumLF('ridge')
  const totalValleyLF = sumLF('valley')
  const totalHipLF = sumLF('hip')
  const totalRakeLF = sumLF('rake')
  const totalEaveLF = sumLF('eave')
  const totalPerimeterLF = Math.round((totalRakeLF + totalEaveLF) * 10) / 10

  const maxPitch = segments.reduce((max, s) => Math.max(max, s.pitchDegrees), 0)
  const numValleys = edges.filter(e => e.type === 'valley').length
  const numHips = edges.filter(e => e.type === 'hip').length
  const wasteFactorPct = computeWasteFactor(numValleys, numHips, maxPitch)
  const iceWaterShieldSqft = computeIceWaterShield(edges, segments)
  const suggestedSquaresWithWaste =
    Math.round(totalSquares * (1 + wasteFactorPct / 100) * 100) / 100

  return {
    segments,
    edges,
    measurements: {
      totalRidgeLF,
      totalValleyLF,
      totalHipLF,
      totalRakeLF,
      totalEaveLF,
      totalPerimeterLF,
      wasteFactorPct,
      iceWaterShieldSqft,
      suggestedSquaresWithWaste,
    },
    center: { lat: originLat, lng: originLng },
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
