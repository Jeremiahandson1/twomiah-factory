import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function timeToHours(timeStr: string | null | undefined): number {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return h + m / 60
}

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart
}

/**
 * 4-tier slot priority:
 * 1) Intersection of client time window + caregiver preferred hours
 * 2) Client time window within caregiver full availability
 * 3) Caregiver preferred hours (if no client window)
 * 4) Full caregiver availability window
 */
function findAvailableSlot(
  existingSlots: Array<{ start: string; end: string }>,
  durationMins: number,
  cgInfo: Record<string, any> | undefined,
  dayOfWeek: number,
  clientWindowStart?: string | null,
  clientWindowEnd?: string | null,
): string | null {
  const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayKey = AVAIL_KEYS[dayOfWeek]
  const cgStart: string = cgInfo?.[`${dayKey}_start_time`] || '08:00'
  const cgEnd: string = cgInfo?.[`${dayKey}_end_time`] || '18:00'
  const cgPrefStart: string | undefined = cgInfo?.[`${dayKey}_preferred_start`]
  const cgPrefEnd: string | undefined = cgInfo?.[`${dayKey}_preferred_end`]

  const hasClientWindow = !!(clientWindowStart && clientWindowEnd)
  const hasCgPref = !!(cgPrefStart && cgPrefEnd)
  const sorted = [...existingSlots].sort((a, b) => a.start.localeCompare(b.start))

  function tryWindow(wStart: string, wEnd: string): string | null {
    if (wStart >= wEnd) return null
    const candidates = [wStart, ...sorted.map(s => s.end)]
    for (const candidate of candidates) {
      if (candidate < wStart) continue
      if (candidate >= wEnd) break
      const proposedEnd = addMinutes(candidate, durationMins)
      if (proposedEnd > wEnd) break
      const hasConflict = sorted.some(s => timesOverlap(candidate, proposedEnd, s.start, s.end))
      if (!hasConflict) return candidate
    }
    return null
  }

  function intersect(aStart: string, aEnd: string, bStart: string, bEnd: string): [string, string] | null {
    const s = aStart > bStart ? aStart : bStart
    const e = aEnd < bEnd ? aEnd : bEnd
    return s < e ? [s, e] : null
  }

  if (hasClientWindow && hasCgPref) {
    const inter = intersect(clientWindowStart!, clientWindowEnd!, cgPrefStart!, cgPrefEnd!)
    if (inter) {
      const slot = tryWindow(inter[0], inter[1])
      if (slot) return slot
    }
  }
  if (hasClientWindow) {
    const inter = intersect(clientWindowStart!, clientWindowEnd!, cgStart, cgEnd)
    if (inter) {
      const slot = tryWindow(inter[0], inter[1])
      if (slot) return slot
    }
  }
  if (hasCgPref) {
    const slot = tryWindow(cgPrefStart!, cgPrefEnd!)
    if (slot) return slot
  }
  return tryWindow(cgStart, cgEnd)
}

// ---------------------------------------------------------------------------
// Helper to build a sql IN-list from an array of strings
// ---------------------------------------------------------------------------

function sqlInList(ids: string[]) {
  return sql.join(ids.map(id => sql`${id}`), sql`, `)
}

// ---------------------------------------------------------------------------
// GET /client-data/:clientId
// ---------------------------------------------------------------------------

app.get('/client-data/:clientId', async (c) => {
  try {
    const clientId = c.req.param('clientId')

    const clientRes = await db.execute(sql`
      SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers, service_type,
             weekly_authorized_units, service_days_per_week, service_allowed_days
      FROM clients WHERE id = ${clientId}
    `)
    if (clientRes.rows.length === 0) {
      return c.json({ error: 'Client not found' }, 404)
    }
    const client = clientRes.rows[0] as Record<string, any>

    const authRes = await db.execute(sql`
      SELECT authorized_units, used_units, unit_type, start_date, end_date,
             authorized_units - used_units as remaining_units
      FROM authorizations
      WHERE client_id = ${clientId} AND status = 'active'
        AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
      ORDER BY end_date ASC LIMIT 1
    `)

    const auth = (authRes.rows[0] as Record<string, any>) || null
    let authorizedHoursPerWeek = 0
    let remainingHours = 0

    if (auth) {
      const startDate = new Date(auth.start_date)
      const endDate = new Date(auth.end_date)
      const weeks = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      const totalHours = auth.unit_type === '15min'
        ? parseFloat(auth.authorized_units) / 4
        : parseFloat(auth.authorized_units)
      const remainingTotalHours = auth.unit_type === '15min'
        ? parseFloat(auth.remaining_units) / 4
        : parseFloat(auth.remaining_units)
      authorizedHoursPerWeek = parseFloat((totalHours / weeks).toFixed(2))
      remainingHours = parseFloat(remainingTotalHours.toFixed(2))
    }

    const schedRes = await db.execute(sql`
      SELECT s.day_of_week, s.start_time, s.end_time, s.caregiver_id,
             u.first_name as caregiver_first, u.last_name as caregiver_last
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      WHERE s.client_id = ${clientId} AND s.is_active = true
        AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
      ORDER BY s.day_of_week, s.start_time
    `)

    const clientWeeklyUnits = parseFloat(client.weekly_authorized_units) || 0
    const assignedHoursPerWeek = clientWeeklyUnits || authorizedHoursPerWeek || null

    return c.json({
      client,
      authorization: auth,
      authorizedHoursPerWeek: clientWeeklyUnits || authorizedHoursPerWeek,
      remainingHours,
      assignedHoursPerWeek,
      serviceDaysPerWeek: client.service_days_per_week || null,
      serviceAllowedDays: client.service_allowed_days || null,
      existingScheduleDays: schedRes.rows.map((r: any) => r.day_of_week),
      existingSchedules: schedRes.rows,
    })
  } catch (err: any) {
    console.error('Optimizer client-data error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /run
// ---------------------------------------------------------------------------

app.post('/run', async (c) => {
  try {
    const body = await c.req.json()
    const { caregivers: selectedCaregivers, clients: selectedClients } = body

    if (!selectedCaregivers?.length || !selectedClients?.length) {
      return c.json({ error: 'Must provide at least one caregiver and one client' }, 400)
    }

    const caregiverIds: string[] = selectedCaregivers.map((cg: any) => cg.id)
    const clientIds: string[] = selectedClients.map((cl: any) => cl.id)

    // Fetch existing schedules for selected caregivers
    const existingRes = await db.execute(sql`
      SELECT s.id, s.caregiver_id, s.client_id, s.day_of_week, s.start_time, s.end_time,
             s.schedule_type, s.frequency,
             u.first_name as cg_first, u.last_name as cg_last,
             c.first_name as cl_first, c.last_name as cl_last
      FROM schedules s
      JOIN users u ON s.caregiver_id = u.id
      JOIN clients c ON s.client_id = c.id
      WHERE s.caregiver_id IN (${sqlInList(caregiverIds)}) AND s.is_active = true
        AND s.schedule_type = 'recurring' AND s.day_of_week IS NOT NULL
      ORDER BY s.caregiver_id, s.day_of_week, s.start_time
    `)
    const existingSchedules = existingRes.rows as Record<string, any>[]

    // Fetch client data
    const clientDataRes = await db.execute(sql`
      SELECT id, first_name, last_name, preferred_caregivers, do_not_use_caregivers
      FROM clients WHERE id IN (${sqlInList(clientIds)})
    `)
    const clientMap: Record<string, any> = {}
    clientDataRes.rows.forEach((c: any) => { clientMap[c.id] = c })

    // Fetch caregiver availability data
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
      WHERE u.id IN (${sqlInList(caregiverIds)})
    `)
    const cgMap: Record<string, any> = {}
    cgDataRes.rows.forEach((cg: any) => { cgMap[cg.id] = cg })

    // Apply per-caregiver preferred shift overrides
    const AVAIL_KEYS_ALL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    selectedCaregivers.forEach((cg: any) => {
      if (cg.preferredStart && cg.preferredEnd && cgMap[cg.id]) {
        AVAIL_KEYS_ALL.forEach(dayKey => {
          cgMap[cg.id][`${dayKey}_preferred_start`] = cg.preferredStart
          cgMap[cg.id][`${dayKey}_preferred_end`] = cg.preferredEnd
        })
      }
    })

    // Build schedule map: caregiverId -> dayOfWeek -> slots
    const cgScheduleMap: Record<string, Record<number, Array<{
      start: string; end: string; clientId: string; clientName: string;
      scheduleId?: string; isExisting: boolean
    }>>> = {}
    caregiverIds.forEach(id => {
      cgScheduleMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
    })
    existingSchedules.forEach(s => {
      if (cgScheduleMap[s.caregiver_id] && s.day_of_week !== null) {
        cgScheduleMap[s.caregiver_id][s.day_of_week].push({
          start: s.start_time,
          end: s.end_time,
          clientId: s.client_id,
          clientName: `${s.cl_first} ${s.cl_last}`,
          scheduleId: s.id,
          isExisting: true,
        })
      }
    })

    // Track remaining hours per caregiver
    const cgRemainingHours: Record<string, number> = {}
    selectedCaregivers.forEach((cg: any) => {
      let alreadyBooked = 0
      existingSchedules.filter(s => s.caregiver_id === cg.id).forEach(s => {
        alreadyBooked += timeToHours(s.end_time) - timeToHours(s.start_time)
      })
      cgRemainingHours[cg.id] = Math.max(0, parseFloat(cg.allocatedHours) - alreadyBooked)
    })

    // Run optimization
    const proposals: any[] = []
    const unscheduled: any[] = []
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

    for (const clientCfg of selectedClients) {
      const {
        id: clientId,
        visitsPerWeek,
        hoursPerWeek,
        preferredDays: clientPreferredDays,
        timeWindowStart,
        timeWindowEnd,
      } = clientCfg
      const clientInfo = clientMap[clientId]
      if (!clientInfo) continue

      const hoursPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2))
      const visitDurationMins = Math.round(hoursPerVisit * 60)

      const clientExistingDays = existingSchedules
        .filter(s => s.client_id === clientId)
        .map(s => s.day_of_week)

      const clientPlacedDays = new Set<number>(clientExistingDays)
      let visitsPlaced = 0

      // Score and rank caregivers for this client
      const scoredCaregivers = selectedCaregivers.map((cg: any) => {
        const info = clientInfo
        const isPreferred = Array.isArray(info.preferred_caregivers) && info.preferred_caregivers.includes(cg.id)
        const isBlocked = Array.isArray(info.do_not_use_caregivers) && info.do_not_use_caregivers.includes(cg.id)
        const alreadySees = existingSchedules.some(s => s.caregiver_id === cg.id && s.client_id === clientId)
        return {
          ...cg,
          score: isBlocked ? -999 : (isPreferred ? 10 : 0) + (alreadySees ? 5 : 0),
          isBlocked,
        }
      }).filter((cg: any) => !cg.isBlocked).sort((a: any, b: any) => b.score - a.score)

      const tryDays: number[] = (Array.isArray(clientPreferredDays) && clientPreferredDays.length > 0)
        ? clientPreferredDays
        : [1, 3, 2, 4, 5, 0, 6]

      for (let visit = 0; visit < visitsPerWeek && visitsPlaced < visitsPerWeek; visit++) {
        let placed = false

        for (const day of tryDays) {
          if (clientPlacedDays.has(day)) continue

          for (const cg of scoredCaregivers) {
            if (cgRemainingHours[cg.id] < hoursPerVisit - 0.01) continue

            const cgInfo = cgMap[cg.id]
            const dayKey = AVAIL_KEYS[day]
            const isAvailable = cgInfo ? (cgInfo[`${dayKey}_available`] !== false) : true
            if (!isAvailable) continue

            const daySlots = cgScheduleMap[cg.id][day]
            const startTime = findAvailableSlot(daySlots, visitDurationMins, cgInfo, day, timeWindowStart, timeWindowEnd)
            if (!startTime) continue

            const endTime = addMinutes(startTime, visitDurationMins)

            const overlap = daySlots.filter(slot =>
              (slot as any).isExisting && timesOverlap(startTime, endTime, slot.start, slot.end),
            )

            const proposal = {
              id: createId(),
              clientId,
              clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.first_name || ''} ${cgMap[cg.id]?.last_name || ''}`.trim(),
              dayOfWeek: day,
              dayName: DAY_NAMES[day],
              startTime,
              endTime,
              hoursPerVisit,
              hasConflict: overlap.length > 0,
              conflictsWith: overlap.map((o: any) => ({
                scheduleId: o.scheduleId,
                clientName: o.clientName,
                start: o.start,
                end: o.end,
                suggestion: `Consider moving ${o.clientName} to another time slot`,
              })),
              isNew: !clientExistingDays.includes(day),
            }

            proposals.push(proposal)
            cgScheduleMap[cg.id][day].push({
              start: startTime,
              end: endTime,
              clientId,
              clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
              isExisting: false,
            })
            cgRemainingHours[cg.id] -= hoursPerVisit
            clientPlacedDays.add(day)
            visitsPlaced++
            placed = true
            break
          }
          if (placed) break
        }

        if (!placed) {
          unscheduled.push({
            clientId,
            clientName: `${clientInfo.first_name} ${clientInfo.last_name}`,
            visitNumber: visit + 1,
            reason: cgRemainingHours[scoredCaregivers[0]?.id] < hoursPerVisit
              ? 'Caregivers at hour capacity'
              : 'No available time slots found',
          })
        }
      }
    }

    // Build summary
    const summary = {
      caregivers: selectedCaregivers.map((cg: any) => {
        const cgInfo = cgMap[cg.id]
        const name = `${cgInfo?.first_name || ''} ${cgInfo?.last_name || ''}`.trim()
        const proposedHours = proposals
          .filter(p => p.caregiverId === cg.id)
          .reduce((sum: number, p: any) => sum + p.hoursPerVisit, 0)
        const existingHours = existingSchedules
          .filter(s => s.caregiver_id === cg.id)
          .reduce((sum: number, s: any) => sum + (timeToHours(s.end_time) - timeToHours(s.start_time)), 0)
        return {
          id: cg.id,
          name,
          allocatedHours: parseFloat(cg.allocatedHours),
          existingHours: parseFloat(existingHours.toFixed(2)),
          proposedNewHours: parseFloat(proposedHours.toFixed(2)),
          totalHours: parseFloat((existingHours + proposedHours).toFixed(2)),
          remainingHours: parseFloat(cgRemainingHours[cg.id].toFixed(2)),
        }
      }),
      clients: selectedClients.map((cl: any) => {
        const clientInfo = clientMap[cl.id]
        const name = `${clientInfo?.first_name || ''} ${clientInfo?.last_name || ''}`.trim()
        const placedVisits = proposals.filter(p => p.clientId === cl.id).length
        return {
          id: cl.id,
          name,
          visitsNeeded: cl.visitsPerWeek,
          visitsPlaced: placedVisits,
          hoursPerWeek: cl.hoursPerWeek,
          fullyScheduled: placedVisits >= cl.visitsPerWeek,
        }
      }),
      totalProposals: proposals.length,
      conflictCount: proposals.filter(p => p.hasConflict).length,
      unscheduledCount: unscheduled.length,
    }

    return c.json({
      proposals,
      existingSchedules: existingSchedules.map(s => ({
        id: s.id,
        caregiverId: s.caregiver_id,
        caregiverName: `${s.cg_first} ${s.cg_last}`,
        clientId: s.client_id,
        clientName: `${s.cl_first} ${s.cl_last}`,
        dayOfWeek: s.day_of_week,
        startTime: s.start_time,
        endTime: s.end_time,
      })),
      unscheduled,
      summary,
    })
  } catch (err: any) {
    console.error('Optimizer run error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /apply
// ---------------------------------------------------------------------------

app.post('/apply', async (c) => {
  try {
    const body = await c.req.json()
    const { proposals } = body

    if (!proposals?.length) {
      return c.json({ error: 'No proposals to apply' }, 400)
    }

    const created: string[] = []
    const errors: Array<{ proposal: any; error: string }> = []

    for (const p of proposals) {
      try {
        const id = createId()
        await db.execute(sql`
          INSERT INTO schedules
            (id, caregiver_id, client_id, schedule_type, day_of_week, start_time, end_time, notes, is_active)
          VALUES (${id}, ${p.caregiverId}, ${p.clientId}, 'recurring', ${p.dayOfWeek}, ${p.startTime}, ${p.endTime},
                  'Created by Schedule Optimizer', true)
        `)
        created.push(id)
      } catch (err: any) {
        errors.push({ proposal: p, error: err.message })
      }
    }

    return c.json({ success: true, created: created.length, errors: errors.length, errorDetails: errors })
  } catch (err: any) {
    console.error('Optimizer apply error:', err)
    return c.json({ error: err.message }, 500)
  }
})

export default app
