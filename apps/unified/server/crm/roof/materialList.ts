// The material list of a roof: squares (and, when the roofer has them, the measured lengths of eave, rake, ridge and
// valley) → what to order. Plain arithmetic with the coverage the manufacturers print, every number an ASSUMPTION the
// roofer can change per list (docs/parity/roof-material-list.md). Nothing here touches the database.
//
// A "square" is 100 square feet of roof. The rules, each stated on the line it makes (the `basis` text):
//   · shingles   3 bundles to the square (architectural / 3-tab: 33.3 sq ft per bundle), on the squares PLUS waste;
//   · starter    one bundle covers ~120 linear feet (eave + rake), plus waste;
//   · ridge cap  one bundle covers ~25 linear feet of ridge and hip, plus waste;
//   · underlayment  a roll of synthetic covers 10 squares (1,000 sq ft), on the squares plus waste;
//   · ice & water  a band along the eaves and in the valleys, 3 ft wide; a roll is 200 sq ft (36" x 66'), plus waste;
//   · drip edge  10 ft pieces along eave and rake, plus waste;
//   · nails      about 320 roofing nails to the square; a box holds 7,200 (1-1/4" coil), plus waste;
//   · vents      the 1-in-300 rule: 1 sq ft of net free exhaust vent per 300 sq ft of attic floor (balanced with intake),
//                met by box vents (50 sq in each) or by ridge vent (18 sq in per foot, 4 ft pieces).
// Waste applies to every line: it is the cut-off at hips, valleys and edges. Everything is rounded UP to a whole
// bundle / roll / piece / box, because that is how it is sold.

export type VentType = 'box' | 'ridge' | 'none'

/** The numbers a list is worked from. All of them can be overridden when the list is built. */
export interface Assumptions {
  /** Cut-off and spoilage added to every line, in percent (10 plain gable, 15 hip, 20 cut-up with dormers and valleys). */
  wastePercent: number
  bundlesPerSquare: number
  starterFtPerBundle: number
  ridgeCapFtPerBundle: number
  underlaymentSquaresPerRoll: number
  iceWaterWidthFt: number
  iceWaterRollSqFt: number
  dripEdgePieceFt: number
  nailsPerSquare: number
  nailsPerBox: number
  ventType: VentType
  /** Net free area of one box vent, square inches. */
  boxVentNetSqIn: number
  /** Net free area of ridge vent per foot, square inches. */
  ridgeVentSqInPerFt: number
  ridgeVentPieceFt: number
  /** Attic floor ≈ roof area ÷ this (pitch: 1.15 is about a 6/12). */
  pitchFactor: number
  /** Square feet of attic floor served by 1 sq ft of exhaust vent. */
  atticSqFtPerVentSqFt: number
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  wastePercent: 10,
  bundlesPerSquare: 3,
  starterFtPerBundle: 120,
  ridgeCapFtPerBundle: 25,
  underlaymentSquaresPerRoll: 10,
  iceWaterWidthFt: 3,
  iceWaterRollSqFt: 200,
  dripEdgePieceFt: 10,
  nailsPerSquare: 320,
  nailsPerBox: 7200,
  ventType: 'box',
  boxVentNetSqIn: 50,
  ridgeVentSqInPerFt: 18,
  ridgeVentPieceFt: 4,
  pitchFactor: 1.15,
  atticSqFtPerVentSqFt: 300,
}

/** Each assumption in the roofer's words, for the screen. */
export const ASSUMPTION_LABELS: Record<keyof Assumptions, { label: string; unit: string; help: string }> = {
  wastePercent: { label: 'Waste', unit: '%', help: 'Added to every line. About 10 for a plain gable, 15 for a hip roof, 20 for a cut-up roof with valleys and dormers.' },
  bundlesPerSquare: { label: 'Shingle bundles per square', unit: 'bundles', help: 'Architectural and 3-tab shingles are 3 bundles to the square.' },
  starterFtPerBundle: { label: 'Starter strip per bundle', unit: 'ft', help: 'Linear feet one bundle of starter covers along the eaves and rakes.' },
  ridgeCapFtPerBundle: { label: 'Ridge cap per bundle', unit: 'ft', help: 'Linear feet one bundle of hip and ridge cap covers.' },
  underlaymentSquaresPerRoll: { label: 'Underlayment per roll', unit: 'squares', help: 'A roll of synthetic underlayment covers 10 squares (1,000 sq ft).' },
  iceWaterWidthFt: { label: 'Ice and water band', unit: 'ft wide', help: 'Along the eaves and in the valleys. 3 ft is common; some codes ask for more.' },
  iceWaterRollSqFt: { label: 'Ice and water per roll', unit: 'sq ft', help: 'A 36 in by 66 ft roll is 200 sq ft.' },
  dripEdgePieceFt: { label: 'Drip edge piece', unit: 'ft', help: 'Drip edge is sold in 10 ft pieces.' },
  nailsPerSquare: { label: 'Nails per square', unit: 'nails', help: 'About 4 nails a shingle.' },
  nailsPerBox: { label: 'Nails per box', unit: 'nails', help: 'A box of 1-1/4 inch coil roofing nails holds 7,200.' },
  ventType: { label: 'Vents', unit: '', help: 'Box vents, ridge vent, or none (the attic is vented another way).' },
  boxVentNetSqIn: { label: 'Box vent opening', unit: 'sq in', help: 'Net free area of one box vent, from its package.' },
  ridgeVentSqInPerFt: { label: 'Ridge vent opening', unit: 'sq in / ft', help: 'Net free area per foot of ridge vent, from its package.' },
  ridgeVentPieceFt: { label: 'Ridge vent piece', unit: 'ft', help: 'Length of one piece of ridge vent.' },
  pitchFactor: { label: 'Pitch factor', unit: '', help: 'Roof area divided by attic floor area; 1.15 is about a 6/12 pitch.' },
  atticSqFtPerVentSqFt: { label: 'Attic per square foot of exhaust vent', unit: 'sq ft', help: 'The 1-in-300 rule: 1 sq ft of exhaust vent for every 300 sq ft of attic floor.' },
}

/** The lengths a measurement gives, in feet. Any left out is estimated from the squares (and said so). */
export interface Lengths { eaveFt?: number; rakeFt?: number; ridgeFt?: number; valleyFt?: number }

export interface ListLine {
  /** Stable key, so a screen can keep an edited line against its place in the list. */
  code: string
  description: string
  qty: number
  unit: string
  /** The arithmetic, in words — shown beside the line. */
  basis: string
}

export interface MaterialList {
  squares: number
  /** The squares with waste. */
  orderedSquares: number
  assumptions: Assumptions
  /** The lengths used, and which of them were estimated rather than measured. */
  lengths: Required<Lengths>
  estimated: Array<keyof Lengths>
  lines: ListLine[]
  warnings: string[]
}

const up = (n: number) => Math.max(0, Math.ceil(Number(n.toFixed(6))))
const round1 = (n: number) => Math.round(n * 10) / 10
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

/** The changes that are sensible numbers (or a vent type): what a list is worked from and what a template may keep. Nonsense is dropped. */
export function cleanAssumptions(over?: Partial<Record<keyof Assumptions, unknown>> | null): Partial<Assumptions> {
  const out: Partial<Assumptions> = {}
  for (const [k, v] of Object.entries(over || {})) {
    if (!(k in DEFAULT_ASSUMPTIONS)) continue
    if (k === 'ventType') { if (v === 'box' || v === 'ridge' || v === 'none') out.ventType = v; continue }
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    if (!finite(n)) continue
    // Waste may be 0 (a list the roofer has already padded); every other number divides something and must be above 0.
    if ((k === 'wastePercent' ? (n as number) >= 0 : (n as number) > 0)) (out as any)[k] = n
  }
  return out
}

/** The assumptions with the roofer's changes laid over the defaults; a change that is not a sensible number is dropped. */
export function withAssumptions(over?: Partial<Record<keyof Assumptions, unknown>> | null): Assumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...cleanAssumptions(over) }
}

/**
 * The list. `squares` is the roof area in squares (100 sq ft). Lengths the roofer has measured are used as given; the
 * rest are estimated from the squares for a plain rectangular house (about 60% of the outline is eave, 40% rake, the
 * ridge about a third of it) and marked as estimates, because a satellite measurement or a tape beats a guess.
 */
export function buildMaterialList(squaresIn: number, lengthsIn: Lengths = {}, over?: Partial<Record<keyof Assumptions, unknown>> | null): MaterialList {
  const a = withAssumptions(over)
  const squares = Number(squaresIn)
  const warnings: string[] = []
  if (!finite(squares) || squares <= 0) {
    return { squares: 0, orderedSquares: 0, assumptions: a, lengths: { eaveFt: 0, rakeFt: 0, ridgeFt: 0, valleyFt: 0 }, estimated: [], lines: [], warnings: ['Enter the roof’s squares to work out a list.'] }
  }
  const waste = 1 + a.wastePercent / 100
  const orderedSquares = round1(squares * waste)

  // Estimated outline: footprint ≈ roof ÷ pitch; a 1 : 1.5 rectangle has a perimeter of about 4.1 × √footprint.
  const footprint = (squares * 100) / a.pitchFactor
  const outline = 4.1 * Math.sqrt(footprint)
  const guess: Required<Lengths> = { eaveFt: Math.round(outline * 0.6), rakeFt: Math.round(outline * 0.4), ridgeFt: Math.round(outline * 0.3), valleyFt: 0 }
  const estimated: Array<keyof Lengths> = []
  const lengths = { ...guess } as Required<Lengths>
  for (const k of ['eaveFt', 'rakeFt', 'ridgeFt', 'valleyFt'] as const) {
    const given = lengthsIn[k]
    if (finite(given) && (given as number) >= 0) lengths[k] = given as number
    else if (k !== 'valleyFt') estimated.push(k)
  }
  const edgeFt = lengths.eaveFt + lengths.rakeFt
  const lines: ListLine[] = []
  const add = (code: string, description: string, qty: number, unit: string, basis: string) => { if (qty > 0) lines.push({ code, description, qty, unit, basis }) }
  const pct = `${a.wastePercent}% waste`

  add('shingles', 'Shingles', up(squares * a.bundlesPerSquare * waste), 'bundle',
    `${squares} squares × ${a.bundlesPerSquare} bundles + ${pct} = ${round1(squares * a.bundlesPerSquare * waste)}, rounded up`)
  add('starter', 'Starter strip shingles', up((edgeFt * waste) / a.starterFtPerBundle), 'bundle',
    `${edgeFt} ft of eave and rake + ${pct} ÷ ${a.starterFtPerBundle} ft a bundle`)
  add('ridge-cap', 'Hip and ridge cap shingles', up((lengths.ridgeFt * waste) / a.ridgeCapFtPerBundle), 'bundle',
    `${lengths.ridgeFt} ft of ridge and hip + ${pct} ÷ ${a.ridgeCapFtPerBundle} ft a bundle`)
  add('underlayment', 'Synthetic underlayment', up(orderedSquares / a.underlaymentSquaresPerRoll), 'roll',
    `${orderedSquares} squares with waste ÷ ${a.underlaymentSquaresPerRoll} squares a roll`)
  const iceSqFt = (lengths.eaveFt + lengths.valleyFt) * a.iceWaterWidthFt * waste
  add('ice-water', 'Ice and water shield', up(iceSqFt / a.iceWaterRollSqFt), 'roll',
    `(${lengths.eaveFt} ft of eave + ${lengths.valleyFt} ft of valley) × ${a.iceWaterWidthFt} ft wide + ${pct} ÷ ${a.iceWaterRollSqFt} sq ft a roll`)
  add('drip-edge', 'Drip edge', up((edgeFt * waste) / a.dripEdgePieceFt), 'piece',
    `${edgeFt} ft of eave and rake + ${pct} ÷ ${a.dripEdgePieceFt} ft a piece`)
  add('nails', 'Coil roofing nails, 1-1/4 in', up((squares * a.nailsPerSquare * waste) / a.nailsPerBox), 'box',
    `${squares} squares × ${a.nailsPerSquare} nails + ${pct} ÷ ${a.nailsPerBox} a box`)

  if (a.ventType !== 'none') {
    const atticSqFt = (squares * 100) / a.pitchFactor
    const needSqIn = (atticSqFt / a.atticSqFtPerVentSqFt) * 144
    if (a.ventType === 'box') {
      add('vents', 'Box vents', up(needSqIn / a.boxVentNetSqIn), 'each',
        `${Math.round(atticSqFt)} sq ft of attic ÷ ${a.atticSqFtPerVentSqFt} = ${round1(atticSqFt / a.atticSqFtPerVentSqFt)} sq ft of exhaust (${Math.round(needSqIn)} sq in) ÷ ${a.boxVentNetSqIn} sq in a vent`)
    } else {
      const feet = needSqIn / a.ridgeVentSqInPerFt
      add('vents', 'Ridge vent', up(feet / a.ridgeVentPieceFt), 'piece',
        `${Math.round(needSqIn)} sq in of exhaust ÷ ${a.ridgeVentSqInPerFt} sq in a foot = ${round1(feet)} ft, in ${a.ridgeVentPieceFt} ft pieces`)
      if (feet > lengths.ridgeFt) warnings.push(`The roof needs about ${round1(feet)} ft of ridge vent but the ridge is ${lengths.ridgeFt} ft: add box vents or another exhaust for the rest.`)
    }
  }
  if (estimated.length) warnings.push(`Estimated from the squares, not measured: ${estimated.map((k) => k.replace('Ft', '')).join(', ')}. Enter the real lengths for a tighter list.`)
  return { squares, orderedSquares, assumptions: a, lengths, estimated, lines, warnings }
}
