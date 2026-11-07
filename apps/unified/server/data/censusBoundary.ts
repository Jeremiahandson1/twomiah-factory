// A territory from a real boundary — a state, a county, a city or a ZIP (roofing parity row 24; Spotio "Select Territory"; feature
// territory_boundaries, not ready). The shapes are the US Census Bureau's own TIGER/Line boundaries, read from its free public TIGERweb
// service (no key, no paid provider): States (tigerWMS_Current layer 80), Counties (82), Incorporated Places (28) and ZIP Code
// Tabulation Areas (PUMA_TAD_TAZ_UGA_ZCTA layer 1). Checked 11/06: a county answers as a Polygon, a ZIP may be a MultiPolygon.
//
// A territory holds ONE simple polygon of at most 200 corners (field/geo.ts), so the shape is simplified until it fits, and where an
// area has several parts (islands, a split ZIP) the largest is kept and the answer says so. A ZIP territory also keeps its ZIP, which
// the territory already matches on exactly — the outline is for the map.

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb'
export const BOUNDARY_FEATURE = 'territory_boundaries'
export const KINDS = ['state', 'county', 'city', 'zip'] as const
export type Kind = typeof KINDS[number]
const MAX_CORNERS = 200

export const STATE_FIPS: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56', PR: '72',
}

export type Fetcher = (url: string) => Promise<any>
const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`the Census service answered ${res.status}`)
  return res.json()
}
const q = (s: string) => s.replace(/'/g, "''")

/** The TIGERweb query for one area. Null when the request is not one we can ask (an unknown state, an empty name). */
export function boundaryQuery(kind: Kind, name: string, state: string, offset: number): string | null {
  const st = String(state || '').trim().toUpperCase()
  const fips = STATE_FIPS[st]
  // "Eau Claire County" is how people say it; TIGERweb's BASENAME is "Eau Claire" (roofing live test 11/07: the county outline was
  // not found until the word was left off). Only the county's own word goes — a city keeps "City" (Carson City, Jersey City).
  const n = kind === 'county' ? String(name || '').trim().replace(/\s+(county|parish|borough|census area|city and borough)\.?$/i, '').trim() : String(name || '').trim()
  const tail = `&outFields=NAME,BASENAME&returnGeometry=true&maxAllowableOffset=${offset}&outSR=4326&f=geojson`
  if (kind === 'zip') return /^\d{5}$/.test(n) ? `${TIGER}/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?where=${encodeURIComponent(`ZCTA5='${n}'`)}${tail}` : null
  if (!fips) return null
  if (kind === 'state') return `${TIGER}/tigerWMS_Current/MapServer/80/query?where=${encodeURIComponent(`STATE='${fips}'`)}${tail}`
  if (!n) return null
  const layer = kind === 'county' ? 82 : 28
  return `${TIGER}/tigerWMS_Current/MapServer/${layer}/query?where=${encodeURIComponent(`UPPER(BASENAME)='${q(n.toUpperCase())}' AND STATE='${fips}'`)}${tail}`
}

/** The outer rings of a GeoJSON Polygon or MultiPolygon, as [lng, lat] lists. */
function rings(geometry: any): number[][][] {
  if (geometry?.type === 'Polygon') return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : []
  if (geometry?.type === 'MultiPolygon') return (geometry.coordinates || []).map((p: any) => p?.[0]).filter(Boolean)
  return []
}
const ringArea = (r: number[][]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1] } return Math.abs(s) / 2 }

/** The largest part, as [lat, lng] corners with the closing corner dropped; and how many parts there were. */
export function mainPart(geometry: any): { points: Array<[number, number]>; parts: number } | null {
  const all = rings(geometry)
  if (!all.length) return null
  const big = all.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a))
  const pts = big.map((p) => [Math.round(p[1] * 1e6) / 1e6, Math.round(p[0] * 1e6) / 1e6] as [number, number])
  if (pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]) pts.pop()
  return { points: pts, parts: all.length }
}

export type BoundaryAnswer =
  | { status: 'ok'; name: string; points: Array<[number, number]>; parts: number; note: string | null }
  | { status: 'error'; code: 'BAD_REQUEST' | 'NOT_FOUND' | 'UNAVAILABLE'; error: string }

/** One area's boundary, simplified until it fits a territory (coarser each try). */
export async function findBoundary(kind: Kind, name: string, state: string, fetcher: Fetcher = defaultFetch): Promise<BoundaryAnswer> {
  if (!(KINDS as readonly string[]).includes(kind)) return { status: 'error', code: 'BAD_REQUEST', error: 'Pick a state, county, city or ZIP.' }
  for (const offset of [0.0005, 0.002, 0.005, 0.01, 0.03, 0.08]) {
    const url = boundaryQuery(kind, name, state, offset)
    if (!url) return { status: 'error', code: 'BAD_REQUEST', error: kind === 'zip' ? 'A ZIP is five digits.' : 'Pick the state, and name the place.' }
    let data: any
    try { data = await fetcher(url) } catch (err: any) { return { status: 'error', code: 'UNAVAILABLE', error: `The Census boundary service did not answer (${String(err?.message || 'try again shortly')}).` } }
    const f = Array.isArray(data?.features) ? data.features[0] : null
    if (!f) return { status: 'error', code: 'NOT_FOUND', error: `No ${kind === 'zip' ? 'ZIP' : kind} called “${name || state}” was found${kind === 'zip' ? '' : ` in ${String(state).toUpperCase()}`}.` }
    const part = mainPart(f.geometry)
    if (!part || part.points.length < 3) return { status: 'error', code: 'NOT_FOUND', error: 'That place has no outline to use.' }
    if (part.points.length <= MAX_CORNERS) {
      return {
        status: 'ok', name: String(f.properties?.NAME || f.properties?.BASENAME || name), points: part.points, parts: part.parts,
        note: part.parts > 1 ? `It has ${part.parts} separate parts; the largest is used.` : null,
      }
    }
  }
  return { status: 'error', code: 'NOT_FOUND', error: 'That outline is too detailed to use as a territory. Draw it instead.' }
}
