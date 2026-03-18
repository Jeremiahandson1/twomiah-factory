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
  originX: number   // top-left X (longitude for WGS84, or easting for projected)
  originY: number   // top-left Y (latitude for WGS84, or northing for projected)
  pixelW: number    // pixel width (degrees or meters)
  pixelH: number    // pixel height (degrees or meters)
  isProjected: boolean  // true if coordinates are in meters (projected CRS)
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
  segmentPolygons: Pt[][]   // per-plane segment polygons (convex hull of best-fit region)
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
  // For projected CRS (UTM etc): [minEasting, minNorthing, maxEasting, maxNorthing]
  const bbox = image.getBoundingBox()

  // Detect if projected CRS: if bbox values are > 360, it's meters not degrees
  const isProjected = Math.abs(bbox[0]) > 360 || Math.abs(bbox[1]) > 360 ||
                      Math.abs(bbox[2]) > 360 || Math.abs(bbox[3]) > 360

  const transform: GeoTransform = {
    width,
    height,
    originX: bbox[0],
    originY: bbox[3],
    pixelW: (bbox[2] - bbox[0]) / width,
    pixelH: (bbox[3] - bbox[1]) / height,
    isProjected,
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

/**
 * Convert pixel coordinates to local meters, handling both geographic (degrees)
 * and projected (meters) coordinate systems.
 */
function pixelToLocal(
  col: number, row: number,
  t: GeoTransform,
  originLat: number, originLng: number,
): Pt {
  if (t.isProjected) {
    // Coordinates are already in meters — compute origin in projected space
    // The origin (building center) in projected coords is approximately at the tile center
    // We use the tile center as the projected origin reference
    const projX = t.originX + col * t.pixelW
    const projY = t.originY - row * t.pixelH
    // Projected origin: center of the tile (since Solar API centers on the building)
    const projOriginX = t.originX + (t.width / 2) * t.pixelW
    const projOriginY = t.originY - (t.height / 2) * t.pixelH
    return {
      x: projX - projOriginX,
      y: projY - projOriginY,
    }
  } else {
    const geo = pixelToGeo(col, row, t)
    return geoToLocal(geo.lat, geo.lng, originLat, originLng)
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
    let maxMaskVal = 0
    for (let i = 0; i < Math.min(1000, maskData.length); i += 10) {
      if (maskData[i] > maxMaskVal) maxMaskVal = maskData[i]
    }
    if (maxMaskVal > 1) threshold = maxMaskVal / 2
  }

  // ---------------------------------------------------------------------------
  // Connected-component labeling on mask to isolate individual buildings
  // Uses union-find on downsampled grid for performance
  // ---------------------------------------------------------------------------
  const step = 2
  const cols = Math.ceil(width / step)
  const rows = Math.ceil(height / step)
  const labels = new Int32Array(rows * cols).fill(-1)
  const parent: number[] = []

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  let nextLabel = 0

  // First pass: assign labels
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pr = r * step, pc = c * step
      if (pr >= height || pc >= width) continue
      if (maskData[pr * width + pc] <= threshold) continue

      const idx = r * cols + c
      const above = r > 0 && labels[(r - 1) * cols + c] >= 0 ? (r - 1) * cols + c : -1
      const left = c > 0 && labels[r * cols + (c - 1)] >= 0 ? r * cols + (c - 1) : -1

      if (above >= 0 && left >= 0) {
        labels[idx] = labels[above]
        union(labels[above], labels[left])
      } else if (above >= 0) {
        labels[idx] = labels[above]
      } else if (left >= 0) {
        labels[idx] = labels[left]
      } else {
        labels[idx] = nextLabel
        parent.push(nextLabel)
        nextLabel++
      }
    }
  }

  // Second pass: flatten labels and collect clusters
  const clusters = new Map<number, { pixels: Array<{ r: number; c: number }>; geoPoints: Pt[] }>()

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      if (labels[idx] < 0) continue
      const root = find(labels[idx])
      labels[idx] = root

      if (!clusters.has(root)) clusters.set(root, { pixels: [], geoPoints: [] })
      clusters.get(root)!.pixels.push({ r, c })
    }
  }

  // Find the cluster closest to origin (0,0) in local meters = target building
  let bestCluster: { pixels: Array<{ r: number; c: number }> } | null = null
  let bestDist = Infinity

  for (const cluster of clusters.values()) {
    if (cluster.pixels.length < 5) continue // skip tiny noise clusters

    // Compute centroid in local meters
    let cx = 0, cy = 0
    for (const { r, c } of cluster.pixels) {
      const local = pixelToLocal(c * step, r * step, maskTransform, originLat, originLng)
      cx += local.x
      cy += local.y
    }
    cx /= cluster.pixels.length
    cy /= cluster.pixels.length

    const d = cx * cx + cy * cy // distance² to origin
    if (d < bestDist) {
      bestDist = d
      bestCluster = cluster
    }
  }

  if (!bestCluster || bestCluster.pixels.length < 3) return []

  // ---------------------------------------------------------------------------
  // Extract boundary pixels from the target building cluster only
  // ---------------------------------------------------------------------------
  const clusterSet = new Set<string>()
  for (const { r, c } of bestCluster.pixels) {
    clusterSet.add(`${r},${c}`)
  }

  const boundary: Pt[] = []
  for (const { r, c } of bestCluster.pixels) {
    // Check if boundary pixel (has at least one non-cluster neighbor)
    let isBoundary = false
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (!clusterSet.has(`${r + dr},${c + dc}`)) {
        isBoundary = true
        break
      }
    }

    if (isBoundary) {
      boundary.push(pixelToLocal(c * step, r * step, maskTransform, originLat, originLng))
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

  // Filter out artifact planes:
  // - Pitch > 55° is unrealistic for a roof (steeper than 17/12)
  // - Very few inliers relative to the largest plane suggest noise/chimney/wall
  const maxReasonablePitch = 55
  const minInlierRatio = 0.08 // plane must have >= 8% of largest plane's inliers
  const largestInliers = planes.length > 0 ? planes[0].inlierCount : 0

  const filtered = planes.filter(p => {
    if (p.pitchDeg > maxReasonablePitch) {
      console.log(`[DSM] Filtered out plane: pitch=${p.pitchDeg.toFixed(1)}° (>${maxReasonablePitch}°) azimuth=${p.azimuthDeg.toFixed(1)}° inliers=${p.inlierCount}`)
      return false
    }
    if (largestInliers > 0 && p.inlierCount < largestInliers * minInlierRatio) {
      console.log(`[DSM] Filtered out plane: inliers=${p.inlierCount} (<${Math.ceil(largestInliers * minInlierRatio)} min) pitch=${p.pitchDeg.toFixed(1)}°`)
      return false
    }
    return true
  })

  // Diagnostic: log surviving planes
  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i]
    console.log(`[DSM] Plane ${i}: a=${p.a.toFixed(4)} b=${p.b.toFixed(4)} c0=${p.c0.toFixed(2)} pitch=${p.pitchDeg.toFixed(1)}° azimuth=${p.azimuthDeg.toFixed(1)}° inliers=${p.inlierCount} area=${p.groundAreaSqm.toFixed(1)}m²`)
  }

  return filtered
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

  console.log('[DSM] Mask GeoTIFF:', {
    width: mask.transform.width, height: mask.transform.height,
    bbox: [mask.transform.originX, mask.transform.originY],
    pixelW: mask.transform.pixelW, pixelH: mask.transform.pixelH,
    isProjected: mask.transform.isProjected,
  })
  console.log('[DSM] DSM GeoTIFF:', {
    width: dsm.transform.width, height: dsm.transform.height,
    bbox: [dsm.transform.originX, dsm.transform.originY],
    pixelW: dsm.transform.pixelW, pixelH: dsm.transform.pixelH,
    isProjected: dsm.transform.isProjected,
  })

  // 2. Extract building footprint from mask
  const footprint = extractFootprint(mask.data, mask.transform, originLat, originLng)
  if (footprint.length < 3) {
    throw new Error('Could not extract building footprint from mask — insufficient boundary pixels')
  }

  const footprintAreaSqm = Math.abs(polygonAreaSigned(footprint))
  const fpMinX = Math.min(...footprint.map(p => p.x))
  const fpMaxX = Math.max(...footprint.map(p => p.x))
  const fpMinY = Math.min(...footprint.map(p => p.y))
  const fpMaxY = Math.max(...footprint.map(p => p.y))
  console.log('[DSM] Footprint:', {
    vertices: footprint.length,
    areaSqm: footprintAreaSqm.toFixed(1),
    boundsX: [fpMinX.toFixed(2), fpMaxX.toFixed(2)],
    boundsY: [fpMinY.toFixed(2), fpMaxY.toFixed(2)],
  })

  // 3. Build 3D point cloud from DSM within target building footprint only
  const points = extractRoofPoints(dsm.data, dsm.transform, mask.data, mask.transform, originLat, originLng, footprint)
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

  // 5. Build segment polygons by assigning each footprint point to the
  //    plane whose predicted z is closest to the actual DSM elevation.
  //    This replaces "highest plane wins" which fails for hip roofs
  //    (hip planes are the lowest at their own location, so they never win).
  const segmentPolygons = buildSegmentPolygons(
    planes, footprint,
    dsm.data, dsm.transform,
    mask.data, mask.transform,
    originLat, originLng,
  )

  return { footprint, planes, segmentPolygons }
}

/**
 * Build segment polygons by assigning each footprint point to the best-fitting
 * RANSAC plane based on actual DSM elevation data.
 *
 * For each masked pixel inside the footprint, we compare the actual DSM elevation
 * to each plane's predicted elevation and assign the pixel to the closest plane.
 * Then we take the convex hull of each plane's assigned points.
 *
 * This correctly handles hip roofs where "highest plane wins" fails because
 * opposite-facing planes extrapolate to unrealistic heights at the far end.
 */
function buildSegmentPolygons(
  planes: DiscoveredPlane[],
  footprint: Pt[],
  dsmData: any,
  dsmTransform: GeoTransform,
  maskData: any,
  maskTransform: GeoTransform,
  originLat: number,
  originLng: number,
): Pt[][] {
  const { width: mW, height: mH } = maskTransform
  const { width: dW, height: dH } = dsmTransform

  // Determine mask threshold
  let maskThreshold = 0.5
  if (maskData.length > 0) {
    let maxMaskVal = 0
    for (let i = 0; i < Math.min(1000, maskData.length); i += 10) {
      if (maskData[i] > maxMaskVal) maxMaskVal = maskData[i]
    }
    if (maxMaskVal > 1) maskThreshold = maxMaskVal / 2
  }

  // Precompute footprint bounding box
  let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity
  for (const p of footprint) {
    if (p.x < fMinX) fMinX = p.x
    if (p.x > fMaxX) fMaxX = p.x
    if (p.y < fMinY) fMinY = p.y
    if (p.y > fMaxY) fMaxY = p.y
  }
  fMinX -= 1; fMaxX += 1; fMinY -= 1; fMaxY += 1

  // Collect points assigned to each plane
  const planePoints: Pt[][] = planes.map(() => [])
  const step = 2

  for (let row = 0; row < mH; row += step) {
    for (let col = 0; col < mW; col += step) {
      if (maskData[row * mW + col] <= maskThreshold) continue

      const local = pixelToLocal(col, row, maskTransform, originLat, originLng)

      // Quick bounding box rejection
      if (local.x < fMinX || local.x > fMaxX || local.y < fMinY || local.y > fMaxY) continue

      // Point-in-polygon test
      if (!pointInPolygon(local, footprint)) continue

      // Find DSM elevation at this point
      const maskGeo = pixelToGeo(col, row, maskTransform)
      const dsmCol = Math.round((maskGeo.lng - dsmTransform.originX) / dsmTransform.pixelW)
      const dsmRow = Math.round((dsmTransform.originY - maskGeo.lat) / dsmTransform.pixelH)
      if (dsmCol < 0 || dsmCol >= dW || dsmRow < 0 || dsmRow >= dH) continue

      const elevation = dsmData[dsmRow * dW + dsmCol]
      if (!elevation || isNaN(elevation) || elevation <= 0) continue

      // Assign to plane with smallest elevation residual
      let bestPlane = 0
      let bestResidual = Infinity
      for (let p = 0; p < planes.length; p++) {
        const predicted = planes[p].c0 + planes[p].a * local.x + planes[p].b * local.y
        const residual = Math.abs(elevation - predicted)
        if (residual < bestResidual) {
          bestResidual = residual
          bestPlane = p
        }
      }

      planePoints[bestPlane].push(local)
    }
  }

  // Build convex hull for each plane's assigned region
  const result: Pt[][] = planePoints.map((pts, i) => {
    if (pts.length < 3) return []
    const hull = convexHull2D(pts)
    if (hull.length < 3) return []
    // Ensure CCW winding
    if (polygonAreaSigned(hull) < 0) hull.reverse()
    const area = Math.abs(polygonAreaSigned(hull))
    console.log(`[DSM] Segment polygon ${i}: ${hull.length} vertices, ${pts.length} points, area=${area.toFixed(1)}m², azimuth=${planes[i].azimuthDeg.toFixed(0)}°`)
    return hull
  })

  return result
}

/**
 * Extract 3D roof points from DSM within the target building's footprint.
 * Only includes points that fall inside the footprint polygon to exclude
 * neighboring buildings from the elevation data.
 */
function extractRoofPoints(
  dsmData: any,
  dsmTransform: GeoTransform,
  maskData: any,
  maskTransform: GeoTransform,
  originLat: number,
  originLng: number,
  footprint: Pt[],
): Pt3[] {
  const { width: mW, height: mH } = maskTransform
  const { width: dW, height: dH } = dsmTransform

  // Determine mask threshold
  let maskThreshold = 0.5
  if (maskData.length > 0) {
    let maxMaskVal = 0
    for (let i = 0; i < Math.min(1000, maskData.length); i += 10) {
      if (maskData[i] > maxMaskVal) maxMaskVal = maskData[i]
    }
    if (maxMaskVal > 1) maskThreshold = maxMaskVal / 2
  }

  // Precompute footprint bounding box for quick rejection
  let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity
  for (const p of footprint) {
    if (p.x < fMinX) fMinX = p.x
    if (p.x > fMaxX) fMaxX = p.x
    if (p.y < fMinY) fMinY = p.y
    if (p.y > fMaxY) fMaxY = p.y
  }
  // Add small buffer (1m) for edge points
  fMinX -= 1; fMaxX += 1; fMinY -= 1; fMaxY += 1

  const points: Pt3[] = []
  const step = 2

  for (let row = 0; row < mH; row += step) {
    for (let col = 0; col < mW; col += step) {
      if (maskData[row * mW + col] <= maskThreshold) continue

      const local = pixelToLocal(col, row, maskTransform, originLat, originLng)

      // Quick bounding box rejection
      if (local.x < fMinX || local.x > fMaxX || local.y < fMinY || local.y > fMaxY) continue

      // Point-in-polygon test against target building footprint
      if (!pointInPolygon(local, footprint)) continue

      // Find corresponding DSM pixel using raw pixel coordinate mapping
      const maskGeo = pixelToGeo(col, row, maskTransform)
      const dsmCol = Math.round((maskGeo.lng - dsmTransform.originX) / dsmTransform.pixelW)
      const dsmRow = Math.round((dsmTransform.originY - maskGeo.lat) / dsmTransform.pixelH)

      if (dsmCol < 0 || dsmCol >= dW || dsmRow < 0 || dsmRow >= dH) continue

      const elevation = dsmData[dsmRow * dW + dsmCol]
      if (elevation === undefined || elevation === null || isNaN(elevation) || elevation <= 0) continue

      points.push({ x: local.x, y: local.y, z: elevation })
    }
  }

  return points
}

/** Ray-casting point-in-polygon test */
function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y, yj = polygon[j].y
    const xi = polygon[i].x, xj = polygon[j].x
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}
