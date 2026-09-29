import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { company, product } from '../../db/schema.ts'
import { eq, and, inArray } from 'drizzle-orm'
import { loadEquivalencyFactors } from '../services/equivalency.ts'
import { lineFlowerEquivalentGrams, cartCannabisGrams, overPurchaseLimit, unweighedCannabisRefusal, uncountableCannabisLines } from '../utils/cannabis.ts'

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

// Standard factors by state live in services/equivalency.ts, so the page that SEEDS them and the till
// that ENFORCES them cannot describe the same state differently. (T20 H5)
import { DEFAULT_RULES } from '../services/equivalency.ts'

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

  // {data, pagination} like every other list on this API. It answered with a bare array, so a caller
  // reading `body.data` got undefined here and nowhere else — the one shape you have to special-case.
  // There is no paging to do (a tenant has a handful of rules and the query fetches all of them), so the
  // block says exactly that: one page, holding everything. (Dispensary T28 L-c)
  const data = ((result as any).rows || result).map(camel)
  return c.json({ data, pagination: { page: 1, limit: data.length, total: data.length, pages: 1 } })
})

// POST /rules — Create equivalency rule (manager+)
// Owner/admin only — the same authority that sets the purchase limit itself. These factors decide
// what a gram of each category is WORTH against that cap, so a manager who can edit them can raise
// the cap without touching it: concentrate at 0.1 instead of 2.5 turns a 1 oz limit into 25 oz. A
// lock on the number but not on the arithmetic behind it is not a lock. (Dispensary T39 M1)
app.post('/rules', requireRole('admin'), async (c) => {
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
  let data: z.infer<typeof ruleSchema>
  try {
    data = ruleSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const factor = data.equivalencyFactor ?? data.equivalencyGrams ?? 0

  // One rule per category per state.
  //
  // T45 M15: a second active rule for the same category was accepted, so a shop could hold two
  // different factors for concentrate and nothing said which one the register uses. The factors
  // are what a purchase limit is counted in — two answers to that question is two answers to
  // "may this customer buy this", and the one that wins is whichever row the loader happens to
  // read first. Edit the existing rule instead.
  const clash = await db.execute(sql`
    SELECT id, equivalency_factor FROM equivalency_rules
    WHERE company_id = ${currentUser.companyId}
      AND LOWER(category) = ${data.category.trim().toLowerCase()}
      AND COALESCE(state, '') = ${data.state}
      AND is_active = true
    LIMIT 1
  `)
  const clashing = ((clash as any).rows || clash)?.[0]
  if (clashing) {
    return c.json({
      error: `There is already a rule for ${data.category} in ${data.state || 'all states'} (${clashing.equivalency_factor} per unit). Edit that one rather than adding a second.`,
      code: 'duplicate_equivalency_rule',
      existingId: clashing.id,
    }, 409)
  }

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
    req: c,
  })

  return c.json(camel(rule), 201)
})

// PUT /rules/:id — Update equivalency rule
app.put('/rules/:id', requireRole('admin'), async (c) => {
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
    req: c,
  })

  return c.json(camel(updated))
})

// DELETE /rules/:id — Deactivate rule
app.delete('/rules/:id', requireRole('admin'), async (c) => {
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
    req: c,
  })

  return c.json({ success: true })
})

// POST /rules/seed — Seed default rules for a state (manager+)
app.post('/rules/seed', requireRole('admin'), async (c) => {
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
    req: c,
  })

  return c.json({ message: `Seeded ${inserted.length} equivalency rules for ${state}`, rules: inserted.map(camel) }, 201)
})

// POST /rules/seed-defaults — Seed a company-wide default set of equivalency rules.
// The UI's "Seed Defaults" button sends no state, so these are stored state-agnostic (state = '',
// which the list renders as "All"). Idempotent: categories that already have an active rule are
// skipped so re-clicking doesn't duplicate. equivalency_factor is a text column (schema.ts).
app.post('/rules/seed-defaults', requireRole('admin'), async (c) => {
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
    req: c,
  })

  return c.json({ message: `Seeded ${inserted.length} default equivalency rules`, rules: inserted.map(camel) }, 201)
})

// POST /calculate — Calculate total flower-equivalent weight for a cart
/**
 * What this basket weighs against the purchase limit — the SAME answer the register will get when it
 * tries to ring it up.
 *
 * There were three implementations of this arithmetic: utils/cannabis.ts (which the sale path uses
 * and which understands thc_mg), the private copy that used to live in this handler (which did not,
 * and defaulted to Michigan's rules on an Ohio shop), and the POS screen's own sum of raw grams with
 * no rules at all. Run T45 M5 is what three copies look like from the shop floor: the meter read
 * 0.2 oz, the operator kept scanning, and the server refused the completed basket at "1.31oz exceeds
 * the 1oz maximum" — after the customer had been served.
 *
 * So this now calls the sale path's own helpers, and the register calls this. One implementation,
 * one answer, and the meter agrees with the refusal. (T45 M5)
 */
app.post('/calculate', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const calcSchema = z.object({
    items: z.array(z.object({
      productId: z.string().min(1),
      quantity: z.number().min(0),
    })).min(1),
  })
  const data = calcSchema.parse(await c.req.json())

  const [co] = await db.select({ purchaseLimitOz: company.purchaseLimitOz }).from(company)
    .where(eq(company.id, currentUser.companyId)).limit(1)
  const limitOz = Number(co?.purchaseLimitOz) > 0 ? Number(co!.purchaseLimitOz) : PURCHASE_LIMIT_OZ

  const factors = await loadEquivalencyFactors(currentUser.companyId)

  // Read through drizzle, not raw SQL: the shared helpers below read camelCase (weightGrams,
  // weightUnit, thcMg) and a db.execute row comes back snake_case, so every product weighed ZERO and
  // the whole basket came out at 0 g — the same under-count this endpoint exists to prevent.
  const productIds = [...new Set(data.items.map((i) => i.productId))]
  const productRows = await db.select().from(product)
    .where(and(eq(product.companyId, currentUser.companyId), inArray(product.id, productIds)))
  const productMap = new Map(productRows.map((p: any) => [p.id, p]))

  const perItemEquivalent: any[] = []
  const lines: Array<{ product: any; quantity: any }> = []
  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    lines.push({ product: prod, quantity: item.quantity })
    const unit = lineFlowerEquivalentGrams(prod, factors)
    perItemEquivalent.push({
      productId: item.productId,
      productName: prod.name,
      category: prod.category,
      quantity: item.quantity,
      equivalentGrams: Math.round(unit * item.quantity * 100) / 100,
    })
  }

  // The same sum the sale path makes, from the same helper.
  const totalFlowerEquivalentGrams = cartCannabisGrams(lines, factors)
  const totalFlowerEquivalentOz = Math.round((totalFlowerEquivalentGrams / GRAMS_PER_OZ) * 100) / 100
  const over = overPurchaseLimit(totalFlowerEquivalentGrams, limitOz)

  // A line the rules cannot count is the other way a basket surprises the till: it reads as nothing
  // here and is refused by name at completion. Say so while the customer is still at the counter.
  //
  // Asked of uncountableCannabisLines, NOT of a filter written here. A first draft of this used
  // `lineFlowerEquivalentGrams(...) <= 0` inline, which looks identical and is not: it treats a
  // topical — whose factor is deliberately zero — as unweighable and would refuse a sale the rules
  // are written to allow. check-one-countable-definition.ts caught it, which is exactly what that
  // guard exists for. (T32 B1/M2)
  const uncountable = unweighedCannabisRefusal(
    uncountableCannabisLines(lines, factors),
    factors,
    lines[0]?.product,
  )

  return c.json({
    perItemEquivalent,
    totalFlowerEquivalentGrams: Math.round(totalFlowerEquivalentGrams * 100) / 100,
    totalFlowerEquivalentOz,
    purchaseLimitOz: limitOz,
    isOverLimit: !!over,
    remainingOz: Math.max(0, Math.round((limitOz - totalFlowerEquivalentOz) * 100) / 100),
    // Ready to show: the exact wording the completion would refuse with.
    limitError: over?.error ?? null,
    uncountable: uncountable?.products ?? null,
    uncountableError: uncountable?.error ?? null,
  })
})

export default app
