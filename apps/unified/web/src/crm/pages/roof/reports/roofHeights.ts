// How high each corner of a roof stands, worked out from the roof itself for the 3D view: every section is a flat plane
// with a pitch and a direction it faces, sections that share a corner share its height, and eaves sit at the bottom.
// (The 3D view used to read heights from a server grid whose cells were 11 metres across — one or two cells per house —
// so every roof came out flat.)
//
// Each side of each section says how much higher one corner is than the next (pitch × how far uphill it runs). Those
// are settled together, so a hip or a ridge two sections share ends at one height that suits both.

export interface HeightSegment {
  polygon?: Array<{ lat: number; lng: number }>
  pitchDegrees?: number | null
  /** Compass bearing of the downhill side (0 north, 90 east); a section without one is carried by its neighbours. */
  azimuthDegrees?: number | null
}
export interface HeightEdge { type: string; startLat: number; startLng: number; endLat: number; endLng: number }

const METERS_PER_DEG = 111_319.5
/** Corners closer than this are one corner, metres. */
const SAME_M = 0.15

export interface RoofHeights {
  /** Height above the eaves at a point, metres. */
  heightAt: (lat: number, lng: number) => number
  /** The tallest point, metres. */
  topM: number
}

export function solveRoofHeights(segments: HeightSegment[], edges: HeightEdge[], center: { lat: number; lng: number }): RoofHeights {
  const cosLat = Math.cos((center.lat * Math.PI) / 180)
  const local = (lat: number, lng: number) => ({ x: (lng - center.lng) * METERS_PER_DEG * cosLat, y: (lat - center.lat) * METERS_PER_DEG })

  // The corners, merged where sections meet.
  const corners: Array<{ x: number; y: number; z: number; fixed: boolean }> = []
  const cornerOf = (p: { x: number; y: number }) => {
    for (let i = 0; i < corners.length; i++) if (Math.hypot(corners[i].x - p.x, corners[i].y - p.y) < SAME_M) return i
    corners.push({ x: p.x, y: p.y, z: 0, fixed: false })
    return corners.length - 1
  }

  interface Face { ids: number[]; pts: Array<{ x: number; y: number }>; gx: number; gy: number; sloped: boolean }
  const faces: Face[] = []
  /** z[b] − z[a] = rise */
  const rises: Array<{ a: number; b: number; rise: number }> = []
  for (const seg of segments) {
    if (!seg.polygon || seg.polygon.length < 3) continue
    const pts = seg.polygon.map((p) => local(p.lat, p.lng))
    const ids = pts.map(cornerOf)
    const az = seg.azimuthDegrees, pitch = seg.pitchDegrees
    const sloped = typeof az === 'number' && Number.isFinite(az) && typeof pitch === 'number' && Number.isFinite(pitch)
    // Uphill is away from the way the section faces.
    const t = sloped ? Math.tan(((pitch as number) * Math.PI) / 180) : 0
    const gx = sloped ? -Math.sin(((az as number) * Math.PI) / 180) * t : 0
    const gy = sloped ? -Math.cos(((az as number) * Math.PI) / 180) * t : 0
    faces.push({ ids, pts, gx, gy, sloped })
    if (!sloped) continue
    for (let i = 0; i < ids.length; i++) {
      const j = (i + 1) % ids.length
      if (ids[i] === ids[j]) continue
      rises.push({ a: ids[i], b: ids[j], rise: gx * (pts[j].x - pts[i].x) + gy * (pts[j].y - pts[i].y) })
    }
  }

  // Corners on an eave are the bottom of the roof.
  for (const e of edges) {
    if (e.type !== 'eave') continue
    const a = local(e.startLat, e.startLng), b = local(e.endLat, e.endLng)
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1
    for (const c of corners) {
      const k = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2))
      if (Math.hypot(a.x + k * dx - c.x, a.y + k * dy - c.y) < SAME_M) c.fixed = true
    }
  }

  // Settle: each free corner moves to the average of what its sides say it should be.
  const touching: Array<Array<{ other: number; add: number }>> = corners.map(() => [])
  for (const r of rises) { touching[r.b].push({ other: r.a, add: r.rise }); touching[r.a].push({ other: r.b, add: -r.rise }) }
  for (let sweep = 0; sweep < 400; sweep++) {
    let moved = 0
    for (let i = 0; i < corners.length; i++) {
      if (corners[i].fixed || touching[i].length === 0) continue
      let sum = 0
      for (const t of touching[i]) sum += corners[t.other].z + t.add
      const z = sum / touching[i].length
      moved = Math.max(moved, Math.abs(z - corners[i].z))
      corners[i].z = z
    }
    if (moved < 0.001) break
  }
  // The lowest corner is the ground line of the picture.
  const low = corners.reduce((m, c) => Math.min(m, c.z), Infinity)
  if (Number.isFinite(low)) for (const c of corners) c.z -= low
  const topM = corners.reduce((m, c) => Math.max(m, c.z), 0)

  const inside = (p: { x: number; y: number }, poly: Array<{ x: number; y: number }>) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j]
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
    }
    return c
  }

  const heightAt = (lat: number, lng: number) => {
    if (corners.length === 0) return 0
    const p = local(lat, lng)
    let near = 0, nearD = Infinity
    for (let i = 0; i < corners.length; i++) {
      const d = Math.hypot(corners[i].x - p.x, corners[i].y - p.y)
      if (d < nearD) { nearD = d; near = i }
    }
    if (nearD < SAME_M * 2) return corners[near].z
    // Part-way along a section: on that section's plane, from one of its corners.
    for (const f of faces) {
      if (!inside(p, f.pts)) continue
      if (!f.sloped) return f.ids.reduce((s, id) => s + corners[id].z, 0) / f.ids.length
      return Math.max(0, corners[f.ids[0]].z + f.gx * (p.x - f.pts[0].x) + f.gy * (p.y - f.pts[0].y))
    }
    return corners[near].z
  }

  return { heightAt, topM }
}
