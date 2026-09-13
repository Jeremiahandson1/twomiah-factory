// Fleet — shared implementation (packages/tenant-backend/src/fleet/fleet.ts), vendored as ../shared.
import { createFleetService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { vehicle, vehicleMaintenance, fuelLog } from '../../db/schema.ts'

export default createFleetService({ db, tables: { vehicle, vehicleMaintenance, fuelLog } })
