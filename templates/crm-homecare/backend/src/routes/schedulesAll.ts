import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { schedules } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/schedules-all
// Uses explicit column list and schema safety check for split_shift columns
app.get('/', async (c) => {
  try {
    // Check if split-shift columns exist (added by migration)
    const colCheck = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'schedules' AND column_name = 'is_split_shift'
    `)
    const hasSplitCols = colCheck.rows.length > 0

    const result = await db.execute(sql`
      SELECT s.id, s.caregiver_id, s.client_id, s.schedule_type,
             s.day_of_week, s.date, s.start_time, s.end_time,
             s.notes, s.is_active, s.status, s.created_at, s.updated_at,
             s.frequency, s.effective_date, s.anchor_date,
             ${hasSplitCols
               ? sql`s.is_split_shift, s.split_shift_group_id, s.split_segment,`
               : sql`false AS is_split_shift, NULL::text AS split_shift_group_id, NULL::int AS split_segment,`}
             u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
             c.first_name as client_first_name, c.last_name as client_last_name
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.is_active = true
      ORDER BY s.day_of_week, s.date, s.start_time
    `)

    return c.json(result.rows)
  } catch (err: any) {
    console.error('[schedules-all] GET failed:', err.message, err.stack)
    return c.json({ error: err.message }, 500)
  }
})

// PUT /api/schedules-all/:id
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { clientId, dayOfWeek, date, startTime, endTime, notes, frequency, effectiveDate, anchorDate } = body

    const normalize = (t: string) => String(t).split(':').map(n => n.padStart(2, '0')).join(':')
    if (startTime && endTime && normalize(startTime) >= normalize(endTime)) {
      return c.json({ error: 'End time must be after start time' }, 400)
    }

    const result = await db.execute(sql`
      UPDATE schedules SET
        client_id = COALESCE(${clientId}, client_id),
        day_of_week = ${dayOfWeek !== undefined ? dayOfWeek : null},
        date = ${date || null},
        start_time = COALESCE(${startTime}, start_time),
        end_time = COALESCE(${endTime}, end_time),
        notes = ${notes || null},
        frequency = COALESCE(${frequency || null}, frequency),
        effective_date = COALESCE(${effectiveDate || null}, effective_date),
        anchor_date = COALESCE(${anchorDate || null}, anchor_date),
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING *
    `)

    if (result.rows.length === 0) return c.json({ error: 'Schedule not found' }, 404)
    return c.json(result.rows[0])
  } catch (err: any) {
    console.error('[schedules-all] PUT failed:', err.message, err.stack)
    return c.json({ error: err.message }, 500)
  }
})

export default app
