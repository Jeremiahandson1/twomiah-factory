import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Alerts ─────────────────────────────────────────────────────────────────

// List fraud alerts
app.get('/alerts', async (c) => {
  const currentUser = c.get('user') as any
  const type = c.req.query('type')
  const severity = c.req.query('severity')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  let severityFilter = sql``
  let statusFilter = sql``
  if (type) typeFilter = sql`AND fa.type = ${type}`
  if (severity) severityFilter = sql`AND fa.severity = ${severity}`
  if (status) statusFilter = sql`AND fa.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT fa.*,
           u.first_name || ' ' || u.last_name as flagged_user_name
    FROM fraud_alerts fa
    LEFT JOIN "user" u ON u.id = fa.user_id
    WHERE fa.company_id = ${currentUser.companyId}
      ${typeFilter} ${severityFilter} ${statusFilter}
    ORDER BY
      CASE fa.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      fa.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM fraud_alerts fa
    WHERE fa.company_id = ${currentUser.companyId}
      ${typeFilter} ${severityFilter} ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Mark alert as investigating
app.put('/alerts/:id/investigate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE fraud_alerts SET
      status = 'investigating',
      investigated_by_id = ${currentUser.userId},
      investigated_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Alert not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'fraud_alert',
    entityId: id,
    changes: { status: { old: updated.status, new: 'investigating' } },
    req: c.req,
  })

  return c.json(updated)
})

// Resolve alert
app.put('/alerts/:id/resolve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const resolveSchema = z.object({
    resolution: z.string().min(1),
  })
  const data = resolveSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE fraud_alerts SET
      status = 'resolved',
      resolution = ${data.resolution},
      resolved_by_id = ${currentUser.userId},
      resolved_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Alert not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'fraud_alert',
    entityId: id,
    changes: { status: { old: updated.status, new: 'resolved' } },
    metadata: { resolution: data.resolution },
    req: c.req,
  })

  return c.json(updated)
})

// Dismiss alert
app.put('/alerts/:id/dismiss', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const dismissSchema = z.object({
    reason: z.string().min(1),
  })
  const data = dismissSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE fraud_alerts SET
      status = 'dismissed',
      resolution = ${data.reason},
      resolved_by_id = ${currentUser.userId},
      resolved_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Alert not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'fraud_alert',
    entityId: id,
    changes: { status: { old: updated.status, new: 'dismissed' } },
    metadata: { reason: data.reason },
    req: c.req,
  })

  return c.json(updated)
})

// ─── Rules ──────────────────────────────────────────────────────────────────

// List fraud rules
app.get('/rules', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const dataResult = await db.execute(sql`
    SELECT * FROM fraud_rules
    WHERE company_id = ${currentUser.companyId}
    ORDER BY type ASC, created_at ASC
  `)

  const data = (dataResult as any).rows || dataResult
  return c.json({ data })
})

// Create fraud rule (admin)
app.post('/rules', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  const ruleSchema = z.object({
    name: z.string().min(1),
    type: z.enum([
      'void_threshold',
      'discount_threshold',
      'cash_variance_threshold',
      'inventory_variance_pct',
      'after_hours_login',
      'rapid_transactions',
    ]),
    threshold: z.number(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    description: z.string().optional(),
    enabled: z.boolean().default(true),
  })
  const data = ruleSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO fraud_rules(id, name, type, threshold, severity, description, enabled, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.type}, ${data.threshold}, ${data.severity}, ${data.description || null}, ${data.enabled}, ${currentUser.companyId}, NOW())
    RETURNING *
  `)
  const rule = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'fraud_rule',
    entityId: rule?.id,
    entityName: data.name,
    metadata: { type: data.type, threshold: data.threshold },
    req: c.req,
  })

  return c.json(rule, 201)
})

// Update fraud rule
app.put('/rules/:id', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    threshold: z.number().optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM fraud_rules WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Rule not found' }, 404)

  const result = await db.execute(sql`
    UPDATE fraud_rules SET
      name = COALESCE(${data.name || null}, name),
      threshold = COALESCE(${data.threshold ?? null}, threshold),
      severity = COALESCE(${data.severity || null}, severity),
      description = COALESCE(${data.description || null}, description),
      enabled = COALESCE(${data.enabled ?? null}, enabled),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'fraud_rule',
    entityId: id,
    entityName: updated?.name,
    changes: audit.diff(existing, updated),
    req: c.req,
  })

  return c.json(updated)
})

// Deactivate fraud rule
app.delete('/rules/:id', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE fraud_rules SET enabled = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Rule not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'fraud_rule',
    entityId: id,
    entityName: updated.name,
    req: c.req,
  })

  return c.json({ message: 'Rule deactivated' })
})

// ─── Detection Scan ─────────────────────────────────────────────────────────

app.post('/scan', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Load all active rules
  const rulesResult = await db.execute(sql`
    SELECT * FROM fraud_rules WHERE company_id = ${currentUser.companyId} AND enabled = true
  `)
  const rules = (rulesResult as any).rows || rulesResult

  const alertsGenerated: any[] = []

  async function createAlert(type: string, severity: string, userId: string | null, description: string, metadata: any) {
    const result = await db.execute(sql`
      INSERT INTO fraud_alerts(id, type, severity, status, user_id, description, metadata, company_id, created_at)
      VALUES (gen_random_uuid(), ${type}, ${severity}, 'open', ${userId}, ${description}, ${JSON.stringify(metadata)}::jsonb, ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const alert = ((result as any).rows || result)?.[0]
    alertsGenerated.push(alert)
  }

  for (const rule of rules) {
    switch (rule.type) {
      // 1. Void threshold: count voids per budtender this shift
      case 'void_threshold': {
        const voidsResult = await db.execute(sql`
          SELECT o.budtender_id as user_id,
                 u.first_name || ' ' || u.last_name as user_name,
                 COUNT(*)::int as void_count
          FROM orders o
          LEFT JOIN "user" u ON u.id = o.budtender_id
          WHERE o.company_id = ${currentUser.companyId}
            AND o.status = 'cancelled'
            AND o.updated_at >= NOW() - INTERVAL '8 hours'
          GROUP BY o.budtender_id, u.first_name, u.last_name
          HAVING COUNT(*) > ${rule.threshold}
        `)
        const voids = (voidsResult as any).rows || voidsResult
        for (const v of voids) {
          await createAlert('void_threshold', rule.severity, v.user_id,
            `${v.user_name} voided ${v.void_count} orders this shift (threshold: ${rule.threshold})`,
            { voidCount: v.void_count, threshold: rule.threshold })
        }
        break
      }

      // 2. Discount threshold: sum discounts per budtender today
      case 'discount_threshold': {
        const discountsResult = await db.execute(sql`
          SELECT o.budtender_id as user_id,
                 u.first_name || ' ' || u.last_name as user_name,
                 SUM(o.discount_amount::numeric)::numeric(10,2) as total_discounts
          FROM orders o
          LEFT JOIN "user" u ON u.id = o.budtender_id
          WHERE o.company_id = ${currentUser.companyId}
            AND o.discount_amount::numeric > 0
            AND o.created_at >= CURRENT_DATE
          GROUP BY o.budtender_id, u.first_name, u.last_name
          HAVING SUM(o.discount_amount::numeric) > ${rule.threshold}
        `)
        const discounts = (discountsResult as any).rows || discountsResult
        for (const d of discounts) {
          await createAlert('discount_threshold', rule.severity, d.user_id,
            `${d.user_name} applied $${d.total_discounts} in discounts today (threshold: $${rule.threshold})`,
            { totalDiscounts: Number(d.total_discounts), threshold: rule.threshold })
        }
        break
      }

      // 3. Cash variance threshold
      case 'cash_variance_threshold': {
        const varianceResult = await db.execute(sql`
          SELECT cs.id, cs.register, cs.variance,
                 cu.first_name || ' ' || cu.last_name as closed_by_name,
                 cs.closed_by_id as user_id
          FROM cash_sessions cs
          LEFT JOIN "user" cu ON cu.id = cs.closed_by_id
          WHERE cs.company_id = ${currentUser.companyId}
            AND cs.status = 'closed'
            AND ABS(cs.variance::numeric) > ${rule.threshold}
            AND cs.closed_at >= NOW() - INTERVAL '24 hours'
        `)
        const variances = (varianceResult as any).rows || varianceResult
        for (const v of variances) {
          await createAlert('cash_variance_threshold', rule.severity, v.user_id,
            `Cash variance of $${Math.abs(Number(v.variance)).toFixed(2)} on register "${v.register}" (threshold: $${rule.threshold})`,
            { variance: Number(v.variance), register: v.register, sessionId: v.id })
        }
        break
      }

      // 4. Inventory variance percentage
      case 'inventory_variance_pct': {
        const invResult = await db.execute(sql`
          SELECT p.id, p.name, p.sku,
                 p.stock_quantity::numeric as system_qty,
                 COALESCE(ic.counted_qty, 0)::numeric as counted_qty,
                 CASE WHEN p.stock_quantity::numeric > 0
                   THEN ABS(p.stock_quantity::numeric - COALESCE(ic.counted_qty, 0)) / p.stock_quantity::numeric * 100
                   ELSE 0
                 END as variance_pct
          FROM products p
          LEFT JOIN (
            SELECT product_id, counted_qty FROM inventory_adjustments
            WHERE company_id = ${currentUser.companyId}
            AND created_at >= NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
          ) ic ON ic.product_id = p.id
          WHERE p.company_id = ${currentUser.companyId}
            AND p.track_inventory = true
            AND ic.counted_qty IS NOT NULL
          HAVING CASE WHEN p.stock_quantity::numeric > 0
            THEN ABS(p.stock_quantity::numeric - COALESCE(ic.counted_qty, 0)) / p.stock_quantity::numeric * 100
            ELSE 0 END > ${rule.threshold}
        `)
        const invVariances = (invResult as any).rows || invResult
        for (const iv of invVariances) {
          await createAlert('inventory_variance_pct', rule.severity, null,
            `Inventory variance ${Number(iv.variance_pct).toFixed(1)}% for "${iv.name}" (threshold: ${rule.threshold}%)`,
            { productId: iv.id, productName: iv.name, systemQty: Number(iv.system_qty), countedQty: Number(iv.counted_qty), variancePct: Number(iv.variance_pct) })
        }
        break
      }

      // 5. After hours login
      case 'after_hours_login': {
        const afterHoursResult = await db.execute(sql`
          SELECT al.user_id,
                 al.user_name,
                 al.created_at as login_at,
                 EXTRACT(HOUR FROM al.created_at)::int as hour
          FROM audit_log al
          WHERE al.company_id = ${currentUser.companyId}
            AND al.action = 'login'
            AND al.created_at >= NOW() - INTERVAL '24 hours'
            AND (EXTRACT(HOUR FROM al.created_at) < 6 OR EXTRACT(HOUR FROM al.created_at) > 23)
        `)
        const afterHours = (afterHoursResult as any).rows || afterHoursResult
        for (const ah of afterHours) {
          await createAlert('after_hours_login', rule.severity, ah.user_id,
            `After-hours login by ${ah.user_name} at ${new Date(ah.login_at).toLocaleTimeString()}`,
            { loginAt: ah.login_at, hour: ah.hour })
        }
        break
      }

      // 6. Rapid transactions (< 30 seconds apart)
      case 'rapid_transactions': {
        const rapidResult = await db.execute(sql`
          SELECT o1.budtender_id as user_id,
                 u.first_name || ' ' || u.last_name as user_name,
                 COUNT(*)::int as rapid_count
          FROM orders o1
          JOIN orders o2 ON o1.budtender_id = o2.budtender_id
            AND o1.id != o2.id
            AND ABS(EXTRACT(EPOCH FROM o1.completed_at - o2.completed_at)) < 30
            AND o1.completed_at > o2.completed_at
          LEFT JOIN "user" u ON u.id = o1.budtender_id
          WHERE o1.company_id = ${currentUser.companyId}
            AND o1.status = 'completed'
            AND o1.completed_at >= NOW() - INTERVAL '8 hours'
          GROUP BY o1.budtender_id, u.first_name, u.last_name
          HAVING COUNT(*) > ${rule.threshold}
        `)
        const rapid = (rapidResult as any).rows || rapidResult
        for (const r of rapid) {
          await createAlert('rapid_transactions', rule.severity, r.user_id,
            `${r.user_name} had ${r.rapid_count} rapid transactions (<30s apart) this shift (threshold: ${rule.threshold})`,
            { rapidCount: r.rapid_count, threshold: rule.threshold })
        }
        break
      }
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'fraud_scan',
    entityName: 'Fraud detection scan',
    metadata: { rulesChecked: rules.length, alertsGenerated: alertsGenerated.length },
    req: c.req,
  })

  return c.json({
    message: `Scan complete: ${alertsGenerated.length} alert(s) generated`,
    rulesChecked: rules.length,
    alertsGenerated,
  })
})

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get('/dashboard', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Open alerts by severity
  const bySeverityResult = await db.execute(sql`
    SELECT severity, COUNT(*)::int as count
    FROM fraud_alerts
    WHERE company_id = ${currentUser.companyId} AND status = 'open'
    GROUP BY severity
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END
  `)

  // Recent alerts (last 7 days)
  const recentResult = await db.execute(sql`
    SELECT fa.*,
           u.first_name || ' ' || u.last_name as flagged_user_name
    FROM fraud_alerts fa
    LEFT JOIN "user" u ON u.id = fa.user_id
    WHERE fa.company_id = ${currentUser.companyId}
      AND fa.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY fa.created_at DESC
    LIMIT 20
  `)

  // Top flagged employees
  const topFlaggedResult = await db.execute(sql`
    SELECT fa.user_id,
           u.first_name || ' ' || u.last_name as user_name,
           COUNT(*)::int as alert_count,
           COUNT(*) FILTER (WHERE fa.status = 'open')::int as open_count
    FROM fraud_alerts fa
    LEFT JOIN "user" u ON u.id = fa.user_id
    WHERE fa.company_id = ${currentUser.companyId}
      AND fa.user_id IS NOT NULL
      AND fa.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY fa.user_id, u.first_name, u.last_name
    ORDER BY alert_count DESC
    LIMIT 10
  `)

  // Shrinkage estimate (inventory variance $)
  const shrinkageResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(
        ABS(p.stock_quantity::numeric - COALESCE(ic.counted_qty, p.stock_quantity)::numeric) * p.price::numeric
      ), 0)::numeric(10,2) as estimated_shrinkage,
      COUNT(*)::int as products_with_variance
    FROM products p
    LEFT JOIN (
      SELECT DISTINCT ON (product_id) product_id, counted_qty
      FROM inventory_adjustments
      WHERE company_id = ${currentUser.companyId}
      ORDER BY product_id, created_at DESC
    ) ic ON ic.product_id = p.id
    WHERE p.company_id = ${currentUser.companyId}
      AND p.track_inventory = true
      AND ic.counted_qty IS NOT NULL
      AND p.stock_quantity::numeric != ic.counted_qty::numeric
  `)

  const bySeverity = (bySeverityResult as any).rows || bySeverityResult
  const recent = (recentResult as any).rows || recentResult
  const topFlagged = (topFlaggedResult as any).rows || topFlaggedResult
  const shrinkage = ((shrinkageResult as any).rows || shrinkageResult)?.[0] || { estimated_shrinkage: 0, products_with_variance: 0 }

  return c.json({
    openAlertsBySeverity: bySeverity,
    recentAlerts: recent,
    topFlaggedEmployees: topFlagged,
    shrinkage: {
      estimatedLoss: Number(shrinkage.estimated_shrinkage),
      productsWithVariance: Number(shrinkage.products_with_variance),
    },
  })
})

export default app
