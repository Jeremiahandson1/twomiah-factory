import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import inventory from '../services/inventory.ts'
import glPosting from '../services/glPosting.ts'
import reviews from '../services/reviews.ts'
import audit from '../services/audit.ts'

// Walk-in parts counter (POS). Lines decrement the same perpetual stock ledger as
// repair-order parts — the retail side of the parts department.
const app = new Hono()
app.use('*', authenticate)

// List sales
app.get('/', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status') || undefined
  const page = parseInt(c.req.query('page') || '0') || 1
  const limit = parseInt(c.req.query('limit') || '0') || 25
  return c.json(await inventory.listCounterSales(user.companyId, { status, page, limit }))
})

// Get one sale + lines
app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const sale = await inventory.getCounterSale(user.companyId, c.req.param('id'))
  if (!sale) return c.json({ error: 'Sale not found' }, 404)
  return c.json(sale)
})

// Create a sale
app.post('/', requirePermission('inventory:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  const sale = await inventory.createCounterSale(user.companyId, {
    customerId: body.customerId || undefined,
    userId: user.userId,
  })
  audit.log({ action: 'COUNTER_SALE_CREATED', entity: 'counter_sale', entityId: sale.id, metadata: { saleNumber: sale.saleNumber }, userId: user.userId, companyId: user.companyId })
  return c.json(sale, 201)
})

// Add a line (decrements stock when it resolves to a stocked item at a location)
app.post('/:id/lines', requirePermission('inventory:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({} as any))
  const quantity = body.quantity != null ? parseInt(body.quantity) : 1
  if (!quantity || quantity <= 0) return c.json({ error: 'quantity must be a positive integer' }, 400)
  try {
    const line = await inventory.addCounterSaleLine(user.companyId, {
      saleId: id,
      itemId: body.itemId || undefined,
      catalogPartId: body.catalogPartId || undefined,
      locationId: body.locationId || undefined,
      quantity,
      unitPrice: body.unitPrice != null ? parseFloat(body.unitPrice) : undefined,
      description: body.description || undefined,
      partNumber: body.partNumber || undefined,
      userId: user.userId,
    })
    return c.json(line, 201)
  } catch (e: any) {
    const msg = e?.message || 'Failed to add line'
    return c.json({ error: msg }, msg === 'Counter sale not found' ? 404 : 400)
  }
})

// Remove a line (restocks if it had decremented)
app.delete('/:id/lines/:lineId', requirePermission('inventory:update'), async (c) => {
  const user = c.get('user') as any
  try {
    await inventory.removeCounterSaleLine(user.companyId, c.req.param('lineId'), { userId: user.userId })
    return c.json({ ok: true })
  } catch (e: any) {
    const msg = e?.message || 'Failed to remove line'
    return c.json({ error: msg }, msg === 'Sale line not found' ? 404 : 400)
  }
})

// Complete a sale
app.post('/:id/complete', requirePermission('inventory:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({} as any))
  try {
    const sale = await inventory.completeCounterSale(user.companyId, id, { paymentMethod: body.paymentMethod || undefined })
    try { await glPosting.postCounterSale(user.companyId, id) } catch { /* never block the sale on a posting error */ }
    try { await reviews.scheduleReviewForContact(user.companyId, sale.customerId, { reason: 'counter_sale' }) } catch { /* best-effort */ }
    audit.log({ action: 'COUNTER_SALE_COMPLETED', entity: 'counter_sale', entityId: id, metadata: { total: sale.total }, userId: user.userId, companyId: user.companyId })
    return c.json(sale)
  } catch (e: any) {
    const msg = e?.message || 'Failed to complete sale'
    return c.json({ error: msg }, msg === 'Counter sale not found' ? 404 : 400)
  }
})

export default app
