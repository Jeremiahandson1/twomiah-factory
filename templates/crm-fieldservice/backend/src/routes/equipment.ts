import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import equipment from '../services/equipment.ts'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// EQUIPMENT TYPES
// ============================================

app.get('/types', async (c) => {
  const user = c.get('user') as any
  const category = c.req.query('category')
  const active = c.req.query('active')
  const types = await equipment.getEquipmentTypes(user.companyId, {
    category,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(types)
})

app.post('/types', requirePermission('equipment:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const type = await equipment.createEquipmentType(user.companyId, body)
  return c.json(type, 201)
})

// ============================================
// EQUIPMENT
// ============================================

app.get('/', async (c) => {
  const user = c.get('user') as any
  const {
    contactId, propertyId, category, status,
    needsMaintenance, warrantyExpiring, search,
    page, limit,
  } = c.req.query() as any

  const data = await equipment.getEquipment(user.companyId, {
    contactId,
    propertyId,
    category,
    status,
    needsMaintenance: needsMaintenance === 'true',
    warrantyExpiring: warrantyExpiring === 'true',
    search,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
  })
  return c.json(data)
})

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const stats = await equipment.getEquipmentStats(user.companyId)
  return c.json(stats)
})

app.get('/maintenance-due', async (c) => {
  const user = c.get('user') as any
  const days = c.req.query('days')
  const data = await equipment.getMaintenanceDue(user.companyId, {
    days: parseInt(days as string) || 30,
  })
  return c.json(data)
})

app.get('/warranty-expiring', async (c) => {
  const user = c.get('user') as any
  const days = c.req.query('days')
  const data = await equipment.getWarrantyExpiring(user.companyId, {
    days: parseInt(days as string) || 60,
  })
  return c.json(data)
})

app.get('/aging', async (c) => {
  const user = c.get('user') as any
  const minAge = c.req.query('minAge')
  const data = await equipment.getAgingEquipment(user.companyId, {
    minAgeYears: parseInt(minAge as string) || 10,
  })
  return c.json(data)
})

app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const item = await equipment.getEquipmentDetails(id, user.companyId)
  if (!item) return c.json({ error: 'Equipment not found' }, 404)
  return c.json(item)
})

app.post('/', requirePermission('equipment:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const item = await equipment.createEquipment(user.companyId, body)
  return c.json(item, 201)
})

app.put('/:id', requirePermission('equipment:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await equipment.updateEquipment(id, user.companyId, body)
  const item = await equipment.getEquipmentDetails(id, user.companyId)
  return c.json(item)
})

app.post('/:id/needs-repair', requirePermission('equipment:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { notes } = await c.req.json()
  await equipment.markNeedsRepair(id, user.companyId, notes)
  return c.json({ success: true })
})

app.post('/:id/replaced', requirePermission('equipment:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await equipment.markReplaced(id, user.companyId, body)
  return c.json({ success: true })
})

// ============================================
// SERVICE HISTORY
// ============================================

app.get('/:id/history', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const history = await equipment.getServiceHistory(id, user.companyId)
  return c.json(history)
})

app.post('/:id/history', requirePermission('equipment:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const record = await equipment.addServiceRecord(id, user.companyId, {
    ...body,
    technicianId: body.technicianId || user.userId,
  })
  return c.json(record, 201)
})

export default app
