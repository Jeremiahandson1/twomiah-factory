// SAM 2 Post-Processor
// Takes SAM polygon masks and computes pitch/azimuth by sampling elevation data.
// Fits a least-squares plane to DSM/LiDAR points within each mask polygon.
// Returns DiscoveredPlane[] compatible with the existing DsmResult pipeline.

import type { DiscoveredPlane } from './dsmProcessor.ts'
import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Pt { x: number; y: number }
interface Pt3 { x: number; y: number; z: number }

interface ElevationGrid {
  data: Float32Array
  width: number
  height: number
  originLat: number
  originLng: number
  pixelSizeLat: number
  pixelSizeLng: number
}

interface PixelPolygon {
  vertices: Array<{ x: number; y: number }>  // pixel coords on image
}

interface GeoTransform {
  centerLat: number
  centerLng: number
  zoom: number
  imageWidth: number
  imageHeight: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METERS_PER_DEG = 111_319.5

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Process SAM 2 mask polygons into DiscoveredPlane objects.
 * For each polygon, samples elevation data within the mask and fits a plane.
 *
 * @param pixelPolygons - Polygons from SAM 2 in pixel coordinates
 * @param elevation - Elevation grid (DSM or LiDAR)
 * @param geoTransform - Maps pixel coords to geographic coords
 */
export function processSamSegments(
  pixelPolygons: PixelPolygon[],
  elevation: ElevationGrid,
  geoTransform: GeoTransform,
): DiscoveredPlane[] {
  const planes: DiscoveredPlane[] = []

  for (const poly of pixelPolygons) {
    if (poly.vertices.length < 3) continue

    // Convert pixel polygon to geographic polygon
    const geoVertices = poly.vertices.map(v => pixelToLatLng(v, geoTransform))

    // Sample elevation points within the polygon
    const points = sampleElevationInPolygon(geoVertices, elevation)
    if (points.length < 3) {
      logger.warn('SAM segment has insufficient elevation points', { count: points.length })
      continue
    }

    // Fit plane using least-squares (not RANSAC — SAM mask is already clean)
    const plane = fitPlaneLeastSquares(points)
    if (!plane) continue

    // Compute pitch and azimuth from plane coefficients
    const pitchDeg = computePitch(plane.a, plane.b)
    const azimuthDeg = computeAzimuth(plane.a, plane.b)

    // Compute ground area
    const groundAreaSqm = computeGroundArea(geoVertices)

    planes.push({
      a: plane.a,
      b: plane.b,
      c0: plane.c0,
      pitchDeg,
      azimuthDeg,
      inlierCount: points.length,
      groundAreaSqm,
    })
  }

  return planes
}

// ---------------------------------------------------------------------------
// Plane fitting (least-squares)
// ---------------------------------------------------------------------------

/**
 * Fit z = c0 + a*x + b*y to 3D points using ordinary least squares.
 * More stable than RANSAC for clean (pre-segmented) point sets.
 */
function fitPlaneLeastSquares(
  points: Pt3[],
): { a: number; b: number; c0: number } | null {
  const n = points.length
  if (n < 3) return null

  // Build normal equations: [A^T A] [a,b,c0]^T = A^T z
  let sx = 0, sy = 0, sz = 0
  let sxx = 0, sxy = 0, sxz = 0
  let syy = 0, syz = 0

  for (const p of points) {
    sx += p.x; sy += p.y; sz += p.z
    sxx += p.x * p.x; sxy += p.x * p.y; sxz += p.x * p.z
    syy += p.y * p.y; syz += p.y * p.z
  }

  // 3x3 system: [sxx sxy sx] [a]   [sxz]
  //             [sxy syy sy] [b] = [syz]
  //             [sx  sy  n ] [c0]  [sz ]
  const det = sxx * (syy * n - sy * sy)
            - sxy * (sxy * n - sy * sx)
            + sx  * (sxy * sy - syy * sx)

  if (Math.abs(det) < 1e-10) return null

  const a = (sxz * (syy * n - sy * sy) - sxy * (syz * n - sy * sz) + sx * (syz * sy - syy * sz)) / det
  const b = (sxx * (syz * n - sy * sz) - sxz * (sxy * n - sy * sx) + sx * (sxy * sz - syz * sx)) / det
  const c0 = (sxx * (syy * sz - syz * sy) - sxy * (sxy * sz - syz * sx) + sxz * (sxy * sy - syy * sx)) / det

  return { a, b, c0 }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function computePitch(a: number, b: number): number {
  // Slope = sqrt(a^2 + b^2), pitch = atan(slope)
  const slope = Math.sqrt(a * a + b * b)
  return Math.atan(slope) * 180 / Math.PI
}

function computeAzimuth(a: number, b: number): number {
  // Azimuth = direction the roof faces (downhill direction)
  // a = dz/dx (east), b = dz/dy (north)
  let azimuth = Math.atan2(a, b) * 180 / Math.PI
  if (azimuth < 0) azimuth += 360
  return azimuth
}

function computeGroundArea(vertices: Array<{ lat: number; lng: number }>): number {
  // Shoelace formula in local meters
  const cx = vertices.reduce((s, v) => s + v.lat, 0) / vertices.length
  const pts = vertices.map(v => ({
    x: (v.lng - vertices[0].lng) * METERS_PER_DEG * Math.cos(cx * Math.PI / 180),
    y: (v.lat - vertices[0].lat) * METERS_PER_DEG,
  }))

  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(area) / 2
}

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

function pixelToLatLng(
  pixel: { x: number; y: number },
  geo: GeoTransform,
): { lat: number; lng: number } {
  const scale = Math.pow(2, geo.zoom) * 256
  const centerWorldX = (geo.centerLng + 180) / 360 * scale
  const centerWorldY = (1 - Math.log(Math.tan(geo.centerLat * Math.PI / 180) + 1 / Math.cos(geo.centerLat * Math.PI / 180)) / Math.PI) / 2 * scale

  const worldX = centerWorldX + (pixel.x - geo.imageWidth / 2)
  const worldY = centerWorldY + (pixel.y - geo.imageHeight / 2)

  const lng = worldX / scale * 360 - 180
  const n = Math.PI - 2 * Math.PI * worldY / scale
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))

  return { lat, lng }
}

// ---------------------------------------------------------------------------
// Elevation sampling
// ---------------------------------------------------------------------------

/**
 * Sample elevation points within a geographic polygon from the elevation grid.
 * Returns 3D points in local meters relative to the polygon centroid.
 */
function sampleElevationInPolygon(
  vertices: Array<{ lat: number; lng: number }>,
  grid: ElevationGrid,
): Pt3[] {
  const points: Pt3[] = []

  // Bounding box of polygon in grid coordinates
  const lats = vertices.map(v => v.lat)
  const lngs = vertices.map(v => v.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  // Centroid for local coordinate system
  const cLat = (minLat + maxLat) / 2
  const cLng = (minLng + maxLng) / 2

  // Iterate through grid pixels within the bounding box
  for (let row = 0; row < grid.height; row++) {
    const lat = grid.originLat + row * grid.pixelSizeLat
    if (lat < minLat || lat > maxLat) continue

    for (let col = 0; col < grid.width; col++) {
      const lng = grid.originLng + col * grid.pixelSizeLng
      if (lng < minLng || lng > maxLng) continue

      // Point-in-polygon test
      if (!pointInPolygon(lat, lng, vertices)) continue

      const z = grid.data[row * grid.width + col]
      if (isNaN(z)) continue

      // Convert to local meters
      const x = (lng - cLng) * METERS_PER_DEG * Math.cos(cLat * Math.PI / 180)
      const y = (lat - cLat) * METERS_PER_DEG

      points.push({ x, y, z })
    }
  }

  return points
}

function pointInPolygon(
  lat: number,
  lng: number,
  vertices: Array<{ lat: number; lng: number }>,
): boolean {
  let inside = false
  const n = vertices.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = vertices[i].lat, xi = vertices[i].lng
    const yj = vertices[j].lat, xj = vertices[j].lng
    if ((yi > lat) !== (yj > lat) &&
        lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
