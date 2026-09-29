import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole, requireOwnership } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Clocking in and out is the employee's OWN shift. Both routes resolved the shift by company_id
// alone, so any signed-in user could clock a colleague in or out — a payroll write on someone
// else's timesheet — while the sibling /shifts/:id/swap-request has always matched user_id too.
// requireOwnership lets manager and above act for another person (covering a missed punch) and
// holds everyone below to their own row. A shift that does not exist yields '' and so is refused
// with 403 rather than 404, which also removes an existence oracle.
const shiftOwnerId = async (c: any): Promise<string> => {
  const u = c.get('user') as any
  const r = await db.execute(sql`
    SELECT user_id FROM shifts WHERE id = ${c.req.param('id')} AND company_id = ${u.companyId} LIMIT 1
  `)
  return ((r as any).rows || r)?.[0]?.user_id ?? ''
}

// Raw db.execute rows come back snake_case; the frontend reads camelCase
// (employeeName, clockIn, clockOut, …). Convert row keys before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

// List shifts
app.get('/shifts', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const locationId = c.req.query('locationId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let userFilter = sql``
  let locationFilter = sql``
  let startFilter = sql``
  let endFilter = sql``
  let statusFilter = sql``
  if (userId) userFilter = sql`AND s.user_id = ${userId}`
  if (locationId) locationFilter = sql`AND s.location_id = ${locationId}`
  if (startDate) startFilter = sql`AND s.date >= ${startDate}`
  if (endDate) endFilter = sql`AND s.date <= ${endDate}`
  if (status) statusFilter = sql`AND s.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT s.*,
           u.first_name || ' ' || u.last_name as user_name,
           u.email as user_email
    FROM shifts s
    LEFT JOIN "user" u ON u.id = s.user_id
    WHERE s.company_id = ${currentUser.companyId}
      ${userFilter} ${locationFilter} ${startFilter} ${endFilter} ${statusFilter}
    ORDER BY s.date ASC, s.start_time ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM shifts s
    WHERE s.company_id = ${currentUser.companyId}
      ${userFilter} ${locationFilter} ${startFilter} ${endFilter} ${statusFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create shift(s) — supports bulk creation via array
app.post('/shifts', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const shiftSchema = z.object({
    userId: z.string().min(1),
    // Dialog sends locationId as '' when no location is chosen; accept it (stored as NULL below).
    locationId: z.string().optional(),
    role: z.string().default('budtender'),
    date: z.string(), // YYYY-MM-DD
    startTime: z.string(), // HH:MM
    endTime: z.string(),
    breakMinutes: z.coerce.number().int().min(0).default(0),
  })

  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'Invalid JSON body' }, 400)
  const items = Array.isArray(body) ? body : [body]

  let parsed: z.infer<typeof shiftSchema>[]
  try {
    parsed = items.map(item => shiftSchema.parse(item))
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // A rota is a promise about who is behind the counter and when, and it is what the payroll
  // export is computed from. T45 M12: a shift ending before it started, two overlapping shifts for
  // one person, and a 600-minute break inside an 8-hour shift were all accepted — so the schedule
  // could say things that cannot happen and the hours derived from it were nonsense.
  const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  for (const shift of parsed) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(shift.date)) {
      return c.json({ error: `"${shift.date}" is not a date (use YYYY-MM-DD)` }, 400)
    }
    if (!HHMM.test(shift.startTime) || !HHMM.test(shift.endTime)) {
      return c.json({ error: 'Start and end must be times of day, such as 09:00' }, 400)
    }
    const span = minutes(shift.endTime) - minutes(shift.startTime)
    if (span <= 0) {
      return c.json({
        error: `A shift ending at ${shift.endTime} cannot start at ${shift.startTime}`,
        code: 'shift_ends_before_it_starts',
      }, 400)
    }
    if (shift.breakMinutes >= span) {
      return c.json({
        error: `A ${shift.breakMinutes}-minute break does not fit in a shift of ${span} minutes`,
        code: 'break_longer_than_shift',
      }, 400)
    }

    // Nobody is in two places at once. An overlap is almost always a rota mistake, and the one
    // time it is not, the manager can move the existing shift first.
    const clash = await db.execute(sql`
      SELECT id, start_time, end_time FROM shifts
      WHERE company_id = ${currentUser.companyId}
        AND user_id = ${shift.userId}
        AND date = ${shift.date}
        AND status NOT IN ('cancelled', 'no_show')
        AND start_time < ${shift.endTime}
        AND end_time > ${shift.startTime}
      LIMIT 1
    `)
    const clashing = ((clash as any).rows || clash)?.[0]
    if (clashing) {
      return c.json({
        error: `That person is already on ${shift.date} from ${clashing.start_time} to ${clashing.end_time}`,
        code: 'shift_overlaps',
      }, 400)
    }
  }

  const created: any[] = []
  for (const shift of parsed) {
    const result = await db.execute(sql`
      INSERT INTO shifts(id, user_id, location_id, role, date, start_time, end_time, break_minutes, status, company_id, created_at)
      VALUES (gen_random_uuid(), ${shift.userId}, ${shift.locationId || null}, ${shift.role}, ${shift.date}, ${shift.startTime}, ${shift.endTime}, ${shift.breakMinutes}, 'scheduled', ${currentUser.companyId}, NOW())
      RETURNING *
    `)
    const row = ((result as any).rows || result)?.[0]
    created.push(row)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'shift',
    entityName: `${created.length} shift(s)`,
    metadata: { count: created.length, dates: parsed.map(s => s.date) },
    req: c,
  })

  return c.json(created.length === 1 ? camel(created[0]) : created.map(camel), 201)
})

// Update shift
app.put('/shifts/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    userId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    role: z.string().optional(),
    date: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    breakMinutes: z.number().int().min(0).optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  // Verify exists
  const existingResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Shift not found' }, 404)

  const result = await db.execute(sql`
    UPDATE shifts SET
      user_id = COALESCE(${data.userId || null}, user_id),
      location_id = COALESCE(${data.locationId || null}, location_id),
      role = COALESCE(${data.role || null}, role),
      date = COALESCE(${data.date || null}, date),
      start_time = COALESCE(${data.startTime || null}, start_time),
      end_time = COALESCE(${data.endTime || null}, end_time),
      break_minutes = COALESCE(${data.breakMinutes ?? null}, break_minutes),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'shift',
    entityId: id,
    changes: audit.diff(existing, updated),
    req: c,
  })

  return c.json(camel(updated))
})

// Cancel shift
app.delete('/shifts/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE shifts SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Shift not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'shift',
    entityId: id,
    changes: { status: { old: 'scheduled', new: 'cancelled' } },
    req: c,
  })

  return c.json(camel(updated))
})

// Clock in
app.post('/shifts/:id/clock-in', requireRole('budtender'), requireOwnership(shiftOwnerId), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Shift not found' }, 404)
  if (existing.status !== 'scheduled') return c.json({ error: `Cannot clock in: shift status is ${existing.status}` }, 400)

  const result = await db.execute(sql`
    UPDATE shifts SET
      clock_in_at = NOW(),
      status = 'clocked_in',
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'shift',
    entityId: id,
    changes: { status: { old: 'scheduled', new: 'clocked_in' } },
    req: c,
  })

  return c.json(camel(updated))
})

// Clock out
app.post('/shifts/:id/clock-out', requireRole('budtender'), requireOwnership(shiftOwnerId), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Shift not found' }, 404)
  if (existing.status !== 'clocked_in') return c.json({ error: `Cannot clock out: shift status is ${existing.status}` }, 400)

  // Calculate actual hours worked
  const clockInTime = new Date(existing.clock_in_at)
  const clockOutTime = new Date()
  const diffMs = clockOutTime.getTime() - clockInTime.getTime()
  const totalMinutes = diffMs / 60000 - (existing.break_minutes || 0)
  const actualHours = Math.round((totalMinutes / 60) * 100) / 100
  const overtimeHours = actualHours > 8 ? Math.round((actualHours - 8) * 100) / 100 : 0

  const result = await db.execute(sql`
    UPDATE shifts SET
      clock_out_at = NOW(),
      actual_hours = ${actualHours},
      overtime_hours = ${overtimeHours},
      status = 'clocked_out',
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'shift',
    entityId: id,
    changes: { status: { old: 'clocked_in', new: 'clocked_out' } },
    metadata: { actualHours, overtimeHours },
    req: c,
  })

  return c.json(camel(updated))
})

// Request shift swap
app.post('/shifts/:id/swap-request', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const swapSchema = z.object({
    swapWithUserId: z.string().min(1),
  })
  const data = swapSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} AND user_id = ${currentUser.userId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Shift not found or not your shift' }, 404)

  const result = await db.execute(sql`
    UPDATE shifts SET
      swap_requested = true,
      swap_with_user_id = ${data.swapWithUserId},
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'shift',
    entityId: id,
    entityName: 'Swap request',
    metadata: { swapWithUserId: data.swapWithUserId },
    req: c,
  })

  return c.json(camel(updated))
})

// Approve shift swap (manager+)
app.put('/shifts/:id/swap-approve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const shiftResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} AND swap_requested = true LIMIT 1
  `)
  const shift = ((shiftResult as any).rows || shiftResult)?.[0]
  if (!shift) return c.json({ error: 'Shift not found or no swap requested' }, 404)
  if (!shift.swap_with_user_id) return c.json({ error: 'No swap target specified' }, 400)

  // Find the target user's shift for the same date to swap
  const targetShiftResult = await db.execute(sql`
    SELECT * FROM shifts
    WHERE company_id = ${currentUser.companyId}
      AND user_id = ${shift.swap_with_user_id}
      AND date = ${shift.date}
      AND status = 'scheduled'
    LIMIT 1
  `)
  const targetShift = ((targetShiftResult as any).rows || targetShiftResult)?.[0]

  const originalUserId = shift.user_id
  const swapUserId = shift.swap_with_user_id

  if (targetShift) {
    // Swap both shifts' users
    await db.execute(sql`
      UPDATE shifts SET user_id = ${swapUserId}, swap_requested = false, swap_with_user_id = NULL, updated_at = NOW()
      WHERE id = ${id}
    `)
    await db.execute(sql`
      UPDATE shifts SET user_id = ${originalUserId}, updated_at = NOW()
      WHERE id = ${targetShift.id}
    `)
  } else {
    // Just reassign this shift to the swap user
    await db.execute(sql`
      UPDATE shifts SET user_id = ${swapUserId}, swap_requested = false, swap_with_user_id = NULL, updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'shift',
    entityId: id,
    entityName: 'Swap approved',
    metadata: { originalUserId, swapUserId, targetShiftId: targetShift?.id || null },
    req: c,
  })

  return c.json({ message: 'Swap approved', shiftId: id, targetShiftId: targetShift?.id || null })
})

// Approve/reject a swap request (manager+). The Scheduling page lists swap requests as shifts
// with swap_requested = true and posts /swap-requests/:id/:action where :id is the SHIFT id.
// approve reassigns the shift (reusing the swap-approve logic); reject clears the pending request.
app.post('/swap-requests/:id/:action', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const action = c.req.param('action')

  if (action !== 'approve' && action !== 'reject') {
    return c.json({ error: `Unknown swap action: ${action}` }, 400)
  }

  const shiftResult = await db.execute(sql`
    SELECT * FROM shifts WHERE id = ${id} AND company_id = ${currentUser.companyId} AND swap_requested = true LIMIT 1
  `)
  const shift = ((shiftResult as any).rows || shiftResult)?.[0]
  if (!shift) return c.json({ error: 'Shift not found or no swap requested' }, 404)

  if (action === 'reject') {
    await db.execute(sql`
      UPDATE shifts SET swap_requested = false, swap_with_user_id = NULL, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${currentUser.companyId}
    `)
    audit.log({
      action: audit.ACTIONS.UPDATE,
      entity: 'shift',
      entityId: id,
      entityName: 'Swap rejected',
      req: c,
    })
    return c.json({ message: 'Swap rejected', shiftId: id })
  }

  // approve
  if (!shift.swap_with_user_id) return c.json({ error: 'No swap target specified' }, 400)

  const targetShiftResult = await db.execute(sql`
    SELECT * FROM shifts
    WHERE company_id = ${currentUser.companyId}
      AND user_id = ${shift.swap_with_user_id}
      AND date = ${shift.date}
      AND status = 'scheduled'
    LIMIT 1
  `)
  const targetShift = ((targetShiftResult as any).rows || targetShiftResult)?.[0]

  const originalUserId = shift.user_id
  const swapUserId = shift.swap_with_user_id

  if (targetShift) {
    await db.execute(sql`
      UPDATE shifts SET user_id = ${swapUserId}, swap_requested = false, swap_with_user_id = NULL, updated_at = NOW()
      WHERE id = ${id}
    `)
    await db.execute(sql`
      UPDATE shifts SET user_id = ${originalUserId}, updated_at = NOW()
      WHERE id = ${targetShift.id}
    `)
  } else {
    await db.execute(sql`
      UPDATE shifts SET user_id = ${swapUserId}, swap_requested = false, swap_with_user_id = NULL, updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'shift',
    entityId: id,
    entityName: 'Swap approved',
    metadata: { originalUserId, swapUserId, targetShiftId: targetShift?.id || null },
    req: c,
  })

  return c.json({ message: 'Swap approved', shiftId: id, targetShiftId: targetShift?.id || null })
})

// ─── Schedule Templates ─────────────────────────────────────────────────────

// List templates
app.get('/templates', async (c) => {
  const currentUser = c.get('user') as any

  const dataResult = await db.execute(sql`
    SELECT * FROM schedule_templates
    WHERE company_id = ${currentUser.companyId}
    ORDER BY name ASC
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  return c.json({ data })
})

// Create template
app.post('/templates', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const templateSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    pattern: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6), // 0=Sunday
      userId: z.string().min(1).optional(),
      role: z.string().default('budtender'),
      startTime: z.string(),
      endTime: z.string(),
      breakMinutes: z.number().int().min(0).default(0),
    })),
  })
  const data = templateSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO schedule_templates(id, name, description, pattern, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${JSON.stringify(data.pattern)}::jsonb, ${currentUser.companyId}, NOW())
    RETURNING *
  `)
  const template = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'schedule_template',
    entityId: template?.id,
    entityName: data.name,
    req: c,
  })

  return c.json(camel(template), 201)
})

// Apply template to date range
app.post('/templates/:id/apply', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const applySchema = z.object({
    startDate: z.string(), // YYYY-MM-DD
    endDate: z.string(),
    locationId: z.string().min(1).optional(),
  })
  const data = applySchema.parse(await c.req.json())

  // Fetch template
  const templateResult = await db.execute(sql`
    SELECT * FROM schedule_templates WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const template = ((templateResult as any).rows || templateResult)?.[0]
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const pattern = typeof template.pattern === 'string' ? JSON.parse(template.pattern) : template.pattern
  const start = new Date(data.startDate)
  const end = new Date(data.endDate)
  const createdShifts: any[] = []

  // Iterate each day in range
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay()
    const dateStr = d.toISOString().split('T')[0]

    const dayEntries = pattern.filter((p: any) => p.dayOfWeek === dayOfWeek)
    for (const entry of dayEntries) {
      if (!entry.userId) continue // skip entries without assigned user

      const result = await db.execute(sql`
        INSERT INTO shifts(id, user_id, location_id, role, date, start_time, end_time, break_minutes, status, company_id, created_at)
        VALUES (gen_random_uuid(), ${entry.userId}, ${data.locationId || null}, ${entry.role || 'budtender'}, ${dateStr}, ${entry.startTime}, ${entry.endTime}, ${entry.breakMinutes || 0}, 'scheduled', ${currentUser.companyId}, NOW())
        RETURNING *
      `)
      const row = ((result as any).rows || result)?.[0]
      createdShifts.push(row)
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'shift',
    entityName: `Template "${template.name}" applied`,
    metadata: { templateId: id, startDate: data.startDate, endDate: data.endDate, shiftsCreated: createdShifts.length },
    req: c,
  })

  return c.json({ message: 'Template applied', shiftsCreated: createdShifts.length, shifts: createdShifts.map(camel) }, 201)
})

// ─── Time Entries ───────────────────────────────────────────────────────────

// List time entries
app.get('/time-entries', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const approved = c.req.query('approved')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let userFilter = sql``
  let startFilter = sql``
  let endFilter = sql``
  let approvedFilter = sql``
  // time_entries has no `date` or boolean `approved` column; the work date is derived
  // from clock_in and approval is represented by approved_at being set. (schema.ts is truth)
  if (userId) userFilter = sql`AND te.user_id = ${userId}`
  if (startDate) startFilter = sql`AND te.clock_in::date >= ${startDate}::date`
  if (endDate) endFilter = sql`AND te.clock_in::date <= ${endDate}::date`
  if (approved !== undefined) approvedFilter = approved === 'true' ? sql`AND te.approved_at IS NOT NULL` : sql`AND te.approved_at IS NULL`

  const dataResult = await db.execute(sql`
    SELECT te.*,
           u.first_name || ' ' || u.last_name as employee_name,
           te.clock_in::date as date,
           ROUND(COALESCE(te.total_minutes, 0) / 60.0, 2) as hours,
           (te.approved_at IS NOT NULL) as approved
    FROM time_entries te
    LEFT JOIN "user" u ON u.id = te.user_id
    WHERE te.company_id = ${currentUser.companyId}
      ${userFilter} ${startFilter} ${endFilter} ${approvedFilter}
    ORDER BY te.clock_in DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM time_entries te
    WHERE te.company_id = ${currentUser.companyId}
      ${userFilter} ${startFilter} ${endFilter} ${approvedFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Approve time entry (manager+)
app.put('/time-entries/:id/approve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // time_entries has no boolean `approved` / `approved_by_id` / `updated_at` columns;
  // approval is recorded via approved_by + approved_at. (schema.ts is truth)
  const result = await db.execute(sql`
    UPDATE time_entries SET
      approved_by = ${currentUser.userId},
      approved_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Time entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'time_entry',
    entityId: id,
    entityName: 'Approved',
    req: c,
  })

  return c.json({ ...camel(updated), approved: true })
})

// Payroll export
app.get('/payroll-export', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  if (!startDate || !endDate) return c.json({ error: 'startDate and endDate are required' }, 400)

  // shifts.actual_hours and shifts.overtime_hours are TEXT columns, so every SUM() here was
  // SUM(text) — "function sum(text) does not exist" — and the payroll export answered 500 every
  // time it was asked for. Cast once, in a CTE, and the rest reads as arithmetic. The old
  // "CASE WHEN actual_hours > 8" also dropped a long shift's regular hours entirely rather than
  // capping them at 8, so a 10-hour day paid nothing but its overtime. (T45 M12)
  const dataResult = await db.execute(sql`
    WITH worked AS (
      SELECT
        s.user_id,
        COALESCE(NULLIF(s.actual_hours, ''), '0')::numeric AS hours,
        COALESCE(NULLIF(s.overtime_hours, ''), '0')::numeric AS overtime
      FROM shifts s
      WHERE s.company_id = ${currentUser.companyId}
        AND s.status = 'clocked_out'
        AND s.date >= ${startDate}
        AND s.date <= ${endDate}
    )
    SELECT
      w.user_id,
      u.first_name || ' ' || u.last_name as name,
      u.email,
      ROUND(SUM(w.hours), 2) as total_hours,
      ROUND(SUM(LEAST(w.hours, 8)), 2) as regular_hours,
      ROUND(SUM(w.overtime), 2) as overtime_hours,
      ROUND(COALESCE(u.hourly_rate, 0), 2) as hourly_rate,
      ROUND(
        SUM(LEAST(w.hours, 8)) * COALESCE(u.hourly_rate, 0)
        + SUM(w.overtime) * COALESCE(u.hourly_rate, 0) * 1.5,
      2) as gross_pay
    FROM worked w
    LEFT JOIN "user" u ON u.id = w.user_id
    GROUP BY w.user_id, u.first_name, u.last_name, u.email, u.hourly_rate
    ORDER BY u.first_name ASC
  `)

  const data = (dataResult as any).rows || dataResult

  audit.log({
    action: audit.ACTIONS.EXPORT,
    entity: 'payroll',
    entityName: `Payroll ${startDate} to ${endDate}`,
    metadata: { startDate, endDate, employeeCount: data.length },
    req: c,
  })

  return c.json({ data, period: { startDate, endDate } })
})

// ─── Labor Forecasting ─────────────────────────────────────────────────────

app.get('/labor-forecast', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Get average orders per hour for the last 30 days
  const forecastResult = await db.execute(sql`
    SELECT
      EXTRACT(DOW FROM completed_at)::int as day_of_week,
      EXTRACT(HOUR FROM completed_at)::int as hour,
      COUNT(*)::int as order_count,
      (COUNT(*) / 30.0)::numeric(10,2) as avg_orders_per_day,
      CEIL(COUNT(*) / 30.0 / 8)::int as suggested_staff
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND completed_at >= NOW() - INTERVAL '30 days'
    GROUP BY EXTRACT(DOW FROM completed_at), EXTRACT(HOUR FROM completed_at)
    ORDER BY day_of_week, hour
  `)

  const data = (forecastResult as any).rows || forecastResult

  // Build a readable forecast keyed by day
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const forecast: Record<string, any[]> = {}
  for (const row of data) {
    const dayName = dayNames[row.day_of_week]
    if (!forecast[dayName]) forecast[dayName] = []
    forecast[dayName].push({
      hour: row.hour,
      avgOrders: Number(row.avg_orders_per_day),
      suggestedStaff: Math.max(1, Number(row.suggested_staff)), // minimum 1 staff
    })
  }

  return c.json({
    forecast,
    methodology: '1 budtender per 8 orders/hour, based on last 30 days of completed orders',
  })
})

export default app
