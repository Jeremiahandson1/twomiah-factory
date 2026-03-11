import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// ── Helper functions ──

function normalizeTime(t: string | null | undefined): string {
  if (!t) return '08:00'
  return String(t).slice(0, 5)
}

function toHours(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

function addMins(t: string, mins: number): string {
  const [h, m] = t.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function overlaps(aS: string, aE: string, bS: string, bE: string): boolean {
  return aS < bE && aE > bS
}

// 4-tier priority: client+cgPref > client+cgFull > cgPref > cgFull
function findSlotWithPreferred(
  existingSlots: any[],
  durationMins: number,
  windowStart: string,
  windowEnd: string,
  prefStart: string | null,
  prefEnd: string | null,
  clientStart: string | null,
  clientEnd: string | null
): string | null {
  const sorted = [...existingSlots].sort((a, b) => a.start.localeCompare(b.start))

  function tryWindow(wStart: string, wEnd: string): string | null {
    if (wStart >= wEnd) return null
    const candidates = [wStart, ...sorted.map((s: any) => s.end)]
    for (const candidate of candidates) {
      if (candidate < wStart) continue
      if (candidate >= wEnd) break
      const end = addMins(candidate, durationMins)
      if (end > wEnd) break
      const conflict = sorted.some((s: any) => overlaps(candidate, end, s.start, s.end))
      if (!conflict) return candidate
    }
    return null
  }

  function intersect(aS: string, aE: string, bS: string, bE: string): [string, string] | null {
    const s = aS > bS ? aS : bS
    const e = aE < bE ? aE : bE
    return s < e ? [s, e] : null
  }

  const hasClient = clientStart && clientEnd
  const hasPref = prefStart && prefEnd

  if (hasClient && hasPref) {
    const inter = intersect(clientStart!, clientEnd!, prefStart!, prefEnd!)
    if (inter) {
      const slot = tryWindow(inter[0], inter[1])
      if (slot) return slot
    }
  }
  if (hasClient) {
    const inter = intersect(clientStart!, clientEnd!, windowStart, windowEnd)
    if (inter) {
      const slot = tryWindow(inter[0], inter[1])
      if (slot) return slot
    }
  }
  if (hasPref) {
    const slot = tryWindow(prefStart!, prefEnd!)
    if (slot) return slot
  }
  return tryWindow(windowStart, windowEnd)
}

// ── Routes ──

// GET /api/roster-optimizer/roster
app.get('/roster', async (c) => {
  try {
    const cgRes = await db.execute(sql`
      SELECT
        u.id, u.first_name, u.last_name, u.phone, u.hire_date,
        COALESCE(cs.max_hours_per_week, 40) AS max_hours_per_week,
        COALESCE((
          SELECT ROUND(SUM(EXTRACT(EPOCH FROM (end_time::time - start_time::time)) / 3600)::numeric, 2)
          FROM schedules WHERE caregiver_id = u.id AND is_active = true AND schedule_type = 'recurring' AND day_of_week IS NOT NULL
        ), 0) AS current_weekly_hours,
        COALESCE((SELECT COUNT(DISTINCT client_id) FROM schedules WHERE caregiver_id = u.id AND is_active = true), 0) AS active_client_count
      FROM users u
      LEFT JOIN caregiver_availability cs ON cs.caregiver_id = u.id
      WHERE u.role = 'caregiver' AND u.is_active = true
      ORDER BY u.first_name, u.last_name
    `)

    const clRes = await db.execute(sql`
      SELECT
        c.id, c.first_name, c.last_name, c.service_type, c.address, c.city,
        c.preferred_caregivers, c.do_not_use_caregivers,
        COALESCE(c.weekly_authorized_units, 0) AS assigned_hours_per_week,
        c.service_days_per_week, c.service_allowed_days,
        COALESCE((
          SELECT ARRAY_AGG(DISTINCT day_of_week ORDER BY day_of_week)
          FROM schedules WHERE client_id = c.id AND is_active = true AND schedule_type = 'recurring' AND day_of_week IS NOT NULL
        ), '{}') AS scheduled_days,
        COALESCE((SELECT ARRAY_AGG(DISTINCT caregiver_id) FROM schedules WHERE client_id = c.id AND is_active = true), '{}') AS current_caregivers
      FROM clients c WHERE c.is_active = true ORDER BY c.last_name, c.first_name
    `)

    return c.json({ caregivers: cgRes.rows, clients: clRes.rows })
  } catch (err: any) {
    console.error('Roster fetch error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/roster-optimizer/run
app.post('/run', async (c) => {
  try {
    const body = await c.req.json()
    const { caregivers: inputCaregivers, clients: inputClients } = body
    if (!inputCaregivers?.length || !inputClients?.length) {
      return c.json({ error: 'Need at least one caregiver and one client' }, 400)
    }

    const cgIds: string[] = inputCaregivers.map((cg: any) => cg.id)
    const clIds: string[] = inputClients.map((cl: any) => cl.id)

    const cgIdList = sql.join(cgIds.map((id: string) => sql`${id}`), sql`, `)
    const clIdList = sql.join(clIds.map((id: string) => sql`${id}`), sql`, `)

    const cgDataRes = await db.execute(sql`
      SELECT u.id, u.first_name, u.last_name,
             a.monday_available, a.tuesday_available, a.wednesday_available,
             a.thursday_available, a.friday_available, a.saturday_available, a.sunday_available,
             a.monday_start_time, a.tuesday_start_time, a.wednesday_start_time,
             a.thursday_start_time, a.friday_start_time, a.saturday_start_time, a.sunday_start_time,
             a.monday_end_time, a.tuesday_end_time, a.wednesday_end_time,
             a.thursday_end_time, a.friday_end_time, a.saturday_end_time, a.sunday_end_time,
             a.monday_preferred_start, a.tuesday_preferred_start, a.wednesday_preferred_start,
             a.thursday_preferred_start, a.friday_preferred_start, a.saturday_preferred_start, a.sunday_preferred_start,
             a.monday_preferred_end, a.tuesday_preferred_end, a.wednesday_preferred_end,
             a.thursday_preferred_end, a.friday_preferred_end, a.saturday_preferred_end, a.sunday_preferred_end
      FROM users u
      LEFT JOIN caregiver_availability a ON a.caregiver_id = u.id
      WHERE u.id IN (${cgIdList})
    `)
    const cgMap: Record<string, any> = {}
    cgDataRes.rows.forEach((r: any) => { cgMap[r.id] = r })

    const AVAIL_KEYS_ALL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    inputCaregivers.forEach((cg: any) => {
      if (cg.preferredStart && cg.preferredEnd && cgMap[cg.id]) {
        AVAIL_KEYS_ALL.forEach(dayKey => {
          cgMap[cg.id][`${dayKey}_preferred_start`] = cg.preferredStart
          cgMap[cg.id][`${dayKey}_preferred_end`] = cg.preferredEnd
        })
      }
    })

    const clDataRes = await db.execute(sql`
      SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers
      FROM clients WHERE id IN (${clIdList})
    `)
    const clMap: Record<string, any> = {}
    clDataRes.rows.forEach((r: any) => { clMap[r.id] = r })

    const existingRes = await db.execute(sql`
      SELECT s.id, s.caregiver_id, s.client_id, s.day_of_week,
             s.start_time::text AS start_time, s.end_time::text AS end_time,
             u.first_name AS cg_first, u.last_name AS cg_last,
             c.first_name AS cl_first, c.last_name AS cl_last
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id IN (${cgIdList})
        AND s.is_active = true AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
      ORDER BY s.caregiver_id, s.day_of_week, s.start_time
    `)
    const existingSchedules = existingRes.rows as any[]

    const cgSlotMap: Record<string, Record<number, any[]>> = {}
    cgIds.forEach(id => { cgSlotMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } })
    existingSchedules.forEach((s: any) => {
      if (cgSlotMap[s.caregiver_id] && s.day_of_week !== null) {
        cgSlotMap[s.caregiver_id][s.day_of_week].push({
          start: normalizeTime(s.start_time), end: normalizeTime(s.end_time),
          clientId: s.client_id, clientName: `${s.cl_first} ${s.cl_last}`,
          scheduleId: s.id, isExisting: true,
        })
      }
    })

    const cgRemaining: Record<string, number> = {}
    inputCaregivers.forEach((cg: any) => {
      const existingHrs = existingSchedules
        .filter((s: any) => s.caregiver_id === cg.id)
        .reduce((sum: number, s: any) => sum + (toHours(normalizeTime(s.end_time)) - toHours(normalizeTime(s.start_time))), 0)
      cgRemaining[cg.id] = Math.max(0, parseFloat(cg.targetHours) - existingHrs)
    })

    const proposals: any[] = []
    const unscheduled: any[] = []
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const WEEKDAY_ORDER = [1, 3, 2, 4, 5, 0, 6]

    for (const clInput of inputClients) {
      const { id: clId, hoursPerWeek, visitsPerWeek, preferredDays: clientPreferredDays, timeWindowStart, timeWindowEnd } = clInput as any
      const clInfo = clMap[clId]
      if (!clInfo) continue

      const hrsPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2))
      const visitMins = Math.round(hrsPerVisit * 60)

      const existingClientDays = new Set(existingSchedules.filter((s: any) => s.client_id === clId).map((s: any) => s.day_of_week))
      const placedDays = new Set(existingClientDays)
      let visitsPlaced = 0

      const ranked = inputCaregivers
        .map((cg: any) => {
          const isBlocked = Array.isArray(clInfo.do_not_use_caregivers) && clInfo.do_not_use_caregivers.includes(cg.id)
          const isPreferred = Array.isArray(clInfo.preferred_caregivers) && clInfo.preferred_caregivers.includes(cg.id)
          const alreadySees = existingSchedules.some((s: any) => s.caregiver_id === cg.id && s.client_id === clId)
          return {
            ...cg, isBlocked,
            score: isBlocked ? -999 : (isPreferred ? 20 : 0) + (alreadySees ? 10 : 0) + (cgRemaining[cg.id] > 0 ? 5 : 0),
          }
        })
        .filter((cg: any) => !cg.isBlocked)
        .sort((a: any, b: any) => b.score - a.score)

      const tryDays = (Array.isArray(clientPreferredDays) && clientPreferredDays.length > 0)
        ? clientPreferredDays : WEEKDAY_ORDER

      for (let v = 0; v < visitsPerWeek; v++) {
        let placed = false
        for (const day of tryDays) {
          if (placedDays.has(day)) continue
          for (const cg of ranked) {
            if (cgRemaining[cg.id] < hrsPerVisit - 0.01) continue
            const cgInfo = cgMap[cg.id]
            const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
            const dayKey = AVAIL_KEYS[day]
            const isAvailable = cgInfo ? (cgInfo[`${dayKey}_available`] !== false) : true
            if (!isAvailable) continue

            const daySlots = cgSlotMap[cg.id][day]
            const windowStart = cgInfo?.[`${dayKey}_start_time`] ? normalizeTime(cgInfo[`${dayKey}_start_time`]) : '08:00'
            const windowEnd = cgInfo?.[`${dayKey}_end_time`] ? normalizeTime(cgInfo[`${dayKey}_end_time`]) : '18:00'
            const prefStart = cgInfo?.[`${dayKey}_preferred_start`] ? normalizeTime(cgInfo[`${dayKey}_preferred_start`]) : null
            const prefEnd = cgInfo?.[`${dayKey}_preferred_end`] ? normalizeTime(cgInfo[`${dayKey}_preferred_end`]) : null
            const startTime = findSlotWithPreferred(daySlots, visitMins, windowStart, windowEnd, prefStart, prefEnd, timeWindowStart || null, timeWindowEnd || null)
            if (!startTime) continue

            const endTime = addMins(startTime, visitMins)
            const conflicts = daySlots
              .filter((s: any) => s.isExisting && overlaps(startTime, endTime, s.start, s.end))
              .map((s: any) => ({ clientName: s.clientName, start: s.start, end: s.end }))

            proposals.push({
              id: createId(), clientId: clId,
              clientName: `${clInfo.first_name} ${clInfo.last_name}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.first_name || ''} ${cgMap[cg.id]?.last_name || ''}`.trim(),
              dayOfWeek: day, dayName: DAY_NAMES[day],
              startTime, endTime, hoursPerVisit: hrsPerVisit,
              hasConflict: conflicts.length > 0, conflictsWith: conflicts,
            })

            cgSlotMap[cg.id][day].push({
              start: startTime, end: endTime, clientId: clId,
              clientName: `${clInfo.first_name} ${clInfo.last_name}`, isExisting: false,
            })
            cgRemaining[cg.id] -= hrsPerVisit
            placedDays.add(day)
            visitsPlaced++
            placed = true
            break
          }
          if (placed) break
        }
        if (!placed) {
          const topCg = ranked[0]
          unscheduled.push({
            clientId: clId, clientName: `${clInfo.first_name} ${clInfo.last_name}`,
            visitNumber: v + 1,
            reason: topCg && cgRemaining[topCg.id] < hrsPerVisit
              ? 'All caregivers at hour capacity' : 'No available time slot found for any caregiver',
          })
        }
      }
    }

    // Build summary
    const cgSummary = inputCaregivers.map((cg: any) => {
      const info = cgMap[cg.id] || {}
      const existingHrs = existingSchedules.filter((s: any) => s.caregiver_id === cg.id)
        .reduce((sum: number, s: any) => sum + (toHours(normalizeTime(s.end_time)) - toHours(normalizeTime(s.start_time))), 0)
      const proposedHrs = proposals.filter(p => p.caregiverId === cg.id).reduce((sum: number, p: any) => sum + p.hoursPerVisit, 0)
      return {
        id: cg.id, name: `${info.first_name || ''} ${info.last_name || ''}`.trim(),
        targetHours: parseFloat(cg.targetHours),
        existingHours: parseFloat(existingHrs.toFixed(2)),
        proposedNewHours: parseFloat(proposedHrs.toFixed(2)),
        totalHours: parseFloat((existingHrs + proposedHrs).toFixed(2)),
        remainingCapacity: parseFloat(cgRemaining[cg.id].toFixed(2)),
        utilizationPct: parseFloat(cg.targetHours) > 0
          ? Math.min(100, Math.round(((existingHrs + proposedHrs) / parseFloat(cg.targetHours)) * 100)) : 0,
      }
    })

    const clSummary = inputClients.map((cl: any) => {
      const info = clMap[cl.id] || {}
      const placed = proposals.filter(p => p.clientId === cl.id).length
      return {
        id: cl.id, name: `${info.first_name || ''} ${info.last_name || ''}`.trim(),
        visitsNeeded: cl.visitsPerWeek, visitsPlaced: placed,
        hoursPerWeek: cl.hoursPerWeek, fullyScheduled: placed >= cl.visitsPerWeek,
      }
    })

    return c.json({
      proposals,
      existingSchedules: existingSchedules.map((s: any) => ({
        id: s.id, caregiverId: s.caregiver_id, caregiverName: `${s.cg_first} ${s.cg_last}`,
        clientId: s.client_id, clientName: `${s.cl_first} ${s.cl_last}`,
        dayOfWeek: s.day_of_week, startTime: normalizeTime(s.start_time), endTime: normalizeTime(s.end_time),
      })),
      unscheduled,
      summary: {
        caregivers: cgSummary, clients: clSummary,
        totalProposals: proposals.length,
        conflictCount: proposals.filter(p => p.hasConflict).length,
        unscheduledCount: unscheduled.length,
        fullyScheduledClients: clSummary.filter((cl: any) => cl.fullyScheduled).length,
        totalClients: clSummary.length,
      },
    })
  } catch (err: any) {
    console.error('Roster optimizer run error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/roster-optimizer/apply
app.post('/apply', async (c) => {
  try {
    const body = await c.req.json()
    const { proposals } = body
    if (!proposals?.length) return c.json({ error: 'No proposals to apply' }, 400)

    const created: string[] = []
    const errors: any[] = []

    for (const p of proposals) {
      try {
        const id = createId()
        await db.execute(sql`
          INSERT INTO schedules (id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, is_active)
          VALUES (${id}, ${p.caregiverId}, ${p.clientId}, 'recurring', ${p.dayOfWeek}, ${p.startTime}, ${p.endTime}, 'Created by Roster Optimizer', true)
        `)
        created.push(id)
      } catch (err: any) {
        errors.push({ proposal: p, error: err.message })
      }
    }

    return c.json({ success: true, created: created.length, errors: errors.length, errorDetails: errors })
  } catch (err: any) {
    console.error('Roster optimizer apply error:', err)
    return c.json({ error: err.message }, 500)
  }
})

export default app
