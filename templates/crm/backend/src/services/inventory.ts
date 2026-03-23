/**
 * Inventory Management Service
 *
 * Track parts and materials across:
 * - Warehouses
 * - Trucks/vehicles
 * - Jobs
 *
 * Features:
 * - Stock levels and locations
 * - Purchase orders
 * - Transfers between locations
 * - Usage tracking on jobs
 * - Low stock alerts
 * - Cost tracking
 */

import { db } from '../../db/index.ts'
import {
  inventoryItem,
  inventoryLocation,
  stockLevel,
  inventoryTransaction,
  inventoryUsage,
  inventoryTransfer,
  purchaseOrder,
  purchaseOrderItem,
  user,
  job,
} from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc, gte, gt, sql, inArray } from 'drizzle-orm'

// ============================================
// INVENTORY ITEMS (Parts/Materials)
// ============================================

/**
 * Create inventory item
 */
export async function createItem(companyId: string, data: any) {
  const sku = data.sku || await generateSku(companyId)

  const [item] = await db.insert(inventoryItem).values({
    companyId,
    sku,
    name: data.name,
    description: data.description,
    category: data.category,
    unitCost: String(data.unitCost || 0),
    unitPrice: String(data.unitPrice || 0),
    unit: data.unit || 'each',
    minStockLevel: data.minStockLevel || 0,
    reorderPoint: data.reorderPoint || 0,
    reorderQuantity: data.reorderQuantity || 0,
    vendor: data.vendor,
    vendorPartNumber: data.vendorPartNumber,
    barcode: data.barcode,
    imageUrl: data.imageUrl,
    taxable: data.taxable ?? true,
    active: true,
  }).returning()

  return item
}

/**
 * Generate SKU
 */
async function generateSku(companyId: string): Promise<string> {
  const [result] = await db.select({ value: count() })
    .from(inventoryItem)
    .where(eq(inventoryItem.companyId, companyId))

  return `PART-${String((result?.value ?? 0) + 1).padStart(5, '0')}`
}

/**
 * Get inventory items with filters
 */
export async function getItems(companyId: string, {
  search,
  category,
  lowStock,
  active = true,
  page = 1,
  limit = 50,
}: {
  search?: string
  category?: string
  lowStock?: boolean
  active?: boolean | null
  page?: number
  limit?: number
} = {}) {
  const conditions = [eq(inventoryItem.companyId, companyId)]

  if (active !== null) conditions.push(eq(inventoryItem.active, active!))
  if (category) conditions.push(eq(inventoryItem.category, category))
  if (search) {
    conditions.push(or(
      ilike(inventoryItem.name, `%${search}%`),
      ilike(inventoryItem.sku, `%${search}%`),
      ilike(inventoryItem.description, `%${search}%`),
    )!)
  }

  const whereClause = and(...conditions)

  const [items, [totalResult]] = await Promise.all([
    db.select()
      .from(inventoryItem)
      .where(whereClause)
      .orderBy(asc(inventoryItem.name))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(inventoryItem)
      .where(whereClause),
  ])

  const total = totalResult?.value ?? 0

  // Get stock levels for these items
  const itemIds = items.map(i => i.id)
  const stockLevels = itemIds.length > 0
    ? await db.select()
        .from(stockLevel)
        .innerJoin(inventoryLocation, eq(stockLevel.locationId, inventoryLocation.id))
        .where(inArray(stockLevel.itemId, itemIds))
    : []

  // Calculate total stock and check low stock
  const itemsWithStock = items.map(item => {
    const itemStockLevels = stockLevels
      .filter(sl => sl.stock_level.itemId === item.id)
      .map(sl => ({
        ...sl.stock_level,
        location: sl.inventory_location,
      }))
    const totalStock = itemStockLevels.reduce((sum, sl) => sum + sl.quantity, 0)
    return {
      ...item,
      stockLevels: itemStockLevels,
      totalStock,
      isLowStock: totalStock <= item.reorderPoint,
    }
  })

  // Filter low stock if requested
  const filtered = lowStock
    ? itemsWithStock.filter(i => i.isLowStock)
    : itemsWithStock

  return {
    data: filtered,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get single item with full details
 */
export async function getItem(itemId: string, companyId: string) {
  const [item] = await db.select()
    .from(inventoryItem)
    .where(and(eq(inventoryItem.id, itemId), eq(inventoryItem.companyId, companyId)))

  if (!item) return null

  const stockLevels = await db.select()
    .from(stockLevel)
    .innerJoin(inventoryLocation, eq(stockLevel.locationId, inventoryLocation.id))
    .where(eq(stockLevel.itemId, itemId))

  const usageHistory = await db.select()
    .from(inventoryUsage)
    .leftJoin(job, eq(inventoryUsage.jobId, job.id))
    .leftJoin(user, eq(inventoryUsage.userId, user.id))
    .where(eq(inventoryUsage.itemId, itemId))
    .orderBy(desc(inventoryUsage.createdAt))
    .limit(20)

  return {
    ...item,
    stockLevels: stockLevels.map(sl => ({
      ...sl.stock_level,
      location: sl.inventory_location,
    })),
    usageHistory: usageHistory.map(u => ({
      ...u.inventory_usage,
      job: u.job ? { id: u.job.id, title: u.job.title, number: u.job.number } : null,
      user: u.user ? { id: u.user.id, firstName: u.user.firstName, lastName: u.user.lastName } : null,
    })),
  }
}

/**
 * Update inventory item
 */
export async function updateItem(itemId: string, companyId: string, data: any) {
  return db.update(inventoryItem)
    .set(data)
    .where(and(eq(inventoryItem.id, itemId), eq(inventoryItem.companyId, companyId)))
}

/**
 * Get categories
 */
export async function getCategories(companyId: string): Promise<string[]> {
  const categories = await db.selectDistinct({ category: inventoryItem.category })
    .from(inventoryItem)
    .where(and(eq(inventoryItem.companyId, companyId), sql`${inventoryItem.category} IS NOT NULL`))

  return categories.map(c => c.category).filter(Boolean) as string[]
}

// ============================================
// LOCATIONS (Warehouses, Trucks)
// ============================================

/**
 * Create inventory location
 */
export async function createLocation(companyId: string, data: any) {
  const [location] = await db.insert(inventoryLocation).values({
    companyId,
    name: data.name,
    type: data.type || 'warehouse',
    address: data.address,
    assignedUserId: data.assignedUserId,
    active: true,
  }).returning()

  return location
}

/**
 * Get locations
 */
export async function getLocations(companyId: string, { type, active = true }: { type?: string; active?: boolean | null } = {}) {
  const conditions = [eq(inventoryLocation.companyId, companyId)]
  if (type) conditions.push(eq(inventoryLocation.type, type))
  if (active !== null) conditions.push(eq(inventoryLocation.active, active!))

  const locations = await db.select()
    .from(inventoryLocation)
    .leftJoin(user, eq(inventoryLocation.assignedUserId, user.id))
    .where(and(...conditions))
    .orderBy(asc(inventoryLocation.name))

  // Get stock level counts per location
  const locationIds = locations.map(l => l.inventory_location.id)
  const stockCounts = locationIds.length > 0
    ? await db.select({
        locationId: stockLevel.locationId,
        count: count(),
      })
        .from(stockLevel)
        .where(inArray(stockLevel.locationId, locationIds))
        .groupBy(stockLevel.locationId)
    : []

  return locations.map(l => ({
    ...l.inventory_location,
    assignedUser: l.user ? { id: l.user.id, firstName: l.user.firstName, lastName: l.user.lastName } : null,
    _count: {
      stockLevels: stockCounts.find(sc => sc.locationId === l.inventory_location.id)?.count ?? 0,
    },
  }))
}

/**
 * Get location inventory
 */
export async function getLocationInventory(locationId: string, companyId: string) {
  const [location] = await db.select()
    .from(inventoryLocation)
    .where(and(eq(inventoryLocation.id, locationId), eq(inventoryLocation.companyId, companyId)))

  if (!location) return null

  const stockLevels = await db.select()
    .from(stockLevel)
    .innerJoin(inventoryItem, eq(stockLevel.itemId, inventoryItem.id))
    .where(and(eq(stockLevel.locationId, locationId), gt(stockLevel.quantity, 0)))
    .orderBy(asc(inventoryItem.name))

  return {
    ...location,
    stockLevels: stockLevels.map(sl => ({
      ...sl.stock_level,
      item: sl.inventory_item,
    })),
  }
}

// ============================================
// STOCK LEVELS
// ============================================

/**
 * Get stock level for item at location
 */
export async function getStockLevel(itemId: string, locationId: string) {
  const [result] = await db.select()
    .from(stockLevel)
    .where(and(eq(stockLevel.itemId, itemId), eq(stockLevel.locationId, locationId)))

  return result || null
}

/**
 * Adjust stock level (add or remove)
 */
export async function adjustStock(companyId: string, {
  itemId,
  locationId,
  quantity,
  reason,
  userId,
  jobId,
  cost,
}: {
  itemId: string
  locationId: string
  quantity: number
  reason?: string
  userId?: string
  jobId?: string
  cost?: number
}) {
  // Get or create stock level
  let existing = await getStockLevel(itemId, locationId)

  if (!existing) {
    const [created] = await db.insert(stockLevel).values({
      itemId,
      locationId,
      quantity: 0,
    }).returning()
    existing = created
  }

  const newQuantity = existing.quantity + quantity

  if (newQuantity < 0) {
    throw new Error('Insufficient stock')
  }

  // Update stock level
  const [updated] = await db.update(stockLevel)
    .set({ quantity: newQuantity })
    .where(eq(stockLevel.id, existing.id))
    .returning()

  // Record transaction
  await db.insert(inventoryTransaction).values({
    companyId,
    itemId,
    locationId,
    type: quantity > 0 ? 'add' : 'remove',
    quantity: Math.abs(quantity),
    previousQuantity: existing.quantity,
    newQuantity,
    reason,
    cost: cost ? String(cost) : undefined,
    userId,
    jobId,
  })

  // Check for low stock alert
  const [item] = await db.select()
    .from(inventoryItem)
    .where(eq(inventoryItem.id, itemId))

  if (item && newQuantity <= item.reorderPoint && newQuantity > 0) {
    // Send low stock notification to company admins
    try {
      const emailService = (await import('./email.ts')).default
      const { user: userTable, company: companyTable } = await import('../../db/schema.ts')
      const { inArray } = await import('drizzle-orm')
      const admins = await db.select({ email: userTable.email, firstName: userTable.firstName })
        .from(userTable)
        .where(and(
          eq(userTable.companyId, companyId),
          eq(userTable.isActive, true),
          inArray(userTable.role, ['owner', 'admin', 'manager']),
        ))

      const [comp] = await db.select({ name: companyTable.name })
        .from(companyTable)
        .where(eq(companyTable.id, companyId))
        .limit(1)

      for (const admin of admins) {
        await emailService.send(admin.email, 'lowStockAlert', {
          itemName: item.name,
          currentStock: newQuantity,
          reorderPoint: item.reorderPoint,
          companyName: comp?.name || 'Your Company',
        }).catch(() => {}) // Don't fail the stock update if email fails
      }
    } catch {
      // Email service may not be configured — don't block stock updates
    }
  }

  return updated
}

/**
 * Transfer stock between locations
 */
export async function transferStock(companyId: string, {
  itemId,
  fromLocationId,
  toLocationId,
  quantity,
  userId,
  notes,
}: {
  itemId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  userId?: string
  notes?: string
}) {
  // Check source has enough
  const sourceStock = await getStockLevel(itemId, fromLocationId)
  if (!sourceStock || sourceStock.quantity < quantity) {
    throw new Error('Insufficient stock at source location')
  }

  // Remove from source
  await adjustStock(companyId, {
    itemId,
    locationId: fromLocationId,
    quantity: -quantity,
    reason: `Transfer to ${toLocationId}`,
    userId,
  })

  // Add to destination
  await adjustStock(companyId, {
    itemId,
    locationId: toLocationId,
    quantity,
    reason: `Transfer from ${fromLocationId}`,
    userId,
  })

  // Record transfer
  const [transfer] = await db.insert(inventoryTransfer).values({
    companyId,
    itemId,
    fromLocationId,
    toLocationId,
    quantity,
    status: 'completed',
    notes,
    userId,
    completedAt: new Date(),
  }).returning()

  return transfer
}

// ============================================
// JOB USAGE
// ============================================

/**
 * Use inventory on a job
 */
export async function useOnJob(companyId: string, {
  jobId: jobIdParam,
  itemId,
  locationId,
  quantity,
  userId,
  unitPrice,
}: {
  jobId: string
  itemId: string
  locationId: string
  quantity: number
  userId?: string
  unitPrice?: number
}) {
  const [item] = await db.select()
    .from(inventoryItem)
    .where(eq(inventoryItem.id, itemId))

  if (!item) throw new Error('Item not found')

  const itemUnitCost = Number(item.unitCost)
  const itemUnitPrice = Number(item.unitPrice)

  // Remove from inventory
  await adjustStock(companyId, {
    itemId,
    locationId,
    quantity: -quantity,
    reason: 'Used on job',
    userId,
    jobId: jobIdParam,
    cost: itemUnitCost * quantity,
  })

  // Record usage
  const [usage] = await db.insert(inventoryUsage).values({
    companyId,
    jobId: jobIdParam,
    itemId,
    locationId,
    quantity,
    unitCost: String(itemUnitCost),
    unitPrice: String(unitPrice || itemUnitPrice),
    totalCost: String(itemUnitCost * quantity),
    totalPrice: String((unitPrice || itemUnitPrice) * quantity),
    userId,
  }).returning()

  return usage
}

/**
 * Get job materials/parts used
 */
export async function getJobUsage(jobId: string, companyId: string) {
  const results = await db.select()
    .from(inventoryUsage)
    .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
    .leftJoin(user, eq(inventoryUsage.userId, user.id))
    .where(and(eq(inventoryUsage.jobId, jobId), eq(inventoryUsage.companyId, companyId)))

  return results.map(r => ({
    ...r.inventory_usage,
    item: r.inventory_item ? {
      id: r.inventory_item.id,
      name: r.inventory_item.name,
      sku: r.inventory_item.sku,
      unit: r.inventory_item.unit,
    } : null,
    user: r.user ? {
      id: r.user.id,
      firstName: r.user.firstName,
      lastName: r.user.lastName,
    } : null,
  }))
}

/**
 * Return unused materials from job
 */
export async function returnFromJob(companyId: string, {
  usageId,
  returnQuantity,
  locationId,
  userId,
}: {
  usageId: string
  returnQuantity: number
  locationId: string
  userId?: string
}) {
  const [usage] = await db.select()
    .from(inventoryUsage)
    .where(and(eq(inventoryUsage.id, usageId), eq(inventoryUsage.companyId, companyId)))

  if (!usage) throw new Error('Usage record not found')
  if (returnQuantity > usage.quantity - (usage.returnedQuantity || 0)) {
    throw new Error('Return quantity exceeds used quantity')
  }

  // Add back to inventory
  await adjustStock(companyId, {
    itemId: usage.itemId,
    locationId,
    quantity: returnQuantity,
    reason: 'Returned from job',
    userId,
    jobId: usage.jobId,
  })

  // Update usage record
  const [updated] = await db.update(inventoryUsage)
    .set({ returnedQuantity: (usage.returnedQuantity || 0) + returnQuantity })
    .where(eq(inventoryUsage.id, usageId))
    .returning()

  return updated
}

// ============================================
// PURCHASE ORDERS
// ============================================

/**
 * Create purchase order
 */
export async function createPurchaseOrder(companyId: string, data: any) {
  const poNumber = await generatePoNumber(companyId)

  const [po] = await db.insert(purchaseOrder).values({
    companyId,
    number: poNumber,
    vendor: data.vendor,
    vendorEmail: data.vendorEmail,
    locationId: data.locationId,
    status: 'draft',
    notes: data.notes,
    expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
    createdById: data.userId,
  }).returning()

  // Create line items
  const items = await Promise.all(
    data.items.map((item: any) =>
      db.insert(purchaseOrderItem).values({
        purchaseOrderId: po.id,
        itemId: item.itemId,
        quantity: item.quantity,
        unitCost: String(item.unitCost),
        totalCost: String(item.quantity * item.unitCost),
      }).returning().then(r => r[0])
    )
  )

  // Calculate total
  const total = items.reduce((sum: number, i: any) => sum + Number(i.totalCost), 0)
  await db.update(purchaseOrder)
    .set({ total: String(total) })
    .where(eq(purchaseOrder.id, po.id))

  return { ...po, items, total }
}

async function generatePoNumber(companyId: string): Promise<string> {
  const [result] = await db.select({ value: count() })
    .from(purchaseOrder)
    .where(eq(purchaseOrder.companyId, companyId))

  return `PO-${String((result?.value ?? 0) + 1).padStart(5, '0')}`
}

/**
 * Get purchase orders
 */
export async function getPurchaseOrders(companyId: string, { status, page = 1, limit = 20 }: { status?: string; page?: number; limit?: number } = {}) {
  const conditions = [eq(purchaseOrder.companyId, companyId)]
  if (status) conditions.push(eq(purchaseOrder.status, status))

  const whereClause = and(...conditions)

  const [data, [totalResult]] = await Promise.all([
    db.select()
      .from(purchaseOrder)
      .leftJoin(inventoryLocation, eq(purchaseOrder.locationId, inventoryLocation.id))
      .where(whereClause)
      .orderBy(desc(purchaseOrder.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(purchaseOrder)
      .where(whereClause),
  ])

  const total = totalResult?.value ?? 0

  return {
    data: data.map(d => ({
      ...d.purchase_order,
      location: d.inventory_location ? { id: d.inventory_location.id, name: d.inventory_location.name } : null,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Receive purchase order (full or partial)
 */
export async function receivePurchaseOrder(companyId: string, poId: string, {
  items: receivedItems,
  userId,
}: {
  items: Array<{ poItemId: string; receivedQuantity: number }>
  userId?: string
}) {
  const [po] = await db.select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.companyId, companyId)))

  if (!po) throw new Error('Purchase order not found')

  const poItems = await db.select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, poId))

  for (const received of receivedItems) {
    const poItem = poItems.find(i => i.id === received.poItemId)
    if (!poItem) continue

    // Add to inventory
    await adjustStock(companyId, {
      itemId: poItem.itemId,
      locationId: po.locationId,
      quantity: received.receivedQuantity,
      reason: `Received from PO ${po.number}`,
      userId,
      cost: Number(poItem.unitCost) * received.receivedQuantity,
    })

    // Update PO item
    await db.update(purchaseOrderItem)
      .set({ receivedQuantity: (poItem.receivedQuantity || 0) + received.receivedQuantity })
      .where(eq(purchaseOrderItem.id, poItem.id))
  }

  // Check if fully received
  const updatedPoItems = await db.select()
    .from(purchaseOrderItem)
    .where(eq(purchaseOrderItem.purchaseOrderId, poId))

  const allReceived = updatedPoItems.every(i => i.receivedQuantity >= i.quantity)

  const [updated] = await db.update(purchaseOrder)
    .set({
      status: allReceived ? 'received' : 'partial',
      receivedAt: allReceived ? new Date() : undefined,
    })
    .where(eq(purchaseOrder.id, poId))
    .returning()

  return updated
}

// ============================================
// REPORTS
// ============================================

/**
 * Get inventory value report
 */
export async function getInventoryValue(companyId: string) {
  const results = await db.select()
    .from(stockLevel)
    .innerJoin(inventoryItem, eq(stockLevel.itemId, inventoryItem.id))
    .innerJoin(inventoryLocation, eq(stockLevel.locationId, inventoryLocation.id))
    .where(and(
      eq(inventoryLocation.companyId, companyId),
      gt(stockLevel.quantity, 0),
    ))

  let totalCost = 0
  let totalRetail = 0
  const byLocation: Record<string, { cost: number; retail: number; items: number }> = {}

  for (const r of results) {
    const sl = r.stock_level
    const item = r.inventory_item
    const location = r.inventory_location

    const cost = sl.quantity * Number(item.unitCost)
    const retail = sl.quantity * Number(item.unitPrice)

    totalCost += cost
    totalRetail += retail

    if (!byLocation[location.name]) {
      byLocation[location.name] = { cost: 0, retail: 0, items: 0 }
    }
    byLocation[location.name].cost += cost
    byLocation[location.name].retail += retail
    byLocation[location.name].items += 1
  }

  return {
    totalCost,
    totalRetail,
    potentialProfit: totalRetail - totalCost,
    byLocation,
  }
}

/**
 * Get low stock items
 */
export async function getLowStockItems(companyId: string) {
  const items = await db.select()
    .from(inventoryItem)
    .where(and(eq(inventoryItem.companyId, companyId), eq(inventoryItem.active, true)))

  const itemIds = items.map(i => i.id)
  const allStockLevels = itemIds.length > 0
    ? await db.select()
        .from(stockLevel)
        .where(inArray(stockLevel.itemId, itemIds))
    : []

  return items
    .map(item => {
      const itemStocks = allStockLevels.filter(sl => sl.itemId === item.id)
      const totalStock = itemStocks.reduce((sum, sl) => sum + sl.quantity, 0)
      return { ...item, totalStock, stockLevels: itemStocks }
    })
    .filter(item => item.totalStock <= item.reorderPoint)
    .sort((a, b) => a.totalStock - b.totalStock)
}

export default {
  createItem,
  getItems,
  getItem,
  updateItem,
  getCategories,
  createLocation,
  getLocations,
  getLocationInventory,
  getStockLevel,
  adjustStock,
  transferStock,
  useOnJob,
  getJobUsage,
  returnFromJob,
  createPurchaseOrder,
  getPurchaseOrders,
  receivePurchaseOrder,
  getInventoryValue,
  getLowStockItems,
}
