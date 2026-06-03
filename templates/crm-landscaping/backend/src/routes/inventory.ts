import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import inventory from '../services/inventory.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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
  const items = await inventory.getItems(user.companyId, {
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
  const categories = await inventory.getCategories(user.companyId)
  return c.json(categories)
})

// Get single item
app.get('/items/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const item = await inventory.getItem(id, user.companyId)
  if (!item) return c.json({ error: 'Item not found' }, 404)
  return c.json(item)
})

// Create item
app.post('/items', requirePermission('inventory:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const item = await inventory.createItem(user.companyId, body)

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
  const body = await c.req.json()
  await inventory.updateItem(id, user.companyId, body)
  const item = await inventory.getItem(id, user.companyId)
  return c.json(item)
})

// Get low stock items
app.get('/low-stock', async (c) => {
  const user = c.get('user') as any
  const items = await inventory.getLowStockItems(user.companyId)
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
  const locations = await inventory.getLocations(user.companyId, {
    type,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(locations)
})

// Create location
app.post('/locations', requirePermission('inventory:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const location = await inventory.createLocation(user.companyId, body)
  return c.json(location, 201)
})

// Get location inventory
app.get('/locations/:id/inventory', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const location = await inventory.getLocationInventory(id, user.companyId)
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

  const result = await inventory.adjustStock(user.companyId, {
    itemId,
    locationId,
    quantity: parseInt(quantity),
    reason,
    userId: user.userId,
  })

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

  if (!itemId || !fromLocationId || !toLocationId || !quantity) {
    return c.json({ error: 'itemId, fromLocationId, toLocationId, and quantity are required' }, 400)
  }

  const transfer = await inventory.transferStock(user.companyId, {
    itemId,
    fromLocationId,
    toLocationId,
    quantity: parseInt(quantity),
    userId: user.userId,
    notes,
  })

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

  if (!jobId || !itemId || !locationId || !quantity) {
    return c.json({ error: 'jobId, itemId, locationId, and quantity are required' }, 400)
  }

  const usage = await inventory.useOnJob(user.companyId, {
    jobId,
    itemId,
    locationId,
    quantity: parseInt(quantity),
    userId: user.userId,
    unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
  })

  return c.json(usage)
})

// Get job usage
app.get('/job/:jobId', async (c) => {
  const user = c.get('user') as any
  const jobId = c.req.param('jobId')
  const usage = await inventory.getJobUsage(jobId, user.companyId)
  return c.json(usage)
})

// Return from job
app.post('/return', requirePermission('inventory:update'), async (c) => {
  const user = c.get('user') as any
  const { usageId, returnQuantity, locationId } = await c.req.json()

  const result = await inventory.returnFromJob(user.companyId, {
    usageId,
    returnQuantity: parseInt(returnQuantity),
    locationId,
    userId: user.userId,
  })

  return c.json(result)
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
  const orders = await inventory.getPurchaseOrders(user.companyId, {
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
  const po = await inventory.createPurchaseOrder(user.companyId, {
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

  const po = await inventory.receivePurchaseOrder(user.companyId, id, {
    items,
    userId: user.userId,
  })

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
  const report = await inventory.getInventoryValue(user.companyId)
  return c.json(report)
})

export default app
