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

import { Hono } from 'hono'
import { eq, and, or, ilike, count, desc, asc, gte, gt, sql, inArray } from 'drizzle-orm'

export interface InventoryTables {
  inventoryItem: any; inventoryLocation: any; stockLevel: any;
  inventoryTransaction: any; inventoryUsage: any; inventoryTransfer: any;
  purchaseOrder: any; purchaseOrderItem: any; user: any; job: any; company: any;
}
// Optional: low-stock email alerts to company admins. Templates that wire an
// emailService get the alert (crm/rv shipped it); others silently skip it.
export interface InventoryEmail { send: (to: string, template: string, data: any) => Promise<any> }
export interface InventoryServiceDeps { db: any; tables: InventoryTables; emailService?: InventoryEmail }
// Optional: write an audit-log entry on inventory mutations (templates inject their own audit service).
export interface InventoryAudit { log: (entry: any) => any }
export interface InventoryRoutesDeps {
  service: InventoryService
  authenticate: any
  requirePermission: (permission: string) => any
  audit: InventoryAudit
}

// A refused stock movement: bad input (400), an item/location/record not in this company (404), or not enough on
// hand (409). Routes answer with the message and status instead of a 500.
export class InventoryError extends Error {
  constructor(message: string, public status: 400 | 404 | 409) { super(message) }
}

const MAX_MOVE = 1_000_000

/** A whole number (a number or integer text such as "4"), else null. */
function wholeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) ? n : null
}
function positiveQuantity(v: unknown, label = 'Quantity'): number {
  const n = wholeNumber(v)
  if (n === null || n <= 0) throw new InventoryError(`${label} must be a whole number greater than zero`, 400)
  if (n > MAX_MOVE) throw new InventoryError(`${label} is too large`, 400)
  return n
}

/**
 * Validated item fields. On create every field gets a value (blank money/levels → 0); on update only the fields sent
 * are returned, from an allow-list — the company and id can never be set from the request.
 * (RV T19 M4: cost -$5, price -$10, reorder point -3 and a blank name were accepted; updateItem wrote the raw body)
 */
const ITEM_TEXT = ['description', 'category', 'unit', 'vendor', 'vendorPartNumber', 'barcode', 'imageUrl'] as const
const ITEM_MONEY = [['unitCost', 'Unit cost'], ['unitPrice', 'Unit price']] as const
const ITEM_LEVELS = [['minStockLevel', 'Minimum stock level'], ['reorderPoint', 'Reorder point'], ['reorderQuantity', 'Reorder quantity']] as const
function itemFields(data: any, isCreate: boolean): Record<string, any> {
  const d = data && typeof data === 'object' ? data : {}
  const out: Record<string, any> = {}
  if (isCreate || 'name' in d) {
    const name = typeof d.name === 'string' ? d.name.trim() : ''
    if (!name) throw new InventoryError('Item name is required', 400)
    out.name = name
  }
  if ('sku' in d && typeof d.sku === 'string' && d.sku.trim()) out.sku = d.sku.trim()
  for (const k of ITEM_TEXT) if (k in d) out[k] = d[k] == null ? null : String(d[k])
  for (const [k, label] of ITEM_MONEY) {
    if (!isCreate && !(k in d)) continue
    const v = d[k]
    const n = v === undefined || v === null || v === '' ? 0 : typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new InventoryError(`${label} must be an amount of 0 or more`, 400)
    out[k] = String(Math.round(n * 100) / 100)
  }
  for (const [k, label] of ITEM_LEVELS) {
    if (!isCreate && !(k in d)) continue
    const v = d[k]
    const n = v === undefined || v === null || v === '' ? 0 : wholeNumber(v)
    if (n === null || n < 0 || n > MAX_MOVE) throw new InventoryError(`${label} must be a whole number of 0 or more`, 400)
    out[k] = n
  }
  if (isCreate) { out.unit = out.unit || 'each'; out.taxable = typeof d.taxable === 'boolean' ? d.taxable : true }
  else {
    if (typeof d.taxable === 'boolean') out.taxable = d.taxable
    if (typeof d.active === 'boolean') out.active = d.active
    if ('unit' in d && !out.unit) delete out.unit // unit is required in the table: an empty value keeps the current one
  }
  return out
}

export function createInventoryService(deps: InventoryServiceDeps) {
  const { db, tables, emailService } = deps
  const {
    inventoryItem, inventoryLocation, stockLevel, inventoryTransaction,
    inventoryUsage, inventoryTransfer, purchaseOrder, purchaseOrderItem, user, job, company,
  } = tables

// ============================================
// INVENTORY ITEMS (Parts/Materials)
// ============================================

/**
 * Create inventory item
 */
async function createItem(companyId: string, data: any) {
  const fields = itemFields(data, true)
  const sku = fields.sku || await generateSku(companyId)

  const [item] = await db.insert(inventoryItem).values({
    companyId,
    ...fields,
    sku,
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
async function getItems(companyId: string, {
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
async function getItem(itemId: string, companyId: string) {
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
async function updateItem(itemId: string, companyId: string, data: any) {
  const fields = itemFields(data, false)
  if (!Object.keys(fields).length) return []
  return db.update(inventoryItem)
    .set(fields)
    .where(and(eq(inventoryItem.id, itemId), eq(inventoryItem.companyId, companyId)))
    .returning()
}

/**
 * Get categories
 */
async function getCategories(companyId: string): Promise<string[]> {
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
async function createLocation(companyId: string, data: any) {
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
async function getLocations(companyId: string, { type, active = true }: { type?: string; active?: boolean | null } = {}) {
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
async function getLocationInventory(locationId: string, companyId: string) {
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
async function getStockLevel(itemId: string, locationId: string) {
  const [result] = await db.select()
    .from(stockLevel)
    .where(and(eq(stockLevel.itemId, itemId), eq(stockLevel.locationId, locationId)))

  return result || null
}

// Every stock movement runs in one transaction on locked stock rows, after checking the item and locations belong to
// the company: a movement that is refused part-way changes nothing, and two movements at once can't overwrite each
// other. (RV T19 H2: a -2 transfer added 2 at the source, then failed at the destination and left the +2 behind)

async function ownItem(exec: any, companyId: string, itemId: unknown) {
  if (typeof itemId !== 'string' || !itemId) throw new InventoryError('Item is required', 400)
  const [item] = await exec.select().from(inventoryItem)
    .where(and(eq(inventoryItem.id, itemId), eq(inventoryItem.companyId, companyId))).limit(1)
  if (!item) throw new InventoryError('Item not found', 404)
  return item
}

async function ownLocation(exec: any, companyId: string, locationId: unknown, label = 'Location') {
  if (typeof locationId !== 'string' || !locationId) throw new InventoryError(`${label} is required`, 400)
  const [location] = await exec.select().from(inventoryLocation)
    .where(and(eq(inventoryLocation.id, locationId), eq(inventoryLocation.companyId, companyId))).limit(1)
  if (!location) throw new InventoryError(`${label} not found`, 404)
  return location
}

/** The item's stock row at a location, created at 0 if missing, locked for this transaction. */
async function lockStock(tx: any, itemId: string, locationId: string) {
  await tx.insert(stockLevel).values({ itemId, locationId, quantity: 0 })
    .onConflictDoNothing({ target: [stockLevel.itemId, stockLevel.locationId] })
  const [row] = await tx.select().from(stockLevel)
    .where(and(eq(stockLevel.itemId, itemId), eq(stockLevel.locationId, locationId))).limit(1).for('update')
  return row
}

/** Move stock at one location inside a transaction: refuse going below zero, update, record the transaction. */
async function moveStock(tx: any, companyId: string, {
  itemId, location, quantity, reason, userId, jobId, cost, verb = 'remove',
}: {
  itemId: string; location: { id: string; name: string }; quantity: number
  reason?: string; userId?: string; jobId?: string; cost?: number; verb?: string
}) {
  const existing = await lockStock(tx, itemId, location.id)
  const newQuantity = existing.quantity + quantity
  if (newQuantity < 0) {
    throw new InventoryError(`Only ${existing.quantity} on hand at ${location.name} — can't ${verb} ${Math.abs(quantity)}.`, 409)
  }
  const [updated] = await tx.update(stockLevel)
    .set({ quantity: newQuantity })
    .where(eq(stockLevel.id, existing.id))
    .returning()
  await tx.insert(inventoryTransaction).values({
    companyId,
    itemId,
    locationId: location.id,
    type: quantity > 0 ? 'add' : 'remove',
    quantity: Math.abs(quantity),
    previousQuantity: existing.quantity,
    newQuantity,
    reason,
    cost: cost ? String(cost) : undefined,
    userId,
    jobId,
  })
  return { updated, newQuantity }
}

/**
 * Adjust stock level (add or remove)
 */
async function adjustStock(companyId: string, {
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
  const qty = wholeNumber(quantity)
  if (qty === null || qty === 0) throw new InventoryError('Quantity must be a whole number other than zero', 400)
  if (Math.abs(qty) > MAX_MOVE) throw new InventoryError('Quantity is too large', 400)

  const { updated, newQuantity } = await db.transaction(async (tx: any) => {
    await ownItem(tx, companyId, itemId)
    const location = await ownLocation(tx, companyId, locationId)
    return moveStock(tx, companyId, { itemId, location, quantity: qty, reason, userId, jobId, cost })
  })

  await lowStockAlert(companyId, itemId, newQuantity)
  return updated
}

/** Email company admins when a movement leaves an item at or below its reorder point (never blocks the movement). */
async function lowStockAlert(companyId: string, itemId: string, newQuantity: number) {
  const [item] = await db.select()
    .from(inventoryItem)
    .where(eq(inventoryItem.id, itemId))

  if (emailService && item && newQuantity <= item.reorderPoint && newQuantity > 0) {
    // Send low stock notification to company admins
    try {
      const admins = await db.select({ email: user.email, firstName: user.firstName })
        .from(user)
        .where(and(
          eq(user.companyId, companyId),
          eq(user.isActive, true),
          inArray(user.role, ['owner', 'admin', 'manager']),
        ))

      const [comp] = await db.select({ name: company.name })
        .from(company)
        .where(eq(company.id, companyId))
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
}

/**
 * Transfer stock between locations
 */
async function transferStock(companyId: string, {
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
  const qty = positiveQuantity(quantity)
  if (fromLocationId === toLocationId) throw new InventoryError('Pick two different locations to transfer between', 400)

  const result = await db.transaction(async (tx: any) => {
    await ownItem(tx, companyId, itemId)
    const from = await ownLocation(tx, companyId, fromLocationId, 'From location')
    const to = await ownLocation(tx, companyId, toLocationId, 'To location')
    // lock both rows in a fixed order so two opposite transfers can't deadlock
    for (const id of [from.id, to.id].sort()) await lockStock(tx, itemId, id)

    // Remove from source
    const out = await moveStock(tx, companyId, {
      itemId, location: from, quantity: -qty, reason: `Transfer to ${toLocationId}`, userId, verb: 'move',
    })

    // Add to destination
    const into = await moveStock(tx, companyId, {
      itemId, location: to, quantity: qty, reason: `Transfer from ${fromLocationId}`, userId,
    })

    // Record transfer
    const [transfer] = await tx.insert(inventoryTransfer).values({
      companyId,
      itemId,
      fromLocationId,
      toLocationId,
      quantity: qty,
      status: 'completed',
      notes,
      userId,
      completedAt: new Date(),
    }).returning()

    return { transfer, fromQuantity: out.newQuantity, toQuantity: into.newQuantity }
  })

  await lowStockAlert(companyId, itemId, result.fromQuantity)
  await lowStockAlert(companyId, itemId, result.toQuantity)
  return result.transfer
}

// ============================================
// JOB USAGE
// ============================================

/**
 * Use inventory on a job
 */
async function useOnJob(companyId: string, {
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
  const qty = positiveQuantity(quantity)

  const { usage, newQuantity } = await db.transaction(async (tx: any) => {
    const item = await ownItem(tx, companyId, itemId)
    const location = await ownLocation(tx, companyId, locationId)

    const itemUnitCost = Number(item.unitCost)
    const itemUnitPrice = Number(item.unitPrice)

    // Remove from inventory
    const moved = await moveStock(tx, companyId, {
      itemId,
      location,
      quantity: -qty,
      reason: 'Used on job',
      userId,
      jobId: jobIdParam,
      cost: itemUnitCost * qty,
      verb: 'use',
    })

    // Record usage
    const [usage] = await tx.insert(inventoryUsage).values({
      companyId,
      jobId: jobIdParam,
      itemId,
      locationId,
      quantity: qty,
      unitCost: String(itemUnitCost),
      unitPrice: String(unitPrice || itemUnitPrice),
      totalCost: String(itemUnitCost * qty),
      totalPrice: String((unitPrice || itemUnitPrice) * qty),
      userId,
    }).returning()

    return { usage, newQuantity: moved.newQuantity }
  })

  await lowStockAlert(companyId, itemId, newQuantity)
  return usage
}

/**
 * Get job materials/parts used
 */
async function getJobUsage(jobId: string, companyId: string) {
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
async function returnFromJob(companyId: string, {
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
  const qty = positiveQuantity(returnQuantity, 'Return quantity')
  if (typeof usageId !== 'string' || !usageId) throw new InventoryError('Usage record is required', 400)

  const { updated, newQuantity, itemId } = await db.transaction(async (tx: any) => {
    const [usage] = await tx.select()
      .from(inventoryUsage)
      .where(and(eq(inventoryUsage.id, usageId), eq(inventoryUsage.companyId, companyId)))
      .limit(1)
      .for('update')

    if (!usage) throw new InventoryError('Usage record not found', 404)
    if (qty > usage.quantity - (usage.returnedQuantity || 0)) {
      throw new InventoryError('Return quantity exceeds used quantity', 400)
    }
    const location = await ownLocation(tx, companyId, locationId)

    // Add back to inventory
    const moved = await moveStock(tx, companyId, {
      itemId: usage.itemId,
      location,
      quantity: qty,
      reason: 'Returned from job',
      userId,
      jobId: usage.jobId,
    })

    // Update usage record
    const [updated] = await tx.update(inventoryUsage)
      .set({ returnedQuantity: (usage.returnedQuantity || 0) + qty })
      .where(eq(inventoryUsage.id, usageId))
      .returning()

    return { updated, newQuantity: moved.newQuantity, itemId: usage.itemId }
  })

  await lowStockAlert(companyId, itemId, newQuantity)
  return updated
}

// ============================================
// PURCHASE ORDERS
// ============================================

/**
 * Create purchase order
 */
async function createPurchaseOrder(companyId: string, data: any) {
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
async function getPurchaseOrders(companyId: string, { status, page = 1, limit = 20 }: { status?: string; page?: number; limit?: number } = {}) {
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
async function receivePurchaseOrder(companyId: string, poId: string, {
  items: receivedItems,
  userId,
}: {
  items: Array<{ poItemId: string; receivedQuantity: number }>
  userId?: string
}) {
  if (!Array.isArray(receivedItems)) throw new InventoryError('items must be a list of { poItemId, receivedQuantity }', 400)
  // a line received as 0 is simply not received this time; anything else must be a whole number above zero
  const lines = receivedItems
    .filter((r: any) => wholeNumber(r?.receivedQuantity) !== 0)
    .map((r: any) => ({ poItemId: r?.poItemId, receivedQuantity: positiveQuantity(r?.receivedQuantity, 'Received quantity') }))

  const { updated, moves } = await db.transaction(async (tx: any) => {
    const [po] = await tx.select()
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, poId), eq(purchaseOrder.companyId, companyId)))
      .limit(1)
      .for('update')

    if (!po) throw new InventoryError('Purchase order not found', 404)

    const poItems = await tx.select()
      .from(purchaseOrderItem)
      .where(eq(purchaseOrderItem.purchaseOrderId, poId))

    const location = lines.length ? await ownLocation(tx, companyId, po.locationId) : null
    const moves: { itemId: string; newQuantity: number }[] = []

    for (const received of lines) {
      const poItem = poItems.find((i: any) => i.id === received.poItemId)
      if (!poItem) continue

      // Add to inventory
      const moved = await moveStock(tx, companyId, {
        itemId: poItem.itemId,
        location: location!,
        quantity: received.receivedQuantity,
        reason: `Received from PO ${po.number}`,
        userId,
        cost: Number(poItem.unitCost) * received.receivedQuantity,
      })
      moves.push({ itemId: poItem.itemId, newQuantity: moved.newQuantity })

      // Update PO item
      const [line] = await tx.update(purchaseOrderItem)
        .set({ receivedQuantity: (poItem.receivedQuantity || 0) + received.receivedQuantity })
        .where(eq(purchaseOrderItem.id, poItem.id))
        .returning()
      poItem.receivedQuantity = line.receivedQuantity
    }

    // Check if fully received
    const updatedPoItems = await tx.select()
      .from(purchaseOrderItem)
      .where(eq(purchaseOrderItem.purchaseOrderId, poId))

    const allReceived = updatedPoItems.every((i: any) => i.receivedQuantity >= i.quantity)

    const [updated] = await tx.update(purchaseOrder)
      .set({
        status: allReceived ? 'received' : 'partial',
        receivedAt: allReceived ? new Date() : undefined,
      })
      .where(eq(purchaseOrder.id, poId))
      .returning()

    return { updated, moves }
  })

  for (const m of moves) await lowStockAlert(companyId, m.itemId, m.newQuantity)
  return updated
}

// ============================================
// REPORTS
// ============================================

/**
 * Get inventory value report
 */
async function getInventoryValue(companyId: string) {
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
async function getLowStockItems(companyId: string) {
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

async function deleteInventoryItem(id: string, companyId: string) {
  return db.delete(inventoryItem).where(and(eq(inventoryItem.id, id), eq(inventoryItem.companyId, companyId)))
}

  return {
    deleteInventoryItem,
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
}

export type InventoryService = ReturnType<typeof createInventoryService>

export function createInventoryRoutes(deps: InventoryRoutesDeps) {
  const { service, authenticate, requirePermission, audit } = deps
  const app = new Hono()
  app.use('*', authenticate)

  // A refused stock movement answers with its message and status (400/404/409); anything else stays a 500.
  const refused = (c: any, err: unknown) => {
    if (err instanceof InventoryError) return c.json({ error: err.message }, err.status)
    throw err
  }

  // ============================================
  // ITEMS
  // ============================================

  // Get items
  app.get('/items', async (c) => {
    const user = c.get('user') as any
    const search = c.req.query('search')
    const category = c.req.query('category')
    const lowStock = c.req.query('lowStock')
    const active = c.req.query('active')
    const page = c.req.query('page')
    const limit = c.req.query('limit')
    const items = await service.getItems(user.companyId, {
      search,
      category,
      lowStock: lowStock === 'true',
      active: active === 'false' ? false : active === 'all' ? null : true,
      page: parseInt(page || '0') || 1,
      limit: parseInt(limit || '0') || 50,
    })
    return c.json(items)
  })

  // Get categories
  app.get('/categories', async (c) => {
    const user = c.get('user') as any
    const categories = await service.getCategories(user.companyId)
    return c.json(categories)
  })

  // Get single item
  app.get('/items/:id', async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const item = await service.getItem(id, user.companyId)
    if (!item) return c.json({ error: 'Item not found' }, 404)
    return c.json(item)
  })

  // Create item
  app.post('/items', requirePermission('inventory:create'), async (c) => {
    const user = c.get('user') as any
    const body = await c.req.json().catch(() => ({}))
    let item
    try { item = await service.createItem(user.companyId, body) } catch (err) { return refused(c, err) }

    audit.log({
      action: 'INVENTORY_ITEM_CREATED',
      entity: 'inventory_item',
      entityId: item.id,
      metadata: { name: item.name, sku: item.sku },
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.json(item, 201)
  })

  // Update item
  app.put('/items/:id', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    if (!(await service.getItem(id, user.companyId))) return c.json({ error: 'Item not found' }, 404)
    try { await service.updateItem(id, user.companyId, body) } catch (err) { return refused(c, err) }
    const item = await service.getItem(id, user.companyId)
    return c.json(item)
  })

  // Get low stock items
  app.get('/low-stock', async (c) => {
    const user = c.get('user') as any
    const items = await service.getLowStockItems(user.companyId)
    return c.json(items)
  })

  // ============================================
  // LOCATIONS
  // ============================================

  // Get locations
  app.get('/locations', async (c) => {
    const user = c.get('user') as any
    const type = c.req.query('type')
    const active = c.req.query('active')
    const locations = await service.getLocations(user.companyId, {
      type,
      active: active === 'false' ? false : active === 'all' ? null : true,
    })
    return c.json(locations)
  })

  // Create location
  app.post('/locations', requirePermission('inventory:create'), async (c) => {
    const user = c.get('user') as any
    const body = await c.req.json()
    const location = await service.createLocation(user.companyId, body)
    return c.json(location, 201)
  })

  // Get location inventory
  app.get('/locations/:id/inventory', async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const location = await service.getLocationInventory(id, user.companyId)
    if (!location) return c.json({ error: 'Location not found' }, 404)
    return c.json(location)
  })

  // ============================================
  // STOCK OPERATIONS
  // ============================================

  // Adjust stock
  app.post('/adjust', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const { itemId, locationId, quantity, reason } = await c.req.json()

    if (!itemId || !locationId || quantity === undefined) {
      return c.json({ error: 'itemId, locationId, and quantity are required' }, 400)
    }

    let result
    try {
      result = await service.adjustStock(user.companyId, {
        itemId,
        locationId,
        quantity,
        reason,
        userId: user.userId,
      })
    } catch (err) { return refused(c, err) }

    audit.log({
      action: quantity > 0 ? 'INVENTORY_ADDED' : 'INVENTORY_REMOVED',
      entity: 'inventory_item',
      entityId: itemId,
      metadata: { quantity, locationId, reason },
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.json(result)
  })

  // Transfer stock
  app.post('/transfer', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const { itemId, fromLocationId, toLocationId, quantity, notes } = await c.req.json()

    if (!itemId || !fromLocationId || !toLocationId || quantity === undefined || quantity === null || quantity === '') {
      return c.json({ error: 'itemId, fromLocationId, toLocationId, and quantity are required' }, 400)
    }

    let transfer
    try {
      transfer = await service.transferStock(user.companyId, {
        itemId,
        fromLocationId,
        toLocationId,
        quantity,
        userId: user.userId,
        notes,
      })
    } catch (err) { return refused(c, err) }

    audit.log({
      action: 'INVENTORY_TRANSFERRED',
      entity: 'inventory_item',
      entityId: itemId,
      metadata: { quantity, fromLocationId, toLocationId },
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.json(transfer)
  })

  // ============================================
  // JOB USAGE
  // ============================================

  // Use on job
  app.post('/use', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const { jobId, itemId, locationId, quantity, unitPrice } = await c.req.json()

    if (!jobId || !itemId || !locationId || quantity === undefined || quantity === null || quantity === '') {
      return c.json({ error: 'jobId, itemId, locationId, and quantity are required' }, 400)
    }

    try {
      const usage = await service.useOnJob(user.companyId, {
        jobId,
        itemId,
        locationId,
        quantity,
        userId: user.userId,
        unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
      })
      return c.json(usage)
    } catch (err) { return refused(c, err) }
  })

  // Get job usage
  app.get('/job/:jobId', async (c) => {
    const user = c.get('user') as any
    const jobId = c.req.param('jobId')
    const usage = await service.getJobUsage(jobId, user.companyId)
    return c.json(usage)
  })

  // Return from job
  app.post('/return', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const { usageId, returnQuantity, locationId } = await c.req.json()

    try {
      const result = await service.returnFromJob(user.companyId, {
        usageId,
        returnQuantity,
        locationId,
        userId: user.userId,
      })
      return c.json(result)
    } catch (err) { return refused(c, err) }
  })

  // ============================================
  // PURCHASE ORDERS
  // ============================================

  // Get purchase orders
  app.get('/purchase-orders', async (c) => {
    const user = c.get('user') as any
    const status = c.req.query('status')
    const page = c.req.query('page')
    const limit = c.req.query('limit')
    const orders = await service.getPurchaseOrders(user.companyId, {
      status,
      page: parseInt(page || '0') || 1,
      limit: parseInt(limit || '0') || 20,
    })
    return c.json(orders)
  })

  // Create purchase order
  app.post('/purchase-orders', requirePermission('inventory:create'), async (c) => {
    const user = c.get('user') as any
    const body = await c.req.json()
    const po = await service.createPurchaseOrder(user.companyId, {
      ...body,
      userId: user.userId,
    })

    audit.log({
      action: 'PURCHASE_ORDER_CREATED',
      entity: 'purchase_order',
      entityId: po.id,
      metadata: { number: po.number, vendor: po.vendor },
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.json(po, 201)
  })

  // Receive purchase order
  app.post('/purchase-orders/:id/receive', requirePermission('inventory:update'), async (c) => {
    const user = c.get('user') as any
    const id = c.req.param('id')
    const { items } = await c.req.json()

    let po
    try {
      po = await service.receivePurchaseOrder(user.companyId, id, {
        items,
        userId: user.userId,
      })
    } catch (err) { return refused(c, err) }

    audit.log({
      action: 'PURCHASE_ORDER_RECEIVED',
      entity: 'purchase_order',
      entityId: id,
      userId: user.userId,
      companyId: user.companyId,
    })

    return c.json(po)
  })

  // ============================================
  // REPORTS
  // ============================================

  // Inventory value
  app.get('/reports/value', async (c) => {
    const user = c.get('user') as any
    const report = await service.getInventoryValue(user.companyId)
    return c.json(report)
  })


  app.delete('/items/:id', requirePermission('inventory:delete'), async (c) => {
    const user = c.get('user') as any
    await service.deleteInventoryItem(c.req.param('id'), user.companyId)
    return c.json({ success: true })
  })

  return app
}
