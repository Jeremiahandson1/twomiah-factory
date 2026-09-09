/**
 * Fleet / Vehicle Tracking Service
 *
 * Track company vehicles (dedicated `vehicle` table — NOT the customer
 * `equipment` table). Earlier this service mapped vehicles onto `equipment`
 * because the Drizzle schema had no vehicle table; it does now (vehicle,
 * vehicleMaintenance, fuelLog), so Fleet and customer Equipment are no longer
 * the same data.
 */

import { db } from '../../db/index.ts'
import { vehicle, vehicleMaintenance, fuelLog, vehicleTrip, locationLog, user } from '../../db/schema.ts'
import { eq, and, desc, count, gte, lte, sql } from 'drizzle-orm'
import { calculateDistance } from './geofencing.ts'

const METERS_PER_MILE = 1609.344

// ============================================
// VEHICLES
// ============================================

export async function createVehicle(companyId: string, data: any) {
  const [created] = await db.insert(vehicle).values({
    companyId,
    name: data.name,
    type: data.type || 'truck',
    make: data.make || null,
    model: data.model || null,
    year: data.year ? Number(data.year) : null,
    vin: data.vin || null,
    licensePlate: data.licensePlate || null,
    status: data.status || 'active',
    color: data.color || null,
    notes: data.notes || null,
    assignedUserId: data.assignedUserId || null,
    currentMileage: data.currentMileage != null ? Number(data.currentMileage) : null,
    fuelType: data.fuelType || null,
  }).returning()

  return created
}

export type LivePosition = { lat: number; lng: number; speed: number | null; accuracy: number | null; timestamp: Date }

// Latest location_log ping per driver (one query, Postgres DISTINCT ON). A
// vehicle's live position is derived from whoever is assigned to drive it — the
// phone-based location feed, not a separate GPS unit.
async function latestPositionByDriver(companyId: string, userIds: string[]): Promise<Record<string, LivePosition>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return {}
  const res: any = await db.execute(sql`
    SELECT DISTINCT ON (user_id) user_id, lat, lng, accuracy, timestamp
    FROM location_log
    WHERE company_id = ${companyId} AND user_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    ORDER BY user_id, timestamp DESC
  `)
  const rows = res.rows || res
  const out: Record<string, LivePosition> = {}
  for (const r of rows) {
    out[r.user_id] = {
      lat: Number(r.lat), lng: Number(r.lng), speed: null,
      accuracy: r.accuracy != null ? Number(r.accuracy) : null,
      timestamp: r.timestamp,
    }
  }
  return out
}

export async function getVehicles(companyId: string, { status = 'active', assignedUserId }: { status?: string; assignedUserId?: string } = {}) {
  const conditions = [eq(vehicle.companyId, companyId)]
  if (status) conditions.push(eq(vehicle.status, status))
  if (assignedUserId) conditions.push(eq(vehicle.assignedUserId, assignedUserId))

  const vehicles = await db.select()
    .from(vehicle)
    .where(and(...conditions))
    .orderBy(vehicle.name)

  const positions = await latestPositionByDriver(companyId, vehicles.map(v => v.assignedUserId).filter(Boolean) as string[])
  return vehicles.map(v => ({
    ...v,
    currentLocation: v.assignedUserId ? (positions[v.assignedUserId] ?? null) : null,
  }))
}

export async function getVehicle(vehicleId: string, companyId: string) {
  const [found] = await db.select()
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))

  if (!found) return null

  const maintenanceLogs = await db.select()
    .from(vehicleMaintenance)
    .where(eq(vehicleMaintenance.vehicleId, vehicleId))
    .orderBy(desc(vehicleMaintenance.performedAt))
    .limit(10)

  const fuelEntries = await db.select()
    .from(fuelLog)
    .where(eq(fuelLog.vehicleId, vehicleId))
    .orderBy(desc(fuelLog.createdAt))
    .limit(10)

  return { ...found, maintenanceLogs, fuelEntries }
}

export async function updateVehicle(vehicleId: string, companyId: string, data: any) {
  const patch: Record<string, any> = { updatedAt: new Date() }
  for (const k of ['name', 'type', 'make', 'model', 'vin', 'licensePlate', 'status', 'color', 'notes', 'assignedUserId', 'fuelType']) {
    if (data[k] !== undefined) patch[k] = data[k]
  }
  if (data.year !== undefined) patch.year = data.year ? Number(data.year) : null
  if (data.currentMileage !== undefined) patch.currentMileage = data.currentMileage != null ? Number(data.currentMileage) : null

  return db.update(vehicle)
    .set(patch)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
}

export async function assignVehicle(vehicleId: string, companyId: string, userId: string) {
  return db.update(vehicle)
    .set({ assignedUserId: userId || null, updatedAt: new Date() })
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
}

// ============================================
// LOCATION TRACKING (driver phone → location_log → vehicle)
// ============================================

// A vehicle has no GPS unit of its own; its position is that of the assigned
// driver's phone, reported through the shared location_log feed. This endpoint
// lets a vehicle-scoped reporter push a fix, which we record against the driver.
export async function updateLocation(vehicleId: string, companyId: string, loc: { lat: number; lng: number; speed?: number; heading?: number; accuracy?: number }) {
  const [found] = await db.select({ id: vehicle.id, assignedUserId: vehicle.assignedUserId })
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  if (!found) return null

  if (found.assignedUserId && loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    await db.insert(locationLog).values({
      lat: loc.lat,
      lng: loc.lng,
      accuracy: loc.accuracy ?? null,
      action: 'vehicle',
      userId: found.assignedUserId,
      companyId,
    })
  }
  return found
}

export async function getLocationHistory(vehicleId: string, companyId: string, opts: { startDate?: string; endDate?: string } = {}) {
  const [v] = await db.select({ assignedUserId: vehicle.assignedUserId })
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  if (!v?.assignedUserId) return []

  const conditions = [eq(locationLog.userId, v.assignedUserId), eq(locationLog.companyId, companyId)]
  if (opts.startDate) conditions.push(gte(locationLog.timestamp, new Date(opts.startDate)))
  if (opts.endDate) conditions.push(lte(locationLog.timestamp, new Date(opts.endDate)))

  return db.select({ lat: locationLog.lat, lng: locationLog.lng, accuracy: locationLog.accuracy, timestamp: locationLog.timestamp })
    .from(locationLog)
    .where(and(...conditions))
    .orderBy(desc(locationLog.timestamp))
    .limit(500)
}

export async function getFleetLocations(companyId: string) {
  const vehicles = await getVehicles(companyId, { status: 'active' })
  return vehicles.map(v => ({
    id: v.id,
    name: v.name,
    status: v.status,
    assignedUserId: v.assignedUserId,
    lat: v.currentLocation?.lat ?? null,
    lng: v.currentLocation?.lng ?? null,
    speed: null,
    lastSeen: v.currentLocation?.timestamp ?? null,
  }))
}

export async function startTrip(vehicleId: string, companyId: string, data: any) {
  const [v] = await db.select({ id: vehicle.id, assignedUserId: vehicle.assignedUserId })
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  if (!v) throw new Error('Vehicle not found')

  const [trip] = await db.insert(vehicleTrip).values({
    vehicleId,
    companyId,
    userId: data.userId || v.assignedUserId || null,
    status: 'active',
    startTime: new Date(),
    startLat: Number.isFinite(data.lat) ? data.lat : null,
    startLng: Number.isFinite(data.lng) ? data.lng : null,
    purpose: data.purpose || null,
  }).returning()
  return trip
}

export async function endTrip(tripId: string, companyId: string, data: any) {
  const [trip] = await db.select().from(vehicleTrip)
    .where(and(eq(vehicleTrip.id, tripId), eq(vehicleTrip.companyId, companyId)))
  if (!trip) throw new Error('Trip not found')
  if (trip.status === 'completed') return trip

  const endTime = new Date()
  let distanceMeters = 0
  let endLat = Number.isFinite(data?.lat) ? data.lat : null
  let endLng = Number.isFinite(data?.lng) ? data.lng : null

  // Distance = sum of consecutive haversine hops in the driver's pings during
  // the trip window (calculateDistance returns meters).
  if (trip.userId) {
    const points = await db.select({ lat: locationLog.lat, lng: locationLog.lng })
      .from(locationLog)
      .where(and(
        eq(locationLog.userId, trip.userId),
        eq(locationLog.companyId, companyId),
        gte(locationLog.timestamp, trip.startTime),
        lte(locationLog.timestamp, endTime),
      ))
      .orderBy(locationLog.timestamp)
    for (let i = 1; i < points.length; i++) {
      distanceMeters += calculateDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    }
    if (points.length > 0) {
      endLat = points[points.length - 1].lat
      endLng = points[points.length - 1].lng
    }
  }

  const [updated] = await db.update(vehicleTrip).set({
    status: 'completed',
    endTime,
    endLat,
    endLng,
    distanceMiles: distanceMeters / METERS_PER_MILE,
  }).where(eq(vehicleTrip.id, tripId)).returning()
  return updated
}

export async function getTrips(companyId: string, _opts: any = {}) {
  const rows = await db.select({
    id: vehicleTrip.id,
    startTime: vehicleTrip.startTime,
    endTime: vehicleTrip.endTime,
    distanceMiles: vehicleTrip.distanceMiles,
    status: vehicleTrip.status,
    vehicleName: vehicle.name,
    driverFirst: user.firstName,
    driverLast: user.lastName,
  })
    .from(vehicleTrip)
    .leftJoin(vehicle, eq(vehicleTrip.vehicleId, vehicle.id))
    .leftJoin(user, eq(vehicleTrip.userId, user.id))
    .where(eq(vehicleTrip.companyId, companyId))
    .orderBy(desc(vehicleTrip.startTime))
    .limit(100)

  const data = rows.map(r => ({
    id: r.id,
    vehicle: { name: r.vehicleName },
    driver: r.driverFirst ? { firstName: r.driverFirst, lastName: r.driverLast } : null,
    startTime: r.startTime,
    endTime: r.endTime,
    distance: r.distanceMiles != null ? Number(r.distanceMiles) : null,
    duration: r.endTime ? Math.round((new Date(r.endTime).getTime() - new Date(r.startTime).getTime()) / 60000) : null,
  }))
  return { data, pagination: { page: 1, limit: 100, total: data.length, pages: 1 } }
}

// ============================================
// MAINTENANCE
// ============================================

// Ensure the vehicle belongs to the company before touching child rows.
async function ownedVehicle(vehicleId: string, companyId: string) {
  const [found] = await db.select()
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  return found || null
}

export async function addMaintenance(vehicleId: string, companyId: string, data: any) {
  if (!(await ownedVehicle(vehicleId, companyId))) throw new Error('Vehicle not found')
  const [record] = await db.insert(vehicleMaintenance).values({
    vehicleId,
    type: data.type,
    description: data.description || null,
    cost: data.cost != null ? String(data.cost) : null,
    mileage: data.mileage != null ? Number(data.mileage) : null,
    performedAt: data.date ? new Date(data.date) : new Date(),
    nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
    nextDueMileage: data.nextDueMileage != null ? Number(data.nextDueMileage) : null,
  }).returning()

  return record
}

export async function getMaintenanceDue(companyId: string) {
  const vehicles = await db.select()
    .from(vehicle)
    .where(and(eq(vehicle.companyId, companyId), eq(vehicle.status, 'active')))

  const due: Array<{ vehicle: any; alerts: Array<{ type: string; message: string }> }> = []
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  for (const v of vehicles) {
    const logs = await db.select()
      .from(vehicleMaintenance)
      .where(eq(vehicleMaintenance.vehicleId, v.id))
      .orderBy(desc(vehicleMaintenance.performedAt))

    const alerts: Array<{ type: string; message: string }> = []
    for (const log of logs) {
      if (log.nextDueDate && new Date(log.nextDueDate) <= soon) {
        alerts.push({ type: log.type || 'service', message: `${log.type || 'Service'} due by ${new Date(log.nextDueDate).toLocaleDateString()}` })
      }
      if (log.nextDueMileage != null && v.currentMileage != null && v.currentMileage >= log.nextDueMileage - 500) {
        alerts.push({ type: log.type || 'service', message: `${log.type || 'Service'} due at ${log.nextDueMileage} mi` })
      }
    }
    if (alerts.length > 0) due.push({ vehicle: v, alerts })
  }

  return due
}

// ============================================
// FUEL
// ============================================

export async function addFuelEntry(vehicleId: string, companyId: string, data: any) {
  if (!(await ownedVehicle(vehicleId, companyId))) throw new Error('Vehicle not found')
  const gallons = Number(data.gallons || 0)
  const pricePerGallon = Number(data.pricePerGallon || 0)
  const totalCost = data.totalCost != null ? Number(data.totalCost) : gallons * pricePerGallon

  const [entry] = await db.insert(fuelLog).values({
    vehicleId,
    gallons: String(gallons),
    pricePerGallon: String(pricePerGallon),
    totalCost: String(totalCost),
    mileage: data.mileage != null ? Number(data.mileage) : null,
    station: data.station || null,
  }).returning()

  // Keep the odometer current so maintenance-due math stays accurate.
  if (data.mileage != null) {
    await db.update(vehicle).set({ currentMileage: Number(data.mileage), updatedAt: new Date() })
      .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  }

  return entry
}

export async function getFuelStats(vehicleId: string, companyId: string, { months = 3 }: { months?: number } = {}) {
  if (!(await ownedVehicle(vehicleId, companyId))) return { entries: [], totalCost: 0, totalGallons: 0, avgMpg: 0, fillUps: 0 }
  const since = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)

  const entries = await db.select()
    .from(fuelLog)
    .where(and(eq(fuelLog.vehicleId, vehicleId), gte(fuelLog.createdAt, since)))
    .orderBy(desc(fuelLog.createdAt))

  const totalCost = entries.reduce((s, e) => s + Number(e.totalCost || 0), 0)
  const totalGallons = entries.reduce((s, e) => s + Number(e.gallons || 0), 0)
  return { entries, totalCost, totalGallons, avgMpg: 0, fillUps: entries.length }
}

export async function getFleetStats(companyId: string) {
  const [vehicleCount] = await db.select({ value: count() })
    .from(vehicle)
    .where(and(eq(vehicle.companyId, companyId), eq(vehicle.status, 'active')))

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [fuelThisMonth] = await db.select({
    cost: sql<string>`coalesce(sum(${fuelLog.totalCost}), 0)`,
    gallons: sql<string>`coalesce(sum(${fuelLog.gallons}), 0)`,
  })
    .from(fuelLog)
    .innerJoin(vehicle, eq(fuelLog.vehicleId, vehicle.id))
    .where(and(eq(vehicle.companyId, companyId), gte(fuelLog.createdAt, monthStart)))

  const [tripsThisMonth] = await db.select({
    trips: count(),
    miles: sql<string>`coalesce(sum(${vehicleTrip.distanceMiles}), 0)`,
  })
    .from(vehicleTrip)
    .where(and(eq(vehicleTrip.companyId, companyId), gte(vehicleTrip.startTime, monthStart)))

  return {
    totalVehicles: vehicleCount?.value ?? 0,
    tripsThisMonth: Number(tripsThisMonth?.trips ?? 0),
    milesThisMonth: Number(tripsThisMonth?.miles ?? 0),
    fuelCostThisMonth: Number(fuelThisMonth?.cost ?? 0),
    gallonsThisMonth: Number(fuelThisMonth?.gallons ?? 0),
  }
}

export async function deleteVehicle(id: string, companyId: string) {
  return db.delete(vehicle).where(and(eq(vehicle.id, id), eq(vehicle.companyId, companyId)))
}

export default {
  deleteVehicle,
  createVehicle,
  getVehicles,
  getVehicle,
  updateVehicle,
  assignVehicle,
  updateLocation,
  getLocationHistory,
  getFleetLocations,
  startTrip,
  endTrip,
  getTrips,
  addMaintenance,
  getMaintenanceDue,
  addFuelEntry,
  getFuelStats,
  getFleetStats,
}
