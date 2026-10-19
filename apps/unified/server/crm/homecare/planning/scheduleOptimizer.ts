// The schedule optimizer (/api/optimizer: /client-data/:clientId, /run, /apply — beside the route optimizer's older
// /company, /routes and /stats on the same path). Moved from templates/crm-homecare/backend/src/routes/scheduleOptimizer.ts.
//
// Who may: the template put it behind requireAdmin. Proposing a week (client-data, run) asks care-schedule:update and
// writing the proposals as patterns (apply) asks care-schedule:create — the schedule area's writes, which a caregiver
// does not hold.
import { Hono, type Context } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createHomecareCore } from '../core/index.ts'
import { DEFAULT_WORKING_DAY } from '../core/workingDay.ts'
import { authUnitsToHours } from '../core/authUnits.ts'
import * as q from '../../../data/homecarePlanning.ts'

async function body(c: Context): Promise<any> { try { return (await c.req.json()) || {} } catch { return {} } }

function timeToHours(timeStr: string | null | undefined): number {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return h + m / 60
}

/** Hours between two HH:MM times, wrapping past midnight (an overnight shift is not negative hours). */
export function shiftSpan(startT: string | null | undefined, endT: string | null | undefined): number {
  if (!startT || !endT) return 0
  const h = timeToHours(endT) - timeToHours(startT)
  return h <= 0 ? h + 24 : h
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

export const AVAIL_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * 4-tier slot priority: 1) the client's time window ∩ the caregiver's preferred hours; 2) the client's window within
 * the caregiver's full availability; 3) the caregiver's preferred hours; 4) the caregiver's full availability.
 * `cgInfo` is the availability row (camelCase: mondayStartTime, mondayPreferredStart …).
 */
function findAvailableSlot(
  existingSlots: Array<{ start: string; end: string }>,
  durationMins: number,
  cgInfo: Record<string, any> | undefined,
  dayOfWeek: number,
  clientWindowStart?: string | null,
  clientWindowEnd?: string | null,
): string | null {
  const dayKey = AVAIL_KEYS[dayOfWeek]
  const cgStart: string = cgInfo?.[`${dayKey}StartTime`] || DEFAULT_WORKING_DAY.start
  const cgEnd: string = cgInfo?.[`${dayKey}EndTime`] || DEFAULT_WORKING_DAY.end
  const cgPrefStart: string | undefined = cgInfo?.[`${dayKey}PreferredStart`]
  const cgPrefEnd: string | undefined = cgInfo?.[`${dayKey}PreferredEnd`]

  const hasClientWindow = !!(clientWindowStart && clientWindowEnd)
  const hasCgPref = !!(cgPrefStart && cgPrefEnd)
  const sorted = [...existingSlots].sort((a, b) => a.start.localeCompare(b.start))

  function tryWindow(wStart: string, wEnd: string): string | null {
    if (wStart >= wEnd) return null
    const candidates = [wStart, ...sorted.map((s) => s.end)]
    for (const candidate of candidates) {
      if (candidate < wStart) continue
      if (candidate >= wEnd) break
      const proposedEnd = addMinutes(candidate, durationMins)
      if (proposedEnd > wEnd) break
      const hasConflict = sorted.some((s) => timesOverlap(candidate, proposedEnd, s.start, s.end))
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
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot }
  }
  if (hasClientWindow) {
    const inter = intersect(clientWindowStart!, clientWindowEnd!, cgStart, cgEnd)
    if (inter) { const slot = tryWindow(inter[0], inter[1]); if (slot) return slot }
  }
  if (hasCgPref) {
    const slot = tryWindow(cgPrefStart!, cgPrefEnd!)
    if (slot) return slot
  }
  return tryWindow(cgStart, cgEnd)
}

/**
 * Writes proposals as recurring patterns, one at a time: each that fails (a time that is not HH:MM, a caregiver or
 * client not of this company) is reported and the rest go on. Shared by the schedule and roster optimizers.
 */
export async function applyProposals(d: CrmDeps, companyId: string, today: string, proposals: any[], notes: string) {
  const created: string[] = []
  const errors: Array<{ proposal: any; error: string }> = []
  for (const p of proposals) {
    try {
      if (!(await q.personOnFile(d.db, companyId, String(p?.caregiverId ?? '')))) throw new Error('Caregiver not found')
      if (!(await q.clientOnFile(d.db, companyId, String(p?.clientId ?? '')))) throw new Error('Client not found')
      const id = createId()
      await q.insertOptimizerPattern(d.db, companyId, {
        id, caregiverId: String(p.caregiverId), clientId: String(p.clientId), dayOfWeek: p.dayOfWeek,
        date: today, startTime: p.startTime, endTime: p.endTime, notes,
      })
      created.push(id)
    } catch (err: any) {
      errors.push({ proposal: p, error: err.message })
    }
  }
  return { success: true, created: created.length, errors: errors.length, errorDetails: errors }
}

/** Per-run preferred hours from the screen override every day's preferred window. */
export function applyPreferredHours(cgMap: Record<string, any>, caregivers: any[]) {
  for (const cg of caregivers) {
    if (cg.preferredStart && cg.preferredEnd && cgMap[cg.id]) {
      for (const dayKey of AVAIL_KEYS) {
        cgMap[cg.id][`${dayKey}PreferredStart`] = cg.preferredStart
        cgMap[cg.id][`${dayKey}PreferredEnd`] = cg.preferredEnd
      }
    }
  }
}

/** A caregiver's preferred days for this run (session-only; empty = any day). */
export function preferredDaysMap(caregivers: any[]): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {}
  for (const cg of caregivers) if (Array.isArray(cg.preferredDays) && cg.preferredDays.length > 0) out[cg.id] = new Set(cg.preferredDays.map(Number))
  return out
}

export function createScheduleOptimizerRoutes(d: CrmDeps) {
  const core = createHomecareCore(d)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /client-data/:clientId — what the optimizer knows of a client: authorization, hours a week, existing patterns.
  app.get('/client-data/:clientId', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const clientId = c.req.param('clientId')
    const client = await q.optimizerClient(d.db, companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')

    const auth = await q.currentAuthorization(d.db, companyId, clientId)
    let authorizedHoursPerWeek = 0
    let remainingHours = 0
    if (auth) {
      const startDate = new Date(auth.startDate)
      const endDate = new Date(auth.endDate)
      const weeks = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)))
      // core/authUnits.ts: visits and days have no hour equivalent, so they give no hours here.
      const totalHours = authUnitsToHours(parseFloat(auth.authorizedUnits), auth.unitType)
      const remainingTotalHours = authUnitsToHours(parseFloat(auth.remainingUnits), auth.unitType)
      if (totalHours != null) authorizedHoursPerWeek = parseFloat((totalHours / weeks).toFixed(2))
      if (remainingTotalHours != null) remainingHours = parseFloat(remainingTotalHours.toFixed(2))
    }

    const patterns = await q.clientRecurringPatterns(d.db, companyId, clientId)
    const clientWeeklyUnits = parseFloat(client.weeklyAuthorizedUnits) || 0
    const assignedHoursPerWeek = clientWeeklyUnits || authorizedHoursPerWeek || null
    return one(c, {
      client,
      authorization: auth,
      authorizedHoursPerWeek: clientWeeklyUnits || authorizedHoursPerWeek,
      remainingHours,
      assignedHoursPerWeek,
      serviceDaysPerWeek: client.serviceDaysPerWeek || null,
      serviceAllowedDays: client.serviceAllowedDays || null,
      existingScheduleDays: patterns.map((r: any) => r.dayOfWeek),
      existingSchedules: patterns,
    })
  })

  // POST /run — propose visits for the chosen clients across the chosen caregivers.
  app.post('/run', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const { caregivers: selectedCaregivers, clients: selectedClients } = await body(c)
    if (!Array.isArray(selectedCaregivers) || !selectedCaregivers.length || !Array.isArray(selectedClients) || !selectedClients.length) {
      return fail(c, 400, 'Must provide at least one caregiver and one client')
    }
    const caregiverIds: string[] = selectedCaregivers.map((cg: any) => String(cg.id))
    const clientIds: string[] = selectedClients.map((cl: any) => String(cl.id))

    const [existingSchedules, clientRows, cgRows] = await Promise.all([
      q.caregiversRecurringPatterns(d.db, companyId, caregiverIds),
      q.clientsCaregiverPreferences(d.db, companyId, clientIds),
      q.caregiversAvailability(d.db, companyId, caregiverIds),
    ])
    const clientMap: Record<string, any> = Object.fromEntries(clientRows.map((r: any) => [r.id, r]))
    const cgMap: Record<string, any> = Object.fromEntries(cgRows.map((r: any) => [r.id, r]))
    applyPreferredHours(cgMap, selectedCaregivers)

    // caregiverId -> dayOfWeek -> slots
    const cgScheduleMap: Record<string, Record<number, Array<{ start: string; end: string; clientId: string; clientName: string; scheduleId?: string; isExisting: boolean }>>> = {}
    caregiverIds.forEach((id) => { cgScheduleMap[id] = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } })
    existingSchedules.forEach((s: any) => {
      if (cgScheduleMap[s.caregiverId] && s.dayOfWeek !== null) {
        cgScheduleMap[s.caregiverId][s.dayOfWeek].push({
          start: s.startTime, end: s.endTime, clientId: s.clientId, clientName: `${s.clFirst} ${s.clLast}`, scheduleId: s.id, isExisting: true,
        })
      }
    })

    // Remaining hours per caregiver
    const cgRemainingHours: Record<string, number> = {}
    selectedCaregivers.forEach((cg: any) => {
      let alreadyBooked = 0
      existingSchedules.filter((s: any) => s.caregiverId === cg.id).forEach((s: any) => { alreadyBooked += shiftSpan(s.startTime, s.endTime) })
      cgRemainingHours[cg.id] = Math.max(0, parseFloat(cg.allocatedHours) - alreadyBooked)
    })
    const cgPreferredDaysMap = preferredDaysMap(selectedCaregivers)

    const proposals: any[] = []
    const unscheduled: any[] = []
    for (const clientCfg of selectedClients) {
      const { id: clientId, visitsPerWeek, hoursPerWeek, preferredDays: clientPreferredDays, timeWindowStart, timeWindowEnd } = clientCfg
      const clientInfo = clientMap[clientId]
      if (!clientInfo) continue

      const hoursPerVisit = parseFloat((hoursPerWeek / visitsPerWeek).toFixed(2))
      const visitDurationMins = Math.round(hoursPerVisit * 60)
      const clientExistingDays = existingSchedules.filter((s: any) => s.clientId === clientId).map((s: any) => s.dayOfWeek)
      const clientPlacedDays = new Set<number>(clientExistingDays)
      let visitsPlaced = 0

      // Score and rank caregivers for this client
      const scoredCaregivers = selectedCaregivers.map((cg: any) => {
        const isPreferred = Array.isArray(clientInfo.preferredCaregivers) && clientInfo.preferredCaregivers.includes(cg.id)
        const isBlocked = Array.isArray(clientInfo.doNotUseCaregivers) && clientInfo.doNotUseCaregivers.includes(cg.id)
        const alreadySees = existingSchedules.some((s: any) => s.caregiverId === cg.id && s.clientId === clientId)
        return { ...cg, score: isBlocked ? -999 : (isPreferred ? 10 : 0) + (alreadySees ? 5 : 0), isBlocked }
      }).filter((cg: any) => !cg.isBlocked).sort((a: any, b: any) => b.score - a.score)

      const tryDays: number[] = (Array.isArray(clientPreferredDays) && clientPreferredDays.length > 0) ? clientPreferredDays : [1, 3, 2, 4, 5, 0, 6]

      for (let visit = 0; visit < visitsPerWeek && visitsPlaced < visitsPerWeek; visit++) {
        let placed = false
        for (const day of tryDays) {
          if (clientPlacedDays.has(day)) continue
          for (const cg of scoredCaregivers) {
            if (cgRemainingHours[cg.id] < hoursPerVisit - 0.01) continue
            // A caregiver with preferred days set for this run is only placed on those days
            if (cgPreferredDaysMap[cg.id] && !cgPreferredDaysMap[cg.id].has(day)) continue
            const cgInfo = cgMap[cg.id]
            const dayKey = AVAIL_KEYS[day]
            const isAvailable = cgInfo ? (cgInfo[`${dayKey}Available`] !== false) : true
            if (!isAvailable) continue

            const daySlots = cgScheduleMap[cg.id][day]
            const startTime = findAvailableSlot(daySlots, visitDurationMins, cgInfo, day, timeWindowStart, timeWindowEnd)
            if (!startTime) continue
            const endTime = addMinutes(startTime, visitDurationMins)
            const overlap = daySlots.filter((slot) => slot.isExisting && timesOverlap(startTime, endTime, slot.start, slot.end))

            proposals.push({
              id: createId(),
              clientId,
              clientName: `${clientInfo.firstName} ${clientInfo.lastName}`,
              caregiverId: cg.id,
              caregiverName: `${cgMap[cg.id]?.firstName || ''} ${cgMap[cg.id]?.lastName || ''}`.trim(),
              dayOfWeek: day,
              dayName: DAY_NAMES[day],
              startTime,
              endTime,
              hoursPerVisit,
              hasConflict: overlap.length > 0,
              conflictsWith: overlap.map((o: any) => ({
                scheduleId: o.scheduleId, clientName: o.clientName, start: o.start, end: o.end,
                suggestion: `Consider moving ${o.clientName} to another time slot`,
              })),
              isNew: !clientExistingDays.includes(day),
            })
            cgScheduleMap[cg.id][day].push({ start: startTime, end: endTime, clientId, clientName: `${clientInfo.firstName} ${clientInfo.lastName}`, isExisting: false })
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
            clientName: `${clientInfo.firstName} ${clientInfo.lastName}`,
            visitNumber: visit + 1,
            reason: cgRemainingHours[scoredCaregivers[0]?.id] < hoursPerVisit ? 'Caregivers at hour capacity' : 'No available time slots found',
          })
        }
      }
    }

    const summary = {
      caregivers: selectedCaregivers.map((cg: any) => {
        const cgInfo = cgMap[cg.id]
        const name = `${cgInfo?.firstName || ''} ${cgInfo?.lastName || ''}`.trim()
        const proposedHours = proposals.filter((p) => p.caregiverId === cg.id).reduce((sum: number, p: any) => sum + p.hoursPerVisit, 0)
        const existingHours = existingSchedules.filter((s: any) => s.caregiverId === cg.id).reduce((sum: number, s: any) => sum + shiftSpan(s.startTime, s.endTime), 0)
        return {
          id: cg.id, name,
          allocatedHours: parseFloat(cg.allocatedHours),
          existingHours: parseFloat(existingHours.toFixed(2)),
          proposedNewHours: parseFloat(proposedHours.toFixed(2)),
          totalHours: parseFloat((existingHours + proposedHours).toFixed(2)),
          remainingHours: parseFloat(cgRemainingHours[cg.id].toFixed(2)),
        }
      }),
      clients: selectedClients.map((cl: any) => {
        const clientInfo = clientMap[cl.id]
        const name = `${clientInfo?.firstName || ''} ${clientInfo?.lastName || ''}`.trim()
        const placedVisits = proposals.filter((p) => p.clientId === cl.id).length
        return { id: cl.id, name, visitsNeeded: cl.visitsPerWeek, visitsPlaced: placedVisits, hoursPerWeek: cl.hoursPerWeek, fullyScheduled: placedVisits >= cl.visitsPerWeek }
      }),
      totalProposals: proposals.length,
      conflictCount: proposals.filter((p) => p.hasConflict).length,
      unscheduledCount: unscheduled.length,
    }

    return one(c, {
      proposals,
      existingSchedules: existingSchedules.map((s: any) => ({
        id: s.id, caregiverId: s.caregiverId, caregiverName: `${s.cgFirst} ${s.cgLast}`,
        clientId: s.clientId, clientName: `${s.clFirst} ${s.clLast}`,
        dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
      })),
      unscheduled,
      summary,
    })
  })

  // POST /apply — write the accepted proposals as recurring patterns.
  app.post('/apply', requirePermission('care-schedule:create'), async (c) => {
    const { companyId } = c.get('user')
    const { proposals } = await body(c)
    if (!Array.isArray(proposals) || !proposals.length) return fail(c, 400, 'No proposals to apply')
    const today = await core.time.today(companyId)
    return one(c, await applyProposals(d, companyId, today, proposals, 'Created by Schedule Optimizer'))
  })

  return app
}
