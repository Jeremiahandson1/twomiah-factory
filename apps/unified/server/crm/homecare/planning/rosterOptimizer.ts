// The roster optimizer (/api/roster-optimizer: /roster, /run, /apply). Moved from
// templates/crm-homecare/backend/src/routes/rosterOptimizer.ts.
//
// "Existing hours" are a caregiver's scheduled hours in ONE Sunday–Saturday week through the schedule engine, so one-time
// visits, filled open shifts, cancelled or suspended days and ended patterns count as they really are (the template's
// own fix: summing pattern rows read "0h existing" beside a grid showing 4.00h).
//
// Who may: the template put it behind requireAdmin. Reading the roster and proposing a week ask care-schedule:update;
// writing the proposals as patterns asks care-schedule:create — writes of the schedule area a caregiver does not hold.
import { Hono, type Context } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createHomecareCore } from '../core/index.ts'
import { sundayOfWeek, addDays } from '../core/agencyTime.ts'
import { DEFAULT_WORKING_DAY } from '../core/workingDay.ts'
import { AVAIL_KEYS, applyPreferredHours, applyProposals, preferredDaysMap } from './scheduleOptimizer.ts'
import * as q from '../../../data/homecarePlanning.ts'

async function body(c: Context): Promise<any> { try { return (await c.req.json()) || {} } catch { return {} } }

function normalizeTime(t: string | null | undefined): string {
  if (!t) return '08:00'
  return String(t).slice(0, 5)
}
function toHours(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

/** Hours between two HH:MM times, wrapping past midnight (an overnight shift is not negative hours). */
export function shiftSpan(startT: string | null | undefined, endT: string | null | undefined): number {
  const h = toHours(normalizeTime(endT)) - toHours(normalizeTime(startT))
  return h <= 0 ? h + 24 : h
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
/** The Sunday of the week holding `ymd`. */
export function sundayOf(ymd: string): string {
  return sundayOfWeek(ymd)
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
  existingSlots: any[], durationMins: number, windowStart: string, windowEnd: string,
  prefStart: string | null, prefEnd: string | null, clientStart: string | null, clientEnd: string | null,
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
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot }
  }
  if (hasClient) {
    const inter = intersect(clientStart!, clientEnd!, windowStart, windowEnd)
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot }
  }
  if (hasPref) {
    const slot = tryWindow(prefStart!, prefEnd!)
    if (slot) return slot
  }
  return tryWindow(windowStart, windowEnd)
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_ORDER = [1, 3, 2, 4, 5, 0, 6]

export function createRosterOptimizerRoutes(d: CrmDeps) {
  const core = createHomecareCore(d)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /** The grid's Sunday-to-Saturday week: the one holding `weekOf`, default the agency's current one. */
  async function rosterWeek(companyId: string, weekOf: unknown): Promise<{ start: string; end: string }> {
    const start = sundayOf(typeof weekOf === 'string' && YMD.test(weekOf) ? weekOf : await core.time.today(companyId))
    return { start, end: addDays(start, 6) }
  }

  // GET /roster — the active caregivers (with this week's scheduled hours) and the active clients.
  app.get('/roster', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const [cgRows, clients] = await Promise.all([q.rosterCaregivers(d.db, companyId), q.rosterClients(d.db, companyId)])
    const week = await rosterWeek(companyId, c.req.query('weekOf'))
    const hours = await q.weekHoursByCaregiver(d.db, companyId, week.start, week.end)
    const caregivers = cgRows.map((cg: any) => ({ ...cg, currentWeeklyHours: hours[cg.id] || 0 }))
    return one(c, { caregivers, clients, week })
  })

  // POST /run — propose visits for the chosen clients across the chosen caregivers, toward each caregiver's target.
  app.post('/run', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const { caregivers: inputCaregivers, clients: inputClients } = b
    if (!Array.isArray(inputCaregivers) || !inputCaregivers.length || !Array.isArray(inputClients) || !inputClients.length) {
      return fail(c, 400, 'Need at least one caregiver and one client')
    }
    const cgIds: string[] = inputCaregivers.map((cg: any) => String(cg.id))
    const clIds: string[] = inputClients.map((cl: any) => String(cl.id))

    const [cgRows, clRows, existingSchedules] = await Promise.all([
      q.caregiversAvailability(d.db, companyId, cgIds),
      q.clientsCaregiverPreferences(d.db, companyId, clIds),
      q.caregiversRecurringPatterns(d.db, companyId, cgIds),
    ])
    const cgMap: Record<string, any> = Object.fromEntries(cgRows.map((r: any) => [r.id, r]))
    const clMap: Record<string, any> = Object.fromEntries(clRows.map((r: any) => [r.id, r]))
    applyPreferredHours(cgMap, inputCaregivers)

    const cgSlotMap: Record<string, Record<number, any[]>> = {}
    cgIds.forEach((id) => { cgSlotMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } })
    existingSchedules.forEach((s: any) => {
      if (cgSlotMap[s.caregiverId] && s.dayOfWeek !== null) {
        cgSlotMap[s.caregiverId][s.dayOfWeek].push({
          start: normalizeTime(s.startTime), end: normalizeTime(s.endTime),
          clientId: s.clientId, clientName: `${s.clFirst} ${s.clLast}`, scheduleId: s.id, isExisting: true,
        })
      }
    })

    // Existing hours: the same engine week the roster shows.
    const week = await rosterWeek(companyId, b.weekOf)
    const weekHours = await q.weekHoursByCaregiver(d.db, companyId, week.start, week.end)
    const cgRemaining: Record<string, number> = {}
    inputCaregivers.forEach((cg: any) => { cgRemaining[cg.id] = Math.max(0, parseFloat(cg.targetHours) - (weekHours[cg.id] || 0)) })
    const cgPreferredDaysMap = preferredDaysMap(inputCaregivers)

    const proposals: any[] = []
    const unscheduled: any[] = []
    for (const clInput of inputClients) {
      const { id: clId, hoursPerWeek, visitsPerWeek, preferredDays: clientPreferredDays, timeWindowStart, timeWindowEnd } = clInput as any
      const clInfo = clMap[clId]
      if (!clInfo) continue

      const hrsPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2))
      const visitMins = Math.round(hrsPerVisit * 60)
      const existingClientDays = new Set(existingSchedules.filter((s: any) => s.clientId === clId).map((s: any) => s.dayOfWeek))
      const placedDays = new Set(existingClientDays)

      const ranked = inputCaregivers
        .map((cg: any) => {
          const isBlocked = Array.isArray(clInfo.doNotUseCaregivers) && clInfo.doNotUseCaregivers.includes(cg.id)
          const isPreferred = Array.isArray(clInfo.preferredCaregivers) && clInfo.preferredCaregivers.includes(cg.id)
          const alreadySees = existingSchedules.some((s: any) => s.caregiverId === cg.id && s.clientId === clId)
          return { ...cg, isBlocked, score: isBlocked ? -999 : (isPreferred ? 20 : 0) + (alreadySees ? 10 : 0) + (cgRemaining[cg.id] > 0 ? 5 : 0) }
        })
        .filter((cg: any) => !cg.isBlocked)
        .sort((a: any, b2: any) => b2.score - a.score)

      const tryDays = (Array.isArray(clientPreferredDays) && clientPreferredDays.length > 0) ? clientPreferredDays : WEEKDAY_ORDER

      for (let v = 0; v < visitsPerWeek; v++) {
        let placed = false
        for (const day of tryDays) {
          if (placedDays.has(day)) continue
          for (const cg of ranked) {
            if (cgRemaining[cg.id] < hrsPerVisit - 0.01) continue
            // A caregiver with preferred days set for this run is only placed on those days
            if (cgPreferredDaysMap[cg.id] && !cgPreferredDaysMap[cg.id].has(day)) continue
            const cgInfo = cgMap[cg.id]
            const dayKey = AVAIL_KEYS[day]
            const isAvailable = cgInfo ? (cgInfo[`${dayKey}Available`] !== false) : true
            if (!isAvailable) continue

            const daySlots = cgSlotMap[cg.id][day]
            const windowStart = cgInfo?.[`${dayKey}StartTime`] ? normalizeTime(cgInfo[`${dayKey}StartTime`]) : DEFAULT_WORKING_DAY.start
            const windowEnd = cgInfo?.[`${dayKey}EndTime`] ? normalizeTime(cgInfo[`${dayKey}EndTime`]) : DEFAULT_WORKING_DAY.end
            const prefStart = cgInfo?.[`${dayKey}PreferredStart`] ? normalizeTime(cgInfo[`${dayKey}PreferredStart`]) : null
            const prefEnd = cgInfo?.[`${dayKey}PreferredEnd`] ? normalizeTime(cgInfo[`${dayKey}PreferredEnd`]) : null
            const startTime = findSlotWithPreferred(daySlots, visitMins, windowStart, windowEnd, prefStart, prefEnd, timeWindowStart || null, timeWindowEnd || null)
            if (!startTime) continue

            const endTime = addMins(startTime, visitMins)
            const conflicts = daySlots
              .filter((s: any) => s.isExisting && overlaps(startTime, endTime, s.start, s.end))
              .map((s: any) => ({ clientName: s.clientName, start: s.start, end: s.end }))
            proposals.push({
              id: createId(), clientId: clId,
              clientName: `${clInfo.firstName} ${clInfo.lastName}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.firstName || ''} ${cgMap[cg.id]?.lastName || ''}`.trim(),
              dayOfWeek: day, dayName: DAY_NAMES[day],
              startTime, endTime, hoursPerVisit: hrsPerVisit,
              hasConflict: conflicts.length > 0, conflictsWith: conflicts,
            })
            cgSlotMap[cg.id][day].push({ start: startTime, end: endTime, clientId: clId, clientName: `${clInfo.firstName} ${clInfo.lastName}`, isExisting: false })
            cgRemaining[cg.id] -= hrsPerVisit
            placedDays.add(day)
            placed = true
            break
          }
          if (placed) break
        }
        if (!placed) {
          const topCg = ranked[0]
          unscheduled.push({
            clientId: clId, clientName: `${clInfo.firstName} ${clInfo.lastName}`,
            visitNumber: v + 1,
            reason: topCg && cgRemaining[topCg.id] < hrsPerVisit ? 'All caregivers at hour capacity' : 'No available time slot found for any caregiver',
          })
        }
      }
    }

    const cgSummary = inputCaregivers.map((cg: any) => {
      const info = cgMap[cg.id] || {}
      const existingHrs = weekHours[cg.id] || 0
      const proposedHrs = proposals.filter((p) => p.caregiverId === cg.id).reduce((sum: number, p: any) => sum + p.hoursPerVisit, 0)
      return {
        id: cg.id, name: `${info.firstName || ''} ${info.lastName || ''}`.trim(),
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
      const placed = proposals.filter((p) => p.clientId === cl.id).length
      return {
        id: cl.id, name: `${info.firstName || ''} ${info.lastName || ''}`.trim(),
        visitsNeeded: cl.visitsPerWeek, visitsPlaced: placed,
        hoursPerWeek: cl.hoursPerWeek, fullyScheduled: placed >= cl.visitsPerWeek,
      }
    })

    return one(c, {
      week,
      proposals,
      existingSchedules: existingSchedules.map((s: any) => ({
        id: s.id, caregiverId: s.caregiverId, caregiverName: `${s.cgFirst} ${s.cgLast}`,
        clientId: s.clientId, clientName: `${s.clFirst} ${s.clLast}`,
        dayOfWeek: s.dayOfWeek, startTime: normalizeTime(s.startTime), endTime: normalizeTime(s.endTime),
      })),
      unscheduled,
      summary: {
        caregivers: cgSummary, clients: clSummary,
        totalProposals: proposals.length,
        conflictCount: proposals.filter((p) => p.hasConflict).length,
        unscheduledCount: unscheduled.length,
        fullyScheduledClients: clSummary.filter((cl: any) => cl.fullyScheduled).length,
        totalClients: clSummary.length,
      },
    })
  })

  // POST /apply — write the accepted proposals as recurring patterns.
  app.post('/apply', requirePermission('care-schedule:create'), async (c) => {
    const { companyId } = c.get('user')
    const { proposals } = await body(c)
    if (!Array.isArray(proposals) || !proposals.length) return fail(c, 400, 'No proposals to apply')
    const today = await core.time.today(companyId)
    return one(c, await applyProposals(d, companyId, today, proposals, 'Created by Roster Optimizer'))
  })

  return app
}
