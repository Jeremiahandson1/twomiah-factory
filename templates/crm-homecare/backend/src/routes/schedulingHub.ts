// /api/scheduling — the Schedule Hub's support endpoints: week view, coverage, conflict heatmap,
// suggested caregivers, overtime / travel / conflict checks, caregiver hours, bulk create, auto-fill.
// Ported from the CVHC home care CRM (routes/schedulingRoutes.js). Mounted on /api/scheduling ahead
// of routes/scheduling.ts (time off, absences, no-show), which it shares the prefix with.
//
// Hours always come from the occurrence engine: a recurring row is counted on the days it actually
// happens (bi-weekly, cancelled, suspended and covered days included), never "every week".
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, isOffice, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, schedTs, shiftHours, DATE_RE } from '../services/scheduleOccurrences.ts'
import { checkAuthorizationBalance } from '../helpers/authorizationCheck.ts'
import { agencyNow, addDays } from '../services/agencyTime.ts'

const app = new Hono()
app.use('*', authenticate)

const weekStartOf = (ymd: string) => addDays(ymd, -new Date(`${ymd}T12:00:00Z`).getUTCDay())
async function weekOfParam(v?: string) {
  const base = v && DATE_RE.test(v) ? v : (await agencyNow()).date
  const ws = weekStartOf(base)
  return { ws, we: addDays(ws, 6) }
}

function distanceMiles(lat1: any, lon1: any, lat2: any, lon2: any): number | null {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null
  const [a1, o1, a2, o2] = [lat1, lon1, lat2, lon2].map(Number)
  const R = 3959, dLat = (a2 - a1) * Math.PI / 180, dLon = (o2 - o1) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Scheduled hours per caregiver over [from, to], through the engine. */
async function hoursByCaregiver(from: string, to: string): Promise<Record<string, number>> {
  const r = await rows<any>(sql`WITH ${occurrencesCte(from, to)} SELECT caregiver_id, SUM(hours) AS h FROM occ GROUP BY caregiver_id`)
  return Object.fromEntries(r.map((x) => [x.caregiver_id, Number(x.h) || 0]))
}

const maxHoursOf = async (caregiverId: string) =>
  Number((await one<any>(sql`SELECT max_hours_per_week FROM caregiver_availability WHERE caregiver_id = ${caregiverId}`))?.max_hours_per_week) || 40

// GET /week-view?weekOf — each active caregiver × the 7 days, occurrences resolved.
// The office sees every caregiver's week; a caregiver sees only their own.
app.get('/week-view', async (c) => {
  const viewer = c.get('user') as any
  const only = isOffice(viewer) ? null : userIdOf(viewer)
  const { ws, we } = await weekOfParam(c.req.query('weekOf'))
  const cgs = await rows<any>(sql`SELECT id, first_name, last_name FROM users WHERE role = 'caregiver' AND is_active = true
    ${only ? sql`AND id = ${only}` : sql``} ORDER BY first_name`)
  const occ = await rows<any>(sql`WITH ${occurrencesCte(ws, we)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, occ.client_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS occ_date,
           EXTRACT(DOW FROM occ.occ_date)::int AS dow,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           occ.minutes, occ.is_modified, occ.is_training, s.day_of_week, to_char(s.date, 'YYYY-MM-DD') AS date, s.notes, s.frequency,
           cl.first_name AS client_first_name, cl.last_name AS client_last_name
      FROM occ JOIN schedules s ON s.id = occ.schedule_id LEFT JOIN clients cl ON cl.id = occ.client_id
     ${only ? sql`WHERE occ.caregiver_id = ${only}` : sql``}
     ORDER BY occ.start_time`)
  const data: Record<string, any> = {}
  for (const cg of cgs) data[cg.id] = { caregiver: cg, days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } }
  for (const o of occ) {
    if (!data[o.caregiver_id]) continue
    data[o.caregiver_id].days[o.dow].push({ ...o, isRecurring: o.day_of_week !== null })
  }
  return c.json({ weekStart: ws, weekEnd: we, caregivers: Object.values(data) })
})

// GET /coverage-overview?weekOf — caregiver load vs capacity, and clients scheduled under their
// weekly authorized units (15-minute units).
app.get('/coverage-overview', requireAdmin, async (c) => {
  const { ws, we } = await weekOfParam(c.req.query('weekOf'))
  const occ = await rows<any>(sql`WITH ${occurrencesCte(ws, we)} SELECT caregiver_id, client_id, hours FROM occ`)
  const byCg: Record<string, number> = {}, byCl: Record<string, number> = {}
  for (const o of occ) {
    byCg[o.caregiver_id] = (byCg[o.caregiver_id] || 0) + Number(o.hours)
    byCl[o.client_id] = (byCl[o.client_id] || 0) + Number(o.hours)
  }
  const cgs = await rows<any>(sql`SELECT u.id, u.first_name, u.last_name, COALESCE(ca.max_hours_per_week, 40) AS max_hours,
      COALESCE(ca.status, 'available') AS availability_status
    FROM users u LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
    WHERE u.role = 'caregiver' AND u.is_active = true ORDER BY u.first_name, u.last_name`)
  const cls = await rows<any>(sql`SELECT id, first_name, last_name, weekly_authorized_units FROM clients WHERE is_active = true ORDER BY first_name, last_name`)
  const round2 = (n: number) => Math.round(n * 100) / 100
  const caregivers = cgs.map((cg) => {
    const maxHours = Number(cg.max_hours) || 40, scheduledHours = round2(byCg[cg.id] || 0)
    return { id: cg.id, name: `${cg.first_name} ${cg.last_name}`, maxHours, scheduledHours, remainingHours: Math.max(0, round2(maxHours - scheduledHours)),
      utilizationPercent: Math.round((scheduledHours / maxHours) * 100), status: cg.availability_status }
  })
  const clientsWithUnits = cls.filter((cl) => Number(cl.weekly_authorized_units) > 0).map((cl) => {
    const authorizedUnits = Math.floor(Number(cl.weekly_authorized_units))
    const scheduledHours = round2(byCl[cl.id] || 0)
    const scheduledUnits = Math.round(scheduledHours * 4)
    const shortfallUnits = Math.max(0, authorizedUnits - scheduledUnits)
    return { id: cl.id, name: `${cl.first_name} ${cl.last_name}`, authorizedUnits, authorizedHours: authorizedUnits * 0.25, scheduledUnits, scheduledHours,
      shortfallUnits, shortfallHours: shortfallUnits * 0.25, coveragePercent: authorizedUnits > 0 ? Math.round((scheduledUnits / authorizedUnits) * 100) : 0,
      isUnderScheduled: shortfallUnits > 0 }
  })
  const under = clientsWithUnits.filter((x) => x.isUnderScheduled)
  return c.json({
    weekStart: ws, weekEnd: we, caregivers, clientsWithUnits, underScheduledClients: under,
    summary: {
      totalCaregivers: caregivers.length,
      totalScheduledHours: caregivers.reduce((s, x) => s + x.scheduledHours, 0).toFixed(2),
      totalAvailableHours: caregivers.reduce((s, x) => s + x.maxHours, 0).toFixed(2),
      underScheduledClientCount: under.length,
      totalShortfallUnits: under.reduce((s, x) => s + x.shortfallUnits, 0),
      totalShortfallHours: under.reduce((s, x) => s + x.shortfallHours, 0).toFixed(2),
    },
  })
})

// GET /conflict-heatmap?weekOf — hours per caregiver per day vs weekly capacity
app.get('/conflict-heatmap', requireAdmin, async (c) => {
  const { ws, we } = await weekOfParam(c.req.query('weekOf'))
  const r = await rows<any>(sql`WITH ${occurrencesCte(ws, we)},
      days AS (SELECT generate_series(${ws}::date, ${we}::date, '1 day'::interval)::date AS d),
      cgs AS (SELECT u.id, u.first_name, u.last_name, COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week
                FROM users u LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id WHERE u.role = 'caregiver' AND u.is_active = true),
      sh AS (SELECT caregiver_id, occ_date AS d, ROUND(SUM(hours)::numeric, 2) AS hours, COUNT(*) AS shift_count FROM occ GROUP BY caregiver_id, occ_date)
    SELECT cgs.id, cgs.first_name, cgs.last_name, cgs.max_hours_per_week, to_char(days.d, 'YYYY-MM-DD') AS day,
           COALESCE(sh.hours, 0) AS hours, COALESCE(sh.shift_count, 0) AS shift_count
      FROM cgs CROSS JOIN days LEFT JOIN sh ON sh.caregiver_id = cgs.id AND sh.d = days.d
     ORDER BY cgs.last_name, cgs.first_name, days.d`)
  const by = new Map<string, any>()
  for (const x of r) {
    if (!by.has(x.id)) by.set(x.id, { id: x.id, first_name: x.first_name, last_name: x.last_name, max_hours_per_week: Number(x.max_hours_per_week), days: [], total: 0 })
    const g = by.get(x.id)
    g.days.push({ date: x.day, hours: Number(x.hours), shifts: Number(x.shift_count) })
    g.total += Number(x.hours)
  }
  return c.json({ weekStart: ws, weekEnd: we, caregivers: [...by.values()].sort((a, b) => b.total - a.total) })
})

// POST /check-conflicts { caregiverId, date, startTime, endTime }
app.post('/check-conflicts', async (c) => {
  const { caregiverId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId || !hms(startTime) || !hms(endTime) || !DATE_RE.test(date || '')) return c.json({ error: 'Missing required fields' }, 400)
  const r = await rows<any>(sql`WITH ${occurrencesCte(date, date)}
    SELECT occ.schedule_id AS id, s.day_of_week, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           cl.first_name, cl.last_name
      FROM occ JOIN schedules s ON s.id = occ.schedule_id LEFT JOIN clients cl ON cl.id = occ.client_id
     WHERE occ.caregiver_id = ${caregiverId} AND (occ.start_time, occ.end_time) OVERLAPS (${hms(startTime)}::time, ${hms(endTime)}::time)`)
  return c.json({ hasConflict: r.length > 0, conflicts: r.map((s) => ({ id: s.id, clientName: `${s.first_name} ${s.last_name}`, startTime: s.start_time, endTime: s.end_time, isRecurring: s.day_of_week !== null })) })
})

// POST /check-weekly-hours { caregiverId, date, startTime, endTime } — overtime warning at schedule time
app.post('/check-weekly-hours', async (c) => {
  const { caregiverId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId || !hms(startTime) || !hms(endTime)) return c.json({ error: 'Missing required fields' }, 400)
  const { ws, we } = await weekOfParam(date)
  const current = (await hoursByCaregiver(ws, we))[caregiverId] || 0
  const proposed = shiftHours(startTime, endTime)
  const projected = current + proposed
  const maxHours = await maxHoursOf(caregiverId)
  const overtime = Math.max(0, projected - 40)
  const cg = await one<any>(sql`SELECT first_name, last_name FROM users WHERE id = ${caregiverId}`)
  const name = cg ? `${cg.first_name} ${cg.last_name}` : 'Caregiver'
  const warnings: string[] = []
  if (projected > maxHours) warnings.push(`${name} will exceed max hours: ${projected.toFixed(1)}h / ${maxHours}h limit`)
  if (overtime > 0) warnings.push(`This puts ${name} at ${projected.toFixed(1)}h this week (${overtime.toFixed(1)}h overtime)`)
  else if (projected > 35) warnings.push(`${name} approaching overtime: ${projected.toFixed(1)}h this week`)
  const r2 = (n: number) => parseFloat(n.toFixed(2))
  return c.json({ currentWeeklyHours: r2(current), proposedHours: r2(proposed), projectedHours: r2(projected), maxHours, overtimeHours: r2(overtime), warnings, caregiverName: name })
})

// POST /check-travel-time { caregiverId, clientId, date, startTime, endTime } — back-to-back drive time
app.post('/check-travel-time', async (c) => {
  const { caregiverId, clientId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId || !clientId || !DATE_RE.test(date || '') || !hms(startTime) || !hms(endTime)) return c.json({ error: 'Missing required fields' }, 400)
  const p = await one<any>(sql`SELECT latitude, longitude FROM clients WHERE id = ${clientId}`)
  if (!p?.latitude) return c.json({ hasTravelConflict: false, adjacentShifts: [], note: 'Client has no GPS coordinates set' })
  const day = await rows<any>(sql`WITH ${occurrencesCte(date, date)}
    SELECT to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           cl.first_name, cl.last_name, cl.latitude, cl.longitude
      FROM occ JOIN clients cl ON cl.id = occ.client_id
     WHERE occ.caregiver_id = ${caregiverId} AND occ.client_id <> ${clientId} ORDER BY occ.start_time`)
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const s0 = toMin(hms(startTime)!), e0 = toMin(hms(endTime)!)
  const adjacent: any[] = []
  for (const s of day) {
    const d = distanceMiles(p.latitude, p.longitude, s.latitude, s.longitude)
    if (d === null) continue
    const drive = Math.round(d * 2)
    let gap: number | null = null
    if (toMin(s.end_time) <= s0) gap = s0 - toMin(s.end_time)
    else if (toMin(s.start_time) >= e0) gap = toMin(s.start_time) - e0
    if (gap !== null && gap < 120) {
      adjacent.push({ clientName: `${s.first_name} ${s.last_name}`, startTime: s.start_time, endTime: s.end_time, distanceMiles: parseFloat(d.toFixed(1)),
        estimatedDriveMinutes: drive, gapMinutes: Math.round(gap), isInsufficient: drive > gap })
    }
  }
  return c.json({ hasTravelConflict: adjacent.some((a) => a.isInsufficient), adjacentShifts: adjacent })
})

// GET /caregiver-hours/:caregiverId — this week's scheduled hours (a caregiver: their own)
app.get('/caregiver-hours/:caregiverId', async (c) => {
  const user = c.get('user') as any
  const caregiverId = c.req.param('caregiverId')
  if (!isOffice(user) && userIdOf(user) !== caregiverId) return c.json({ error: 'You can only view your own hours' }, 403)
  const { ws, we } = await weekOfParam()
  const occ = await rows<any>(sql`WITH ${occurrencesCte(ws, we)}
    SELECT SUM(CASE WHEN s.day_of_week IS NULL THEN occ.hours ELSE 0 END) AS one_time, SUM(CASE WHEN s.day_of_week IS NOT NULL THEN occ.hours ELSE 0 END) AS recurring
      FROM occ JOIN schedules s ON s.id = occ.schedule_id WHERE occ.caregiver_id = ${caregiverId}`)
  const oneTime = Number(occ[0]?.one_time) || 0, recurring = Number(occ[0]?.recurring) || 0
  const total = oneTime + recurring
  const maxHours = await maxHoursOf(caregiverId)
  return c.json({ totalHours: total.toFixed(2), oneTimeHours: oneTime.toFixed(2), recurringHours: recurring.toFixed(2), maxHours,
    remainingHours: Math.max(0, maxHours - total).toFixed(2), approachingOvertime: total > 35 })
})

// GET /suggest-caregivers?clientId&date&startTime&endTime — ranked candidates for a slot
app.get('/suggest-caregivers', requireAdmin, async (c) => {
  const { clientId, date, startTime, endTime } = c.req.query()
  if (!clientId) return c.json({ error: 'Client ID required' }, 400)
  const client = await one<any>(sql`SELECT c.id, c.first_name, c.last_name, c.care_type_id, c.latitude, c.longitude,
      c.preferred_caregivers, c.do_not_use_caregivers, ct.name AS care_type_name
    FROM clients c LEFT JOIN care_types ct ON c.care_type_id = ct.id WHERE c.id = ${clientId}`)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const validDate = date && DATE_RE.test(date) ? date : null
  const hours = hms(startTime) && hms(endTime) ? shiftHours(startTime, endTime) : 4
  const dow = validDate ? new Date(`${validDate}T12:00:00Z`).getUTCDay() : null
  const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayCol = dow !== null ? dayMap[dow] : null
  const cgs = await rows<any>(sql`SELECT u.id, u.first_name, u.last_name, u.phone, u.default_pay_rate, u.latitude, u.longitude,
      ca.status AS availability_status, ca.max_hours_per_week,
      ${dayCol ? sql.raw(`ca.${dayCol}_available`) : sql`NULL::boolean`} AS day_available,
      ${dayCol ? sql.raw(`to_char(ca.${dayCol}_start_time, 'HH24:MI')`) : sql`NULL::text`} AS day_start_time,
      ${dayCol ? sql.raw(`to_char(ca.${dayCol}_end_time, 'HH24:MI')`) : sql`NULL::text`} AS day_end_time,
      EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.caregiver_id = u.id AND ${validDate}::date IS NOT NULL
               AND (t.status = 'approved' OR t.type = 'blackout') AND t.start_date <= ${validDate}::date AND t.end_date >= ${validDate}::date) AS is_blacked_out
    FROM users u LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
    WHERE u.role = 'caregiver' AND u.is_active = true ORDER BY u.first_name`)
  const { ws, we } = await weekOfParam(validDate || undefined)
  const weekly = await hoursByCaregiver(ws, we)
  const history = Object.fromEntries((await rows<any>(sql`SELECT caregiver_id, COUNT(*) AS n FROM time_entries WHERE client_id = ${clientId} AND is_complete = true GROUP BY caregiver_id`)).map((r) => [r.caregiver_id, Number(r.n)]))
  const conflictIds = new Set<string>(validDate && hms(startTime) && hms(endTime)
    ? (await rows<any>(sql`WITH ${occurrencesCte(validDate, validDate)} SELECT DISTINCT caregiver_id FROM occ
        WHERE (start_time, end_time) OVERLAPS (${hms(startTime)}::time, ${hms(endTime)}::time)`)).map((r) => r.caregiver_id)
    : [])
  const preferred = new Set((Array.isArray(client.preferred_caregivers) ? client.preferred_caregivers : []).map(String))
  const dnu = new Set((Array.isArray(client.do_not_use_caregivers) ? client.do_not_use_caregivers : []).map(String))
  const toMin = (t: any) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
  const sMin = toMin(startTime), eMin = toMin(endTime)

  const ranked = cgs.map((cg) => {
    const weeklyHours = weekly[cg.id] || 0
    const maxHours = Number(cg.max_hours_per_week) || 40
    const visitCount = history[cg.id] || 0
    const hasConflict = conflictIds.has(cg.id)
    const isAvailable = cg.availability_status !== 'unavailable'
    const wouldExceedHours = weeklyHours + hours > maxHours
    const approachingOvertime = weeklyHours > 35
    const distance = distanceMiles(cg.latitude, cg.longitude, client.latitude, client.longitude)
    const isPreferred = preferred.has(String(cg.id)), isDnu = dnu.has(String(cg.id)), isBlackedOut = cg.is_blacked_out === true
    const aS = toMin(cg.day_start_time), aE = toMin(cg.day_end_time)
    const timeFits = aS != null && aE != null && sMin != null && eMin != null ? (sMin >= aS && eMin <= aE) : null
    let score = 100
    if (isDnu) score -= 1000
    if (isBlackedOut) score -= 1000
    if (hasConflict) score -= 200
    if (!isAvailable) score -= 200
    if (isPreferred) score += 60
    score += Math.min(visitCount * 3, 30)
    score -= (weeklyHours / maxHours) * 20
    if (wouldExceedHours) score -= 50
    if (approachingOvertime) score -= 10
    if (distance !== null) { if (distance <= 5) score += 20; else if (distance <= 10) score += 10; else if (distance <= 20) score += 5; else if (distance > 30) score -= 15 }
    if (dayCol) { if (cg.day_available === false) score -= 50; else if (timeFits === true) score += 15; else if (timeFits === false) score -= 20 }
    const reasons: string[] = []
    if (isDnu) reasons.push('🚫 Client do-not-use list')
    if (isBlackedOut) reasons.push('🚫 PTO/blackout on this date')
    if (isPreferred) reasons.push('⭐ Preferred caregiver')
    if (visitCount > 5) reasons.push(`✓ Familiar (${visitCount} visits)`)
    else if (visitCount > 0) reasons.push(`${visitCount} prior visits`)
    if (hasConflict) reasons.push('⚠️ Conflicting shift')
    if (!isAvailable) reasons.push('⚠️ Marked unavailable')
    if (wouldExceedHours) reasons.push('⚠️ Exceeds max hours')
    else if (approachingOvertime) reasons.push(`⚠️ ${weeklyHours.toFixed(0)}h this week`)
    else if (weeklyHours < 20) reasons.push('✓ Has availability')
    if (dayCol && cg.day_available === false) reasons.push(`⚠️ Not available ${dayMap[dow!]}s`)
    else if (timeFits === true) reasons.push('✓ Time fits availability window')
    else if (timeFits === false) reasons.push('⚠️ Outside availability window')
    if (distance !== null) {
      if (distance <= 5) reasons.push(`✓ Nearby (${distance.toFixed(1)} mi)`)
      else if (distance <= 15) reasons.push(`${distance.toFixed(1)} mi away`)
      else if (distance > 20) reasons.push(`⚠️ Far (${distance.toFixed(1)} mi)`)
    }
    const tier = score >= 130 ? 'excellent' : score >= 100 ? 'good' : score >= 60 ? 'maybe' : 'avoid'
    return { ...cg, weeklyHours: weeklyHours.toFixed(2), maxHours, visitCount, hasConflict, isAvailable, isPreferred, isDnu, isBlackedOut,
      wouldExceedHours, approachingOvertime, distance: distance !== null ? distance.toFixed(1) : null, estimatedDriveTime: distance !== null ? Math.round(distance * 2) : null,
      hasRequiredSkills: true, missingCertifications: [], score: Math.round(score), tier, reasons }
  })
  const out = (c.req.query('includeBlocked') === 'true' ? ranked : ranked.filter((x) => !x.isDnu && !x.isBlackedOut)).sort((a, b) => b.score - a.score)
  return c.json({ client, suggestions: out, shiftHours: hours, requiredCertifications: [] })
})

// POST /bulk-create { caregiverId, clientId, template: [{dayOfWeek,startTime,endTime}], weeks, startDate, notes }
app.post('/bulk-create', requireAdmin, async (c) => {
  const { caregiverId, clientId, template, weeks, startDate, notes } = await c.req.json().catch(() => ({})) as any
  if (!caregiverId || !clientId || !Array.isArray(template) || !template.length) return c.json({ error: 'Missing required fields' }, 400)
  const auth = await checkAuthorizationBalance(clientId, template.reduce((s: number, t: any) => s + shiftHours(t.startTime, t.endTime), 0))
  const n = Math.min(Math.max(parseInt(weeks) || 4, 1), 12)
  const { date: today } = await agencyNow()
  const start = weekStartOf(startDate && DATE_RE.test(startDate) ? startDate : today)
  const created: string[] = [], conflicts: any[] = []
  for (let w = 0; w < n; w++) {
    for (const slot of template) {
      const s = hms(slot.startTime), e = hms(slot.endTime), dw = Number(slot.dayOfWeek)
      if (!s || !e || !(dw >= 0 && dw <= 6)) continue
      const d = addDays(start, w * 7 + dw)
      if (d < today) continue
      const clash = await one(sql`WITH ${occurrencesCte(d, d)} SELECT 1 FROM occ WHERE caregiver_id = ${caregiverId}
        AND (start_time, end_time) OVERLAPS (${s}::time, ${e}::time) LIMIT 1`)
      if (clash) { conflicts.push({ date: d, startTime: s }); continue }
      const id = createId()
      await rows(sql`INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes, is_active, status, frequency, created_at, updated_at)
        VALUES (${id}, ${caregiverId}, ${clientId}, 'one-time', ${d}::date, ${schedTs(s, d)}::timestamp, ${schedTs(e, d)}::timestamp, ${notes || null}, true, 'active', 'weekly', NOW(), NOW())`)
      created.push(id)
    }
  }
  return c.json({ success: true, created: created.length, skippedConflicts: conflicts.length, conflicts, authWarnings: auth.warnings })
})

// POST /auto-fill { startDate, endDate, dryRun } — fill open shifts with the best free caregiver
app.post('/auto-fill', requireAdmin, async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({})) as any
  const { date: today } = await agencyNow()
  const start = DATE_RE.test(b.startDate || '') ? b.startDate : today
  const end = DATE_RE.test(b.endDate || '') ? b.endDate : addDays(today, 7)
  const dryRun = !!b.dryRun
  const shifts = await rows<any>(sql`SELECT os.id, os.client_id, os.schedule_id, to_char(os.date, 'YYYY-MM-DD') AS shift_date,
      to_char(os.start_time, 'HH24:MI:SS') AS start_time, to_char(os.end_time, 'HH24:MI:SS') AS end_time, os.notes,
      cl.first_name AS client_first, cl.last_name AS client_last, cl.latitude AS client_lat, cl.longitude AS client_lng
    FROM open_shifts os JOIN clients cl ON os.client_id = cl.id
    WHERE os.status = 'open' AND os.date >= ${start}::date AND os.date <= ${end}::date AND os.start_time IS NOT NULL
    ORDER BY CASE os.urgency WHEN 'critical' THEN 0 WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, os.date, os.start_time`)
  if (!shifts.length) return c.json({ success: true, message: 'No open shifts to fill', filled: 0, failed: 0, results: [] })
  const cgs = await rows<any>(sql`SELECT u.id, u.first_name, u.last_name, u.latitude, u.longitude, ca.max_hours_per_week
    FROM users u LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
    WHERE u.role = 'caregiver' AND u.is_active = true AND (ca.status IS NULL OR ca.status <> 'unavailable')`)
  const ws = weekStartOf(start)
  const weekly = await hoursByCaregiver(ws, addDays(ws, 6))
  const hist: Record<string, Record<string, number>> = {}
  for (const r of await rows<any>(sql`SELECT caregiver_id, client_id, COUNT(*) AS n FROM time_entries WHERE is_complete = true GROUP BY caregiver_id, client_id`)) {
    (hist[r.client_id] ||= {})[r.caregiver_id] = Number(r.n)
  }
  const { assignShift } = await import('./openShifts.ts')
  const placed: { caregiverId: string; date: string; s: string; e: string }[] = []
  const results: any[] = []
  let filled = 0, failed = 0
  for (const sh of shifts) {
    const h = shiftHours(sh.start_time, sh.end_time)
    const busy = new Set((await rows<any>(sql`WITH ${occurrencesCte(sh.shift_date, sh.shift_date)} SELECT DISTINCT caregiver_id FROM occ
      WHERE (start_time, end_time) OVERLAPS (${sh.start_time}::time, ${sh.end_time}::time)`)).map((r) => r.caregiver_id))
    const auth = await checkAuthorizationBalance(sh.client_id, h)
    const scored = cgs.map((cg) => {
      const max = Number(cg.max_hours_per_week) || 40
      const projected = (weekly[cg.id] || 0)
      const conflict = busy.has(cg.id) || placed.some((a) => a.caregiverId === cg.id && a.date === sh.shift_date && !(a.e <= sh.start_time || a.s >= sh.end_time))
      if (conflict || projected + h > max) return { ...cg, score: -1000, disqualified: true, reason: conflict ? 'conflict' : 'exceeds_hours' }
      const visits = hist[sh.client_id]?.[cg.id] || 0
      let score = 100 + Math.min(visits * 3, 30) - (projected / max) * 20
      if (projected + h > 40) score -= 15
      const d = distanceMiles(cg.latitude, cg.longitude, sh.client_lat, sh.client_lng)
      if (d !== null) { if (d <= 5) score += 20; else if (d <= 10) score += 10; else if (d <= 20) score += 5; else if (d > 30) score -= 15 }
      return { ...cg, score, disqualified: false, distance: d, visitCount: visits }
    }).sort((a: any, b: any) => b.score - a.score)
    const best: any = scored.find((x: any) => !x.disqualified)
    const label = { shiftId: sh.id, client: `${sh.client_first} ${sh.client_last}`, date: sh.shift_date, time: `${sh.start_time} - ${sh.end_time}` }
    if (best) {
      if (!dryRun) {
        try {
          await assignShift(sh, best.id, userIdOf(user))
          await rows(sql`UPDATE open_shifts SET status = 'filled', claimed_by_id = ${best.id}, claimed_at = NOW(), approved_by_id = ${userIdOf(user)}, approved_at = NOW(), updated_at = NOW() WHERE id = ${sh.id}`)
        } catch (e: any) {
          results.push({ ...label, status: 'unfilled', reason: e.message }); failed++; continue
        }
      }
      placed.push({ caregiverId: best.id, date: sh.shift_date, s: sh.start_time, e: sh.end_time })
      weekly[best.id] = (weekly[best.id] || 0) + h
      results.push({ ...label, status: 'filled', assignedTo: `${best.first_name} ${best.last_name}`, caregiverId: best.id, score: Math.round(best.score),
        distance: best.distance !== null ? `${best.distance.toFixed(1)} mi` : 'N/A', familiarity: best.visitCount > 0 ? `${best.visitCount} visits` : 'New', authWarnings: auth.warnings })
      filled++
    } else {
      results.push({ ...label, status: 'unfilled', reason: 'No available caregivers', candidates: scored.filter((x: any) => x.disqualified).slice(0, 3).map((x: any) => ({ name: `${x.first_name} ${x.last_name}`, reason: x.reason })) })
      failed++
    }
  }
  return c.json({ success: true, dryRun, message: dryRun ? `Preview: Would fill ${filled} of ${shifts.length} shifts` : `Filled ${filled} of ${shifts.length} shifts`, filled, failed, total: shifts.length, results })
})

export default app
