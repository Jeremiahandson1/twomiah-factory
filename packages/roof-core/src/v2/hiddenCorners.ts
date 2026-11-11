// Roof engine v2: roof the mask leaves out because something stands over it — a tree across a corner, mostly.
//
// Google's roof mask stops where the tree starts, so the outline cuts straight across the corner and the roof under the
// tree is not counted. The lines layer already rebuilds such a cut as the square corner it stands in for; this does the
// same for the AREA.
//
// A pixel off the roof is taken as hidden roof when all of these hold:
//   · square corner — going one way along each of the house's two wall directions from it, roof is reached (it sits in
//     the notch between the two edges that would meet at the corner);
//   · a cut, not an inside corner — the roof starts again just past the line joining those two points. In the inside
//     corner of an L-shaped house the ground runs on to the corner itself;
//   · slanted — neither way ends head-on at a straight wall. A real edge is straight and square to the house; the
//     edge a tree leaves is not;
//   · on the faces, not past them — carried out to that spot, the plane of the face met each way is not below that
//     face's own low edge. Past a face's eave its plane runs on down toward the ground: that is the notch outside a
//     real inside corner (where a tree may well stand), not roof;
//   · something is over it — the height map there is not below those planes. Beside a real slanted wall the height map
//     drops to the ground, and nothing is added.
// Only a cut whose two legs are both at least `minLegM` long counts, so the stair-steps of a straight edge and the
// mask's rounded corners add nothing. 3 m is the scoreboard's answer (2026-11-11, 16 houses + one drawn by hand): at
// 1–2 m the rounded corners and trees standing in inside corners were filled too, and area read high (one house +6%).
//
// Used by the roofing CRM's instant estimator (apps/unified/server/crm/roof/reports/estimator.ts), through measureRoof, and by the scoreboard (packages/roof-core/bench).
import type { RoofFace } from './roofFaces.ts'

export interface HiddenCornerOptions {
  /** The longest leg of a cut corner that is believed (m). */
  maxLegM?: number
  /** A cut must have a spot where both legs are at least this long (m). */
  minLegM?: number
  /** How far below the roof's plane the height map may be and still count as "something over the roof" (m). */
  belowPlaneM?: number
  /** How far below a face's own low edge its plane may be at a spot that is still taken as that face (m). */
  pastEaveM?: number
}

export interface HiddenCorners {
  /** Per pixel, 1 where hidden roof was filled in. */
  mask: Uint8Array
  pixels: number
}

export function findHiddenCorners(
  labels: Int32Array, faces: RoofFace[], width: number, height: number, px: number, z: ArrayLike<number>, o: HiddenCornerOptions = {},
): HiddenCorners {
  const { maxLegM = 10, minLegM = 3, belowPlaneM = 1, pastEaveM = 0.3 } = o
  const n = width * height
  const mask = new Uint8Array(n)
  if (!faces.length) return { mask, pixels: 0 }

  // The house's two wall directions, from the way its faces tilt: a face runs downhill square to one wall. Directions a
  // quarter turn apart are the same answer, so they are averaged on four times the angle.
  let c4 = 0, s4 = 0
  for (const f of faces) {
    const slope = Math.hypot(f.plane.a, f.plane.b)
    if (slope < 0.03) continue
    const ang = Math.atan2(-f.plane.b, -f.plane.a)
    const weight = f.pixels * Math.min(1, slope / 0.1)
    c4 += weight * Math.cos(4 * ang); s4 += weight * Math.sin(4 * ang)
  }
  if (c4 === 0 && s4 === 0) return { mask, pixels: 0 }
  const theta = Math.atan2(s4, c4) / 4
  // In pixel steps: east is +x, north is −y.
  const dirs: Array<[number, number]> = [
    [Math.cos(theta), -Math.sin(theta)], [-Math.cos(theta), Math.sin(theta)],
    [-Math.sin(theta), -Math.cos(theta)], [Math.sin(theta), Math.cos(theta)],
  ]

  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let i = 0; i < n; i++) {
    if (labels[i] === -1) continue
    const x = i % width, y = (i / width) | 0
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  if (x1 < 0) return { mask, pixels: 0 }

  const isRoof = (fx: number, fy: number) => {
    const x = Math.round(fx), y = Math.round(fy)
    return x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] !== -1
  }
  const maxSteps = Math.round((maxLegM / px) * 2)
  /** Distance (pixels) from (x, y) along a direction to the first roof pixel, or −1. */
  const reach = (x: number, y: number, d: [number, number]): number => {
    for (let k = 1; k <= maxSteps; k++) if (isRoof(x + d[0] * k * 0.5, y + d[1] * k * 0.5)) return k * 0.5
    return -1
  }
  // Each face's low edge: the height its plane has at its lowest pixels (the 2nd percentile, so a stray pixel does not set it).
  const heights: number[][] = faces.map(() => [])
  for (let i = 0; i < n; i++) {
    const l = labels[i]
    if (l < 0) continue
    const p = faces[l].plane
    heights[l].push(p.a * (i % width) * px + p.b * -((i / width) | 0) * px + p.c)
  }
  const lowEdge = heights.map((hs) => { hs.sort((a, b) => a - b); return hs.length ? hs[Math.floor(hs.length * 0.02)] : Infinity })
  /** The first face met from (x, y) along a direction, starting `from` pixels out and looking up to 2 m on; −1 if none. */
  const faceAlong = (x: number, y: number, d: [number, number], from: number): number => {
    const more = Math.round(2 / px)
    for (let k = 0; k <= more; k++) {
      const xx = Math.round(x + d[0] * (from + k)), yy = Math.round(y + d[1] * (from + k))
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) return -1
      const l = labels[yy * width + xx]
      if (l >= 0) return l
    }
    return -1
  }

  /** Is the roof met head-on at a straight wall? `d` is the way travelled, `side` the direction square to it, `from`
   *  the distance out (pixels). A wall square to the way travelled is still there 1.5 m to either side at the same
   *  distance; a cut across a corner has slanted away by then. */
  const sidePx = 1.5 / px
  const straightWall = (x: number, y: number, d: [number, number], side: [number, number], from: number): boolean => {
    for (const s of [-sidePx, sidePx]) {
      const bx = x + d[0] * from + side[0] * s, by = y + d[1] * from + side[1] * s
      if (!isRoof(bx + d[0] * 2, by + d[1] * 2) || isRoof(bx - d[0] * 2, by - d[1] * 2)) return false
    }
    return true
  }

  const candidate = new Uint8Array(n)
  const seed = new Uint8Array(n)
  const minLegPx = minLegM / px
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x
      if (labels[i] !== -1) continue
      const zi = z[i]
      if (!Number.isFinite(zi)) continue
      const r = dirs.map((d) => reach(x, y, d))
      for (const iu of [0, 1]) {
        for (const iv of [2, 3]) {
          const a = r[iu], b = r[iv]
          if (a < 0 || b < 0) continue
          const du = dirs[iu], dv = dirs[iv]
          // A cut, not an inside corner: past the line joining the two points reached, it is roof again.
          if (!isRoof(x + 0.75 * (a * du[0] + b * dv[0]), y + 0.75 * (a * du[1] + b * dv[1]))) continue
          // A slanted cut, not a real edge: neither way ends head-on at a straight wall.
          if (straightWall(x, y, du, dv, a) || straightWall(x, y, dv, du, b)) continue
          // On the faces met each way, not out past their low edges; and something stands over it.
          const met = [faceAlong(x, y, du, a), faceAlong(x, y, dv, b)].filter((l) => l >= 0)
          if (!met.length) continue
          const e = x * px, nn = -y * px
          let lowest = Infinity, past = false
          for (const l of met) {
            const p = faces[l].plane
            const zp = p.a * e + p.b * nn + p.c
            if (zp < lowEdge[l] - pastEaveM) past = true
            if (zp < lowest) lowest = zp
          }
          if (past || zi < lowest - belowPlaneM) continue
          candidate[i] = 1
          if (a >= minLegPx && b >= minLegPx) seed[i] = 1
        }
      }
    }
  }

  // Keep each connected clump of candidates that holds a real cut (a seed).
  const seen = new Uint8Array(n)
  let pixels = 0
  const stack: number[] = []
  for (let s = 0; s < n; s++) {
    if (!seed[s] || seen[s]) continue
    seen[s] = 1; stack.length = 0; stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      mask[i] = 1; pixels++
      const x = i % width
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= n || seen[j] || !candidate[j]) continue
        seen[j] = 1; stack.push(j)
      }
    }
  }
  return { mask, pixels }
}
