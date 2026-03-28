// Roof3DMesh — converts segment polygons + DSM elevation grid into Three.js BufferGeometry.
// Uses earcut triangulation for polygon faces and DSM data for Z values.

import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SegmentData {
  name: string
  pitch: string
  pitchDegrees: number
  azimuthDegrees: number
  area: number
  polygon: Array<{ lat: number; lng: number }>
}

interface DsmGrid {
  data: number[]       // flat elevation array (row-major)
  width: number
  height: number
  originLat: number
  originLng: number
  pixelSizeLat: number
  pixelSizeLng: number
}

const METERS_PER_DEG = 111_319.5

// Segment colors matching the 2D editor
const SEGMENT_COLORS = [
  0x3B82F6, 0x10B981, 0xF59E0B, 0xEF4444,
  0x8B5CF6, 0xEC4899, 0x14B8A6, 0xF97316,
]

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Build Three.js meshes for each roof segment.
 *
 * @param segments - Roof segments with polygon vertices
 * @param dsmGrid - DSM elevation grid (optional, for Z values)
 * @param centerLat - Center latitude (origin for local coords)
 * @param centerLng - Center longitude
 * @param exaggeration - Vertical exaggeration factor (1.0 = real, 3.0 = 3x)
 */
export function buildRoofMeshes(
  segments: SegmentData[],
  dsmGrid: DsmGrid | null,
  centerLat: number,
  centerLng: number,
  exaggeration: number = 2.0,
): THREE.Group {
  const group = new THREE.Group()
  const cosLat = Math.cos(centerLat * Math.PI / 180)

  // Find base elevation for normalization
  let baseElevation = Infinity
  if (dsmGrid) {
    for (let i = 0; i < dsmGrid.data.length; i++) {
      const v = dsmGrid.data[i]
      if (v > 0 && v < baseElevation) baseElevation = v
    }
  }
  if (baseElevation === Infinity) baseElevation = 0

  segments.forEach((seg, idx) => {
    if (!seg.polygon || seg.polygon.length < 3) return

    const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length]

    // Convert polygon vertices to local meters
    const localVerts = seg.polygon.map(p => ({
      x: (p.lng - centerLng) * METERS_PER_DEG * cosLat,
      y: (p.lat - centerLat) * METERS_PER_DEG,
      z: sampleElevation(p.lat, p.lng, dsmGrid, baseElevation) * exaggeration,
    }))

    // Build geometry using earcut triangulation
    const geometry = triangulatePolygon(localVerts)
    if (!geometry) return

    // Front face (colored)
    const material = new THREE.MeshPhongMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      flatShading: false,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = seg.name
    mesh.userData = { pitch: seg.pitch, area: seg.area, index: idx }
    group.add(mesh)

    // Wireframe outline
    const wireGeo = new THREE.EdgesGeometry(geometry)
    const wireMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1, transparent: true, opacity: 0.5 })
    const wire = new THREE.LineSegments(wireGeo, wireMat)
    group.add(wire)
  })

  return group
}

/**
 * Build a ground plane mesh from the DSM elevation grid.
 */
export function buildDsmHeightmap(
  dsmGrid: DsmGrid,
  centerLat: number,
  centerLng: number,
  exaggeration: number = 2.0,
): THREE.Mesh | null {
  const { data, width, height, originLat, originLng, pixelSizeLat, pixelSizeLng } = dsmGrid
  if (width < 2 || height < 2) return null

  const cosLat = Math.cos(centerLat * Math.PI / 180)

  // Find base elevation
  let baseElev = Infinity
  for (let i = 0; i < data.length; i++) {
    if (data[i] > 0 && data[i] < baseElev) baseElev = data[i]
  }
  if (baseElev === Infinity) baseElev = 0

  // Build PlaneGeometry and deform vertices
  const gridW = Math.abs(width * pixelSizeLng) * METERS_PER_DEG * cosLat
  const gridH = Math.abs(height * pixelSizeLat) * METERS_PER_DEG

  const geometry = new THREE.PlaneGeometry(gridW, gridH, width - 1, height - 1)
  const positions = geometry.attributes.position.array as Float32Array

  // Offset to center on our coordinate system
  const offsetX = (originLng + width * pixelSizeLng / 2 - centerLng) * METERS_PER_DEG * cosLat
  const offsetY = (originLat + height * pixelSizeLat / 2 - centerLat) * METERS_PER_DEG

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const vertIdx = row * width + col
      const z = data[vertIdx]
      const elevation = (z > 0 ? z - baseElev : 0) * exaggeration

      // PlaneGeometry lays out vertices in X-Y plane, we set Z for height
      const posIdx = vertIdx * 3
      positions[posIdx] += offsetX     // x
      positions[posIdx + 1] += offsetY // y
      positions[posIdx + 2] = elevation // z (was 0 in flat plane)
    }
  }

  geometry.attributes.position.needsUpdate = true
  geometry.computeVertexNormals()

  const material = new THREE.MeshPhongMaterial({
    color: 0x888888,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3,
    wireframe: false,
  })

  return new THREE.Mesh(geometry, material)
}

// ---------------------------------------------------------------------------
// Edge lines in 3D
// ---------------------------------------------------------------------------

export function buildEdgeLines(
  edges: Array<{
    type: string
    startLat: number; startLng: number
    endLat: number; endLng: number
    lengthFt: number
  }>,
  dsmGrid: DsmGrid | null,
  centerLat: number,
  centerLng: number,
  exaggeration: number = 2.0,
): THREE.Group {
  const group = new THREE.Group()
  const cosLat = Math.cos(centerLat * Math.PI / 180)

  const EDGE_COLORS: Record<string, number> = {
    ridge: 0xE53E3E, valley: 0x3182CE, hip: 0x38A169,
    rake: 0xDD6B20, eave: 0x805AD5,
  }

  let baseElev = 0
  if (dsmGrid) {
    baseElev = Infinity
    for (let i = 0; i < dsmGrid.data.length; i++) {
      if (dsmGrid.data[i] > 0 && dsmGrid.data[i] < baseElev) baseElev = dsmGrid.data[i]
    }
    if (baseElev === Infinity) baseElev = 0
  }

  for (const edge of edges) {
    const x1 = (edge.startLng - centerLng) * METERS_PER_DEG * cosLat
    const y1 = (edge.startLat - centerLat) * METERS_PER_DEG
    const z1 = sampleElevation(edge.startLat, edge.startLng, dsmGrid, baseElev) * exaggeration

    const x2 = (edge.endLng - centerLng) * METERS_PER_DEG * cosLat
    const y2 = (edge.endLat - centerLat) * METERS_PER_DEG
    const z2 = sampleElevation(edge.endLat, edge.endLng, dsmGrid, baseElev) * exaggeration

    const points = [new THREE.Vector3(x1, y1, z1 + 0.1), new THREE.Vector3(x2, y2, z2 + 0.1)]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({
      color: EDGE_COLORS[edge.type] || 0xffffff,
      linewidth: 2,
    })
    group.add(new THREE.Line(geo, mat))
  }

  return group
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleElevation(
  lat: number,
  lng: number,
  grid: DsmGrid | null,
  baseElevation: number,
): number {
  if (!grid) return 0

  // Convert lat/lng to grid pixel coordinates
  const col = Math.round((lng - grid.originLng) / grid.pixelSizeLng)
  const row = Math.round((lat - grid.originLat) / grid.pixelSizeLat)

  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return 0

  const z = grid.data[row * grid.width + col]
  return z > 0 ? z - baseElevation : 0
}

/**
 * Triangulate a 3D polygon using earcut algorithm.
 * Projects to 2D (X,Y) for triangulation, keeps Z from vertices.
 */
function triangulatePolygon(
  vertices: Array<{ x: number; y: number; z: number }>,
): THREE.BufferGeometry | null {
  if (vertices.length < 3) return null

  // Flatten for earcut (2D projection)
  const flatCoords: number[] = []
  for (const v of vertices) {
    flatCoords.push(v.x, v.y)
  }

  // Earcut triangulation
  const indices = earcut(flatCoords)
  if (indices.length === 0) return null

  // Build BufferGeometry with 3D positions
  const positions = new Float32Array(vertices.length * 3)
  for (let i = 0; i < vertices.length; i++) {
    positions[i * 3] = vertices[i].x
    positions[i * 3 + 1] = vertices[i].y
    positions[i * 3 + 2] = vertices[i].z
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  return geometry
}

// ---------------------------------------------------------------------------
// Earcut triangulation (minimal implementation)
// ---------------------------------------------------------------------------

function earcut(data: number[], holeIndices?: number[], dim: number = 2): number[] {
  const hasHoles = holeIndices && holeIndices.length
  const outerLen = hasHoles ? holeIndices[0] * dim : data.length
  let outerNode = linkedList(data, 0, outerLen, dim, true)

  const triangles: number[] = []
  if (!outerNode || outerNode.next === outerNode.prev) return triangles

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let invSize = 0

  // Simple ear clipping
  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0)

  return triangles
}

interface EarcutNode {
  i: number  // vertex index
  x: number
  y: number
  prev: EarcutNode
  next: EarcutNode
  z: number
  prevZ: EarcutNode | null
  nextZ: EarcutNode | null
  steiner: boolean
}

function linkedList(data: number[], start: number, end: number, dim: number, clockwise: boolean): EarcutNode | null {
  let last: EarcutNode | null = null

  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last)
  } else {
    for (let i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last)
  }

  if (last && equals(last, last.next!)) {
    removeNode(last)
    last = last.next!
  }

  if (!last) return null
  last.next!.prev = last  // already circular from insertNode

  return last.next! // return first node
}

function earcutLinked(ear: EarcutNode | null, triangles: number[], dim: number, minX: number, minY: number, invSize: number, pass: number) {
  if (!ear) return

  let stop = ear
  while (ear!.prev !== ear!.next) {
    const prev = ear!.prev
    const next = ear!.next

    if (isEar(ear!)) {
      triangles.push(prev.i / dim | 0)
      triangles.push(ear!.i / dim | 0)
      triangles.push(next.i / dim | 0)
      removeNode(ear!)
      ear = next.next
      stop = next.next
      continue
    }

    ear = next

    if (ear === stop) {
      // If nothing was removed, try filtering collinear points
      break
    }
  }
}

function isEar(ear: EarcutNode): boolean {
  const a = ear.prev, b = ear, c = ear.next

  if (area(a, b, c) >= 0) return false // reflex

  let p = ear.next.next
  while (p !== ear.prev) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
        area(p.prev, p, p.next) >= 0) return false
    p = p.next
  }
  return true
}

function insertNode(i: number, x: number, y: number, last: EarcutNode | null): EarcutNode {
  const p: EarcutNode = {
    i, x, y,
    prev: null as any, next: null as any,
    z: 0, prevZ: null, nextZ: null, steiner: false,
  }

  if (!last) {
    p.prev = p
    p.next = p
  } else {
    p.next = last.next
    p.prev = last
    last.next.prev = p
    last.next = p
  }
  return p
}

function removeNode(p: EarcutNode) {
  p.next.prev = p.prev
  p.prev.next = p.next
}

function area(p: EarcutNode, q: EarcutNode, r: EarcutNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
}

function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
         (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
         (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0
}

function signedArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1])
    j = i
  }
  return sum
}

function equals(p1: EarcutNode, p2: EarcutNode): boolean {
  return p1.x === p2.x && p1.y === p2.y
}
