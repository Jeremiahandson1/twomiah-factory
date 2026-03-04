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

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// INVENTORY ITEMS (Parts/Materials)
// ============================================

/**
 * Create inventory item
 */
export async function createItem(companyId, data) {
  const item = await prisma.inventoryItem.create({
    data: {
      companyId,
      sku: data.sku || generateSku(companyId),
      name: data.name,
      description: data.description,
      category: data.category,
      unitCost: data.unitCost || 0,
      unitPrice: data.unitPrice || 0,
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
    },
  });

  return item;
}

/**
 * Generate SKU
 */
async function generateSku(companyId) {
  const count = await prisma.inventoryItem.count({ where: { companyId } });
  return `PART-${String(count + 1).padStart(5, '0')}`;
}

/**
 * Get inventory items with filters
 */
export async function getItems(companyId, {
  search,
  category,
  lowStock,
  active = true,
  page = 1,
  limit = 50,
} = {}) {
  const where = { companyId };

  if (active !== null) where.active = active;
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        stockLevels: {
          include: {
            location: { select: { id: true, name: true, type: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryItem.count({ where }),
  ]);

  // Calculate total stock and check low stock
  const itemsWithStock = items.map(item => {
    const totalStock = item.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
    return {
      ...item,
      totalStock,
      isLowStock: totalStock <= item.reorderPoint,
    };
  });

  // Filter low stock if requested
  const filtered = lowStock 
    ? itemsWithStock.filter(i => i.isLowStock)
    : itemsWithStock;

  return {
    data: filtered,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single item with full details
 */
export async function getItem(itemId, companyId) {
  return prisma.inventoryItem.findFirst({
    where: { id: itemId, companyId },
    include: {
      stockLevels: {
        include: {
          location: true,
        },
      },
      usageHistory: {
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          job: { select: { id: true, title: true, number: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
}

/**
 * Update inventory item
 */
export async function updateItem(itemId, companyId, data) {
  return prisma.inventoryItem.updateMany({
    where: { id: itemId, companyId },
    data,
  });
}

/**
 * Get categories
 */
export async function getCategories(companyId) {
  const categories = await prisma.inventoryItem.findMany({
    where: { companyId, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
  });
  return categories.map(c => c.category).filter(Boolean);
}

// ============================================
// LOCATIONS (Warehouses, Trucks)
// ============================================

/**
 * Create inventory location
 */
export async function createLocation(companyId, data) {
  return prisma.inventoryLocation.create({
    data: {
      companyId,
      name: data.name,
      type: data.type || 'warehouse', // warehouse, truck, other
      address: data.address,
      assignedUserId: data.assignedUserId, // For trucks
      active: true,
    },
  });
}

/**
 * Get locations
 */
export async function getLocations(companyId, { type, active = true } = {}) {
  return prisma.inventoryLocation.findMany({
    where: {
      companyId,
      ...(type ? { type } : {}),
      ...(active !== null ? { active } : {}),
    },
    include: {
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { stockLevels: true } },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Get location inventory
 */
export async function getLocationInventory(locationId, companyId) {
  const location = await prisma.inventoryLocation.findFirst({
    where: { id: locationId, companyId },
    include: {
      stockLevels: {
        where: { quantity: { gt: 0 } },
        include: {
          item: true,
        },
        orderBy: { item: { name: 'asc' } },
      },
    },
  });

  return location;
}

// ============================================
// STOCK LEVELS
// ============================================

/**
 * Get stock level for item at location
 */
export async function getStockLevel(itemId, locationId) {
  return prisma.stockLevel.findUnique({
    where: {
      itemId_locationId: { itemId, locationId },
    },
  });
}

/**
 * Adjust stock level (add or remove)
 */
export async function adjustStock(companyId, {
  itemId,
  locationId,
  quantity,
  reason,
  userId,
  jobId,
  cost,
}) {
  // Get or create stock level
  const stockLevel = await prisma.stockLevel.upsert({
    where: {
      itemId_locationId: { itemId, locationId },
    },
    create: {
      itemId,
      locationId,
      quantity: 0,
    },
    update: {},
  });

  const newQuantity = stockLevel.quantity + quantity;

  if (newQuantity < 0) {
    throw new Error('Insufficient stock');
  }

  // Update stock level
  const updated = await prisma.stockLevel.update({
    where: { id: stockLevel.id },
    data: { quantity: newQuantity },
  });

  // Record transaction
  await prisma.inventoryTransaction.create({
    data: {
      companyId,
      itemId,
      locationId,
      type: quantity > 0 ? 'add' : 'remove',
      quantity: Math.abs(quantity),
      previousQuantity: stockLevel.quantity,
      newQuantity,
      reason,
      cost,
      userId,
      jobId,
    },
  });

  // Check for low stock alert
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (item && newQuantity <= item.reorderPoint && newQuantity > 0) {
    // TODO: Send low stock notification
  }

  return updated;
}

/**
 * Transfer stock between locations
 */
export async function transferStock(companyId, {
  itemId,
  fromLocationId,
  toLocationId,
  quantity,
  userId,
  notes,
}) {
  // Check source has enough
  const sourceStock = await getStockLevel(itemId, fromLocationId);
  if (!sourceStock || sourceStock.quantity < quantity) {
    throw new Error('Insufficient stock at source location');
  }

  // Remove from source
  await adjustStock(companyId, {
    itemId,
    locationId: fromLocationId,
    quantity: -quantity,
    reason: `Transfer to ${toLocationId}`,
    userId,
  });

  // Add to destination
  await adjustStock(companyId, {
    itemId,
    locationId: toLocationId,
    quantity,
    reason: `Transfer from ${fromLocationId}`,
    userId,
  });

  // Record transfer
  const transfer = await prisma.inventoryTransfer.create({
    data: {
      companyId,
      itemId,
      fromLocationId,
      toLocationId,
      quantity,
      status: 'completed',
      notes,
      userId,
      completedAt: new Date(),
    },
  });

  return transfer;
}

// ============================================
// JOB USAGE
// ============================================

/**
 * Use inventory on a job
 */
export async function useOnJob(companyId, {
  jobId,
  itemId,
  locationId,
  quantity,
  userId,
  unitPrice,
}) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new Error('Item not found');

  // Remove from inventory
  await adjustStock(companyId, {
    itemId,
    locationId,
    quantity: -quantity,
    reason: `Used on job`,
    userId,
    jobId,
    cost: item.unitCost * quantity,
  });

  // Record usage
  const usage = await prisma.inventoryUsage.create({
    data: {
      companyId,
      jobId,
      itemId,
      locationId,
      quantity,
      unitCost: item.unitCost,
      unitPrice: unitPrice || item.unitPrice,
      totalCost: item.unitCost * quantity,
      totalPrice: (unitPrice || item.unitPrice) * quantity,
      userId,
    },
  });

  return usage;
}

/**
 * Get job materials/parts used
 */
export async function getJobUsage(jobId, companyId) {
  return prisma.inventoryUsage.findMany({
    where: { jobId, companyId },
    include: {
      item: { select: { id: true, name: true, sku: true, unit: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

/**
 * Return unused materials from job
 */
export async function returnFromJob(companyId, {
  usageId,
  returnQuantity,
  locationId,
  userId,
}) {
  const usage = await prisma.inventoryUsage.findFirst({
    where: { id: usageId, companyId },
  });

  if (!usage) throw new Error('Usage record not found');
  if (returnQuantity > usage.quantity - (usage.returnedQuantity || 0)) {
    throw new Error('Return quantity exceeds used quantity');
  }

  // Add back to inventory
  await adjustStock(companyId, {
    itemId: usage.itemId,
    locationId,
    quantity: returnQuantity,
    reason: 'Returned from job',
    userId,
    jobId: usage.jobId,
  });

  // Update usage record
  return prisma.inventoryUsage.update({
    where: { id: usageId },
    data: {
      returnedQuantity: { increment: returnQuantity },
    },
  });
}

// ============================================
// PURCHASE ORDERS
// ============================================

/**
 * Create purchase order
 */
export async function createPurchaseOrder(companyId, data) {
  const poNumber = await generatePoNumber(companyId);

  const po = await prisma.purchaseOrder.create({
    data: {
      companyId,
      number: poNumber,
      vendor: data.vendor,
      vendorEmail: data.vendorEmail,
      locationId: data.locationId,
      status: 'draft',
      notes: data.notes,
      expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
      createdById: data.userId,
      items: {
        create: data.items.map(item => ({
          itemId: item.itemId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: item.quantity * item.unitCost,
        })),
      },
    },
    include: {
      items: { include: { item: true } },
      location: true,
    },
  });

  // Calculate total
  const total = po.items.reduce((sum, i) => sum + Number(i.totalCost), 0);
  await prisma.purchaseOrder.update({
    where: { id: po.id },
    data: { total },
  });

  return { ...po, total };
}

async function generatePoNumber(companyId) {
  const count = await prisma.purchaseOrder.count({ where: { companyId } });
  return `PO-${String(count + 1).padStart(5, '0')}`;
}

/**
 * Get purchase orders
 */
export async function getPurchaseOrders(companyId, { status, page = 1, limit = 20 } = {}) {
  const where = { companyId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        location: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Receive purchase order (full or partial)
 */
export async function receivePurchaseOrder(companyId, poId, {
  items, // [{ poItemId, receivedQuantity }]
  userId,
}) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: poId, companyId },
    include: { items: true },
  });

  if (!po) throw new Error('Purchase order not found');

  for (const received of items) {
    const poItem = po.items.find(i => i.id === received.poItemId);
    if (!poItem) continue;

    // Add to inventory
    await adjustStock(companyId, {
      itemId: poItem.itemId,
      locationId: po.locationId,
      quantity: received.receivedQuantity,
      reason: `Received from PO ${po.number}`,
      userId,
      cost: poItem.unitCost * received.receivedQuantity,
    });

    // Update PO item
    await prisma.purchaseOrderItem.update({
      where: { id: poItem.id },
      data: {
        receivedQuantity: { increment: received.receivedQuantity },
      },
    });
  }

  // Check if fully received
  const updatedPo = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: true },
  });

  const allReceived = updatedPo.items.every(i => i.receivedQuantity >= i.quantity);

  return prisma.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: allReceived ? 'received' : 'partial',
      receivedAt: allReceived ? new Date() : undefined,
    },
  });
}

// ============================================
// REPORTS
// ============================================

/**
 * Get inventory value report
 */
export async function getInventoryValue(companyId) {
  const stockLevels = await prisma.stockLevel.findMany({
    where: {
      location: { companyId },
      quantity: { gt: 0 },
    },
    include: {
      item: { select: { unitCost: true, unitPrice: true, name: true } },
      location: { select: { name: true, type: true } },
    },
  });

  let totalCost = 0;
  let totalRetail = 0;

  const byLocation = {};

  for (const sl of stockLevels) {
    const cost = sl.quantity * Number(sl.item.unitCost);
    const retail = sl.quantity * Number(sl.item.unitPrice);
    
    totalCost += cost;
    totalRetail += retail;

    if (!byLocation[sl.location.name]) {
      byLocation[sl.location.name] = { cost: 0, retail: 0, items: 0 };
    }
    byLocation[sl.location.name].cost += cost;
    byLocation[sl.location.name].retail += retail;
    byLocation[sl.location.name].items += 1;
  }

  return {
    totalCost,
    totalRetail,
    potentialProfit: totalRetail - totalCost,
    byLocation,
  };
}

/**
 * Get low stock items
 */
export async function getLowStockItems(companyId) {
  const items = await prisma.inventoryItem.findMany({
    where: { companyId, active: true },
    include: {
      stockLevels: true,
    },
  });

  return items
    .map(item => {
      const totalStock = item.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
      return { ...item, totalStock };
    })
    .filter(item => item.totalStock <= item.reorderPoint)
    .sort((a, b) => a.totalStock - b.totalStock);
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
};
