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
import { vehicle, vehicleMaintenance, fuelLog } from '../../db/schema.ts'
import { eq, and, desc, count, gte, sql } from 'drizzle-orm'

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

export async function getVehicles(companyId: string, { status = 'active', assignedUserId }: { status?: string; assignedUserId?: string } = {}) {
  const conditions = [eq(vehicle.companyId, companyId)]
  if (status) conditions.push(eq(vehicle.status, status))
  if (assignedUserId) conditions.push(eq(vehicle.assignedUserId, assignedUserId))

  return db.select()
    .from(vehicle)
    .where(and(...conditions))
    .orderBy(vehicle.name)
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
// LOCATION TRACKING (no GPS table in schema — return neutral data)
// ============================================

export async function updateLocation(vehicleId: string, companyId: string, _loc: { lat: number; lng: number; speed?: number; heading?: number; accuracy?: number }) {
  // No location table yet; verify ownership and no-op so callers don't error.
  const [found] = await db.select({ id: vehicle.id })
    .from(vehicle)
    .where(and(eq(vehicle.id, vehicleId), eq(vehicle.companyId, companyId)))
  return found || null
}

export async function getLocationHistory(_vehicleId: string, _companyId: string, _opts: { startDate?: string; endDate?: string } = {}) {
  return []
}

export async function getFleetLocations(companyId: string) {
  const vehicles = await db.select({ id: vehicle.id, name: vehicle.name, status: vehicle.status })
    .from(vehicle)
    .where(and(eq(vehicle.companyId, companyId), eq(vehicle.status, 'active')))

  return vehicles.map(v => ({ ...v, lat: null, lng: null, speed: null }))
}

export async function startTrip(vehicleId: string, _companyId: string, _data: any) {
  return { id: 'stub', vehicleId, startTime: new Date(), status: 'active' }
}

export async function endTrip(tripId: string, _companyId: string, _data: any) {
  return { id: tripId, status: 'completed', endTime: new Date() }
}

export async function getTrips(_companyId: string, _opts: any = {}) {
  return { data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } }
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

  return {
    totalVehicles: vehicleCount?.value ?? 0,
    tripsThisMonth: 0,
    milesThisMonth: 0,
    fuelCostThisMonth: Number(fuelThisMonth?.cost ?? 0),
    gallonsThisMonth: Number(fuelThisMonth?.gallons ?? 0),
  }
}

export default {
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
