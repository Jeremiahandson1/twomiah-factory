import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// All Leaf Data endpoints require manager+
app.use('*', requireRole('manager'))

// ─── Leaf Data API Service ───────────────────────────────────────────────────

interface LeafDataConfig {
  api_key: string
  mme_id: string
  license_number: string
  environment: string
}

function getBaseUrl(environment: string): string {
  return environment === 'production'
    ? 'https://traceability.lcb.wa.gov/api/v1'
    : 'https://traceability-test.lcb.wa.gov/api/v1'
}

async function leafDataRequest(config: LeafDataConfig, endpoint: string, method: string = 'GET', body?: any) {
  const baseUrl = getBaseUrl(config.environment)
  const url = `${baseUrl}${endpoint}`

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': config.api_key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Leaf Data API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return response.json()
}

async function getConfig(companyId: string): Promise<LeafDataConfig | null> {
  const result = await db.execute(sql`
    SELECT api_key, mme_id, license_number, environment
    FROM leaf_data_config
    WHERE company_id = ${companyId}
    LIMIT 1
  `)
  const rows = (result as any).rows || result
  return rows.length ? rows[0] : null
}

async function logSync(companyId: string, syncType: string, status: string, recordsProcessed: number, recordsCreated: number, error: string | null, startedAt: Date) {
  await db.execute(sql`
    INSERT INTO metrc_sync_log (id, company_id, sync_type, status, records_processed, records_created, error, started_at, completed_at)
    VALUES (gen_random_uuid(), ${companyId}, ${syncType}, ${status}, ${recordsProcessed}, ${recordsCreated}, ${error}, ${startedAt.toISOString()}::timestamptz, NOW())
  `)
}

// ─── Config ─────────────────────────────────────────────────────────────────

// GET /config — Get Leaf Data config
app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, mme_id, license_number, environment, auto_sync,
           last_sync_at, created_at, updated_at
    FROM leaf_data_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const rows = (result as any).rows || result
  if (!rows.length) {
    return c.json({ config: null })
  }

  return c.json({ config: rows[0] })
})

// PUT /config — Update Leaf Data config
const configSchema = z.object({
  apiKey: z.string().min(1),
  mmeId: z.string().min(1),
  licenseNumber: z.string().min(1),
  environment: z.enum(['production', 'test']).default('test'),
  autoSync: z.boolean().optional(),
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
    INSERT INTO leaf_data_config (id, company_id, api_key, mme_id, license_number, environment,
      auto_sync, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.apiKey}, ${data.mmeId},
      ${data.licenseNumber}, ${data.environment}, ${data.autoSync ?? false}, NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      api_key = EXCLUDED.api_key,
      mme_id = EXCLUDED.mme_id,
      license_number = EXCLUDED.license_number,
      environment = EXCLUDED.environment,
      auto_sync = EXCLUDED.auto_sync,
      updated_at = NOW()
    RETURNING *
  `)

  const rows = (result as any).rows || result

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'leaf_data_config',
    entityName: 'Leaf Data Systems Configuration',
    metadata: { environment: data.environment, licenseNumber: data.licenseNumber, mmeId: data.mmeId, autoSync: data.autoSync },
    req: {
      user: currentUser,
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({ config: rows[0] })
})

// POST /config/test — Test Leaf Data connection
app.post('/config/test', async (c) => {
  const currentUser = c.get('user') as any

  const config = await getConfig(currentUser.companyId)
  if (!config) {
    return c.json({ error: 'Leaf Data Systems not configured. Save your config first.' }, 400)
  }

  try {
    // Test with GET /api/v1/users/me
    const result = await leafDataRequest(config, '/users/me')
    return c.json({ success: true, message: 'Connection successful', details: result })
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Connection failed' }, 400)
  }
})

// ─── Sync ───────────────────────────────────────────────────────────────────

// POST /sync — Full sync (inventory lots, sales, transfers)
app.post('/sync', async (c) => {
  const currentUser = c.get('user') as any

  const config = await getConfig(currentUser.companyId)
  if (!config) {
    return c.json({ error: 'Leaf Data Systems not configured' }, 400)
  }

  const startedAt = new Date()
  const results: Record<string, any> = {}
  let totalSynced = 0
  let totalFailed = 0

  // Sync inventory lots
  try {
    const invResult = await leafDataRequest(config, '/inventory')
    const inventoryLots = invResult.data || invResult.inventory || invResult || []
    const lots = Array.isArray(inventoryLots) ? inventoryLots : []
    results.inventory = { count: lots.length }
    totalSynced += lots.length

    for (const lot of lots) {
      await db.execute(sql`
        INSERT INTO metrc_packages (id, company_id, metrc_id, label, item_name,
          quantity, unit_of_measure, item_strain_name, raw_data)
        VALUES (gen_random_uuid(), ${currentUser.companyId},
          ${lot.global_id || lot.inventory_id || lot.id},
          ${lot.global_id || null},
          ${lot.description || lot.product_name || null},
          ${lot.qty || lot.quantity || 0},
          ${lot.uom || lot.unit_of_measure || null},
          ${lot.strain || null},
          ${JSON.stringify({ room: lot.area_name || lot.room || null, status: lot.status || 'active', source: 'leaf_data' })}::jsonb)
        ON CONFLICT (company_id, metrc_id) DO UPDATE SET
          label = EXCLUDED.label,
          item_name = EXCLUDED.item_name,
          quantity = EXCLUDED.quantity,
          unit_of_measure = EXCLUDED.unit_of_measure,
          item_strain_name = EXCLUDED.item_strain_name,
          raw_data = EXCLUDED.raw_data
      `)
    }
  } catch (err: any) {
    results.inventory = { error: err.message }
    totalFailed++
  }

  // Sync sales
  try {
    const salesResult = await leafDataRequest(config, '/sales')
    const sales = salesResult.data || salesResult.sales || salesResult || []
    const salesList = Array.isArray(sales) ? sales : []
    results.sales = { count: salesList.length }
    totalSynced += salesList.length

    for (const sale of salesList) {
      await db.execute(sql`
        INSERT INTO metrc_sale_receipts (id, company_id, metrc_id,
          sales_date_time, total_price, sales_customer_type, raw_data)
        VALUES (gen_random_uuid(), ${currentUser.companyId},
          ${sale.global_id || sale.sale_id || sale.id},
          ${sale.sold_at || sale.sale_date || null},
          ${sale.total_price || sale.total || 0},
          ${sale.customer_type || 'recreational'},
          ${JSON.stringify({ items: sale.sale_items || sale.items || [], status: sale.status || 'completed', source: 'leaf_data' })}::jsonb)
        ON CONFLICT (company_id, metrc_id) DO UPDATE SET
          sales_date_time = EXCLUDED.sales_date_time,
          total_price = EXCLUDED.total_price,
          sales_customer_type = EXCLUDED.sales_customer_type,
          raw_data = EXCLUDED.raw_data
      `)
    }
  } catch (err: any) {
    results.sales = { error: err.message }
    totalFailed++
  }

  // Sync transfers
  try {
    const transferResult = await leafDataRequest(config, '/transfers')
    const transfers = transferResult.data || transferResult.transfers || transferResult || []
    const transferList = Array.isArray(transfers) ? transfers : []
    results.transfers = { count: transferList.length }
    totalSynced += transferList.length

    for (const transfer of transferList) {
      await db.execute(sql`
        INSERT INTO metrc_transfers (id, company_id, metrc_id,
          manifest_number, shipment_type_name, shipper_facility_license_number, recipient_facility_license_number,
          raw_data)
        VALUES (gen_random_uuid(), ${currentUser.companyId},
          ${transfer.global_id || transfer.transfer_id || transfer.id},
          ${transfer.manifest_id || null},
          ${transfer.type || transfer.transfer_type || null},
          ${transfer.from_mme_id || transfer.source_mme_id || null},
          ${transfer.to_mme_id || transfer.destination_mme_id || null},
          ${JSON.stringify({ status: transfer.status || null, transfer_date: transfer.created_at || transfer.transfer_date || null, items: transfer.inventory_transfer_items || transfer.items || [], source: 'leaf_data' })}::jsonb)
        ON CONFLICT (company_id, metrc_id) DO UPDATE SET
          manifest_number = EXCLUDED.manifest_number,
          shipment_type_name = EXCLUDED.shipment_type_name,
          shipper_facility_license_number = EXCLUDED.shipper_facility_license_number,
          recipient_facility_license_number = EXCLUDED.recipient_facility_license_number,
          raw_data = EXCLUDED.raw_data
      `)
    }
  } catch (err: any) {
    results.transfers = { error: err.message }
    totalFailed++
  }

  // Sync plants (Leaf Data tracks plants for cultivators)
  try {
    const plantsResult = await leafDataRequest(config, '/plants')
    const plants = plantsResult.data || plantsResult.plants || plantsResult || []
    const plantList = Array.isArray(plants) ? plants : []
    results.plants = { count: plantList.length }
    totalSynced += plantList.length

    for (const plant of plantList) {
      await db.execute(sql`
        INSERT INTO plants (id, company_id,
          strain_name, room_id, phase, plant_date, notes, created_at, updated_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId},
          ${plant.strain || null},
          ${null},
          ${plant.stage || plant.growth_stage || 'vegetative'},
          ${plant.created_at || plant.planted_at || null},
          ${JSON.stringify({ external_id: plant.global_id || plant.plant_id || plant.id, is_mother: plant.is_mother || false, source: 'leaf_data' })},
          NOW(), NOW())
      `)
    }
  } catch (err: any) {
    results.plants = { error: err.message }
    totalFailed++
  }

  // Update last_sync_at
  await db.execute(sql`
    UPDATE leaf_data_config SET last_sync_at = NOW(), updated_at = NOW()
    WHERE company_id = ${currentUser.companyId}
  `)

  // Log sync
  const syncStatus = totalFailed > 0 ? (totalSynced > 0 ? 'partial' : 'failed') : 'success'
  await logSync(currentUser.companyId, 'full', syncStatus, totalSynced, totalFailed, totalFailed > 0 ? JSON.stringify(results) : null, startedAt)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'leaf_data_sync',
    entityName: 'Full Leaf Data Sync',
    metadata: { results, totalSynced, totalFailed },
    req: {
      user: currentUser,
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({ success: totalFailed === 0, results, totalSynced, totalFailed })
})

// GET /sync/log — Sync history (paginated)
app.get('/sync/log', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, sync_type, status, records_processed, records_created,
             error, started_at, completed_at
      FROM metrc_sync_log
      WHERE company_id = ${currentUser.companyId}
      ORDER BY started_at DESC
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

export default app
