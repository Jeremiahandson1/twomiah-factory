import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// All BioTrack endpoints require manager+
app.use('*', requireRole('manager'))

// ─── BioTrack API Service ───────────────────────────────────────────────────

interface BioTrackConfig {
  api_url: string
  username: string
  password: string
  license_number: string
  state: string
}

async function biotrackRequest(config: BioTrackConfig, action: string, additionalData: Record<string, any> = {}) {
  const payload = {
    API: 'BioTrackTHC',
    Action: action,
    License: config.license_number,
    Username: config.username,
    Password: config.password,
    ...additionalData,
  }

  const response = await fetch(config.api_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`BioTrack API error: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (result.Success === false || result.Error) {
    throw new Error(result.Error || 'BioTrack request failed')
  }

  return result
}

async function getConfig(companyId: string): Promise<BioTrackConfig | null> {
  const result = await db.execute(sql`
    SELECT api_url, username, password, license_number, state
    FROM biotrack_config
    WHERE company_id = ${companyId}
    LIMIT 1
  `)
  const rows = (result as any).rows || result
  return rows.length ? rows[0] : null
}

async function logSync(companyId: string, syncType: string, status: string, recordsSynced: number, recordsFailed: number, errorMessage: string | null, startedAt: Date) {
  await db.execute(sql`
    INSERT INTO metrc_sync_log (id, company_id, sync_type, status, records_synced, records_failed, error_message, started_at, completed_at, source, created_at)
    VALUES (gen_random_uuid(), ${companyId}, ${syncType}, ${status}, ${recordsSynced}, ${recordsFailed}, ${errorMessage}, ${startedAt.toISOString()}::timestamptz, NOW(), 'biotrack', NOW())
  `)
}

// ─── Config ─────────────────────────────────────────────────────────────────

// GET /config — Get BioTrack config
app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, api_url, username, license_number, state, auto_sync,
           sync_interval, last_sync_at, created_at, updated_at
    FROM biotrack_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const rows = (result as any).rows || result
  if (!rows.length) {
    return c.json({ config: null })
  }

  return c.json({ config: rows[0] })
})

// PUT /config — Update BioTrack config
const configSchema = z.object({
  apiUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  licenseNumber: z.string().min(1),
  state: z.string().min(2).max(2),
  autoSync: z.boolean().optional(),
  syncInterval: z.number().int().min(5).optional(),
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
    INSERT INTO biotrack_config (id, company_id, api_url, username, password, license_number, state,
      auto_sync, sync_interval, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.apiUrl}, ${data.username}, ${data.password},
      ${data.licenseNumber}, ${data.state},
      ${data.autoSync ?? false}, ${data.syncInterval ?? 60}, NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      api_url = EXCLUDED.api_url,
      username = EXCLUDED.username,
      password = EXCLUDED.password,
      license_number = EXCLUDED.license_number,
      state = EXCLUDED.state,
      auto_sync = EXCLUDED.auto_sync,
      sync_interval = EXCLUDED.sync_interval,
      updated_at = NOW()
    RETURNING *
  `)

  const rows = (result as any).rows || result

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'biotrack_config',
    entityName: 'BioTrack Configuration',
    metadata: { state: data.state, licenseNumber: data.licenseNumber, autoSync: data.autoSync },
    req: {
      user: currentUser,
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({ config: rows[0] })
})

// POST /config/test — Test BioTrack connection
app.post('/config/test', async (c) => {
  const currentUser = c.get('user') as any

  const config = await getConfig(currentUser.companyId)
  if (!config) {
    return c.json({ error: 'BioTrack not configured. Save your config first.' }, 400)
  }

  try {
    const result = await biotrackRequest(config, 'license_lookup')
    return c.json({ success: true, message: 'Connection successful', details: result })
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Connection failed' }, 400)
  }
})

// ─── Sync ───────────────────────────────────────────────────────────────────

// POST /sync — Full sync (inventory, sales, transfers)
app.post('/sync', async (c) => {
  const currentUser = c.get('user') as any

  const config = await getConfig(currentUser.companyId)
  if (!config) {
    return c.json({ error: 'BioTrack not configured' }, 400)
  }

  const startedAt = new Date()
  const results: Record<string, any> = {}
  let totalSynced = 0
  let totalFailed = 0

  // Sync inventory
  try {
    const invResult = await biotrackRequest(config, 'inventory_sync')
    const inventoryItems = invResult.Inventory || []
    results.inventory = { count: inventoryItems.length }
    totalSynced += inventoryItems.length

    // Upsert inventory items into metrc_packages with source='biotrack'
    for (const item of inventoryItems) {
      await db.execute(sql`
        INSERT INTO metrc_packages (id, company_id, external_id, label, product_name, quantity, unit_of_measure, room, strain, source, created_at, updated_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId}, ${item.Id || item.BarCode}, ${item.BarCode || null}, ${item.ProductName || null}, ${item.Quantity || 0}, ${item.UnitOfMeasure || null}, ${item.Room || null}, ${item.Strain || null}, 'biotrack', NOW(), NOW())
        ON CONFLICT (company_id, external_id) DO UPDATE SET
          label = EXCLUDED.label,
          product_name = EXCLUDED.product_name,
          quantity = EXCLUDED.quantity,
          unit_of_measure = EXCLUDED.unit_of_measure,
          room = EXCLUDED.room,
          strain = EXCLUDED.strain,
          updated_at = NOW()
      `)
    }
  } catch (err: any) {
    results.inventory = { error: err.message }
    totalFailed++
  }

  // Sync sales
  try {
    const salesResult = await biotrackRequest(config, 'sale_sync')
    const sales = salesResult.Sales || []
    results.sales = { count: sales.length }
    totalSynced += sales.length

    for (const sale of sales) {
      await db.execute(sql`
        INSERT INTO metrc_sale_receipts (id, company_id, external_id, sale_date, total, customer_type, items, source, created_at, updated_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId}, ${sale.TransactionId || sale.Id}, ${sale.SaleDate || null}, ${sale.TotalPrice || 0}, ${sale.CustomerType || null}, ${JSON.stringify(sale.Items || [])}::jsonb, 'biotrack', NOW(), NOW())
        ON CONFLICT (company_id, external_id) DO UPDATE SET
          sale_date = EXCLUDED.sale_date,
          total = EXCLUDED.total,
          customer_type = EXCLUDED.customer_type,
          items = EXCLUDED.items,
          updated_at = NOW()
      `)
    }
  } catch (err: any) {
    results.sales = { error: err.message }
    totalFailed++
  }

  // Sync transfers
  try {
    const transferResult = await biotrackRequest(config, 'transfer_sync')
    const transfers = transferResult.Transfers || []
    results.transfers = { count: transfers.length }
    totalSynced += transfers.length

    for (const transfer of transfers) {
      await db.execute(sql`
        INSERT INTO metrc_transfers (id, company_id, external_id, manifest_id, transfer_type, source_license, destination_license, status, transfer_date, items, source, created_at, updated_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId}, ${transfer.TransferId || transfer.Id}, ${transfer.ManifestId || null}, ${transfer.TransferType || null}, ${transfer.SourceLicense || null}, ${transfer.DestinationLicense || null}, ${transfer.Status || null}, ${transfer.TransferDate || null}, ${JSON.stringify(transfer.Items || [])}::jsonb, 'biotrack', NOW(), NOW())
        ON CONFLICT (company_id, external_id) DO UPDATE SET
          manifest_id = EXCLUDED.manifest_id,
          transfer_type = EXCLUDED.transfer_type,
          source_license = EXCLUDED.source_license,
          destination_license = EXCLUDED.destination_license,
          status = EXCLUDED.status,
          transfer_date = EXCLUDED.transfer_date,
          items = EXCLUDED.items,
          updated_at = NOW()
      `)
    }
  } catch (err: any) {
    results.transfers = { error: err.message }
    totalFailed++
  }

  // Update last_sync_at
  await db.execute(sql`
    UPDATE biotrack_config SET last_sync_at = NOW(), updated_at = NOW()
    WHERE company_id = ${currentUser.companyId}
  `)

  // Log sync
  const syncStatus = totalFailed > 0 ? (totalSynced > 0 ? 'partial' : 'failed') : 'success'
  await logSync(currentUser.companyId, 'full', syncStatus, totalSynced, totalFailed, totalFailed > 0 ? JSON.stringify(results) : null, startedAt)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'biotrack_sync',
    entityName: 'Full BioTrack Sync',
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
      SELECT id, sync_type, status, records_synced, records_failed,
             error_message, started_at, completed_at, created_at
      FROM metrc_sync_log
      WHERE company_id = ${currentUser.companyId}
        AND source = 'biotrack'
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM metrc_sync_log
      WHERE company_id = ${currentUser.companyId}
        AND source = 'biotrack'
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const countRows = (countResult as any).rows || countResult
  const total = countRows[0]?.total || 0

  return c.json({ data, total, page, limit })
})

export default app
