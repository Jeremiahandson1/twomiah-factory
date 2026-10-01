// Equipment routes — shared implementation (packages/tenant-backend/src/equipment/equipment.ts), vendored as ../shared.
import { createEquipmentService, createEquipmentRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { equipment, equipmentCategory, equipmentMaintenance, contact } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const service = createEquipmentService({
  db,
  tables: { equipment, equipmentCategory, equipmentMaintenance, contact },
  // Customer-asset tracking, the same as crm-basic / crm-fieldservice / crm-landscaping. Without
  // this the shared service drops contactId even once the column exists. (T32 H9)
  options: { contacts: true },
})
export default createEquipmentRoutes({ service, authenticate, requirePermission })
