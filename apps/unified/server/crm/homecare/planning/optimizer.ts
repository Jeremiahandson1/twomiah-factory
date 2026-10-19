// Route optimizer, mileage, the hours dashboard and GPS geofences (/api/route-optimizer, and /api/optimizer where
// /company, /routes and /stats predate the port). Moved from templates/crm-homecare/backend/src/routes/optimizer.ts
// (ported from CVHC routes/routeOptimizerRoutes.js).
//
// Driving distances come from the Google Routes API when GOOGLE_MAPS_API_KEY is set; without it the planner falls back
// to straight-line (haversine) miles at ~30 mph, and the screen says so. Geocoding tries Google, then OpenStreetMap's
// Nominatim. Visits for a day come off the schedule engine (data/homecareCore.ts), so the planner never routes a
// caregiver to a cancelled visit or an ended pattern, handles bi-weekly, and routes the person actually going.
//
// Who may: the template put everything behind requireAdmin except POST /geofence/check, which the caregiver app calls
// at clock-in. The planner is the schedule area's, and was the office's: it asks care-schedule:update (a caregiver holds
// only care-schedule:read); saving a plan asks care-schedule:create, deleting one care-schedule:delete. A client's
// geofence is the client record's: care-clients:update. The clock-in check asks evv:read and stays narrowed to the
// clients the caregiver serves (core.access.maySeeClient), as the template's was.
import { Hono, type Context } from 'hono'
import { createId } from '@paralleldrive/cuid2'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createHomecareCore } from '../core/index.ts'
import { addDays, createAgencyTime, isYmd } from '../core/agencyTime.ts'
import { shiftHours } from '../core/scheduleOccurrences.ts'
import { DEFAULT_MILEAGE_RATE } from '../core/mileageRate.ts'
import * as q from '../../../data/homecarePlanning.ts'

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || ''
async function body(c: Context): Promise<any> { try { return (await c.req.json()) || {} } catch { return {} } }

// ============================================================ Google API helpers
type Seg = { distanceMiles: number; durationMinutes: number }

async function googleRoute(oLat: number, oLng: number, dLat: number, dLng: number, log: (m: string) => void): Promise<Seg | null> {
  const key = googleKey(); if (!key) return null
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: oLat, longitude: oLng } } },
        destination: { location: { latLng: { latitude: dLat, longitude: dLng } } },
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', units: 'IMPERIAL',
      }),
    })
    const data: any = await res.json()
    if (data.routes?.length) {
      const meters = data.routes[0].distanceMeters || 0
      const seconds = parseInt(String(data.routes[0].duration || '').replace('s', '')) || 0
      return { distanceMiles: Math.round((meters / 1609.344) * 100) / 100, durationMinutes: Math.round(seconds / 60) }
    }
    return null
  } catch (e: any) { log(`Google Routes API error: ${e?.message}`); return null }
}

// One call for every origin × destination pair. Returns "originIdx-destIdx" → segment.
async function googleRouteMatrix(nodes: Array<{ latitude: number; longitude: number }>, log: (m: string) => void): Promise<Record<string, Seg> | null> {
  const key = googleKey(); if (!key) return null
  try {
    const wp = nodes.map((o) => ({ waypoint: { location: { latLng: { latitude: o.latitude, longitude: o.longitude } } } }))
    const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,status' },
      body: JSON.stringify({ origins: wp, destinations: wp, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    })
    const data: any = await res.json()
    const matrix: Record<string, Seg> = {}
    if (Array.isArray(data)) {
      for (const e of data) {
        if (e.status?.code && e.status.code !== 0) continue
        const seconds = parseInt(String(e.duration || '').replace('s', '')) || 0
        matrix[`${e.originIndex}-${e.destinationIndex}`] = {
          distanceMiles: Math.round(((e.distanceMeters || 0) / 1609.344) * 100) / 100,
          durationMinutes: Math.round(seconds / 60),
        }
      }
    }
    return Object.keys(matrix).length ? matrix : null
  } catch (e: any) { log(`Google Route Matrix API error: ${e?.message}`); return null }
}

async function googleGeocode(address: string, log: (m: string) => void) {
  const key = googleKey(); if (!key) return null
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}&components=country:US`)
    const data: any = await res.json()
    if (data.status === 'OK' && data.results?.length) {
      const { lat, lng } = data.results[0].geometry.location
      return { latitude: lat, longitude: lng, formattedAddress: data.results[0].formatted_address }
    }
    return null
  } catch (e: any) { log(`Google Geocoding error: ${e?.message}`); return null }
}

async function nominatim(address: string, agencyName: string) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': `${agencyName.replace(/[^\w .-]/g, '').trim() || 'HomeCareCRM'}/1.0` } })
    const data: any = await res.json()
    if (Array.isArray(data) && data.length) return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon), formattedAddress: data[0].display_name }
  } catch { /* fallback failed */ }
  return null
}

// ============================================================ Distance + route solving (pure)
export const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number | null => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
export const estimateDriveMinutes = (miles: number | null) => (miles ? Math.round(miles * 2) : 0) // ~30 mph
const distanceFeet = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const miles = haversine(lat1, lon1, lat2, lon2)
  // 0 miles is a distance (standing on the client's point), not "unknown" — only null is unknown.
  return miles == null ? null : miles * 5280
}

/** Nearest-neighbour tour from node `startIdx` over a distance matrix. */
export function solveRouteWithMatrix(startIdx: number, m: Record<string, Seg>, nodeCount: number) {
  const visited = new Set([startIdx])
  const order: Array<{ stopIndex: number; milesFromPrevious: number; driveMinutesFromPrevious: number }> = []
  let current = startIdx
  while (order.length < nodeCount - 1) {
    let nearestIdx = -1, nearestDist = Infinity
    for (let i = 1; i < nodeCount; i++) {
      if (visited.has(i)) continue
      const dist = m[`${current}-${i}`]?.distanceMiles ?? Infinity
      if (dist < nearestDist) { nearestDist = dist; nearestIdx = i }
    }
    if (nearestIdx === -1) break
    visited.add(nearestIdx)
    const seg = m[`${current}-${nearestIdx}`] || { distanceMiles: 0, durationMinutes: 0 }
    order.push({ stopIndex: nearestIdx - 1, milesFromPrevious: seg.distanceMiles, driveMinutesFromPrevious: seg.durationMinutes })
    current = nearestIdx
  }
  return order
}

/** 2-opt improvement over the same matrix. */
export function improve2OptMatrix(order: ReturnType<typeof solveRouteWithMatrix>, m: Record<string, Seg>) {
  if (order.length < 3) return order
  let improved = true
  let route = [...order]
  while (improved) {
    improved = false
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 2; j < route.length; j++) {
        const prevI = i === 0 ? 0 : route[i - 1].stopIndex + 1
        const iIdx = route[i].stopIndex + 1
        const jMinusIdx = route[j - 1].stopIndex + 1
        const jIdx = route[j].stopIndex + 1
        const currentDist = (m[`${prevI}-${iIdx}`]?.distanceMiles || Infinity) + (m[`${jMinusIdx}-${jIdx}`]?.distanceMiles || Infinity)
        const newDist = (m[`${prevI}-${jMinusIdx}`]?.distanceMiles || Infinity) + (m[`${iIdx}-${jIdx}`]?.distanceMiles || Infinity)
        if (newDist < currentDist) {
          route = [...route.slice(0, i), ...route.slice(i, j).reverse(), ...route.slice(j)]
          improved = true
        }
      }
    }
  }
  return route
}

function timeToMinutes(t: string | null | undefined) {
  if (!t) return 480
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + (m || 0)
}
function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(Math.round(m)).padStart(2, '0')}`
}
const r2 = (n: number) => Math.round(n * 100) / 100
const joinAddress = (x: any) => [x.address, x.city, x.state, x.zip].filter(Boolean).join(', ')
/** A planned time as HH:MM, or null. */
const hm = (t: unknown) => (typeof t === 'string' && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5).padStart(5, '0') : null)
const numOrNull = (v: unknown) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))
const intOrNull = (v: unknown) => { const n = numOrNull(v); return n == null ? null : Math.round(n) }

const STOP_STATUSES = ['pending', 'en_route', 'arrived', 'in_progress', 'completed', 'skipped']

export function createRouteOptimizerRoutes(d: CrmDeps) {
  const agencyTime = createAgencyTime(d)
  const core = createHomecareCore(d)
  const { requirePermission } = d.permissions
  const log = (m: string) => d.logger.error(`[route optimizer] ${m}`)
  const plan = requirePermission('care-schedule:update')
  const app = new Hono<AppEnv>()

  const agencyName = async (companyId: string) => (await q.companyBrand(d.db, companyId)).name || 'HomeCareCRM'

  // POST /optimize — order a caregiver's stops for the day, real road miles where Google is configured.
  app.post('/optimize', plan, async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const { caregiverId, date, stops } = b
    const bufferMinutes = parseInt(b.bufferMinutes) || 0
    const mileageRate = parseFloat(b.mileageRate) || DEFAULT_MILEAGE_RATE
    if (!caregiverId || !date || !Array.isArray(stops) || !stops.length) return fail(c, 400, 'caregiverId, date, and stops[] required')

    const cg = await q.routeCaregiver(d.db, companyId, String(caregiverId))
    if (!cg) return fail(c, 404, 'Caregiver not found')
    if (!cg.latitude || !cg.longitude) {
      return fail(c, 400, 'Caregiver has no home address geocoded. Please update their address first.', 'caregiver_address')
    }

    const clientIds = stops.map((s: any) => String(s.clientId || '')).filter(Boolean)
    const clientMap = new Map((await q.routeClients(d.db, companyId, clientIds)).map((r: any) => [r.id, r]))
    const stopList = stops.map((s: any) => {
      const cl: any = clientMap.get(s.clientId)
      if (!cl) return null
      const units = parseInt(s.serviceUnits) || 0
      return {
        clientId: cl.id, clientName: `${cl.firstName} ${cl.lastName}`,
        latitude: parseFloat(cl.latitude), longitude: parseFloat(cl.longitude),
        address: joinAddress(cl),
        serviceUnits: units, serviceMinutes: units * 15,
        requestedStartTime: s.startTime || null, requestedEndTime: s.endTime || null,
        weeklyAuthorizedUnits: cl.weeklyAuthorizedUnits || 0,
      }
    }).filter(Boolean) as any[]
    if (!stopList.length) return fail(c, 400, 'None of those stops is a client on file')

    const missing = stopList.filter((s) => !s.latitude || !s.longitude)
    if (missing.length) {
      return fail(c, 400, `Some clients are missing geocoded addresses: ${missing.map((s) => s.clientName).join(', ')}`, 'clients_not_geocoded')
    }

    // Node 0 = caregiver home, 1..N = stops
    const nodes = [{ latitude: parseFloat(cg.latitude), longitude: parseFloat(cg.longitude) }, ...stopList.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))]
    let m: Record<string, Seg> = {}
    let usingGoogle = false
    if (googleKey() && nodes.length <= 26) {
      const g = await googleRouteMatrix(nodes, log)
      if (g) { m = g; usingGoogle = true }
    }
    if (!usingGoogle) {
      for (let i = 0; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue
        const miles = haversine(nodes[i].latitude, nodes[i].longitude, nodes[j].latitude, nodes[j].longitude) || 0
        m[`${i}-${j}`] = { distanceMiles: Math.round(miles * 100) / 100, durationMinutes: estimateDriveMinutes(miles) }
      }
    }

    const order = improve2OptMatrix(solveRouteWithMatrix(0, m, nodes.length), m)
    let totalMiles = 0, totalDriveMinutes = 0, prevIdx = 0
    const recalculated = order.map((item) => {
      const idx = item.stopIndex + 1
      const seg = m[`${prevIdx}-${idx}`] || { distanceMiles: 0, durationMinutes: 0 }
      totalMiles += seg.distanceMiles; totalDriveMinutes += seg.durationMinutes; prevIdx = idx
      return { ...item, milesFromPrevious: seg.distanceMiles, driveMinutesFromPrevious: seg.durationMinutes }
    })
    const ret = m[`${prevIdx}-0`] || { distanceMiles: 0, durationMinutes: 0 }
    totalMiles += ret.distanceMiles; totalDriveMinutes += ret.durationMinutes

    let totalServiceMinutes = 0
    let running = b.startTime || '08:00'
    const finalStops = recalculated.map((item, idx) => {
      const stop = stopList[item.stopIndex]
      totalServiceMinutes += stop.serviceMinutes
      const arrival = timeToMinutes(running) + item.driveMinutesFromPrevious + (idx > 0 ? bufferMinutes : 0)
      const departure = arrival + stop.serviceMinutes
      running = minutesToTime(departure)
      return {
        ...stop, stopOrder: idx + 1,
        milesFromPrevious: item.milesFromPrevious, driveMinutesFromPrevious: item.driveMinutesFromPrevious,
        calculatedArrival: minutesToTime(arrival), calculatedDeparture: minutesToTime(departure),
        scheduledStartTime: stop.requestedStartTime || null, scheduledEndTime: stop.requestedEndTime || null,
      }
    })

    // The same day in the order the stops were given (the schedule's order), for the "saved" figures.
    let preMiles = 0, preDrive = 0, prePrev = 0
    for (let i = 0; i < stopList.length; i++) {
      const seg = m[`${prePrev}-${i + 1}`] || { distanceMiles: 0, durationMinutes: 0 }
      preMiles += seg.distanceMiles; preDrive += seg.durationMinutes; prePrev = i + 1
    }
    const preRet = m[`${prePrev}-0`] || { distanceMiles: 0, durationMinutes: 0 }
    preMiles += preRet.distanceMiles; preDrive += preRet.durationMinutes
    let preRunning = b.startTime || '08:00'
    let prePrev2 = 0
    const preStops = stopList.map((stop, idx) => {
      const seg = m[`${prePrev2}-${idx + 1}`] || { distanceMiles: 0, durationMinutes: 0 }
      const arrival = timeToMinutes(preRunning) + seg.durationMinutes + (idx > 0 ? bufferMinutes : 0)
      const departure = arrival + stop.serviceMinutes
      preRunning = minutesToTime(departure); prePrev2 = idx + 1
      return {
        clientId: stop.clientId, clientName: stop.clientName, address: stop.address, stopOrder: idx + 1,
        milesFromPrevious: seg.distanceMiles, driveMinutesFromPrevious: seg.durationMinutes,
        serviceUnits: stop.serviceUnits, serviceMinutes: stop.serviceMinutes,
        calculatedArrival: minutesToTime(arrival), calculatedDeparture: minutesToTime(departure),
        scheduledStartTime: stop.requestedStartTime || null, scheduledEndTime: stop.requestedEndTime || null,
      }
    })

    const gmaps = ['https://www.google.com/maps/dir', `${cg.latitude},${cg.longitude}`, ...finalStops.map((s) => `${s.latitude},${s.longitude}`), `${cg.latitude},${cg.longitude}`]
    return one(c, {
      caregiver: {
        id: cg.id, name: `${cg.firstName} ${cg.lastName}`,
        homeAddress: joinAddress(cg),
        latitude: parseFloat(cg.latitude), longitude: parseFloat(cg.longitude),
      },
      date,
      stops: finalStops,
      preOptimization: {
        stops: preStops,
        totalMiles: r2(preMiles), totalDriveMinutes: preDrive, totalServiceMinutes,
        returnMiles: r2(preRet.distanceMiles), returnDriveMinutes: preRet.durationMinutes,
        estimatedStartTime: preStops[0]?.calculatedArrival || '08:00',
        estimatedEndTime: minutesToTime(timeToMinutes(preStops[preStops.length - 1]?.calculatedDeparture || '08:00') + preRet.durationMinutes),
        mileageReimbursement: r2(preMiles * mileageRate),
      },
      googleMapsUrl: gmaps.join('/'),
      summary: {
        totalStops: finalStops.length,
        totalMiles: r2(totalMiles), totalDriveMinutes, totalServiceMinutes,
        totalServiceHours: r2(totalServiceMinutes / 60),
        totalBufferMinutes: bufferMinutes * Math.max(0, finalStops.length - 1),
        returnMiles: r2(ret.distanceMiles), returnDriveMinutes: ret.durationMinutes,
        estimatedStartTime: finalStops[0]?.calculatedArrival || '08:00',
        estimatedEndTime: minutesToTime(timeToMinutes(finalStops[finalStops.length - 1]?.calculatedDeparture || '08:00') + ret.durationMinutes),
        mileageReimbursement: r2(totalMiles * mileageRate),
        mileageRate,
        milesSaved: r2(preMiles - totalMiles),
        drivingMinutesSaved: preDrive - totalDriveMinutes,
        routingSource: usingGoogle ? 'google_routes_api' : 'haversine_estimate',
        googleApiUsed: usingGoogle,
      },
    })
  })

  // POST /save-route — one plan per caregiver per day (a re-save replaces it).
  app.post('/save-route', requirePermission('care-schedule:create'), async (c) => {
    const user = c.get('user')
    const { companyId } = user
    const b = await body(c)
    const { caregiverId, date, stops } = b
    if (!caregiverId || !isYmd(date) || !Array.isArray(stops)) return fail(c, 400, 'caregiverId, date (YYYY-MM-DD) and stops[] required')
    const status = ['draft', 'published'].includes(b.status) ? b.status : 'draft'
    if (!(await q.routeCaregiver(d.db, companyId, String(caregiverId)))) return fail(c, 404, 'Caregiver not found')
    // A stop names a client of this company or nobody (the template's database held one agency).
    const named = [...new Set(stops.map((s: any) => s?.clientId).filter(Boolean).map(String))] as string[]
    const known = new Set((await q.routeClients(d.db, companyId, named)).map((r: any) => r.id))
    const stranger = named.find((id) => !known.has(id))
    if (stranger) return fail(c, 404, 'Client not found')

    const planId = createId()
    const saved = await q.replaceRoutePlan(d.db, companyId, {
      id: planId, caregiverId: String(caregiverId), date,
      totalMiles: numOrNull(b.totalMiles), totalDriveMinutes: intOrNull(b.totalDriveMinutes), totalServiceMinutes: intOrNull(b.totalServiceMinutes),
      status, notes: b.notes || null, createdById: user.userId || null,
      stops: stops.map((s: any) => ({
        id: createId(), stopOrder: parseInt(s.stopOrder) || 0, clientId: s.clientId || null,
        arrival: hm(s.calculatedArrival), departure: hm(s.calculatedDeparture), serviceUnits: intOrNull(s.serviceUnits),
        miles: numOrNull(s.milesFromPrevious), driveMinutes: intOrNull(s.driveMinutesFromPrevious),
        latitude: numOrNull(s.latitude), longitude: numOrNull(s.longitude), address: s.address || null, notes: s.notes || null,
      })),
    })
    await core.careAudit.writeCareAudit(user, 'CREATE', 'route_plans', planId, saved, null)
    return one(c, { ...saved, id: planId }, 201)
  })

  // GET /plans?date=&caregiverId= — saved plans with their stops.
  app.get('/plans', plan, async (c) => {
    const { companyId } = c.get('user')
    const date = c.req.query('date') || null, caregiverId = c.req.query('caregiverId') || null
    if (date && !isYmd(date)) return fail(c, 400, 'date must be YYYY-MM-DD')
    const plans = await q.routePlans(d.db, companyId, date, caregiverId)
    const out = []
    for (const p of plans) out.push({ ...p, stops: await q.routePlanStops(d.db, companyId, p.id) })
    return list(c, out, { page: 1, limit: out.length, total: out.length })
  })

  // DELETE /plans/:id
  app.delete('/plans/:id', requirePermission('care-schedule:delete'), async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const deleted = await q.deleteRoutePlan(d.db, user.companyId, id)
    if (!deleted) return fail(c, 404, 'Route plan not found')
    await core.careAudit.writeCareAudit(user, 'DELETE', 'route_plans', id, null, deleted)
    return done(c, 'Route plan deleted')
  })

  // GET /hours-summary?startDate=&endDate= — each caregiver's week: scheduled vs clocked, miles. Scheduled figures count
  // the engine's occurrences (recurring shifts included).
  app.get('/hours-summary', plan, async (c) => {
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
    const weekStart = c.req.query('startDate') || addDays(today, -dow)
    const weekEnd = c.req.query('endDate') || addDays(today, 6 - dow)
    if (!isYmd(weekStart) || !isYmd(weekEnd) || weekStart > weekEnd) return fail(c, 400, 'startDate and endDate must be YYYY-MM-DD, start on or before end')

    const rows = await q.caregiverWeekSummary(d.db, companyId, weekStart, weekEnd, tz)
    const caregivers = rows.map((cg: any) => {
      const scheduled = parseFloat(cg.scheduledHours) || 0
      const clocked = parseFloat(cg.clockedHours) || 0
      const maxHours = parseFloat(cg.maxHoursPerWeek) || 40
      return {
        id: cg.id, name: `${cg.firstName} ${cg.lastName}`, phone: cg.phone,
        maxHoursPerWeek: maxHours,
        scheduledHours: r2(scheduled), clockedHours: r2(clocked),
        remainingHours: r2(Math.max(0, maxHours - scheduled)),
        overtimeHours: r2(Math.max(0, clocked - 40)),
        scheduledUnits: Math.round(parseFloat(cg.scheduledUnits) || 0),
        scheduledVisits: parseInt(cg.scheduledVisits) || 0,
        completedVisits: parseInt(cg.completedVisits) || 0,
        totalMiles: r2(parseFloat(cg.totalMiles || 0)),
        activeShift: cg.activeShift || null,
        utilizationPct: maxHours > 0 ? Math.round((scheduled / maxHours) * 100) : 0,
        clockedVsScheduledPct: scheduled > 0 ? Math.round((clocked / scheduled) * 100) : 0,
      }
    })
    const totals = {
      totalCaregivers: caregivers.length,
      totalScheduledHours: caregivers.reduce((s, x) => s + x.scheduledHours, 0),
      totalClockedHours: caregivers.reduce((s, x) => s + x.clockedHours, 0),
      totalMiles: caregivers.reduce((s, x) => s + x.totalMiles, 0),
      totalScheduledVisits: caregivers.reduce((s, x) => s + x.scheduledVisits, 0),
      totalCompletedVisits: caregivers.reduce((s, x) => s + x.completedVisits, 0),
      activeCaregivers: caregivers.filter((x) => x.activeShift).length,
    }
    return one(c, { startDate: weekStart, endDate: weekEnd, caregivers, totals })
  })

  // GET /daily/:date — every caregiver's route for a date, with miles between stops.
  app.get('/daily/:date', plan, async (c) => {
    const { companyId } = c.get('user')
    const date = c.req.param('date')
    if (!isYmd(date)) return fail(c, 400, 'Invalid date')
    const rows = await q.dayVisitsWithPositions(d.db, companyId, date)

    const byCg = new Map<string, any>()
    for (const r of rows) {
      if (!byCg.has(r.caregiverId)) {
        byCg.set(r.caregiverId, {
          caregiverId: r.caregiverId, caregiverName: `${r.cgFirst} ${r.cgLast}`,
          homeLatitude: parseFloat(r.cgLat), homeLongitude: parseFloat(r.cgLng),
          homeAddress: [r.cgAddress, r.cgCity, r.cgState, r.cgZip].filter(Boolean).join(', '),
          visits: [] as any[],
        })
      }
      const serviceMinutes = shiftHours(r.startTime, r.endTime) * 60
      byCg.get(r.caregiverId).visits.push({
        scheduleId: r.id, clientId: r.clientId, clientName: `${r.clFirst} ${r.clLast}`,
        latitude: parseFloat(r.clLat), longitude: parseFloat(r.clLng),
        address: [r.clAddress, r.clCity, r.clState, r.clZip].filter(Boolean).join(', '),
        startTime: r.startTime, endTime: r.endTime,
        serviceUnits: Math.round(serviceMinutes / 15), serviceMinutes, weeklyAuthorizedUnits: r.weeklyAuthorizedUnits,
      })
    }

    const routes = []
    for (const cg of byCg.values()) {
      let totalMiles = 0, totalDriveMinutes = 0
      let pLat = cg.homeLatitude, pLng = cg.homeLongitude
      const visits = []
      for (const v of cg.visits) {
        let miles: number | undefined, drive = 0
        if (googleKey() && pLat && pLng && v.latitude && v.longitude) {
          const g = await googleRoute(pLat, pLng, v.latitude, v.longitude, log)
          if (g) { miles = g.distanceMiles; drive = g.durationMinutes }
        }
        if (miles === undefined) { miles = haversine(pLat, pLng, v.latitude, v.longitude) || 0; drive = estimateDriveMinutes(miles) }
        totalMiles += miles; totalDriveMinutes += drive
        visits.push({ ...v, milesFromPrevious: Math.round(miles * 100) / 100, driveMinutesFromPrevious: drive })
        pLat = v.latitude; pLng = v.longitude
      }
      if (visits.length) {
        const last = visits[visits.length - 1]
        let rm: number | undefined, rd = 0
        if (googleKey() && last.latitude && last.longitude && cg.homeLatitude && cg.homeLongitude) {
          const g = await googleRoute(last.latitude, last.longitude, cg.homeLatitude, cg.homeLongitude, log)
          if (g) { rm = g.distanceMiles; rd = g.durationMinutes }
        }
        if (rm === undefined) { rm = haversine(last.latitude, last.longitude, cg.homeLatitude, cg.homeLongitude) || 0; rd = estimateDriveMinutes(rm) }
        totalMiles += rm; totalDriveMinutes += rd
      }
      routes.push({
        ...cg, visits,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalServiceMinutes: cg.visits.reduce((s: number, v: any) => s + v.serviceMinutes, 0),
        totalDriveMinutes,
      })
    }
    return one(c, { date, routes, routingSource: googleKey() ? 'google_routes_api' : 'haversine_estimate' })
  })

  // ── Geofences ─────────────────────────────────────────────────────────────────────────────────
  app.get('/geofence', requirePermission('care-clients:update'), async (c) => {
    const rows = await q.clientGeofences(d.db, c.get('user').companyId)
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  app.post('/geofence', requirePermission('care-clients:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    if (!b.clientId) return fail(c, 400, 'clientId required', undefined, { clientId: 'Choose a client.' })
    const radius = b.radiusFeet === undefined || b.radiusFeet === '' ? 300 : Number(b.radiusFeet)
    if (!Number.isFinite(radius) || radius <= 0 || radius > 52800) {
      return fail(c, 400, 'radiusFeet must be a number of feet between 1 and 52800', undefined, { radiusFeet: 'A number of feet between 1 and 52800.' })
    }
    if (!(await q.clientOnFile(d.db, companyId, String(b.clientId)))) return fail(c, 404, 'Client not found')
    const row = await q.upsertGeofence(d.db, companyId, {
      id: createId(), clientId: String(b.clientId), radiusFeet: Math.round(radius),
      autoClockIn: b.autoClockIn !== false, autoClockOut: b.autoClockOut !== false,
      requireGps: b.requireGps !== false, notifyAdminOnOverride: b.notifyAdminOnOverride !== false,
    })
    return one(c, row)
  })

  // The caregiver app asks this at clock-in. Answers only "inside or not, and how far" for one client the person serves.
  app.post('/geofence/check', requirePermission('evv:read'), async (c) => {
    const user = c.get('user')
    const b = await body(c)
    const lat = Number(b.latitude), lng = Number(b.longitude)
    if (!b.clientId || !Number.isFinite(lat) || !Number.isFinite(lng)) return fail(c, 400, 'clientId, latitude and longitude required')
    if (!(await core.access.maySeeClient(user, String(b.clientId)))) return fail(c, 403, 'You can only see the clients you care for.')
    const cl = await q.clientFence(d.db, user.companyId, String(b.clientId))
    if (!cl) return fail(c, 404, 'Client not found')
    if (!cl.latitude || !cl.longitude) return one(c, { withinGeofence: false, error: 'Client has no geocoded address' })
    const feet = distanceFeet(lat, lng, parseFloat(cl.latitude), parseFloat(cl.longitude))
    return one(c, {
      withinGeofence: feet !== null && feet <= Number(cl.radiusFeet),
      distanceFeet: feet == null ? null : Math.round(feet), radiusFeet: Number(cl.radiusFeet),
      autoClockIn: cl.autoClockIn, autoClockOut: cl.autoClockOut,
      clientName: `${cl.firstName} ${cl.lastName}`,
    })
  })

  // ── Geocoding (Google → Nominatim) ────────────────────────────────────────────────────────────
  app.post('/geocode', plan, async (c) => {
    const { companyId } = c.get('user')
    const { address, city, state, zip, entityType, entityId } = await body(c)
    const full = [address, city, state, zip].filter(Boolean).join(', ')
    if (!full) return fail(c, 400, 'Address required')
    let result = await googleGeocode(full, log)
    let source = 'google'
    if (!result) { source = 'nominatim'; result = await nominatim(full, await agencyName(companyId)) }
    if (!result) return fail(c, 404, `Address not found: ${full}`)
    if (entityType && entityId) {
      await q.setPosition(d.db, companyId, entityType === 'client' ? 'client' : 'user', String(entityId), result.latitude, result.longitude)
    }
    return one(c, { latitude: result.latitude, longitude: result.longitude, formattedAddress: result.formattedAddress, searchedAddress: full, source })
  })

  app.post('/geocode-all', plan, async (c) => {
    const { companyId } = c.get('user')
    const { entityType } = await body(c)
    const caregivers = entityType === 'caregivers'
    const rows = await q.unplacedAddresses(d.db, companyId, caregivers)
    const results = { success: 0, failed: 0, errors: [] as any[], source: googleKey() ? 'google' : 'nominatim' }
    const name = rows.length ? await agencyName(companyId) : ''
    for (const r of rows) {
      const full = joinAddress(r)
      try {
        let geo: any = googleKey() ? await googleGeocode(full, log) : null
        if (!geo) {
          await new Promise((res) => setTimeout(res, 1100)) // Nominatim's 1 request/second rule
          geo = await nominatim(full, name)
        }
        if (geo) {
          await q.setPosition(d.db, companyId, caregivers ? 'user' : 'client', r.id, geo.latitude, geo.longitude)
          results.success++
        } else { results.failed++; results.errors.push({ id: r.id, address: full, error: 'Not found' }) }
      } catch (e: any) { results.failed++; results.errors.push({ id: r.id, address: full, error: e?.message }) }
    }
    return one(c, { total: rows.length, ...results })
  })

  // PUT /stops/:stopId/status — live route tracking.
  app.put('/stops/:stopId/status', plan, async (c) => {
    const { status } = await body(c)
    if (!STOP_STATUSES.includes(status)) return fail(c, 400, `Invalid status. Must be one of: ${STOP_STATUSES.join(', ')}`)
    const row = await q.setStopStatus(d.db, c.get('user').companyId, c.req.param('stopId'), status)
    if (!row) return fail(c, 404, 'Stop not found')
    return one(c, row)
  })

  // GET /config-status — is Google configured, and does the key work?
  app.get('/config-status', plan, async (c) => {
    const key = googleKey()
    const status: any = {
      // `configured` / `provider` / `message` are the template's earlier shape; kept for any reader.
      configured: !!key,
      provider: key ? 'google-maps' : null,
      message: key ? 'Route optimization is enabled.' : 'Route optimization uses straight-line estimates. Set GOOGLE_MAPS_API_KEY for real road miles.',
      googleApiKeyConfigured: !!key,
      routingSource: key ? 'Google Routes API (real road miles + drive times)' : 'Haversine (straight-line estimate)',
      geocodingSource: key ? 'Google Geocoding API' : 'Nominatim (OpenStreetMap)',
      enabledApis: key ? ['Routes API', 'Geocoding API'] : ['Nominatim (free)'],
    }
    if (key) {
      const test = await googleGeocode('1600 Pennsylvania Ave NW, Washington, DC 20500', log)
      status.googleApiKeyValid = !!test
      status.testResult = test ? 'API key working — Geocoding OK' : 'API key may be invalid or APIs not enabled'
    }
    return one(c, status)
  })

  // GET /load-schedule/:caregiverId/:date — the caregiver's actual stops that day, for the planner.
  app.get('/load-schedule/:caregiverId/:date', plan, async (c) => {
    const { companyId } = c.get('user')
    const caregiverId = c.req.param('caregiverId'), date = c.req.param('date')
    if (!isYmd(date)) return fail(c, 400, 'Invalid date')
    const rows = await q.caregiverDayStops(d.db, companyId, caregiverId, date)
    const stops = rows.map((r: any) => {
      const serviceMinutes = shiftHours(r.startTime, r.endTime) * 60
      return {
        clientId: r.clientId, clientName: `${r.firstName} ${r.lastName}`,
        address: joinAddress(r),
        latitude: r.latitude ? parseFloat(r.latitude) : null, longitude: r.longitude ? parseFloat(r.longitude) : null,
        serviceUnits: Math.round(serviceMinutes / 15),
        weeklyAuthorizedUnits: r.weeklyAuthorizedUnits || 0,
        startTime: r.startTime || '', endTime: r.endTime || '',
        hasCoords: !!(r.latitude && r.longitude), scheduleId: r.id,
      }
    })
    const savedPlan = await q.savedPlanFor(d.db, companyId, caregiverId, date)
    return one(c, { stops, scheduledVisits: stops.length, savedPlan })
  })

  // POST /google-maps-url — a directions link that opens in the browser or the Maps app.
  app.post('/google-maps-url', plan, async (c) => {
    const { origin, destination, waypoints } = await body(c)
    const part = (p: any) => (p?.latitude && p?.longitude ? `${p.latitude},${p.longitude}` : p?.address ? encodeURIComponent(p.address) : null)
    const parts = ['https://www.google.com/maps/dir', part(origin), ...(Array.isArray(waypoints) ? waypoints.map(part) : []), part(destination)].filter(Boolean)
    return one(c, { url: parts.join('/') })
  })

  // GET /plans/:id/full — a saved plan with its stops, to load back into the planner.
  app.get('/plans/:id/full', plan, async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const p = await q.routePlanWithHome(d.db, companyId, id)
    if (!p) return fail(c, 404, 'Route plan not found')
    const stops = await q.routePlanFullStops(d.db, companyId, id)
    return one(c, {
      plan: p,
      caregiver: {
        id: p.caregiverId, name: `${p.cgFirst} ${p.cgLast}`,
        homeAddress: [p.cgAddress, p.cgCity, p.cgState, p.cgZip].filter(Boolean).join(', '),
        latitude: parseFloat(p.cgLat), longitude: parseFloat(p.cgLng),
      },
      stops: stops.map((s: any) => ({ ...s, clientName: `${s.firstName} ${s.lastName}`, latitude: parseFloat(s.latitude), longitude: parseFloat(s.longitude) })),
    })
  })

  // GET /saved-routes?limit=&offset=&status=&caregiverId=&startDate=&endDate= — a page of saved plans.
  app.get('/saved-routes', plan, async (c) => {
    const { companyId } = c.get('user')
    const qs = c.req.query()
    const limit = Math.max(1, Math.min(200, parseInt(qs.limit || '20') || 20))
    const offset = Math.max(0, parseInt(qs.offset || '0') || 0)
    for (const x of [qs.startDate, qs.endDate]) if (x && !isYmd(x)) return fail(c, 400, 'startDate/endDate must be YYYY-MM-DD')
    const f = { status: qs.status, caregiverId: qs.caregiverId, startDate: qs.startDate, endDate: qs.endDate }
    const [total, rows] = await Promise.all([q.savedRouteCount(d.db, companyId, f), q.savedRoutePage(d.db, companyId, f, limit, offset)])
    return list(c, rows.map((r: any) => ({ ...r, caregiverName: `${r.cgFirst} ${r.cgLast}` })), { page: Math.floor(offset / limit) + 1, limit, total })
  })

  // ── The screens that predate the port (served under /api/optimizer too) ──────────────────────
  // GET /company — company-level efficiency: clients with no active caregiver, caregivers over 40 hours this week.
  app.get('/company', plan, async (c) => {
    const { companyId } = c.get('user')
    const rows = await q.activeClientAssignments(d.db, companyId)
    const clientMap = new Map<string, { clientId: string; name: string; assignments: any[] }>()
    for (const row of rows) {
      if (!clientMap.has(row.clientId)) clientMap.set(row.clientId, { clientId: row.clientId, name: `${row.clientFirstName} ${row.clientLastName}`, assignments: [] })
      if (row.assignmentId) {
        clientMap.get(row.clientId)!.assignments.push({
          id: row.assignmentId, caregiverId: row.caregiverId,
          caregiver: { id: row.caregiverId, firstName: row.caregiverFirstName, lastName: row.caregiverLastName },
        })
      }
    }
    const understaffed = Array.from(clientMap.values()).filter((x) => x.assignments.length === 0)
      .map((x) => ({ clientId: x.clientId, name: x.name, issue: 'No active caregiver assigned' }))
    const overscheduled = (await q.completedMinutesLastWeek(d.db, companyId))
      .filter((x: any) => (Number(x.totalMinutes) || 0) > 40 * 60)
      .map((x: any) => ({ caregiverId: x.caregiverId, weeklyMinutes: Number(x.totalMinutes), issue: 'Over 40 hours this week' }))
    return one(c, { understaffedClients: understaffed, overscheduledCaregivers: overscheduled })
  })

  // GET /routes — the clients of active assignments (one caregiver's when named).
  app.get('/routes', plan, async (c) => {
    const caregiverId = c.req.query('caregiverId') || null
    const date = c.req.query('date')
    const companyId = c.get('user').companyId
    // Undated: the agency's today (the server's UTC day was tomorrow every US evening).
    const day = date && isYmd(date) ? date : await agencyTime.today(companyId)
    const stops = await q.assignedClientStops(d.db, companyId, caregiverId)
    return one(c, { caregiverId, date: day, stops })
  })

  // GET /stats — the route optimizer dashboard's summary; visit counts off the schedule engine.
  app.get('/stats', plan, async (c) => {
    const { companyId } = c.get('user')
    const today = await core.time.today(companyId)
    const s = await q.optimizerStats(d.db, companyId, today, addDays(today, -7))
    return one(c, {
      activeClients: Number(s.activeClients || 0),
      activeCaregivers: Number(s.activeCaregivers || 0),
      todayShifts: Number(s.todayShifts || 0),
      weekShifts: Number(s.weekShifts || 0),
      optimizerConfigured: !!googleKey(),
    })
  })

  return app
}
