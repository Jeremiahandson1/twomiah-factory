// Route optimizer, mileage, the hours dashboard and GPS geofences — ported from CVHC
// routes/routeOptimizerRoutes.js (b2456a2). Mounted at /api/route-optimizer (and /api/optimizer,
// where /company, /routes and /stats predate the port and are kept).
//
// Driving distances come from the Google Routes API when GOOGLE_MAPS_API_KEY is set; without it the
// planner falls back to straight-line (haversine) miles at ~30 mph, and the screen says so. Geocoding
// tries Google, then OpenStreetMap's Nominatim.
//
// Visits for a day come off the shared schedule engine, so the planner never routes a caregiver to a
// cancelled visit or a terminated pattern, handles bi-weekly, and routes the person who is actually
// going on a covered day.
//
// Template mappings: route_plans.date / total_distance_miles / total_duration_minutes are CVHC's
// route_date / total_miles / total_drive_minutes, and route_plan_stops.distance_from_prev_miles /
// duration_from_prev_minutes are miles_from_previous / drive_minutes_from_previous — the responses
// carry CVHC's names so the screen reads them unchanged. Stop arrival/departure are timestamps here
// (the plan's date + the planned time); they are returned as HH:MM.
//
// Auth: everything is the office's (requireAdmin) except POST /geofence/check, which the caregiver
// app calls at clock-in to ask whether it is inside the client's geofence.
import { Hono } from 'hono'
import { eq, and, gte, sql, sum, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { clients, clientAssignments, users, timeEntries, auditLogs } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { maySeeClient } from '../helpers/caregiverAccess.ts'
import { occurrencesCte, shiftHours } from '../services/scheduleOccurrences.ts'
import { agencyTimezone, agencyToday, addDays, isYmd, dayStartUtc, dayEndUtc } from '../services/agencyTime.ts'

const app = new Hono()
app.use('*', authenticate)

const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows || []
const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || ''
const userId = (c: any) => (c.get('user') as any)?.userId || (c.get('user') as any)?.id
async function body(c: any): Promise<any> { try { return (await c.req.json()) || {} } catch { return {} } }

// ============================================================
// Google API helpers
// ============================================================
type Seg = { distanceMiles: number; durationMinutes: number }

async function googleRoute(oLat: number, oLng: number, dLat: number, dLng: number): Promise<Seg | null> {
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
  } catch (e: any) { console.error('Google Routes API error:', e?.message); return null }
}

// One call for every origin × destination pair. Returns "originIdx-destIdx" → segment.
async function googleRouteMatrix(nodes: Array<{ latitude: number; longitude: number }>): Promise<Record<string, Seg> | null> {
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
  } catch (e: any) { console.error('Google Route Matrix API error:', e?.message); return null }
}

async function googleGeocode(address: string) {
  const key = googleKey(); if (!key) return null
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}&components=country:US`)
    const data: any = await res.json()
    if (data.status === 'OK' && data.results?.length) {
      const { lat, lng } = data.results[0].geometry.location
      return { latitude: lat, longitude: lng, formattedAddress: data.results[0].formatted_address }
    }
    return null
  } catch (e: any) { console.error('Google Geocoding error:', e?.message); return null }
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
async function agencyName(): Promise<string> {
  return (await rows(sql`SELECT name FROM agencies ORDER BY created_at LIMIT 1`))[0]?.name || 'HomeCareCRM'
}

// ============================================================
// Distance + route-solving helpers (exported for the tests)
// ============================================================
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
  return miles ? miles * 5280 : null
}

// Nearest-neighbour tour from node 0 over a distance matrix.
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

// 2-opt improvement over the same matrix.
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

async function audit(uid: string, action: string, recordId: string, oldData: any, newData: any) {
  try {
    await db.insert(auditLogs).values({ userId: uid, action, tableName: 'route_plans', recordId, oldData, newData })
  } catch { /* never block the action on the audit write */ }
}

// The mileage reimbursement rate the planner uses unless the screen sends another.
const DEFAULT_MILEAGE_RATE = 0.67

// ============================================================
// POST /optimize — order a caregiver's stops for the day, real road miles where Google is configured
// ============================================================
app.post('/optimize', requireAdmin, async (c) => {
  const b = await body(c)
  const { caregiverId, date, stops } = b
  const bufferMinutes = parseInt(b.bufferMinutes) || 0
  const mileageRate = parseFloat(b.mileageRate) || DEFAULT_MILEAGE_RATE
  if (!caregiverId || !date || !Array.isArray(stops) || !stops.length) {
    return c.json({ error: 'caregiverId, date, and stops[] required' }, 400)
  }

  const cg = (await rows(sql`SELECT id, first_name, last_name, latitude, longitude, address, city, state, zip
    FROM users WHERE id = ${caregiverId} AND role = 'caregiver'`))[0]
  if (!cg) return c.json({ error: 'Caregiver not found' }, 404)
  if (!cg.latitude || !cg.longitude) {
    return c.json({ error: 'Caregiver has no home address geocoded. Please update their address first.', field: 'caregiver_address' }, 400)
  }

  const clientIds = stops.map((s: any) => String(s.clientId || '')).filter(Boolean)
  const clientRows = clientIds.length
    ? await rows(sql`SELECT id, first_name, last_name, latitude, longitude, address, city, state, zip, weekly_authorized_units
        FROM clients WHERE id IN (${sql.join(clientIds.map((i: string) => sql`${i}`), sql`, `)})`)
    : []
  const clientMap = new Map(clientRows.map((r: any) => [r.id, r]))

  const stopList = stops.map((s: any) => {
    const cl: any = clientMap.get(s.clientId)
    if (!cl) return null
    const units = parseInt(s.serviceUnits) || 0
    return {
      clientId: cl.id, clientName: `${cl.first_name} ${cl.last_name}`,
      latitude: parseFloat(cl.latitude), longitude: parseFloat(cl.longitude),
      address: [cl.address, cl.city, cl.state, cl.zip].filter(Boolean).join(', '),
      serviceUnits: units, serviceMinutes: units * 15,
      requestedStartTime: s.startTime || null, requestedEndTime: s.endTime || null,
      weeklyAuthorizedUnits: cl.weekly_authorized_units || 0,
    }
  }).filter(Boolean) as any[]
  if (!stopList.length) return c.json({ error: 'None of those stops is a client on file' }, 400)

  const missing = stopList.filter((s) => !s.latitude || !s.longitude)
  if (missing.length) {
    return c.json({ error: 'Some clients are missing geocoded addresses', missingClients: missing.map((s) => ({ clientId: s.clientId, name: s.clientName })) }, 400)
  }

  // Node 0 = caregiver home, 1..N = stops
  const nodes = [{ latitude: parseFloat(cg.latitude), longitude: parseFloat(cg.longitude) }, ...stopList.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))]
  let m: Record<string, Seg> = {}
  let usingGoogle = false
  if (googleKey() && nodes.length <= 26) {
    const g = await googleRouteMatrix(nodes)
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
  const r2 = (n: number) => Math.round(n * 100) / 100
  return c.json({
    caregiver: {
      id: cg.id, name: `${cg.first_name} ${cg.last_name}`,
      homeAddress: [cg.address, cg.city, cg.state, cg.zip].filter(Boolean).join(', '),
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

// ============================================================
// POST /save-route — one plan per caregiver per day (a re-save replaces it)
// ============================================================
const hm = (t: unknown) => (typeof t === 'string' && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5).padStart(5, '0') : null)
app.post('/save-route', requireAdmin, async (c) => {
  const b = await body(c)
  const { caregiverId, date, stops } = b
  if (!caregiverId || !isYmd(date) || !Array.isArray(stops)) return c.json({ error: 'caregiverId, date (YYYY-MM-DD) and stops[] required' }, 400)
  const status = ['draft', 'published'].includes(b.status) ? b.status : 'draft'
  const exists = (await rows(sql`SELECT 1 FROM users WHERE id = ${caregiverId} AND role = 'caregiver'`)).length
  if (!exists) return c.json({ error: 'Caregiver not found' }, 404)
  const planId = createId()
  const ts = (t: unknown) => { const v = hm(t); return v ? sql`(${`${date} ${v}`})::timestamp` : sql`NULL` }
  const numOrNull = (v: unknown) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v))

  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM route_plans WHERE caregiver_id = ${caregiverId} AND date = (${date})::date`)
    const inserted = ((await tx.execute(sql`INSERT INTO route_plans
        (id, caregiver_id, date, total_distance_miles, total_duration_minutes, total_service_minutes, stop_count, status, notes, created_by_id, optimized_at)
      VALUES (${planId}, ${caregiverId}, (${date})::date, ${numOrNull(b.totalMiles)}, ${numOrNull(b.totalDriveMinutes) == null ? null : Math.round(Number(b.totalDriveMinutes))},
              ${numOrNull(b.totalServiceMinutes) == null ? null : Math.round(Number(b.totalServiceMinutes))}, ${stops.length}, ${status}, ${b.notes || null}, ${userId(c) || null}, NOW())
      RETURNING *`)) as any).rows[0]
    for (const s of stops) {
      await tx.execute(sql`INSERT INTO route_plan_stops
          (id, route_plan_id, stop_order, client_id, arrival_time, departure_time, service_units,
           distance_from_prev_miles, duration_from_prev_minutes, latitude, longitude, address, notes)
        VALUES (${createId()}, ${planId}, ${parseInt(s.stopOrder) || 0}, ${s.clientId || null}, ${ts(s.calculatedArrival)}, ${ts(s.calculatedDeparture)},
                ${numOrNull(s.serviceUnits) == null ? null : Math.round(Number(s.serviceUnits))}, ${numOrNull(s.milesFromPrevious)},
                ${numOrNull(s.driveMinutesFromPrevious) == null ? null : Math.round(Number(s.driveMinutesFromPrevious))},
                ${numOrNull(s.latitude)}, ${numOrNull(s.longitude)}, ${s.address || null}, ${s.notes || null})`)
    }
    return inserted
  })
  await audit(userId(c), 'CREATE', planId, null, plan)
  return c.json({ id: planId, ...plan }, 201)
})

// The plan columns under CVHC's names, so the screen reads them unchanged.
const PLAN_COLS = sql`rp.id, rp.caregiver_id, to_char(rp.date, 'YYYY-MM-DD') AS route_date,
  rp.total_distance_miles AS total_miles, rp.total_duration_minutes AS total_drive_minutes,
  rp.total_service_minutes, rp.stop_count, rp.status, rp.notes, rp.created_by_id AS created_by,
  rp.optimized_at, rp.created_at, rp.updated_at`
const STOP_COLS = sql`rps.id, rps.route_plan_id, rps.stop_order, rps.client_id,
  to_char(rps.arrival_time, 'HH24:MI') AS arrival_time, to_char(rps.departure_time, 'HH24:MI') AS departure_time,
  rps.service_units, rps.distance_from_prev_miles AS miles_from_previous,
  rps.duration_from_prev_minutes AS drive_minutes_from_previous,
  rps.latitude, rps.longitude, rps.address, rps.notes, rps.status, rps.actual_arrival, rps.actual_departure`

// GET /plans?date=&caregiverId=
app.get('/plans', requireAdmin, async (c) => {
  const date = c.req.query('date'), caregiverId = c.req.query('caregiverId')
  if (date && !isYmd(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
  const plans = await rows(sql`SELECT ${PLAN_COLS},
      u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
      u.latitude AS cg_lat, u.longitude AS cg_lng, u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip
    FROM route_plans rp JOIN users u ON rp.caregiver_id = u.id
    WHERE 1=1 ${date ? sql`AND rp.date = (${date})::date` : sql``} ${caregiverId ? sql`AND rp.caregiver_id = ${caregiverId}` : sql``}
    ORDER BY rp.date DESC, u.first_name`)
  const out = []
  for (const p of plans) {
    const stops = await rows(sql`SELECT ${STOP_COLS}, c.first_name AS client_first_name, c.last_name AS client_last_name,
        c.phone AS client_phone, c.weekly_authorized_units
      FROM route_plan_stops rps JOIN clients c ON rps.client_id = c.id
      WHERE rps.route_plan_id = ${p.id} ORDER BY rps.stop_order`)
    out.push({ ...p, stops })
  }
  return c.json(out)
})

// DELETE /plans/:id
app.delete('/plans/:id', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const deleted = ((await db.execute(sql`DELETE FROM route_plans WHERE id = ${id} RETURNING *`)) as any).rows
  if (!deleted.length) return c.json({ error: 'Route plan not found' }, 404)
  await audit(userId(c), 'DELETE', id, deleted[0], null)
  return c.json({ message: 'Route plan deleted' })
})

// ============================================================
// GET /hours-summary?startDate=&endDate= — each caregiver's week: scheduled vs clocked, miles
// ============================================================
// Scheduled figures count the engine's occurrences (recurring shifts included); CVHC's query counted
// only one-time rows with a date in the range, so a caregiver on a recurring schedule showed 0 here.
app.get('/hours-summary', requireAdmin, async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const weekStart = c.req.query('startDate') || addDays(today, -dow)
  const weekEnd = c.req.query('endDate') || addDays(today, 6 - dow)
  if (!isYmd(weekStart) || !isYmd(weekEnd) || weekStart > weekEnd) return c.json({ error: 'startDate and endDate must be YYYY-MM-DD, start on or before end' }, 400)

  const result = await rows(sql`WITH ${occurrencesCte(weekStart, weekEnd)}
    SELECT u.id, u.first_name, u.last_name, u.phone,
      COALESCE(ca.max_hours_per_week, 40) AS max_hours_per_week,
      COALESCE((SELECT SUM(o.hours) FROM occ o WHERE o.caregiver_id = u.id), 0) AS scheduled_hours,
      COALESCE((SELECT SUM(o.minutes) / 15.0 FROM occ o WHERE o.caregiver_id = u.id), 0) AS scheduled_units,
      COALESCE((SELECT COUNT(*) FROM occ o WHERE o.caregiver_id = u.id), 0)::int AS scheduled_visits,
      COALESCE((SELECT SUM(te.duration_minutes) / 60.0 FROM time_entries te
                WHERE te.caregiver_id = u.id AND te.is_complete = true
                  AND te.start_time >= ${dayStartUtc(weekStart, tz)} AND te.start_time < ${dayEndUtc(weekEnd, tz)}), 0) AS clocked_hours,
      COALESCE((SELECT COUNT(*) FROM time_entries te
                WHERE te.caregiver_id = u.id AND te.is_complete = true
                  AND te.start_time >= ${dayStartUtc(weekStart, tz)} AND te.start_time < ${dayEndUtc(weekEnd, tz)}), 0)::int AS completed_visits,
      (SELECT json_build_object('id', te.id, 'client_id', te.client_id,
                'start_time', to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'client_name', cl.first_name || ' ' || cl.last_name)
         FROM time_entries te LEFT JOIN clients cl ON te.client_id = cl.id
        WHERE te.caregiver_id = u.id AND te.is_complete = false AND te.end_time IS NULL
        ORDER BY te.start_time DESC LIMIT 1) AS active_shift,
      COALESCE((SELECT SUM(rp.total_distance_miles) FROM route_plans rp
                WHERE rp.caregiver_id = u.id AND rp.date >= (${weekStart})::date AND rp.date <= (${weekEnd})::date), 0) AS total_miles
    FROM users u
    LEFT JOIN caregiver_availability ca ON u.id = ca.caregiver_id
    WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY u.first_name, u.last_name`)

  const r2 = (n: number) => Math.round(n * 100) / 100
  const caregivers = result.map((cg: any) => {
    const scheduled = parseFloat(cg.scheduled_hours) || 0
    const clocked = parseFloat(cg.clocked_hours) || 0
    const maxHours = parseFloat(cg.max_hours_per_week) || 40
    return {
      id: cg.id, name: `${cg.first_name} ${cg.last_name}`, phone: cg.phone,
      maxHoursPerWeek: maxHours,
      scheduledHours: r2(scheduled), clockedHours: r2(clocked),
      remainingHours: r2(Math.max(0, maxHours - scheduled)),
      overtimeHours: r2(Math.max(0, clocked - 40)),
      scheduledUnits: Math.round(parseFloat(cg.scheduled_units) || 0),
      scheduledVisits: parseInt(cg.scheduled_visits) || 0,
      completedVisits: parseInt(cg.completed_visits) || 0,
      totalMiles: r2(parseFloat(cg.total_miles || 0)),
      activeShift: cg.active_shift || null,
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
  return c.json({ startDate: weekStart, endDate: weekEnd, caregivers, totals })
})

// ============================================================
// GET /daily/:date — every caregiver's route for a date, with miles between stops
// ============================================================
app.get('/daily/:date', requireAdmin, async (c) => {
  const date = c.req.param('date')
  if (!isYmd(date)) return c.json({ error: 'Invalid date' }, 400)
  const result = await rows(sql`WITH ${occurrencesCte(date, date)}
    SELECT occ.schedule_id AS id, occ.caregiver_id, occ.client_id,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           u.first_name AS cg_first, u.last_name AS cg_last, u.latitude AS cg_lat, u.longitude AS cg_lng,
           u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip,
           c.first_name AS cl_first, c.last_name AS cl_last, c.latitude AS cl_lat, c.longitude AS cl_lng,
           c.address AS cl_address, c.city AS cl_city, c.state AS cl_state, c.zip AS cl_zip,
           c.weekly_authorized_units
    FROM occ
    JOIN users u   ON u.id = occ.caregiver_id
    JOIN clients c ON c.id = occ.client_id
    ORDER BY u.first_name, occ.start_time`)

  const byCg = new Map<string, any>()
  for (const r of result) {
    if (!byCg.has(r.caregiver_id)) {
      byCg.set(r.caregiver_id, {
        caregiverId: r.caregiver_id, caregiverName: `${r.cg_first} ${r.cg_last}`,
        homeLatitude: parseFloat(r.cg_lat), homeLongitude: parseFloat(r.cg_lng),
        homeAddress: [r.cg_address, r.cg_city, r.cg_state, r.cg_zip].filter(Boolean).join(', '),
        visits: [] as any[],
      })
    }
    const serviceMinutes = shiftHours(r.start_time, r.end_time) * 60
    byCg.get(r.caregiver_id).visits.push({
      scheduleId: r.id, clientId: r.client_id, clientName: `${r.cl_first} ${r.cl_last}`,
      latitude: parseFloat(r.cl_lat), longitude: parseFloat(r.cl_lng),
      address: [r.cl_address, r.cl_city, r.cl_state, r.cl_zip].filter(Boolean).join(', '),
      startTime: r.start_time, endTime: r.end_time,
      serviceUnits: Math.round(serviceMinutes / 15), serviceMinutes, weeklyAuthorizedUnits: r.weekly_authorized_units,
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
        const g = await googleRoute(pLat, pLng, v.latitude, v.longitude)
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
        const g = await googleRoute(last.latitude, last.longitude, cg.homeLatitude, cg.homeLongitude)
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
  return c.json({ date, routes, routingSource: googleKey() ? 'google_routes_api' : 'haversine_estimate' })
})

// ============================================================
// Geofences
// ============================================================
app.get('/geofence', requireAdmin, async (c) => {
  return c.json(await rows(sql`SELECT gs.*, c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.latitude, c.longitude
    FROM geofence_settings gs JOIN clients c ON gs.client_id = c.id
    WHERE c.is_active = true ORDER BY c.first_name`))
})

app.post('/geofence', requireAdmin, async (c) => {
  const b = await body(c)
  if (!b.clientId) return c.json({ error: 'clientId required' }, 400)
  const radius = b.radiusFeet === undefined || b.radiusFeet === '' ? 300 : Number(b.radiusFeet)
  if (!Number.isFinite(radius) || radius <= 0 || radius > 52800) return c.json({ error: 'radiusFeet must be a number of feet between 1 and 52800' }, 400)
  const exists = (await rows(sql`SELECT 1 FROM clients WHERE id = ${b.clientId}`)).length
  if (!exists) return c.json({ error: 'Client not found' }, 404)
  const result = await rows(sql`INSERT INTO geofence_settings (id, client_id, radius_feet, auto_clock_in, auto_clock_out, require_gps, notify_admin_on_override)
    VALUES (${createId()}, ${b.clientId}, ${Math.round(radius)}, ${b.autoClockIn !== false}, ${b.autoClockOut !== false}, ${b.requireGps !== false}, ${b.notifyAdminOnOverride !== false})
    ON CONFLICT (client_id) DO UPDATE SET
      radius_feet = EXCLUDED.radius_feet, auto_clock_in = EXCLUDED.auto_clock_in, auto_clock_out = EXCLUDED.auto_clock_out,
      require_gps = EXCLUDED.require_gps, notify_admin_on_override = EXCLUDED.notify_admin_on_override, updated_at = NOW()
    RETURNING *`)
  return c.json(result[0])
})

// The caregiver app asks this at clock-in. Answers only "inside or not, and how far" for one client.
app.post('/geofence/check', async (c) => {
  const b = await body(c)
  const lat = Number(b.latitude), lng = Number(b.longitude)
  if (!b.clientId || !Number.isFinite(lat) || !Number.isFinite(lng)) return c.json({ error: 'clientId, latitude and longitude required' }, 400)
  // A caregiver asks only about a client they serve (the dashboard asks for today's visits); the
  // answer names the client and where the fence is.
  if (!(await maySeeClient(c.get('user' as any), String(b.clientId)))) return c.json({ error: 'You can only see the clients you care for.' }, 403)
  const cl = (await rows(sql`SELECT c.latitude, c.longitude, c.first_name, c.last_name,
      COALESCE(gs.radius_feet, 300) AS radius_feet, COALESCE(gs.auto_clock_in, true) AS auto_clock_in, COALESCE(gs.auto_clock_out, true) AS auto_clock_out
    FROM clients c LEFT JOIN geofence_settings gs ON c.id = gs.client_id WHERE c.id = ${b.clientId}`))[0]
  if (!cl) return c.json({ error: 'Client not found' }, 404)
  if (!cl.latitude || !cl.longitude) return c.json({ withinGeofence: false, error: 'Client has no geocoded address' })
  const feet = distanceFeet(lat, lng, parseFloat(cl.latitude), parseFloat(cl.longitude))
  return c.json({
    withinGeofence: feet !== null && feet <= Number(cl.radius_feet),
    distanceFeet: feet ? Math.round(feet) : null, radiusFeet: Number(cl.radius_feet),
    autoClockIn: cl.auto_clock_in, autoClockOut: cl.auto_clock_out,
    clientName: `${cl.first_name} ${cl.last_name}`,
  })
})

// ============================================================
// Geocoding (Google → Nominatim)
// ============================================================
app.post('/geocode', requireAdmin, async (c) => {
  const { address, city, state, zip, entityType, entityId } = await body(c)
  const full = [address, city, state, zip].filter(Boolean).join(', ')
  if (!full) return c.json({ error: 'Address required' }, 400)
  let result = await googleGeocode(full)
  let source = 'google'
  if (!result) { source = 'nominatim'; result = await nominatim(full, await agencyName()) }
  if (!result) return c.json({ error: 'Address not found', address: full }, 404)
  if (entityType && entityId) {
    if (entityType === 'client') await db.update(clients).set({ latitude: String(result.latitude), longitude: String(result.longitude), updatedAt: new Date() }).where(eq(clients.id, entityId))
    else await db.update(users).set({ latitude: String(result.latitude), longitude: String(result.longitude), updatedAt: new Date() }).where(eq(users.id, entityId))
  }
  return c.json({ latitude: result.latitude, longitude: result.longitude, formattedAddress: result.formattedAddress, searchedAddress: full, source })
})

app.post('/geocode-all', requireAdmin, async (c) => {
  const { entityType } = await body(c)
  const caregivers = entityType === 'caregivers'
  const list = caregivers
    ? await rows(sql`SELECT id, address, city, state, zip FROM users WHERE (latitude IS NULL OR longitude IS NULL) AND address IS NOT NULL AND role = 'caregiver' AND is_active = true`)
    : await rows(sql`SELECT id, address, city, state, zip FROM clients WHERE (latitude IS NULL OR longitude IS NULL) AND address IS NOT NULL AND is_active = true`)
  const results = { success: 0, failed: 0, errors: [] as any[], source: googleKey() ? 'google' : 'nominatim' }
  const name = list.length ? await agencyName() : ''
  for (const r of list) {
    const full = [r.address, r.city, r.state, r.zip].filter(Boolean).join(', ')
    try {
      let geo: any = googleKey() ? await googleGeocode(full) : null
      if (!geo) {
        await new Promise((res) => setTimeout(res, 1100)) // Nominatim's 1 request/second rule
        geo = await nominatim(full, name)
      }
      if (geo) {
        const set = { latitude: String(geo.latitude), longitude: String(geo.longitude), updatedAt: new Date() }
        if (caregivers) await db.update(users).set(set).where(eq(users.id, r.id))
        else await db.update(clients).set(set).where(eq(clients.id, r.id))
        results.success++
      } else { results.failed++; results.errors.push({ id: r.id, address: full, error: 'Not found' }) }
    } catch (e: any) { results.failed++; results.errors.push({ id: r.id, address: full, error: e?.message }) }
  }
  return c.json({ total: list.length, ...results })
})

// ============================================================
// PUT /stops/:stopId/status — live route tracking
// ============================================================
const STOP_STATUSES = ['pending', 'en_route', 'arrived', 'in_progress', 'completed', 'skipped']
app.put('/stops/:stopId/status', requireAdmin, async (c) => {
  const { status } = await body(c)
  if (!STOP_STATUSES.includes(status)) return c.json({ error: `Invalid status. Must be one of: ${STOP_STATUSES.join(', ')}` }, 400)
  const result = await rows(sql`UPDATE route_plan_stops SET status = ${status}
      ${status === 'arrived' ? sql`, actual_arrival = NOW()` : status === 'completed' ? sql`, actual_departure = NOW()` : sql``}
    WHERE id = ${c.req.param('stopId')} RETURNING *`)
  if (!result.length) return c.json({ error: 'Stop not found' }, 404)
  return c.json(result[0])
})

// ============================================================
// GET /config-status — is Google configured, and does the key work?
// ============================================================
app.get('/config-status', requireAdmin, async (c) => {
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
    const test = await googleGeocode('1600 Pennsylvania Ave NW, Washington, DC 20500')
    status.googleApiKeyValid = !!test
    status.testResult = test ? 'API key working — Geocoding OK' : 'API key may be invalid or APIs not enabled'
  }
  return c.json(status)
})

// ============================================================
// GET /load-schedule/:caregiverId/:date — the caregiver's actual stops that day, for the planner
// ============================================================
app.get('/load-schedule/:caregiverId/:date', requireAdmin, async (c) => {
  const caregiverId = c.req.param('caregiverId'), date = c.req.param('date')
  if (!isYmd(date)) return c.json({ error: 'Invalid date' }, 400)
  // Filter on the engine's RESOLVED caregiver, so a day this caregiver is covering shows up and a
  // day their own visit was handed to someone else does not.
  const result = await rows(sql`WITH ${occurrencesCte(date, date)}
    SELECT occ.schedule_id AS id, occ.client_id,
           to_char(occ.start_time, 'HH24:MI') AS start_time, to_char(occ.end_time, 'HH24:MI') AS end_time,
           c.first_name, c.last_name, c.latitude, c.longitude, c.address, c.city, c.state, c.zip, c.weekly_authorized_units
    FROM occ JOIN clients c ON c.id = occ.client_id
    WHERE occ.caregiver_id = ${caregiverId}
    ORDER BY occ.start_time`)
  const stops = result.map((r: any) => {
    const serviceMinutes = shiftHours(r.start_time, r.end_time) * 60
    return {
      clientId: r.client_id, clientName: `${r.first_name} ${r.last_name}`,
      address: [r.address, r.city, r.state, r.zip].filter(Boolean).join(', '),
      latitude: r.latitude ? parseFloat(r.latitude) : null, longitude: r.longitude ? parseFloat(r.longitude) : null,
      serviceUnits: Math.round(serviceMinutes / 15),
      weeklyAuthorizedUnits: r.weekly_authorized_units || 0,
      startTime: r.start_time || '', endTime: r.end_time || '',
      hasCoords: !!(r.latitude && r.longitude), scheduleId: r.id,
    }
  })
  const saved = await rows(sql`SELECT id, status, total_distance_miles AS total_miles, total_duration_minutes AS total_drive_minutes,
      total_service_minutes, stop_count, created_at, notes
    FROM route_plans WHERE caregiver_id = ${caregiverId} AND date = (${date})::date
    ORDER BY created_at DESC LIMIT 1`)
  return c.json({ stops, scheduledVisits: stops.length, savedPlan: saved[0] || null })
})

// POST /google-maps-url — a directions link that opens in the browser or the Maps app
app.post('/google-maps-url', requireAdmin, async (c) => {
  const { origin, destination, waypoints } = await body(c)
  const part = (p: any) => (p?.latitude && p?.longitude ? `${p.latitude},${p.longitude}` : p?.address ? encodeURIComponent(p.address) : null)
  const parts = ['https://www.google.com/maps/dir', part(origin), ...(Array.isArray(waypoints) ? waypoints.map(part) : []), part(destination)].filter(Boolean)
  return c.json({ url: parts.join('/') })
})

// GET /plans/:id/full — a saved plan with its stops, to load back into the planner
app.get('/plans/:id/full', requireAdmin, async (c) => {
  const id = c.req.param('id')
  const p = (await rows(sql`SELECT ${PLAN_COLS},
      u.first_name AS cg_first, u.last_name AS cg_last, u.latitude AS cg_lat, u.longitude AS cg_lng,
      u.address AS cg_address, u.city AS cg_city, u.state AS cg_state, u.zip AS cg_zip
    FROM route_plans rp JOIN users u ON rp.caregiver_id = u.id WHERE rp.id = ${id}`))[0]
  if (!p) return c.json({ error: 'Route plan not found' }, 404)
  const stops = await rows(sql`SELECT ${STOP_COLS}, c.first_name, c.last_name, c.phone, c.weekly_authorized_units
    FROM route_plan_stops rps JOIN clients c ON rps.client_id = c.id
    WHERE rps.route_plan_id = ${id} ORDER BY rps.stop_order`)
  return c.json({
    plan: p,
    caregiver: {
      id: p.caregiver_id, name: `${p.cg_first} ${p.cg_last}`,
      homeAddress: [p.cg_address, p.cg_city, p.cg_state, p.cg_zip].filter(Boolean).join(', '),
      latitude: parseFloat(p.cg_lat), longitude: parseFloat(p.cg_lng),
    },
    stops: stops.map((s: any) => ({ ...s, clientName: `${s.first_name} ${s.last_name}`, latitude: parseFloat(s.latitude), longitude: parseFloat(s.longitude) })),
  })
})

// GET /saved-routes?limit=&offset=&status=&caregiverId=&startDate=&endDate=
app.get('/saved-routes', requireAdmin, async (c) => {
  const q = c.req.query()
  const limit = Math.max(1, Math.min(200, parseInt(q.limit || '20') || 20))
  const offset = Math.max(0, parseInt(q.offset || '0') || 0)
  for (const d of [q.startDate, q.endDate]) if (d && !isYmd(d)) return c.json({ error: 'startDate/endDate must be YYYY-MM-DD' }, 400)
  const where = sql`WHERE 1=1
    ${q.status ? sql`AND rp.status = ${q.status}` : sql``}
    ${q.caregiverId ? sql`AND rp.caregiver_id = ${q.caregiverId}` : sql``}
    ${q.startDate ? sql`AND rp.date >= (${q.startDate})::date` : sql``}
    ${q.endDate ? sql`AND rp.date <= (${q.endDate})::date` : sql``}`
  const total = parseInt((await rows(sql`SELECT COUNT(*)::int AS n FROM route_plans rp ${where}`))[0]?.n) || 0
  const list = await rows(sql`SELECT ${PLAN_COLS}, u.first_name AS cg_first, u.last_name AS cg_last,
      (SELECT COUNT(*)::int FROM route_plan_stops rps WHERE rps.route_plan_id = rp.id) AS actual_stop_count
    FROM route_plans rp JOIN users u ON rp.caregiver_id = u.id
    ${where}
    ORDER BY rp.date DESC, u.first_name LIMIT ${limit} OFFSET ${offset}`)
  return c.json({ routes: list.map((r: any) => ({ ...r, caregiverName: `${r.cg_first} ${r.cg_last}` })), total, limit, offset })
})

// ============================================================
// Template screens that predate the port (mounted under /api/optimizer)
// ============================================================

// Company-level efficiency analysis
app.get('/company', requireAdmin, async (c) => {
  const activeClientRows = await db.select({
    clientId: clients.id, clientFirstName: clients.firstName, clientLastName: clients.lastName,
    assignmentId: clientAssignments.id, caregiverId: clientAssignments.caregiverId,
    caregiverFirstName: users.firstName, caregiverLastName: users.lastName,
  })
    .from(clients)
    .leftJoin(clientAssignments, and(eq(clientAssignments.clientId, clients.id), eq(clientAssignments.status, 'active')))
    .leftJoin(users, eq(clientAssignments.caregiverId, users.id))
    .where(eq(clients.isActive, true))

  const clientMap = new Map<string, { clientId: string; name: string; assignments: any[] }>()
  for (const row of activeClientRows) {
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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const caregiverHours = await db.select({ caregiverId: timeEntries.caregiverId, totalMinutes: sum(timeEntries.durationMinutes) })
    .from(timeEntries)
    .where(and(gte(timeEntries.startTime, sevenDaysAgo), eq(timeEntries.isComplete, true)))
    .groupBy(timeEntries.caregiverId)
  const overscheduled = caregiverHours.filter((x) => (Number(x.totalMinutes) || 0) > 40 * 60)
    .map((x) => ({ caregiverId: x.caregiverId, weeklyMinutes: Number(x.totalMinutes), issue: 'Over 40 hours this week' }))

  return c.json({ understaffedClients: understaffed, overscheduledCaregivers: overscheduled })
})

// Stops for one caregiver (active assignments)
app.get('/routes', requireAdmin, async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const date = c.req.query('date')
  const dateObj = date && isYmd(date) ? new Date(`${date}T12:00:00Z`) : new Date()
  const assignments = await db.select({
    firstName: clients.firstName, lastName: clients.lastName, address: clients.address, city: clients.city,
    latitude: clients.latitude, longitude: clients.longitude,
  })
    .from(clientAssignments)
    .innerJoin(clients, eq(clientAssignments.clientId, clients.id))
    .where(and(caregiverId ? eq(clientAssignments.caregiverId, caregiverId) : undefined, eq(clientAssignments.status, 'active')))
  return c.json({ caregiverId, date: dateObj.toISOString().split('T')[0], stops: assignments })
})

// GET /stats — summary for the route optimizer dashboard. Shift counts off the schedule engine.
app.get('/stats', requireAdmin, async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const [activeClients] = await db.select({ count: sql<number>`count(*)::int` }).from(clients).where(eq(clients.isActive, true))
  const [activeCaregivers] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true)))
  const todayShifts = (await rows(sql`WITH ${occurrencesCte(today, today)} SELECT COUNT(*)::int AS n FROM occ`))[0]?.n || 0
  const weekShifts = (await rows(sql`WITH ${occurrencesCte(addDays(today, -7), today)} SELECT COUNT(*)::int AS n FROM occ`))[0]?.n || 0
  return c.json({
    activeClients: Number(activeClients?.count || 0),
    activeCaregivers: Number(activeCaregivers?.count || 0),
    todayShifts: Number(todayShifts),
    weekShifts: Number(weekShifts),
    optimizerConfigured: !!googleKey(),
  })
})

export default app
