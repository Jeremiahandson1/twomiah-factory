import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ===== PUBLIC ROUTES (no auth — device endpoints) =====

// POST /screens/:id/heartbeat — Device heartbeat (uses deviceId, no auth)
app.post('/screens/:id/heartbeat', async (c) => {
  const id = c.req.param('id')

  const heartbeatSchema = z.object({
    deviceId: z.string().min(1),
    status: z.string().optional(),
    ipAddress: z.string().optional(),
  })
  const data = heartbeatSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE digital_signs
    SET last_heartbeat = NOW(), is_online = true,
        device_status = ${data.status || 'ok'},
        device_ip = ${data.ipAddress || null},
        updated_at = NOW()
    WHERE id = ${id} AND device_id = ${data.deviceId}
    RETURNING id
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Screen not found or device ID mismatch' }, 404)

  return c.json({ success: true, serverTime: new Date().toISOString() })
})

// GET /screens/:id/content — Public content endpoint (by deviceId)
app.get('/screens/:id/content', async (c) => {
  const id = c.req.param('id')
  const deviceId = c.req.query('deviceId')
  if (!deviceId) return c.json({ error: 'deviceId query param required' }, 400)

  const screenResult = await db.execute(sql`
    SELECT ds.*, c.name as company_name, c.logo as company_logo, c.primary_color
    FROM digital_signs ds
    JOIN company c ON c.id = ds.company_id
    WHERE ds.id = ${id} AND ds.device_id = ${deviceId} AND ds.is_active = true
    LIMIT 1
  `)
  const screen = ((screenResult as any).rows || screenResult)?.[0]
  if (!screen) return c.json({ error: 'Screen not found' }, 404)

  const companyId = screen.company_id
  let content: any = {}

  switch (screen.type) {
    case 'menu_board': {
      const productsResult = await db.execute(sql`
        SELECT id, name, category, brand, strain, strain_type, thc_percent, cbd_percent,
               price, weight, weight_unit, image_url, stock_quantity, track_inventory, active
        FROM products
        WHERE company_id = ${companyId} AND active = true AND visible = true
        ORDER BY category ASC, menu_order ASC, name ASC
      `)
      const products = (productsResult as any).rows || productsResult

      // Group by category
      const categories: Record<string, any[]> = {}
      for (const p of products) {
        const cat = p.category || 'other'
        if (!categories[cat]) categories[cat] = []
        categories[cat].push({
          ...p,
          inStock: p.track_inventory ? Number(p.stock_quantity) > 0 : true,
        })
      }

      content = { type: 'menu_board', categories, totalProducts: products.length }
      break
    }
    case 'promo': {
      // Return active promotions from loyalty_rewards
      const promosResult = await db.execute(sql`
        SELECT id, name, description, discount_type, discount_value, image_url, start_date, end_date
        FROM loyalty_rewards
        WHERE company_id = ${companyId}
          AND active = true
          AND (start_date IS NULL OR start_date <= NOW())
          AND (end_date IS NULL OR end_date >= NOW())
        ORDER BY created_at DESC
      `)
      content = { type: 'promo', promotions: (promosResult as any).rows || promosResult }
      break
    }
    case 'wait_time': {
      // Current queue length and estimated wait
      const queueResult = await db.execute(sql`
        SELECT COUNT(*)::int as queue_length
        FROM orders
        WHERE company_id = ${companyId}
          AND status IN ('pending', 'processing', 'ready')
          AND created_at >= NOW() - INTERVAL '4 hours'
      `)
      const queueLength = Number(((queueResult as any).rows || queueResult)?.[0]?.queue_length || 0)
      const estimatedWaitMinutes = queueLength * 3 // ~3 minutes per customer

      content = { type: 'wait_time', queueLength, estimatedWaitMinutes }
      break
    }
    case 'welcome': {
      content = {
        type: 'welcome',
        companyName: screen.company_name,
        logo: screen.company_logo,
        primaryColor: screen.primary_color,
        message: screen.welcome_message || `Welcome to ${screen.company_name}`,
      }
      break
    }
    default:
      content = { type: screen.type, customContent: screen.content }
  }

  return c.json({
    screenId: screen.id,
    screenName: screen.name,
    orientation: screen.orientation,
    resolution: screen.resolution,
    refreshInterval: screen.refresh_interval,
    content,
    company: { name: screen.company_name, logo: screen.company_logo, primaryColor: screen.primary_color },
  })
})

// ===== AUTHENTICATED ROUTES =====
app.use('*', authenticate)

// GET /screens — List digital signs
app.get('/screens', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')

  let locationClause = sql``
  if (locationId) locationClause = sql`AND ds.location_id = ${locationId}`

  const result = await db.execute(sql`
    SELECT ds.*, l.name as location_name
    FROM digital_signs ds
    LEFT JOIN locations l ON l.id = ds.location_id
    WHERE ds.company_id = ${currentUser.companyId} ${locationClause}
    ORDER BY ds.name ASC
  `)

  return c.json((result as any).rows || result)
})

// POST /screens — Create sign (manager+)
app.post('/screens', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const screenSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['menu_board', 'promo', 'wait_time', 'welcome', 'custom']),
    locationId: z.string().optional(),
    deviceId: z.string().min(1),
    resolution: z.string().optional(),
    orientation: z.enum(['landscape', 'portrait']).default('landscape'),
    refreshInterval: z.number().int().min(5).default(60), // seconds
  })
  const data = screenSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO digital_signs(id, name, type, location_id, device_id, resolution, orientation, refresh_interval, is_active, is_online, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.type}, ${data.locationId || null}, ${data.deviceId}, ${data.resolution || null}, ${data.orientation}, ${data.refreshInterval}, true, false, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const created = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'digital_sign',
    entityId: created?.id,
    entityName: data.name,
    metadata: { type: data.type, deviceId: data.deviceId },
    req: c.req,
  })

  return c.json(created, 201)
})

// PUT /screens/:id — Update sign config
app.put('/screens/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['menu_board', 'promo', 'wait_time', 'welcome', 'custom']).optional(),
    locationId: z.string().optional(),
    deviceId: z.string().optional(),
    resolution: z.string().optional(),
    orientation: z.enum(['landscape', 'portrait']).optional(),
    refreshInterval: z.number().int().min(5).optional(),
    welcomeMessage: z.string().optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.deviceId !== undefined) sets.push(sql`device_id = ${data.deviceId}`)
  if (data.resolution !== undefined) sets.push(sql`resolution = ${data.resolution}`)
  if (data.orientation !== undefined) sets.push(sql`orientation = ${data.orientation}`)
  if (data.refreshInterval !== undefined) sets.push(sql`refresh_interval = ${data.refreshInterval}`)
  if (data.welcomeMessage !== undefined) sets.push(sql`welcome_message = ${data.welcomeMessage}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE digital_signs SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Screen not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'digital_sign',
    entityId: id,
    entityName: updated.name,
    metadata: { fields: Object.keys(data) },
    req: c.req,
  })

  return c.json(updated)
})

// DELETE /screens/:id — Deactivate sign
app.delete('/screens/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE digital_signs SET is_active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, name
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Screen not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'digital_sign',
    entityId: id,
    entityName: updated.name,
    metadata: { type: 'deactivate' },
    req: c.req,
  })

  return c.json({ success: true, deactivated: updated.name })
})

// PUT /screens/:id/content — Update sign content/playlist (manager+)
app.put('/screens/:id/content', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const contentSchema = z.object({
    content: z.any(), // JSON content blob — structure depends on screen type
    playlist: z.array(z.object({
      type: z.string(),
      data: z.any(),
      duration: z.number().int().min(1).optional(), // seconds to display
    })).optional(),
    welcomeMessage: z.string().optional(),
  })
  const data = contentSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.content !== undefined) sets.push(sql`content = ${JSON.stringify(data.content)}::jsonb`)
  if (data.playlist !== undefined) sets.push(sql`playlist = ${JSON.stringify(data.playlist)}::jsonb`)
  if (data.welcomeMessage !== undefined) sets.push(sql`welcome_message = ${data.welcomeMessage}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE digital_signs SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Screen not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'digital_sign',
    entityId: id,
    entityName: updated.name,
    metadata: { type: 'content_update' },
    req: c.req,
  })

  return c.json(updated)
})

// GET /screens/:id/menu-data — Live menu data for menu boards
app.get('/screens/:id/menu-data', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Verify screen belongs to company
  const screenResult = await db.execute(sql`
    SELECT id, type, location_id FROM digital_signs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const screen = ((screenResult as any).rows || screenResult)?.[0]
  if (!screen) return c.json({ error: 'Screen not found' }, 404)

  // Fetch products with realtime stock
  const productsResult = await db.execute(sql`
    SELECT id, name, category, brand, strain, strain_type, thc_percent, cbd_percent,
           price, weight, weight_unit, image_url, stock_quantity, track_inventory,
           tags, menu_order
    FROM products
    WHERE company_id = ${currentUser.companyId} AND active = true AND visible = true
    ORDER BY category ASC, menu_order ASC, name ASC
  `)
  const products = (productsResult as any).rows || productsResult

  // Group by category with stock status
  const categoryOrder = ['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture', 'topical', 'accessory', 'apparel', 'other']
  const categoryLabels: Record<string, string> = {
    flower: 'Flower', pre_roll: 'Pre-Rolls', edible: 'Edibles', concentrate: 'Concentrates',
    vape: 'Vape', tincture: 'Tinctures', topical: 'Topicals', accessory: 'Accessories',
    apparel: 'Apparel', other: 'Other',
  }

  const grouped: Record<string, any[]> = {}
  for (const p of products) {
    const cat = p.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({
      id: p.id,
      name: p.name,
      brand: p.brand,
      strain: p.strain,
      strainType: p.strain_type,
      thcPercent: p.thc_percent,
      cbdPercent: p.cbd_percent,
      price: p.price,
      weight: p.weight,
      weightUnit: p.weight_unit,
      imageUrl: p.image_url,
      inStock: p.track_inventory ? Number(p.stock_quantity) > 0 : true,
      stockQuantity: Number(p.stock_quantity),
      tags: p.tags,
    })
  }

  const menu = categoryOrder
    .filter(cat => grouped[cat]?.length > 0)
    .map(cat => ({
      key: cat,
      label: categoryLabels[cat] || cat,
      products: grouped[cat],
    }))

  return c.json({ screenId: id, menu, totalProducts: products.length, updatedAt: new Date().toISOString() })
})

export default app
