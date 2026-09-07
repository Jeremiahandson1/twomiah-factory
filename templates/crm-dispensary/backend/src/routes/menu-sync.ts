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

// Raw db.execute rows come back snake_case; the admin UI reads camelCase. Convert keys.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

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

// The MenuSync page identifies platforms by short slugs (weedmaps|leafly|jane|dutchie);
// the DB stores the full enum (…|iheartjane|dutchie_marketplace). Translate both ways.
const SLUG_TO_PLATFORM: Record<string, string> = {
  weedmaps: 'weedmaps', leafly: 'leafly',
  jane: 'iheartjane', iheartjane: 'iheartjane',
  dutchie: 'dutchie_marketplace', dutchie_marketplace: 'dutchie_marketplace',
}
const PLATFORM_TO_SLUG: Record<string, string> = {
  weedmaps: 'weedmaps', leafly: 'leafly', iheartjane: 'jane', dutchie_marketplace: 'dutchie',
}
const PLATFORM_NAMES: Record<string, string> = {
  weedmaps: 'Weedmaps', leafly: 'Leafly', iheartjane: 'Jane', dutchie_marketplace: 'Dutchie Marketplace',
}

// Push the company's active menu to a marketplace and record the result. Shared by the
// UUID-keyed POST /configs/:id/sync and the slug-keyed POST /:platformId/sync. Never throws;
// a missing API key returns { configured: false } so callers can answer gracefully.
async function performSync(config: any, currentUser: any, req: any) {
  if (!config.api_key) {
    return { configured: false, status: 'failed', productsSynced: 0, error: `${config.platform} API credentials not configured`, platform: config.platform }
  }

  const productsResult = await db.execute(sql`
    SELECT id, name, category, brand, strain, strain_type, description,
           price, stock_quantity, weight, weight_unit, sku, image_url,
           thc_percent, cbd_percent, active
    FROM products
    WHERE company_id = ${currentUser.companyId} AND active = true
    ORDER BY category, name
  `)
  const products = (productsResult as any).rows || productsResult

  const formatter = PLATFORM_FORMATTERS[config.platform]
  if (!formatter) {
    return { status: 'failed', productsSynced: 0, error: `Unsupported platform: ${config.platform}`, platform: config.platform }
  }

  const payload = formatter(products)
  let syncStatus = 'success'
  let syncError: string | null = null
  const syncedCount = products.length

  try {
    const platformEndpoints: Record<string, string> = {
      weedmaps: `https://api-g.weedmaps.com/discovery/v2/listings/${config.store_id}/menu`,
      leafly: `https://api.leafly.com/v2/menus/${config.store_id}`,
      iheartjane: `https://api.iheartjane.com/v1/stores/${config.store_id}/products`,
      dutchie_marketplace: `https://plus.dutchie.com/api/v1/stores/${config.store_id}/menu`,
    }

    const endpoint = platformEndpoints[config.platform]
    if (endpoint && config.api_key) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key}`,
          ...(config.api_secret ? { 'X-API-Secret': config.api_secret } : {}),
        },
        body: JSON.stringify(payload),
      }).catch((err: any) => {
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

  await db.execute(sql`
    UPDATE menu_sync_configs
    SET last_sync_at = NOW(), last_sync_status = ${syncStatus}, last_sync_error = ${syncError}, updated_at = NOW()
    WHERE id = ${config.id}
  `)

  await db.execute(sql`
    INSERT INTO audit_log (id, action, entity, entity_id, company_id, user_id, metadata, created_at)
    VALUES (gen_random_uuid(), 'menu_sync', 'menu_sync_config', ${config.id}, ${currentUser.companyId}, ${currentUser.userId},
      ${JSON.stringify({ platform: config.platform, status: syncStatus, productsSynced: syncedCount, error: syncError, payloadPreview: { productCount: products.length, sample: payload.products?.[0] || payload.menu_items?.[0] || payload.items?.[0] } })}::jsonb,
      NOW())
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'menu_sync',
    entityId: config.id,
    entityName: `${config.platform} Menu Sync`,
    metadata: { platform: config.platform, productCount: syncedCount, status: syncStatus },
    req,
  })

  return { status: syncStatus, productsSynced: syncedCount, error: syncError, platform: config.platform }
}

// ─── GET /configs ── List menu sync configs ──────────────────────────────────

app.get('/configs', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images,
           last_sync_at, last_sync_status, is_active, created_at, updated_at
    FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
  `)

  const data = ((result as any).rows || result).map(camel)

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
    WHERE company_id = ${currentUser.companyId} AND platform = ${data.platform} AND is_active = true
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) {
    return c.json({ error: `Active config already exists for ${data.platform}. Update or deactivate it first.` }, 400)
  }

  const result = await db.execute(sql`
    INSERT INTO menu_sync_configs (id, platform, api_key, api_secret, store_id, auto_sync,
      sync_inventory, sync_prices, sync_images, is_active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.platform}, ${data.apiKey}, ${data.apiSecret || null},
      ${data.storeId}, ${data.autoSync}, ${data.syncInventory}, ${data.syncPrices},
      ${data.syncImages}, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images, is_active, created_at
  `)

  const config = camel(((result as any).rows || result)?.[0])

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
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    RETURNING id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images, is_active, updated_at
  `)

  const updated = camel(((result as any).rows || result)?.[0])
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
    SET is_active = false, updated_at = NOW()
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
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Config not found or inactive' }, 404)

  const result = await performSync(config, currentUser, c.req)
  // No credentials on file → graceful not-configured result rather than an unauthenticated call.
  if ((result as any).configured === false) {
    return c.json({ configured: false, error: result.error, productsSynced: 0 }, 400)
  }
  return c.json(result)
})

// ─── POST /configs/:id/test ── Test connection ──────────────────────────────

app.post('/configs/:id/test', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const configResult = await db.execute(sql`
    SELECT * FROM menu_sync_configs
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Config not found or inactive' }, 404)

  if (!config.api_key) {
    return c.json({ success: false, configured: false, error: `${config.platform} API credentials not configured` }, 400)
  }

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

// ─── Slug-keyed adapter routes for the MenuSync page ─────────────────────────
// The page speaks platform slugs (weedmaps|leafly|jane|dutchie) and a { platformId, … }
// shape. These wrap the same menu_sync_configs table used by the /configs routes above.

// ─── GET /connections ── configs the page renders, keyed by slug ─────────────
app.get('/connections', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, platform, store_id, auto_sync, sync_inventory, sync_prices, sync_images,
           last_sync_at, last_sync_status, created_at, updated_at
    FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId} AND is_active = true
    ORDER BY created_at DESC
  `)
  const rows = (result as any).rows || result

  const data = rows.map((r: any) => ({
    id: r.id,
    platformId: PLATFORM_TO_SLUG[r.platform] || r.platform,
    platform: r.platform,
    storeId: r.store_id,
    autoSync: r.auto_sync,
    syncProducts: true,
    syncPricing: r.sync_prices,
    syncInventory: r.sync_inventory,
    syncImages: r.sync_images,
    lastSync: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
  }))

  return c.json({ data })
})

// ─── GET /logs ── sync history in the page's shape ───────────────────────────
app.get('/logs', async (c) => {
  const currentUser = c.get('user') as any
  const limit = +(c.req.query('limit') || '50')

  const result = await db.execute(sql`
    SELECT id, metadata->>'platform' as platform, metadata->>'status' as status,
           (metadata->>'productsSynced')::int as products_synced,
           metadata->>'error' as error_message, created_at
    FROM audit_log
    WHERE company_id = ${currentUser.companyId} AND action = 'menu_sync'
    ORDER BY created_at DESC
    LIMIT ${limit}
  `)
  const rows = (result as any).rows || result

  const data = rows.map((r: any) => ({
    id: r.id,
    platformId: PLATFORM_TO_SLUG[r.platform] || r.platform,
    platformName: PLATFORM_NAMES[r.platform] || r.platform,
    status: r.status,
    productsSynced: r.products_synced || 0,
    errors: r.error_message ? 1 : 0,
    duration: null,
    createdAt: r.created_at,
  }))

  return c.json({ data })
})

// ─── GET /:platformId/preview ── normalized menu preview ─────────────────────
app.get('/:platformId/preview', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, name, category, strain, thc_percent, cbd_percent, price, image_url, description,
           in_stock, stock_quantity
    FROM products
    WHERE company_id = ${currentUser.companyId} AND active = true
    ORDER BY category, name
    LIMIT 200
  `)
  const rows = (result as any).rows || result

  const data = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    strain: r.strain,
    thc: r.thc_percent,
    cbd: r.cbd_percent,
    price: r.price,
    imageUrl: r.image_url,
    description: r.description,
    inStock: r.in_stock !== false && (r.stock_quantity == null || Number(r.stock_quantity) > 0),
  }))

  return c.json({ data })
})

// ─── POST /:platformId/sync ── trigger a sync by slug ────────────────────────
app.post('/:platformId/sync', async (c) => {
  const currentUser = c.get('user') as any
  const platform = SLUG_TO_PLATFORM[c.req.param('platformId')] || c.req.param('platformId')

  const configResult = await db.execute(sql`
    SELECT * FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId} AND platform = ${platform} AND is_active = true
    ORDER BY created_at DESC LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Platform not connected' }, 404)

  const result = await performSync(config, currentUser, c.req)
  if ((result as any).configured === false) {
    return c.json({ configured: false, error: result.error, productsSynced: 0 }, 400)
  }
  return c.json(result)
})

// ─── POST /connections/:platformId ── connect / update by slug (upsert) ──────
const upsertConnSchema = z.object({
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  storeId: z.string().optional(),
  autoSync: z.boolean().optional(),
  syncProducts: z.boolean().optional(),
  syncPricing: z.boolean().optional(),
  syncInventory: z.boolean().optional(),
  syncImages: z.boolean().optional(),
})

app.post('/connections/:platformId', async (c) => {
  const currentUser = c.get('user') as any
  const slug = c.req.param('platformId')
  const platform = SLUG_TO_PLATFORM[slug]
  if (!platform) return c.json({ error: `Unknown platform: ${slug}` }, 400)

  let data: z.infer<typeof upsertConnSchema>
  try {
    data = upsertConnSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const existingRes = await db.execute(sql`
    SELECT id FROM menu_sync_configs
    WHERE company_id = ${currentUser.companyId} AND platform = ${platform} AND is_active = true
    LIMIT 1
  `)
  const existing = ((existingRes as any).rows || existingRes)?.[0]

  if (existing) {
    await db.execute(sql`
      UPDATE menu_sync_configs SET
        api_key = COALESCE(${data.apiKey ?? null}, api_key),
        api_secret = COALESCE(${data.apiSecret ?? null}, api_secret),
        store_id = COALESCE(${data.storeId ?? null}, store_id),
        auto_sync = COALESCE(${data.autoSync ?? null}, auto_sync),
        sync_inventory = COALESCE(${data.syncInventory ?? null}, sync_inventory),
        sync_prices = COALESCE(${data.syncPricing ?? null}, sync_prices),
        sync_images = COALESCE(${data.syncImages ?? null}, sync_images),
        updated_at = NOW()
      WHERE id = ${existing.id} AND company_id = ${currentUser.companyId}
    `)

    audit.log({
      action: audit.ACTIONS.UPDATE,
      entity: 'menu_sync_config',
      entityId: existing.id,
      entityName: `${platform} Menu Sync`,
      req: c.req,
    })

    return c.json({ id: existing.id, platformId: slug, message: 'Connection updated' })
  }

  const insertRes = await db.execute(sql`
    INSERT INTO menu_sync_configs (id, platform, api_key, api_secret, store_id, auto_sync,
      sync_inventory, sync_prices, sync_images, is_active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${platform}, ${data.apiKey || null}, ${data.apiSecret || null},
      ${data.storeId || null}, ${data.autoSync ?? false}, ${data.syncInventory ?? true},
      ${data.syncPricing ?? true}, ${data.syncImages ?? false}, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id
  `)
  const created = ((insertRes as any).rows || insertRes)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'menu_sync_config',
    entityId: created?.id,
    entityName: `${platform} Menu Sync`,
    metadata: { platform },
    req: c.req,
  })

  return c.json({ id: created?.id, platformId: slug, message: 'Connection created' }, 201)
})

// ─── DELETE /connections/:platformId ── disconnect by slug ───────────────────
app.delete('/connections/:platformId', async (c) => {
  const currentUser = c.get('user') as any
  const slug = c.req.param('platformId')
  const platform = SLUG_TO_PLATFORM[slug] || slug

  const result = await db.execute(sql`
    UPDATE menu_sync_configs SET is_active = false, updated_at = NOW()
    WHERE company_id = ${currentUser.companyId} AND platform = ${platform} AND is_active = true
    RETURNING id
  `)
  const row = ((result as any).rows || result)?.[0]
  if (!row) return c.json({ error: 'Connection not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'menu_sync_config',
    entityId: row.id,
    entityName: `${platform} Menu Sync`,
    req: c.req,
  })

  return c.json({ message: 'Disconnected' })
})

export default app
