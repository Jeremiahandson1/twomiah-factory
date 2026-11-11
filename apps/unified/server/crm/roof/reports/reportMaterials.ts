// The materials list of a roof report: what to order for the roof as measured. The ordering arithmetic is the job
// material list's (../materialList.ts — bundles, rolls and pieces, each rounded up, each line saying how it was worked);
// this adds what a measured report knows and that list does not:
//   · shingles by what ONE BUNDLE covers: 33.3 sq ft is a true bundle (three to a full 100 sq ft square); many shingles
//     cover a little less (32.8 sq ft is common), so the roofer sets it from the wrapper;
//   · ice and water in ROWS: two rows along every eave and one row down every valley, unless the roofer says otherwise;
//   · valley metal, in 10 ft pieces, for the valleys drawn;
//   · step flashing, one piece to a shingle course (5-5/8 in exposure), and wall flashing in 10 ft pieces, for the
//     roof-to-wall lines drawn;
//   · pipe boots and vents, which nothing measures: the roofer counts them (box vents each, ridge vent in feet). The job
//     list's vent rule of thumb is not used here.
// Nothing here is stored: the list is worked from the saved report each time it is asked for.
import { buildMaterialList, type ListLine } from '../materialList.ts'
import { lengthsFromRoofReport, listLengths } from '../reportLengths.ts'

export interface ReportMaterialOptions {
  wastePercent?: number
  /** Square feet one bundle of shingles covers; 33.3 is a true bundle (a third of a square). */
  bundleSqFt?: number
  pipeBoots?: number
  /** Box vents the roofer counted. */
  boxVents?: number
  /** Feet of ridge vent the roofer wants. */
  ridgeVentFt?: number
  iceWaterEaveRows?: number
  iceWaterValleyRows?: number
}

/** A true bundle, as it is written on the screen; worked as exactly a third of a square. */
export const TRUE_BUNDLE_SQFT = 33.3
const VALLEY_METAL_PIECE_FT = 10
const WALL_FLASHING_PIECE_FT = 10
/** One step flashing to a course of shingles: the exposure of an architectural shingle, inches. */
const SHINGLE_EXPOSURE_IN = 5.625
const ORDER = ['shingles', 'starter', 'ridge-cap', 'underlayment', 'ice-water', 'valley-metal', 'drip-edge', 'step-flashing', 'wall-flashing', 'pipe-boots', 'box-vents', 'ridge-vent', 'nails']

const up = (n: number) => Math.max(0, Math.ceil(Number(n.toFixed(6))))
const round1 = (n: number) => Math.round(n * 10) / 10
const within = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi ? n : undefined
}

/** The options as a query string or a body sent them; anything that is not a sensible number is left out. */
export function cleanMaterialOptions(q: Record<string, unknown> | null | undefined): ReportMaterialOptions {
  const o = q || {}
  const count = (v: unknown, hi: number) => { const n = within(v, 0, hi); return n === undefined ? undefined : Math.round(n) }
  return {
    wastePercent: within(o.wastePercent, 0, 50), bundleSqFt: within(o.bundleSqFt, 10, 40), pipeBoots: count(o.pipeBoots, 200), boxVents: count(o.boxVents, 200), ridgeVentFt: within(o.ridgeVentFt, 0, 2000),
    iceWaterEaveRows: within(o.iceWaterEaveRows, 0, 6), iceWaterValleyRows: within(o.iceWaterValleyRows, 0, 6),
  }
}

/** The list for a saved roof report (its squares, its measured lengths, its own waste unless another is given). */
export function reportMaterialList(report: { totalSquares: unknown; measurements: any; edges?: any }, options: ReportMaterialOptions = {}) {
  const m = report.measurements && typeof report.measurements === 'object' ? report.measurements : {}
  const measured = lengthsFromRoofReport(m, report.edges)
  const wastePercent = options.wastePercent ?? within(m.wasteFactor, 0, 50) ?? 10
  // Vents are the roofer's count here, so the job list's own vent line is left out.
  const over: Record<string, unknown> = { wastePercent, ventType: 'none' }
  const base = buildMaterialList(Number(report.totalSquares), measured ? listLengths(measured) : {}, over)
  const eaveRows = options.iceWaterEaveRows ?? 2
  const valleyRows = options.iceWaterValleyRows ?? 1
  const pipeBoots = options.pipeBoots ?? 0
  const boxVents = options.boxVents ?? 0
  const ridgeVentFt = options.ridgeVentFt ?? 0
  const bundleSqFt = options.bundleSqFt ?? TRUE_BUNDLE_SQFT
  const settings = { wastePercent, bundleSqFt, pipeBoots, boxVents, ridgeVentFt, iceWaterEaveRows: eaveRows, iceWaterValleyRows: valleyRows }
  if (base.lines.length === 0) return { ...base, settings }

  const a = base.assumptions
  const waste = 1 + a.wastePercent / 100
  const pct = `${a.wastePercent}% waste`
  const lines: ListLine[] = base.lines.filter((l) => l.code !== 'ice-water' && l.code !== 'shingles')
  const add = (code: string, description: string, qty: number, unit: string, basis: string) => { if (qty > 0) lines.push({ code, description, qty, unit, basis }) }

  const roofSqFt = base.squares * 100
  const perBundle = bundleSqFt === TRUE_BUNDLE_SQFT ? 100 / 3 : bundleSqFt
  add('shingles', 'Shingles', up((roofSqFt * waste) / perBundle), 'bundle',
    `${Math.round(roofSqFt).toLocaleString('en-US')} sq ft of roof + ${pct} ÷ ${bundleSqFt} sq ft a bundle = ${round1((roofSqFt * waste) / perBundle)}, rounded up`)

  const { eaveFt, valleyFt } = base.lengths
  const iceSqFt = (eaveFt * eaveRows + valleyFt * valleyRows) * a.iceWaterWidthFt
  add('ice-water', 'Ice and water shield', up((iceSqFt * waste) / a.iceWaterRollSqFt), 'roll',
    `${eaveRows} ${eaveRows === 1 ? 'row' : 'rows'} along ${eaveFt} ft of eave + ${valleyRows} ${valleyRows === 1 ? 'row' : 'rows'} down ${valleyFt} ft of valley, ${a.iceWaterWidthFt} ft wide = ${Math.round(iceSqFt)} sq ft + ${pct} ÷ ${a.iceWaterRollSqFt} sq ft a roll`)
  add('valley-metal', 'Valley metal', up((valleyFt * waste) / VALLEY_METAL_PIECE_FT), 'piece',
    `${valleyFt} ft of valley + ${pct} ÷ ${VALLEY_METAL_PIECE_FT} ft a piece`)
  const stepFt = within(m.stepFlashLF, 0, 1e6) ?? 0
  add('step-flashing', 'Step flashing', up(((stepFt * 12) / SHINGLE_EXPOSURE_IN) * waste), 'piece',
    `${round1(stepFt)} ft of roof against a wall, one piece to a course (${SHINGLE_EXPOSURE_IN} in) + ${pct}`)
  const wallFt = within(m.flashLF, 0, 1e6) ?? 0
  add('wall-flashing', 'Wall flashing', up((wallFt * waste) / WALL_FLASHING_PIECE_FT), 'piece',
    `${round1(wallFt)} ft of wall above the roof + ${pct} ÷ ${WALL_FLASHING_PIECE_FT} ft a piece`)
  add('pipe-boots', 'Pipe boots', pipeBoots, 'each', 'Counted on the roof by you')
  add('box-vents', 'Box vents', boxVents, 'each', 'Counted on the roof by you')
  add('ridge-vent', 'Ridge vent', up(ridgeVentFt / a.ridgeVentPieceFt), 'piece', `${round1(ridgeVentFt)} ft of ridge vent, set by you, in ${a.ridgeVentPieceFt} ft pieces`)
  const warnings = [...base.warnings]
  if (ridgeVentFt > base.lengths.ridgeFt) warnings.push(`You asked for ${round1(ridgeVentFt)} ft of ridge vent, but the ridges and hips drawn come to ${base.lengths.ridgeFt} ft.`)

  const place = (code: string) => { const i = ORDER.indexOf(code); return i < 0 ? ORDER.length : i }
  lines.sort((x, y) => place(x.code) - place(y.code))
  return { ...base, lines, warnings, settings }
}

export type ReportMaterialList = ReturnType<typeof reportMaterialList>
