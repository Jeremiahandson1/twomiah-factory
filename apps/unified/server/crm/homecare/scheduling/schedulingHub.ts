// /api/scheduling — the Schedule Hub's support endpoints: week view, coverage, conflict heatmap, suggested caregivers,
// overtime / travel / conflict checks, caregiver hours, bulk create, auto-fill. Moved from
// templates/crm-homecare/backend/src/routes/schedulingHub.ts (ported there from the CVHC CRM's schedulingRoutes.js).
// Served on /api/scheduling ahead of scheduling.ts (time off, absences, no-show), which shares the prefix: one mount,
// composed in ./index.ts.
//
// Hours always come from the occurrence engine: a recurring row is counted on the days it actually happens (bi-weekly,
// cancelled, suspended and covered days included), never "every week".
//
// Permissions (care-schedule): the week view and a caregiver's hours are :read, which a caregiver holds — narrowed to
// their own, as the template narrowed them; the office's tools (coverage, heatmap, the three checks, suggestions,
// auto-fill) are :update, bulk create :create — the template's requireAdmin, which a caregiver holds none of.
//
// Replies: every key is camelCase (RULEBOOK §2): a caregiver is { id, firstName, lastName }, a heatmap row
// { id, firstName, lastName, maxHoursPerWeek, days, total }, a suggestion's caregiver fields firstName, defaultPayRate,
// availabilityStatus …; the shapes around them are as before.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import { MATCH_PREFS_FEATURE, matchTraits, splitList } from '../core/matchTraits.ts'
import { caregiverFit, doNotUseOf } from '../core/caregiverFit.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, schedTs, shiftHours, DATE_RE } from '../core/scheduleOccurrences.ts'
import { addDays } from '../core/agencyTime.ts'
import {
  hoursByCaregiver, maxHoursOf, activeCaregivers, weekOccurrences, occurrenceHours, caregiverCapacity, activeClientUnits,
  conflictHeatmapRows, caregiverOverlaps, personName, clientPosition, dayVisitsElsewhere, caregiverHoursSplit,
  clientForSuggestions, caregiversForSuggestions, visitCountsForClient, busyCaregiverIds, hasOverlap, insertSchedule,
  openShiftsToFill, visitCountsByClient, markFilled,
} from '../../../data/homecareScheduling.ts'
import { isCaregiver, weekStartOf, who, type SchedulingShared } from './shared.ts'

function distanceMiles(lat1: any, lon1: any, lat2: any, lon2: any): number | null {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null
  const [a1, o1, a2, o2] = [lat1, lon1, lat2, lon2].map(Number)
  const R = 3959, dLat = (a2 - a1) * Math.PI / 180, dLon = (o2 - o1) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function createSchedulingHubRoutes(core: HomecareCore, d: CrmDeps, shared: SchedulingShared) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  async function weekOfParam(companyId: string, v?: string) {
    const base = v && DATE_RE.test(v) ? v : await core.time.today(companyId)
    const ws = weekStartOf(base)
    return { ws, we: addDays(ws, 6) }
  }

  // GET /week-view?weekOf — each active caregiver × the 7 days, occurrences resolved. The office sees every caregiver's
  // week; a caregiver sees only their own. The read-only office seat (care-office:read) reads it too: names, days, times
  // and the schedule's note — no rate, nothing clinical (live role check, 2026-10-23).
  app.get('/week-view', d.permissions.requireAnyPermission(['care-schedule:read', 'care-office:read']), async (c) => {
    const { user, companyId, me } = who(c)
    const only = isCaregiver(d, user) ? me : null
    const { ws, we } = await weekOfParam(companyId, c.req.query('weekOf'))
    const cgs = await activeCaregivers(db, companyId, only)
    const occ = await weekOccurrences(db, companyId, ws, we, only)
    const data: Record<string, any> = {}
    for (const cg of cgs) data[cg.id] = { caregiver: cg, days: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } }
    for (const o of occ) {
      if (!data[o.caregiverId]) continue
      data[o.caregiverId].days[o.dow].push({ ...o, isRecurring: o.dayOfWeek !== null })
    }
    return one(c, { weekStart: ws, weekEnd: we, caregivers: Object.values(data) })
  })

  // GET /coverage-overview?weekOf — caregiver load vs capacity, and clients scheduled under their weekly authorized
  // units (15-minute units).
  app.get('/coverage-overview', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { ws, we } = await weekOfParam(companyId, c.req.query('weekOf'))
    const occ = await occurrenceHours(db, companyId, ws, we)
    const byCg: Record<string, number> = {}, byCl: Record<string, number> = {}
    for (const o of occ) {
      byCg[o.caregiverId] = (byCg[o.caregiverId] || 0) + Number(o.hours)
      byCl[o.clientId] = (byCl[o.clientId] || 0) + Number(o.hours)
    }
    const cgs = await caregiverCapacity(db, companyId)
    const cls = await activeClientUnits(db, companyId)
    const round2 = (n: number) => Math.round(n * 100) / 100
    const caregivers = cgs.map((cg) => {
      const maxHours = Number(cg.maxHours) || 40, scheduledHours = round2(byCg[cg.id] || 0)
      return { id: cg.id, name: `${cg.firstName} ${cg.lastName}`, maxHours, scheduledHours, remainingHours: Math.max(0, round2(maxHours - scheduledHours)),
        utilizationPercent: Math.round((scheduledHours / maxHours) * 100), status: cg.availabilityStatus }
    })
    const clientsWithUnits = cls.filter((cl) => Number(cl.weeklyAuthorizedUnits) > 0).map((cl) => {
      const authorizedUnits = Math.floor(Number(cl.weeklyAuthorizedUnits))
      const scheduledHours = round2(byCl[cl.id] || 0)
      const scheduledUnits = Math.round(scheduledHours * 4)
      const shortfallUnits = Math.max(0, authorizedUnits - scheduledUnits)
      return { id: cl.id, name: `${cl.firstName} ${cl.lastName}`, authorizedUnits, authorizedHours: authorizedUnits * 0.25, scheduledUnits, scheduledHours,
        shortfallUnits, shortfallHours: shortfallUnits * 0.25, coveragePercent: authorizedUnits > 0 ? Math.round((scheduledUnits / authorizedUnits) * 100) : 0,
        isUnderScheduled: shortfallUnits > 0 }
    })
    const under = clientsWithUnits.filter((x) => x.isUnderScheduled)
    return one(c, {
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
  app.get('/conflict-heatmap', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { ws, we } = await weekOfParam(companyId, c.req.query('weekOf'))
    const r = await conflictHeatmapRows(db, companyId, ws, we)
    const by = new Map<string, any>()
    for (const x of r) {
      if (!by.has(x.id)) by.set(x.id, { id: x.id, firstName: x.firstName, lastName: x.lastName, maxHoursPerWeek: Number(x.maxHoursPerWeek), days: [], total: 0 })
      const g = by.get(x.id)
      g.days.push({ date: x.day, hours: Number(x.hours), shifts: Number(x.shiftCount) })
      g.total += Number(x.hours)
    }
    return one(c, { weekStart: ws, weekEnd: we, caregivers: [...by.values()].sort((a, b) => b.total - a.total) })
  })

  // POST /check-conflicts { caregiverId, date, startTime, endTime }. The three schedule-time checks read another
  // caregiver's visits, hours and clients; only the office's Schedule Hub calls them, so they are the office's.
  app.post('/check-conflicts', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { caregiverId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
    if (!caregiverId || !hms(startTime) || !hms(endTime) || !DATE_RE.test(date || '')) return fail(c, 400, 'Missing required fields')
    const r = await caregiverOverlaps(db, companyId, caregiverId, date, hms(startTime)!, hms(endTime)!)
    return one(c, { hasConflict: r.length > 0, conflicts: r.map((s) => ({ id: s.id, clientName: `${s.firstName} ${s.lastName}`, startTime: s.startTime, endTime: s.endTime, isRecurring: s.dayOfWeek !== null })) })
  })

  // POST /check-weekly-hours { caregiverId, date, startTime, endTime } — overtime warning at schedule time
  app.post('/check-weekly-hours', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { caregiverId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
    if (!caregiverId || !hms(startTime) || !hms(endTime)) return fail(c, 400, 'Missing required fields')
    const { ws, we } = await weekOfParam(companyId, date)
    const current = (await hoursByCaregiver(db, companyId, ws, we))[caregiverId] || 0
    const proposed = shiftHours(startTime, endTime)
    const projected = current + proposed
    const maxHours = await maxHoursOf(db, companyId, caregiverId)
    const overtime = Math.max(0, projected - 40)
    const cg = await personName(db, companyId, caregiverId)
    const name = cg ? `${cg.firstName} ${cg.lastName}` : 'Caregiver'
    const warnings: string[] = []
    if (projected > maxHours) warnings.push(`${name} will exceed max hours: ${projected.toFixed(1)}h / ${maxHours}h limit`)
    if (overtime > 0) warnings.push(`This puts ${name} at ${projected.toFixed(1)}h this week (${overtime.toFixed(1)}h overtime)`)
    else if (projected > 35) warnings.push(`${name} approaching overtime: ${projected.toFixed(1)}h this week`)
    const r2 = (n: number) => parseFloat(n.toFixed(2))
    return one(c, { currentWeeklyHours: r2(current), proposedHours: r2(proposed), projectedHours: r2(projected), maxHours, overtimeHours: r2(overtime), warnings, caregiverName: name })
  })

  // POST /check-travel-time { caregiverId, clientId, date, startTime, endTime } — back-to-back drive time
  app.post('/check-travel-time', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { caregiverId, clientId, date, startTime, endTime } = await c.req.json().catch(() => ({})) as any
    if (!caregiverId || !clientId || !DATE_RE.test(date || '') || !hms(startTime) || !hms(endTime)) return fail(c, 400, 'Missing required fields')
    const p = await clientPosition(db, companyId, clientId)
    if (!p?.latitude) return one(c, { hasTravelConflict: false, adjacentShifts: [], note: 'Client has no GPS coordinates set' })
    const day = await dayVisitsElsewhere(db, companyId, caregiverId, clientId, date)
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const s0 = toMin(hms(startTime)!), e0 = toMin(hms(endTime)!)
    const adjacent: any[] = []
    for (const s of day) {
      const dist = distanceMiles(p.latitude, p.longitude, s.latitude, s.longitude)
      if (dist === null) continue
      const drive = Math.round(dist * 2)
      let gap: number | null = null
      if (toMin(s.endTime) <= s0) gap = s0 - toMin(s.endTime)
      else if (toMin(s.startTime) >= e0) gap = toMin(s.startTime) - e0
      if (gap !== null && gap < 120) {
        adjacent.push({ clientName: `${s.firstName} ${s.lastName}`, startTime: s.startTime, endTime: s.endTime, distanceMiles: parseFloat(dist.toFixed(1)),
          estimatedDriveMinutes: drive, gapMinutes: Math.round(gap), isInsufficient: drive > gap })
      }
    }
    return one(c, { hasTravelConflict: adjacent.some((a) => a.isInsufficient), adjacentShifts: adjacent })
  })

  // GET /caregiver-hours/:caregiverId — this week's scheduled hours (a caregiver: their own)
  app.get('/caregiver-hours/:caregiverId', perm('care-schedule:read'), async (c) => {
    const { user, companyId, me } = who(c)
    const caregiverId = c.req.param('caregiverId')
    if (isCaregiver(d, user) && me !== caregiverId) return fail(c, 403, 'You can only view your own hours')
    const { ws, we } = await weekOfParam(companyId)
    const { oneTime, recurring } = await caregiverHoursSplit(db, companyId, caregiverId, ws, we)
    const total = oneTime + recurring
    const maxHours = await maxHoursOf(db, companyId, caregiverId)
    return one(c, { totalHours: total.toFixed(2), oneTimeHours: oneTime.toFixed(2), recurringHours: recurring.toFixed(2), maxHours,
      remainingHours: Math.max(0, maxHours - total).toFixed(2), approachingOvertime: total > 35 })
  })

  // GET /suggest-caregivers?clientId&date&startTime&endTime — ranked candidates for a slot
  app.get('/suggest-caregivers', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const { clientId, date, startTime, endTime } = c.req.query()
    if (!clientId) return fail(c, 400, 'Client ID required')
    const client = await clientForSuggestions(db, companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const validDate = date && DATE_RE.test(date) ? date : null
    const hours = hms(startTime) && hms(endTime) ? shiftHours(startTime, endTime) : 4
    const dow = validDate ? new Date(`${validDate}T12:00:00Z`).getUTCDay() : null
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const dayCol = dow !== null ? dayMap[dow] : null
    const cgs = await caregiversForSuggestions(db, companyId, dayCol, validDate)
    const { ws, we } = await weekOfParam(companyId, validDate || undefined)
    const weekly = await hoursByCaregiver(db, companyId, ws, we)
    const history = await visitCountsForClient(db, companyId, clientId)
    const conflictIds = new Set<string>(validDate && hms(startTime) && hms(endTime)
      ? await busyCaregiverIds(db, companyId, validDate, hms(startTime)!, hms(endTime)!)
      : [])
    const preferred = new Set((Array.isArray(client.preferredCaregivers) ? client.preferredCaregivers : []).map(String))
    const dnu = doNotUseOf(client)
    // A caregiver whose credential has expired by that day is flagged (never hidden): the office decides.
    const expired = await core.certReminders.expiredFor(companyId, cgs.map((cg) => String(cg.id)), validDate || await core.time.today(companyId))
    // What the client needs (skills, a gender, a language) against what each caregiver has — only for an agency with care_match_prefs.
    const matchPrefs = await d.features.isFeatureEnabled(companyId, MATCH_PREFS_FEATURE)

    const ranked = cgs.map((cg) => {
      const weeklyHours = weekly[cg.id] || 0
      const maxHours = Number(cg.maxHoursPerWeek) || 40
      const visitCount = history[cg.id] || 0
      const hasConflict = conflictIds.has(cg.id)
      const fit = caregiverFit(cg, dnu, startTime, endTime)
      const isAvailable = !fit.markedUnavailable
      const wouldExceedHours = weeklyHours + hours > maxHours
      const approachingOvertime = weeklyHours > 35
      const distance = distanceMiles(cg.latitude, cg.longitude, client.latitude, client.longitude)
      const isPreferred = preferred.has(String(cg.id)), isDnu = fit.doNotUse, isBlackedOut = fit.timeOff
      const timeFits = fit.timeFits
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
      const expiredCertifications = expired[String(cg.id)] || []
      if (expiredCertifications.length) score -= 150
      const traits = matchPrefs ? matchTraits(client, cg) : null
      if (traits) score += traits.scoreDelta
      if (distance !== null) { if (distance <= 5) score += 20; else if (distance <= 10) score += 10; else if (distance <= 20) score += 5; else if (distance > 30) score -= 15 }
      if (dayCol) { if (fit.notThatDay) score -= 50; else if (timeFits === true) score += 15; else if (timeFits === false) score -= 20 }
      const reasons: string[] = []
      if (isDnu) reasons.push('🚫 Client do-not-use list')
      if (isBlackedOut) reasons.push('🚫 PTO/blackout on this date')
      if (isPreferred) reasons.push('⭐ Preferred caregiver')
      if (visitCount > 5) reasons.push(`✓ Familiar (${visitCount} visits)`)
      else if (visitCount > 0) reasons.push(`${visitCount} prior visits`)
      if (hasConflict) reasons.push('⚠️ Conflicting shift')
      for (const e of expiredCertifications) reasons.push(`⚠️ Expired credential: ${e}`)
      if (traits) reasons.push(...traits.reasons)
      if (!isAvailable) reasons.push('⚠️ Marked unavailable')
      if (wouldExceedHours) reasons.push('⚠️ Exceeds max hours')
      else if (approachingOvertime) reasons.push(`⚠️ ${weeklyHours.toFixed(0)}h this week`)
      else if (weeklyHours < 20) reasons.push('✓ Has availability')
      if (dayCol && fit.notThatDay) reasons.push(`⚠️ Not available ${dayMap[dow!]}s`)
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
        hasRequiredSkills: traits ? traits.hasRequiredSkills : true, missingSkills: traits ? traits.missingSkills : [],
        genderOk: traits ? traits.genderOk : null, languageOk: traits ? traits.languageOk : null,
        missingCertifications: [], expiredCertifications, score: Math.round(score), tier, reasons }
    })
    const out = (c.req.query('includeBlocked') === 'true' ? ranked : ranked.filter((x) => !x.isDnu && !x.isBlackedOut)).sort((a, b) => b.score - a.score)
    return one(c, { client, suggestions: out, shiftHours: hours, requiredCertifications: [], requiredSkills: matchPrefs ? splitList(client.requiredSkills) : [] })
  })

  // POST /bulk-create { caregiverId, clientId, template: [{dayOfWeek,startTime,endTime}], weeks, startDate, notes }
  app.post('/bulk-create', perm('care-schedule:create'), async (c) => {
    const { companyId } = who(c)
    const { caregiverId, clientId, template, weeks, startDate, notes } = await c.req.json().catch(() => ({})) as any
    if (!caregiverId || !clientId || !Array.isArray(template) || !template.length) return fail(c, 400, 'Missing required fields')
    const auth = await shared.checkAuthorizationBalance(companyId, clientId, template.reduce((s: number, t: any) => s + shiftHours(t.startTime, t.endTime), 0))
    const n = Math.min(Math.max(parseInt(weeks) || 4, 1), 12)
    const today = await core.time.today(companyId)
    const start = weekStartOf(startDate && DATE_RE.test(startDate) ? startDate : today)
    const created: string[] = [], conflicts: any[] = []
    for (let w = 0; w < n; w++) {
      for (const slot of template) {
        const s = hms(slot.startTime), e = hms(slot.endTime), dw = Number(slot.dayOfWeek)
        if (!s || !e || !(dw >= 0 && dw <= 6)) continue
        const day = addDays(start, w * 7 + dw)
        if (day < today) continue
        if (await hasOverlap(db, companyId, caregiverId, day, s, e)) { conflicts.push({ date: day, startTime: s }); continue }
        created.push(await insertSchedule(db, companyId, {
          caregiverId, clientId, scheduleType: 'one-time', dayOfWeek: null, date: day, startTs: schedTs(s, day), endTs: schedTs(e, day),
          notes: notes || null, frequency: 'weekly',
        }))
      }
    }
    return one(c, { success: true, created: created.length, skippedConflicts: conflicts.length, conflicts, authWarnings: auth.warnings })
  })

  // POST /auto-fill { startDate, endDate, dryRun } — fill open shifts with the best free caregiver
  app.post('/auto-fill', perm('care-schedule:update'), async (c) => {
    const { companyId, me } = who(c)
    const b = await c.req.json().catch(() => ({})) as any
    const today = await core.time.today(companyId)
    const start = DATE_RE.test(b.startDate || '') ? b.startDate : today
    const end = DATE_RE.test(b.endDate || '') ? b.endDate : addDays(today, 7)
    const dryRun = !!b.dryRun
    const shifts = await openShiftsToFill(db, companyId, start, end)
    if (!shifts.length) return one(c, { success: true, message: 'No open shifts to fill', filled: 0, failed: 0, results: [] })
    // Who is on time off, free that weekday and inside their hours depends on the shift's own day, so each day is read once; the client's
    // do-not-use list once per client. The same rule (core/caregiverFit.ts) the suggestion list uses decides who may not be offered.
    const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const byDay = new Map<string, any[]>()
    const clientCache = new Map<string, any>()
    const caregiversOn = async (date: string) => {
      if (!byDay.has(date)) byDay.set(date, await caregiversForSuggestions(db, companyId, dayMap[new Date(`${date}T12:00:00Z`).getUTCDay()], date))
      return byDay.get(date)!
    }
    const dnuOf = async (clientId: string) => {
      if (!clientCache.has(clientId)) clientCache.set(clientId, doNotUseOf(await clientForSuggestions(db, companyId, clientId)))
      return clientCache.get(clientId)!
    }
    const ws = weekStartOf(start)
    const weekly = await hoursByCaregiver(db, companyId, ws, addDays(ws, 6))
    const hist = await visitCountsByClient(db, companyId)
    const placed: { caregiverId: string; date: string; s: string; e: string }[] = []
    const results: any[] = []
    let filled = 0, failed = 0
    for (const sh of shifts) {
      const h = shiftHours(sh.startTime, sh.endTime)
      const busy = new Set(await busyCaregiverIds(db, companyId, sh.shiftDate, sh.startTime, sh.endTime))
      const auth = await shared.checkAuthorizationBalance(companyId, sh.clientId, h)
      const dnu = await dnuOf(sh.clientId)
      const candidates = await caregiversOn(sh.shiftDate)
      // An agency that blocks expired credentials never has auto-fill choose one.
      const noCert = await core.certReminders.blockedFor(companyId, candidates.map((cg) => String(cg.id)), sh.shiftDate)
      const scored = candidates.map((cg) => {
        const fit = caregiverFit(cg, dnu, sh.startTime, sh.endTime)
        if (fit.blocks.length) return { ...cg, score: -1000, disqualified: true, reason: fit.blocks[0] }
        if (noCert[String(cg.id)]) return { ...cg, score: -1000, disqualified: true, reason: 'Expired credential' }
        const max = Number(cg.maxHoursPerWeek) || 40
        const projected = (weekly[cg.id] || 0)
        const conflict = busy.has(cg.id) || placed.some((a) => a.caregiverId === cg.id && a.date === sh.shiftDate && !(a.e <= sh.startTime || a.s >= sh.endTime))
        if (conflict || projected + h > max) return { ...cg, score: -1000, disqualified: true, reason: conflict ? 'conflict' : 'exceeds_hours' }
        const visits = hist[sh.clientId]?.[cg.id] || 0
        let score = 100 + Math.min(visits * 3, 30) - (projected / max) * 20
        if (projected + h > 40) score -= 15
        const dist = distanceMiles(cg.latitude, cg.longitude, sh.clientLat, sh.clientLng)
        if (dist !== null) { if (dist <= 5) score += 20; else if (dist <= 10) score += 10; else if (dist <= 20) score += 5; else if (dist > 30) score -= 15 }
        return { ...cg, score, disqualified: false, distance: dist, visitCount: visits }
      }).sort((a: any, b2: any) => b2.score - a.score)
      const best: any = scored.find((x: any) => !x.disqualified)
      const label = { shiftId: sh.id, client: `${sh.clientFirst} ${sh.clientLast}`, date: sh.shiftDate, time: `${sh.startTime} - ${sh.endTime}` }
      if (best) {
        if (!dryRun) {
          try {
            await shared.assignShift(companyId, sh, best.id, me)
            await markFilled(db, companyId, sh.id, me, best.id)
          } catch (e: any) {
            results.push({ ...label, status: 'unfilled', reason: e.message }); failed++; continue
          }
        }
        placed.push({ caregiverId: best.id, date: sh.shiftDate, s: sh.startTime, e: sh.endTime })
        weekly[best.id] = (weekly[best.id] || 0) + h
        results.push({ ...label, status: 'filled', assignedTo: `${best.firstName} ${best.lastName}`, caregiverId: best.id, score: Math.round(best.score),
          distance: best.distance !== null ? `${best.distance.toFixed(1)} mi` : 'N/A', familiarity: best.visitCount > 0 ? `${best.visitCount} visits` : 'New', authWarnings: auth.warnings })
        filled++
      } else {
        results.push({ ...label, status: 'unfilled', reason: 'No available caregivers', candidates: scored.filter((x: any) => x.disqualified).slice(0, 3).map((x: any) => ({ name: `${x.firstName} ${x.lastName}`, reason: x.reason })) })
        failed++
      }
    }
    return one(c, { success: true, dryRun, message: dryRun ? `Preview: Would fill ${filled} of ${shifts.length} shifts` : `Filled ${filled} of ${shifts.length} shifts`, filled, failed, total: shifts.length, results })
  })

  return app
}
