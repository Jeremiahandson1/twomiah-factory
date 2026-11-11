// Roof engine v2, third layer: the roof's LINES — ridges, hips, valleys, eaves and rakes, and where a roof meets a wall —
// read off the borders of the faces the second layer found, each measured at its true length on the slope.
//
// A border on a pixel grid is a staircase. Every step of the staircase (a "crack" between two pixels) is first given the
// direction of the real line it belongs to, and then counts only for its length ALONG that direction, so a staircase adds
// up to the straight line it stands for instead of to its longer zig-zag.
//
//   · two faces whose planes cross along their border: the direction is where the planes cross (known exactly).
//     Level and peaked → RIDGE; sloped and peaked → HIP; a trough → VALLEY.
//   · two faces with a drop between them (one roof over another): for the upper face that border is roof edge (eave or
//     rake); for the lower one it is where roof meets wall (level → FLASHING, sloped → STEP FLASHING).
//   · a face against open air: the edge's direction is read from the outline itself. Running level across the slope →
//     EAVE; running up the slope → RAKE.
//
// Not wired into the product: nothing imports this but the scoreboard (packages/roof-core/bench).
import type { RoofFaces } from './roofFaces.ts'

const M_TO_FT = 3.28084

export type LineType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'flash' | 'stepflash'

export interface RoofLines {
  /** Summed length by type, feet, on the slope. */
  lengths: Record<LineType, number>
  /** Roof outline that borders roof no face explains — real edge of unknown kind, feet (flat). */
  unknownEdgeFt: number
  /** Borders between a face and roof no face explains, feet (flat) — lines that may be missing from the totals above. */
  unknownBorderFt: number
  /** Outline that ran on a slant and was rebuilt as square corners, feet (flat) — worth a person's look when large. */
  squaredEdgeFt: number
  /** Hip and valley length (each) that was not seen but inferred from two offset faces, feet — worth a person's look. */
  inferredStripFt: number
  /** Every measured step, for drawing and for the layers built on this one. */
  cracks: Array<{ east: number; north: number; type: LineType | 'unknown'; faceA: number; faceB: number; ft: number }>
}

export interface LineOptions {
  /** Planes further apart than this at their shared border (m) do not cross there: one roof is above the other. */
  stepM?: number
  /** A line whose slope along its length is under this (rise per run) is level. */
  levelSlope?: number
  /** How far along an edge its neighbours are looked at to read its direction (m). */
  reachM?: number
  /** Unexplained roof this close to a face (m) is read as part of that face when lines are measured. */
  fillM?: number
  /** Treat every slanted stretch of outline as a cut-off square corner (a tree over the corner, a rounded mask), not
   *  only the short ones. Right for a house whose walls all run two ways; wrong for one with an angled wing. */
  squareAll?: boolean
  /** How near a corner (m) an outline edge may borrow its type from a neighbouring face. */
  cornerM?: number
  /** Same-tilt faces closer in height than this (m) are one plane; between this and stepM a hidden strip joins them. */
  seamM?: number
}

interface Crack { e: number; n: number; tx: number; ty: number; a: number; b: number }

/** For each point, the direction (unit vector) of the straight line through it that the most neighbours lie on. */
function dominantDirections(pts: Array<{ e: number; n: number }>, reach: number, near: number): Array<[number, number, number] | null> {
  const dirs: Array<[number, number]> = []
  for (let d = 0; d < 180; d += 5) dirs.push([Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)])
  return pts.map((p) => {
    const nb = pts.filter((q) => Math.abs(q.e - p.e) <= reach && Math.abs(q.n - p.n) <= reach && q !== p)
    let best: [number, number] | null = null, bestCount = 2
    for (const [dx, dy] of dirs) {
      let c = 0
      for (const q of nb) if (Math.abs((q.e - p.e) * dy - (q.n - p.n) * dx) <= near) c++
      if (c > bestCount) { bestCount = c; best = [dx, dy] }
    }
    if (!best) return null
    // Sharpen the 5° guess: the principal direction of the points on that line.
    let sxx = 0, syy = 0, sxy = 0
    for (const q of nb) {
      if (Math.abs((q.e - p.e) * best[1] - (q.n - p.n) * best[0]) > near) continue
      const de = q.e - p.e, dn = q.n - p.n
      sxx += de * de; syy += dn * dn; sxy += de * dn
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    return [Math.cos(ang), Math.sin(ang), bestCount]
  })
}

export function measureRoofLines(r: RoofFaces, o: LineOptions = {}): RoofLines {
  const { stepM = 0.8, levelSlope = 0.07, reachM = 2, seamM = 0.2 } = o
  let inferredStrip = 0
  const { width: w, height: h, px, faces } = r
  // The rim of a roof rarely fits a face's plane (the height map blurs the roof's edge into the ground below it), so
  // the faces layer leaves a thin band of the outline unexplained. For reading lines, that band — and small unexplained
  // spots inside the roof, such as a chimney — belongs to the face beside it: unexplained roof within `fillM` of a face
  // takes that face's label. Areas are not affected; this copy of the labels is only for the lines.
  const fillM = o.fillM ?? 1.25
  const labels = Int32Array.from(r.labels)
  for (let round = 0; round < Math.round(fillM / px); round++) {
    const take: Array<[number, number]> = []
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== -2) continue
      const x = i % w
      const nb = [x > 0 ? labels[i - 1] : -1, x < w - 1 ? labels[i + 1] : -1, i >= w ? labels[i - w] : -1, i < labels.length - w ? labels[i + w] : -1]
      const l = nb.find((v) => v >= 0)
      if (l !== undefined) take.push([i, l])
    }
    if (!take.length) break
    for (const [i, l] of take) labels[i] = l
  }
  // Filling outward from whichever face was nearest carries a face's label past the corner where it meets its
  // neighbour (round a hip corner, the rim of the north face would run on down the east side). Two faces part along the
  // line where their planes cross, so a filled pixel that lies on a nearby face's side of that line is that face's.
  {
    const cen = faces.map(() => ({ e: 0, n: 0, k: 0 }))
    for (let i = 0; i < r.labels.length; i++) {
      const l = r.labels[i]
      if (l < 0) continue
      cen[l].e += (i % w) * px; cen[l].n += -((i / w) | 0) * px; cen[l].k++
    }
    const diff = (A: number, B: number, e: number, n: number) => {
      const pa = faces[A].plane, pb = faces[B].plane
      return pa.a * e + pa.b * n + pa.c - (pb.a * e + pb.b * n + pb.c)
    }
    const reachPx = Math.round(1.5 / px)
    const moves: Array<[number, number]> = []
    for (let i = 0; i < labels.length; i++) {
      if (r.labels[i] !== -2 || labels[i] < 0) continue
      const A = labels[i]
      const x = i % w, y = (i / w) | 0, e = x * px, n = -y * px
      const seen = new Set<number>()
      let best = -1, bestMargin = 0.05
      for (let dy = -reachPx; dy <= reachPx; dy++) {
        for (let dx = -reachPx; dx <= reachPx; dx++) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const B = r.labels[yy * w + xx]
          if (B < 0 || B === A || seen.has(B)) continue
          seen.add(B)
          const pa = faces[A].plane, pb = faces[B].plane
          if (Math.hypot(pa.a - pb.a, pa.b - pb.b) < 0.05) continue
          // Which sign A's own side has, read at A's centre; the pixel belongs to B if it is on the other side.
          const home = diff(A, B, cen[A].e / cen[A].k, cen[A].n / cen[A].k)
          const here = diff(A, B, e, n)
          if (home * here < 0 && Math.abs(here) > bestMargin) { bestMargin = Math.abs(here); best = B }
        }
      }
      if (best >= 0) moves.push([i, best])
    }
    for (const [i, l] of moves) labels[i] = l
  }
  const plane = (l: number) => faces[l].plane
  const zAt = (l: number, e: number, n: number) => { const p = plane(l); return p.a * e + p.b * n + p.c }

  // Every crack between two different labels. `a` is the label on the west / north side, `b` on the east / south.
  const pair = new Map<number, Crack[]>()
  const outline: Crack[] = []        // face | open air
  const unknownOutline: Crack[] = [] // unexplained roof | open air
  let unknownBorder = 0
  const add = (la: number, lb: number, e: number, n: number, tx: number, ty: number) => {
    if (la === lb) return
    const c: Crack = { e, n, tx, ty, a: la, b: lb }
    if (la >= 0 && lb >= 0) {
      const key = Math.min(la, lb) * 100000 + Math.max(la, lb)
      const list = pair.get(key); if (list) list.push(c); else pair.set(key, [c])
    } else if ((la >= 0 && lb === -1) || (lb >= 0 && la === -1)) outline.push(c)
    else if ((la === -2 && lb === -1) || (lb === -2 && la === -1)) unknownOutline.push(c)
    else unknownBorder++
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x < w - 1) add(labels[i], labels[i + 1], (x + 0.5) * px, -y * px, 0, 1)
      if (y < h - 1) add(labels[i], labels[i + w], x * px, -(y + 0.5) * px, 1, 0)
    }
  }

  const lengths: Record<LineType, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, flash: 0, stepflash: 0 }
  const cracks: RoofLines['cracks'] = []
  const near = Math.max(0.3, px * 1.2)

  /** A stretch of roof edge of face `l` running in direction d: eave if it runs across the slope, rake if up it. */
  const edgeOf = (l: number, d: [number, number] | [number, number, number], flat: number): { type: 'eave' | 'rake'; len: number } => {
    const p = plane(l)
    const slope = Math.hypot(p.a, p.b)
    const along = p.a * d[0] + p.b * d[1]
    if (slope < levelSlope || Math.abs(along) < slope * 0.5) return { type: 'eave', len: flat * Math.sqrt(1 + along * along) }
    return { type: 'rake', len: flat * Math.sqrt(1 + along * along) }
  }

  // Face against face.
  for (const list of pair.values()) {
    const A = Math.min(list[0].a, list[0].b), B = Math.max(list[0].a, list[0].b)
    const pa = plane(A), pb = plane(B)
    const da = pa.a - pb.a, db = pa.b - pb.b
    const cross = Math.hypot(da, db)
    // Where the planes cross runs perpendicular to the difference of their slopes.
    const crossDir: [number, number] | null = cross > 0.05 ? [-db / cross, da / cross] : null
    const read = dominantDirections(list, reachM, near)

    // Peak or trough: a little way into A's side of the border, is A's plane the lower of the two (a peak) or the higher?
    let vote = 0
    for (const c of list) {
      const aIsFirst = c.a === A
      // The crack's normal, pointing from the `b` side to the `a` side (west or north).
      const nx = c.tx === 0 ? -1 : 0, ny = c.tx === 0 ? 0 : 1
      const s = aIsFirst ? 1 : -1
      const e = c.e + nx * s, n = c.n + ny * s
      vote += zAt(A, e, n) - zAt(B, e, n)
    }
    const peak = vote < 0

    list.forEach((c, k) => {
      const gap = zAt(A, c.e, c.n) - zAt(B, c.e, c.n)
      // Two planes can only meet along the line where they cross. A border that runs some other way is not their
      // meeting line however small the drop across it: it is the edge of one roof standing over the other (a wing whose
      // eave sits a little above the main roof, say).
      const d = read[k]
      const alongCross = !!crossDir && (!d || Math.abs(d[0] * crossDir[0] + d[1] * crossDir[1]) > 0.9)
      if (Math.abs(gap) > stepM || !crossDir || !alongCross) {
        // One roof above the other: roof edge for the upper face, wall junction for the lower.
        if (!d) return
        const flat = px * Math.abs(c.tx * d[0] + c.ty * d[1])
        if (Math.abs(gap) <= stepM && !crossDir) {
          // Two faces that tilt the same way but sit at different heights cannot meet in a line: between them runs a
          // narrow strip of roof facing sideways — where one wall steps out past another — too narrow for the height
          // map to show as a face. Such a strip has a hip down one side and a valley down the other, each the length
          // of this border. (Under `seamM` apart they are one plane, and this is only a seam in it.)
          if (Math.abs(gap) < seamM) return
          const s = Math.hypot(pa.a, pa.b)
          const len = flat * Math.sqrt(1 + (s * s) / 2)
          lengths.hip += len; lengths.valley += len
          inferredStrip += len
          cracks.push({ east: c.e, north: c.n, type: 'valley', faceA: A, faceB: B, ft: len * M_TO_FT })
          cracks.push({ east: c.e, north: c.n, type: 'hip', faceA: A, faceB: B, ft: len * M_TO_FT })
          return
        }
        const upper = gap > 0 ? A : B, lower = gap > 0 ? B : A
        const edge = edgeOf(upper, d, flat)
        lengths[edge.type] += edge.len
        const pl = plane(lower)
        const along = pl.a * d[0] + pl.b * d[1]
        const wall: LineType = Math.abs(along) < levelSlope ? 'flash' : 'stepflash'
        lengths[wall] += flat * Math.sqrt(1 + along * along)
        cracks.push({ east: c.e, north: c.n, type: edge.type, faceA: A, faceB: B, ft: edge.len * M_TO_FT })
        return
      }
      const flat = px * Math.abs(c.tx * crossDir[0] + c.ty * crossDir[1])
      const along = pa.a * crossDir[0] + pa.b * crossDir[1]
      // A level trough is where a slope runs out onto a flat or low roof — a change of pitch, not a valley: a valley
      // carries water down its length, so it always slopes.
      if (!peak && Math.abs(along) < levelSlope) { cracks.push({ east: c.e, north: c.n, type: 'unknown', faceA: A, faceB: B, ft: flat * M_TO_FT }); return }
      const type: LineType = !peak ? 'valley' : Math.abs(along) < levelSlope ? 'ridge' : 'hip'
      lengths[type] += flat * Math.sqrt(1 + along * along)
      cracks.push({ east: c.e, north: c.n, type, faceA: A, faceB: B, ft: flat * Math.sqrt(1 + along * along) * M_TO_FT })
    })
  }

  // Face against open air. Directions are read from the whole outline together, so a straight edge shared by two faces
  // (or running past a patch of unexplained roof) is still read as one straight edge.
  const allOutline = [...outline, ...unknownOutline]
  const outlineDir = dominantDirections(allOutline, reachM, near)
  // The house's own two wall directions: the direction most of the outline runs in, and the one square to it.
  const bins = new Float64Array(90)
  for (const d of outlineDir) {
    if (!d) continue
    const deg = ((Math.atan2(d[1], d[0]) * 180) / Math.PI + 360) % 90
    bins[Math.round(deg) % 90]++
  }
  let axisDeg = 0, axisVotes = -1
  for (let k = 0; k < 90; k++) {
    const v = bins[k] + bins[(k + 1) % 90] + bins[(k + 89) % 90]
    if (v > axisVotes) { axisVotes = v; axisDeg = k }
  }
  const u: [number, number] = [Math.cos((axisDeg * Math.PI) / 180), Math.sin((axisDeg * Math.PI) / 180)]
  const v: [number, number] = [-u[1], u[0]]
  // A long straight edge has this many neighbours on its line within reach; a short cut across a corner has far fewer.
  const fullSupport = (2 * reachM) / px

  // A stretch of outline is typed by the face behind it — except that near a corner the face behind it is often the
  // wrong one (round a hip corner, the rim of one face is credited to its neighbour, for which the same edge runs
  // uphill). So an edge that would be a rake of its own face is an eave if some face within `cornerM` of it has it as
  // an eave: a hip corner. At a gable end there is no such face — the only other one is beyond the ridge — and it
  // stays a rake.
  const cornerPx = Math.round((o.cornerM ?? 1.25) / px)
  const outlineEdge = (c: Crack, face: number, d: [number, number] | [number, number, number], flat: number) => {
    const own = edgeOf(face, d, flat)
    if (own.type === 'eave') return own
    const x = Math.round(c.e / px), y = Math.round(-c.n / px)
    const tried = new Set<number>([face])
    for (let dy = -cornerPx; dy <= cornerPx; dy++) {
      for (let dx = -cornerPx; dx <= cornerPx; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const l = r.labels[yy * w + xx]
        if (l < 0 || tried.has(l)) continue
        tried.add(l)
        const other = edgeOf(l, d, flat)
        if (other.type === 'eave') return other
      }
    }
    return own
  }

  let unknownEdge = 0
  let squaredFlat = 0
  const squareAll = o.squareAll ?? true
  allOutline.forEach((c, k) => {
    const d = outlineDir[k]
    const flat = d ? px * Math.abs(c.tx * d[0] + c.ty * d[1]) : px * 0.7
    const face = c.a >= 0 ? c.a : c.b >= 0 ? c.b : -2
    if (face < 0 || !d) { unknownEdge += flat; cracks.push({ east: c.e, north: c.n, type: 'unknown', faceA: face, faceB: -1, ft: flat * M_TO_FT }); return }
    // A short slanted cut across a corner is not a real edge: roofs have square corners, and the mask rounds them off
    // (or a tree hides them). Its length goes to the two wall directions it stands in for, as the corner it replaces.
    const offAxis = Math.min(Math.abs(d[0] * u[0] + d[1] * u[1]), Math.abs(d[0] * v[0] + d[1] * v[1]))
    if (offAxis > 0.34 && (squareAll || d[2] < fullSupport * 0.75)) {
      squaredFlat += flat
      for (const axis of [u, v]) {
        const part = flat * Math.abs(d[0] * axis[0] + d[1] * axis[1])
        const edge = outlineEdge(c, face, axis, part)
        lengths[edge.type] += edge.len
      }
      cracks.push({ east: c.e, north: c.n, type: 'unknown', faceA: face, faceB: -1, ft: flat * M_TO_FT })
      return
    }
    const edge = outlineEdge(c, face, d, flat)
    lengths[edge.type] += edge.len
    cracks.push({ east: c.e, north: c.n, type: edge.type, faceA: face, faceB: -1, ft: edge.len * M_TO_FT })
  })

  for (const k of Object.keys(lengths) as LineType[]) lengths[k] = Math.round(lengths[k] * M_TO_FT * 10) / 10
  return {
    lengths,
    unknownEdgeFt: Math.round(unknownEdge * M_TO_FT * 10) / 10,
    unknownBorderFt: Math.round(unknownBorder * px * 0.8 * M_TO_FT * 10) / 10,
    squaredEdgeFt: Math.round(squaredFlat * M_TO_FT * 10) / 10,
    inferredStripFt: Math.round(inferredStrip * M_TO_FT * 10) / 10,
    cracks,
  }
}
