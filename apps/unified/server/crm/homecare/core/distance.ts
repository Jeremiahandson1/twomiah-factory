// Driving distance and time between two points (row 20, care_payroll_rules): travel estimated from addresses or GPS punches, and
// mileage between completed visits. With GOOGLE_MAPS_API_KEY set (the server's one Maps key, crm/field/googleGeocode.ts) the
// Routes API answers road miles and minutes; without it the straight line × 1.3 (the usual road-to-crow-flies factor) at 30 mph,
// and every answer says which it was. Answers are remembered for the process so a pay run asks once per pair.
//
// The owner's step for map answers: a Google Cloud project with the Routes API on and its key in GOOGLE_MAPS_API_KEY (Render env).
import { googleKey } from '../../field/googleGeocode.ts'

export interface Point { lat: number; lng: number }
export interface Leg { miles: number; minutes: number; source: 'map' | 'estimate' }

export const ROAD_FACTOR = 1.3
export const ESTIMATE_MPH = 30

/** A point from a client row, a user row or a punch location ({ lat, lng } / { latitude, longitude }), or null. */
export function toPoint(v: unknown): Point | null {
  if (!v) return null
  const o: any = typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return null } })() : v
  if (!o) return null
  const lat = Number(o.lat ?? o.latitude), lng = Number(o.lng ?? o.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/** Crow-flies miles between two points (the same arithmetic as planning/optimizer.ts; not imported, so core never loads a router). */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** The straight-line estimate: road miles ≈ crow-flies × 1.3, at 30 mph. */
export function estimateLeg(a: Point, b: Point): Leg {
  const crow = haversine(a.lat, a.lng, b.lat, b.lng)
  const miles = Math.round(crow * ROAD_FACTOR * 100) / 100
  return { miles, minutes: Math.ceil((miles / ESTIMATE_MPH) * 60), source: 'estimate' }
}

export type LegTransport = (a: Point, b: Point) => Promise<Leg | null>

async function googleLeg(a: Point, b: Point): Promise<Leg | null> {
  const key = googleKey(); if (!key) return null
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
      body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', units: 'IMPERIAL' }),
      signal: AbortSignal.timeout(10_000),
    })
    const data: any = await res.json()
    const r = data?.routes?.[0]
    if (!r) return null
    const seconds = parseInt(String(r.duration || '').replace('s', '')) || 0
    return { miles: Math.round(((r.distanceMeters || 0) / 1609.344) * 100) / 100, minutes: Math.ceil(seconds / 60), source: 'map' }
  } catch { return null }
}

/** The map transport; a test swaps it to stand in for the map service. */
export const distanceTransport: { leg: LegTransport } = { leg: googleLeg }

const cache = new Map<string, Leg>()
/** Forget remembered answers (a test that changes the map's answer; a key that was just set). */
export const clearDistanceCache = () => cache.clear()
const key = (a: Point, b: Point) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`

/** The driving leg from a to b: the map's answer when there is a key and it answers, else the estimate. */
export async function drivingLeg(a: Point, b: Point): Promise<Leg> {
  const k = key(a, b)
  const hit = cache.get(k)
  if (hit) return hit
  const leg = (await distanceTransport.leg(a, b)) ?? estimateLeg(a, b)
  if (cache.size > 5000) cache.clear()
  cache.set(k, leg)
  return leg
}
