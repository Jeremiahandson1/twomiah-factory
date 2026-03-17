// DSM-based Roof Geometry Processor
// Extracts actual roof planes from Google Solar API Digital Surface Model (DSM)
// and building footprint from binary roof mask GeoTIFF data.
//
// This replaces the metadata-inference approach with real 3D geometry:
// - Mask contour → precise building footprint
// - RANSAC plane fitting on elevation data → actual roof facets
// - Plane equations are exact, not inferred from bounding box metadata

import { fromArrayBuffer } from 'geotiff'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 2D point in local meters (East = +x, North = +y) */
interface Pt {
  x: number
  y: number
}

/** 3D point in local meters (elevation = z) */
interface Pt3 {
  x: number
  y: number
  z: number
}

/** GeoTIFF spatial transform */
interface GeoTransform {
  width: number
  height: number
  originX: number   // top-left X (longitude for WGS84)
  originY: number   // top-left Y (latitude for WGS84)
  pixelW: number    // pixel width in degrees (positive, east)
  pixelH: number    // pixel height in degrees (positive, stored as negative in GeoTIFF)
}

/** A discovered roof plane: z = c0 + a*x + b*y in local meters */
export interface DiscoveredPlane {
  a: number
  b: number
  c0: number
  pitchDeg: number
  azimuthDeg: number
  inlierCount: number
  groundAreaSqm: number   // projected ground area of inlier cluster
}

/** Complete DSM processing result */
export interface DsmResult {
  footprint: Pt[]           // building footprint polygon (CCW, local meters)
  planes: DiscoveredPlane[] // RANSAC-fitted roof planes
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METERS_PER_DEG = 111_319.5

// ---------------------------------------------------------------------------
// GeoTIFF parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GeoTIFF buffer and extract raster data + geographic transform.
 * Works for DSM (float32 elevation), mask (uint8 binary), and RGB imagery.
 */
async function parseGeoTiff(buffer: Buffer): Promise<{
  transform: GeoTransform
  data: Float32Array | Uint8Array | Int8Array | Uint16Array | Int16Array | Float64Array
}> {
  // Ensure clean ArrayBuffer (Buffer may have offset)
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const tiff = await fromArrayBuffer(ab)
  const image = await tiff.getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const rasters = await image.readRasters()
  const data = rasters[0] as any

  // getBoundingBox returns [minX, minY, maxX, maxY]
  // For WGS84: [minLng, minLat, maxLng, maxLat]
  const bbox = image.getBoundingBox()

  const transform: GeoTransform = {
    width,
    height,
    originX: bbox[0],                       // min longitude (left edge)
    originY: bbox[3],                       // max latitude (top edge)
    pixelW: (bbox[2] - bbox[0]) / width,
    pixelH: (bbox[3] - bbox[1]) / height,
  }

  return { transform, data }
}

/** Convert pixel coordinates to geographic (lat/lng) */
function pixelToGeo(col: number, row: number, t: GeoTransform): { lat: number; lng: number } {
  return {
    lng: t.originX + col * t.pixelW,
    lat: t.originY - row * t.pixelH, // lat decreases as row increases
  }
}

/** Convert geographic to local meters relative to an origin */
function geoToLocal(lat: number, lng: number, oLat: number, oLng: number): Pt {
  return {
    x: (lng - oLng) * METERS_PER_DEG * Math.cos(oLat * Math.PI / 180),
    y: (lat - oLat) * METERS_PER_DEG,
  }
}

// ---------------------------------------------------------------------------
// Mask contour extraction → building footprint
// ---------------------------------------------------------------------------

/**
 * Extract building footprint polygon from a binary roof mask GeoTIFF.
 *
 * Strategy: find boundary pixels (mask=on with at least one off-neighbor),
 * sort by angle from centroid to form a polygon, then simplify.
 * This handles convex and star-shaped buildings well, which covers ~90%
 * of residential roofs.
 */
function extractFootprint(
  maskData: any,
  maskTransform: GeoTransform,
  originLat: number,
  originLng: number,
): Pt[] {
  const { width, height } = maskTransform

  // Determine threshold based on data type
  // Mask GeoTIFFs can be float (0.0/1.0) or uint8 (0/255)
  let threshold = 0.5
  if (maskData.length > 0) {
    const maxVal = Math.max(maskData[0], maskData[Math.min(100, maskData.length - 1)])
    if (maxVal > 1) threshold = maxVal / 2 // probably 0-255 range
  }

  // Downsample for performance — every 2nd pixel
  const step = 2
  const boundary: Pt[] = []

  for (let row = 0; row < height; row += step) {
    for (let col = 0; col < width; col += step) {
      const val = maskData[row * width + col]
      if (val <= threshold) continue // not roof

      // Check if boundary pixel (has at least one non-roof neighbor)
      let isBoundary = false
      const neighbors = [[-step, 0], [step, 0], [0, -step], [0, step]]
      for (const [dr, dc] of neighbors) {
        const nr = row + dr
        const nc = col + dc
        if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
          isBoundary = true
          break
        }
        if (maskData[nr * width + nc] <= threshold) {
          isBoundary = true
          break
        }
      }

      if (isBoundary) {
        const geo = pixelToGeo(col, row, maskTransform)
        boundary.push(geoToLocal(geo.lat, geo.lng, originLat, originLng))
      }
    }
  }

  if (boundary.length < 3) return []

  // Sort boundary points by angle from centroid → forms closed polygon
  const cx = boundary.reduce((s, p) => s + p.x, 0) / boundary.length
  const cy = boundary.reduce((s, p) => s + p.y, 0) / boundary.length

  boundary.sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  })

  // Simplify with Douglas-Peucker (0.3m tolerance)
  const simplified = douglasPeucker(boundary, 0.3)

  // Ensure CCW winding
  if (polygonAreaSigned(simplified) < 0) simplified.reverse()

  return simplified
}

// ---------------------------------------------------------------------------
// Douglas-Peucker polyline simplification
// ---------------------------------------------------------------------------

function douglasPeucker(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return [...points]

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToLineDist(points[i], first, last)
    if (d > maxDist) { maxDist = d; maxIdx = i }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

function pointToLineDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.001) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len
}

function polygonAreaSigned(pts: Pt[]): number {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

// ---------------------------------------------------------------------------
// RANSAC multi-plane fitting on DSM elevation data
// ---------------------------------------------------------------------------

/**
 * Fit a plane z = a*x + b*y + c0 through three 3D points.
 * Returns null if points are (nearly) collinear.
 */
function fitPlaneThreePoints(p1: Pt3, p2: Pt3, p3: Pt3): { a: number; b: number; c0: number } | null {
  // Solve the 3x3 system:
  // x1*a + y1*b + c0 = z1
  // x2*a + y2*b + c0 = z2
  // x3*a + y3*b + c0 = z3
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y, dz1 = p2.z - p1.z
  const dx2 = p3.x - p1.x, dy2 = p3.y - p1.y, dz2 = p3.z - p1.z

  const det = dx1 * dy2 - dx2 * dy1
  if (Math.abs(det) < 1e-10) return null // collinear

  const a = (dz1 * dy2 - dz2 * dy1) / det
  const b = (dx1 * dz2 - dx2 * dz1) / det
  const c0 = p1.z - a * p1.x - b * p1.y

  // Reject near-vertical planes (pitch > ~75°)
  const slopeMag = Math.sqrt(a * a + b * b)
  if (slopeMag > 3.7) return null // tan(75°) ≈ 3.73

  return { a, b, c0 }
}

/**
 * Perpendicular distance from a 3D point to plane z = c0 + a*x + b*y.
 * True perpendicular distance, not just vertical offset.
 */
function pointToPlaneDistPerp(pt: Pt3, plane: { a: number; b: number; c0: number }): number {
  const residual = pt.z - (plane.c0 + plane.a * pt.x + plane.b * pt.y)
  // Perpendicular distance = |residual| / sqrt(a² + b² + 1)
  return Math.abs(residual) / Math.sqrt(plane.a * plane.a + plane.b * plane.b + 1)
}

/**
 * Least-squares plane fit on a set of 3D points.
 * Solves the normal equations for z = a*x + b*y + c0.
 */
function leastSquaresPlane(points: Pt3[]): { a: number; b: number; c0: number } | null {
  const n = points.length
  if (n < 3) return null

  // Centroid
  let mx = 0, my = 0, mz = 0
  for (const p of points) { mx += p.x; my += p.y; mz += p.z }
  mx /= n; my /= n; mz /= n

  // Centered sums for 2x2 normal equations
  let sxx = 0, sxy = 0, sxz = 0, syy = 0, syz = 0
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz
    sxx += dx * dx
    sxy += dx * dy
    sxz += dx * dz
    syy += dy * dy
    syz += dy * dz
  }

  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-10) return null

  const a = (syy * sxz - sxy * syz) / det
  const b = (sxx * syz - sxy * sxz) / det
  const c0 = mz - a * mx - b * my

  return { a, b, c0 }
}

/**
 * Multi-plane RANSAC: discover all significant roof planes in the DSM data.
 *
 * Iteratively finds the dominant plane, removes its inliers, and repeats
 * until no more significant planes remain.
 */
function ransacMultiPlane(
  points: Pt3[],
  options: {
    maxPlanes?: number
    iterations?: number
    distanceThreshold?: number  // meters
    minInlierFraction?: number
  } = {},
): DiscoveredPlane[] {
  const {
    maxPlanes = 10,
    iterations = 500,
    distanceThreshold = 0.2,
    minInlierFraction = 0.03,
  } = options

  const minInliers = Math.max(15, Math.floor(points.length * minInlierFraction))
  const planes: DiscoveredPlane[] = []
  let remaining = [...points]

  for (let planeNum = 0; planeNum < maxPlanes; planeNum++) {
    if (remaining.length < minInliers) break

    let bestPlane: { a: number; b: number; c0: number } | null = null
    let bestInlierCount = 0
    let bestInlierMask: boolean[] = []

    for (let iter = 0; iter < iterations; iter++) {
      // Random sample of 3 points
      const n = remaining.length
      const i1 = Math.floor(Math.random() * n)
      let i2 = Math.floor(Math.random() * n)
      let i3 = Math.floor(Math.random() * n)
      while (i2 === i1) i2 = Math.floor(Math.random() * n)
      while (i3 === i1 || i3 === i2) i3 = Math.floor(Math.random() * n)

      const plane = fitPlaneThreePoints(remaining[i1], remaining[i2], remaining[i3])
      if (!plane) continue

      // Count inliers
      const mask: boolean[] = new Array(remaining.length)
      let count = 0
      for (let j = 0; j < remaining.length; j++) {
        const inside = pointToPlaneDistPerp(remaining[j], plane) <= distanceThreshold
        mask[j] = inside
        if (inside) count++
      }

      if (count > bestInlierCount) {
        bestInlierCount = count
        bestPlane = plane
        bestInlierMask = mask
      }
    }

    if (!bestPlane || bestInlierCount < minInliers) break

    // Refine with least-squares on all inliers
    const inlierPts = remaining.filter((_, i) => bestInlierMask[i])
    const refined = leastSquaresPlane(inlierPts) || bestPlane

    // Compute pitch and azimuth from plane coefficients
    // z = c0 + a*x + b*y → surface normal is (-a, -b, 1) (pointing up)
    // Pitch = angle from horizontal = atan(sqrt(a² + b²))
    const slopeMag = Math.sqrt(refined.a * refined.a + refined.b * refined.b)
    const pitchDeg = Math.atan(slopeMag) * 180 / Math.PI

    // Azimuth = direction the surface faces (outward normal projected on horizontal)
    // Horizontal projection of normal (-a, -b) → compass bearing with x=East, y=North
    let azimuthDeg = Math.atan2(-refined.a, -refined.b) * 180 / Math.PI
    azimuthDeg = ((azimuthDeg % 360) + 360) % 360

    // Compute ground area from inlier spread
    // Each inlier pixel represents ~pixelSize² of ground area
    // We'll approximate from the convex hull area of inlier projections
    const groundAreaSqm = estimateGroundArea(inlierPts)

    planes.push({
      a: refined.a,
      b: refined.b,
      c0: refined.c0,
      pitchDeg,
      azimuthDeg,
      inlierCount: bestInlierCount,
      groundAreaSqm,
    })

    // Remove inliers from remaining points
    remaining = remaining.filter((_, i) => !bestInlierMask[i])
  }

  // Sort by ground area descending (largest planes first)
  planes.sort((a, b) => b.groundAreaSqm - a.groundAreaSqm)

  return planes
}

/**
 * Estimate ground area of a set of 3D points using convex hull.
 */
function estimateGroundArea(points: Pt3[]): number {
  if (points.length < 3) return 0
  const pts2d: Pt[] = points.map(p => ({ x: p.x, y: p.y }))
  const hull = convexHull2D(pts2d)
  return Math.abs(polygonAreaSigned(hull))
}

/** Convex hull via Andrew's monotone chain (CCW output) */
function convexHull2D(points: Pt[]): Pt[] {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  const unique: Pt[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].x - sorted[i - 1].x
    const dy = sorted[i].y - sorted[i - 1].y
    if (dx * dx + dy * dy > 0.0001) unique.push(sorted[i])
  }
  if (unique.length < 3) return unique

  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Pt[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

// ---------------------------------------------------------------------------
// Main DSM processing pipeline
// ---------------------------------------------------------------------------

/**
 * Process DSM and mask GeoTIFF buffers to extract roof geometry.
 *
 * @param dsmBuffer  - Raw GeoTIFF buffer from Solar API dataLayers dsmUrl
 * @param maskBuffer - Raw GeoTIFF buffer from Solar API dataLayers maskUrl
 * @param originLat  - Building center latitude (used as coordinate origin)
 * @param originLng  - Building center longitude
 * @returns DsmResult with building footprint and discovered roof planes
 */
export async function processDsm(
  dsmBuffer: Buffer,
  maskBuffer: Buffer,
  originLat: number,
  originLng: number,
): Promise<DsmResult> {
  // 1. Parse GeoTIFFs
  const dsm = await parseGeoTiff(dsmBuffer)
  const mask = await parseGeoTiff(maskBuffer)

  // 2. Extract building footprint from mask
  const footprint = extractFootprint(mask.data, mask.transform, originLat, originLng)
  if (footprint.length < 3) {
    throw new Error('Could not extract building footprint from mask — insufficient boundary pixels')
  }

  // 3. Build 3D point cloud from DSM within mask
  const points = extractRoofPoints(dsm.data, dsm.transform, mask.data, mask.transform, originLat, originLng)
  if (points.length < 10) {
    throw new Error(`Insufficient roof elevation points (${points.length}) — DSM may not cover this building`)
  }

  // 4. RANSAC multi-plane fitting
  const planes = ransacMultiPlane(points, {
    maxPlanes: 10,
    iterations: 500,
    distanceThreshold: 0.2,  // 20cm tolerance
    minInlierFraction: 0.03, // minimum 3% of points per plane
  })

  if (planes.length === 0) {
    throw new Error('RANSAC could not fit any roof planes to the elevation data')
  }

  return { footprint, planes }
}

/**
 * Extract 3D roof points from DSM where the mask indicates roof surface.
 * The DSM and mask may have different resolutions — we use mask pixels as
 * the reference and sample DSM at the corresponding geographic position.
 */
function extractRoofPoints(
  dsmData: any,
  dsmTransform: GeoTransform,
  maskData: any,
  maskTransform: GeoTransform,
  originLat: number,
  originLng: number,
): Pt3[] {
  const { width: mW, height: mH } = maskTransform
  const { width: dW, height: dH } = dsmTransform

  // Determine mask threshold
  let maskThreshold = 0.5
  if (maskData.length > 0) {
    let maxMaskVal = 0
    // Sample a few values to detect range
    for (let i = 0; i < Math.min(1000, maskData.length); i += 10) {
      if (maskData[i] > maxMaskVal) maxMaskVal = maskData[i]
    }
    if (maxMaskVal > 1) maskThreshold = maxMaskVal / 2
  }

  const points: Pt3[] = []

  // Subsample mask at every 2nd pixel for performance
  // At 0.25m/pixel, a 30m building = 120px → ~3600 points (plenty for RANSAC)
  const step = 2

  for (let row = 0; row < mH; row += step) {
    for (let col = 0; col < mW; col += step) {
      if (maskData[row * mW + col] <= maskThreshold) continue

      // Convert mask pixel to geographic coords
      const geo = pixelToGeo(col, row, maskTransform)

      // Find corresponding DSM pixel
      const dsmCol = Math.round((geo.lng - dsmTransform.originX) / dsmTransform.pixelW)
      const dsmRow = Math.round((dsmTransform.originY - geo.lat) / dsmTransform.pixelH)

      if (dsmCol < 0 || dsmCol >= dW || dsmRow < 0 || dsmRow >= dH) continue

      const elevation = dsmData[dsmRow * dW + dsmCol]
      if (elevation === undefined || elevation === null || isNaN(elevation) || elevation <= 0) continue

      const local = geoToLocal(geo.lat, geo.lng, originLat, originLng)
      points.push({ x: local.x, y: local.y, z: elevation })
    }
  }

  return points
}
