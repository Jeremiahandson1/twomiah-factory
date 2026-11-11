// Roof engine v2, first layer: the roof's SURFACE from Google's height map — which building, how much roof on the
// slope, and at what pitches. No faces or lines yet; those are built on top of this.
//
// Why it starts here: on the houses measured so far, Google's roof mask under the pin matches a professionally measured
// footprint within a few percent, while Google's own "roof area" figure runs as much as half short. So area is taken from
// the mask and the height map directly: every roof pixel contributes its flat size times the slope factor of the small
// patch of roof around it.
//
// Not wired into the product: nothing imports this but the scoreboard (packages/roof-core/bench).
import { fromArrayBuffer } from 'geotiff'

const SQM_TO_SQFT = 10.7639

export interface Raster {
  width: number
  height: number
  /** Metres per pixel. */
  px: number
  data: ArrayLike<number>
}

export interface RoofSurface {
  /** False when the pin was not on a roof and the nearest roof was taken instead — a person should confirm the building. */
  pinOnRoof: boolean
  /** How far the chosen roof's nearest pixel is from the pin, metres (0 when the pin is on it). */
  pinDistanceM: number
  /** Flat (plan) area of the chosen roof, square feet. */
  planSqft: number
  /** Area on the slope, square feet. */
  slopeSqft: number
  /** Share of roof pixels whose own patch gave a trustworthy slope (0–1); the rest took the roof's typical slope. */
  confidentShare: number
  /** Slope area by pitch (rise over 12, rounded), largest first. */
  pitches: Array<{ pitchOver12: number; areaSqft: number }>
  /** The chosen roof as a pixel mask on the raster's grid (1 = roof), for the layers built on this one. */
  roof: Uint8Array
  /** Per roof pixel, the slope of its patch: dz/dx (east) and dz/dy (north), NaN where not trustworthy. */
  slopeX: Float32Array
  slopeY: Float32Array
}

export async function readRaster(buffer: Buffer): Promise<Raster> {
  const ab = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice().buffer
  const image = await (await fromArrayBuffer(ab)).getImage()
  const width = image.getWidth()
  const height = image.getHeight()
  const bbox = image.getBoundingBox()
  const data = (await image.readRasters())[0] as unknown as ArrayLike<number>
  return { width, height, px: (bbox[2] - bbox[0]) / width, data }
}

/**
 * The roof the pin means: the connected roof blob under the pin (the raster's centre — the data is requested centred on
 * the address), or the nearest one when the pin is on the ground. Blobs under 4 m² are specks, not roofs.
 */
export function pickRoof(mask: Raster): { roof: Uint8Array; pinOnRoof: boolean; pinDistanceM: number; pixels: number } | null {
  const { width: w, height: h, data, px } = mask
  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!data[s] || label[s] >= 0) continue
    const id = sizes.length
    let n = 0
    label[s] = id; stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      n++
      const x = i % w, y = (i / w) | 0
      if (x > 0 && data[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack.push(i - 1) }
      if (x < w - 1 && data[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack.push(i + 1) }
      if (y > 0 && data[i - w] && label[i - w] < 0) { label[i - w] = id; stack.push(i - w) }
      if (y < h - 1 && data[i + w] && label[i + w] < 0) { label[i + w] = id; stack.push(i + w) }
    }
    sizes.push(n)
  }
  const minPixels = 4 / (px * px)
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2)
  let chosen = label[cy * w + cx]
  let pinOnRoof = chosen >= 0 && sizes[chosen] >= minPixels
  let best = Infinity
  if (!pinOnRoof) {
    chosen = -1
    for (let i = 0; i < w * h; i++) {
      const id = label[i]
      if (id < 0 || sizes[id] < minPixels) continue
      const d = (i % w - cx) ** 2 + (((i / w) | 0) - cy) ** 2
      if (d < best) { best = d; chosen = id }
    }
  }
  if (chosen < 0) return null
  const roof = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) if (label[i] === chosen) roof[i] = 1
  return { roof, pinOnRoof, pinDistanceM: pinOnRoof ? 0 : Math.sqrt(best) * px, pixels: sizes[chosen] }
}

/**
 * The slope of the roof at every roof pixel: a plane fitted (least squares) to the heights of the roof pixels within
 * `patchM` of it. A patch that straddles a ridge, a valley, a chimney or the roof's edge does not fit a plane; its
 * pixel is marked untrustworthy (NaN) rather than given a wrong slope.
 */
export function patchSlopes(dsm: Raster, roof: Uint8Array, patchM = 0.45, maxMisfitM = 0.06) {
  const { width: w, height: h, data: z, px } = dsm
  const r = Math.max(2, Math.round(patchM / px))
  const slopeX = new Float32Array(w * h).fill(NaN)
  const slopeY = new Float32Array(w * h).fill(NaN)
  const minPts = Math.floor((2 * r + 1) ** 2 * 0.6)
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x
      if (!roof[i]) continue
      // Sums for z = a·dx + b·dy + c over the patch (dx, dy in pixels, centred on this pixel).
      let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const j = i + dy * w + dx
          if (!roof[j]) continue
          const v = z[j]
          n++; sx += dx; sy += dy; sz += v; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * v; syz += dy * v
        }
      }
      if (n < minPts) continue
      const mx = sx / n, my = sy / n, mz = sz / n
      const cxx = sxx - n * mx * mx, cyy = syy - n * my * my, cxy = sxy - n * mx * my
      const cxz = sxz - n * mx * mz, cyz = syz - n * my * mz
      const det = cxx * cyy - cxy * cxy
      if (Math.abs(det) < 1e-9) continue
      const a = (cyy * cxz - cxy * cyz) / det
      const b = (cxx * cyz - cxy * cxz) / det
      // Misfit: root-mean-square height error of the patch against its plane.
      let err = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const j = i + dy * w + dx
          if (!roof[j]) continue
          const e = z[j] - (mz + a * (dx - mx) + b * (dy - my))
          err += e * e
        }
      }
      // Per pixel → per metre; image rows run south, so north is −dy.
      const ax = a / px, by = -b / px
      // The height map is a little off sideways as well as up and down, and on a steep roof a sideways error shows as
      // a height error — so the allowed misfit grows with the slope.
      if (Math.sqrt(err / n) > maxMisfitM * Math.sqrt(1 + ax * ax + by * by)) continue
      slopeX[i] = ax
      slopeY[i] = by
    }
  }
  return { slopeX, slopeY }
}

/** The roof's surface for the address the rasters are centred on. */
export async function measureRoofSurface(dsmBuffer: Buffer, maskBuffer: Buffer): Promise<RoofSurface | null> {
  const [dsm, mask] = await Promise.all([readRaster(dsmBuffer), readRaster(maskBuffer)])
  if (dsm.width !== mask.width || dsm.height !== mask.height) throw new Error('height map and roof mask are not on the same grid')
  const picked = pickRoof(mask)
  if (!picked) return null
  const { slopeX, slopeY } = patchSlopes(dsm, picked.roof)

  const n = dsm.width * dsm.height
  const pixelSqft = dsm.px * dsm.px * SQM_TO_SQFT
  // A steeper reading than 24/12 is a wall or a tree edge, not roof.
  const MAX_SLOPE = 2
  const factors: number[] = []
  for (let i = 0; i < n; i++) {
    if (!picked.roof[i] || Number.isNaN(slopeX[i])) continue
    const s = Math.hypot(slopeX[i], slopeY[i])
    if (s > MAX_SLOPE) { slopeX[i] = NaN; slopeY[i] = NaN; continue }
    factors.push(Math.sqrt(1 + s * s))
  }
  const typicalFactor = factors.length ? factors.reduce((a, b) => a + b, 0) / factors.length : 1
  const byPitch = new Map<number, number>()
  let slopeSqft = 0
  for (let i = 0; i < n; i++) {
    if (!picked.roof[i]) continue
    if (Number.isNaN(slopeX[i])) { slopeSqft += pixelSqft * typicalFactor; continue }
    const s = Math.hypot(slopeX[i], slopeY[i])
    const a = pixelSqft * Math.sqrt(1 + s * s)
    slopeSqft += a
    const pitch = Math.round(s * 12)
    byPitch.set(pitch, (byPitch.get(pitch) || 0) + a)
  }
  // The untrustworthy pixels' area is shared out over the pitches found, in proportion.
  const known = [...byPitch.values()].reduce((a, b) => a + b, 0)
  const scale = known > 0 ? slopeSqft / known : 1
  return {
    pinOnRoof: picked.pinOnRoof,
    pinDistanceM: Math.round(picked.pinDistanceM * 10) / 10,
    planSqft: Math.round(picked.pixels * pixelSqft),
    slopeSqft: Math.round(slopeSqft),
    confidentShare: factors.length / picked.pixels,
    pitches: [...byPitch.entries()].map(([pitchOver12, a]) => ({ pitchOver12, areaSqft: Math.round(a * scale) })).sort((a, b) => b.areaSqft - a.areaSqft),
    roof: picked.roof, slopeX, slopeY,
  }
}
