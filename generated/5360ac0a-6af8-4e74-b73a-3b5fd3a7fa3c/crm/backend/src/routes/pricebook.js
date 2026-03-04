import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import pricebook from '../services/pricebook.js';

const router = Router();
router.use(authenticate);

// ============================================
// CATEGORIES
// ============================================

// Get categories
router.get('/categories', async (req, res, next) => {
  try {
    const { flat, active } = req.query;
    const categories = await pricebook.getCategories(req.user.companyId, {
      flat: flat === 'true',
      active: active === 'false' ? false : active === 'all' ? null : true,
    });
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

// Create category
router.post('/categories', requirePermission('pricebook:create'), async (req, res, next) => {
  try {
    const category = await pricebook.createCategory(req.user.companyId, req.body);
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
});

// Update category
router.put('/categories/:id', requirePermission('pricebook:update'), async (req, res, next) => {
  try {
    await pricebook.updateCategory(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Reorder categories
router.post('/categories/reorder', requirePermission('pricebook:update'), async (req, res, next) => {
  try {
    const { orderedIds } = req.body;
    await pricebook.reorderCategories(req.user.companyId, orderedIds);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ITEMS
// ============================================

// Get items
router.get('/items', async (req, res, next) => {
  try {
    const { categoryId, search, active, showToCustomer, page, limit } = req.query;
    const items = await pricebook.getItems(req.user.companyId, {
      categoryId,
      search,
      active: active === 'false' ? false : active === 'all' ? null : true,
      showToCustomer: showToCustomer === 'true' ? true : showToCustomer === 'false' ? false : undefined,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    });
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Search for quoting
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const items = await pricebook.searchForQuoting(req.user.companyId, q);
    res.json(items);
  } catch (error) {
    next(error);
  }
});

// Get single item
router.get('/items/:id', async (req, res, next) => {
  try {
    const item = await pricebook.getItem(req.params.id, req.user.companyId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Create item
router.post('/items', requirePermission('pricebook:create'), async (req, res, next) => {
  try {
    const item = await pricebook.createItem(req.user.companyId, req.body);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// Update item
router.put('/items/:id', requirePermission('pricebook:update'), async (req, res, next) => {
  try {
    await pricebook.updateItem(req.params.id, req.user.companyId, req.body);
    const item = await pricebook.getItem(req.params.id, req.user.companyId);
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// Duplicate item
router.post('/items/:id/duplicate', requirePermission('pricebook:create'), async (req, res, next) => {
  try {
    const item = await pricebook.duplicateItem(req.params.id, req.user.companyId);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GOOD-BETTER-BEST
// ============================================

// Get Good-Better-Best options
router.get('/items/:id/options', async (req, res, next) => {
  try {
    const options = await pricebook.getGoodBetterBest(req.params.id);
    res.json(options);
  } catch (error) {
    next(error);
  }
});

// Set Good-Better-Best options
router.put('/items/:id/options', requirePermission('pricebook:update'), async (req, res, next) => {
  try {
    const { options } = req.body;
    await pricebook.setGoodBetterBest(req.params.id, req.user.companyId, options);
    const updated = await pricebook.getGoodBetterBest(req.params.id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ============================================
// BULK OPERATIONS
// ============================================

// Bulk price adjustment
router.post('/bulk/adjust-prices', requirePermission('pricebook:update'), async (req, res, next) => {
  try {
    const { categoryId, itemIds, adjustmentType, adjustmentValue, applyTo } = req.body;

    if (!adjustmentType || adjustmentValue === undefined || !applyTo) {
      return res.status(400).json({ error: 'adjustmentType, adjustmentValue, and applyTo are required' });
    }

    const results = await pricebook.bulkPriceAdjustment(req.user.companyId, {
      categoryId,
      itemIds,
      adjustmentType,
      adjustmentValue: parseFloat(adjustmentValue),
      applyTo,
    });

    res.json({ updated: results.length });
  } catch (error) {
    next(error);
  }
});

// ============================================
// IMPORT/EXPORT
// ============================================

// Export pricebook
router.get('/export', async (req, res, next) => {
  try {
    const data = await pricebook.exportPricebook(req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Import pricebook
router.post('/import', requirePermission('pricebook:create'), async (req, res, next) => {
  try {
    const { data, updateExisting } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'data array is required' });
    }

    const results = await pricebook.importPricebook(req.user.companyId, data, {
      updateExisting: updateExisting === true,
    });

    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Calculate suggested price
router.get('/calculate-price', async (req, res, next) => {
  try {
    const { cost, targetMargin } = req.query;

    if (!cost || !targetMargin) {
      return res.status(400).json({ error: 'cost and targetMargin are required' });
    }

    const suggestedPrice = pricebook.calculateSuggestedPrice(
      parseFloat(cost),
      parseFloat(targetMargin)
    );

    res.json({
      cost: parseFloat(cost),
      targetMargin: parseFloat(targetMargin),
      suggestedPrice: Math.round(suggestedPrice * 100) / 100,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
