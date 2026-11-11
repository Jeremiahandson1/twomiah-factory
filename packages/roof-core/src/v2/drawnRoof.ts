// The base roof report: a person draws the roof's lines over the aerial picture — pick a type (eave, rake, ridge, hip,
// valley, flashing), click dot to dot, Done — and this turns those lines into what a roofer orders by: the roof's faces,
// its area ON THE SLOPE, and every line at its true length.
//
// A drawing is flat: it is the roof seen from straight above. Two things turn it into real measurements —
//   · the faces: wherever the drawn lines close a loop, that loop is a face of the roof. Its flat area times its pitch
//     factor is its real area.
//   · the pitch: an eave or a ridge runs level, so its drawn length is its real length. A rake climbs the slope, and a
//     hip or valley climbs it on the diagonal; each is longer than it looks from above, by an amount its pitch fixes.
// Pitch comes per face where the caller can give it (read from the height map inside the face, or entered from a pitch
// gauge), and otherwise from the one pitch given for the whole roof.
//
// Pure arithmetic: no network, no clock, no randomness. Lengths in, in metres on a flat local grid (x east, y north);
// feet and square feet out. Not wired into the product yet.

const M_TO_FT = 3.28084
const SQM_TO_SQFT = 10.7639

export type DrawnLineType = 'eave' | 'rake' | 'ridge' | 'hip' | 'valley' | 'flash' | 'stepflash'
export interface Pt { x: number; y: number }
export interface DrawnLine { type: DrawnLineType; a: Pt; b: Pt }

export interface DrawnOptions {
  /** The roof's pitch (rise over 12) where a face has none of its own. */
  defaultPitchOver12: number
  /** A face's own pitch (rise over 12), or null to use the default: from the height map, or what the roofer entered. */
  pitchOfFace?: (outline: Pt[], index: number) => number | null
  /** Ends this close together (m) are the same corner. */
  snapM?: number
}

export interface DrawnFace {
  outline: Pt[]
  planSqft: number
  pitchOver12: number
  /** Where the pitch came from: the face's own, or the whole-roof default. */
  pitchFrom: 'face' | 'default'
  areaSqft: number
  /** Which building this face is part of (index into `buildings`). */
  building: number
}

/** One building on the picture: the faces that are joined to each other by drawn lines (a house, a detached garage). */
export interface DrawnBuilding {
  faces: number[]
  planSqft: number
  areaSqft: number
  squares: number
  /** Feet on the roof, by type, of the lines that belong to this building. */
  lengths: Record<DrawnLineType, number>
}

export interface MeasuredLine {
  type: DrawnLineType
  /** The building the line belongs to, or null when it is joined to no closed face. */
  building: number | null
  /** As drawn, seen from above. */
  flatFt: number
  /** On the roof. */
  lengthFt: number
}

export interface DrawnRoof {
  faces: DrawnFace[]
  /** The buildings drawn, biggest first. One for an ordinary house; a detached garage or shed is its own. */
  buildings: DrawnBuilding[]
  lines: MeasuredLine[]
  /** Feet on the roof, by type. */
  lengths: Record<DrawnLineType, number>
  planSqft: number
  areaSqft: number
  squares: number
  /** What a person should fix before trusting the area, in plain words. Empty when the drawing closes up. */
  warnings: string[]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const signedArea = (p: Pt[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y } return s / 2 }

/** How much longer than its flat length a line of this type is, on faces of these pitches (rise per run). */
export function slopeFactor(type: DrawnLineType, p1: number, p2: number | null): number {
  if (type === 'eave' || type === 'ridge' || type === 'flash') return 1
  if (type === 'rake' || type === 'stepflash') return Math.sqrt(1 + p1 * p1)
  // A hip or valley is where two faces meet at a corner. Along it the roof climbs p1·p2/√(p1²+p2²) per unit of flat
  // run (two square-set faces); with equal pitches that is p/√2.
  const q = p2 ?? p1
  const along = p1 > 0 && q > 0 ? (p1 * q) / Math.hypot(p1, q) : 0
  return Math.sqrt(1 + along * along)
}

export function measureDrawnRoof(drawn: DrawnLine[], o: DrawnOptions): DrawnRoof {
  const snap = o.snapM ?? 0.3
  const warnings: string[] = []
  const lines = drawn.filter((l) => dist(l.a, l.b) > 0.05)

  // 1. corners: ends that are (nearly) the same point become one node.
  const nodes: Pt[] = []
  const nodeAt = (p: Pt): number => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= snap) return i
    nodes.push({ x: p.x, y: p.y })
    return nodes.length - 1
  }
  const ends = lines.map((l) => [nodeAt(l.a), nodeAt(l.b)] as [number, number])

  // 2. where two lines cross mid-way, that crossing is a corner too.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = nodes[ends[i][0]], b = nodes[ends[i][1]], c = nodes[ends[j][0]], d = nodes[ends[j][1]]
      const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y
      const den = rx * sy - ry * sx
      if (Math.abs(den) < 1e-9) continue
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue
      nodeAt({ x: a.x + t * rx, y: a.y + t * ry })
    }
  }

  // 3. each drawn line is cut at every corner that lies on it, into edges between neighbouring corners.
  interface Edge { u: number; v: number; line: number }
  const edges: Edge[] = []
  const seen = new Map<string, number>()
  // Per drawn line, the edges it runs along — its own, or (where it was drawn over another line) the other's. Faces are
  // built from each stretch once; a line's LENGTH is always counted, since two lines one above the other from the air
  // (an upper eave over a lower wall line) are two real lines.
  const stretches: number[][] = lines.map(() => [])
  lines.forEach((l, li) => {
    const a = nodes[ends[li][0]], b = nodes[ends[li][1]]
    const len = dist(a, b)
    if (len < 1e-6) return
    const on: Array<{ t: number; n: number }> = []
    for (let n = 0; n < nodes.length; n++) {
      const p = nodes[n]
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)
      if (t < -1e-6 || t > 1 + 1e-6) continue
      const off = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / len
      if (off <= snap * 0.5 || n === ends[li][0] || n === ends[li][1]) on.push({ t, n })
    }
    on.sort((p, q) => p.t - q.t)
    for (let k = 0; k < on.length - 1; k++) {
      const u = on[k].n, v = on[k + 1].n
      if (u === v) continue
      const key = u < v ? `${u}-${v}` : `${v}-${u}`
      const had = seen.get(key)
      if (had !== undefined) { stretches[li].push(had); continue }
      seen.set(key, edges.length)
      stretches[li].push(edges.length)
      edges.push({ u, v, line: li })
    }
  })

  // 4. faces: the loops the edges close. Stubs that lead nowhere cannot bound a face and are set aside first.
  const live = edges.map(() => true)
  for (let changed = true; changed;) {
    changed = false
    const degree = new Map<number, number>()
    edges.forEach((e, i) => { if (live[i]) { degree.set(e.u, (degree.get(e.u) || 0) + 1); degree.set(e.v, (degree.get(e.v) || 0) + 1) } })
    edges.forEach((e, i) => { if (live[i] && (degree.get(e.u) === 1 || degree.get(e.v) === 1)) { live[i] = false; changed = true } })
  }
  const around = new Map<number, Array<{ to: number; edge: number; angle: number }>>()
  edges.forEach((e, i) => {
    if (!live[i]) return
    for (const [from, to] of [[e.u, e.v], [e.v, e.u]]) {
      const list = around.get(from) || []
      list.push({ to, edge: i, angle: Math.atan2(nodes[to].y - nodes[from].y, nodes[to].x - nodes[from].x) })
      around.set(from, list)
    }
  })
  for (const list of around.values()) list.sort((p, q) => p.angle - q.angle)

  // Corners joined by any drawn line are one building; a garage drawn apart from the house is another.
  const group = nodes.map((_, i) => i)
  const groupOf = (n: number): number => { while (group[n] !== n) { group[n] = group[group[n]]; n = group[n] } return n }
  for (const e of edges) group[groupOf(e.u)] = groupOf(e.v)
  const faceGroup: number[] = []

  const faceOfHalf = new Map<string, number>() // "edge:from" → face
  const faces: DrawnFace[] = []
  const walked = new Set<string>()
  edges.forEach((e, i) => {
    if (!live[i]) return
    for (const [from0, to0] of [[e.u, e.v], [e.v, e.u]]) {
      if (walked.has(`${i}:${from0}`)) continue
      // Walk with the face on the left: at each corner take the next edge clockwise from the one arrived by.
      const loop: number[] = []
      const halves: string[] = []
      let from = from0, to = to0, edge = i
      for (let guard = 0; guard < edges.length * 2 + 4; guard++) {
        const half = `${edge}:${from}`
        if (walked.has(half)) break
        walked.add(half); halves.push(half); loop.push(from)
        const list = around.get(to)!
        const back = list.findIndex((n) => n.edge === edge && n.to === from)
        const next = list[(back - 1 + list.length) % list.length]
        from = to; to = next.to; edge = next.edge
      }
      const outline = loop.map((n) => nodes[n])
      const area = signedArea(outline)
      if (area <= 0.25) continue // the outside of the roof, or a sliver
      const index = faces.length
      for (const h of halves) faceOfHalf.set(h, index)
      const own = o.pitchOfFace ? o.pitchOfFace(outline, index) : null
      const pitch = own != null && Number.isFinite(own) && own >= 0 ? own : o.defaultPitchOver12
      const planSqft = area * SQM_TO_SQFT
      faceGroup.push(groupOf(loop[0]))
      faces.push({
        building: 0,
        outline, planSqft: Math.round(planSqft * 10) / 10, pitchOver12: Math.round(pitch * 10) / 10,
        pitchFrom: own != null && Number.isFinite(own) && own >= 0 ? 'face' : 'default',
        areaSqft: Math.round(planSqft * Math.sqrt(1 + (pitch / 12) ** 2) * 10) / 10,
      })
    }
  })

  // The buildings, biggest first.
  const noLengths = (): Record<DrawnLineType, number> => ({ eave: 0, rake: 0, ridge: 0, hip: 0, valley: 0, flash: 0, stepflash: 0 })
  const groups = [...new Set(faceGroup)]
  const groupArea = (g: number) => faces.reduce((s, f, i) => s + (faceGroup[i] === g ? f.areaSqft : 0), 0)
  groups.sort((p, q) => groupArea(q) - groupArea(p))
  const buildings: DrawnBuilding[] = groups.map((g) => {
    const mine = faces.map((_, i) => i).filter((i) => faceGroup[i] === g)
    const plan = mine.reduce((s, i) => s + faces[i].planSqft, 0), area = mine.reduce((s, i) => s + faces[i].areaSqft, 0)
    return { faces: mine, planSqft: Math.round(plan), areaSqft: Math.round(area), squares: Math.round(area) / 100, lengths: noLengths() }
  })
  faces.forEach((f, i) => { f.building = groups.indexOf(faceGroup[i]) })

  // 5. every drawn line at its real length, from the pitch of the face (or two faces) it borders.
  const lengths: Record<DrawnLineType, number> = noLengths()
  const measured: MeasuredLine[] = lines.map((l, li) => {
    let flat = 0, real = 0
    for (const i of stretches[li]) {
      const e = edges[i]
      const len = dist(nodes[e.u], nodes[e.v])
      const fa = faceOfHalf.get(`${i}:${e.u}`), fb = faceOfHalf.get(`${i}:${e.v}`)
      const pa = fa != null ? faces[fa].pitchOver12 / 12 : null
      const pb = fb != null ? faces[fb].pitchOver12 / 12 : null
      const d = o.defaultPitchOver12 / 12
      // A rake or step flashing climbs the face it edges; where it sits between two faces, the steeper is its own.
      const one = pa != null && pb != null ? Math.max(pa, pb) : pa ?? pb ?? d
      const factor = l.type === 'hip' || l.type === 'valley' ? slopeFactor(l.type, pa ?? pb ?? d, pb ?? pa ?? d) : slopeFactor(l.type, one, null)
      flat += len; real += len * factor
    }
    lengths[l.type] += real * M_TO_FT
    const at = groups.indexOf(groupOf(ends[li][0]))
    if (at >= 0) buildings[at].lengths[l.type] += real * M_TO_FT
    return { type: l.type, building: at >= 0 ? at : null, flatFt: Math.round(flat * M_TO_FT * 10) / 10, lengthFt: Math.round(real * M_TO_FT * 10) / 10 }
  })
  for (const k of Object.keys(lengths) as DrawnLineType[]) lengths[k] = Math.round(lengths[k] * 10) / 10
  for (const b of buildings) for (const k of Object.keys(b.lengths) as DrawnLineType[]) b.lengths[k] = Math.round(b.lengths[k] * 10) / 10

  // What a person should know about the drawing.
  const loose = edges.filter((_, i) => !live[i]).length
  if (!faces.length) warnings.push('The lines do not close into any roof face yet, so there is no area — finish the outline so every section is closed.')
  else if (loose) warnings.push(`${loose} line${loose === 1 ? ' does' : 's do'} not connect at both ends — check that the dots meet, or the area next to ${loose === 1 ? 'it' : 'them'} may be missing.`)
  const planSqft = faces.reduce((s, f) => s + f.planSqft, 0)
  const areaSqft = faces.reduce((s, f) => s + f.areaSqft, 0)
  return {
    faces, buildings, lines: measured, lengths,
    planSqft: Math.round(planSqft), areaSqft: Math.round(areaSqft), squares: Math.round(areaSqft) / 100, warnings,
  }
}

/** Whether a point is inside an outline. */
export function insideOutline(p: Pt, outline: Pt[]): boolean {
  let c = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/**
 * A point that is certainly inside an outline — for a label, or to say "this face" by position. The middle of an
 * L-shaped face can lie outside it, so where the average of the corners is not inside, the middle of a corner's own
 * triangle that is inside is used.
 */
export function interiorPoint(outline: Pt[]): Pt {
  const mid = { x: outline.reduce((s, p) => s + p.x, 0) / outline.length, y: outline.reduce((s, p) => s + p.y, 0) / outline.length }
  if (outline.length < 4 || insideOutline(mid, outline)) return mid
  let best = mid, bestArea = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[(i + outline.length - 1) % outline.length], b = outline[i], c = outline[(i + 1) % outline.length]
    const t = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y))
    if (area > bestArea && insideOutline(t, outline)) { best = t; bestArea = area }
  }
  return best
}

/** Latitude/longitude to the flat local grid the measuring works on (metres east and north of `origin`), and back. */
export function toLocal(p: { lat: number; lng: number }, origin: { lat: number; lng: number }): Pt {
  return { x: (p.lng - origin.lng) * 111_319.5 * Math.cos((origin.lat * Math.PI) / 180), y: (p.lat - origin.lat) * 111_319.5 }
}
export function toLatLng(p: Pt, origin: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: origin.lat + p.y / 111_319.5, lng: origin.lng + p.x / (111_319.5 * Math.cos((origin.lat * Math.PI) / 180)) }
}
