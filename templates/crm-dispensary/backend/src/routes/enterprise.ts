import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Store Groups (Franchise/Chain) ──────────────────────────────────

// GET /store-groups — List store groups
app.get('/store-groups', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT sg.*,
           COALESCE(
             (SELECT json_agg(json_build_object('locationId', sgm.location_id, 'role', sgm.role, 'joinedAt', sgm.joined_at))
              FROM store_group_members sgm WHERE sgm.store_group_id = sg.id),
             '[]'::json
           ) as members
    FROM store_groups sg
    WHERE sg.company_id = ${currentUser.companyId}
    ORDER BY sg.name ASC
  `)

  return c.json((result as any).rows || result)
})

// POST /store-groups — Create store group
app.post('/store-groups', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const groupSchema = z.object({
    name: z.string().min(1).max(256),
    type: z.enum(['chain', 'franchise', 'coop']),
    settings: z.record(z.any()).optional(),
  })
  const data = groupSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO store_groups(id, company_id, name, type, settings, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.type}, ${JSON.stringify(data.settings || {})}::jsonb, NOW(), NOW())
    RETURNING *
  `)

  const group = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'store_group',
    entityId: group?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(group, 201)
})

// PUT /store-groups/:id — Update group
app.put('/store-groups/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const groupSchema = z.object({
    name: z.string().min(1).max(256).optional(),
    type: z.enum(['chain', 'franchise', 'coop']).optional(),
    settings: z.record(z.any()).optional(),
  })
  const data = groupSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.settings !== undefined) sets.push(sql`settings = ${JSON.stringify(data.settings)}::jsonb`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE store_groups SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Store group not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'store_group',
    entityId: id,
    entityName: updated.name,
    req: c.req,
  })

  return c.json(updated)
})

// POST /store-groups/:id/members — Add location to group
app.post('/store-groups/:id/members', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const groupId = c.req.param('id')

  const memberSchema = z.object({
    locationId: z.string().min(1),
    role: z.string().min(1).default('member'),
  })
  const data = memberSchema.parse(await c.req.json())

  // Verify group belongs to company
  const groupCheck = await db.execute(sql`
    SELECT id, name FROM store_groups WHERE id = ${groupId} AND company_id = ${currentUser.companyId}
  `)
  const group = ((groupCheck as any).rows || groupCheck)?.[0]
  if (!group) return c.json({ error: 'Store group not found' }, 404)

  const result = await db.execute(sql`
    INSERT INTO store_group_members(id, store_group_id, location_id, role, joined_at)
    VALUES (gen_random_uuid(), ${groupId}, ${data.locationId}, ${data.role}, NOW())
    ON CONFLICT (store_group_id, location_id) DO UPDATE SET role = ${data.role}
    RETURNING *
  `)

  const member = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'store_group_member',
    entityId: member?.id,
    entityName: `${group.name} - ${data.locationId}`,
    req: c.req,
  })

  return c.json(member, 201)
})

// DELETE /store-groups/:id/members/:locationId — Remove location from group
app.delete('/store-groups/:id/members/:locationId', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const groupId = c.req.param('id')
  const locationId = c.req.param('locationId')

  // Verify group belongs to company
  const groupCheck = await db.execute(sql`
    SELECT id, name FROM store_groups WHERE id = ${groupId} AND company_id = ${currentUser.companyId}
  `)
  const group = ((groupCheck as any).rows || groupCheck)?.[0]
  if (!group) return c.json({ error: 'Store group not found' }, 404)

  const result = await db.execute(sql`
    DELETE FROM store_group_members
    WHERE store_group_id = ${groupId} AND location_id = ${locationId}
    RETURNING *
  `)

  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Member not found in group' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'store_group_member',
    entityId: deleted.id,
    entityName: `${group.name} - ${locationId}`,
    req: c.req,
  })

  return c.json({ ok: true })
})

// GET /store-groups/:id/dashboard — Cross-store dashboard
app.get('/store-groups/:id/dashboard', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const groupId = c.req.param('id')

  // Verify group belongs to company
  const groupCheck = await db.execute(sql`
    SELECT id, name FROM store_groups WHERE id = ${groupId} AND company_id = ${currentUser.companyId}
  `)
  const group = ((groupCheck as any).rows || groupCheck)?.[0]
  if (!group) return c.json({ error: 'Store group not found' }, 404)

  // Get member location IDs
  const membersResult = await db.execute(sql`
    SELECT location_id FROM store_group_members WHERE store_group_id = ${groupId}
  `)
  const memberRows = (membersResult as any).rows || membersResult
  const locationIds = memberRows.map((r: any) => r.location_id)

  if (locationIds.length === 0) {
    return c.json({ group, totalRevenue: 0, totalOrders: 0, totalInventoryValue: 0, stores: [] })
  }

  // Aggregate revenue and orders per location
  const revenueResult = await db.execute(sql`
    SELECT o.location_id,
           COALESCE(SUM(o.total), 0)::numeric as revenue,
           COUNT(*)::int as order_count
    FROM orders o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.location_id = ANY(${locationIds}::text[])
      AND o.status != 'cancelled'
    GROUP BY o.location_id
  `)

  // Aggregate inventory value per location
  const inventoryResult = await db.execute(sql`
    SELECT pi.location_id,
           COALESCE(SUM(pi.quantity * p.price), 0)::numeric as inventory_value
    FROM product_locations pi
    JOIN products p ON p.id = pi.product_id
    WHERE p.company_id = ${currentUser.companyId}
      AND pi.location_id = ANY(${locationIds}::text[])
    GROUP BY pi.location_id
  `)

  const revenueRows = (revenueResult as any).rows || revenueResult
  const inventoryRows = (inventoryResult as any).rows || inventoryResult

  const revenueMap = new Map(revenueRows.map((r: any) => [r.location_id, r]))
  const inventoryMap = new Map(inventoryRows.map((r: any) => [r.location_id, r]))

  let totalRevenue = 0
  let totalOrders = 0
  let totalInventoryValue = 0

  const stores = locationIds.map((locId: string) => {
    const rev = revenueMap.get(locId) || { revenue: 0, order_count: 0 }
    const inv = inventoryMap.get(locId) || { inventory_value: 0 }
    totalRevenue += Number(rev.revenue)
    totalOrders += Number(rev.order_count)
    totalInventoryValue += Number(inv.inventory_value)
    return {
      locationId: locId,
      revenue: Number(rev.revenue),
      orderCount: Number(rev.order_count),
      inventoryValue: Number(inv.inventory_value),
    }
  })

  return c.json({ group, totalRevenue, totalOrders, totalInventoryValue, stores })
})

// ─── Multi-Store Reporting ──────────────────────────────────────────

// GET /multi-store/sales — Sales comparison across locations
app.get('/multi-store/sales', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  const endDate = c.req.query('endDate') || new Date().toISOString().split('T')[0]

  const salesResult = await db.execute(sql`
    SELECT o.location_id,
           COALESCE(SUM(o.total), 0)::numeric as revenue,
           COUNT(*)::int as order_count,
           ROUND(AVG(o.total)::numeric, 2) as avg_order_value
    FROM orders o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status != 'cancelled'
      AND o.created_at >= ${startDate}::date
      AND o.created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY o.location_id
    ORDER BY revenue DESC
  `)

  // Top products per location
  const topProductsResult = await db.execute(sql`
    SELECT oi.location_id, p.name as product_name, SUM(oi.quantity)::int as total_qty, SUM(oi.subtotal)::numeric as total_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status != 'cancelled'
      AND o.created_at >= ${startDate}::date
      AND o.created_at < (${endDate}::date + INTERVAL '1 day')
    GROUP BY oi.location_id, p.name
    ORDER BY total_revenue DESC
  `)

  const sales = (salesResult as any).rows || salesResult
  const topProducts = (topProductsResult as any).rows || topProductsResult

  // Group top products by location
  const productsByLocation = new Map<string, any[]>()
  for (const row of topProducts) {
    const locId = row.location_id
    if (!productsByLocation.has(locId)) productsByLocation.set(locId, [])
    const arr = productsByLocation.get(locId)!
    if (arr.length < 5) arr.push({ name: row.product_name, quantity: row.total_qty, revenue: Number(row.total_revenue) })
  }

  const locations = sales.map((s: any) => ({
    locationId: s.location_id,
    revenue: Number(s.revenue),
    orderCount: s.order_count,
    avgOrderValue: Number(s.avg_order_value),
    topProducts: productsByLocation.get(s.location_id) || [],
  }))

  return c.json({ locations, startDate, endDate })
})

// GET /multi-store/inventory — Inventory across locations
app.get('/multi-store/inventory', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT p.id as product_id, p.name as product_name, p.sku, p.category,
           pi.location_id, pi.quantity
    FROM products p
    LEFT JOIN product_locations pi ON pi.product_id = p.id
    WHERE p.company_id = ${currentUser.companyId}
      AND p.active = true
    ORDER BY p.name ASC, pi.location_id ASC
  `)

  const rows = (result as any).rows || result

  // Pivot: group by product, show quantity per location
  const productMap = new Map<string, any>()
  for (const row of rows) {
    if (!productMap.has(row.product_id)) {
      productMap.set(row.product_id, {
        productId: row.product_id,
        name: row.product_name,
        sku: row.sku,
        category: row.category,
        locations: {},
        total: 0,
      })
    }
    const product = productMap.get(row.product_id)!
    if (row.location_id) {
      const qty = Number(row.quantity || 0)
      product.locations[row.location_id] = qty
      product.total += qty
    }
  }

  return c.json(Array.from(productMap.values()))
})

// GET /multi-store/compliance — Compliance status across locations
app.get('/multi-store/compliance', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const locationsResult = await db.execute(sql`
    SELECT l.id, l.name, l.license_number, l.license_expiry, l.license_type,
           l.metrc_api_key IS NOT NULL as metrc_connected
    FROM locations l
    WHERE l.company_id = ${currentUser.companyId}
    ORDER BY l.name ASC
  `)

  const locations = (locationsResult as any).rows || locationsResult

  // Get last Metrc sync per location
  const syncResult = await db.execute(sql`
    SELECT location_id, MAX(synced_at) as last_sync
    FROM metrc_sync_log
    WHERE company_id = ${currentUser.companyId}
    GROUP BY location_id
  `)
  const syncRows = (syncResult as any).rows || syncResult
  const syncMap = new Map(syncRows.map((r: any) => [r.location_id, r.last_sync]))

  // Get pending waste reports per location
  const wasteResult = await db.execute(sql`
    SELECT location_id, COUNT(*)::int as pending_count
    FROM waste_log
    WHERE company_id = ${currentUser.companyId}
      AND status = 'pending'
    GROUP BY location_id
  `)
  const wasteRows = (wasteResult as any).rows || wasteResult
  const wasteMap = new Map(wasteRows.map((r: any) => [r.location_id, r.pending_count]))

  const compliance = locations.map((loc: any) => {
    const now = new Date()
    const expiry = loc.license_expiry ? new Date(loc.license_expiry) : null
    let licenseStatus = 'unknown'
    if (expiry) {
      const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / 86400000)
      if (daysUntilExpiry < 0) licenseStatus = 'expired'
      else if (daysUntilExpiry < 30) licenseStatus = 'expiring_soon'
      else licenseStatus = 'active'
    }

    return {
      locationId: loc.id,
      locationName: loc.name,
      licenseNumber: loc.license_number,
      licenseExpiry: loc.license_expiry,
      licenseType: loc.license_type,
      licenseStatus,
      metrcConnected: loc.metrc_connected,
      lastMetrcSync: syncMap.get(loc.id) || null,
      pendingWasteReports: wasteMap.get(loc.id) || 0,
    }
  })

  return c.json(compliance)
})

// ─── ACH Payments ───────────────────────────────────────────────────

// POST /ach/setup — Setup ACH for company
app.post('/ach/setup', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  const achSchema = z.object({
    bankName: z.string().min(1),
    routingNumber: z.string().regex(/^\d{9}$/, 'Routing number must be 9 digits'),
    accountNumber: z.string().min(4).max(17),
    accountType: z.enum(['checking', 'savings']),
    accountHolderName: z.string().min(1),
  })
  const data = achSchema.parse(await c.req.json())

  // Store as encrypted JSON in company.integrations
  // In production, use proper encryption — here we base64 encode as a placeholder
  const achData = {
    bankName: data.bankName,
    routingNumber: data.routingNumber,
    accountNumber: data.accountNumber,
    accountType: data.accountType,
    accountHolderName: data.accountHolderName,
    setupAt: new Date().toISOString(),
  }
  const encrypted = Buffer.from(JSON.stringify(achData)).toString('base64')

  await db.execute(sql`
    UPDATE company
    SET integrations = COALESCE(integrations, '{}'::jsonb) || jsonb_build_object('ach', ${encrypted}),
        updated_at = NOW()
    WHERE id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'company',
    entityId: currentUser.companyId,
    entityName: 'ACH Setup',
    req: c.req,
  })

  return c.json({ ok: true, bankName: data.bankName, accountType: data.accountType, lastFour: data.accountNumber.slice(-4) })
})

// POST /ach/charge — Initiate ACH charge
app.post('/ach/charge', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const chargeSchema = z.object({
    orderId: z.string().min(1),
    amount: z.number().positive(),
    customerBankAccount: z.object({
      routing: z.string().regex(/^\d{9}$/, 'Routing number must be 9 digits'),
      account: z.string().min(4).max(17),
      type: z.enum(['checking', 'savings']),
    }),
  })
  const data = chargeSchema.parse(await c.req.json())

  // Verify order exists and belongs to company
  const orderCheck = await db.execute(sql`
    SELECT id, number, total FROM orders
    WHERE id = ${data.orderId} AND company_id = ${currentUser.companyId}
  `)
  const orderRow = ((orderCheck as any).rows || orderCheck)?.[0]
  if (!orderRow) return c.json({ error: 'Order not found' }, 404)

  // Create ACH transaction record (in reality this would go through a payment processor)
  const result = await db.execute(sql`
    INSERT INTO ach_transactions(id, company_id, order_id, amount, customer_routing_last4, customer_account_last4, account_type, status, initiated_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.orderId}, ${data.amount}, ${data.customerBankAccount.routing.slice(-4)}, ${data.customerBankAccount.account.slice(-4)}, ${data.customerBankAccount.type}, 'pending', ${currentUser.id}, NOW(), NOW())
    RETURNING *
  `)

  const transaction = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.PAYMENT,
    entity: 'ach_transaction',
    entityId: transaction?.id,
    entityName: `ACH charge $${data.amount} for order ${orderRow.number}`,
    req: c.req,
  })

  return c.json(transaction, 201)
})

// GET /ach/transactions — List ACH transactions
app.get('/ach/transactions', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND at.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT at.*, o.number as order_number
    FROM ach_transactions at
    LEFT JOIN orders o ON o.id = at.order_id
    WHERE at.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY at.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM ach_transactions at
    WHERE at.company_id = ${currentUser.companyId}
      ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── Open API ───────────────────────────────────────────────────────

// GET /api-docs — Return OpenAPI 3.0 spec JSON
app.get('/api-docs', async (c) => {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'Dispensary CRM Integration API',
      version: '1.0.0',
      description: 'Public integration endpoints for third-party POS systems and services.',
    },
    servers: [{ url: '/api/integrations', description: 'Integration API base' }],
    paths: {
      '/sale': {
        post: {
          summary: 'Record a sale',
          description: 'Submit a completed sale from an external POS system.',
          operationId: 'createSale',
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items', 'total', 'paymentMethod'],
                  properties: {
                    externalId: { type: 'string', description: 'External POS transaction ID' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['productId', 'quantity', 'price'],
                        properties: {
                          productId: { type: 'string' },
                          sku: { type: 'string' },
                          name: { type: 'string' },
                          quantity: { type: 'number' },
                          price: { type: 'number' },
                          discount: { type: 'number', default: 0 },
                        },
                      },
                    },
                    total: { type: 'number' },
                    tax: { type: 'number' },
                    discount: { type: 'number' },
                    paymentMethod: { type: 'string', enum: ['cash', 'debit', 'credit', 'ach'] },
                    customerId: { type: 'string' },
                    customerPhone: { type: 'string' },
                    budtenderId: { type: 'string' },
                    locationId: { type: 'string' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Sale recorded',
              content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'string' }, status: { type: 'string' } } } } },
            },
            '400': { description: 'Invalid request' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/inventory-sync': {
        post: {
          summary: 'Sync inventory',
          description: 'Bulk update inventory quantities from an external system.',
          operationId: 'syncInventory',
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['items'],
                  properties: {
                    locationId: { type: 'string' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['sku', 'quantity'],
                        properties: {
                          sku: { type: 'string' },
                          productId: { type: 'string' },
                          quantity: { type: 'number' },
                          unit: { type: 'string', enum: ['grams', 'units', 'ounces'] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Inventory synced',
              content: { 'application/json': { schema: { type: 'object', properties: { updated: { type: 'integer' }, errors: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, error: { type: 'string' } } } } } } } },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/products': {
        get: {
          summary: 'List products',
          description: 'Retrieve the product catalog.',
          operationId: 'listProducts',
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'active', in: 'query', schema: { type: 'boolean' } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            '200': {
              description: 'Product list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            sku: { type: 'string' },
                            category: { type: 'string' },
                            strain: { type: 'string' },
                            thcPercent: { type: 'number' },
                            cbdPercent: { type: 'number' },
                            price: { type: 'number' },
                            unit: { type: 'string' },
                            active: { type: 'boolean' },
                          },
                        },
                      },
                      pagination: {
                        type: 'object',
                        properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' } },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/customer': {
        post: {
          summary: 'Create or update customer',
          description: 'Upsert a customer record from an external system.',
          operationId: 'upsertCustomer',
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    externalId: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    phone: { type: 'string' },
                    dateOfBirth: { type: 'string', format: 'date' },
                    medicalCardNumber: { type: 'string' },
                    medicalCardExpiry: { type: 'string', format: 'date' },
                    preferences: { type: 'object' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Customer upserted',
              content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, isNew: { type: 'boolean' } } } } },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/loyalty/{phone}': {
        get: {
          summary: 'Get loyalty balance',
          description: 'Look up a customer loyalty point balance by phone number.',
          operationId: 'getLoyaltyBalance',
          security: [{ apiKey: [] }],
          parameters: [
            { name: 'phone', in: 'path', required: true, schema: { type: 'string' }, description: 'Customer phone number' },
          ],
          responses: {
            '200': {
              description: 'Loyalty balance',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      customerId: { type: 'string' },
                      name: { type: 'string' },
                      phone: { type: 'string' },
                      points: { type: 'integer' },
                      tier: { type: 'string' },
                      lifetimePoints: { type: 'integer' },
                      availableRewards: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: { id: { type: 'string' }, name: { type: 'string' }, pointsCost: { type: 'integer' } },
                        },
                      },
                    },
                  },
                },
              },
            },
            '404': { description: 'Customer not found' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key provided during integration setup.',
        },
      },
    },
  }

  return c.json(spec)
})

export default app
