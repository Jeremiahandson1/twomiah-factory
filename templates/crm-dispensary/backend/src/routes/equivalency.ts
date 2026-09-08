import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw db.execute rows come back snake_case; the frontend reads camelCase
// (equivalencyFactor, unitOfMeasure, purchaseLimitGrams, …). Convert row keys before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// Standard equivalency factors by state (used for seeding)
const DEFAULT_RULES: Record<string, Array<{ category: string; equivalencyFactor: number; unitOfMeasure: string; description: string }>> = {
  MI: [
    { category: 'flower', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g flower = 1g flower equivalent' },
    { category: 'concentrate', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g concentrate = 2.5g flower equivalent' },
    { category: 'edible', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
    { category: 'tincture', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
    { category: 'pre_roll', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g pre-roll = 1g flower equivalent' },
    { category: 'vape', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g vape = 2.5g flower equivalent' },
    { category: 'topical', equivalencyFactor: 0, unitOfMeasure: 'g', description: 'Topicals not counted toward purchase limit' },
  ],
  CO: [
    { category: 'flower', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g flower = 1g flower equivalent' },
    { category: 'concentrate', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g concentrate = 2.5g flower equivalent' },
    { category: 'edible', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
    { category: 'tincture', equivalencyFactor: 0.1, unitOfMeasure: 'mg_thc', description: '10mg THC = 1g flower equivalent' },
    { category: 'pre_roll', equivalencyFactor: 1, unitOfMeasure: 'g', description: '1g pre-roll = 1g flower equivalent' },
    { category: 'vape', equivalencyFactor: 2.5, unitOfMeasure: 'g', description: '1g vape = 2.5g flower equivalent' },
    { category: 'topical', equivalencyFactor: 0, unitOfMeasure: 'g', description: 'Topicals not counted toward purchase limit' },
  ],
}

// Purchase limit in oz (most states: 2.5 oz recreational)
const PURCHASE_LIMIT_OZ = 2.5
const GRAMS_PER_OZ = 28.3495

// GET /rules — List equivalency rules for company
app.get('/rules', async (c) => {
  const currentUser = c.get('user') as any
  const state = c.req.query('state')

  let stateFilter = sql``
  if (state) stateFilter = sql`AND state = ${state.toUpperCase()}`

  const result = await db.execute(sql`
    SELECT * FROM equivalency_rules
    WHERE company_id = ${currentUser.companyId}
      AND is_active = true
      ${stateFilter}
    ORDER BY state ASC, category ASC
  `)

  return c.json(((result as any).rows || result).map(camel))
})

// POST /rules — Create equivalency rule (manager+)
app.post('/rules', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const ruleSchema = z.object({
    // Blank = applies to all states. The state column is NOT NULL, so a blank value is stored as ''
    // (the UI renders an empty state as "All"). No length requirement so "leave blank" works.
    state: z.string().optional().default('').transform(v => (v || '').trim().toUpperCase()),
    category: z.string().min(1),
    // The dialog sends `equivalencyGrams`; older callers may send `equivalencyFactor`. Accept either.
    equivalencyFactor: z.coerce.number().min(0).optional(),
    equivalencyGrams: z.coerce.number().min(0).optional(),
    // The dialog is grams-based and collects no unit; default to grams.
    unitOfMeasure: z.string().min(1).optional().default('g'),
    purchaseLimitGrams: z.coerce.number().optional(),
    description: z.string().optional(),
    effectiveDate: z.string().optional(),
  })
  const data = ruleSchema.parse(await c.req.json())
  const factor = data.equivalencyFactor ?? data.equivalencyGrams ?? 0

  const result = await db.execute(sql`
    INSERT INTO equivalency_rules (id, state, category, equivalency_factor, unit_of_measure, purchase_limit_grams, description, effective_date, is_active, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.state}, ${data.category}, ${String(factor)}, ${data.unitOfMeasure}, ${data.purchaseLimitGrams != null ? String(data.purchaseLimitGrams) : null}, ${data.description || null}, ${data.effectiveDate ? new Date(data.effectiveDate) : null}, true, ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const rule = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'equivalency_rule',
    entityId: rule?.id,
    entityName: `${data.state || 'All'} - ${data.category}`,
    metadata: { state: data.state, category: data.category, factor },
    req: c.req,
  })

  return c.json(camel(rule), 201)
})

// PUT /rules/:id — Update equivalency rule
app.put('/rules/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const ruleSchema = z.object({
    state: z.string().length(2).transform(v => v.toUpperCase()).optional(),
    category: z.string().min(1).optional(),
    equivalencyFactor: z.number().min(0).optional(),
    unitOfMeasure: z.string().min(1).optional(),
    description: z.string().optional(),
    effectiveDate: z.string().optional(),
  })
  const data = ruleSchema.parse(await c.req.json())

  const sets: any[] = []
  if (data.state !== undefined) sets.push(sql`state = ${data.state}`)
  if (data.category !== undefined) sets.push(sql`category = ${data.category}`)
  if (data.equivalencyFactor !== undefined) sets.push(sql`equivalency_factor = ${data.equivalencyFactor}`)
  if (data.unitOfMeasure !== undefined) sets.push(sql`unit_of_measure = ${data.unitOfMeasure}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.effectiveDate !== undefined) sets.push(sql`effective_date = ${new Date(data.effectiveDate)}`)

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE equivalency_rules SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Rule not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'equivalency_rule',
    entityId: id,
    req: c.req,
  })

  return c.json(camel(updated))
})

// DELETE /rules/:id — Deactivate rule
app.delete('/rules/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE equivalency_rules SET is_active = false
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id
  `)

  const deactivated = ((result as any).rows || result)?.[0]
  if (!deactivated) return c.json({ error: 'Rule not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'equivalency_rule',
    entityId: id,
    req: c.req,
  })

  return c.json({ success: true })
})

// POST /rules/seed — Seed default rules for a state (manager+)
app.post('/rules/seed', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const { state } = z.object({ state: z.string().length(2).transform(v => v.toUpperCase()) }).parse(await c.req.json())

  const defaults = DEFAULT_RULES[state]
  if (!defaults) {
    return c.json({ error: `No default rules available for state: ${state}. Available: ${Object.keys(DEFAULT_RULES).join(', ')}` }, 400)
  }

  // Check if rules already exist for this state
  const existingResult = await db.execute(sql`
    SELECT COUNT(*)::int as count FROM equivalency_rules
    WHERE company_id = ${currentUser.companyId} AND state = ${state} AND is_active = true
  `)
  const existingCount = ((existingResult as any).rows || existingResult)?.[0]?.count || 0
  if (existingCount > 0) {
    return c.json({ error: `Rules already exist for state ${state}. Delete existing rules first or update them individually.` }, 409)
  }

  const inserted: any[] = []
  for (const rule of defaults) {
    const result = await db.execute(sql`
      INSERT INTO equivalency_rules (id, state, category, equivalency_factor, unit_of_measure, description, is_active, company_id, created_at)
      VALUES (gen_random_uuid(), ${state}, ${rule.category}, ${rule.equivalencyFactor}, ${rule.unitOfMeasure}, ${rule.description}, true, ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    if (row) inserted.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'equivalency_rule',
    entityName: `Seed ${state} rules`,
    metadata: { state, rulesCreated: inserted.length },
    req: c.req,
  })

  return c.json({ message: `Seeded ${inserted.length} equivalency rules for ${state}`, rules: inserted.map(camel) }, 201)
})

// POST /rules/seed-defaults — Seed a company-wide default set of equivalency rules.
// The UI's "Seed Defaults" button sends no state, so these are stored state-agnostic (state = '',
// which the list renders as "All"). Idempotent: categories that already have an active rule are
// skipped so re-clicking doesn't duplicate. equivalency_factor is a text column (schema.ts).
app.post('/rules/seed-defaults', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const defaults = DEFAULT_RULES.MI // standard flower-equivalency factors

  const existingResult = await db.execute(sql`
    SELECT category FROM equivalency_rules
    WHERE company_id = ${currentUser.companyId} AND state = '' AND is_active = true
  `)
  const existing = new Set(((existingResult as any).rows || existingResult).map((r: any) => r.category))

  const inserted: any[] = []
  for (const rule of defaults) {
    if (existing.has(rule.category)) continue
    const result = await db.execute(sql`
      INSERT INTO equivalency_rules (id, state, category, equivalency_factor, unit_of_measure, description, is_active, company_id, created_at)
      VALUES (gen_random_uuid(), '', ${rule.category}, ${String(rule.equivalencyFactor)}, ${rule.unitOfMeasure}, ${rule.description}, true, ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    if (row) inserted.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'equivalency_rule',
    entityName: 'Seed default rules',
    metadata: { rulesCreated: inserted.length },
    req: c.req,
  })

  return c.json({ message: `Seeded ${inserted.length} default equivalency rules`, rules: inserted.map(camel) }, 201)
})

// POST /calculate — Calculate total flower-equivalent weight for a cart
app.post('/calculate', async (c) => {
  const currentUser = c.get('user') as any

  const calcSchema = z.object({
    items: z.array(z.object({
      productId: z.string().min(1),
      quantity: z.number().min(1),
    })).min(1),
    state: z.string().length(2).transform(v => v.toUpperCase()).optional(),
  })
  const data = calcSchema.parse(await c.req.json())

  // Get company's state from settings or use provided state
  const state = data.state || 'MI'

  // Fetch equivalency rules for this state
  const rulesResult = await db.execute(sql`
    SELECT category, equivalency_factor, unit_of_measure FROM equivalency_rules
    WHERE company_id = ${currentUser.companyId} AND state = ${state} AND is_active = true
  `)
  const rules = (rulesResult as any).rows || rulesResult
  const ruleMap = new Map(rules.map((r: any) => [r.category, r]))

  // Fetch products
  const productIds = data.items.map(i => i.productId)
  const productsResult = await db.execute(sql`
    SELECT id, name, category, weight, weight_unit, thc_percent FROM products
    WHERE company_id = ${currentUser.companyId}
  `)
  const products = ((productsResult as any).rows || productsResult).filter((p: any) => productIds.includes(p.id))
  const productMap = new Map(products.map((p: any) => [p.id, p]))

  let totalFlowerEquivalentGrams = 0
  const perItemEquivalent: any[] = []

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)

    const rule = ruleMap.get(prod.category)
    if (!rule) {
      // No rule = assume 1:1 flower equivalent
      const weightGrams = prod.weight_unit === 'oz'
        ? Number(prod.weight || 0) * GRAMS_PER_OZ
        : Number(prod.weight || 0)
      const equivalent = weightGrams * item.quantity
      totalFlowerEquivalentGrams += equivalent
      perItemEquivalent.push({
        productId: item.productId,
        productName: prod.name,
        category: prod.category,
        quantity: item.quantity,
        equivalentGrams: equivalent,
        note: 'No rule found, using 1:1 ratio',
      })
      continue
    }

    let equivalentGrams: number
    if (rule.unit_of_measure === 'mg_thc') {
      // THC-based equivalency (edibles, tinctures)
      const thcMg = Number(prod.thc_percent || 0) * item.quantity
      equivalentGrams = thcMg * rule.equivalency_factor
    } else {
      // Weight-based equivalency (flower, concentrates)
      const weightGrams = prod.weight_unit === 'oz'
        ? Number(prod.weight || 0) * GRAMS_PER_OZ
        : Number(prod.weight || 0)
      equivalentGrams = weightGrams * rule.equivalency_factor * item.quantity
    }

    totalFlowerEquivalentGrams += equivalentGrams
    perItemEquivalent.push({
      productId: item.productId,
      productName: prod.name,
      category: prod.category,
      quantity: item.quantity,
      equivalentGrams: Math.round(equivalentGrams * 100) / 100,
    })
  }

  const totalFlowerEquivalentOz = Math.round((totalFlowerEquivalentGrams / GRAMS_PER_OZ) * 100) / 100
  const isOverLimit = totalFlowerEquivalentOz > PURCHASE_LIMIT_OZ
  const remainingOz = Math.max(0, Math.round((PURCHASE_LIMIT_OZ - totalFlowerEquivalentOz) * 100) / 100)

  return c.json({
    perItemEquivalent,
    totalFlowerEquivalentGrams: Math.round(totalFlowerEquivalentGrams * 100) / 100,
    totalFlowerEquivalentOz,
    purchaseLimitOz: PURCHASE_LIMIT_OZ,
    isOverLimit,
    remainingOz,
    state,
  })
})

export default app
