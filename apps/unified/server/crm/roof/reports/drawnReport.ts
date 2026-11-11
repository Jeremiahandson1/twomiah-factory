// The draw-it-yourself roof report: the roofer picks a line type, clicks dot to dot over the aerial picture and presses
// Done; the report's area, pitches and lengths are worked out from what was drawn (packages/roof-core/src/v2/drawnRoof).
//
// Two steps, as the hand-drawn report always had:
//   · the backdrop — for an address: the aerial picture, exactly where it sits on the earth, and a map of the roof's
//     slope under it so each face drawn can be given its pitch (the roofer may overrule it from a pitch gauge);
//   · the report — the roofer's lines and pitches in, measured HERE and saved. The figures a report is saved with are
//     the server's own arithmetic on the lines, never numbers the browser sent.
//
// One Google Solar data-layers call per backdrop; nothing is charged for the report.
import crypto from 'node:crypto'
import sharp from 'sharp'
import { geocodeAddress, getDataLayers, downloadGeoTiff, formatSolarDate } from '@twomiah/roof-core'
import { prepareDrawBackdrop, type DrawBackdrop } from '@twomiah/roof-core/src/v2/drawBackdrop.ts'
import { measureDrawnRoof, toLocal, toLatLng, type DrawnLine, type DrawnLineType, type Pt } from '@twomiah/roof-core/src/v2/drawnRoof.ts'
import type { CrmDeps } from '../../deps.ts'
import { imageryPrefix } from './roofReportService.ts'

export const DRAWN_LINE_TYPES: DrawnLineType[] = ['eave', 'rake', 'ridge', 'hip', 'valley', 'flash', 'stepflash']
/** Waste on a drawn report unless the roofer says otherwise: the trade's standard ten percent. */
export const DEFAULT_WASTE_PCT = 10
/** How much ground the picture covers each way from the address, metres. */
const RADIUS_M = 50
const MAX_LINES = 600

export interface DrawnBackdropReply {
  geo: { lat: number; lng: number }
  quality: string
  imageryDate: string | null
  /** The stored aerial's key (this company's), saved with the report. */
  aerialImagePath: string | null
  /** The same picture for the drawing screen, as a data URL. */
  aerialImage: string
  backdrop: DrawBackdrop
}

export interface DrawnInput {
  lines: Array<{ type: string; startLat: number; startLng: number; endLat: number; endLng: number }>
  /** A pitch the roofer set (or accepted) for a face, located by any point inside that face. */
  facePitches?: Array<{ lat: number; lng: number; pitchOver12: number }>
  /** Which way a face looks (compass bearing of its downhill side), located the same way; for the report's table. */
  faceFacings?: Array<{ lat: number; lng: number; azimuthDeg: number }>
  /** What the roofer called a building ("House", "Garage"), located by any point inside one of its faces. */
  buildingNames?: Array<{ lat: number; lng: number; name: string }>
  defaultPitchOver12: number
  wastePct?: number
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const inside = (p: Pt, poly: Pt[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

/** What is wrong with a drawing as sent, as a sentence for the screen; null when it can be measured. */
export function drawnInputProblem(input: any): string | null {
  if (!input || !Array.isArray(input.lines) || input.lines.length === 0) return 'Draw at least one line before creating the report.'
  if (input.lines.length > MAX_LINES) return `A report holds up to ${MAX_LINES} lines.`
  for (const l of input.lines) {
    if (!DRAWN_LINE_TYPES.includes(l?.type)) return 'One of the lines has no type. Pick eave, rake, ridge, hip, valley or flashing for each line.'
    for (const k of ['startLat', 'startLng', 'endLat', 'endLng']) if (num(l[k]) === null) return 'One of the lines is missing a point. Redraw it.'
    if (Math.abs(l.startLat) > 90 || Math.abs(l.endLat) > 90 || Math.abs(l.startLng) > 180 || Math.abs(l.endLng) > 180) return 'One of the lines is off the map. Redraw it.'
  }
  const p = num(input.defaultPitchOver12)
  if (p === null || p < 0 || p > 24) return 'Enter the roof\'s pitch as a rise over 12 between 0 and 24.'
  if (input.facePitches !== undefined) {
    if (!Array.isArray(input.facePitches) || input.facePitches.length > MAX_LINES) return 'The section pitches could not be read. Set them again.'
    for (const f of input.facePitches) {
      const fp = num(f?.pitchOver12)
      if (num(f?.lat) === null || num(f?.lng) === null || fp === null || fp < 0 || fp > 24) return 'A section\'s pitch must be a rise over 12 between 0 and 24.'
    }
  }
  if (input.faceFacings !== undefined) {
    if (!Array.isArray(input.faceFacings) || input.faceFacings.length > MAX_LINES) return 'The section directions could not be read. Draw the roof again.'
    for (const f of input.faceFacings) {
      const az = num(f?.azimuthDeg)
      if (num(f?.lat) === null || num(f?.lng) === null || az === null || az < 0 || az > 360) return 'The section directions could not be read. Draw the roof again.'
    }
  }
  if (input.buildingNames !== undefined) {
    if (!Array.isArray(input.buildingNames) || input.buildingNames.length > 50) return 'The building names could not be read. Name them again.'
    for (const b of input.buildingNames) {
      if (num(b?.lat) === null || num(b?.lng) === null || typeof b?.name !== 'string' || b.name.length > 40) return 'A building\'s name can be up to 40 characters.'
    }
  }
  if (input.wastePct !== undefined) {
    const w = num(input.wastePct)
    if (w === null || w < 0 || w > 50) return 'Waste must be between 0 and 50 percent.'
  }
  return null
}

/** The roofer's drawing measured: the report's faces, lines and totals in the shapes a roof report is stored in. */
export function measureDrawing(input: DrawnInput, origin: { lat: number; lng: number }) {
  const lines: DrawnLine[] = input.lines.map((l) => ({
    type: l.type as DrawnLineType,
    a: toLocal({ lat: l.startLat, lng: l.startLng }, origin), b: toLocal({ lat: l.endLat, lng: l.endLng }, origin),
  }))
  const set = (input.facePitches || []).map((f) => ({ at: toLocal({ lat: f.lat, lng: f.lng }, origin), pitch: f.pitchOver12 }))
  const roof = measureDrawnRoof(lines, {
    defaultPitchOver12: input.defaultPitchOver12,
    pitchOfFace: (outline) => set.find((f) => inside(f.at, outline))?.pitch ?? null,
  })
  const facings = (input.faceFacings || []).map((f) => ({ at: toLocal({ lat: f.lat, lng: f.lng }, origin), azimuthDeg: Math.round(f.azimuthDeg) % 360 }))
  const wastePct = input.wastePct ?? DEFAULT_WASTE_PCT
  const L = roof.lengths
  const r1 = (n: number) => Math.round(n * 10) / 10
  // A house and a detached garage drawn on one picture are two buildings, each with its own total.
  const named = (input.buildingNames || []).map((b) => ({ at: toLocal({ lat: b.lat, lng: b.lng }, origin), name: b.name.trim() })).filter((b) => b.name)
  const sq2 = (n: number) => Math.round(n * 100) / 100
  const buildings = roof.buildings.map((b, i) => ({
    name: named.find((n) => b.faces.some((fi) => inside(n.at, roof.faces[fi].outline)))?.name || `Building ${i + 1}`,
    sections: b.faces.length, areaSqft: b.areaSqft, squares: b.squares, squaresWithWaste: sq2(b.squares * (1 + wastePct / 100)),
    eaveLF: b.lengths.eave, rakeLF: b.lengths.rake, ridgeLF: b.lengths.ridge, hipLF: b.lengths.hip, valleyLF: b.lengths.valley,
    flashLF: b.lengths.flash, stepFlashLF: b.lengths.stepflash,
  }))
  const several = buildings.length > 1
  const segments = roof.faces.map((f, i) => ({
    name: several ? `${buildings[f.building].name}, section ${i + 1}` : `Section ${i + 1}`, building: f.building, area: Math.round(f.areaSqft), planSqft: Math.round(f.planSqft),
    pitch: `${Number.isInteger(f.pitchOver12) ? f.pitchOver12 : f.pitchOver12.toFixed(1)}/12`,
    pitchDegrees: r1((Math.atan(f.pitchOver12 / 12) * 180) / Math.PI), pitchFrom: f.pitchFrom,
    azimuthDegrees: facings.find((x) => inside(x.at, f.outline))?.azimuthDeg ?? null,
    polygon: f.outline.map((p) => toLatLng(p, origin)),
  }))
  const edges = input.lines.map((l, i) => ({
    type: l.type, lengthFt: roof.lines[i]?.lengthFt ?? 0, flatFt: roof.lines[i]?.flatFt ?? 0,
    startLat: l.startLat, startLng: l.startLng, endLat: l.endLat, endLng: l.endLng,
  }))
  const totalSquares = Math.round(roof.areaSqft) / 100
  const measurements = {
    source: 'drawn',
    totalAreaSqft: roof.areaSqft, totalSquares,
    ridgeLF: L.ridge, valleyLF: L.valley, hipLF: L.hip, rakeLF: L.rake, eaveLF: L.eave,
    flashLF: L.flash, stepFlashLF: L.stepflash,
    totalPerimeterLF: r1(L.rake + L.eave),
    wasteFactor: wastePct, squaresWithWaste: Math.round(totalSquares * (1 + wastePct / 100) * 100) / 100,
    // Two rows (6 ft) along every eave and one 3 ft roll down every valley.
    iceWaterShieldSqft: Math.round(L.eave * 6 + L.valley * 3),
    defaultPitchOver12: input.defaultPitchOver12,
    // Present only when more than one building was drawn; the totals above are all of them together.
    ...(several ? { buildings } : {}),
    warnings: roof.warnings,
  }
  return { roof, segments, edges, measurements }
}

export function createDrawnReportService(d: CrmDeps) {
  const { logger } = d

  /** The backdrop for an address: one Google Solar data-layers call. */
  async function backdropFor(companyId: string, address: string, city: string, state: string, zip: string): Promise<DrawnBackdropReply> {
    const geo = await geocodeAddress(address, city, state, zip)
    // 0.1 m pixels: the aerial picture is that sharp (the height map is coarser however it is asked for).
    const layers = await getDataLayers(geo.lat, geo.lng, RADIUS_M, 0.1)
    const [rgbTif, dsmTif, maskTif] = await Promise.all([downloadGeoTiff(layers.rgbUrl), downloadGeoTiff(layers.dsmUrl), downloadGeoTiff(layers.maskUrl)])
    const backdrop = await prepareDrawBackdrop(dsmTif, maskTif)
    const png = await sharp(rgbTif).png().toBuffer()
    const jpeg = await sharp(rgbTif).jpeg({ quality: 85 }).toBuffer()
    let aerialImagePath: string | null = `${imageryPrefix(companyId)}${Date.now()}-${crypto.randomBytes(4).toString('hex')}-aerial.png`
    try { await d.services.storage.put(aerialImagePath, png, 'image/png') } catch (err: any) {
      // The picture is for the saved report's page; a report is still drawn and measured without it.
      logger.warn('Drawn roof report: aerial not stored (non-blocking)', { error: err?.message })
      aerialImagePath = null
    }
    return {
      geo: { lat: geo.lat, lng: geo.lng },
      quality: layers.imageryQuality || 'MEDIUM',
      imageryDate: layers.imageryDate ? formatSolarDate(layers.imageryDate) : null,
      aerialImagePath, aerialImage: `data:image/jpeg;base64,${jpeg.toString('base64')}`, backdrop,
    }
  }

  return { backdropFor }
}
