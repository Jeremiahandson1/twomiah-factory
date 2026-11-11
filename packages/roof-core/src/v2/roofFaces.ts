// Roof engine v2, second layer: the roof's FACES — each flat plane of the roof as its own connected patch of pixels with
// its own pitch, direction and area. Ridges, hips, valleys, eaves and rakes are the borders of these patches, so the
// lines layer is built on this one.
//
// How a face is found (and how this differs from the engine it replaces):
//   1. grow — neighbouring roof pixels whose small patch of roof tilts the same way join into one region. A region is
//      CONNECTED: two slopes with the same tilt on opposite ends of the house stay two faces. Nothing is random.
//   2. fit — each region big enough to be a face gets a plane fitted to its heights.
//   3. claim — the pixels left over (the bands along ridges and valleys, where a patch straddles two faces) go to the
//      neighbouring face whose plane passes closest to that pixel's height, so two faces meet where their planes cross.
//   4. merge — touching regions that turn out to be the same plane become one face.
//
// Not wired into the product: nothing imports this but the scoreboard (packages/roof-core/bench).
import { readRaster, pickRoof, patchSlopes, type Raster } from './roofSurface.ts'

const SQM_TO_SQFT = 10.7639

export interface RoofFace {
  id: number
  pixels: number
  planSqft: number
  slopeSqft: number
  /** Rise over a 12 run. */
  pitchOver12: number
  /** Compass direction the face looks toward (downhill), 0 = north, 90 = east. Meaningless on a flat face. */
  azimuthDeg: number
  /** z = a·east + b·north + c, metres; east/north measured from the raster's top-left corner (north is −row). */
  plane: { a: number; b: number; c: number }
  /** Root-mean-square distance of the face's heights from its plane, metres. */
  misfitM: number
}

export interface RoofFaces {
  pinOnRoof: boolean
  pinDistanceM: number
  width: number
  height: number
  px: number
  /** Per pixel: the face id it belongs to, −1 off the roof, −2 roof that no face explains (chimney, tree, clutter). */
  labels: Int32Array
  faces: RoofFace[]
  planSqft: number
  slopeSqft: number
  /** Share of the roof's flat area that no face explains (0–1). */
  unexplainedShare: number
}

export interface FaceOptions {
  /** Two neighbouring pixels belong together when their slopes differ by less than this (rise per run; 0.083 = 1/12). */
  growTolerance?: number
  /** A region smaller than this (m²) is not allowed to become a face on its own. */
  minSeedSqm?: number
  /** A leftover pixel joins a neighbouring face only if that face's plane passes within this of its height (m). */
  claimToleranceM?: number
  /** Touching regions are the same face when their slopes differ by less than this … */
  mergeSlope?: number
  /** … and each one's heights sit within this of the other's plane (m). */
  mergeHeightM?: number
  /** A finished face smaller than this (m²) is dissolved into its neighbours. */
  minFaceSqm?: number
  /** A region must be at least this wide somewhere (m) to be a face; thinner ones are the blur along a ridge or valley. */
  minWidthM?: number
  /** A grown region whose heights miss its own best plane by more than this (m, RMS) is not one face and is split. */
  notPlanarM?: number
  /** A pixel this far off its face's plane (m) is a sign of a face that was missed; a clump of them this big (m²) is tried as one. */
  recoverOffM?: number
  recoverMinSqm?: number
  /** Half-width of the patch a pixel's slope is read from (m), and how far its heights may miss a plane (m, RMS). */
  patchM?: number
  patchMisfitM?: number
}

interface Sums { n: number; sx: number; sy: number; sz: number; sxx: number; syy: number; sxy: number; sxz: number; syz: number }
const zeroSums = (): Sums => ({ n: 0, sx: 0, sy: 0, sz: 0, sxx: 0, syy: 0, sxy: 0, sxz: 0, syz: 0 })
function addPoint(s: Sums, x: number, y: number, z: number) {
  s.n++; s.sx += x; s.sy += y; s.sz += z; s.sxx += x * x; s.syy += y * y; s.sxy += x * y; s.sxz += x * z; s.syz += y * z
}
function solvePlane(s: Sums): { a: number; b: number; c: number } | null {
  if (s.n < 3) return null
  const mx = s.sx / s.n, my = s.sy / s.n, mz = s.sz / s.n
  const cxx = s.sxx - s.n * mx * mx, cyy = s.syy - s.n * my * my, cxy = s.sxy - s.n * mx * my
  const cxz = s.sxz - s.n * mx * mz, cyz = s.syz - s.n * my * mz
  const det = cxx * cyy - cxy * cxy
  if (Math.abs(det) < 1e-9) return null
  const a = (cyy * cxz - cxy * cyz) / det
  const b = (cxx * cyz - cxy * cxz) / det
  return { a, b, c: mz - a * mx - b * my }
}

export function findFaces(dsm: Raster, roof: Uint8Array, slopeX: Float32Array, slopeY: Float32Array, o: FaceOptions = {}): { labels: Int32Array; faces: RoofFace[] } {
  const { growTolerance = 0.09, minSeedSqm = 0.8, claimToleranceM = 0.3, mergeSlope = 0.07, mergeHeightM = 0.08, minFaceSqm = 1, minWidthM = 1.1, notPlanarM = 0.1, recoverOffM = 0.15, recoverMinSqm = 2 } = o
  const { width: w, height: h, px, data: z } = dsm
  const n = w * h
  const east = (i: number) => (i % w) * px
  const north = (i: number) => -((i / w) | 0) * px
  const NB = [1, -1, w, -w]
  const inRow = (i: number, j: number) => (Math.abs(j - i) === 1 ? ((i / w) | 0) === ((j / w) | 0) : j >= 0 && j < n)

  // 1. grow: connected regions of like slope. A pixel must agree with its neighbour AND with the region's running
  //    average slope, so a region cannot drift from one pitch into another through a chain of small steps.
  const labels = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (roof[i]) labels[i] = -2
  //    A region that still does not lie on one plane (its heights miss its own best plane by more than `notPlanarM`)
  //    has run two faces together; its pixels are grown again more strictly, until each piece is a plane.
  const regions: number[][] = []
  const queue: number[] = []
  const OPEN = -3
  const growAmong = (pixels: number[], tol: number): number[][] => {
    for (const i of pixels) labels[i] = OPEN
    const out: number[][] = []
    for (const s of pixels) {
      if (labels[s] !== OPEN) continue
      const members: number[] = []
      let mx = slopeX[s], my = slopeY[s], count = 1
      labels[s] = -4; queue.length = 0; queue.push(s)
      while (queue.length) {
        const i = queue.pop()!
        members.push(i)
        for (const d of NB) {
          const j = i + d
          if (!inRow(i, j) || labels[j] !== OPEN) continue
          if (Math.hypot(slopeX[j] - slopeX[i], slopeY[j] - slopeY[i]) > tol * 0.6) continue
          if (count > 12 && Math.hypot(slopeX[j] - mx / count, slopeY[j] - my / count) > tol) continue
          labels[j] = -4; queue.push(j)
          mx += slopeX[j]; my += slopeY[j]; count++
        }
      }
      out.push(members)
    }
    return out
  }
  const planeMisfit = (members: number[]): number => {
    const s = zeroSums()
    for (const i of members) addPoint(s, east(i), north(i), z[i])
    const p = solvePlane(s)
    if (!p) return 0
    let e2 = 0
    for (const i of members) { const e = z[i] - (p.a * east(i) + p.b * north(i) + p.c); e2 += e * e }
    // Judged across the plane, not straight up, so a steep face is not held to a stricter standard than a shallow one.
    return Math.sqrt(e2 / members.length) / Math.sqrt(1 + p.a * p.a + p.b * p.b)
  }
  const confident: number[] = []
  for (let i = 0; i < n; i++) if (labels[i] === -2 && !Number.isNaN(slopeX[i])) confident.push(i)
  const work: Array<{ pixels: number[]; tol: number }> = [{ pixels: confident, tol: growTolerance }]
  while (work.length) {
    const { pixels, tol } = work.pop()!
    for (const members of growAmong(pixels, tol)) {
      if (tol > growTolerance * 0.3 && members.length > 40 && planeMisfit(members) > notPlanarM) work.push({ pixels: members, tol: tol * 0.6 })
      else { for (const i of members) labels[i] = regions.length; regions.push(members) }
    }
  }

  // Which labels are wide enough to be a face: peel the label map inward half the minimum width times; a label with a
  // pixel left is wide enough. The slope of a patch that straddles a ridge is a blend of the two faces, so the blur
  // along every ridge and valley grows into a long thin region of its own — real area, but not a face.
  const wideEnough = (count: number): Uint8Array => {
    const rounds = Math.max(1, Math.round(minWidthM / 2 / px))
    let alive = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (labels[i] >= 0) alive[i] = 1
    for (let k = 0; k < rounds; k++) {
      const nextAlive = new Uint8Array(n)
      for (let i = 0; i < n; i++) {
        if (!alive[i]) continue
        const l = labels[i]
        let keep = true
        for (const d of NB) { const j = i + d; if (!inRow(i, j) || !alive[j] || labels[j] !== l) { keep = false; break } }
        if (keep) nextAlive[i] = 1
      }
      alive = nextAlive
    }
    const ok = new Uint8Array(count)
    for (let i = 0; i < n; i++) if (alive[i]) ok[labels[i]] = 1
    return ok
  }

  // 2. fit: regions big and wide enough to seed a face keep their label and get a plane; the rest go back to
  //    "unexplained" and are claimed in step 3.
  const minSeedPx = minSeedSqm / (px * px)
  const seedWide = wideEnough(regions.length)
  let planes: Array<{ a: number; b: number; c: number } | null> = regions.map((m, r) => {
    if (m.length < minSeedPx || !seedWide[r]) return null
    const s = zeroSums()
    for (const i of m) addPoint(s, east(i), north(i), z[i])
    return solvePlane(s)
  })
  for (let r = 0; r < regions.length; r++) if (!planes[r]) for (const i of regions[r]) labels[i] = -2

  // 3. claim: leftover roof pixels touching a face join the touching face whose plane is closest to their height.
  //    Done in rounds, so the bands along ridges and valleys fill inward from both sides and meet where the planes cross.
  const claim = () => {
    let frontier: number[] = []
    for (let i = 0; i < n; i++) if (labels[i] === -2) frontier.push(i)
    for (let round = 0; round < 400 && frontier.length; round++) {
      const take: Array<[number, number]> = []
      const next: number[] = []
      for (const i of frontier) {
        let best = -1, bestErr = claimToleranceM
        for (const d of NB) {
          const j = i + d
          if (!inRow(i, j)) continue
          const l = labels[j]
          if (l < 0) continue
          const p = planes[l]!
          const err = Math.abs(z[i] - (p.a * east(i) + p.b * north(i) + p.c))
          if (err < bestErr) { bestErr = err; best = l }
        }
        if (best >= 0) take.push([i, best]); else next.push(i)
      }
      if (!take.length) break
      for (const [i, l] of take) labels[i] = l
      frontier = next
    }
  }
  claim()

  // Refit every face on all the pixels it now holds.
  const refit = () => {
    const sums = planes.map(() => zeroSums())
    for (let i = 0; i < n; i++) if (labels[i] >= 0) addPoint(sums[labels[i]], east(i), north(i), z[i])
    planes = planes.map((p, r) => (p ? solvePlane(sums[r]) || p : null))
    return sums
  }
  refit()

  // 4. merge: touching faces that are one plane. Repeated until nothing merges, largest pairs of evidence first.
  const parent = planes.map((_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  for (let pass = 0; pass < 6; pass++) {
    // Along each shared border: how far apart the two planes are in height, on average.
    const border = new Map<number, { a: number; b: number; n: number; gap: number }>()
    for (let i = 0; i < n; i++) {
      const la = labels[i]
      if (la < 0) continue
      for (const d of [1, w]) {
        const j = i + d
        if (!inRow(i, j)) continue
        const lb = labels[j]
        if (lb < 0 || lb === la) continue
        const key = la < lb ? la * 100000 + lb : lb * 100000 + la
        let e = border.get(key)
        if (!e) { e = { a: Math.min(la, lb), b: Math.max(la, lb), n: 0, gap: 0 }; border.set(key, e) }
        const pa = planes[la]!, pb = planes[lb]!
        const x = east(i), y = north(i)
        e.n++; e.gap += Math.abs(pa.a * x + pa.b * y + pa.c - (pb.a * x + pb.b * y + pb.c))
      }
    }
    let merged = false
    for (const e of border.values()) {
      if (e.n < 3) continue
      const pa = planes[e.a]!, pb = planes[e.b]!
      if (Math.hypot(pa.a - pb.a, pa.b - pb.b) > mergeSlope) continue
      if (e.gap / e.n > mergeHeightM) continue
      const ra = find(e.a), rb = find(e.b)
      if (ra !== rb) { parent[rb] = ra; merged = true }
    }
    if (!merged) break
    for (let i = 0; i < n; i++) if (labels[i] >= 0) labels[i] = find(labels[i])
    const live = new Set<number>()
    for (let i = 0; i < n; i++) if (labels[i] >= 0) live.add(labels[i])
    planes = planes.map((p, r) => (live.has(r) ? p : null))
    refit()
  }

  // Dissolve faces too small to be real, and let their pixels be claimed again by what surrounds them.
  const minFacePx = minFaceSqm / (px * px)
  const counts = new Map<number, number>()
  for (let i = 0; i < n; i++) if (labels[i] >= 0) counts.set(labels[i], (counts.get(labels[i]) || 0) + 1)
  let dissolved = false
  const faceWide = wideEnough(planes.length)
  for (const [l, c] of counts) {
    const p = planes[l]
    if (!faceWide[l]) { planes[l] = null; dissolved = true; continue }
    // Too small to be a face, or steeper than 24/12 — a wall or a tree edge that got fitted, not roof.
    if (c < minFacePx || (p && Math.hypot(p.a, p.b) > 2)) { planes[l] = null; dissolved = true }
  }
  if (dissolved) {
    for (let i = 0; i < n; i++) if (labels[i] >= 0 && !planes[labels[i]]) labels[i] = -2
    claim()
    refit()
  }

  // 5. look again: a face that never seeded (too few clean patches of its own — a small hip end between two bigger
  //    faces, say) has been swallowed by its neighbours, and its pixels sit visibly off the plane they were given. A
  //    connected clump of such pixels, together with any roof still unexplained, that lies on a plane of its own is a
  //    face that was missed.
  const offPlane = (i: number) => {
    const p = planes[labels[i]]!
    return Math.abs(z[i] - (p.a * east(i) + p.b * north(i) + p.c)) / Math.sqrt(1 + p.a * p.a + p.b * p.b)
  }
  const recovered: number[] = []
  {
    const bad = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (labels[i] === -2 || (labels[i] >= 0 && offPlane(i) > recoverOffM)) bad[i] = 1
    const seen = new Uint8Array(n)
    const minPx = recoverMinSqm / (px * px)
    for (let s = 0; s < n; s++) {
      if (!bad[s] || seen[s]) continue
      let members: number[] = []
      seen[s] = 1; queue.length = 0; queue.push(s)
      while (queue.length) {
        const i = queue.pop()!
        members.push(i)
        for (const d of NB) { const j = i + d; if (inRow(i, j) && bad[j] && !seen[j]) { seen[j] = 1; queue.push(j) } }
      }
      if (members.length < minPx) continue
      // Fit, drop what does not belong (the clump's ragged fringe), fit again.
      let p: { a: number; b: number; c: number } | null = null
      for (let pass = 0; pass < 3; pass++) {
        const sm = zeroSums()
        for (const i of members) addPoint(sm, east(i), north(i), z[i])
        p = solvePlane(sm)
        if (!p) break
        const q = p
        const kept = members.filter((i) => Math.abs(z[i] - (q.a * east(i) + q.b * north(i) + q.c)) < 0.12)
        if (kept.length === members.length) break
        members = kept
        if (members.length < minPx) { p = null; break }
      }
      if (!p || Math.hypot(p.a, p.b) > 2) continue
      const id = planes.length
      planes.push(p)
      for (const i of members) labels[i] = id
      recovered.push(id)
    }
  }
  // 6. settle the borders: a pixel on the border between two faces goes to the one whose plane it sits on. This puts
  //    each border where the two planes actually cross, and gives a recovered face its true outline.
  const relax = () => {
    for (let round = 0; round < 12; round++) {
      const moves: Array<[number, number]> = []
      for (let i = 0; i < n; i++) {
        const l = labels[i]
        if (l < 0) continue
        let best = -1, bestErr = offPlane(i) - 0.04
        for (const d of NB) {
          const j = i + d
          if (!inRow(i, j)) continue
          const l2 = labels[j]
          if (l2 < 0 || l2 === l) continue
          const p = planes[l2]!
          const err = Math.abs(z[i] - (p.a * east(i) + p.b * north(i) + p.c)) / Math.sqrt(1 + p.a * p.a + p.b * p.b)
          if (err < bestErr) { bestErr = err; best = l2 }
        }
        if (best >= 0) moves.push([i, best])
      }
      if (!moves.length) break
      for (const [i, l] of moves) labels[i] = l
    }
  }
  if (recovered.length) {
    claim()
    relax()
    refit()
    // A recovered face must stand up as a face like any other: wide enough, big enough.
    const wide = wideEnough(planes.length)
    const size = new Map<number, number>()
    for (let i = 0; i < n; i++) if (labels[i] >= 0) size.set(labels[i], (size.get(labels[i]) || 0) + 1)
    let dropped = false
    for (const id of recovered) if (!wide[id] || (size.get(id) || 0) < minFacePx) { planes[id] = null; dropped = true }
    if (dropped) {
      for (let i = 0; i < n; i++) if (labels[i] >= 0 && !planes[labels[i]]) labels[i] = -2
      claim()
      refit()
    }
  }

  // Number the faces 0…k−1, largest first, and measure each.
  const sums = planes.map(() => zeroSums())
  const sq = planes.map(() => 0)
  for (let i = 0; i < n; i++) {
    const l = labels[i]
    if (l < 0) continue
    addPoint(sums[l], east(i), north(i), z[i])
  }
  for (let i = 0; i < n; i++) {
    const l = labels[i]
    if (l < 0) continue
    const p = planes[l]!
    const e = z[i] - (p.a * east(i) + p.b * north(i) + p.c)
    sq[l] += e * e
  }
  const order = planes.map((p, r) => r).filter((r) => planes[r] && sums[r].n > 0).sort((a, b) => sums[b].n - sums[a].n)
  const renumber = new Map(order.map((r, k) => [r, k]))
  for (let i = 0; i < n; i++) if (labels[i] >= 0) labels[i] = renumber.get(labels[i])!
  const pixelSqft = px * px * SQM_TO_SQFT
  const faces: RoofFace[] = order.map((r, k) => {
    const p = planes[r]!
    const slope = Math.hypot(p.a, p.b)
    const az = (Math.atan2(-p.a, -p.b) * 180) / Math.PI
    return {
      id: k, pixels: sums[r].n,
      planSqft: Math.round(sums[r].n * pixelSqft),
      slopeSqft: Math.round(sums[r].n * pixelSqft * Math.sqrt(1 + slope * slope)),
      pitchOver12: Math.round(slope * 12 * 10) / 10,
      azimuthDeg: Math.round(((az % 360) + 360) % 360),
      plane: p,
      misfitM: Math.round(Math.sqrt(sq[r] / sums[r].n) * 1000) / 1000,
    }
  })
  return { labels, faces }
}

/** The roof's faces for the address the rasters are centred on. */
export async function measureRoofFaces(dsmBuffer: Buffer, maskBuffer: Buffer, options: FaceOptions = {}): Promise<RoofFaces | null> {
  const [dsm, mask] = await Promise.all([readRaster(dsmBuffer), readRaster(maskBuffer)])
  if (dsm.width !== mask.width || dsm.height !== mask.height) throw new Error('height map and roof mask are not on the same grid')
  const picked = pickRoof(mask)
  if (!picked) return null
  const pixelSqft = dsm.px * dsm.px * SQM_TO_SQFT
  const planSqft = Math.round(picked.pixels * pixelSqft)

  const attempt = (o: FaceOptions) => {
    const { slopeX, slopeY } = patchSlopes(dsm, picked.roof, o.patchM ?? 0.75, o.patchMisfitM ?? 0.06)
    // A steeper reading than 24/12 is a wall or a tree edge, not roof.
    for (let i = 0; i < slopeX.length; i++) if (Math.hypot(slopeX[i], slopeY[i]) > 2) { slopeX[i] = NaN; slopeY[i] = NaN }
    const found = findFaces(dsm, picked.roof, slopeX, slopeY, o)
    const explainedPlan = found.faces.reduce((s, f) => s + f.planSqft, 0)
    return { ...found, explainedPlan, unexplainedShare: planSqft > 0 ? Math.max(0, planSqft - explainedPlan) / planSqft : 0 }
  }

  // Google's height map carries about 0.25 m of real detail however fine it is asked for, so a pixel's slope is read
  // from a patch wide enough to hold several real samples (0.75 m either way). That reads big faces cleanly. A roof cut
  // into many small faces has few places such a patch fits on one face, and most of it comes back unexplained; for such
  // a roof the reading is taken again from a tighter patch with narrower faces allowed, and the better of the two kept.
  let best = attempt(options)
  if (best.unexplainedShare > 0.15 && options.patchM === undefined) {
    const fine = attempt({ ...options, patchM: 0.45, minWidthM: options.minWidthM ?? 0.8 })
    if (fine.unexplainedShare < best.unexplainedShare) best = fine
  }

  const explainedSlope = best.faces.reduce((s, f) => s + f.slopeSqft, 0)
  // Roof no face explains is counted at the roof's overall slope factor rather than left out.
  const factor = best.explainedPlan > 0 ? explainedSlope / best.explainedPlan : 1
  return {
    pinOnRoof: picked.pinOnRoof, pinDistanceM: Math.round(picked.pinDistanceM * 10) / 10,
    width: dsm.width, height: dsm.height, px: dsm.px, labels: best.labels, faces: best.faces,
    planSqft, slopeSqft: Math.round(explainedSlope + Math.max(0, planSqft - best.explainedPlan) * factor),
    unexplainedShare: best.unexplainedShare,
  }
}
