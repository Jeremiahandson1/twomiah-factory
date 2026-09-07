import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// Raw db.execute rows come back snake_case, but the platform frontend reads camelCase
// (imageUrl, orderNumber, percentComplete, ...). Convert row keys before responding. (cash.ts N1)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}
const camelAll = (rows: any[]): any[] => (Array.isArray(rows) ? rows.map(camel) : rows)

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH & UPTIME (some public, some authed)
// ═══════════════════════════════════════════════════════════════════════════

// GET /health/status — Current health status of all services
app.get('/health/status', async (c) => {
  const services: any[] = []

  // Check API (self)
  services.push({ service: 'api', status: 'healthy', latencyMs: 0, checkedAt: new Date().toISOString() })

  // Check database
  try {
    const start = Date.now()
    await db.execute(sql`SELECT 1`)
    services.push({ service: 'database', status: 'healthy', latencyMs: Date.now() - start, checkedAt: new Date().toISOString() })
  } catch {
    services.push({ service: 'database', status: 'unhealthy', latencyMs: null, checkedAt: new Date().toISOString(), error: 'Connection failed' })
  }

  // Check Metrc (last sync status)
  try {
    const metrcResult = await db.execute(sql`
      SELECT completed_at, status FROM metrc_sync_log
      ORDER BY completed_at DESC LIMIT 1
    `)
    const metrc = ((metrcResult as any).rows || metrcResult)?.[0]
    const isStale = metrc?.completed_at && (Date.now() - new Date(metrc.completed_at).getTime()) > 3600000 // >1h
    services.push({
      service: 'metrc',
      status: metrc?.status === 'success' && !isStale ? 'healthy' : isStale ? 'degraded' : 'unhealthy',
      lastSyncAt: metrc?.completed_at || null,
      checkedAt: new Date().toISOString(),
    })
  } catch {
    services.push({ service: 'metrc', status: 'unknown', checkedAt: new Date().toISOString() })
  }

  // Check payments (Stripe connectivity)
  services.push({
    service: 'payments',
    status: process.env.STRIPE_SECRET_KEY ? 'healthy' : 'not_configured',
    checkedAt: new Date().toISOString(),
  })

  const overallStatus = services.every(s => s.status === 'healthy' || s.status === 'not_configured')
    ? 'healthy'
    : services.some(s => s.status === 'unhealthy') ? 'unhealthy' : 'degraded'

  return c.json({ status: overallStatus, services })
})

// ─── Authenticated health endpoints ─────────────────────────────────────────

app.use('/health/history', authenticate)
app.use('/health/uptime', authenticate)
app.use('/health/incidents', authenticate)
app.use('/health/incidents/*', authenticate)

// GET /health/history — Health check history (last 24h)
app.get('/health/history', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM health_checks
    WHERE company_id = ${currentUser.companyId}
      AND checked_at >= NOW() - INTERVAL '24 hours'
    ORDER BY checked_at DESC
  `)

  const rows = (result as any).rows || result

  // Group by service
  const grouped: Record<string, any[]> = {}
  for (const row of rows) {
    if (!grouped[row.service]) grouped[row.service] = []
    grouped[row.service].push(row)
  }

  return c.json(grouped)
})

// GET /health/uptime — Uptime percentage for each service over 30/90 days
app.get('/health/uptime', async (c) => {
  const currentUser = c.get('user') as any

  const uptimeResult = await db.execute(sql`
    SELECT
      service,
      COUNT(*) FILTER (WHERE status = 'healthy')::float / NULLIF(COUNT(*), 0) * 100 as uptime_30d
    FROM health_checks
    WHERE company_id = ${currentUser.companyId}
      AND checked_at >= NOW() - INTERVAL '30 days'
    GROUP BY service
  `)
  const uptime30 = (uptimeResult as any).rows || uptimeResult

  const uptime90Result = await db.execute(sql`
    SELECT
      service,
      COUNT(*) FILTER (WHERE status = 'healthy')::float / NULLIF(COUNT(*), 0) * 100 as uptime_90d
    FROM health_checks
    WHERE company_id = ${currentUser.companyId}
      AND checked_at >= NOW() - INTERVAL '90 days'
    GROUP BY service
  `)
  const uptime90 = (uptime90Result as any).rows || uptime90Result

  // Merge
  const serviceMap: Record<string, any> = {}
  for (const row of uptime30) {
    serviceMap[row.service] = { service: row.service, uptime30d: Math.round(row.uptime_30d * 100) / 100 }
  }
  for (const row of uptime90) {
    if (!serviceMap[row.service]) serviceMap[row.service] = { service: row.service }
    serviceMap[row.service].uptime90d = Math.round(row.uptime_90d * 100) / 100
  }

  return c.json(Object.values(serviceMap))
})

// GET /health/incidents — List incidents
app.get('/health/incidents', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const severity = c.req.query('severity')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND status = ${status}`

  let severityFilter = sql``
  if (severity) severityFilter = sql`AND severity = ${severity}`

  const dataResult = await db.execute(sql`
    SELECT * FROM uptime_incidents
    WHERE company_id = ${currentUser.companyId}
      ${statusFilter}
      ${severityFilter}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM uptime_incidents
    WHERE company_id = ${currentUser.companyId}
      ${statusFilter}
      ${severityFilter}
  `)

  const data = camelAll((dataResult as any).rows || dataResult)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /health/incidents — Report incident (admin)
app.post('/health/incidents', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  const incidentSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    severity: z.enum(['minor', 'major', 'critical']),
    service: z.string().optional(),
    affectedServices: z.array(z.string()).default([]),
  })
  const data = incidentSchema.parse(await c.req.json())

  // uptime_incidents.service is a single NOT NULL column (no affected_services column).
  const service = data.service || data.affectedServices[0] || 'general'

  const result = await db.execute(sql`
    INSERT INTO uptime_incidents (id, service, title, description, severity, status, started_at, company_id, created_at)
    VALUES (gen_random_uuid(), ${service}, ${data.title}, ${data.description || null}, ${data.severity}, 'investigating', NOW(), ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const incident = camel(((result as any).rows || result)?.[0])

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'incident',
    entityId: incident?.id,
    entityName: data.title,
    metadata: { severity: data.severity },
    req: c.req,
  })

  return c.json(incident, 201)
})

// PUT /health/incidents/:id — Update incident status/message
app.put('/health/incidents/:id', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
    message: z.string().optional(),
    severity: z.enum(['minor', 'major', 'critical']).optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  // uptime_incidents has no updated_at or latest_message column; status updates append
  // to the `updates` jsonb array instead. (schema is source of truth)
  const sets: any[] = []
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
  if (data.severity !== undefined) sets.push(sql`severity = ${data.severity}`)
  if (data.status === 'resolved') sets.push(sql`resolved_at = NOW()`)
  if (data.status !== undefined || data.message !== undefined) {
    const entry = { status: data.status || null, message: data.message || null, timestamp: new Date().toISOString() }
    // updates is a json column; cast through jsonb for the concat, then back to json for assignment.
    sets.push(sql`updates = (COALESCE(updates::jsonb, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb)::json`)
  }

  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE uptime_incidents SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = camel(((result as any).rows || result)?.[0])
  if (!updated) return c.json({ error: 'Incident not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'incident',
    entityId: id,
    entityName: updated.title,
    changes: data.status ? { status: { old: null, new: data.status } } : undefined,
    req: c.req,
  })

  return c.json(updated)
})

// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════════════════════

app.use('/onboarding', authenticate)
app.use('/onboarding/*', authenticate)

const DEFAULT_ONBOARDING_STEPS = [
  { stepNumber: 1, title: 'Company setup', description: 'Configure company name, logo, locations, and business hours' },
  { stepNumber: 2, title: 'Import products', description: 'Import your product catalog or add products manually' },
  { stepNumber: 3, title: 'Configure taxes', description: 'Set up excise tax, sales tax, and local tax rates for your jurisdiction' },
  { stepNumber: 4, title: 'Set up POS hardware', description: 'Connect receipt printers, barcode scanners, and cash drawers' },
  { stepNumber: 5, title: 'Connect Metrc/BioTrack', description: 'Link your seed-to-sale tracking system for compliance reporting' },
  { stepNumber: 6, title: 'Configure payment processing', description: 'Set up cash management, debit processing, or CanPay/Hypur integration' },
  { stepNumber: 7, title: 'Set up delivery zones', description: 'Define delivery areas, fees, and estimated delivery times' },
  { stepNumber: 8, title: 'Create loyalty program', description: 'Configure points earning rules, tiers, and rewards' },
  { stepNumber: 9, title: 'Train staff on POS', description: 'Walk your team through order creation, ID scanning, and daily operations' },
  { stepNumber: 10, title: 'Go live', description: 'Final checks, test transactions, and launch your dispensary CRM' },
]

// GET /onboarding — Get company's onboarding checklist
app.get('/onboarding', async (c) => {
  const currentUser = c.get('user') as any

  const checklistResult = await db.execute(sql`
    SELECT * FROM onboarding_checklists
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const checklist = ((checklistResult as any).rows || checklistResult)?.[0]
  // Return a 200 not_started payload (not 404) when no checklist row exists yet, so the UI can
  // render the default steps and offer to initialize. Previously this 404'd for every fresh tenant.
  if (!checklist) {
    return c.json({
      initialized: false,
      status: 'not_started',
      percentComplete: 0,
      assignedManagerName: null,
      assignedManagerEmail: null,
      steps: DEFAULT_ONBOARDING_STEPS.map((step) => ({
        id: `default-${step.stepNumber}`,
        stepNumber: step.stepNumber,
        title: step.title,
        description: step.description,
        completed: false,
        completedAt: null,
        completedBy: null,
      })),
    })
  }

  const steps = Array.isArray(checklist.steps) ? checklist.steps
    : (typeof checklist.steps === 'string' ? JSON.parse(checklist.steps) : [])

  return c.json({ ...camel(checklist), initialized: true, steps })
})

// POST /onboarding/initialize — Create checklist with default steps
app.post('/onboarding/initialize', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const initSchema = z.object({
    managerName: z.string().optional(),
    managerEmail: z.string().email().optional(),
  })
  const data = initSchema.parse(await c.req.json())

  // Check if already initialized
  const existingResult = await db.execute(sql`
    SELECT id FROM onboarding_checklists
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) return c.json({ error: 'Onboarding already initialized' }, 409)

  // Create checklist. Schema columns are assigned_manager_name/email; there is no started_at
  // (created_at marks the start). (schema is source of truth)
  const checklistResult = await db.execute(sql`
    INSERT INTO onboarding_checklists (id, company_id, assigned_manager_name, assigned_manager_email, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.managerName || null}, ${data.managerEmail || null}, 'in_progress', NOW(), NOW())
    RETURNING *
  `)
  const checklist = ((checklistResult as any).rows || checklistResult)?.[0]

  // Store steps as JSON array on the checklist
  const steps = DEFAULT_ONBOARDING_STEPS.map(step => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `step-${step.stepNumber}`,
    stepNumber: step.stepNumber,
    title: step.title,
    description: step.description,
    completed: false,
    completedAt: null,
    completedBy: null,
  }))

  await db.execute(sql`
    UPDATE onboarding_checklists
    SET steps = ${JSON.stringify(steps)}::json, updated_at = NOW()
    WHERE id = ${checklist.id}
  `)

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'onboarding_checklist',
    entityId: checklist.id,
    entityName: 'Onboarding initialized',
    metadata: { stepsCreated: steps.length },
    req: c.req,
  })

  return c.json({ ...camel(checklist), steps }, 201)
})

// PUT /onboarding/steps/:stepId — Mark step complete
app.put('/onboarding/steps/:stepId', async (c) => {
  const currentUser = c.get('user') as any
  const stepId = c.req.param('stepId')

  // Get the checklist with steps JSON
  const checklistResult = await db.execute(sql`
    SELECT * FROM onboarding_checklists
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const checklist = ((checklistResult as any).rows || checklistResult)?.[0]
  if (!checklist) return c.json({ error: 'Onboarding not initialized' }, 404)

  const steps: any[] = Array.isArray(checklist.steps) ? checklist.steps
    : (typeof checklist.steps === 'string' ? JSON.parse(checklist.steps) : [])

  const stepIndex = steps.findIndex((s: any) => s.id === stepId || String(s.stepNumber) === stepId)
  if (stepIndex === -1) return c.json({ error: 'Step not found' }, 404)

  steps[stepIndex].completed = true
  steps[stepIndex].completedAt = new Date().toISOString()
  steps[stepIndex].completedBy = currentUser.userId

  await db.execute(sql`
    UPDATE onboarding_checklists
    SET steps = ${JSON.stringify(steps)}::json, updated_at = NOW()
    WHERE id = ${checklist.id}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'onboarding_step',
    entityId: stepId,
    entityName: steps[stepIndex].title,
    changes: { completed: { old: false, new: true } },
    req: c.req,
  })

  return c.json(steps[stepIndex])
})

// PUT /onboarding/manager — Assign success manager
app.put('/onboarding/manager', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const { name, email } = z.object({ name: z.string().min(1), email: z.string().email() }).parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE onboarding_checklists
    SET assigned_manager_name = ${name}, assigned_manager_email = ${email}, updated_at = NOW()
    WHERE company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = camel(((result as any).rows || result)?.[0])
  if (!updated) return c.json({ error: 'Onboarding not initialized' }, 404)

  return c.json(updated)
})

// GET /onboarding/progress — Progress summary
app.get('/onboarding/progress', async (c) => {
  const currentUser = c.get('user') as any

  const checklistResult = await db.execute(sql`
    SELECT * FROM onboarding_checklists
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const checklist = ((checklistResult as any).rows || checklistResult)?.[0]
  if (!checklist) return c.json({ error: 'Onboarding not initialized' }, 404)

  const steps: any[] = Array.isArray(checklist.steps) ? checklist.steps
    : (typeof checklist.steps === 'string' ? JSON.parse(checklist.steps) : [])

  const totalSteps = steps.length
  const completedSteps = steps.filter((s: any) => s.completed).length
  const nextSteps = steps.filter((s: any) => !s.completed).slice(0, 3).map((s: any) => ({ title: s.title, step_number: s.stepNumber }))
  const percentComplete = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  const daysSinceStart = checklist.created_at
    ? Math.floor((Date.now() - new Date(checklist.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0

  return c.json({
    percentComplete,
    completedSteps,
    totalSteps,
    nextSteps,
    daysSinceStart,
    successManager: checklist.assigned_manager_name
      ? { name: checklist.assigned_manager_name, email: checklist.assigned_manager_email }
      : null,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// HARDWARE
// ═══════════════════════════════════════════════════════════════════════════

// GET /hardware — List hardware catalog (no auth for browsing)
app.get('/hardware', async (c) => {
  const category = c.req.query('category')

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND category = ${category}`

  const result = await db.execute(sql`
    SELECT id, slug, name, category, description, price, image_url, specs, in_stock
    FROM hardware_products
    WHERE is_active = true
      ${categoryFilter}
    ORDER BY category ASC, name ASC
  `)

  return c.json(camelAll((result as any).rows || result))
})

// ─── Authenticated hardware ordering ────────────────────────────────────────

app.use('/hardware/orders', authenticate)
app.use('/hardware/orders/*', authenticate)

// POST /hardware/orders — Place hardware order
app.post('/hardware/orders', async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    items: z.array(z.object({
      productId: z.string().min(1),
      quantity: z.number().int().min(1),
    })).min(1),
    shippingAddress: z.object({
      street: z.string().min(1),
      city: z.string().min(1),
      state: z.string().min(1),
      zip: z.string().min(1),
      country: z.string().default('US'),
    }),
  })
  const data = orderSchema.parse(await c.req.json())

  // Fetch products and calculate total
  let total = 0
  const resolvedItems: any[] = []

  for (const item of data.items) {
    const prodResult = await db.execute(sql`
      SELECT id, name, price, in_stock FROM hardware_products
      WHERE id = ${item.productId} AND is_active = true
      LIMIT 1
    `)
    const prod = ((prodResult as any).rows || prodResult)?.[0]
    if (!prod) return c.json({ error: `Hardware product not found: ${item.productId}` }, 400)
    if (!prod.in_stock) return c.json({ error: `Product out of stock: ${prod.name}` }, 400)

    const lineTotal = Number(prod.price) * item.quantity
    total += lineTotal

    resolvedItems.push({
      productId: prod.id,
      productName: prod.name,
      quantity: item.quantity,
      unitPrice: prod.price,
      lineTotal,
    })
  }

  // Generate order number
  const orderNumber = `HW-${Date.now().toString(36).toUpperCase()}`

  // items is a json column; shipping_address is a text column — pass JSON strings and let
  // Postgres apply the assignment cast (no ::jsonb, which text/json columns reject).
  const result = await db.execute(sql`
    INSERT INTO hardware_orders (id, order_number, items, shipping_address, total, status, company_id, ordered_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${orderNumber}, ${JSON.stringify(resolvedItems)}, ${JSON.stringify(data.shippingAddress)}, ${String(total)}, 'pending', ${currentUser.companyId}, ${currentUser.userId}, NOW(), NOW())
    RETURNING *
  `)

  const hwOrder = camel(((result as any).rows || result)?.[0])

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'hardware_order',
    entityId: hwOrder?.id,
    entityName: orderNumber,
    metadata: { itemCount: data.items.length, total },
    req: c.req,
  })

  return c.json(hwOrder, 201)
})

// GET /hardware/orders — List company's hardware orders
app.get('/hardware/orders', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  const dataResult = await db.execute(sql`
    SELECT * FROM hardware_orders
    WHERE company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM hardware_orders
    WHERE company_id = ${currentUser.companyId}
  `)

  const data = camelAll((dataResult as any).rows || dataResult)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /hardware/orders/:id — Order detail with tracking
app.get('/hardware/orders/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT * FROM hardware_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const hwOrder = camel(((result as any).rows || result)?.[0])
  if (!hwOrder) return c.json({ error: 'Hardware order not found' }, 404)

  return c.json(hwOrder)
})

// GET /hardware/:slug — Hardware product detail
// Registered AFTER /hardware/orders* so the literal "orders" path is not captured as a slug.
app.get('/hardware/:slug', async (c) => {
  const slug = c.req.param('slug')

  const result = await db.execute(sql`
    SELECT * FROM hardware_products
    WHERE slug = ${slug} AND is_active = true
    LIMIT 1
  `)

  const product = camel(((result as any).rows || result)?.[0])
  if (!product) return c.json({ error: 'Hardware product not found' }, 404)

  return c.json(product)
})

export default app
