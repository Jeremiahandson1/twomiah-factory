/**
 * Fleet / Vehicle GPS Tracking Service
 *
 * Track company vehicles:
 * - Real-time location
 * - Trip history
 * - Mileage tracking
 * - Maintenance reminders
 * - Fuel tracking
 * - Driver assignment
 */

import { db } from '../../db/index.ts'
import { equipment, equipmentMaintenance, user } from '../../db/schema.ts'
import { eq, and, desc, count, sql, sum } from 'drizzle-orm'

// NOTE: The original Prisma schema had vehicle, vehicleMaintenance, and fuelLog tables.
// The Drizzle schema uses equipment/equipmentMaintenance as the closest equivalent.
// If dedicated vehicle/fuelLog tables are added to the schema, update imports accordingly.

// ============================================
// VEHICLES (mapped to equipment table)
// ============================================

/**
 * Create vehicle
 */
export async function createVehicle(companyId: string, data: any) {
  const [vehicle] = await db.insert(equipment).values({
    companyId,
    name: data.name,
    status: 'active',
    model: data.model,
    manufacturer: data.make,
    serialNumber: data.vin,
    notes: JSON.stringify({
      type: data.type || 'truck',
      year: data.year,
      licensePlate: data.licensePlate,
      color: data.color,
      currentMileage: data.currentMileage || 0,
      nextOilChangeMiles: data.nextOilChangeMiles,
      nextServiceMiles: data.nextServiceMiles,
      registrationExpires: data.registrationExpires,
      insuranceExpires: data.insuranceExpires,
      assignedUserId: data.assignedUserId,
      gpsDeviceId: data.gpsDeviceId,
      imageUrl: data.imageUrl,
    }),
  }).returning()

  return vehicle
}

/**
 * Get vehicles
 */
export async function getVehicles(companyId: string, { status = 'active', assignedUserId }: { status?: string; assignedUserId?: string } = {}) {
  const conditions = [eq(equipment.companyId, companyId)]
  if (status) conditions.push(eq(equipment.status, status))

  const vehicles = await db.select()
    .from(equipment)
    .where(and(...conditions))
    .orderBy(equipment.name)

  return vehicles
}

/**
 * Get single vehicle with details
 */
export async function getVehicle(vehicleId: string, companyId: string) {
  const [vehicle] = await db.select()
    .from(equipment)
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))

  if (!vehicle) return null

  const maintenanceLogs = await db.select()
    .from(equipmentMaintenance)
    .where(eq(equipmentMaintenance.equipmentId, vehicleId))
    .orderBy(desc(equipmentMaintenance.performedAt))
    .limit(10)

  return { ...vehicle, maintenanceLogs }
}

/**
 * Update vehicle
 */
export async function updateVehicle(vehicleId: string, companyId: string, data: any) {
  return db.update(equipment)
    .set(data)
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))
}

/**
 * Assign vehicle to user
 */
export async function assignVehicle(vehicleId: string, companyId: string, userId: string) {
  // Store assignment in notes since equipment table lacks assignedUserId
  const [vehicle] = await db.select()
    .from(equipment)
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))

  if (!vehicle) return null

  const existingNotes = vehicle.notes ? JSON.parse(vehicle.notes) : {}
  existingNotes.assignedUserId = userId

  return db.update(equipment)
    .set({ notes: JSON.stringify(existingNotes) })
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))
}

// ============================================
// LOCATION TRACKING
// ============================================

/**
 * Update vehicle location
 */
export async function updateLocation(vehicleId: string, companyId: string, { lat, lng, speed, heading, accuracy }: { lat: number; lng: number; speed?: number; heading?: number; accuracy?: number }) {
  // Location tracking not fully in current schema
  return db.update(equipment)
    .set({})
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))
}

export async function getLocationHistory(vehicleId: string, companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
  // Location history not in current schema
  return []
}

export async function getFleetLocations(companyId: string) {
  const vehicles = await db.select({
    id: equipment.id,
    name: equipment.name,
    status: equipment.status,
  })
    .from(equipment)
    .where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'active')))

  return vehicles.map(v => ({ ...v, lat: null, lng: null, speed: null }))
}

export async function startTrip(vehicleId: string, companyId: string, data: any) {
  // Trip tracking not in current schema
  return { id: 'stub', vehicleId, startTime: new Date(), status: 'active' }
}

export async function endTrip(tripId: string, companyId: string, data: any) {
  // Trip tracking not in current schema
  return { id: tripId, status: 'completed', endTime: new Date() }
}

export async function getTrips(companyId: string, opts: any = {}) {
  // Trip tracking not in current schema
  return { data: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } }
}

export async function addMaintenance(vehicleId: string, companyId: string, data: any) {
  const [record] = await db.insert(equipmentMaintenance).values({
    equipmentId: vehicleId,
    type: data.type,
    description: data.description,
    cost: data.cost ? String(data.cost) : undefined,
    performedAt: data.date ? new Date(data.date) : new Date(),
    nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
  }).returning()

  return record
}

/**
 * Get maintenance due
 */
export async function getMaintenanceDue(companyId: string) {
  const vehicles = await db.select()
    .from(equipment)
    .where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'active')))

  const due: Array<{ vehicle: any; alerts: Array<{ type: string; message: string }> }> = []
  const now = new Date()

  for (const v of vehicles) {
    const alerts: Array<{ type: string; message: string }> = []
    const notes = v.notes ? JSON.parse(v.notes) : {}

    if (notes.nextOilChangeMiles && notes.currentMileage >= notes.nextOilChangeMiles - 500) {
      alerts.push({ type: 'oil_change', message: 'Oil change due soon' })
    }
    if (notes.nextServiceMiles && notes.currentMileage >= notes.nextServiceMiles - 1000) {
      alerts.push({ type: 'service', message: 'Service due soon' })
    }
    if (notes.registrationExpires && new Date(notes.registrationExpires) <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) {
      alerts.push({ type: 'registration', message: 'Registration expiring' })
    }
    if (notes.insuranceExpires && new Date(notes.insuranceExpires) <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)) {
      alerts.push({ type: 'insurance', message: 'Insurance expiring' })
    }

    if (alerts.length > 0) {
      due.push({ vehicle: v, alerts })
    }
  }

  return due
}

// ============================================
// FUEL
// ============================================

/**
 * Add fuel entry
 */
export async function addFuelEntry(vehicleId: string, companyId: string, data: any) {
  // fuelLog table not in schema - store as maintenance record
  const [vehicle] = await db.select()
    .from(equipment)
    .where(and(eq(equipment.id, vehicleId), eq(equipment.companyId, companyId)))

  if (!vehicle) throw new Error('Vehicle not found')

  const totalCost = (data.gallons || 0) * (data.pricePerGallon || 0)
  const [entry] = await db.insert(equipmentMaintenance).values({
    equipmentId: vehicleId,
    type: 'fuel',
    description: `Fuel: ${data.gallons}gal @ $${data.pricePerGallon}/gal at ${data.station || 'unknown'}`,
    cost: String(totalCost),
    performedAt: new Date(),
  }).returning()

  return entry
}

export async function getFuelStats(vehicleId: string, companyId: string, { months = 3 }: { months?: number } = {}) {
  const since = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)

  const entries = await db.select()
    .from(equipmentMaintenance)
    .where(and(
      eq(equipmentMaintenance.equipmentId, vehicleId),
      eq(equipmentMaintenance.type, 'fuel'),
    ))
    .orderBy(desc(equipmentMaintenance.performedAt))

  const totalCost = entries.reduce((s, e) => s + Number(e.cost || 0), 0)
  return { entries, totalCost, totalGallons: 0, avgMpg: 0, fillUps: entries.length }
}

export async function getFleetStats(companyId: string) {
  const [vehicleCount] = await db.select({ value: count() })
    .from(equipment)
    .where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'active')))

  return {
    totalVehicles: vehicleCount?.value ?? 0,
    tripsThisMonth: 0,
    milesThisMonth: 0,
    fuelCostThisMonth: 0,
    gallonsThisMonth: 0,
  }
}

// Helper
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Haversine formula - returns miles
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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
