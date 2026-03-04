import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import inventory from '../services/inventory.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

// ============================================
// ITEMS
// ============================================

// Get items
router.get('/items', async (req, res, next) => {
  try {
    const { search, category, lowStock, active, page, limit } = req.query;
    const items = await inventory.getItems(req.user.companyId, {
      search,
      category,
      lowStock: lowStock === 'true',
      active: active === 'false' ? false : active === 'all' ? null : true,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await inventory.getCategories(req.user.companyId);
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

// Get single item
router.get('/items/:id', async (req, res, next) => {
  try {
    const item = await inventory.getItem(req.params.id, req.user.companyId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create item
router.post('/items', requirePermission('inventory:create'), async (req, res, next) => {
  try {
    const item = await inventory.createItem(req.user.companyId, req.body);
    
    audit.log({
      action: 'INVENTORY_ITEM_CREATED',
      entity: 'inventory_item',
      entityId: item.id,
      metadata: { name: item.name, sku: item.sku },
      req,
    });

    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update item
router.put('/items/:id', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    await inventory.updateItem(req.params.id, req.user.companyId, req.body);
    const item = await inventory.getItem(req.params.id, req.user.companyId);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Get low stock items
router.get('/low-stock', async (req, res, next) => {
  try {
    const items = await inventory.getLowStockItems(req.user.companyId);
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// ============================================
// LOCATIONS
// ============================================

// Get locations
router.get('/locations', async (req, res, next) => {
  try {
    const { type, active } = req.query;
    const locations = await inventory.getLocations(req.user.companyId, {
      type,
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(locations);
  } catch (error) {
    next(error);
  }
});

// Create location
router.post('/locations', requirePermission('inventory:create'), async (req, res, next) => {
  try {
    const location = await inventory.createLocation(req.user.companyId, req.body);
    res.status(201).json(location);
  } catch (error) {
    next(error);
  }
});

// Get location inventory
router.get('/locations/:id/inventory', async (req, res, next) => {
  try {
    const location = await inventory.getLocationInventory(req.params.id, req.user.companyId);
    if (!location) return res.status(404).json({ error: 'Location not found' });
    res.json(location);
  } catch (error) {
    next(error);
  }
});

// ============================================
// STOCK OPERATIONS
// ============================================

// Adjust stock
router.post('/adjust', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    const { itemId, locationId, quantity, reason } = req.body;

    if (!itemId || !locationId || quantity === undefined) {
      return res.status(400).json({ error: 'itemId, locationId, and quantity are required' });
    }

    const result = await inventory.adjustStock(req.user.companyId, {
      itemId,
      locationId,
      quantity: parseInt(quantity),
      reason,
      userId: req.user.userId,
    });

    audit.log({
      action: quantity > 0 ? 'INVENTORY_ADDED' : 'INVENTORY_REMOVED',
      entity: 'inventory_item',
      entityId: itemId,
      metadata: { quantity, locationId, reason },
      req,
    });

    res.json(result);
  } catch (error) {
    if (error.message === 'Insufficient stock') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Transfer stock
router.post('/transfer', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    const { itemId, fromLocationId, toLocationId, quantity, notes } = req.body;

    if (!itemId || !fromLocationId || !toLocationId || !quantity) {
      return res.status(400).json({ error: 'itemId, fromLocationId, toLocationId, and quantity are required' });
    }

    const transfer = await inventory.transferStock(req.user.companyId, {
      itemId,
      fromLocationId,
      toLocationId,
      quantity: parseInt(quantity),
      userId: req.user.userId,
      notes,
    });

    audit.log({
      action: 'INVENTORY_TRANSFERRED',
      entity: 'inventory_item',
      entityId: itemId,
      metadata: { quantity, fromLocationId, toLocationId },
      req,
    });

    res.json(transfer);
  } catch (error) {
    if (error.message === 'Insufficient stock at source location') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// ============================================
// JOB USAGE
// ============================================

// Use on job
router.post('/use', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    const { jobId, itemId, locationId, quantity, unitPrice } = req.body;

    if (!jobId || !itemId || !locationId || !quantity) {
      return res.status(400).json({ error: 'jobId, itemId, locationId, and quantity are required' });
    }

    const usage = await inventory.useOnJob(req.user.companyId, {
      jobId,
      itemId,
      locationId,
      quantity: parseInt(quantity),
      userId: req.user.userId,
      unitPrice: unitPrice ? parseFloat(unitPrice) : undefined,
    });

    res.json(usage);
  } catch (error) {
    if (error.message === 'Insufficient stock' || error.message === 'Item not found') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// Get job usage
router.get('/job/:jobId', async (req, res, next) => {
  try {
    const usage = await inventory.getJobUsage(req.params.jobId, req.user.companyId);
    res.json(usage);
  } catch (error) {
    next(error);
  }
});

// Return from job
router.post('/return', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    const { usageId, returnQuantity, locationId } = req.body;

    const result = await inventory.returnFromJob(req.user.companyId, {
      usageId,
      returnQuantity: parseInt(returnQuantity),
      locationId,
      userId: req.user.userId,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PURCHASE ORDERS
// ============================================

// Get purchase orders
router.get('/purchase-orders', async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const orders = await inventory.getPurchaseOrders(req.user.companyId, {
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    });
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

// Create purchase order
router.post('/purchase-orders', requirePermission('inventory:create'), async (req, res, next) => {
  try {
    const po = await inventory.createPurchaseOrder(req.user.companyId, {
      ...req.body,
      userId: req.user.userId,
    });

    audit.log({
      action: 'PURCHASE_ORDER_CREATED',
      entity: 'purchase_order',
      entityId: po.id,
      metadata: { number: po.number, vendor: po.vendor },
      req,
    });

    res.status(201).json(po);
  } catch (error) {
    next(error);
  }
});

// Receive purchase order
router.post('/purchase-orders/:id/receive', requirePermission('inventory:update'), async (req, res, next) => {
  try {
    const { items } = req.body;

    const po = await inventory.receivePurchaseOrder(req.user.companyId, req.params.id, {
      items,
      userId: req.user.userId,
    });

    audit.log({
      action: 'PURCHASE_ORDER_RECEIVED',
      entity: 'purchase_order',
      entityId: req.params.id,
      req,
    });

    res.json(po);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REPORTS
// ============================================

// Inventory value
router.get('/reports/value', async (req, res, next) => {
  try {
    const report = await inventory.getInventoryValue(req.user.companyId);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

export default router;
