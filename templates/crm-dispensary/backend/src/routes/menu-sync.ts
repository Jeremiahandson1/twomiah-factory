import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireRole('manager'))

// ─── Platform-Specific Formatters ────────────────────────────────────────────

function formatForWeedmaps(products: any[]) {
  return {
    products: products.map(p => ({
      name: p.name,
      category: p.category,
      strain_type: p.strain_type || p.strain || null,
      thc: p.thc_percent ? `${p.thc_percent}%` : null,
      cbd: p.cbd_percent ? `${p.cbd_percent}%` : null,
      price: Number(p.price),
      quantity: Number(p.stock_quantity) || 0,
      image: p.image_url || null,
      description: p.description || null,
      weight: p.weight ? `${p.weight}${p.weight_unit || 'g'}` : null,
      sku: p.sku || null,
    })),
  }
}

function formatForLeafly(products: any[]) {
  return {
    menu_items: products.map(p => ({
      product_name: p.name,
      product_category: p.category,
      strain_name: p.strain || null,
      strain_type: p.strain_type || null,
      thc_content: p.thc_percent || null,
      cbd_content: p.cbd_percent || null,
      retail_price: Number(p.price),
      available_quantity: Number(p.stock_quantity) || 0,
      photo_url: p.image_url || null,
      product_description: p.description || null,
      unit_weight: p.weight || null,
      unit_weight_measure: p.weight_unit || 'g',
      product_sku: p.sku || null,
    })),
  }
}

function formatForIHeartJane(products: any[]) {
  return {
    items: products.map(p => ({
      title: p.name,
      kind: p.category,
      brand: p.brand || null,
      strain: p.strain || null,
      lineage: p.strain_type || null,
      potency_thc: p.thc_percent || null,
      potency_cbd: p.cbd_percent || null,
      price_each: Number(p.price),
      amount_in_stock: Number(p.stock_quantity) || 0,
      image_url: p.image_url || null,
      body: p.description || null,
      weight_grams: p.weight_unit === 'oz' ? Number(p.weight) * 28.3495 : Number(p.weight || 0),
      sku: p.sku || null,
    })),
  }
}

function formatForDutchieMarketplace(products: any[]) {
  return {
    products: products.map(p => ({
      name: p.name,
      type: p.category,
      brandName: p.brand || null,
      strainType: p.strain_type || null,
      potencyThc: { formatted: p.thc_percent ? `${p.thc_percent}%` : null, range: [p.thc_percent || 0, p.thc_percent || 0] },
      potencyCbd: { formatted: p.cbd_percent ? `${p.cbd_percent}%` : null, range: [p.cbd_percent || 0, p.cbd_percent || 0] },
      prices: [{ price: Number(p.price), weight: p.weight || null }],
      inventory: Number(p.stock_quantity) || 0,
      image: p.image_url || null,
      description: p.description || null,
      sku: p.sku || null,
    })),
  }
}

const PLATFORM_FORMATTERS: Record<string, (products: any[]) => any> = {
  weedmaps: formatForWeedmaps,
  leafly: formatForLeafly,
  iheartjane: formatForIHeartJane,
  dutchie_marketplace: formatForDutchieMarketplace,
}

// ─── GET /configs ── List menu sync configs ──────────────────────────────────

app.get('/configs', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images,
           last_sync_at, last_sync_status, active, created_at, updated_at
    FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
  `)

  const data = (result as any).rows || result

  return c.json({ data })
})

// ─── POST /configs ── Create menu sync config ───────────────────────────────

const createConfigSchema = z.object({
  platform: z.enum(['weedmaps', 'leafly', 'iheartjane', 'dutchie_marketplace']),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
  storeId: z.string().min(1),
  autoSync: z.boolean().default(false),
  syncInventory: z.boolean().default(true),
  syncPrices: z.boolean().default(true),
  syncImages: z.boolean().default(true),
})

app.post('/configs', async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof createConfigSchema>
  try {
    data = createConfigSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Check for existing config for this platform
  const existingResult = await db.execute(sql`
    SELECT id FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId} AND platform = ${data.platform} AND active = true
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) {
    return c.json({ error: `Active config already exists for ${data.platform}. Update or deactivate it first.` }, 400)
  }

  const result = await db.execute(sql`
    INSERT INTO menu_sync_configs (id, platform, api_key, api_secret, store_id, auto_sync,
      sync_inventory, sync_prices, sync_images, active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.platform}, ${data.apiKey}, ${data.apiSecret || null},
      ${data.storeId}, ${data.autoSync}, ${data.syncInventory}, ${data.syncPrices},
      ${data.syncImages}, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images, active, created_at
  `)

  const config = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'menu_sync_config',
    entityId: config?.id,
    entityName: `${data.platform} Menu Sync`,
    metadata: { platform: data.platform, storeId: data.storeId, autoSync: data.autoSync },
    req: c.req,
  })

  return c.json(config, 201)
})

// ─── PUT /configs/:id ── Update config ───────────────────────────────────────

const updateConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().optional(),
  storeId: z.string().min(1).optional(),
  autoSync: z.boolean().optional(),
  syncInventory: z.boolean().optional(),
  syncPrices: z.boolean().optional(),
  syncImages: z.boolean().optional(),
})

app.put('/configs/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof updateConfigSchema>
  try {
    data = updateConfigSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE menu_sync_configs
    SET api_key = COALESCE(${data.apiKey || null}, api_key),
        api_secret = COALESCE(${data.apiSecret || null}, api_secret),
        store_id = COALESCE(${data.storeId || null}, store_id),
        auto_sync = COALESCE(${data.autoSync ?? null}, auto_sync),
        sync_inventory = COALESCE(${data.syncInventory ?? null}, sync_inventory),
        sync_prices = COALESCE(${data.syncPrices ?? null}, sync_prices),
        sync_images = COALESCE(${data.syncImages ?? null}, sync_images),
        updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND active = true
    RETURNING id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images, active, updated_at
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Config not found or inactive' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'menu_sync_config',
    entityId: id,
    entityName: `${updated.platform} Menu Sync`,
    metadata: { updatedFields: Object.keys(data) },
    req: c.req,
  })

  return c.json(updated)
})

// ─── DELETE /configs/:id ── Deactivate config ────────────────────────────────

app.delete('/configs/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE menu_sync_configs
    SET active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Config not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'menu_sync_config',
    entityId: id,
    entityName: `${updated.platform} Menu Sync`,
    req: c.req,
  })

  return c.json({ message: 'Config deactivated' })
})

// ─── POST /configs/:id/sync ── Trigger manual sync ──────────────────────────

app.post('/configs/:id/sync', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Fetch config
  const configResult = await db.execute(sql`
    SELECT * FROM menu_sync_configs
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND active = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Config not found or inactive' }, 404)

  // Fetch all active products
  const productsResult = await db.execute(sql`
    SELECT id, name, category, brand, strain, strain_type, description,
           price, stock_quantity, weight, weight_unit, sku, image_url,
           thc_percent, cbd_percent, active
    FROM products
    WHERE company_id = ${currentUser.companyId} AND active = true
    ORDER BY category, name
  `)
  const products = (productsResult as any).rows || productsResult

  // Format for the platform
  const formatter = PLATFORM_FORMATTERS[config.platform]
  if (!formatter) {
    return c.json({ error: `Unsupported platform: ${config.platform}` }, 400)
  }

  const payload = formatter(products)
  let syncStatus = 'success'
  let syncError: string | null = null
  let syncedCount = products.length

  // Attempt to push to the platform API
  // In production, this would make real API calls. For now, we log and simulate.
  try {
    // Platform API endpoints (placeholder URLs - real integration needs API agreements)
    const platformEndpoints: Record<string, string> = {
      weedmaps: `https://api-g.weedmaps.com/discovery/v2/listings/${config.store_id}/menu`,
      leafly: `https://api.leafly.com/v2/menus/${config.store_id}`,
      iheartjane: `https://api.iheartjane.com/v1/stores/${config.store_id}/products`,
      dutchie_marketplace: `https://plus.dutchie.com/api/v1/stores/${config.store_id}/menu`,
    }

    const endpoint = platformEndpoints[config.platform]
    if (endpoint && config.api_key) {
      // Real API call (will fail without valid credentials, which is expected)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key}`,
          ...(config.api_secret ? { 'X-API-Secret': config.api_secret } : {}),
        },
        body: JSON.stringify(payload),
      }).catch((err: any) => {
        // Network errors are expected in dev/staging
        syncStatus = 'failed'
        syncError = err.message || 'Network error'
        return null
      })

      if (response && !response.ok) {
        syncStatus = 'failed'
        syncError = `API returned ${response.status}: ${await response.text().catch(() => 'Unknown error')}`
      }
    }
  } catch (err: any) {
    syncStatus = 'failed'
    syncError = err.message || 'Sync failed'
  }

  // Update config with sync status
  await db.execute(sql`
    UPDATE menu_sync_configs
    SET last_sync_at = NOW(),
        last_sync_status = ${syncStatus},
        last_sync_error = ${syncError},
        last_sync_count = ${syncedCount},
        updated_at = NOW()
    WHERE id = ${id}
  `)

  // Log sync to audit_log
  await db.execute(sql`
    INSERT INTO audit_log (id, action, entity, entity_id, company_id, user_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'menu_sync', 'menu_sync_config', ${id}, ${currentUser.companyId}, ${currentUser.userId},
      ${JSON.stringify({ platform: config.platform, status: syncStatus, productsSynced: syncedCount, error: syncError, payloadPreview: { productCount: products.length, sample: payload.products?.[0] || payload.menu_items?.[0] || payload.items?.[0] } })}::jsonb,
      NOW())
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'menu_sync',
    entityId: id,
    entityName: `${config.platform} Menu Sync`,
    metadata: { platform: config.platform, productCount: syncedCount, status: syncStatus },
    req: c.req,
  })

  return c.json({
    status: syncStatus,
    productsSynced: syncedCount,
    error: syncError,
    platform: config.platform,
  })
})

// ─── POST /configs/:id/test ── Test connection ──────────────────────────────

app.post('/configs/:id/test', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const configResult = await db.execute(sql`
    SELECT * FROM menu_sync_configs
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND active = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Config not found or inactive' }, 404)

  try {
    const testEndpoints: Record<string, string> = {
      weedmaps: `https://api-g.weedmaps.com/discovery/v2/listings/${config.store_id}`,
      leafly: `https://api.leafly.com/v2/menus/${config.store_id}/info`,
      iheartjane: `https://api.iheartjane.com/v1/stores/${config.store_id}`,
      dutchie_marketplace: `https://plus.dutchie.com/api/v1/stores/${config.store_id}`,
    }

    const endpoint = testEndpoints[config.platform]
    if (!endpoint) {
      return c.json({ success: false, error: `Unknown platform: ${config.platform}` }, 400)
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        ...(config.api_secret ? { 'X-API-Secret': config.api_secret } : {}),
      },
    })

    if (response.ok) {
      return c.json({ success: true, message: 'Connection successful', status: response.status })
    } else {
      return c.json({ success: false, error: `API returned ${response.status}`, status: response.status }, 400)
    }
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Connection failed' }, 400)
  }
})

// ─── GET /sync-log ── Sync history ──────────────────────────────────────────

app.get('/sync-log', async (c) => {
  const currentUser = c.get('user') as any
  const configId = c.req.query('configId')
  const platform = c.req.query('platform')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let filters = sql``
  if (configId) filters = sql`${filters} AND entity_id = ${configId}`
  if (platform) filters = sql`${filters} AND metadata->>'platform' = ${platform}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, entity_id as config_id, metadata->>'platform' as platform,
             metadata->>'status' as status, (metadata->>'productsSynced')::int as products_synced,
             metadata->>'error' as error_message, metadata->'payloadPreview' as payload_preview,
             created_at
      FROM audit_log
      WHERE company_id = ${currentUser.companyId}
        AND action = 'menu_sync'
        ${filters}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM audit_log
      WHERE company_id = ${currentUser.companyId}
        AND action = 'menu_sync'
        ${filters}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export default app
