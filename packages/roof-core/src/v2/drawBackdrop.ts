// What the draw-it-yourself screen needs from Google's data layers for one address, besides the aerial picture itself:
//   · where the picture sits on the earth — its four corners in latitude/longitude, exactly, so a line drawn on it
//     measures true;
//   · a coarse map of the roof's slope under the picture, so each face the roofer draws can be given its pitch without
//     anyone climbing up (the roofer can still overrule it from a pitch gauge).
//
// Google's rasters are in UTM (metres on a grid that is very slightly turned from true north); the corners are converted
// properly rather than assumed square to the compass.
import { fromArrayBuffer } from 'geotiff'
import { readRaster, patchSlopes } from './roofSurface.ts'

export interface LngLat { lng: number; lat: number }

export interface PitchGrid {
  cols: number
  rows: number
  /** Base64 of cols×rows×2 signed bytes: slope east and slope north (rise per run) × 50; −128 = nothing readable there. */
  data: string
}

export interface DrawBackdrop {
  /** The picture's corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [LngLat, LngLat, LngLat, LngLat]
  /** The picture's centre — the address the data was asked for. */
  center: LngLat
  /** Ground size of the picture, metres. */
  widthM: number
  heightM: number
  /** Slope under the picture, on a grid laid over it corner to corner (row 0 at the top). */
  pitchGrid: PitchGrid
}

/** UTM easting/northing (WGS84) to latitude/longitude. */
export function utmToLngLat(easting: number, northing: number, zone: number, northern: boolean): LngLat {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2)
  const x = easting - 500000
  const y = northern ? northing : northing - 10000000
  const m = y / k0
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1)
  const n1 = a / Math.sqrt(1 - e2 * sin1 * sin1)
  const t1 = tan1 * tan1, c1 = ep2 * cos1 * cos1
  const r1 = (a * (1 - e2)) / (1 - e2 * sin1 * sin1) ** 1.5
  const d = x / (n1 * k0)
  const lat = phi1 - ((n1 * tan1) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720)
  const lng = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / cos1
  return { lat: (lat * 180) / Math.PI, lng: (zone - 1) * 6 - 180 + 3 + (lng * 180) / Math.PI }
}

/** The four corners of a GeoTIFF in latitude/longitude, whatever grid it is on. */
export async function rasterCorners(buffer: Buffer): Promise<{ corners: DrawBackdrop['corners']; widthM: number; heightM: number }> {
  const ab = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice().buffer
  const image = await (await fromArrayBuffer(ab)).getImage()
  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const epsg = Number((image.getGeoKeys() as any)?.ProjectedCSTypeGeoKey || 0)
  const utm = epsg >= 32601 && epsg <= 32660 ? { zone: epsg - 32600, north: true } : epsg >= 32701 && epsg <= 32760 ? { zone: epsg - 32700, north: false } : null
  if (!utm) {
    // Already latitude/longitude (values within ±360), or a grid this does not know: only the first can be used.
    if (Math.abs(minX) > 360 || Math.abs(maxY) > 360) throw new Error(`aerial data is on an unsupported map grid (EPSG ${epsg || 'unknown'})`)
    const midLat = ((minY + maxY) / 2) * (Math.PI / 180)
    return {
      corners: [{ lng: minX, lat: maxY }, { lng: maxX, lat: maxY }, { lng: maxX, lat: minY }, { lng: minX, lat: minY }],
      widthM: (maxX - minX) * 111_319.5 * Math.cos(midLat), heightM: (maxY - minY) * 111_319.5,
    }
  }
  const at = (e: number, n: number) => utmToLngLat(e, n, utm.zone, utm.north)
  return { corners: [at(minX, maxY), at(maxX, maxY), at(maxX, minY), at(minX, minY)], widthM: maxX - minX, heightM: maxY - minY }
}

/** The slope map: one cell per `cellM` of ground, each the average slope of the roof pixels in it. */
export async function buildPitchGrid(dsmBuffer: Buffer, maskBuffer: Buffer, cellM = 0.5): Promise<PitchGrid> {
  const [dsm, mask] = await Promise.all([readRaster(dsmBuffer), readRaster(maskBuffer)])
  if (dsm.width !== mask.width || dsm.height !== mask.height) throw new Error('height map and roof mask are not on the same grid')
  const roof = new Uint8Array(dsm.width * dsm.height)
  for (let i = 0; i < roof.length; i++) roof[i] = mask.data[i] ? 1 : 0
  const { slopeX, slopeY } = patchSlopes(dsm, roof, 0.75, 0.06)
  const step = Math.max(1, Math.round(cellM / dsm.px))
  const cols = Math.ceil(dsm.width / step), rows = Math.ceil(dsm.height / step)
  const bytes = new Int8Array(cols * rows * 2).fill(-128)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sx = 0, sy = 0, k = 0
      for (let y = r * step; y < Math.min(dsm.height, (r + 1) * step); y++) {
        for (let x = c * step; x < Math.min(dsm.width, (c + 1) * step); x++) {
          const i = y * dsm.width + x
          if (Number.isNaN(slopeX[i]) || Math.hypot(slopeX[i], slopeY[i]) > 2) continue
          sx += slopeX[i]; sy += slopeY[i]; k++
        }
      }
      if (!k) continue
      const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 50)))
      bytes[(r * cols + c) * 2] = q(sx / k)
      bytes[(r * cols + c) * 2 + 1] = q(sy / k)
    }
  }
  return { cols, rows, data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }
}

/** Everything the drawing screen needs to place the picture and read pitch, from one address's data layers. */
export async function prepareDrawBackdrop(dsmBuffer: Buffer, maskBuffer: Buffer): Promise<DrawBackdrop> {
  const [{ corners, widthM, heightM }, pitchGrid] = await Promise.all([rasterCorners(dsmBuffer), buildPitchGrid(dsmBuffer, maskBuffer)])
  const center = { lng: (corners[0].lng + corners[1].lng + corners[2].lng + corners[3].lng) / 4, lat: (corners[0].lat + corners[1].lat + corners[2].lat + corners[3].lat) / 4 }
  return { corners, center, widthM, heightM, pitchGrid }
}
