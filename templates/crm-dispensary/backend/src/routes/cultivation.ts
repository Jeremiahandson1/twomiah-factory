import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ── Plants ─────────────────────────────────────────────────────────────

// List plants (paginated, filterable)
app.get('/plants', async (c) => {
  const currentUser = c.get('user') as any
  const phase = c.req.query('phase')
  const strain = c.req.query('strain')
  const roomId = c.req.query('roomId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let phaseFilter = sql``
  if (phase) phaseFilter = sql`AND p.phase = ${phase}`

  let strainFilter = sql``
  if (strain) strainFilter = sql`AND p.strain_name ILIKE ${'%' + strain + '%'}`

  let roomFilter = sql``
  if (roomId) roomFilter = sql`AND p.room_id = ${roomId}`

  const dataResult = await db.execute(sql`
    SELECT p.*, gr.name as room_name
    FROM plants p
    LEFT JOIN grow_rooms gr ON gr.id = p.room_id
    WHERE p.company_id = ${currentUser.companyId}
      ${phaseFilter}
      ${strainFilter}
      ${roomFilter}
    ORDER BY p.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM plants p
    WHERE p.company_id = ${currentUser.companyId}
      ${phaseFilter}
      ${strainFilter}
      ${roomFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Add plant(s)
app.post('/plants', async (c) => {
  const currentUser = c.get('user') as any

  const plantSchema = z.object({
    strainName: z.string().min(1),
    strainType: z.enum(['indica', 'sativa', 'hybrid', 'ruderalis']).optional(),
    phase: z.enum(['clone', 'seedling', 'vegetative', 'flowering', 'harvested', 'destroyed']).default('seedling'),
    plantDate: z.string().optional(),
    roomId: z.string().optional(),
    locationId: z.string().optional(),
    motherPlantId: z.string().optional(),
    metrcTag: z.string().optional(),
    notes: z.string().optional(),
    quantity: z.number().int().min(1).default(1),
  })
  const data = plantSchema.parse(await c.req.json())

  const plants: any[] = []
  for (let i = 0; i < data.quantity; i++) {
    const result = await db.execute(sql`
      INSERT INTO plants(id, company_id, strain_name, strain_type, phase, plant_date, room_id, location_id, mother_plant_id, metrc_tag, notes, created_at, updated_at)
      VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.strainName}, ${data.strainType || null}, ${data.phase}, ${data.plantDate || new Date().toISOString().split('T')[0]}, ${data.roomId || null}, ${data.locationId || null}, ${data.motherPlantId || null}, ${data.metrcTag && data.quantity === 1 ? data.metrcTag : null}, ${data.notes || null}, NOW(), NOW())
      RETURNING *
    `)
    const plant = ((result as any).rows || result)?.[0]
    plants.push(plant)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'plant',
    entityId: plants[0]?.id,
    entityName: `${data.strainName} x${data.quantity}`,
    req: c.req,
  })

  return c.json(data.quantity === 1 ? plants[0] : plants, 201)
})

// Update plant
app.put('/plants/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const plantSchema = z.object({
    strainName: z.string().min(1).optional(),
    strainType: z.enum(['indica', 'sativa', 'hybrid', 'ruderalis']).optional(),
    roomId: z.string().optional(),
    locationId: z.string().optional(),
    metrcTag: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = plantSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.strainName !== undefined) sets.push(sql`strain_name = ${data.strainName}`)
  if (data.strainType !== undefined) sets.push(sql`strain_type = ${data.strainType}`)
  if (data.roomId !== undefined) sets.push(sql`room_id = ${data.roomId}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.metrcTag !== undefined) sets.push(sql`metrc_tag = ${data.metrcTag}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE plants SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Plant not found' }, 404)

  return c.json(updated)
})

// Change plant phase (with growth log entry)
app.put('/plants/:id/phase', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const phaseSchema = z.object({
    phase: z.enum(['clone', 'seedling', 'vegetative', 'flowering', 'harvested', 'destroyed']),
    notes: z.string().optional(),
  })
  const data = phaseSchema.parse(await c.req.json())

  // Get current plant
  const existingResult = await db.execute(sql`
    SELECT * FROM plants
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Plant not found' }, 404)

  // Update phase
  const result = await db.execute(sql`
    UPDATE plants SET phase = ${data.phase}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  // Append to plants.growth_log JSON column
  const growthEntry = JSON.stringify({ fromPhase: existing.phase, toPhase: data.phase, notes: data.notes || null, changedBy: currentUser.id, createdAt: new Date().toISOString() })
  await db.execute(sql`
    UPDATE plants SET growth_log = COALESCE(growth_log, '[]'::jsonb) || ${growthEntry}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'plant',
    entityId: id,
    entityName: existing.strain_name,
    changes: { phase: { old: existing.phase, new: data.phase } },
    req: c.req,
  })

  return c.json(updated)
})

// Harvest plant
app.post('/plants/:id/harvest', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const harvestSchema = z.object({
    wetWeight: z.number().min(0),
    harvestId: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = harvestSchema.parse(await c.req.json())

  // Get current plant
  const existingResult = await db.execute(sql`
    SELECT * FROM plants
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Plant not found' }, 404)
  if (existing.phase === 'harvested') return c.json({ error: 'Plant already harvested' }, 400)
  if (existing.phase === 'destroyed') return c.json({ error: 'Plant was destroyed' }, 400)

  // Update plant
  const result = await db.execute(sql`
    UPDATE plants
    SET phase = 'harvested', wet_weight = ${data.wetWeight}, harvest_id = ${data.harvestId || null}, harvested_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  // Append to plants.growth_log JSON column
  const harvestLogEntry = JSON.stringify({ fromPhase: existing.phase, toPhase: 'harvested', notes: data.notes || 'Harvested', changedBy: currentUser.id, createdAt: new Date().toISOString() })
  await db.execute(sql`
    UPDATE plants SET growth_log = COALESCE(growth_log, '[]'::jsonb) || ${harvestLogEntry}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'plant',
    entityId: id,
    entityName: existing.strain_name,
    changes: { phase: { old: existing.phase, new: 'harvested' }, wetWeight: { old: null, new: data.wetWeight } },
    req: c.req,
  })

  return c.json(updated)
})

// Destroy plant
app.post('/plants/:id/destroy', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const destroySchema = z.object({
    reason: z.string().min(1),
  })
  const data = destroySchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM plants
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Plant not found' }, 404)
  if (existing.phase === 'destroyed') return c.json({ error: 'Plant already destroyed' }, 400)

  const result = await db.execute(sql`
    UPDATE plants
    SET phase = 'destroyed', destroy_reason = ${data.reason}, destroyed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  // Append to plants.growth_log JSON column
  const destroyLogEntry = JSON.stringify({ fromPhase: existing.phase, toPhase: 'destroyed', notes: data.reason, changedBy: currentUser.id, createdAt: new Date().toISOString() })
  await db.execute(sql`
    UPDATE plants SET growth_log = COALESCE(growth_log, '[]'::jsonb) || ${destroyLogEntry}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'plant',
    entityId: id,
    entityName: existing.strain_name,
    changes: { phase: { old: existing.phase, new: 'destroyed' }, reason: data.reason },
    req: c.req,
  })

  return c.json(updated)
})

// ── Grow Rooms ─────────────────────────────────────────────────────────

// List grow rooms
app.get('/rooms', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT gr.*,
           COUNT(p.id)::int as plant_count
    FROM grow_rooms gr
    LEFT JOIN plants p ON p.room_id = gr.id AND p.phase NOT IN ('harvested', 'destroyed')
    WHERE gr.company_id = ${currentUser.companyId}
    GROUP BY gr.id
    ORDER BY gr.name ASC
  `)

  return c.json((result as any).rows || result)
})

// Create room
app.post('/rooms', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const roomSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['veg', 'flower', 'clone', 'dry', 'cure', 'mother', 'nursery']).optional(),
    locationId: z.string().optional(),
    capacity: z.number().int().min(0).optional(),
    environment: z.object({
      targetTemp: z.number().optional(),
      targetHumidity: z.number().optional(),
      lightCycle: z.string().optional(),
      co2Level: z.number().optional(),
    }).optional(),
  })
  const data = roomSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO grow_rooms(id, company_id, name, type, location_id, capacity, environment, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.type || null}, ${data.locationId || null}, ${data.capacity || null}, ${data.environment ? JSON.stringify(data.environment) : '{}'}::jsonb, NOW(), NOW())
    RETURNING *
  `)

  const room = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'grow_rooms',
    entityId: room?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(room, 201)
})

// Update room
app.put('/rooms/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const roomSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['veg', 'flower', 'clone', 'dry', 'cure', 'mother', 'nursery']).optional(),
    locationId: z.string().optional(),
    capacity: z.number().int().min(0).optional(),
    environment: z.object({
      targetTemp: z.number().optional(),
      targetHumidity: z.number().optional(),
      lightCycle: z.string().optional(),
      co2Level: z.number().optional(),
    }).optional(),
  })
  const data = roomSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.capacity !== undefined) sets.push(sql`capacity = ${data.capacity}`)
  if (data.environment !== undefined) sets.push(sql`environment = ${JSON.stringify(data.environment)}::jsonb`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE grow_rooms SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Room not found' }, 404)

  return c.json(updated)
})

// ── Harvests ───────────────────────────────────────────────────────────

// List harvests
app.get('/harvests', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT h.*,
           COUNT(p.id)::int as plant_count
    FROM harvests h
    LEFT JOIN plants p ON p.harvest_id = h.id
    WHERE h.company_id = ${currentUser.companyId}
    GROUP BY h.id
    ORDER BY h.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM harvests
    WHERE company_id = ${currentUser.companyId}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create harvest record
app.post('/harvests', async (c) => {
  const currentUser = c.get('user') as any

  const harvestSchema = z.object({
    name: z.string().min(1),
    strainName: z.string().min(1),
    harvestDate: z.string().optional(),
    wetWeight: z.number().min(0).optional(),
    dryWeight: z.number().min(0).optional(),
    trimWeight: z.number().min(0).optional(),
    wasteWeight: z.number().min(0).optional(),
    status: z.enum(['in_progress', 'drying', 'curing', 'complete']).default('in_progress'),
    roomId: z.string().optional(),
    notes: z.string().optional(),
    metrcTag: z.string().optional(),
  })
  const data = harvestSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO harvests(id, company_id, name, strain_name, harvest_date, wet_weight, dry_weight, trim_weight, waste_weight, status, room_id, notes, metrc_tag, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.strainName}, ${data.harvestDate || new Date().toISOString().split('T')[0]}, ${data.wetWeight || null}, ${data.dryWeight || null}, ${data.trimWeight || null}, ${data.wasteWeight || null}, ${data.status}, ${data.roomId || null}, ${data.notes || null}, ${data.metrcTag || null}, NOW(), NOW())
    RETURNING *
  `)

  const harvest = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'harvest',
    entityId: harvest?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(harvest, 201)
})

// Update harvest
app.put('/harvests/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const harvestSchema = z.object({
    name: z.string().min(1).optional(),
    wetWeight: z.number().min(0).optional(),
    dryWeight: z.number().min(0).optional(),
    trimWeight: z.number().min(0).optional(),
    wasteWeight: z.number().min(0).optional(),
    status: z.enum(['in_progress', 'drying', 'curing', 'complete']).optional(),
    finishedDate: z.string().optional(),
    notes: z.string().optional(),
    metrcTag: z.string().optional(),
  })
  const data = harvestSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.wetWeight !== undefined) sets.push(sql`wet_weight = ${data.wetWeight}`)
  if (data.dryWeight !== undefined) sets.push(sql`dry_weight = ${data.dryWeight}`)
  if (data.trimWeight !== undefined) sets.push(sql`trim_weight = ${data.trimWeight}`)
  if (data.wasteWeight !== undefined) sets.push(sql`waste_weight = ${data.wasteWeight}`)
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
  if (data.finishedDate !== undefined) sets.push(sql`finished_date = ${data.finishedDate}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  if (data.metrcTag !== undefined) sets.push(sql`metrc_tag = ${data.metrcTag}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE harvests SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Harvest not found' }, 404)

  return c.json(updated)
})

export default app
