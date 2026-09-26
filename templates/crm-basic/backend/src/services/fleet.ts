// Fleet — shared implementation (packages/tenant-backend/src/fleet/fleet.ts), vendored as ../shared.
import { createFleetService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { vehicle, vehicleMaintenance, fuelLog, vehicleTrip, locationLog, user } from '../../db/schema.ts'
import { calculateDistance } from './geofencing.ts'

export default createFleetService({
  db,
  tables: { vehicle, vehicleMaintenance, fuelLog, vehicleTrip, locationLog, user },
  calculateDistance,
  options: { gps: true },
})
