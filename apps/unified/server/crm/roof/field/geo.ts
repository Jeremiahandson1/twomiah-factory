// Where a storm fell and where a rep is sent, with no paid map service. Two shapes drawn on the map — a polygon (the
// corners, in order) or a circle (a centre and a radius in miles) — and one question asked of them: is this point inside?
//
// What decides "a customer is in the storm" (docs/parity/roof-storms-canvass.md):
//   1. the coordinates the business already holds: a job's pin (the property), else the contact's, else a door a rep
//      knocked with the phone's GPS. A point with coordinates is tested against the shape (polygon: ray casting; circle:
//      great-circle distance). No geocoder is called here, ever.
//   2. a customer with NO coordinates cannot be placed on a map, so it matches by its five-digit zip against the zips the
//      storm or territory names — and is marked as such (`by: 'zip'`), so the screen can say "placed by zip only".
// To place those customers on the map too, the address has to become coordinates, which is a geocoding provider
// (Google's, with the server's key — the existing /api/maps/batch-geocode fills a job's pin when a key is set).
//
// Ray casting treats latitude and longitude as flat x and y. For a storm swath or a neighbourhood — tens of miles at most —
// the error is a few metres at the edge; it is not meant for a shape that crosses the antimeridian or a pole (the shapes
// are refused beyond ±90 / ±180, and a polygon is limited to 200 corners).

export type LatLng = [number, number]
export type StormPath =
  | { kind: 'polygon'; points: LatLng[] }
  | { kind: 'circle'; lat: number; lng: number; radiusMiles: number }

export interface Point { lat: number | null; lng: number | null; zip?: string | null }
export type MatchedBy = 'path' | 'zip'

const MAX_CORNERS = 200
const MAX_RADIUS_MILES = 250
const EARTH_MILES = 3958.8

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const inRange = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180

/** A decimal column (which arrives as text) or a real: a coordinate, or null. */
export const coordOf = num

/** The shape a caller sent, checked and cleaned — or the sentence that says what is wrong with it. */
export function parsePath(input: unknown): { path: StormPath } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the area as { kind: "polygon", points } or { kind: "circle", lat, lng, radiusMiles }.' }
  const o = input as Record<string, unknown>
  if (o.kind === 'circle') {
    const lat = num(o.lat), lng = num(o.lng), radiusMiles = num(o.radiusMiles)
    if (lat === null || lng === null || !inRange(lat, lng)) return { error: 'A circle needs a centre: lat between -90 and 90, lng between -180 and 180.' }
    if (radiusMiles === null || radiusMiles <= 0 || radiusMiles > MAX_RADIUS_MILES) return { error: `A circle's radius is more than 0 and at most ${MAX_RADIUS_MILES} miles.` }
    return { path: { kind: 'circle', lat, lng, radiusMiles } }
  }
  if (o.kind === 'polygon') {
    if (!Array.isArray(o.points)) return { error: 'A polygon needs its corners: points as [[lat, lng], ...].' }
    if (o.points.length < 3) return { error: 'A polygon needs at least three corners.' }
    if (o.points.length > MAX_CORNERS) return { error: `A polygon can have at most ${MAX_CORNERS} corners.` }
    const points: LatLng[] = []
    for (const p of o.points) {
      const lat = Array.isArray(p) ? num(p[0]) : null, lng = Array.isArray(p) ? num(p[1]) : null
      if (lat === null || lng === null || !inRange(lat, lng)) return { error: 'Every corner is [lat, lng], lat between -90 and 90 and lng between -180 and 180.' }
      points.push([lat, lng])
    }
    // Three corners on one line enclose nothing.
    let twice = 0
    for (let i = 0; i < points.length; i++) { const [a, b] = [points[i], points[(i + 1) % points.length]]; twice += a[1] * b[0] - b[1] * a[0] }
    if (Math.abs(twice) < 1e-12) return { error: 'Those corners are in a line — they do not enclose an area.' }
    return { path: { kind: 'polygon', points } }
  }
  return { error: 'The area is a "polygon" or a "circle".' }
}

/** A stored shape read back (the column is json): the shape, or null when it is absent or unreadable. */
export function pathOf(stored: unknown): StormPath | null {
  if (stored === null || stored === undefined) return null
  const r = parsePath(stored)
  return 'path' in r ? r.path : null
}

/** Great-circle miles between two points. */
export function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Is the point inside the shape? A point on an edge counts as inside for a circle and is either for a polygon. */
export function pointInPath(lat: number, lng: number, path: StormPath): boolean {
  if (path.kind === 'circle') return miles(lat, lng, path.lat, path.lng) <= path.radiusMiles
  const pts = path.points
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i], [yj, xj] = pts[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The five-digit zip of "54701" or "54701-1234"; null for anything else. */
export const zip5 = (z: unknown): string | null => /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(z ?? ''))?.[1] ?? null

/** The zips of a list as five-digit zips, once each. */
export const zipSet = (zips: unknown): Set<string> => new Set((Array.isArray(zips) ? zips : []).map(zip5).filter((z): z is string => !!z))

/**
 * How a point belongs to an area, or null when it does not.
 *   · a point WITH coordinates, and a shape: inside the shape → 'path'; outside it → null. When `zipAlso` (a territory is
 *     its shape OR its zips) a point outside the shape but in a zip it names is 'zip'. A storm uses only the shape once it
 *     has one: a customer in an affected zip but outside the swath was not hit.
 *   · a point WITHOUT coordinates: its zip, against the zips named → 'zip'.
 *   · no shape at all: zips alone decide, located or not.
 */
export function matchArea(p: Point, area: { path: StormPath | null; zips: Set<string> }, opts: { zipAlso?: boolean } = {}): MatchedBy | null {
  const lat = num(p.lat), lng = num(p.lng)
  const located = lat !== null && lng !== null && inRange(lat, lng)
  const z = zip5(p.zip)
  const zipHit = !!z && area.zips.has(z)
  if (located && area.path) {
    if (pointInPath(lat, lng, area.path)) return 'path'
    return opts.zipAlso && zipHit ? 'zip' : null
  }
  return zipHit ? 'zip' : null
}

/** The box that holds the shape (for fitting a map): south, west, north, east. */
export function pathBounds(path: StormPath): { south: number; west: number; north: number; east: number } {
  if (path.kind === 'circle') {
    const dLat = (path.radiusMiles / EARTH_MILES) * (180 / Math.PI)
    const dLng = dLat / Math.max(0.01, Math.cos((path.lat * Math.PI) / 180))
    return { south: path.lat - dLat, west: path.lng - dLng, north: path.lat + dLat, east: path.lng + dLng }
  }
  const lats = path.points.map((p) => p[0]), lngs = path.points.map((p) => p[1])
  return { south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) }
}
