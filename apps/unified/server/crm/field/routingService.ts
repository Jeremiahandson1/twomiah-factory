// Route optimisation for field techs: distance and travel time, multi-stop ordering (nearest neighbour then 2-opt), fuel
// cost and a Google Maps link. Moved from the CRM template's services/routing.ts (templates/crm/backend/src/services).
//
// ROAD TIMES COME FROM GOOGLE'S LICENSED ROUTES API, OR FROM NOWHERE (2026-10-24). The template asked the public OSRM
// demo server (router.project-osrm.org) whenever OSRM_URL was unset — every production tenant — and that server's usage
// policy forbids it, as the OpenStreetMap tiles' did. Now: with GOOGLE_MAPS_API_KEY (every tenant's server key) the
// Routes API answers, from the server — one computeRouteMatrix call for a whole day's stops, computeRoutes for one leg;
// without it, or when Google does not answer, the straight-line distance at 30 mph (tenant-backend jobs/travel.ts, the
// estimate the clash check uses). No public router is ever called.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { companyTimeZone, jobLocalDay, metresBetween, storeDateString } from '@twomiah/tenant-backend'
import { ownJobsWhere } from '../ownWork.ts'
import { job, contact } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

interface Point {
  lat: number
  lng: number
  [key: string]: any
}

interface RouteResult {
  distance: number
  distanceMiles: number
  duration: number
  durationMinutes: number
  /** Where the figures came from: Google's Routes API, or the straight line. */
  source: 'google' | 'straight_line'
}

type Cell = { distance: number; duration: number }
type Matrix = Cell[][]

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || ''
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
/** computeRouteMatrix answers at most 625 origin × destination elements a call (TRAFFIC_UNAWARE). */
const MATRIX_ELEMENTS = 625
/** The straight-line fallback's speed: 13.4 m/s, 30 mph (tenant-backend jobs/travel.ts). */
const STRAIGHT_LINE_MPS = 13.4
const MILES_PER_METRE = 0.000621371

const latLng = (p: Point) => ({ location: { latLng: { latitude: Number(p.lat), longitude: Number(p.lng) } } })
/** "1234s" → 1234. */
const seconds = (d: unknown) => parseInt(String(d ?? '').replace('s', ''), 10) || 0

function straightLine(a: Point, b: Point): Cell {
  const distance = metresBetween({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) })
  return { distance, duration: distance / STRAIGHT_LINE_MPS }
}

/** One leg from the Routes API, or null (no key, refused, no route). */
async function googleLeg(origin: Point, destination: Point): Promise<Cell | null> {
  const key = googleKey(); if (!key) return null
  try {
    const res = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
      body: JSON.stringify({ origin: latLng(origin), destination: latLng(destination), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const r = data?.routes?.[0]
    return r ? { distance: Number(r.distanceMeters) || 0, duration: seconds(r.duration) } : null
  } catch { return null }
}

/**
 * Every origin × destination from the Routes API, as few calls as the element cap allows (rows of origins against all
 * destinations). A pair Google does not answer stays null for the caller's straight-line fallback; no key → all null.
 */
async function googleMatrix(points: Point[]): Promise<(Cell | null)[][]> {
  const n = points.length
  const out: (Cell | null)[][] = Array.from({ length: n }, () => Array(n).fill(null))
  const key = googleKey()
  if (!key || n < 2 || n > MATRIX_ELEMENTS) return out
  const rows = Math.max(1, Math.floor(MATRIX_ELEMENTS / n))
  const destinations = points.map((p) => ({ waypoint: latLng(p) }))
  for (let from = 0; from < n; from += rows) {
    try {
      const res = await fetch(MATRIX_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,status,condition' },
        body: JSON.stringify({ origins: points.slice(from, from + rows).map((p) => ({ waypoint: latLng(p) })), destinations, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
      })
      if (!res.ok) continue
      const data: any = await res.json()
      if (!Array.isArray(data)) continue
      for (const e of data) {
        if (e?.status?.code) continue
        if (e?.condition && e.condition !== 'ROUTE_EXISTS') continue
        const i = from + Number(e.originIndex ?? -1), j = Number(e.destinationIndex ?? -1)
        if (i < from || i >= n || j < 0 || j >= n) continue
        out[i][j] = { distance: Number(e.distanceMeters) || 0, duration: seconds(e.duration) }
      }
    } catch { /* this block of rows falls back to the straight line */ }
  }
  return out
}

const result = (cell: Cell, source: RouteResult['source']): RouteResult => ({
  distance: cell.distance,
  distanceMiles: cell.distance * MILES_PER_METRE,
  duration: cell.duration,
  durationMinutes: Math.round(cell.duration / 60),
  source,
})

/** Distance and duration between two points: Google's road answer, else the straight line. Never throws. */
export async function getRoute(origin: Point, destination: Point): Promise<RouteResult> {
  const road = await googleLeg(origin, destination)
  return road ? result(road, 'google') : result(straightLine(origin, destination), 'straight_line')
}

/** Every pair's road distance and time (one matrix call), a pair Google does not answer by the straight line. */
async function buildDistanceMatrix(points: Point[]): Promise<{ matrix: Matrix; source: RouteResult['source'] }> {
  const road = await googleMatrix(points)
  let allRoad = points.length > 1
  const matrix: Matrix = points.map((a, i) => points.map((b, j) => {
    if (i === j) return { distance: 0, duration: 0 }
    const cell = road[i][j]
    if (!cell) allRoad = false
    return cell || straightLine(a, b)
  }))
  return { matrix, source: allRoad ? 'google' : 'straight_line' }
}

function nearestNeighbor(matrix: Matrix, startIndex: number | null = 0): number[] {
  const n = matrix.length
  const visited = new Set([startIndex ?? 0])
  const order = [startIndex ?? 0]
  while (visited.size < n) {
    const current = order[order.length - 1]
    let nearest = -1
    let minDist = Infinity
    for (let i = 0; i < n; i++) {
      if (!visited.has(i) && matrix[current][i].distance < minDist) {
        minDist = matrix[current][i].distance
        nearest = i
      }
    }
    if (nearest !== -1) {
      visited.add(nearest)
      order.push(nearest)
    }
  }
  return order
}

function calculateSwapDelta(route: number[], i: number, j: number, matrix: Matrix): number {
  const a = route[i - 1]
  const b = route[i]
  const c = route[j]
  const d = route[j + 1]
  return matrix[a][c].distance + matrix[b][d].distance - (matrix[a][b].distance + matrix[c][d].distance)
}

function twoOpt(route: number[], matrix: Matrix): number[] {
  let improved = true
  let best = [...route]
  while (improved) {
    improved = false
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        if (calculateSwapDelta(best, i, j, matrix) < 0) {
          best = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
          improved = true
        }
      }
    }
  }
  return best
}

function calculateRouteStats(order: number[], matrix: Matrix) {
  let distance = 0
  let duration = 0
  for (let i = 0; i < order.length - 1; i++) {
    distance += matrix[order[i]][order[i + 1]].distance
    duration += matrix[order[i]][order[i + 1]].duration
  }
  return { distance, duration }
}

/** The legs of a route in this order, read off the matrix it was ordered by (no second round of calls). */
function legsOf(order: number[], points: Point[], matrix: Matrix) {
  const legs: any[] = []
  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k], j = order[k + 1]
    const cell = matrix[i][j]
    legs.push({
      from: points[i], to: points[j],
      distance: cell.distance, distanceMiles: cell.distance * MILES_PER_METRE,
      duration: cell.duration, durationMinutes: Math.round(cell.duration / 60),
    })
  }
  return legs
}

/** The best order for several stops, with what it saves over the order given. */
export async function optimizeRoute(stops: Point[], startLocation: Point | null = null): Promise<any> {
  if (stops.length < 2) {
    return { optimizedOrder: stops, totalDistance: 0, totalDuration: 0, savings: { distance: 0, time: 0 } }
  }
  const allPoints = startLocation ? [startLocation, ...stops] : stops
  const { matrix: distanceMatrix, source } = await buildDistanceMatrix(allPoints)
  const originalStats = calculateRouteStats(
    startLocation ? [0, ...stops.map((_, i) => i + 1)] : stops.map((_, i) => i),
    distanceMatrix,
  )
  const improvedOrder = twoOpt(nearestNeighbor(distanceMatrix, startLocation ? 0 : null), distanceMatrix)
  const optimizedStats = calculateRouteStats(improvedOrder, distanceMatrix)
  const orderedStops = startLocation
    ? improvedOrder.filter((i) => i !== 0).map((i) => stops[i - 1])
    : improvedOrder.map((i) => stops[i])

  return {
    optimizedOrder: orderedStops,
    originalOrder: stops,
    totalDistance: optimizedStats.distance,
    totalDistanceMiles: optimizedStats.distance * MILES_PER_METRE,
    totalDuration: optimizedStats.duration,
    totalDurationMinutes: Math.round(optimizedStats.duration / 60),
    savings: {
      distanceMeters: originalStats.distance - optimizedStats.distance,
      distanceMiles: (originalStats.distance - optimizedStats.distance) * MILES_PER_METRE,
      timeSeconds: originalStats.duration - optimizedStats.duration,
      timeMinutes: Math.round((originalStats.duration - optimizedStats.duration) / 60),
      percentDistance: originalStats.distance > 0 ? Math.round((1 - optimizedStats.distance / originalStats.distance) * 100) : 0,
      percentTime: originalStats.duration > 0 ? Math.round((1 - optimizedStats.duration / originalStats.duration) * 100) : 0,
    },
    legs: legsOf(improvedOrder, allPoints, distanceMatrix),
    source,
  }
}

/** A Google Maps directions link through the stops in order. */
export function generateGoogleMapsUrl(stops: Point[]): string | null {
  if (stops.length === 0) return null
  const waypoints = stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join('|')
  const origin = stops[0]
  const destination = stops[stops.length - 1]
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`
  if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`
  return url
}

export function calculateFuelCost(distanceMiles: number, mpg = 20, fuelPricePerGallon = 3.5) {
  const gallons = distanceMiles / mpg
  return {
    gallons: Math.round(gallons * 100) / 100,
    cost: Math.round(gallons * fuelPricePerGallon * 100) / 100,
    distanceMiles,
    mpg,
    fuelPrice: fuelPricePerGallon,
  }
}

export function createRoutingService(d: CrmDeps) {
  const { db } = d

  /**
   * A person's scheduled and in-progress jobs for a day, in the best order. The day is the COMPANY'S (YYYY-MM-DD, or its
   * today), each job's day read by tenant-backend jobLocalDay — it was the server's local midnight (2026-10-24).
   */
  async function optimizeDayRoute(companyId: string, userId: string, date?: string | null) {
    const tz = await companyTimeZone(db, companyId)
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : storeDateString(new Date(), tz)

    const jobs = await db
      .select({ job, contactAddress: contact.address })
      .from(job)
      .leftJoin(contact, eq(job.contactId, contact.id))
      .where(and(
        eq(job.companyId, companyId),
        ownJobsWhere(db, userId),
        sql`${jobLocalDay(job.scheduledDate, job.source, tz)} = ${day}::date`,
        inArray(job.status, ['scheduled', 'in_progress']),
      ))

    const stops = jobs
      .filter((j: any) => j.job.lat && j.job.lng)
      .map((j: any) => ({
        id: j.job.id,
        name: j.job.title,
        lat: j.job.lat!,
        lng: j.job.lng!,
        address: j.job.address || j.contactAddress,
        scheduledTime: j.job.scheduledDate,
      }))

    if (stops.length < 2) {
      return { date: day, jobs: jobs.map((j: any) => j.job), optimizedRoute: null, message: 'Need at least 2 jobs with coordinates' }
    }
    const optimizedRoute = await optimizeRoute(stops)
    return {
      date: day,
      jobs: jobs.map((j: any) => j.job),
      optimizedRoute,
      googleMapsUrl: generateGoogleMapsUrl(optimizedRoute.optimizedOrder),
    }
  }

  return { getRoute, optimizeRoute, optimizeDayRoute, generateGoogleMapsUrl, calculateFuelCost }
}
