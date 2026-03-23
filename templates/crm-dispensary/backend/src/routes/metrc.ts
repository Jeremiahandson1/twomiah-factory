import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import metrcService from '../services/metrc.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// All Metrc endpoints require manager+
app.use('*', requireRole('manager'))

// ─── Config ─────────────────────────────────────────────────────────────────────

// GET /config — Get company's Metrc config
app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, api_key, user_key, license_number, state, auto_sync,
           sync_interval, sync_packages, sync_sales, sync_transfers, sync_plants,
           last_sync_at, created_at, updated_at
    FROM metrc_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const rows = (result as any).rows || result
  if (!rows.length) {
    return c.json({ config: null })
  }

  return c.json({ config: rows[0] })
})

// PUT /config — Update Metrc config
const configSchema = z.object({
  apiKey: z.string().min(1),
  userKey: z.string().min(1),
  licenseNumber: z.string().min(1),
  state: z.string().min(2).max(2),
  autoSync: z.boolean().optional(),
  syncInterval: z.number().int().min(5).optional(),
  syncPackages: z.boolean().optional(),
  syncSales: z.boolean().optional(),
  syncTransfers: z.boolean().optional(),
  syncPlants: z.boolean().optional(),
})

app.put('/config', async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof configSchema>
  try {
    data = configSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Upsert config
  const result = await db.execute(sql`
    INSERT INTO metrc_config (id, company_id, api_key, user_key, license_number, state,
      auto_sync, sync_interval, sync_packages, sync_sales, sync_transfers, sync_plants, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.apiKey}, ${data.userKey},
      ${data.licenseNumber}, ${data.state},
      ${data.autoSync ?? false}, ${data.syncInterval ?? 60},
      ${data.syncPackages ?? true}, ${data.syncSales ?? true},
      ${data.syncTransfers ?? true}, ${data.syncPlants ?? false}, NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      api_key = EXCLUDED.api_key,
      user_key = EXCLUDED.user_key,
      license_number = EXCLUDED.license_number,
      state = EXCLUDED.state,
      auto_sync = EXCLUDED.auto_sync,
      sync_interval = EXCLUDED.sync_interval,
      sync_packages = EXCLUDED.sync_packages,
      sync_sales = EXCLUDED.sync_sales,
      sync_transfers = EXCLUDED.sync_transfers,
      sync_plants = EXCLUDED.sync_plants,
      updated_at = NOW()
    RETURNING *
  `)

  const rows = (result as any).rows || result

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'metrc_config',
    entityName: 'Metrc Configuration',
    metadata: { state: data.state, licenseNumber: data.licenseNumber, autoSync: data.autoSync },
    req: {
      user: currentUser,
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({ config: rows[0] })
})

// POST /config/test — Test Metrc connection
app.post('/config/test', async (c) => {
  const currentUser = c.get('user') as any

  // Get existing config
  const configResult = await db.execute(sql`
    SELECT api_key, user_key, license_number, state
    FROM metrc_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const configRows = (configResult as any).rows || configResult
  if (!configRows.length) {
    return c.json({ error: 'Metrc not configured. Save your config first.' }, 400)
  }

  const config = configRows[0]

  try {
    const result = await metrcService.testConnection({
      apiKey: config.api_key,
      userKey: config.user_key,
      licenseNumber: config.license_number,
      state: config.state,
    })

    return c.json({ success: true, message: 'Connection successful', details: result })
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Connection failed' }, 400)
  }
})

// ─── Sync ───────────────────────────────────────────────────────────────────────

// POST /sync — Trigger full sync
app.post('/sync', async (c) => {
  const currentUser = c.get('user') as any

  try {
    const result = await metrcService.syncAll(currentUser.companyId)

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'metrc_sync',
      entityName: 'Full Metrc Sync',
      metadata: { result },
      req: {
        user: currentUser,
        ip: c.req.header('x-forwarded-for') || undefined,
        headers: { 'user-agent': c.req.header('user-agent') },
      },
    })

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Sync failed' }, 500)
  }
})

// POST /sync/packages — Sync only packages
app.post('/sync/packages', async (c) => {
  const currentUser = c.get('user') as any

  try {
    const result = await metrcService.syncPackages(currentUser.companyId)

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'metrc_sync',
      entityName: 'Package Sync',
      metadata: { result },
      req: {
        user: currentUser,
        ip: c.req.header('x-forwarded-for') || undefined,
        headers: { 'user-agent': c.req.header('user-agent') },
      },
    })

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Package sync failed' }, 500)
  }
})

// POST /sync/sales — Sync only sales
app.post('/sync/sales', async (c) => {
  const currentUser = c.get('user') as any

  try {
    const result = await metrcService.syncSales(currentUser.companyId)

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'metrc_sync',
      entityName: 'Sales Sync',
      metadata: { result },
      req: {
        user: currentUser,
        ip: c.req.header('x-forwarded-for') || undefined,
        headers: { 'user-agent': c.req.header('user-agent') },
      },
    })

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Sales sync failed' }, 500)
  }
})

// GET /sync/log — Get sync history (paginated, most recent first)
app.get('/sync/log', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, sync_type, status, records_processed, records_created, records_updated,
             error, started_at, completed_at
      FROM metrc_sync_log
      WHERE company_id = ${currentUser.companyId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM metrc_sync_log
      WHERE company_id = ${currentUser.companyId}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, total, page, limit })
})

// ─── Packages ───────────────────────────────────────────────────────────────────

// GET /packages — List synced packages (paginated, searchable)
app.get('/packages', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const search = c.req.query('search')

  let searchCondition = sql``
  if (search) {
    searchCondition = sql`AND (tag ILIKE ${'%' + search + '%'} OR item_name ILIKE ${'%' + search + '%'})`
  }

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, metrc_id, tag, item_name, item_category, quantity, unit_of_measure,
             product_id, lab_testing_state, received_date_time
      FROM metrc_packages
      WHERE company_id = ${currentUser.companyId}
        ${searchCondition}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM metrc_packages
      WHERE company_id = ${currentUser.companyId}
        ${searchCondition}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, total, page, limit })
})

// GET /packages/:id — Get package detail
app.get('/packages/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT *
    FROM metrc_packages
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const rows = (result as any).rows || result
  if (!rows.length) {
    return c.json({ error: 'Package not found' }, 404)
  }

  return c.json(rows[0])
})

// POST /packages/:id/link — Link a Metrc package to a local product
const linkSchema = z.object({
  productId: z.string().uuid(),
})

app.post('/packages/:id/link', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof linkSchema>
  try {
    data = linkSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Verify package exists
  const pkgResult = await db.execute(sql`
    SELECT id, tag FROM metrc_packages
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const pkgRows = (pkgResult as any).rows || pkgResult
  if (!pkgRows.length) {
    return c.json({ error: 'Package not found' }, 404)
  }

  // Update the link
  await db.execute(sql`
    UPDATE metrc_packages
    SET product_id = ${data.productId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'metrc_packages',
    entityId: id,
    entityName: pkgRows[0].tag,
    metadata: { productId: data.productId },
    req: {
      user: currentUser,
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({ success: true, packageId: id, productId: data.productId })
})

// ─── Sales ──────────────────────────────────────────────────────────────────────

// GET /sales — List Metrc sale receipts (paginated)
app.get('/sales', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, metrc_id, receipt_number, sales_date_time, total_price,
             order_id, is_final, last_modified
      FROM metrc_sale_receipts
      WHERE company_id = ${currentUser.companyId}
      ORDER BY sales_date_time DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM metrc_sale_receipts
      WHERE company_id = ${currentUser.companyId}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, total, page, limit })
})

// POST /sales/report — Report a specific order to Metrc
const reportSaleSchema = z.object({
  orderId: z.string().uuid(),
})

app.post('/sales/report', async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof reportSaleSchema>
  try {
    data = reportSaleSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  try {
    const result = await metrcService.reportSale(currentUser.companyId, data.orderId)

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'metrc_sale_receipts',
      entityName: 'Metrc Sale Report',
      metadata: { orderId: data.orderId, result },
      req: {
        user: currentUser,
        ip: c.req.header('x-forwarded-for') || undefined,
        headers: { 'user-agent': c.req.header('user-agent') },
      },
    })

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to report sale to Metrc' }, 500)
  }
})

// ─── Transfers ──────────────────────────────────────────────────────────────────

// GET /transfers — List transfers (paginated)
app.get('/transfers', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, metrc_id, manifest_number, shipper_facility_name, recipient_facility_name,
             shipment_type_name, estimated_arrival_date_time
      FROM metrc_transfers
      WHERE company_id = ${currentUser.companyId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM metrc_transfers
      WHERE company_id = ${currentUser.companyId}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, total, page, limit })
})

export default app
