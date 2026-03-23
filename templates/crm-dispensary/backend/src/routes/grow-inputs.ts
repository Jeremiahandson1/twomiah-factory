import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ── Input Inventory ──────────────────────────────────────────────────────

// List grow inputs (paginated, filterable)
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const type = c.req.query('type')
  const category = c.req.query('category')
  const isOrganic = c.req.query('isOrganic')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  if (type) typeFilter = sql`AND gi.type = ${type}`

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND gi.category = ${category}`

  let organicFilter = sql``
  if (isOrganic !== undefined) organicFilter = sql`AND gi.is_organic = ${isOrganic === 'true'}`

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (gi.name ILIKE ${'%' + search + '%'} OR gi.brand ILIKE ${'%' + search + '%'})`

  const dataResult = await db.execute(sql`
    SELECT gi.*
    FROM grow_inputs gi
    WHERE gi.company_id = ${currentUser.companyId}
      ${typeFilter}
      ${categoryFilter}
      ${organicFilter}
      ${searchFilter}
    ORDER BY gi.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM grow_inputs gi
    WHERE gi.company_id = ${currentUser.companyId}
      ${typeFilter}
      ${categoryFilter}
      ${organicFilter}
      ${searchFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Inputs below min stock threshold
app.get('/low-stock', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT gi.*
    FROM grow_inputs gi
    WHERE gi.company_id = ${currentUser.companyId}
      AND gi.current_stock <= gi.min_stock
      AND gi.min_stock > 0
    ORDER BY (gi.current_stock::float / NULLIF(gi.min_stock, 0)::float) ASC
  `)

  return c.json((result as any).rows || result)
})

// Inputs expiring within N days
app.get('/expiring', async (c) => {
  const currentUser = c.get('user') as any
  const days = +(c.req.query('days') || '30')

  const result = await db.execute(sql`
    SELECT gi.*
    FROM grow_inputs gi
    WHERE gi.company_id = ${currentUser.companyId}
      AND gi.expiration_date IS NOT NULL
      AND gi.expiration_date <= NOW() + INTERVAL '1 day' * ${days}
      AND gi.expiration_date >= NOW()
    ORDER BY gi.expiration_date ASC
  `)

  return c.json((result as any).rows || result)
})

// Get input detail with application history
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const inputResult = await db.execute(sql`
    SELECT gi.*
    FROM grow_inputs gi
    WHERE gi.id = ${id} AND gi.company_id = ${currentUser.companyId}
  `)
  const input = ((inputResult as any).rows || inputResult)?.[0]
  if (!input) return c.json({ error: 'Grow input not found' }, 404)

  const applicationsResult = await db.execute(sql`
    SELECT ia.*,
           p.strain_name as plant_strain,
           b.batch_number
    FROM input_applications ia
    LEFT JOIN plants p ON p.id = ia.plant_id
    LEFT JOIN batches b ON b.id = ia.batch_id
    WHERE ia.grow_input_id = ${id}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
    LIMIT 20
  `)
  const applications = (applicationsResult as any).rows || applicationsResult

  return c.json({ ...input, applications })
})

// Create grow input (manager+)
app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const inputSchema = z.object({
    name: z.string().min(1),
    brand: z.string().optional(),
    type: z.enum(['fertilizer', 'pesticide', 'herbicide', 'fungicide', 'growth_regulator', 'soil_amendment', 'foliar_spray', 'beneficial_insect', 'other']),
    category: z.string().optional(),
    description: z.string().optional(),
    activeIngredients: z.array(z.string()).optional(),
    isOrganic: z.boolean().default(false),
    certifications: z.array(z.string()).optional(),
    epaRegistration: z.string().optional(),
    sdsUrl: z.string().optional(),
    manufacturer: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    currentStock: z.number().min(0).default(0),
    minStock: z.number().min(0).default(0),
    costPerUnit: z.number().min(0).optional(),
    expirationDate: z.string().optional(),
    storageRequirements: z.string().optional(),
    preHarvestInterval: z.number().int().min(0).optional(),
    reentryInterval: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  const data = inputSchema.parse(await c.req.json())

  // Check active ingredients against company's banned list
  let bannedWarnings: string[] = []
  if (data.activeIngredients && data.activeIngredients.length > 0) {
    const bannedResult = await db.execute(sql`
      SELECT banned_ingredients FROM input_policies
      WHERE company_id = ${currentUser.companyId}
        AND banned_ingredients IS NOT NULL
    `)
    const policies = (bannedResult as any).rows || bannedResult
    const allBanned = new Set<string>()
    for (const policy of policies) {
      const ingredients = Array.isArray(policy.banned_ingredients)
        ? policy.banned_ingredients
        : (typeof policy.banned_ingredients === 'string' ? JSON.parse(policy.banned_ingredients) : [])
      for (const b of ingredients) allBanned.add(String(b).toLowerCase())
    }
    for (const ingredient of data.activeIngredients) {
      if (allBanned.has(ingredient.toLowerCase())) {
        bannedWarnings.push(`Active ingredient "${ingredient}" is on the banned list`)
      }
    }
  }

  const result = await db.execute(sql`
    INSERT INTO grow_inputs(id, company_id, name, brand, type, category, description, active_ingredients, is_organic, certifications, epa_registration, sds_url, manufacturer, unit_of_measure, current_stock, min_stock, cost_per_unit, expiration_date, storage_requirements, pre_harvest_interval, reentry_interval, notes, flagged, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.brand || null}, ${data.type}, ${data.category || null}, ${data.description || null}, ${data.activeIngredients ? JSON.stringify(data.activeIngredients) : '[]'}::jsonb, ${data.isOrganic}, ${data.certifications ? JSON.stringify(data.certifications) : '[]'}::jsonb, ${data.epaRegistration || null}, ${data.sdsUrl || null}, ${data.manufacturer || null}, ${data.unitOfMeasure || null}, ${data.currentStock}, ${data.minStock}, ${data.costPerUnit || null}, ${data.expirationDate || null}, ${data.storageRequirements || null}, ${data.preHarvestInterval || null}, ${data.reentryInterval || null}, ${data.notes || null}, ${bannedWarnings.length > 0}, NOW(), NOW())
    RETURNING *
  `)

  const input = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'grow_input',
    entityId: input?.id,
    entityName: data.name,
    metadata: bannedWarnings.length > 0 ? { bannedWarnings } : undefined,
    req: c.req,
  })

  return c.json({ ...input, warnings: bannedWarnings.length > 0 ? bannedWarnings : undefined }, 201)
})

// Update grow input
app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const inputSchema = z.object({
    name: z.string().min(1).optional(),
    brand: z.string().optional(),
    type: z.enum(['fertilizer', 'pesticide', 'herbicide', 'fungicide', 'growth_regulator', 'soil_amendment', 'foliar_spray', 'beneficial_insect', 'other']).optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    activeIngredients: z.array(z.string()).optional(),
    isOrganic: z.boolean().optional(),
    certifications: z.array(z.string()).optional(),
    epaRegistration: z.string().optional(),
    sdsUrl: z.string().optional(),
    manufacturer: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    minStock: z.number().min(0).optional(),
    costPerUnit: z.number().min(0).optional(),
    expirationDate: z.string().optional(),
    storageRequirements: z.string().optional(),
    preHarvestInterval: z.number().int().min(0).optional(),
    reentryInterval: z.number().int().min(0).optional(),
    notes: z.string().optional(),
  })
  const data = inputSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.brand !== undefined) sets.push(sql`brand = ${data.brand}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.category !== undefined) sets.push(sql`category = ${data.category}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.activeIngredients !== undefined) sets.push(sql`active_ingredients = ${JSON.stringify(data.activeIngredients)}::jsonb`)
  if (data.isOrganic !== undefined) sets.push(sql`is_organic = ${data.isOrganic}`)
  if (data.certifications !== undefined) sets.push(sql`certifications = ${JSON.stringify(data.certifications)}::jsonb`)
  if (data.epaRegistration !== undefined) sets.push(sql`epa_registration = ${data.epaRegistration}`)
  if (data.sdsUrl !== undefined) sets.push(sql`sds_url = ${data.sdsUrl}`)
  if (data.manufacturer !== undefined) sets.push(sql`manufacturer = ${data.manufacturer}`)
  if (data.unitOfMeasure !== undefined) sets.push(sql`unit_of_measure = ${data.unitOfMeasure}`)
  if (data.minStock !== undefined) sets.push(sql`min_stock = ${data.minStock}`)
  if (data.costPerUnit !== undefined) sets.push(sql`cost_per_unit = ${data.costPerUnit}`)
  if (data.expirationDate !== undefined) sets.push(sql`expiration_date = ${data.expirationDate}`)
  if (data.storageRequirements !== undefined) sets.push(sql`storage_requirements = ${data.storageRequirements}`)
  if (data.preHarvestInterval !== undefined) sets.push(sql`pre_harvest_interval = ${data.preHarvestInterval}`)
  if (data.reentryInterval !== undefined) sets.push(sql`reentry_interval = ${data.reentryInterval}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE grow_inputs SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Grow input not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'grow_input',
    entityId: id,
    entityName: updated.name,
    req: c.req,
  })

  return c.json(updated)
})

// Adjust stock
app.post('/:id/adjust-stock', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const adjustSchema = z.object({
    quantity: z.number(),
    reason: z.string().min(1),
  })
  const data = adjustSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM grow_inputs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Grow input not found' }, 404)

  const oldStock = Number(existing.current_stock)
  const newStock = oldStock + data.quantity
  if (newStock < 0) return c.json({ error: 'Stock cannot go below zero' }, 400)

  const result = await db.execute(sql`
    UPDATE grow_inputs SET current_stock = ${newStock}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'grow_input',
    entityId: id,
    entityName: existing.name,
    changes: { currentStock: { old: oldStock, new: newStock } },
    metadata: { type: 'stock_adjustment', adjustment: data.quantity, reason: data.reason },
    req: c.req,
  })

  return c.json(updated)
})

// ── Application Logging ──────────────────────────────────────────────────

// List input applications (paginated, filterable)
app.get('/applications', async (c) => {
  const currentUser = c.get('user') as any
  const growInputId = c.req.query('growInputId')
  const plantId = c.req.query('plantId')
  const batchId = c.req.query('batchId')
  const roomId = c.req.query('roomId')
  const growPhase = c.req.query('growPhase')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let inputFilter = sql``
  if (growInputId) inputFilter = sql`AND ia.grow_input_id = ${growInputId}`

  let plantFilter = sql``
  if (plantId) plantFilter = sql`AND ia.plant_id = ${plantId}`

  let batchFilter = sql``
  if (batchId) batchFilter = sql`AND ia.batch_id = ${batchId}`

  let roomFilter = sql``
  if (roomId) roomFilter = sql`AND ia.room_id = ${roomId}`

  let phaseFilter = sql``
  if (growPhase) phaseFilter = sql`AND ia.grow_phase = ${growPhase}`

  let dateStartFilter = sql``
  if (startDate) dateStartFilter = sql`AND ia.created_at >= ${startDate}::timestamp`

  let dateEndFilter = sql``
  if (endDate) dateEndFilter = sql`AND ia.created_at <= ${endDate}::timestamp + INTERVAL '1 day'`

  const dataResult = await db.execute(sql`
    SELECT ia.*,
           gi.name as input_name, gi.brand as input_brand, gi.type as input_type,
           p.strain_name as plant_strain,
           b.batch_number
    FROM input_applications ia
    LEFT JOIN grow_inputs gi ON gi.id = ia.grow_input_id
    LEFT JOIN plants p ON p.id = ia.plant_id
    LEFT JOIN batches b ON b.id = ia.batch_id
    WHERE ia.company_id = ${currentUser.companyId}
      ${inputFilter}
      ${plantFilter}
      ${batchFilter}
      ${roomFilter}
      ${phaseFilter}
      ${dateStartFilter}
      ${dateEndFilter}
    ORDER BY ia.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM input_applications ia
    WHERE ia.company_id = ${currentUser.companyId}
      ${inputFilter}
      ${plantFilter}
      ${batchFilter}
      ${roomFilter}
      ${phaseFilter}
      ${dateStartFilter}
      ${dateEndFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Log an input application
app.post('/applications', async (c) => {
  const currentUser = c.get('user') as any

  const applicationSchema = z.object({
    growInputId: z.string().min(1),
    plantId: z.string().optional(),
    batchId: z.string().optional(),
    roomId: z.string().optional(),
    quantity: z.number().min(0),
    unitOfMeasure: z.string().optional(),
    dilutionRatio: z.string().optional(),
    applicationMethod: z.string().optional(),
    targetArea: z.string().optional(),
    growPhase: z.enum(['clone', 'seedling', 'vegetative', 'flowering', 'drying', 'curing']).optional(),
    reason: z.string().optional(),
    preHarvestInterval: z.number().int().min(0).optional(),
    notes: z.string().optional(),
    overridePolicyViolation: z.boolean().default(false),
  })
  const data = applicationSchema.parse(await c.req.json())

  // At least one target required
  if (!data.plantId && !data.batchId && !data.roomId) {
    return c.json({ error: 'At least one of plantId, batchId, or roomId is required' }, 400)
  }

  // Get the input
  const inputResult = await db.execute(sql`
    SELECT * FROM grow_inputs
    WHERE id = ${data.growInputId} AND company_id = ${currentUser.companyId}
  `)
  const input = ((inputResult as any).rows || inputResult)?.[0]
  if (!input) return c.json({ error: 'Grow input not found' }, 404)

  // Policy compliance check
  const warnings: string[] = []
  const inputIngredients: string[] = Array.isArray(input.active_ingredients) ? input.active_ingredients : []

  // Check banned ingredients
  const policiesResult = await db.execute(sql`
    SELECT * FROM input_policies
    WHERE company_id = ${currentUser.companyId}
  `)
  const policies = (policiesResult as any).rows || policiesResult

  for (const policy of policies) {
    const banned = Array.isArray(policy.banned_ingredients)
      ? policy.banned_ingredients
      : (typeof policy.banned_ingredients === 'string' ? JSON.parse(policy.banned_ingredients) : [])
    for (const ingredient of inputIngredients) {
      if (banned.map((b: string) => b.toLowerCase()).includes(ingredient.toLowerCase())) {
        warnings.push(`Policy "${policy.name}": ingredient "${ingredient}" is banned`)
      }
    }

    // Check organic-only rules
    const rules = Array.isArray(policy.rules)
      ? policy.rules
      : (typeof policy.rules === 'string' ? JSON.parse(policy.rules) : [])
    for (const rule of rules) {
      if (rule.type === 'organic_only' && !input.is_organic) {
        warnings.push(`Policy "${policy.name}": only organic inputs allowed — "${input.name}" is not organic`)
      }
    }
  }

  // If warnings exist and no override, return warnings but don't block
  if (warnings.length > 0 && !data.overridePolicyViolation) {
    return c.json({
      error: 'Policy violations detected',
      warnings,
      requiresOverride: true,
    }, 422)
  }

  // Check sufficient stock
  const currentStock = Number(input.current_stock)
  if (data.quantity > currentStock) {
    return c.json({ error: `Insufficient stock. Available: ${currentStock}, requested: ${data.quantity}` }, 400)
  }

  // Decrement stock
  await db.execute(sql`
    UPDATE grow_inputs SET current_stock = current_stock - ${data.quantity}, updated_at = NOW()
    WHERE id = ${data.growInputId}
  `)

  // Create application record
  const result = await db.execute(sql`
    INSERT INTO input_applications(id, company_id, grow_input_id, plant_id, batch_id, room_id, quantity, unit_of_measure, dilution_ratio, application_method, target_area, grow_phase, reason, pre_harvest_interval, notes, policy_warnings, applied_by, created_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.growInputId}, ${data.plantId || null}, ${data.batchId || null}, ${data.roomId || null}, ${data.quantity}, ${data.unitOfMeasure || input.unit_of_measure || null}, ${data.dilutionRatio || null}, ${data.applicationMethod || null}, ${data.targetArea || null}, ${data.growPhase || null}, ${data.reason || null}, ${data.preHarvestInterval || input.pre_harvest_interval || null}, ${data.notes || null}, ${warnings.length > 0 ? JSON.stringify(warnings) : null}::jsonb, ${currentUser.id}, NOW())
    RETURNING *
  `)

  const application = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'input_application',
    entityId: application?.id,
    entityName: `${input.name} → ${data.plantId || data.batchId || data.roomId}`,
    metadata: {
      growInputId: data.growInputId,
      quantity: data.quantity,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
    req: c.req,
  })

  return c.json({ ...application, warnings: warnings.length > 0 ? warnings : undefined }, 201)
})

// Full input history for a plant
app.get('/applications/by-plant/:plantId', async (c) => {
  const currentUser = c.get('user') as any
  const plantId = c.req.param('plantId')

  const result = await db.execute(sql`
    SELECT ia.*,
           gi.name as input_name, gi.brand as input_brand, gi.type as input_type,
           gi.is_organic as input_organic, gi.active_ingredients as input_active_ingredients
    FROM input_applications ia
    JOIN grow_inputs gi ON gi.id = ia.grow_input_id
    WHERE ia.plant_id = ${plantId}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Full input history for a batch
app.get('/applications/by-batch/:batchId', async (c) => {
  const currentUser = c.get('user') as any
  const batchId = c.req.param('batchId')

  const result = await db.execute(sql`
    SELECT ia.*,
           gi.name as input_name, gi.brand as input_brand, gi.type as input_type,
           gi.is_organic as input_organic, gi.active_ingredients as input_active_ingredients
    FROM input_applications ia
    JOIN grow_inputs gi ON gi.id = ia.grow_input_id
    WHERE ia.batch_id = ${batchId}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Full traceability chain for a product (product -> batch -> plant applications + batch applications)
app.get('/applications/by-product/:productId', async (c) => {
  const currentUser = c.get('user') as any
  const productId = c.req.param('productId')

  // Get batches linked to this product
  const batchResult = await db.execute(sql`
    SELECT b.id, b.batch_number FROM batches b
    WHERE b.product_id = ${productId}
      AND b.company_id = ${currentUser.companyId}
  `)
  const batches = (batchResult as any).rows || batchResult

  if (batches.length === 0) {
    return c.json({ productId, batches: [], applications: [] })
  }

  const batchIds = batches.map((b: any) => b.id)

  // Get all applications for these batches (direct batch applications)
  const batchAppsResult = await db.execute(sql`
    SELECT ia.*,
           gi.name as input_name, gi.brand as input_brand, gi.type as input_type,
           gi.is_organic as input_organic, gi.active_ingredients as input_active_ingredients,
           'batch' as application_source
    FROM input_applications ia
    JOIN grow_inputs gi ON gi.id = ia.grow_input_id
    WHERE ia.batch_id = ANY(${batchIds}::text[])
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
  `)
  const batchApps = (batchAppsResult as any).rows || batchAppsResult

  // Get all plant applications for plants linked to these batches via harvest
  const plantAppsResult = await db.execute(sql`
    SELECT ia.*,
           gi.name as input_name, gi.brand as input_brand, gi.type as input_type,
           gi.is_organic as input_organic, gi.active_ingredients as input_active_ingredients,
           'plant' as application_source
    FROM input_applications ia
    JOIN grow_inputs gi ON gi.id = ia.grow_input_id
    JOIN plants p ON p.id = ia.plant_id
    JOIN harvests h ON h.id = p.harvest_id
    JOIN batches b ON b.id = h.batch_id OR b.harvest_id = h.id
    WHERE b.product_id = ${productId}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
  `)
  const plantApps = (plantAppsResult as any).rows || plantAppsResult

  return c.json({
    productId,
    batches,
    applications: [...plantApps, ...batchApps],
  })
})

// ── Input Policies ───────────────────────────────────────────────────────

// List input policies
app.get('/policies', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM input_policies
    WHERE company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Create input policy (manager+)
app.post('/policies', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const policySchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    rules: z.array(z.object({
      type: z.string().min(1),
      description: z.string().optional(),
      value: z.any().optional(),
    })).optional(),
    bannedIngredients: z.array(z.string()).optional(),
    requiredCertifications: z.array(z.string()).optional(),
  })
  const data = policySchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO input_policies(id, company_id, name, description, rules, banned_ingredients, required_certifications, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.description || null}, ${data.rules ? JSON.stringify(data.rules) : '[]'}::jsonb, ${data.bannedIngredients ? JSON.stringify(data.bannedIngredients) : '[]'}::jsonb, ${data.requiredCertifications ? JSON.stringify(data.requiredCertifications) : '[]'}::jsonb, NOW(), NOW())
    RETURNING *
  `)

  const policy = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'input_policy',
    entityId: policy?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(policy, 201)
})

// Update input policy (manager+)
app.put('/policies/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const policySchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    rules: z.array(z.object({
      type: z.string().min(1),
      description: z.string().optional(),
      value: z.any().optional(),
    })).optional(),
    bannedIngredients: z.array(z.string()).optional(),
    requiredCertifications: z.array(z.string()).optional(),
  })
  const data = policySchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.rules !== undefined) sets.push(sql`rules = ${JSON.stringify(data.rules)}::jsonb`)
  if (data.bannedIngredients !== undefined) sets.push(sql`banned_ingredients = ${JSON.stringify(data.bannedIngredients)}::jsonb`)
  if (data.requiredCertifications !== undefined) sets.push(sql`required_certifications = ${JSON.stringify(data.requiredCertifications)}::jsonb`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE input_policies SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Policy not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'input_policy',
    entityId: id,
    entityName: updated.name,
    req: c.req,
  })

  return c.json(updated)
})

// Check an input against all policies
app.post('/policies/check', async (c) => {
  const currentUser = c.get('user') as any

  const checkSchema = z.object({
    growInputId: z.string().min(1),
  })
  const data = checkSchema.parse(await c.req.json())

  // Get input
  const inputResult = await db.execute(sql`
    SELECT * FROM grow_inputs
    WHERE id = ${data.growInputId} AND company_id = ${currentUser.companyId}
  `)
  const input = ((inputResult as any).rows || inputResult)?.[0]
  if (!input) return c.json({ error: 'Grow input not found' }, 404)

  // Get all policies
  const policiesResult = await db.execute(sql`
    SELECT * FROM input_policies
    WHERE company_id = ${currentUser.companyId}
  `)
  const policies = (policiesResult as any).rows || policiesResult

  const violations: { rule: string; description: string }[] = []
  const inputIngredients: string[] = Array.isArray(input.active_ingredients) ? input.active_ingredients : []

  for (const policy of policies) {
    // Check banned ingredients
    const banned = Array.isArray(policy.banned_ingredients)
      ? policy.banned_ingredients
      : (typeof policy.banned_ingredients === 'string' ? JSON.parse(policy.banned_ingredients) : [])
    for (const ingredient of inputIngredients) {
      if (banned.map((b: string) => b.toLowerCase()).includes(ingredient.toLowerCase())) {
        violations.push({
          rule: `${policy.name}: Banned Ingredient`,
          description: `Active ingredient "${ingredient}" is on the banned list`,
        })
      }
    }

    // Check rules
    const rules = Array.isArray(policy.rules)
      ? policy.rules
      : (typeof policy.rules === 'string' ? JSON.parse(policy.rules) : [])
    for (const rule of rules) {
      if (rule.type === 'organic_only' && !input.is_organic) {
        violations.push({
          rule: `${policy.name}: Organic Only`,
          description: `Input "${input.name}" is not organic`,
        })
      }
      if (rule.type === 'required_certification') {
        const inputCerts: string[] = Array.isArray(input.certifications) ? input.certifications : []
        if (!inputCerts.includes(rule.value)) {
          violations.push({
            rule: `${policy.name}: Required Certification`,
            description: `Input "${input.name}" lacks required certification: ${rule.value}`,
          })
        }
      }
    }

    // Check required certifications from policy
    const requiredCerts = Array.isArray(policy.required_certifications)
      ? policy.required_certifications
      : (typeof policy.required_certifications === 'string' ? JSON.parse(policy.required_certifications) : [])
    const inputCerts: string[] = Array.isArray(input.certifications) ? input.certifications : []
    for (const cert of requiredCerts) {
      if (!inputCerts.map((c: string) => c.toLowerCase()).includes(cert.toLowerCase())) {
        violations.push({
          rule: `${policy.name}: Required Certification`,
          description: `Input "${input.name}" lacks required certification: ${cert}`,
        })
      }
    }
  }

  return c.json({
    compliant: violations.length === 0,
    violations,
  })
})

export default app
