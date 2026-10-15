// Gusto payroll: export the hours payroll actually pays (ported from CVHC routes/gustoRoutes.js).
//
// Hours come from APPROVED payroll shift reviews (payable_minutes) — the same number payroll pays.
// Staff who never clock in are paid their scheduled hours, so raw clock time misses most paid work.
// Overtime = payable hours over 40 in a Sunday–Saturday week, priced at 1.5x the caregiver's
// default pay rate ($15 when none is set).
//
// The direct "Send to Gusto" push is refused (501) until it is rebuilt against Gusto's current API:
// the old scaffold sent raw clock hours to an endpoint that does not exist. The CSV is the path.
// Office only.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { getAgencyProfile } from '../services/agencyProfile.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

const rows = (r: any) => (r?.rows ?? r) as any[]
const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T12:00:00Z').getTime())

function getGustoConfig() {
  return {
    apiKey: process.env.GUSTO_API_KEY,
    companyId: process.env.GUSTO_COMPANY_ID,
    isConfigured: !!(process.env.GUSTO_API_KEY && process.env.GUSTO_COMPANY_ID),
    baseUrl: 'https://api.gusto.com/v1',
  }
}

async function gustoRequest(method: string, endpoint: string) {
  const cfg = getGustoConfig()
  if (!cfg.isConfigured) throw new Error('Gusto not configured. Set GUSTO_API_KEY and GUSTO_COMPANY_ID.')
  const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
    method,
    headers: { Authorization: `Token ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
}

// The weekly payable-hours CTE both the preview and the CSV read. $start/$end are calendar days.
const weekly = (start: string, end: string) => sql`weekly AS (
  SELECT psr.caregiver_id,
    (psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int) AS week_start,
    SUM(psr.payable_minutes) / 60.0 AS week_hours,
    COALESCE(SUM(psr.payable_minutes) FILTER (WHERE EXTRACT(DOW FROM psr.shift_date) IN (0, 6)), 0) / 60.0 AS weekend_hours,
    COUNT(*) AS shifts
  FROM payroll_shift_reviews psr
  WHERE psr.shift_date BETWEEN ${start}::date AND ${end}::date
    AND psr.status IN ('verified', 'approved', 'manual_entry')
    AND psr.payable_minutes > 0
  GROUP BY psr.caregiver_id, (psr.shift_date - EXTRACT(DOW FROM psr.shift_date)::int)
)`

// GET /api/gusto/config
app.get('/config', (c) => {
  const cfg = getGustoConfig()
  return c.json({
    isConfigured: cfg.isConfigured,
    setupInstructions: cfg.isConfigured ? null : {
      step1: 'Sign up at gusto.com and create your company',
      step2: 'Go to Settings → Integrations → API → Create API Key',
      step3: 'Add to Render env vars: GUSTO_API_KEY and GUSTO_COMPANY_ID',
      note: 'Gusto starts at $40/mo + $6/employee/mo — worth it when you have 10+ caregivers',
    },
  })
})

// GET /api/gusto/employees — mapping status for every active caregiver
app.get('/employees', async (c) => {
  const r = await db.execute(sql`
    SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
      gem.gusto_employee_id, gem.gusto_uuid, gem.is_synced, gem.last_synced_at
    FROM users u
    LEFT JOIN gusto_employee_map gem ON gem.user_id = u.id
    WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY u.last_name, u.first_name
  `)
  return c.json(rows(r))
})

// POST /api/gusto/sync-employees — match Gusto's employees to caregivers by email, then name
app.post('/sync-employees', async (c) => {
  const cfg = getGustoConfig()
  if (!cfg.isConfigured) return c.json({ error: 'Gusto not configured', setup: true }, 400)
  const user = c.get('user') as any
  try {
    const list = await gustoRequest('GET', `/companies/${cfg.companyId}/employees`)
    if (!list.ok) return c.json({ error: 'Could not fetch Gusto employees', details: list.data }, 400)
    const gusto: any[] = Array.isArray(list.data) ? list.data : []
    let matched = 0, unmatched = 0
    for (const ge of gusto) {
      const u = rows(await db.execute(sql`
        SELECT id FROM users
        WHERE LOWER(email) = LOWER(${ge.email || ''})
           OR (LOWER(first_name) = LOWER(${ge.first_name || ''}) AND LOWER(last_name) = LOWER(${ge.last_name || ''}))
        LIMIT 1`))
      if (u.length) {
        await db.execute(sql`
          INSERT INTO gusto_employee_map (id, user_id, gusto_employee_id, gusto_uuid, is_synced, last_synced_at)
          VALUES (${createId()}, ${u[0].id}, ${String(ge.id ?? '')}, ${ge.uuid ?? null}, true, NOW())
          ON CONFLICT (user_id) DO UPDATE SET gusto_employee_id = EXCLUDED.gusto_employee_id,
            gusto_uuid = EXCLUDED.gusto_uuid, is_synced = true, last_synced_at = NOW()`)
        matched++
      } else unmatched++
    }
    await db.execute(sql`INSERT INTO gusto_sync_log (id, sync_type, status, records_exported, created_by_id)
      VALUES (${createId()}, 'employees', 'success', ${matched}, ${user?.userId || null})`)
    return c.json({ matched, unmatched, total: gusto.length })
  } catch (error: any) {
    await db.execute(sql`INSERT INTO gusto_sync_log (id, sync_type, status, error_message, created_by_id)
      VALUES (${createId()}, 'employees', 'failed', ${error?.message || 'failed'}, ${user?.userId || null})`).catch(() => {})
    return c.json({ error: error?.message || 'Gusto sync failed' }, 502)
  }
})

// GET /api/gusto/preview?startDate=&endDate=
app.get('/preview', async (c) => {
  const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
  if (!isDay(startDate) || !isDay(endDate)) return c.json({ error: 'startDate and endDate required' }, 400)
  const result = rows(await db.execute(sql`
    WITH ${weekly(startDate!, endDate!)}
    SELECT
      u.id, u.first_name, u.last_name, u.email,
      gem.gusto_employee_id, COALESCE(gem.is_synced, false) AS gusto_mapped,
      SUM(w.shifts)::int AS shift_count,
      ROUND(SUM(w.week_hours)::numeric, 2) AS total_hours,
      ROUND(SUM(LEAST(w.week_hours, 40))::numeric, 2) AS regular_hours,
      ROUND(SUM(GREATEST(w.week_hours - 40, 0))::numeric, 2) AS overtime_hours,
      ROUND(SUM(w.weekend_hours)::numeric, 2) AS weekend_hours,
      COALESCE(u.default_pay_rate, 15) AS hourly_rate,
      ROUND((SUM(LEAST(w.week_hours, 40)) * COALESCE(u.default_pay_rate, 15)
           + SUM(GREATEST(w.week_hours - 40, 0)) * COALESCE(u.default_pay_rate, 15) * 1.5)::numeric, 2) AS gross_pay
    FROM weekly w
    JOIN users u ON u.id = w.caregiver_id
    LEFT JOIN gusto_employee_map gem ON gem.user_id = u.id
    GROUP BY u.id, u.first_name, u.last_name, u.email, u.default_pay_rate, gem.gusto_employee_id, gem.is_synced
    ORDER BY u.last_name, u.first_name
  `))

  // Work in the period that is NOT in the export yet. Clock entries are cut on the agency's own
  // calendar day, not UTC's.
  const { timezone } = await getAgencyProfile()
  const [warn] = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM payroll_shift_reviews
        WHERE shift_date BETWEEN ${startDate}::date AND ${endDate}::date
          AND status IN ('pending', 'flagged', 'missing_punch')) AS unresolved_reviews,
      (SELECT COUNT(*)::int FROM time_entries te
        WHERE te.end_time IS NOT NULL
          AND te.start_time >= ((${startDate}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND te.start_time < ((${endDate}::date + 1)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND NOT EXISTS (SELECT 1 FROM payroll_shift_reviews p2 WHERE p2.time_entry_id = te.id)) AS clock_entries_without_review
  `))

  const totals = {
    employees: result.length,
    totalHours: result.reduce((s, r) => s + parseFloat(r.total_hours || 0), 0).toFixed(2),
    totalGross: result.reduce((s, r) => s + parseFloat(r.gross_pay || 0), 0).toFixed(2),
    unmapped: result.filter((r) => !r.gusto_mapped).length,
  }
  return c.json({
    preview: result, totals, period: { startDate, endDate },
    warnings: {
      unresolved_reviews: Number(warn?.unresolved_reviews) || 0,
      clock_entries_without_review: Number(warn?.clock_entries_without_review) || 0,
    },
  })
})

// POST /api/gusto/export — refused until the push is rebuilt against Gusto's current API
app.post('/export', (c) =>
  c.json({ error: 'Direct Gusto push is not ready — use the CSV export and upload it in Gusto.' }, 501))

// GET /api/gusto/export-csv?startDate=&endDate= — upload into Gusto's hours import
app.get('/export-csv', async (c) => {
  const startDate = c.req.query('startDate'), endDate = c.req.query('endDate')
  if (!isDay(startDate) || !isDay(endDate)) return c.json({ error: 'startDate and endDate required' }, 400)
  const result = rows(await db.execute(sql`
    WITH ${weekly(startDate!, endDate!)}
    SELECT u.first_name, u.last_name, u.email,
      ROUND(SUM(LEAST(w.week_hours, 40))::numeric, 2) AS regular_hours,
      ROUND(SUM(GREATEST(w.week_hours - 40, 0))::numeric, 2) AS overtime_hours,
      ROUND(SUM(w.week_hours)::numeric, 2) AS total_hours
    FROM weekly w
    JOIN users u ON u.id = w.caregiver_id
    GROUP BY u.id, u.first_name, u.last_name, u.email
    ORDER BY u.last_name, u.first_name
  `))
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours']
  for (const r of result) lines.push([q(r.first_name), q(r.last_name), q(r.email), r.regular_hours, r.overtime_hours, r.total_hours].join(','))
  const user = c.get('user') as any
  await db.execute(sql`INSERT INTO gusto_sync_log (id, sync_type, status, pay_period_start, pay_period_end, records_exported, created_by_id)
    VALUES (${createId()}, 'csv_export', 'success', ${startDate}::date, ${endDate}::date, ${result.length}, ${user?.userId || null})`).catch(() => {})
  return c.body(lines.join('\n'), 200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="gusto-hours-${startDate}-to-${endDate}.csv"`,
  })
})

// GET /api/gusto/sync-log
app.get('/sync-log', async (c) => {
  const r = await db.execute(sql`SELECT * FROM gusto_sync_log ORDER BY created_at DESC LIMIT 20`)
  return c.json(rows(r))
})

export default app
