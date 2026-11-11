// The pitch of a face the roofer has drawn, read from the slope map that came with the picture (drawBackdrop.ts). Runs in
// the browser as the roofer draws, so it is plain arithmetic with no Node-only code.
import type { DrawBackdrop, LngLat } from './drawBackdrop.ts'

/** The slope map decoded once: slope east and north per cell (rise per run), NaN where nothing was readable. */
export interface DecodedPitchGrid { cols: number; rows: number; east: Float32Array; north: Float32Array }

export function decodePitchGrid(grid: DrawBackdrop['pitchGrid']): DecodedPitchGrid {
  const raw = Uint8Array.from(atob(grid.data), (ch) => ch.charCodeAt(0))
  const n = grid.cols * grid.rows
  const east = new Float32Array(n), north = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (raw[i * 2] << 24) >> 24, b = (raw[i * 2 + 1] << 24) >> 24
    east[i] = a === -128 ? NaN : a / 50
    north[i] = b === -128 ? NaN : b / 50
  }
  return { cols: grid.cols, rows: grid.rows, east, north }
}

/** Where a point falls on the picture: u across (0 left … 1 right), v down (0 top … 1 bottom). */
export function toPicture(p: LngLat, corners: DrawBackdrop['corners']): { u: number; v: number } {
  const [tl, tr, , bl] = corners
  // The picture is a (very slightly turned) rectangle, so its two edges from the top-left corner span it.
  const ax = tr.lng - tl.lng, ay = tr.lat - tl.lat, bx = bl.lng - tl.lng, by = bl.lat - tl.lat
  const px = p.lng - tl.lng, py = p.lat - tl.lat
  const det = ax * by - ay * bx
  return { u: (px * by - py * bx) / det, v: (ax * py - ay * px) / det }
}

/**
 * Which way the roof inside an outline faces (the downhill direction, as a compass bearing: 0 north, 90 east), or null
 * when too little of it could be read or it is too flat to face anywhere.
 */
export function facingInside(outline: LngLat[], grid: DecodedPitchGrid, corners: DrawBackdrop['corners']): number | null {
  if (outline.length < 3) return null
  const poly = outline.map((p) => { const { u, v } = toPicture(p, corners); return { x: u * grid.cols, y: v * grid.rows } })
  const x0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.x)))), x1 = Math.min(grid.cols - 1, Math.ceil(Math.max(...poly.map((p) => p.x))))
  const y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.y)))), y1 = Math.min(grid.rows - 1, Math.ceil(Math.max(...poly.map((p) => p.y))))
  let e = 0, n = 0, k = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5, cy = y + 0.5
      let c = false
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j]
        if ((a.y > cy) !== (b.y > cy) && cx < ((b.x - a.x) * (cy - a.y)) / (b.y - a.y) + a.x) c = !c
      }
      if (!c || Number.isNaN(grid.east[y * grid.cols + x])) continue
      e += grid.east[y * grid.cols + x]; n += grid.north[y * grid.cols + x]; k++
    }
  }
  if (k < 3 || Math.hypot(e / k, n / k) < 0.04) return null
  // The slope vector points uphill; the face looks the other way.
  return Math.round(((Math.atan2(-e, -n) * 180) / Math.PI + 360) % 360)
}

/**
 * The pitch (rise over 12) of the roof inside an outline, or null when too little of it could be read. Cells within
 * half a metre of the outline are the blur along ridges and edges, so the outline is read a little inside itself: a cell
 * counts only if it and its four neighbours are all inside.
 */
export function pitchInside(outline: LngLat[], grid: DecodedPitchGrid, corners: DrawBackdrop['corners']): number | null {
  if (outline.length < 3) return null
  const poly = outline.map((p) => { const { u, v } = toPicture(p, corners); return { x: u * grid.cols, y: v * grid.rows } })
  const inside = (x: number, y: number) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j]
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
    }
    return c
  }
  const x0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.x)))), x1 = Math.min(grid.cols - 1, Math.ceil(Math.max(...poly.map((p) => p.x))))
  const y0 = Math.max(0, Math.floor(Math.min(...poly.map((p) => p.y)))), y1 = Math.min(grid.rows - 1, Math.ceil(Math.max(...poly.map((p) => p.y))))
  const collect = (margin: number) => {
    const out: number[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = x + 0.5, cy = y + 0.5
        if (!inside(cx, cy)) continue
        if (margin && !(inside(cx - margin, cy) && inside(cx + margin, cy) && inside(cx, cy - margin) && inside(cx, cy + margin))) continue
        const e = grid.east[y * grid.cols + x], n = grid.north[y * grid.cols + x]
        if (Number.isNaN(e)) continue
        out.push(Math.hypot(e, n))
      }
    }
    return out
  }
  let slopes = collect(1)
  if (slopes.length < 6) slopes = collect(0) // a narrow face: take what there is
  if (slopes.length < 3) return null
  slopes.sort((a, b) => a - b)
  return Math.round(slopes[slopes.length >> 1] * 12 * 10) / 10
}
