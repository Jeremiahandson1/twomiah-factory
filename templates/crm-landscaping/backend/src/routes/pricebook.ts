import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import pricebook from '../services/pricebook.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// CATEGORIES
// ============================================

// Get categories
app.get('/categories', async (c) => {
  const user = c.get('user') as any
  const flat = c.req.query('flat')
  const active = c.req.query('active')
  const categories = await pricebook.getCategories(user.companyId, {
    flat: flat === 'true',
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(categories)
})

// Create category
app.post('/categories', requirePermission('pricebook:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const category = await pricebook.createCategory(user.companyId, body)
  return c.json(category, 201)
})

// Update category
app.put('/categories/:id', requirePermission('pricebook:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await pricebook.updateCategory(id, user.companyId, body)
  return c.json({ success: true })
})

// Reorder categories
app.post('/categories/reorder', requirePermission('pricebook:update'), async (c) => {
  const user = c.get('user') as any
  const { orderedIds } = await c.req.json()
  await pricebook.reorderCategories(user.companyId, orderedIds)
  return c.json({ success: true })
})

// ============================================
// ITEMS
// ============================================

// Get items
app.get('/items', async (c) => {
  const user = c.get('user') as any
  const categoryId = c.req.query('categoryId')
  const search = c.req.query('search')
  const active = c.req.query('active')
  const showToCustomer = c.req.query('showToCustomer')
  const page = c.req.query('page')
  const limit = c.req.query('limit')
  const items = await pricebook.getItems(user.companyId, {
    categoryId,
    search,
    active: active === 'false' ? false : active === 'all' ? null : true,
    showToCustomer: showToCustomer === 'true' ? true : showToCustomer === 'false' ? false : undefined,
    page: parseInt(page || '0') || 1,
    limit: parseInt(limit || '0') || 50,
  })
  return c.json(items)
})

// Search for quoting
app.get('/search', async (c) => {
  const user = c.get('user') as any
  const q = c.req.query('q')
  if (!q) return c.json([])

  const items = await pricebook.searchForQuoting(user.companyId, q)
  return c.json(items)
})

// Get single item
app.get('/items/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const item = await pricebook.getItem(id, user.companyId)
  if (!item) return c.json({ error: 'Item not found' }, 404)
  return c.json(item)
})

// Create item
app.post('/items', requirePermission('pricebook:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const item = await pricebook.createItem(user.companyId, body)
  return c.json(item, 201)
})

// Update item
app.put('/items/:id', requirePermission('pricebook:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await pricebook.updateItem(id, user.companyId, body)
  const item = await pricebook.getItem(id, user.companyId)
  return c.json(item)
})

// Duplicate item
app.post('/items/:id/duplicate', requirePermission('pricebook:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const item = await pricebook.duplicateItem(id, user.companyId)
  return c.json(item, 201)
})

// ============================================
// GOOD-BETTER-BEST
// ============================================

// Get Good-Better-Best options
app.get('/items/:id/options', async (c) => {
  const id = c.req.param('id')
  const options = await pricebook.getGoodBetterBest(id)
  return c.json(options)
})

// Set Good-Better-Best options
app.put('/items/:id/options', requirePermission('pricebook:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { options } = await c.req.json()
  await pricebook.setGoodBetterBest(id, user.companyId, options)
  const updated = await pricebook.getGoodBetterBest(id)
  return c.json(updated)
})

// ============================================
// BULK OPERATIONS
// ============================================

// Bulk price adjustment
app.post('/bulk/adjust-prices', requirePermission('pricebook:update'), async (c) => {
  const user = c.get('user') as any
  const { categoryId, itemIds, adjustmentType, adjustmentValue, applyTo } = await c.req.json()

  if (!adjustmentType || adjustmentValue === undefined || !applyTo) {
    return c.json({ error: 'adjustmentType, adjustmentValue, and applyTo are required' }, 400)
  }

  const results = await pricebook.bulkPriceAdjustment(user.companyId, {
    categoryId,
    itemIds,
    adjustmentType,
    adjustmentValue: parseFloat(adjustmentValue),
    applyTo,
  })

  return c.json({ updated: results.length })
})

// ============================================
// IMPORT/EXPORT
// ============================================

// Export pricebook
app.get('/export', async (c) => {
  const user = c.get('user') as any
  const data = await pricebook.exportPricebook(user.companyId)
  return c.json(data)
})

// Import pricebook
app.post('/import', requirePermission('pricebook:create'), async (c) => {
  const user = c.get('user') as any
  const { data, updateExisting } = await c.req.json()

  if (!data || !Array.isArray(data)) {
    return c.json({ error: 'data array is required' }, 400)
  }

  const results = await pricebook.importPricebook(user.companyId, data, {
    updateExisting: updateExisting === true,
  })

  return c.json(results)
})

// Calculate suggested price
app.get('/calculate-price', async (c) => {
  const cost = c.req.query('cost')
  const targetMargin = c.req.query('targetMargin')

  if (!cost || !targetMargin) {
    return c.json({ error: 'cost and targetMargin are required' }, 400)
  }

  const suggestedPrice = pricebook.calculateSuggestedPrice(
    parseFloat(cost),
    parseFloat(targetMargin)
  )

  return c.json({
    cost: parseFloat(cost),
    targetMargin: parseFloat(targetMargin),
    suggestedPrice: Math.round(suggestedPrice * 100) / 100,
  })
})

export default app
