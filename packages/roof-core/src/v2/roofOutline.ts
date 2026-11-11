// Roof engine v2: the roof's OUTLINE as a shape a person can look at and correct — for the instant estimator, where the
// homeowner sees their roof outlined on the aerial picture and can drag a corner, or tap the right building when the
// address pin landed on the wrong one (as Zuper's estimator lets a homeowner "adjust the outline").
//
//   · roofOutlines — every roof in the picture as a simple polygon (a few dozen corners, not a pixel staircase), the
//     measured one marked; and a coarse map of how much longer the roof is on the slope than on the flat, so a
//     corrected outline can be turned into roof area without the height map being kept or asked for again.
//   · outlineArea — the roof area inside a (corrected) outline, from that map.
//
// Used by the roofing CRM's instant estimator (apps/unified/server/crm/roof/reports/estimator.ts).
import { readRaster, patchSlopes, type Raster } from './roofSurface.ts'
import type { RoofFaces } from './roofFaces.ts'

const SQM_TO_SQFT = 10.7639

/** A corner in picture pixels: x to the right, y down, from the picture's top-left. */
export type OutlinePoint = [number, number]

export interface RoofOutline {
  points: OutlinePoint[]
  /** True for the roof that was measured (the one under the address pin, or nearest it). */
  chosen: boolean
}

/** How much longer the roof is on the slope than on the flat, on a coarse grid over the picture. */
export interface SlopeMap {
  /** The picture's size in pixels, and metres per pixel. */
  width: number
  height: number
  px: number
  /** Picture pixels per grid cell. */
  cell: number
  cols: number
  rows: number
  /** Base64 of cols×rows bytes: (slope factor − 1) × 200, 255 = no roof read there. */
  data: string
  /** The measured roof's own overall factor: what a spot with no reading is taken to be. */
  overall: number
}

export interface RoofOutlines { outlines: RoofOutline[]; slope: SlopeMap }

/** The outer boundary of one blob of pixels (`inside`), as the corners of its pixel staircase, clockwise. */
function traceBoundary(inside: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): OutlinePoint[] {
  // Every pixel edge with the blob on one side and not on the other, pointing so the blob is on its right.
  const from = new Map<number, Array<[number, number, number, number]>>()
  const W = x1 - x0 + 3
  const key = (x: number, y: number) => (y - y0 + 1) * W + (x - x0 + 1)
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay)
    const list = from.get(k)
    if (list) list.push([ax, ay, bx, by]); else from.set(k, [[ax, ay, bx, by]])
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue
      if (!inside(x, y - 1)) add(x, y, x + 1, y)
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!inside(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  // Follow each loop; where two edges leave a corner (pixels touching at a point), turn right — stay with the blob.
  const used = new Set<[number, number, number, number]>()
  let best: OutlinePoint[] = [], bestArea = 0
  for (const list of from.values()) {
    for (const start of list) {
      if (used.has(start)) continue
      const loop: OutlinePoint[] = []
      let e = start
      for (let guard = 0; guard < 400000; guard++) {
        used.add(e)
        loop.push([e[0], e[1]])
        const next = (from.get(key(e[2], e[3])) || []).filter((c) => !used.has(c))
        if (!next.length) break
        const dx = e[2] - e[0], dy = e[3] - e[1]
        // In picture coordinates (y down) a right turn has a positive cross product.
        next.sort((a, b) => (dx * (b[3] - b[1]) - dy * (b[2] - b[0])) - (dx * (a[3] - a[1]) - dy * (a[2] - a[0])))
        e = next[0]
      }
      const area = Math.abs(shoelace(loop))
      if (area > bestArea) { bestArea = area; best = loop }
    }
  }
  return best
}

function shoelace(p: OutlinePoint[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1] }
  return s / 2
}

/** Douglas–Peucker on a closed loop: drop corners that sit within `tol` pixels of the line between their neighbours. */
function simplify(loop: OutlinePoint[], tol: number): OutlinePoint[] {
  if (loop.length < 8) return loop
  // Split the loop at its two farthest-apart corners (roughly), simplify each half as an open line.
  let a = 0, b = 0, far = -1
  for (let i = 0; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > far) { far = d; a = i } }
  far = -1
  for (let i = 0; i < loop.length; i++) { const d = (loop[i][0] - loop[a][0]) ** 2 + (loop[i][1] - loop[a][1]) ** 2; if (d > far) { far = d; b = i } }
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const open = (pts: OutlinePoint[]): OutlinePoint[] => {
    const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1
    const stack: Array<[number, number]> = [[0, pts.length - 1]]
    while (stack.length) {
      const [s, e] = stack.pop()!
      const ax = pts[s][0], ay = pts[s][1], bx = pts[e][0], by = pts[e][1]
      const len = Math.hypot(bx - ax, by - ay) || 1
      let worst = -1, at = -1
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / len
        if (d > worst) { worst = d; at = i }
      }
      if (worst > tol) { keep[at] = 1; stack.push([s, at], [at, e]) }
    }
    return pts.filter((_, i) => keep[i])
  }
  const first = open(loop.slice(lo, hi + 1))
  const second = open([...loop.slice(hi), ...loop.slice(0, lo + 1)])
  return [...first.slice(0, -1), ...second.slice(0, -1)]
}

export interface OutlineOptions {
  /** A blob smaller than this (m²) is a shed or a speck, not a roof someone would mean. */
  minRoofSqm?: number
  /** At most this many roofs, nearest the pin first. */
  maxRoofs?: number
  /** At most this many corners on one outline. */
  maxCorners?: number
  /** The slope map's cell, metres. */
  cellM?: number
}

/**
 * Every roof in the picture as a simple outline, and the slope map. `faces` is the measurement (measureRoofFaces) when
 * there is one: its roof — with the corners filled in under trees — is the chosen outline.
 */
export async function roofOutlines(dsmBuffer: Buffer, maskBuffer: Buffer, faces: RoofFaces | null, o: OutlineOptions = {}): Promise<RoofOutlines> {
  const { minRoofSqm = 16, maxRoofs = 12, maxCorners = 40, cellM = 1 } = o
  const [dsm, mask] = await Promise.all([readRaster(dsmBuffer), readRaster(maskBuffer)])
  const w = mask.width, h = mask.height, px = mask.px, n = w * h

  // Roof pixels: Google's mask, plus what the measurement filled in under trees.
  const roof = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (mask.data[i] > 0 || (faces && faces.hidden[i])) roof[i] = 1
  const chosenAt = (i: number) => !!faces && (faces.labels[i] !== -1 || faces.hidden[i] === 1)

  // Connected blobs.
  const label = new Int32Array(n).fill(-1)
  const blobs: Array<{ pixels: number; x0: number; y0: number; x1: number; y1: number; chosen: number; near: number }> = []
  const stack: number[] = []
  const cx = (w - 1) / 2, cy = (h - 1) / 2
  for (let s = 0; s < n; s++) {
    if (!roof[s] || label[s] !== -1) continue
    const id = blobs.length
    const b = { pixels: 0, x0: w, y0: h, x1: 0, y1: 0, chosen: 0, near: Infinity }
    label[s] = id; stack.length = 0; stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w, y = (i / w) | 0
      b.pixels++
      if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y
      if (chosenAt(i)) b.chosen++
      const d = (x - cx) ** 2 + (y - cy) ** 2
      if (d < b.near) b.near = d
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || !roof[j] || label[j] !== -1) continue
        label[j] = id; stack.push(j)
      }
    }
    blobs.push(b)
  }
  const minPixels = minRoofSqm / (px * px)
  let chosenId = -1, most = 0
  blobs.forEach((b, id) => { if (b.chosen > most) { most = b.chosen; chosenId = id } })
  const order = blobs.map((b, id) => ({ b, id })).filter(({ b, id }) => id === chosenId || b.pixels >= minPixels)
    .sort((p, q) => (p.id === chosenId ? -1 : q.id === chosenId ? 1 : p.b.near - q.b.near)).slice(0, maxRoofs)

  const outlines: RoofOutline[] = order.map(({ b, id }) => {
    const loop = traceBoundary((x, y) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id, b.x0, b.y0, b.x1, b.y1)
    let tol = 0.4 / px, points = simplify(loop, tol)
    while (points.length > maxCorners && tol < 20) { tol *= 1.4; points = simplify(loop, tol) }
    return { points, chosen: id === chosenId }
  }).filter((r) => r.points.length >= 3)

  // The slope map: per cell, the mean slope factor of the roof pixels in it that gave a trustworthy slope.
  const { slopeX, slopeY } = patchSlopes(dsm as Raster, roof, 0.75, 0.06)
  const cell = Math.max(1, Math.round(cellM / px))
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell)
  const sum = new Float64Array(cols * rows), cnt = new Uint32Array(cols * rows)
  let chosenSum = 0, chosenCnt = 0
  for (let i = 0; i < n; i++) {
    if (!roof[i] || Number.isNaN(slopeX[i])) continue
    const s = Math.hypot(slopeX[i], slopeY[i])
    if (s > 2) continue
    const f = Math.sqrt(1 + s * s)
    const k = (((i / w) | 0) / cell | 0) * cols + ((i % w) / cell | 0)
    sum[k] += f; cnt[k]++
    if (chosenAt(i)) { chosenSum += f; chosenCnt++ }
  }
  const bytes = new Uint8Array(cols * rows)
  let allSum = 0, allCnt = 0
  for (let k = 0; k < bytes.length; k++) {
    if (!cnt[k]) { bytes[k] = 255; continue }
    const f = sum[k] / cnt[k]
    allSum += f; allCnt++
    bytes[k] = Math.max(0, Math.min(254, Math.round((f - 1) * 200)))
  }
  const measured = faces && faces.planSqft > 0 ? faces.slopeSqft / (faces.planSqft + faces.hiddenPlanSqft) : 0
  const overall = measured > 1 ? measured : chosenCnt ? chosenSum / chosenCnt : allCnt ? allSum / allCnt : 1.08
  return {
    outlines,
    slope: { width: w, height: h, px, cell, cols, rows, data: Buffer.from(bytes).toString('base64'), overall: Math.round(overall * 10000) / 10000 },
  }
}

function insidePolygon(x: number, y: number, p: OutlinePoint[]): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Why an outline cannot be measured, or null. */
export function outlineProblem(points: unknown, slope: Pick<SlopeMap, 'width' | 'height'>): string | null {
  if (!Array.isArray(points) || points.length < 3 || points.length > 80) return 'The outline needs between 3 and 80 corners.'
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'The outline is not a list of corners.'
    if (p[0] < 0 || p[1] < 0 || p[0] > slope.width || p[1] > slope.height) return 'The outline runs off the picture.'
  }
  return null
}

/** The roof inside an outline: its flat area, and its area on the slope from the slope map. */
export function outlineArea(points: OutlinePoint[], slope: SlopeMap): { planSqft: number; slopeSqft: number; squares: number } {
  const planSqm = Math.abs(shoelace(points)) * slope.px * slope.px
  const bytes = Buffer.from(slope.data, 'base64')
  let sum = 0, cnt = 0, cells = 0
  for (let r = 0; r < slope.rows; r++) {
    for (let c = 0; c < slope.cols; c++) {
      if (!insidePolygon((c + 0.5) * slope.cell, (r + 0.5) * slope.cell, points)) continue
      cells++
      const v = bytes[r * slope.cols + c]
      if (v === 255) continue
      sum += 1 + v / 200; cnt++
    }
  }
  // Cells with no reading (under a tree, or ground the outline was drawn over) take the read cells' mean — and the
  // measured roof's own factor when too little inside the outline was read to trust.
  const factor = cells > 0 && cnt >= Math.max(4, cells * 0.25) ? sum / cnt : slope.overall
  const slopeSqft = Math.round(planSqm * factor * SQM_TO_SQFT)
  return { planSqft: Math.round(planSqm * SQM_TO_SQFT), slopeSqft, squares: slopeSqft / 100 }
}
