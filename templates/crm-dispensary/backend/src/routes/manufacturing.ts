import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case, but the frontend reads camelCase — so fields
// (job_number, operator_name, output_weight, yield_percentage, etc.) rendered blank.
// Convert row keys to camelCase before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// Stats tiles: active jobs, average yield of completed runs, throughput this week.
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
      ROUND(AVG(NULLIF(regexp_replace(COALESCE(yield, ''), '[^0-9.]', '', 'g'), '')::numeric)
        FILTER (WHERE status = 'completed'), 1) as avg_yield,
      COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '7 days')::int as completed_this_week
    FROM manufacturing_jobs
    WHERE company_id = ${cid}
  `)
  const row = ((result as any).rows || result)?.[0] || {}

  return c.json({
    inProgress: Number(row.in_progress || 0),
    avgYield: row.avg_yield != null ? Number(row.avg_yield) : null,
    completedThisWeek: Number(row.completed_this_week || 0),
  })
})

// List manufacturing jobs (paginated, filterable)
app.get('/jobs', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const type = c.req.query('type')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND mj.status = ${status}`

  let typeFilter = sql``
  if (type) typeFilter = sql`AND mj.type = ${type}`

  const dataResult = await db.execute(sql`
    SELECT mj.*, u.first_name || ' ' || u.last_name as operator_name
    FROM manufacturing_jobs mj
    LEFT JOIN "user" u ON u.id = mj.operator_id
    WHERE mj.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${typeFilter}
    ORDER BY mj.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM manufacturing_jobs mj
    WHERE mj.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${typeFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Job detail
app.get('/jobs/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT mj.*, u.first_name || ' ' || u.last_name as operator_name
    FROM manufacturing_jobs mj
    LEFT JOIN "user" u ON u.id = mj.operator_id
    WHERE mj.id = ${id} AND mj.company_id = ${currentUser.companyId}
  `)

  const job = ((result as any).rows || result)?.[0]
  if (!job) return c.json({ error: 'Manufacturing job not found' }, 404)

  return c.json(camel(job))
})

// Create manufacturing job
app.post('/jobs', async (c) => {
  const currentUser = c.get('user') as any

  const jobSchema = z.object({
    jobNumber: z.string().optional(),
    type: z.enum(['extraction', 'infusion', 'edible', 'concentrate', 'topical', 'pre_roll', 'packaging', 'other']),
    inputBatches: z.array(z.object({
      batchId: z.string(),
      quantity: z.number().min(0),
      unit: z.string().optional(),
    })),
    inputWeight: z.coerce.number().min(0).optional(),
    method: z.string().optional(),
    equipment: z.string().optional(),
    operatorId: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = jobSchema.parse(await c.req.json())

  // Auto-generate job number if empty
  const jobNumber = data.jobNumber || `MFG-${Date.now().toString(36).toUpperCase()}`

  // input_weight is the real denominator for yield% (F-20). If the dialog omits it, fall back to
  // the summed input-batch quantities so yield is at least computed against the same basis.
  const totalInputQty = (data.inputBatches || []).reduce((s: number, b: any) => s + (b.quantity || 0), 0)
  const inputWeight = data.inputWeight != null ? data.inputWeight : totalInputQty

  const result = await db.execute(sql`
    INSERT INTO manufacturing_jobs(id, company_id, job_number, type, input_batches, input_weight, method, equipment, operator_id, notes, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${jobNumber}, ${data.type}, ${JSON.stringify(data.inputBatches)}::jsonb, ${String(inputWeight)}, ${data.method || null}, ${data.equipment || null}, ${data.operatorId || null}, ${data.notes || null}, 'pending', NOW(), NOW())
    RETURNING *
  `)

  const job = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'manufacturing_jobs',
    entityId: job?.id,
    entityName: jobNumber,
    req: c.req,
  })

  return c.json(camel(job), 201)
})

// Update manufacturing job
app.put('/jobs/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const jobSchema = z.object({
    type: z.enum(['extraction', 'infusion', 'edible', 'concentrate', 'topical', 'pre_roll', 'packaging', 'other']).optional(),
    inputBatches: z.array(z.object({
      batchId: z.string(),
      quantity: z.number().min(0),
      unit: z.string().optional(),
    })).optional(),
    method: z.string().optional(),
    equipment: z.string().optional(),
    operatorId: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = jobSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.inputBatches !== undefined) sets.push(sql`input_batches = ${JSON.stringify(data.inputBatches)}::jsonb`)
  if (data.method !== undefined) sets.push(sql`method = ${data.method}`)
  if (data.equipment !== undefined) sets.push(sql`equipment = ${data.equipment}`)
  if (data.operatorId !== undefined) sets.push(sql`operator_id = ${data.operatorId}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE manufacturing_jobs SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Job not found or already started' }, 404)

  return c.json(camel(updated))
})

// Start job
app.put('/jobs/:id/start', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM manufacturing_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Job not found' }, 404)
  if (existing.status !== 'pending') return c.json({ error: `Cannot start job with status '${existing.status}'` }, 400)

  const result = await db.execute(sql`
    UPDATE manufacturing_jobs
    SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'manufacturing_jobs',
    entityId: id,
    entityName: existing.job_number,
    changes: { status: { old: 'pending', new: 'in_progress' } },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Complete job
app.put('/jobs/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const completeSchema = z.object({
    outputBatches: z.array(z.object({
      productId: z.string().optional(),
      batchNumber: z.string().optional(),
      quantity: z.number().min(0),
      unit: z.string().optional(),
      metrcTag: z.string().optional(),
    })),
    outputWeight: z.number().min(0),
    qualityNotes: z.string().optional(),
  })
  const data = completeSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM manufacturing_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Job not found' }, 404)
  if (existing.status !== 'in_progress') return c.json({ error: `Cannot complete job with status '${existing.status}'` }, 400)

  // Yield% is output weight / INPUT WEIGHT, not / input batch count (F-20: a 4-batch job read
  // 20/4 = 500%). Use the stored input_weight; only fall back to summed batch quantities if unset.
  const inputBatches = typeof existing.input_batches === 'string' ? JSON.parse(existing.input_batches) : existing.input_batches
  const totalInputQty = (inputBatches || []).reduce((sum: number, b: any) => sum + (b.quantity || 0), 0)
  const inputWeight = Number(existing.input_weight) > 0 ? Number(existing.input_weight) : totalInputQty
  const yieldPercentage = inputWeight > 0 ? ((data.outputWeight / inputWeight) * 100) : null

  // schema.ts columns: yield (NOT yield_percentage); output_weight is TEXT. Match them or the
  // UPDATE 500s (F-15). There is no failure_reason/failed_at pair here — see the fail handler.
  const result = await db.execute(sql`
    UPDATE manufacturing_jobs
    SET status = 'completed',
        output_batches = ${JSON.stringify(data.outputBatches)}::jsonb,
        output_weight = ${String(data.outputWeight)},
        yield = ${yieldPercentage != null ? yieldPercentage.toFixed(2) : null},
        quality_notes = ${data.qualityNotes || null},
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'manufacturing_jobs',
    entityId: id,
    entityName: existing.job_number,
    changes: { status: { old: 'in_progress', new: 'completed' }, outputWeight: data.outputWeight, yieldPercentage },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Mark job as failed
app.put('/jobs/:id/fail', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const failSchema = z.object({
    reason: z.string().min(1),
  })
  const data = failSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM manufacturing_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Job not found' }, 404)
  if (existing.status === 'completed' || existing.status === 'failed') {
    return c.json({ error: `Cannot fail job with status '${existing.status}'` }, 400)
  }

  const result = await db.execute(sql`
    UPDATE manufacturing_jobs
    SET status = 'failed', failure_reason = ${data.reason}, failed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'manufacturing_jobs',
    entityId: id,
    entityName: existing.job_number,
    changes: { status: { old: existing.status, new: 'failed' }, reason: data.reason },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Delete manufacturing job
app.delete('/jobs/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM manufacturing_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // F-40: only a not-yet-started (pending) job may be deleted. Once a job is in_progress or
  // completed it has consumed its input batches and (if completed) produced output/yield —
  // deleting it corrupts the production record. Refuse anything past pending.
  if (existing.status !== 'pending') {
    return c.json({ error: `Cannot delete a '${existing.status}' manufacturing job — it is part of the production record.` }, 409)
  }

  await db.execute(sql`
    DELETE FROM manufacturing_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'manufacturing_jobs',
    entityId: id,
    entityName: existing.job_number,
    req: c.req,
  })

  return c.json({ success: true })
})

export default app
