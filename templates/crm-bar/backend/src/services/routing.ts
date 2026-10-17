/**
 * Route Optimization Service
 *
 * Optimize driving routes for field techs:
 * - Multi-stop route optimization
 * - Travel time estimation
 * - Distance calculations
 * - Fuel cost estimates
 * - Integration with Google Maps
 *
 * NOTE: This service has no database queries except optimizeDayRoute which
 * accepts a db handle. It is mostly pure computation / external API calls.
 */

import { db } from '../../db/index.ts'
import { job, contact } from '../../db/schema.ts'
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm'

// Using OSRM (free) or Google Maps Directions API
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org'
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY

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
  geometry?: any
  polyline?: string
}

/**
 * Calculate distance and duration between two points
 */
export async function getRoute(origin: Point, destination: Point): Promise<RouteResult> {
  if (GOOGLE_MAPS_KEY) {
    return getGoogleRoute(origin, destination)
  }
  return getOsrmRoute(origin, destination)
}

/**
 * OSRM route calculation (free, no API key)
 */
async function getOsrmRoute(origin: Point, destination: Point): Promise<RouteResult> {
  const url = `${OSRM_URL}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`

  const response = await fetch(url)
  const data = await response.json()

  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error('Route calculation failed')
  }

  const route = data.routes[0]
  return {
    distance: route.distance,
    distanceMiles: route.distance * 0.000621371,
    duration: route.duration,
    durationMinutes: Math.round(route.duration / 60),
    geometry: route.geometry,
  }
}

/**
 * Google Maps route calculation
 */
async function getGoogleRoute(origin: Point, destination: Point): Promise<RouteResult> {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_KEY}`

  const response = await fetch(url)
  const data = await response.json()

  if (data.status !== 'OK' || !data.routes?.[0]) {
    throw new Error(`Route calculation failed: ${data.status}`)
  }

  const route = data.routes[0].legs[0]
  return {
    distance: route.distance.value,
    distanceMiles: route.distance.value * 0.000621371,
    duration: route.duration.value,
    durationMinutes: Math.round(route.duration.value / 60),
    polyline: data.routes[0].overview_polyline?.points,
  }
}

/**
 * Optimize route for multiple stops
 * Uses nearest neighbor algorithm with 2-opt improvement
 */
export async function optimizeRoute(stops: Point[], startLocation: Point | null = null) {
  if (stops.length < 2) {
    return {
      optimizedOrder: stops,
      totalDistance: 0,
      totalDuration: 0,
      savings: { distance: 0, time: 0 },
    }
  }

  const allPoints = startLocation ? [startLocation, ...stops] : stops
  const distanceMatrix = await buildDistanceMatrix(allPoints)

  const originalStats = calculateRouteStats(
    startLocation ? [0, ...stops.map((_, i) => i + 1)] : stops.map((_, i) => i),
    distanceMatrix
  )

  const optimizedOrder = nearestNeighbor(distanceMatrix, startLocation ? 0 : null)
  const improvedOrder = twoOpt(optimizedOrder, distanceMatrix)

  const optimizedStats = calculateRouteStats(improvedOrder, distanceMatrix)

  const orderedStops = startLocation
    ? improvedOrder.filter((i) => i !== 0).map((i) => stops[i - 1])
    : improvedOrder.map((i) => stops[i])

  return {
    optimizedOrder: orderedStops,
    originalOrder: stops,
    totalDistance: optimizedStats.distance,
    totalDistanceMiles: optimizedStats.distance * 0.000621371,
    totalDuration: optimizedStats.duration,
    totalDurationMinutes: Math.round(optimizedStats.duration / 60),
    savings: {
      distanceMeters: originalStats.distance - optimizedStats.distance,
      distanceMiles: (originalStats.distance - optimizedStats.distance) * 0.000621371,
      timeSeconds: originalStats.duration - optimizedStats.duration,
      timeMinutes: Math.round((originalStats.duration - optimizedStats.duration) / 60),
      percentDistance:
        originalStats.distance > 0
          ? Math.round((1 - optimizedStats.distance / originalStats.distance) * 100)
          : 0,
      percentTime:
        originalStats.duration > 0
          ? Math.round((1 - optimizedStats.duration / originalStats.duration) * 100)
          : 0,
    },
    legs: await getRouteLegs(orderedStops, startLocation),
  }
}

/**
 * Build distance matrix between all points
 */
async function buildDistanceMatrix(points: Point[]) {
  const n = points.length
  const matrix: { distance: number; duration: number }[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(null))

  for (let i = 0; i < n; i++) {
    matrix[i][i] = { distance: 0, duration: 0 }
    for (let j = i + 1; j < n; j++) {
      try {
        const route = await getRoute(points[i], points[j])
        matrix[i][j] = { distance: route.distance, duration: route.duration }
        matrix[j][i] = { distance: route.distance, duration: route.duration }
      } catch {
        const dist = haversineDistance(points[i], points[j])
        const duration = dist / 13.4
        matrix[i][j] = { distance: dist, duration }
        matrix[j][i] = { distance: dist, duration }
      }
    }
  }

  return matrix
}

/**
 * Haversine distance between two points (meters)
 */
function haversineDistance(p1: Point, p2: Point): number {
  const R = 6371000
  const lat1 = (p1.lat * Math.PI) / 180
  const lat2 = (p2.lat * Math.PI) / 180
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

/**
 * Nearest neighbor algorithm
 */
function nearestNeighbor(matrix: { distance: number; duration: number }[][], startIndex: number | null = 0): number[] {
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

/**
 * 2-opt improvement algorithm
 */
function twoOpt(route: number[], matrix: { distance: number; duration: number }[][]): number[] {
  let improved = true
  let best = [...route]

  while (improved) {
    improved = false
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const delta = calculateSwapDelta(best, i, j, matrix)
        if (delta < 0) {
          const newRoute = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ]
          best = newRoute
          improved = true
        }
      }
    }
  }

  return best
}

function calculateSwapDelta(
  route: number[],
  i: number,
  j: number,
  matrix: { distance: number; duration: number }[][]
): number {
  const a = route[i - 1]
  const b = route[i]
  const c = route[j]
  const d = route[j + 1]

  const currentDist = matrix[a][b].distance + matrix[c][d].distance
  const newDist = matrix[a][c].distance + matrix[b][d].distance

  return newDist - currentDist
}

function calculateRouteStats(order: number[], matrix: { distance: number; duration: number }[][]) {
  let distance = 0
  let duration = 0

  for (let i = 0; i < order.length - 1; i++) {
    distance += matrix[order[i]][order[i + 1]].distance
    duration += matrix[order[i]][order[i + 1]].duration
  }

  return { distance, duration }
}

/**
 * Get detailed legs for optimized route
 */
async function getRouteLegs(stops: Point[], startLocation: Point | null) {
  const legs: any[] = []
  const allPoints = startLocation ? [startLocation, ...stops] : stops

  for (let i = 0; i < allPoints.length - 1; i++) {
    try {
      const route = await getRoute(allPoints[i], allPoints[i + 1])
      legs.push({
        from: allPoints[i],
        to: allPoints[i + 1],
        distance: route.distance,
        distanceMiles: route.distanceMiles,
        duration: route.duration,
        durationMinutes: route.durationMinutes,
      })
    } catch {
      const dist = haversineDistance(allPoints[i], allPoints[i + 1])
      legs.push({
        from: allPoints[i],
        to: allPoints[i + 1],
        distance: dist,
        distanceMiles: dist * 0.000621371,
        duration: dist / 13.4,
        durationMinutes: Math.round(dist / 13.4 / 60),
      })
    }
  }

  return legs
}

/**
 * Get optimized route for a user's jobs for a day
 */
export async function optimizeDayRoute(companyId: string, userId: string, date: string) {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  const jobs = await db
    .select({
      job,
      contactAddress: contact.address,
    })
    .from(job)
    .leftJoin(contact, eq(job.contactId, contact.id))
    .where(
      and(
        eq(job.companyId, companyId),
        eq(job.assignedToId, userId),
        gte(job.scheduledDate, startOfDay),
        lte(job.scheduledDate, endOfDay),
        sql`${job.status} IN ('scheduled', 'in_progress')`
      )
    )

  const stops = jobs
    .filter((j) => j.job.lat && j.job.lng)
    .map((j) => ({
      id: j.job.id,
      name: j.job.title,
      lat: j.job.lat!,
      lng: j.job.lng!,
      address: j.job.address || j.contactAddress,
      scheduledTime: j.job.scheduledDate,
    }))

  if (stops.length < 2) {
    return { jobs: jobs.map((j) => j.job), optimizedRoute: null, message: 'Need at least 2 jobs with coordinates' }
  }

  const optimizedRoute = await optimizeRoute(stops)

  return {
    jobs: jobs.map((j) => j.job),
    optimizedRoute,
    googleMapsUrl: generateGoogleMapsUrl(optimizedRoute.optimizedOrder),
  }
}

/**
 * Generate Google Maps URL for navigation
 */
export function generateGoogleMapsUrl(stops: Point[]): string | null {
  if (stops.length === 0) return null

  const waypoints = stops
    .slice(1, -1)
    .map((s) => `${s.lat},${s.lng}`)
    .join('|')
  const origin = stops[0]
  const destination = stops[stops.length - 1]

  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`

  if (waypoints) {
    url += `&waypoints=${encodeURIComponent(waypoints)}`
  }

  return url
}

/**
 * Calculate fuel cost for route
 */
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

export default {
  getRoute,
  optimizeRoute,
  optimizeDayRoute,
  generateGoogleMapsUrl,
  calculateFuelCost,
}
