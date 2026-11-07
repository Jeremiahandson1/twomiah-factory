// Hail swaths from a hail-data provider, and lead scoring for storm leads (roofing parity row 25; Spotio + HailTrace, AccuLynx's hail
// overlay and Lead Intelligence; feature storm_data_tools, not ready).
//
//   · HailSwathProvider — what a provider must do: the storms in an area over some days, each a drawn swath with its date, severity,
//     largest hail, wind and rainfall. They become storm events whose `path` is the swath, so the storm's customers are the ones under
//     it. THE STEP LEFT: an account and contract with a provider (HailTrace, Interactive Hail Maps, CoreLogic) and its adapter here;
//     until then providerFor() answers null and the office is told so (NO_PROVIDER). NOAA's free point reports (data/spcReports.ts)
//     are the fallback that works today.
//   · leadScore — a storm lead scored 0–100 from what is known: how hard the storm hit (hail size or wind), whether the lead is under
//     the storm's shape or only in its zip, the roof's age, and whether they are a past customer. The reasons are said with the score.

export const STORM_DATA_FEATURE = 'storm_data_tools'

export interface Swath {
  date: string
  path: { kind: 'polygon'; points: Array<[number, number]> }
  severity?: string | null
  hailInches?: number | null
  windMph?: number | null
  rainfallInches?: number | null
}
export interface HailSwathProvider {
  name: string
  swaths(area: { lat: number; lng: number; radiusMiles: number }, from: Date, to: Date): Promise<{ swaths: Swath[] } | { error: string }>
}
let testProvider: HailSwathProvider | null = null
/** Tests only. */
export function useSwathProviderForTests(p: HailSwathProvider | null) { testProvider = p }
/** The provider this server has — none yet (see THE STEP LEFT above). */
export const swathProviderFor = (): HailSwathProvider | null => testProvider

export interface ScoreInput {
  hailInches: number | null
  windMph: number | null
  /** 'path' — under the storm's shape (pin inside); 'zip' — only in its zip. */
  matchedBy: 'path' | 'zip' | null
  roofAge: number | null
  pastCustomer: boolean
}

/** A storm lead's score (0–100) and why. */
export function leadScore(x: ScoreInput): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  if (x.hailInches && x.hailInches > 0) {
    const pts = x.hailInches >= 2 ? 40 : x.hailInches >= 1.5 ? 32 : x.hailInches >= 1 ? 24 : 12
    score += pts; reasons.push(`${x.hailInches.toFixed(2)} in hail`)
  } else if (x.windMph && x.windMph > 0) {
    const pts = x.windMph >= 75 ? 32 : x.windMph >= 58 ? 22 : 10
    score += pts; reasons.push(`${x.windMph} mph wind`)
  } else { score += 8; reasons.push('storm size not known') }
  if (x.matchedBy === 'path') { score += 25; reasons.push('inside the storm area') }
  else if (x.matchedBy === 'zip') { score += 8; reasons.push('in the storm’s zip (no pin)') }
  if (x.roofAge != null) {
    if (x.roofAge >= 15) { score += 25; reasons.push(`roof ${x.roofAge} years old`) }
    else if (x.roofAge >= 10) { score += 15; reasons.push(`roof ${x.roofAge} years old`) }
    else { score += 5; reasons.push(`roof ${x.roofAge} years old`) }
  }
  if (x.pastCustomer) { score += 10; reasons.push('past customer') }
  return { score: Math.min(100, score), reasons }
}
