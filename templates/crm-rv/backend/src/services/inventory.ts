// Inventory — shared implementation (packages/tenant-backend/src/inventory/inventory.ts), vendored as ../shared.
import { createInventoryService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import emailService from './email.ts'
import {
  inventoryItem, inventoryLocation, stockLevel, inventoryTransaction, inventoryUsage,
  inventoryTransfer, purchaseOrder, purchaseOrderItem, user, job, company,
} from '../../db/schema.ts'

export default createInventoryService({
  db,
  tables: { inventoryItem, inventoryLocation, stockLevel, inventoryTransaction, inventoryUsage, inventoryTransfer, purchaseOrder, purchaseOrderItem, user, job, company },
  emailService,
})
