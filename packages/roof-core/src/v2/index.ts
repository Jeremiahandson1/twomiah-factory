// Roof engine v2: one roof, measured from Google's height map and roof mask — area on the slope, pitches, the lines a
// roofer orders by (ridge, hip, valley, eave, rake, wall flashing), and an honest grade of how far to trust it.
//
// Not wired into the product yet: nothing imports this but the scoreboard (packages/roof-core/bench).
import { measureRoofFaces, type RoofFaces, type FaceOptions } from './roofFaces.ts'
import { measureRoofLines, type RoofLines, type LineOptions } from './roofLines.ts'

export type { RoofFaces, RoofFace, FaceOptions } from './roofFaces.ts'
export type { RoofLines, LineType, LineOptions } from './roofLines.ts'
export { measureRoofFaces } from './roofFaces.ts'
export { measureRoofLines } from './roofLines.ts'

export type RoofGrade = 'green' | 'yellow' | 'red'

export interface RoofImagery {
  /** Google's imageryQuality for the data layers: HIGH, MEDIUM or LOW. */
  quality?: string
  /** When the aerial data was flown. */
  date?: { year: number; month: number; day?: number }
  /** The day the report is made (so the engine itself reads no clock). */
  today?: { year: number; month: number }
}

export interface RoofMeasurement {
  /** green: order from it. yellow: a person checks the reasons given. red: this roof was not measured — say so. */
  grade: RoofGrade
  /** Why the grade is not green, in plain words, most serious first. */
  reasons: string[]
  areaSqft: number
  squares: number
  /** Slope area by pitch (rise over 12), largest first. */
  pitches: Array<{ pitchOver12: number; areaSqft: number }>
  /** Feet on the slope. */
  lines: { ridge: number; hip: number; valley: number; eave: number; rake: number; flash: number; stepflash: number }
  faces: RoofFaces
  detail: RoofLines
}

export async function measureRoof(
  dsmBuffer: Buffer, maskBuffer: Buffer, imagery: RoofImagery = {}, options: { faces?: FaceOptions; lines?: LineOptions } = {},
): Promise<RoofMeasurement | null> {
  const faces = await measureRoofFaces(dsmBuffer, maskBuffer, options.faces)
  if (!faces) return null
  const detail = measureRoofLines(faces, options.lines)

  const byPitch = new Map<number, number>()
  for (const f of faces.faces) {
    const p = Math.round(f.pitchOver12)
    byPitch.set(p, (byPitch.get(p) || 0) + f.slopeSqft)
  }

  const red: string[] = []
  const yellow: string[] = []
  const pctOf = (x: number) => `${Math.round(x * 100)}%`
  if (!faces.pinOnRoof) red.push(`the address pin is not on a roof (nearest roof is ${faces.pinDistanceM} m away) — confirm which building`)
  if (faces.faces.length === 0) red.push('no roof face could be read')
  if (faces.unexplainedShare > 0.25) red.push(`${pctOf(faces.unexplainedShare)} of the roof could not be read as faces — too cut-up or too steep for the aerial data, or under trees`)
  else if (faces.unexplainedShare > 0.1) yellow.push(`${pctOf(faces.unexplainedShare)} of the roof could not be read as faces — check for trees over the roof or small sections`)

  const outline = detail.lengths.eave + detail.lengths.rake + detail.unknownEdgeFt
  const rebuilt = detail.squaredEdgeFt + detail.unknownEdgeFt
  if (outline > 0 && rebuilt / outline > 0.15) yellow.push(`${Math.round(rebuilt)} ft of the roof's edge was hidden or slanted and was rebuilt as square corners — check the outline`)
  if (detail.inferredStripFt > 0) yellow.push(`${Math.round(detail.inferredStripFt)} ft of hip and of valley was inferred where two sections step past each other, not seen — check it`)
  if (imagery.quality && imagery.quality !== 'HIGH') yellow.push(`the aerial data here is ${imagery.quality.toLowerCase()} quality`)
  if (imagery.date && imagery.today) {
    const years = imagery.today.year - imagery.date.year + (imagery.today.month - imagery.date.month) / 12
    if (years > 5) yellow.push(`the aerial data is from ${imagery.date.year} — an addition or re-roof since then will not show`)
  }
  if (imagery.date && imagery.date.month >= 5 && imagery.date.month <= 9 && faces.unexplainedShare > 0.1) yellow.push('the aerial data was flown with leaves on the trees')

  return {
    grade: red.length ? 'red' : yellow.length ? 'yellow' : 'green',
    reasons: [...red, ...yellow],
    areaSqft: faces.slopeSqft,
    squares: Math.round(faces.slopeSqft) / 100,
    pitches: [...byPitch.entries()].map(([pitchOver12, areaSqft]) => ({ pitchOver12, areaSqft: Math.round(areaSqft) })).sort((a, b) => b.areaSqft - a.areaSqft),
    lines: detail.lengths,
    faces, detail,
  }
}
