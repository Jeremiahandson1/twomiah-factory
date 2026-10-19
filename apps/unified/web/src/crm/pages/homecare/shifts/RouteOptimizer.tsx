// Moved from templates/crm-homecare/frontend/src/components/admin/RouteOptimizer.tsx.
// Route & Schedule Optimizer v2 — a caregiver's day planned as a route, the day's routes, the week's hours, saved routes
// and the clients' GPS geofences.
//
// Its calls, as the unified server answers them (server/crm/homecare/planning/optimizer.ts, data/homecarePlanning.ts;
// the planner asks care-schedule:update, saving a plan care-schedule:create, deleting one care-schedule:delete, a
// geofence care-clients:update):
//   GET  /api/caregivers, /api/clients                → list replies (firstName, isActive, latitude, weeklyAuthorizedUnits
//                                                       …; the template read first_name, is_active …).
//   GET  /api/route-optimizer/config-status           → { googleApiKeyConfigured, … }.
//   GET  /api/route-optimizer/load-schedule/:cg/:date → { stops, savedPlan } — savedPlan.totalMiles (was total_miles).
//   POST /api/route-optimizer/optimize                → the optimized route (camelCase, as before).
//   POST /api/route-optimizer/save-route              → the saved plan.
//   GET  /api/route-optimizer/daily/:date             → { routes } (camelCase, as before).
//   GET  /api/route-optimizer/hours-summary           → { caregivers, totals }; activeShift.clientName (was client_name).
//   GET  /api/route-optimizer/saved-routes            → list reply (was { routes }); rows routeDate, totalMiles,
//                                                       stopCount, actualStopCount, caregiverName.
//   GET  /api/route-optimizer/plans/:id/full          → { plan: { caregiverId, routeDate }, caregiver, stops: [{ clientId,
//                                                       serviceUnits, weeklyAuthorizedUnits, arrivalTime, departureTime }] }.
//   DELETE /api/route-optimizer/plans/:id             → { success }.
//   GET  /api/route-optimizer/geofence                → list reply (was the bare array); rows clientId, radiusFeet,
//                                                       autoClockIn, autoClockOut, requireGps, notifyAdminOnOverride,
//                                                       firstName, lastName, address, city.
//   POST /api/route-optimizer/geofence, /geocode, /geocode-all — the same bodies as the template.
import { Fragment, useState, useEffect, useRef, useMemo, type CSSProperties } from 'react'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { toLocalYMD, parseLocalDate } from '../lib/date'
import { useConfirm, useMayWrite } from '../../../../shared'
import { CHIP, FILL, INK, SOLID, type Tone } from './ui'

// ── The replies' shapes ──────────────────────────────────────────────────────
type Num = number | string | null | undefined

interface Caregiver {
  id: string; firstName: string | null; lastName: string | null; isActive?: boolean | null
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  latitude?: Num; longitude?: Num
}
interface Client {
  id: string; firstName: string | null; lastName: string | null; isActive?: boolean | null
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  latitude?: Num; longitude?: Num; weeklyAuthorizedUnits?: number | null
}
/** A stop in the planner (built here, or from load-schedule / a saved plan). */
interface Stop {
  clientId: string; clientName: string; address: string
  latitude?: Num; longitude?: Num
  serviceUnits: number; weeklyAuthorizedUnits: number
  startTime: string; endTime: string
  hasCoords: boolean
}
interface RouteStop {
  clientId: string; clientName: string; address: string; latitude?: number; longitude?: number
  serviceUnits: number; serviceMinutes: number; weeklyAuthorizedUnits?: number
  milesFromPrevious: number; driveMinutesFromPrevious: number
  calculatedArrival: string; calculatedDeparture: string
  scheduledStartTime: string | null; scheduledEndTime: string | null
}
interface OptimizedRoute {
  caregiver: { id: string; name: string; homeAddress: string }
  stops: RouteStop[]
  preOptimization?: {
    stops: RouteStop[]; totalMiles: number; totalDriveMinutes: number; mileageReimbursement: number
    returnMiles: number; returnDriveMinutes: number
  }
  googleMapsUrl?: string
  summary: {
    totalStops: number; totalMiles: number; totalDriveMinutes: number; totalServiceMinutes: number; totalServiceHours: number
    totalBufferMinutes: number; returnMiles: number; returnDriveMinutes: number
    estimatedStartTime: string; estimatedEndTime: string; mileageReimbursement: number
    milesSaved: number; drivingMinutesSaved: number; routingSource: string
  }
}
interface SavedPlanSummary { id: string; status: string; totalMiles: Num }
interface DailyVisit { clientName: string; address: string; startTime: string | null; endTime: string | null; serviceUnits: number; milesFromPrevious: number }
interface DailyRoute { caregiverId: string; caregiverName: string; homeAddress: string; visits: DailyVisit[]; totalMiles: number; totalServiceMinutes: number; totalDriveMinutes: number }
interface HoursRow {
  id: string; name: string; scheduledHours: number; clockedHours: number; remainingHours: number; overtimeHours: number
  utilizationPct: number; scheduledVisits: number; completedVisits: number; totalMiles: number
  activeShift: { clientName?: string | null } | null
}
interface HoursData {
  caregivers: HoursRow[]
  totals: { totalCaregivers: number; totalScheduledHours: number; totalClockedHours: number; totalMiles: number; totalScheduledVisits: number; totalCompletedVisits: number; activeCaregivers: number }
}
interface SavedRoute {
  id: string; routeDate: string; caregiverName: string; stopCount: number | null; actualStopCount: number | null
  totalMiles: Num; totalServiceMinutes: number | null; totalDriveMinutes: number | null; status: string
}
interface FullPlan {
  plan: { caregiverId: string; routeDate: string }
  caregiver: { name: string }
  stops: Array<{ clientId: string; clientName: string; address: string | null; latitude: number; longitude: number; serviceUnits: number | null; weeklyAuthorizedUnits: number | null; arrivalTime: string | null; departureTime: string | null }>
}
interface GeofenceRow {
  id: string; clientId: string; radiusFeet: number; autoClockIn: boolean; autoClockOut: boolean; requireGps: boolean
  notifyAdminOnOverride: boolean; firstName: string | null; lastName: string | null; address: string | null; city: string | null
}
interface GeofenceEdit { clientId: string; clientName: string; radiusFeet: number; autoClockIn: boolean; autoClockOut: boolean; requireGps: boolean; notifyAdminOnOverride: boolean }
type GeofenceFlag = 'autoClockIn' | 'autoClockOut' | 'requireGps' | 'notifyAdminOnOverride'
interface GeocodeResults { total: number; success: number; failed: number; source: string; errors?: Array<{ address: string; error: string }> }

type Tab = 'planner' | 'daily' | 'hours' | 'saved' | 'geofence'
type MsgType = 'success' | 'error' | 'warning' | ''

// The pickers ask for every row: both lists are paged at 50 by default, and the template's dropdowns stopped there.

// The print sheet is its own document: every value written into it is escaped (the template wrote names raw).
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

const RouteOptimizer = () => {
  const confirm = useConfirm()
  const maySave = useMayWrite('care-schedule:create')
  const mayDelete = useMayWrite('care-schedule:delete')
  const mayFence = useMayWrite('care-clients:update')
  // Optimize and geocode are the planner's care-schedule:update (planning/optimizer.ts `plan`).
  const mayPlan = useMayWrite('care-schedule:update')
  // ── Core state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('planner')
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: MsgType }>({ text: '', type: '' })
  const [apiStatus, setApiStatus] = useState<{ googleApiKeyConfigured?: boolean } | null>(null)

  // ── Route Planner state ─────────────────────────────────────
  const [selectedCaregiver, setSelectedCaregiver] = useState('')
  const [selectedDate, setSelectedDate] = useState(toLocalYMD(new Date()))
  const [routeStops, setRouteStops] = useState<Stop[]>([])
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRoute | null>(null)
  const [, setPreOptimizeMiles] = useState<number | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [startTime, setStartTime] = useState('08:00')
  const [bufferMinutes, setBufferMinutes] = useState(10)
  const [mileageRate, setMileageRate] = useState(0.67)
  const [clientSearch, setClientSearch] = useState('')
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [existingSavedPlan, setExistingSavedPlan] = useState<SavedPlanSummary | null>(null)

  // ── Daily view state ────────────────────────────────────────
  const [dailyDate, setDailyDate] = useState(toLocalYMD(new Date()))
  const [dailyRoutes, setDailyRoutes] = useState<DailyRoute[]>([])
  const [dailyLoading, setDailyLoading] = useState(false)

  // ── Hours dashboard state ───────────────────────────────────
  const [hoursData, setHoursData] = useState<HoursData | null>(null)
  const [hoursLoading, setHoursLoading] = useState(false)
  const [hoursStartDate, setHoursStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay())
    return toLocalYMD(d)
  })
  const [hoursEndDate, setHoursEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + (6 - d.getDay()))
    return toLocalYMD(d)
  })

  // ── Saved Routes state ──────────────────────────────────────
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(false)
  const [savedFilter, setSavedFilter] = useState({ status: '', caregiverId: '' })

  // ── Geofence state ──────────────────────────────────────────
  const [geofenceSettings, setGeofenceSettings] = useState<GeofenceRow[]>([])
  const [geofenceLoading, setGeofenceLoading] = useState(false)
  const [editGeofence, setEditGeofence] = useState<GeofenceEdit | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeResults, setGeocodeResults] = useState<GeocodeResults | null>(null)

  // ── Drag state ──────────────────────────────────────────────
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)

  // ── Print ref ───────────────────────────────────────────────
  const printRef = useRef<HTMLDivElement | null>(null)

  // ════════════════════════════════════════════════════════════
  // Data Loading
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    loadData()
    api.get('/api/route-optimizer/config-status').then(setApiStatus).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab === 'daily') loadDailyView()
    if (activeTab === 'hours') loadHoursSummary()
    if (activeTab === 'geofence') loadGeofenceSettings()
    if (activeTab === 'saved') loadSavedRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const loadData = async () => {
    try {
      const [cgData, clData] = await Promise.all([listAll('/api/caregivers'), listAll('/api/clients')])
      setCaregivers(rows<Caregiver>(cgData))
      setClients(rows<Client>(clData))
    } catch (e) {
      console.error('Load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const showMsg = (text: string, type: MsgType = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), 5000)
  }

  // ════════════════════════════════════════════════════════════
  // Route Planner Logic
  // ════════════════════════════════════════════════════════════

  // Load from existing schedule
  const loadFromSchedule = async () => {
    if (!selectedCaregiver) { showMsg('Select a caregiver first', 'error'); return }
    setLoadingSchedule(true)
    try {
      const data = (await api.get(`/api/route-optimizer/load-schedule/${encodeURIComponent(selectedCaregiver)}/${selectedDate}`)) as { stops: Stop[]; savedPlan: SavedPlanSummary | null }
      const stops = Array.isArray(data?.stops) ? data.stops : []
      if (stops.length === 0) {
        showMsg(`No schedules found for ${selectedDate}`, 'error')
        return
      }
      setRouteStops(stops)
      setExistingSavedPlan(data.savedPlan)
      setOptimizedRoute(null)
      setPreOptimizeMiles(null)
      showMsg(`Loaded ${stops.length} visits from schedule${data.savedPlan ? ' (saved plan exists)' : ''}`)
    } catch (e) {
      showMsg(errorMessage(e), 'error')
    } finally {
      setLoadingSchedule(false)
    }
  }

  // Client search filtering
  const filteredClients = useMemo(() => {
    const existing = new Set(routeStops.map((s) => s.clientId))
    return clients
      .filter((c) => c.isActive !== false && !existing.has(c.id))
      .filter((c) => {
        if (!clientSearch.trim()) return true
        const term = clientSearch.toLowerCase()
        return `${c.firstName} ${c.lastName}`.toLowerCase().includes(term) ||
          (c.address || '').toLowerCase().includes(term) ||
          (c.city || '').toLowerCase().includes(term)
      })
      .slice(0, 15) // Cap dropdown to prevent performance issues
  }, [clients, routeStops, clientSearch])

  const addStopToRoute = (clientId: string) => {
    if (routeStops.find((s) => s.clientId === clientId)) return
    const client = clients.find((c) => c.id === clientId)
    if (!client) return
    setRouteStops((prev) => [...prev, {
      clientId: client.id,
      clientName: `${client.firstName} ${client.lastName}`,
      address: [client.address, client.city, client.state, client.zip].filter(Boolean).join(', '),
      latitude: client.latitude, longitude: client.longitude,
      serviceUnits: client.weeklyAuthorizedUnits ? Math.min(client.weeklyAuthorizedUnits, 16) : 4,
      weeklyAuthorizedUnits: client.weeklyAuthorizedUnits || 0,
      startTime: '', endTime: '',
      hasCoords: !!(client.latitude && client.longitude),
    }])
    setOptimizedRoute(null)
    setPreOptimizeMiles(null)
    setClientSearch('')
  }

  const removeStop = (idx: number) => {
    setRouteStops((prev) => prev.filter((_, i) => i !== idx))
    setOptimizedRoute(null)
  }

  const updateStop = (idx: number, field: 'serviceUnits', value: string) => {
    setRouteStops((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: parseInt(value) || 0 } : s))
    setOptimizedRoute(null)
  }

  // Drag and drop
  const handleDragStart = (idx: number) => { dragItem.current = idx }
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx }
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    const items = [...routeStops]
    const dragged = items.splice(dragItem.current, 1)[0]
    items.splice(dragOverItem.current, 0, dragged)
    setRouteStops(items)
    setOptimizedRoute(null)
    dragItem.current = null
    dragOverItem.current = null
  }

  // Optimize
  const optimizeRoute = async () => {
    if (!selectedCaregiver) { showMsg('Select a caregiver first', 'error'); return }
    if (routeStops.length === 0) { showMsg('Add at least one client', 'error'); return }
    const missingCoords = routeStops.filter((s) => !s.hasCoords)
    if (missingCoords.length > 0) {
      showMsg(`${missingCoords.length} client(s) need geocoded addresses. Go to GPS & Geofence tab → Geocode All.`, 'error')
      return
    }
    setOptimizing(true)
    try {
      const data = (await api.post('/api/route-optimizer/optimize', {
        caregiverId: selectedCaregiver, date: selectedDate, startTime,
        bufferMinutes, mileageRate,
        stops: routeStops.map((s) => ({
          clientId: s.clientId, serviceUnits: s.serviceUnits,
          startTime: s.startTime || undefined, endTime: s.endTime || undefined,
        })),
      })) as OptimizedRoute

      // Store pre-optimization miles from real calculation
      if (data.preOptimization) {
        setPreOptimizeMiles(data.preOptimization.totalMiles)
      }

      setOptimizedRoute(data)
      // Update stops to match optimized order
      setRouteStops(data.stops.map((s) => ({
        clientId: s.clientId, clientName: s.clientName, address: s.address,
        latitude: s.latitude, longitude: s.longitude,
        serviceUnits: s.serviceUnits, weeklyAuthorizedUnits: s.weeklyAuthorizedUnits || 0,
        startTime: s.scheduledStartTime || '', endTime: s.scheduledEndTime || '',
        hasCoords: true,
      })))
      const savedMsg = data.summary.milesSaved > 0
        ? `Saves ${data.summary.milesSaved} mi vs current schedule!`
        : 'Schedule order is already optimal.'
      showMsg(`Route optimized! ${data.summary.totalMiles} mi · ${data.summary.totalStops} stops · ${savedMsg}`)
    } catch (e) {
      showMsg('Optimization failed: ' + errorMessage(e), 'error')
    } finally {
      setOptimizing(false)
    }
  }

  // Save
  const saveRoute = async (status: 'draft' | 'published' = 'draft') => {
    if (!optimizedRoute) { showMsg('Optimize the route first', 'error'); return }
    setSaving(true)
    try {
      await api.post('/api/route-optimizer/save-route', {
        caregiverId: selectedCaregiver, date: selectedDate,
        stops: optimizedRoute.stops,
        totalMiles: optimizedRoute.summary.totalMiles,
        totalDriveMinutes: optimizedRoute.summary.totalDriveMinutes,
        totalServiceMinutes: optimizedRoute.summary.totalServiceMinutes,
        status,
      })
      showMsg(`Route ${status === 'published' ? 'published' : 'saved as draft'}!`)
    } catch (e) {
      showMsg('Save failed: ' + errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Print route sheet (its own document, printed on paper: light, and every value escaped)
  const printRouteSheet = () => {
    if (!optimizedRoute) return
    const r = optimizedRoute
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Route Sheet - ${esc(r.caregiver.name)} - ${esc(selectedDate)}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
      .summary { display: flex; gap: 20px; margin-bottom: 16px; padding: 10px; background: #f5f5f5; border-radius: 6px; }
      .summary div { text-align: center; }
      .summary .val { font-size: 18px; font-weight: 800; }
      .summary .lbl { font-size: 9px; text-transform: uppercase; color: #888; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
      th { background: #333; color: #fff; padding: 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
      td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
      tr:nth-child(even) { background: #f9f9f9; }
      .stop-num { display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #2563eb; color: #fff; text-align: center; line-height: 22px; font-weight: 800; font-size: 11px; }
      .notes-area { border: 1px solid #ddd; border-radius: 4px; padding: 8px; min-height: 30px; margin-top: 4px; }
      .footer { margin-top: 20px; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 8px; }
      @media print { body { padding: 10px; } }
    </style></head><body>
    <h1>🗺️ Route Sheet — ${esc(r.caregiver.name)}</h1>
    <div class="meta">${esc(selectedDate)} · Start: ${esc(r.summary.estimatedStartTime)} · End: ~${esc(r.summary.estimatedEndTime)} · Home: ${esc(r.caregiver.homeAddress)}</div>
    <div class="summary">
      <div><div class="val">${esc(r.summary.totalMiles)}</div><div class="lbl">Miles</div></div>
      <div><div class="val">${esc(r.summary.totalStops)}</div><div class="lbl">Stops</div></div>
      <div><div class="val">${esc(r.summary.totalServiceHours)}h</div><div class="lbl">Service</div></div>
      <div><div class="val">${esc(r.summary.totalDriveMinutes)}m</div><div class="lbl">Drive</div></div>
      <div><div class="val">$${esc(r.summary.mileageReimbursement)}</div><div class="lbl">Mileage</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Client</th><th>Address</th><th>Arrive</th><th>Depart</th><th>Units</th><th>Miles</th><th>Drive</th><th>Notes / Signature</th></tr></thead>
      <tbody>
        <tr style="background:#e8f5e9"><td>🏠</td><td colspan="2"><strong>START: Home</strong> — ${esc(r.caregiver.homeAddress)}</td><td>${esc(r.summary.estimatedStartTime)}</td><td></td><td></td><td></td><td></td><td></td></tr>
        ${r.stops.map((s, i) => `
          <tr><td><span class="stop-num">${i + 1}</span></td>
          <td><strong>${esc(s.clientName)}</strong></td>
          <td style="font-size:11px">${esc(s.address)}</td>
          <td><strong>${esc(s.calculatedArrival)}</strong></td>
          <td>${esc(s.calculatedDeparture)}</td>
          <td>${esc(s.serviceUnits)} (${esc(s.serviceMinutes)}m)</td>
          <td>${esc(s.milesFromPrevious)} mi</td>
          <td>~${esc(s.driveMinutesFromPrevious)}m</td>
          <td><div class="notes-area"></div></td></tr>
        `).join('')}
        <tr style="background:#e8f5e9"><td>🏠</td><td colspan="2"><strong>RETURN: Home</strong></td><td>~${esc(r.summary.estimatedEndTime)}</td><td></td><td></td><td>${esc(r.summary.returnMiles)} mi</td><td>~${esc(r.summary.returnDriveMinutes)}m</td><td></td></tr>
      </tbody>
    </table>
    <div class="footer">
      ${r.summary.routingSource === 'google_routes_api' ? 'Google Routes API (actual road miles)' : 'Estimated distances'} · Mileage rate: $${esc(mileageRate)}/mi
    </div>
    <script>window.onload = () => window.print();</script>
    </body></html>`)
    w.document.close()
  }

  // ════════════════════════════════════════════════════════════
  // Daily View
  // ════════════════════════════════════════════════════════════
  const loadDailyView = async () => {
    setDailyLoading(true)
    try {
      const data = (await api.get(`/api/route-optimizer/daily/${dailyDate}`)) as { routes?: DailyRoute[] }
      setDailyRoutes(Array.isArray(data?.routes) ? data.routes : [])
    } catch (e) { console.error(e) }
    finally { setDailyLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'daily') loadDailyView() }, [dailyDate])

  // ════════════════════════════════════════════════════════════
  // Hours Summary
  // ════════════════════════════════════════════════════════════
  const loadHoursSummary = async () => {
    setHoursLoading(true)
    try {
      const data = (await api.get('/api/route-optimizer/hours-summary', { startDate: hoursStartDate, endDate: hoursEndDate })) as HoursData
      setHoursData(data && Array.isArray(data.caregivers) ? data : null)
    } catch (e) { console.error(e) }
    finally { setHoursLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'hours') loadHoursSummary() }, [hoursStartDate, hoursEndDate])

  // ════════════════════════════════════════════════════════════
  // Saved Routes
  // ════════════════════════════════════════════════════════════
  const loadSavedRoutes = async () => {
    setSavedRoutesLoading(true)
    try {
      const data = await api.get('/api/route-optimizer/saved-routes', {
        limit: 50,
        status: savedFilter.status || undefined,
        caregiverId: savedFilter.caregiverId || undefined,
      })
      setSavedRoutes(rows<SavedRoute>(data))
    } catch (e) { console.error(e) }
    finally { setSavedRoutesLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeTab === 'saved') loadSavedRoutes() }, [savedFilter])

  const loadSavedPlanIntoPlanner = async (planId: string) => {
    try {
      const data = (await api.get(`/api/route-optimizer/plans/${encodeURIComponent(planId)}/full`)) as FullPlan
      setSelectedCaregiver(data.plan.caregiverId)
      setSelectedDate(data.plan.routeDate)
      setRouteStops(data.stops.map((s) => ({
        clientId: s.clientId, clientName: s.clientName,
        address: s.address || '', latitude: s.latitude, longitude: s.longitude,
        serviceUnits: s.serviceUnits || 4,
        weeklyAuthorizedUnits: s.weeklyAuthorizedUnits || 0,
        startTime: s.arrivalTime?.slice(0, 5) || '', endTime: s.departureTime?.slice(0, 5) || '',
        hasCoords: !!(s.latitude && s.longitude),
      })))
      setOptimizedRoute(null)
      setActiveTab('planner')
      showMsg(`Loaded saved route: ${data.caregiver.name} · ${data.plan.routeDate}`)
    } catch (e) {
      showMsg('Failed to load route: ' + errorMessage(e), 'error')
    }
  }

  const deleteSavedPlan = async (planId: string) => {
    if (!(await confirm('Delete this saved route?', { confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/route-optimizer/plans/${encodeURIComponent(planId)}`)
      showMsg('Route deleted')
      loadSavedRoutes()
    } catch { showMsg('Delete failed', 'error') }
  }

  // ════════════════════════════════════════════════════════════
  // Geofence
  // ════════════════════════════════════════════════════════════
  const loadGeofenceSettings = async () => {
    setGeofenceLoading(true)
    try { setGeofenceSettings(rows<GeofenceRow>(await api.get('/api/route-optimizer/geofence'))) }
    catch (e) { console.error(e) }
    finally { setGeofenceLoading(false) }
  }

  const saveGeofence = async (data: GeofenceEdit) => {
    try {
      await api.post('/api/route-optimizer/geofence', data)
      showMsg('Geofence saved')
      loadGeofenceSettings()
      setEditGeofence(null)
    } catch { showMsg('Save failed', 'error') }
  }

  const geocodeAll = async (type: 'clients' | 'caregivers') => {
    setGeocoding(true)
    try {
      const data = (await api.post('/api/route-optimizer/geocode-all', { entityType: type })) as GeocodeResults
      setGeocodeResults(data)
      showMsg(`Geocoded ${data.success} of ${data.total} ${type} (${data.source})`)
      loadData()
    } catch { showMsg('Geocoding failed', 'error') }
    finally { setGeocoding(false) }
  }

  const geocodeSingle = async (entityType: 'caregiver' | 'client', entityId: string, address?: string | null, city?: string | null, state?: string | null, zip?: string | null) => {
    try {
      await api.post('/api/route-optimizer/geocode', { address, city, state, zip, entityType, entityId })
      showMsg('Address geocoded')
      loadData()
    } catch (e) { showMsg(errorMessage(e), 'error') }
  }

  // ════════════════════════════════════════════════════════════
  // Helper components & computed values
  // ════════════════════════════════════════════════════════════
  const totalUnits = routeStops.reduce((sum, s) => sum + s.serviceUnits, 0)
  const totalHours = (totalUnits * 0.25).toFixed(2)
  const cg = caregivers.find((c) => c.id === selectedCaregiver)
  const cgHasCoords = !!(cg && cg.latitude && cg.longitude)

  const dayName = (dateStr: string) => {
    try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) }
    catch { return dateStr }
  }

  // ════════════════════════════════════════════════════════════
  // Styles — the frame's tokens (var(--hc-…)) for grounds, lines and inks, so every block reads in both themes; a
  // colour that carries meaning is a light/dark pair from ./ui.ts.
  // ════════════════════════════════════════════════════════════
  const s = {
    page: { padding: '1.25rem', maxWidth: '1440px', margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', color: 'var(--hc-ink)' } as CSSProperties,
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' } as CSSProperties,
    title: { fontSize: '1.4rem', fontWeight: 800, margin: 0 } as CSSProperties,
    tabs: { display: 'flex', gap: '2px', background: 'var(--hc-subtle)', borderRadius: '10px', padding: '3px', marginBottom: '1.25rem', overflowX: 'auto' } as CSSProperties,
    tab: (active: boolean): CSSProperties => ({
      padding: '0.55rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600,
      fontSize: '0.82rem', transition: 'all 0.15s', whiteSpace: 'nowrap',
      background: active ? 'var(--hc-surface)' : 'transparent', color: active ? 'var(--hc-ink)' : 'var(--hc-ink-soft)',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
    }),
    card: { background: 'var(--hc-surface)', borderRadius: '12px', border: '1px solid var(--hc-line)', padding: '1.15rem', marginBottom: '0.85rem' } as CSSProperties,
    cardTitle: { fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.5rem' } as CSSProperties,
    row: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.65rem' } as CSSProperties,
    col: (flex = 1): CSSProperties => ({ flex, minWidth: '180px' }),
    label: { display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--hc-ink-soft)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.4px' } as CSSProperties,
    select: { width: '100%', padding: '0.55rem', border: '1px solid var(--hc-line)', borderRadius: '8px', fontSize: '0.88rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as CSSProperties,
    input: { width: '100%', padding: '0.55rem', border: '1px solid var(--hc-line)', borderRadius: '8px', fontSize: '0.88rem', boxSizing: 'border-box', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as CSSProperties,
    inputSm: { width: '68px', padding: '0.45rem', border: '1px solid var(--hc-line)', borderRadius: '6px', fontSize: '0.82rem', textAlign: 'center', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as CSSProperties,
    // A solid button: white on a ground dark enough for it in both themes (./ui.ts SOLID).
    btn: (bg: string = SOLID.blue, disabled = false): CSSProperties => ({
      padding: '0.55rem 1.1rem', borderRadius: '8px', border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: 700, fontSize: '0.82rem', color: '#fff', background: disabled ? SOLID.gray : bg,
      transition: 'all 0.15s', opacity: disabled ? 0.6 : 1,
    }),
    btnSm: (bg: string = SOLID.blue): CSSProperties => ({
      padding: '0.3rem 0.65rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
      fontWeight: 700, fontSize: '0.75rem', color: '#fff', background: bg,
    }),
    // An outlined button: its ink and its border are the same light/dark pair (a class from ghostCls).
    btnGhost: { padding: '0.55rem 1.1rem', borderRadius: '8px', borderWidth: 2, borderStyle: 'solid', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', background: 'transparent' } as CSSProperties,
    msg: (type: MsgType): CSSProperties => {
      const k = type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'success'
      return {
        padding: '0.7rem 1rem', borderRadius: '8px', marginBottom: '0.85rem', fontWeight: 600, fontSize: '0.85rem',
        background: `var(--hc-${k}-bg)`, color: `var(--hc-${k}-ink)`, border: `1px solid var(--hc-${k}-line)`,
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }
    },
    badge: { display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.55rem', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' } as CSSProperties,
    stat: { background: 'var(--hc-surface)', borderRadius: '10px', border: '1px solid var(--hc-line)', padding: '0.85rem', textAlign: 'center', flex: '1 1 140px' } as CSSProperties,
    statVal: { fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 } as CSSProperties,
    statLbl: { fontSize: '0.68rem', fontWeight: 700, color: 'var(--hc-ink-soft)', textTransform: 'uppercase', letterSpacing: '0.3px', marginTop: '3px' } as CSSProperties,
    table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.83rem' } as CSSProperties,
    th: { padding: '0.6rem', textAlign: 'left', fontWeight: 800, color: 'var(--hc-ink-soft)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '2px solid var(--hc-line)', background: 'var(--hc-subtle)' } as CSSProperties,
    td: { padding: '0.6rem', borderBottom: '1px solid var(--hc-subtle)', verticalAlign: 'middle' } as CSSProperties,
    emptyState: { textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--hc-ink-soft)' } as CSSProperties,
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' } as CSSProperties,
    stopCard: { display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.75rem', marginBottom: '6px', background: 'var(--hc-subtle)', borderRadius: '10px', border: '1px solid var(--hc-line)', cursor: 'grab', transition: 'all 0.1s', userSelect: 'none' } as CSSProperties,
  }
  // The outlined buttons' ink and border, light and dark.
  const ghostCls: Record<'blue' | 'ink' | 'orange' | 'red' | 'soft', string> = {
    blue: 'text-blue-700 border-blue-700 dark:text-blue-300 dark:border-blue-300',
    ink: 'text-gray-800 border-gray-800 dark:text-slate-200 dark:border-slate-200',
    orange: 'text-[#c2410c] border-[#c2410c] dark:text-[#fdba74] dark:border-[#fdba74]',
    red: 'text-red-700 border-red-700 dark:text-red-300 dark:border-red-300',
    soft: 'text-gray-600 border-gray-500 dark:text-slate-300 dark:border-slate-400',
  }
  const chip = (tone: Tone) => CHIP[tone]
  // A numbered circle: white on a fixed dark ground.
  const dot = (bg: string, size: number): CSSProperties => ({ width: size, height: size, borderRadius: '50%', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 })

  const statTile = (st: { val: string | number; lbl: string; tone: Tone }, i: number) => (
    <div key={i} style={s.stat}><div className={INK[st.tone]} style={s.statVal}>{st.val}</div><div style={s.statLbl}>{st.lbl}</div></div>
  )

  // ════════════════════════════════════════════════════════════
  // RENDER: Route Planner Tab
  // ════════════════════════════════════════════════════════════
  const renderPlanner = () => (
    <div>
      {/* Config bar */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={s.cardTitle}>⚙️ Route Setup</div>
          {existingSavedPlan && (
            <span className={chip('violet')} style={s.badge}>
              Saved plan exists ({existingSavedPlan.status}) · {existingSavedPlan.totalMiles} mi
            </span>
          )}
        </div>
        <div style={s.row}>
          <div style={s.col(2)}>
            <label style={s.label}>Caregiver</label>
            <select style={s.select} value={selectedCaregiver} onChange={(e) => { setSelectedCaregiver(e.target.value); setOptimizedRoute(null); setRouteStops([]); setExistingSavedPlan(null) }}>
              <option value="">— Select Caregiver —</option>
              {caregivers.filter((c) => c.isActive !== false).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName} {c.latitude ? '📍' : '⚠️'}
                </option>
              ))}
            </select>
          </div>
          <div style={s.col(1)}>
            <label style={s.label}>Date</label>
            <input type="date" style={s.input} value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); setOptimizedRoute(null) }} />
          </div>
          <div style={s.col(0.7)}>
            <label style={s.label}>Start Time</label>
            <input type="time" style={s.input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div style={s.col(0.6)}>
            <label style={s.label}>Buffer (min)</label>
            <input type="number" min="0" max="30" style={s.input} value={bufferMinutes} onChange={(e) => setBufferMinutes(parseInt(e.target.value) || 0)} />
          </div>
          <div style={s.col(0.7)}>
            <label style={s.label}>$/Mile</label>
            <input type="number" step="0.01" min="0" style={s.input} value={mileageRate} onChange={(e) => setMileageRate(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        {/* Caregiver status messages */}
        {cg && !cg.address && (
          <div style={s.msg('warning')}>
            ⚠️ <strong>{cg.firstName} {cg.lastName}</strong> has no home address on file. Go to <strong>Caregivers → Edit</strong> to add their address first, then geocode it here.
          </div>
        )}
        {cg && cg.address && !cgHasCoords && (
          <div style={s.msg('warning')}>
            ⚠️ <strong>{cg.firstName} {cg.lastName}</strong> has an address but it's not geocoded yet.
            {mayPlan && <button style={s.btnSm(SOLID.amber)} onClick={() => geocodeSingle('caregiver', cg.id, cg.address, cg.city, cg.state, cg.zip)}>Geocode Now</button>}
          </div>
        )}
        {cg && cgHasCoords && (
          <div style={{ fontSize: '0.8rem', color: 'var(--hc-ink-soft)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>📍 Home: {[cg.address, cg.city, cg.state, cg.zip].filter(Boolean).join(', ') || 'On file'}</span>
            <button style={s.btn(SOLID.blue, loadingSchedule)} onClick={loadFromSchedule} disabled={loadingSchedule}>
              {loadingSchedule ? '⏳ Loading...' : '📅 Load from Schedule'}
            </button>
          </div>
        )}
      </div>

      <div style={{ ...s.grid2, gridTemplateColumns: optimizedRoute ? 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))' : '1fr' }}>
        {/* ── Left: Client picker + stops ── */}
        <div>
          {/* Client search */}
          <div style={s.card}>
            <div style={s.cardTitle}>➕ Add Clients</div>
            <div style={{ position: 'relative' }}>
              <input type="text" style={s.input} value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search by name or address..."
              />
              {clientSearch.trim() && filteredClients.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderRadius: '0 0 8px 8px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {filteredClients.map((c) => (
                    <div key={c.id} onClick={() => addStopToRoute(c.id)}
                      className="hover:bg-blue-50 dark:hover:bg-slate-800"
                      style={{ padding: '0.55rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--hc-subtle)', transition: 'background 0.1s' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                        {c.firstName} {c.lastName}
                        {!c.latitude && <span className={chip('red')} style={s.badge}>⚠️ No GPS</span>}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>
                        {[c.address, c.city].filter(Boolean).join(', ') || 'No address'}
                        {c.weeklyAuthorizedUnits ? ` · ${c.weeklyAuthorizedUnits} units/wk` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {clientSearch.trim() && filteredClients.length === 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--hc-surface)', border: '1px solid var(--hc-line)', borderRadius: '0 0 8px 8px', padding: '1rem', textAlign: 'center', color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>
                  No matching clients found
                </div>
              )}
            </div>
            {!clientSearch.trim() && (
              <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginTop: '4px' }}>
                Type a name or address to search · {clients.filter((c) => c.isActive !== false).length - routeStops.length} clients available
              </div>
            )}
          </div>

          {/* Stops list */}
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
              <div style={s.cardTitle}>🗺️ Stops ({routeStops.length})</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--hc-blue-ink)' }}>
                {totalUnits} units · {totalHours}h
              </div>
            </div>

            {routeStops.length === 0 ? (
              <div style={s.emptyState}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
                <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>No stops yet</div>
                <div style={{ fontSize: '0.82rem' }}>Search for clients above, or click <strong>"Load from Schedule"</strong> to auto-fill</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', marginBottom: '0.5rem' }}>
                  Drag to reorder · Click Optimize for shortest route
                </div>
                {routeStops.map((stop, idx) => (
                  <div key={stop.clientId} style={s.stopCard}
                    draggable onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()}>
                    {/* Number */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '28px' }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--hc-ink-soft)', lineHeight: 1 }}>⋮⋮</div>
                      <div style={dot(SOLID.blue, 22)}>{idx + 1}</div>
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        {stop.clientName}
                        {!stop.hasCoords && <span className={chip('red')} style={s.badge}>No GPS</span>}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--hc-ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stop.address || 'No address'}
                      </div>
                    </div>
                    {/* Inputs */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--hc-ink-soft)', fontWeight: 700 }}>UNITS</div>
                        <input type="number" min="1" max="96" value={stop.serviceUnits}
                          style={s.inputSm} onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateStop(idx, 'serviceUnits', e.target.value)} />
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', whiteSpace: 'nowrap' }}>
                        {(stop.serviceUnits * 0.25).toFixed(2)}h
                      </div>
                    </div>
                    {/* Remove */}
                    <button onClick={() => removeStop(idx)} aria-label={`Remove ${stop.clientName}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'var(--hc-red-ink)', padding: '2px 4px', borderRadius: '4px' }}>✕</button>
                  </div>
                ))}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                  {mayPlan && <button style={s.btn(SOLID.blue, optimizing)} onClick={optimizeRoute} disabled={optimizing}>
                    {optimizing ? '⏳ Optimizing...' : '🧠 Optimize Route'}
                  </button>}
                  {optimizedRoute && (
                    <>
                      {maySave && <button style={s.btn(SOLID.green, saving)} onClick={() => saveRoute('draft')} disabled={saving}>💾 Save Draft</button>}
                      {maySave && <button style={s.btn(SOLID.violet, saving)} onClick={() => saveRoute('published')} disabled={saving}>📤 Publish</button>}
                      <button className={ghostCls.ink} style={s.btnGhost} onClick={printRouteSheet}>🖨️ Print Sheet</button>
                      {optimizedRoute.googleMapsUrl && (
                        <a href={optimizedRoute.googleMapsUrl} target="_blank" rel="noopener noreferrer" className={ghostCls.orange}
                          style={{ ...s.btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                          📱 Open in Google Maps
                        </a>
                      )}
                    </>
                  )}
                  <button className={ghostCls.red} style={{ ...s.btnGhost, marginLeft: 'auto' }}
                    onClick={() => { setRouteStops([]); setOptimizedRoute(null); setPreOptimizeMiles(null) }}>Clear All</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Right: Optimized results ── */}
        {optimizedRoute && (
          <div>
            {/* Savings banner */}
            {optimizedRoute.summary.milesSaved > 0 && (
              <div style={{ padding: '0.65rem 0.85rem', background: 'var(--hc-success-bg)', borderRadius: '10px', border: '1px solid var(--hc-success-line)', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--hc-success-ink)' }}>
                  ✅ Optimization saves {optimizedRoute.summary.milesSaved} mi &amp; {optimizedRoute.summary.drivingMinutesSaved} min driving
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--hc-success-ink)' }}>
                  💰 ${(optimizedRoute.summary.milesSaved * mileageRate).toFixed(2)} less in mileage
                </span>
              </div>
            )}
            {optimizedRoute.summary.milesSaved <= 0 && (
              <div style={{ padding: '0.65rem 0.85rem', background: 'var(--hc-subtle)', borderRadius: '10px', border: '1px solid var(--hc-line)', marginBottom: '0.85rem', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--hc-ink-soft)' }}>
                  📍 Schedule order is already optimal — no changes needed
                </span>
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
              {([
                { val: `${optimizedRoute.summary.totalMiles}`, lbl: 'Miles', tone: 'blue' },
                { val: `${optimizedRoute.summary.totalStops}`, lbl: 'Stops', tone: 'violet' },
                { val: `${optimizedRoute.summary.totalServiceHours}h`, lbl: 'Service', tone: 'green' },
                { val: `${optimizedRoute.summary.totalDriveMinutes}m`, lbl: 'Driving', tone: 'orange' },
                { val: `$${optimizedRoute.summary.mileageReimbursement}`, lbl: 'Mileage $', tone: 'cyan' },
              ] as Array<{ val: string; lbl: string; tone: Tone }>).map(statTile)}
            </div>

            {/* Current Schedule vs Optimized comparison */}
            {optimizedRoute.preOptimization && optimizedRoute.summary.milesSaved > 0 && (
              <div style={s.card}>
                <div style={s.cardTitle}>📅 Current Schedule Order</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginBottom: '0.5rem' }}>
                  {optimizedRoute.preOptimization.totalMiles} mi · {optimizedRoute.preOptimization.totalDriveMinutes}m driving · ${optimizedRoute.preOptimization.mileageReimbursement} mileage
                </div>
                {/* Mini stop list */}
                {optimizedRoute.preOptimization.stops.map((stop, idx, list) => (
                  <div key={stop.clientId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--hc-subtle)', fontSize: '0.8rem' }}>
                    <div style={{ ...dot('#64748b', 20), fontSize: '0.65rem' }}>{idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{stop.clientName}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', flexShrink: 0 }}>
                      {stop.scheduledStartTime && stop.scheduledEndTime
                        ? <span>{stop.scheduledStartTime} – {stop.scheduledEndTime} <span style={{ color: 'var(--hc-warning-ink)', fontWeight: 600 }}>scheduled</span></span>
                        : <span>{stop.calculatedArrival} – {stop.calculatedDeparture}</span>
                      }
                    </div>
                    {idx < list.length - 1 && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--hc-ink-soft)', flexShrink: 0 }}>
                        → {list[idx + 1]?.milesFromPrevious} mi
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ padding: '0.35rem 0.5rem', fontSize: '0.72rem', color: 'var(--hc-ink-soft)' }}>
                  🏠 Return: {optimizedRoute.preOptimization.returnMiles} mi · ~{optimizedRoute.preOptimization.returnDriveMinutes}m
                </div>
              </div>
            )}

            {/* Optimized Route detail */}
            <div style={s.card} ref={printRef}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={s.cardTitle}>🧠 Optimized Route</div>
                <span className={chip(optimizedRoute.summary.routingSource === 'google_routes_api' ? 'green' : 'amber')} style={s.badge}>
                  {optimizedRoute.summary.routingSource === 'google_routes_api' ? '🗺️ Google Road Miles' : '📐 Estimated'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
                {optimizedRoute.caregiver.name} · {dayName(selectedDate)} · {optimizedRoute.summary.estimatedStartTime} – ~{optimizedRoute.summary.estimatedEndTime}
                {bufferMinutes > 0 && ` · ${bufferMinutes}min buffer between stops`}
              </div>

              {/* Home start */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: 'var(--hc-success-bg)', borderRadius: '8px', marginBottom: '2px' }}>
                <div style={{ ...dot(SOLID.green, 26), fontSize: '0.75rem' }}>🏠</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--hc-success-ink)' }}>Start: Home</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink)' }}>{optimizedRoute.caregiver.homeAddress}</div>
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--hc-success-ink)' }}>{optimizedRoute.summary.estimatedStartTime}</div>
              </div>

              {/* Stops */}
              {optimizedRoute.stops.map((stop, idx) => (
                <Fragment key={stop.clientId}>
                  <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px', height: '28px' }}>
                    <div style={{ width: '2px', height: '100%', background: 'var(--hc-line)', marginRight: '1.5rem' }} />
                    <span style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)' }}>🚗 {stop.milesFromPrevious} mi · ~{stop.driveMinutesFromPrevious} min</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: 'var(--hc-subtle)', borderRadius: '8px', border: '1px solid var(--hc-line)' }}>
                    <div style={dot(SOLID.blue, 26)}>{idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.84rem' }}>{stop.clientName}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stop.address}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--hc-blue-ink)' }}>{stop.calculatedArrival} – {stop.calculatedDeparture}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--hc-ink-soft)' }}>{stop.serviceUnits}u · {stop.serviceMinutes}min</div>
                      {stop.scheduledStartTime && stop.scheduledStartTime !== stop.calculatedArrival && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--hc-warning-ink)' }}>was {stop.scheduledStartTime} – {stop.scheduledEndTime}</div>
                      )}
                    </div>
                  </div>
                </Fragment>
              ))}

              {/* Return home */}
              <div style={{ display: 'flex', alignItems: 'center', paddingLeft: '12px', height: '28px' }}>
                <div style={{ width: '2px', height: '100%', background: 'var(--hc-line)', marginRight: '1.5rem' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)' }}>🚗 {optimizedRoute.summary.returnMiles} mi · ~{optimizedRoute.summary.returnDriveMinutes} min return</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.65rem', background: 'var(--hc-success-bg)', borderRadius: '8px' }}>
                <div style={{ ...dot(SOLID.green, 26), fontSize: '0.75rem' }}>🏠</div>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--hc-success-ink)' }}>Return Home</div>
                <div style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '0.8rem', color: 'var(--hc-success-ink)' }}>~{optimizedRoute.summary.estimatedEndTime}</div>
              </div>

              {/* Mileage summary */}
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--hc-subtle)', borderRadius: '8px', border: '1px solid var(--hc-line)', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span>💰 Mileage: {optimizedRoute.summary.totalMiles} mi × ${mileageRate}/mi = <strong>${optimizedRoute.summary.mileageReimbursement}</strong></span>
                {bufferMinutes > 0 && <span>⏱️ Buffer: {optimizedRoute.summary.totalBufferMinutes} min total</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // RENDER: Daily Overview Tab
  // ════════════════════════════════════════════════════════════
  const renderDaily = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>📅 Daily Overview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
          <button style={s.btnSm(SOLID.gray)} aria-label="Previous day" onClick={() => { const d = parseLocalDate(dailyDate); d.setDate(d.getDate() - 1); setDailyDate(toLocalYMD(d)) }}>◀</button>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} />
          <button style={s.btnSm(SOLID.gray)} aria-label="Next day" onClick={() => { const d = parseLocalDate(dailyDate); d.setDate(d.getDate() + 1); setDailyDate(toLocalYMD(d)) }}>▶</button>
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', fontWeight: 600 }}>{dayName(dailyDate)}</div>
      </div>

      {dailyLoading ? <div style={s.emptyState}>Loading...</div> : dailyRoutes.length === 0 ? (
        <div style={{ ...s.card, ...s.emptyState }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
          <div style={{ fontWeight: 700 }}>No routes for {dayName(dailyDate)}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {([
              { val: dailyRoutes.length, lbl: 'Caregivers', tone: 'blue' },
              { val: dailyRoutes.reduce((t, r) => t + r.visits.length, 0), lbl: 'Visits', tone: 'violet' },
              { val: `${dailyRoutes.reduce((t, r) => t + r.totalMiles, 0).toFixed(2)}`, lbl: 'Total Miles', tone: 'orange' },
              { val: `${(dailyRoutes.reduce((t, r) => t + r.totalServiceMinutes, 0) / 60).toFixed(2)}h`, lbl: 'Service', tone: 'green' },
              { val: `$${(dailyRoutes.reduce((t, r) => t + r.totalMiles, 0) * mileageRate).toFixed(2)}`, lbl: 'Mileage $', tone: 'cyan' },
            ] as Array<{ val: string | number; lbl: string; tone: Tone }>).map(statTile)}
          </div>

          {dailyRoutes.map((route) => (
            <div key={route.caregiverId} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{route.caregiverName}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)' }}>{route.visits.length} visits · {route.homeAddress || 'No home address'}</div>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  {([
                    { v: `${route.totalMiles} mi`, tone: 'orange' },
                    { v: `${(route.totalServiceMinutes / 60).toFixed(2)}h`, tone: 'green' },
                    { v: `~${route.totalDriveMinutes}m`, tone: 'blue' },
                  ] as Array<{ v: string; tone: Tone }>).map((m, i) => <div key={i} style={{ textAlign: 'center' }}><div className={INK[m.tone]} style={{ fontWeight: 800, fontSize: '1.05rem' }}>{m.v}</div></div>)}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>#</th><th style={s.th}>Client</th><th style={s.th}>Address</th>
                    <th style={s.th}>Time</th><th style={s.th}>Units</th><th style={s.th}>Miles</th>
                  </tr></thead>
                  <tbody>
                    {route.visits.map((v, idx) => (
                      <tr key={idx}>
                        <td style={s.td}><span className={chip('blue')} style={s.badge}>{idx + 1}</span></td>
                        <td style={{ ...s.td, fontWeight: 600 }}>{v.clientName}</td>
                        <td style={{ ...s.td, fontSize: '0.78rem', color: 'var(--hc-ink-soft)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.address || '—'}</td>
                        <td style={s.td}>{v.startTime?.slice(0, 5)} – {v.endTime?.slice(0, 5)}</td>
                        <td style={s.td}>{v.serviceUnits}</td>
                        <td className={INK.orange} style={{ ...s.td, fontWeight: 700 }}>{v.milesFromPrevious}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // RENDER: Hours Dashboard Tab
  // ════════════════════════════════════════════════════════════
  const renderHours = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>⏱️ Hours Dashboard</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursStartDate} onChange={(e) => setHoursStartDate(e.target.value)} />
          <span style={{ color: 'var(--hc-ink-soft)', fontSize: '0.82rem' }}>to</span>
          <input type="date" style={{ ...s.input, width: 'auto' }} value={hoursEndDate} onChange={(e) => setHoursEndDate(e.target.value)} />
          <button style={s.btnSm(SOLID.blue)} aria-label="Refresh" onClick={loadHoursSummary}>↻</button>
        </div>
      </div>

      {hoursLoading ? <div style={s.emptyState}>Loading...</div> : hoursData ? (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
            {([
              { val: hoursData.totals.totalCaregivers, lbl: 'Caregivers', tone: 'blue' },
              { val: hoursData.totals.totalScheduledHours.toFixed(2), lbl: 'Scheduled', tone: 'violet' },
              { val: hoursData.totals.totalClockedHours.toFixed(2), lbl: 'Clocked', tone: 'green' },
              { val: hoursData.totals.totalMiles.toFixed(0), lbl: 'Miles', tone: 'orange' },
              { val: `${hoursData.totals.totalCompletedVisits}/${hoursData.totals.totalScheduledVisits}`, lbl: 'Visits', tone: 'cyan' },
              { val: hoursData.totals.activeCaregivers, lbl: 'Active Now', tone: 'green' },
            ] as Array<{ val: string | number; lbl: string; tone: Tone }>).map(statTile)}
          </div>

          <div style={s.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Caregiver</th><th style={s.th}>Scheduled</th><th style={s.th}>Clocked</th>
                  <th style={s.th}>Remaining</th><th style={s.th}>OT</th>
                  <th style={{ ...s.th, minWidth: '180px' }}>Utilization</th>
                  <th style={s.th}>Visits</th><th style={s.th}>Miles</th><th style={s.th}>Status</th>
                </tr></thead>
                <tbody>
                  {hoursData.caregivers.map((row) => {
                    const pct = Math.min(row.utilizationPct, 100)
                    const barTone: Tone = pct >= 90 ? 'red' : pct >= 70 ? 'orange' : pct >= 40 ? 'blue' : 'gray'
                    return (
                      <tr key={row.id}>
                        <td style={{ ...s.td, fontWeight: 700 }}>
                          {row.name}
                          {row.activeShift && <span className={chip('green')} style={{ ...s.badge, marginLeft: '0.4rem' }}>🔴 LIVE</span>}
                        </td>
                        <td style={{ ...s.td, fontWeight: 700 }}>{row.scheduledHours}h</td>
                        <td style={{ ...s.td, fontWeight: 700, color: 'var(--hc-green-ink)' }}>{row.clockedHours}h</td>
                        <td style={s.td}>{row.remainingHours}h</td>
                        <td style={{ ...s.td, color: row.overtimeHours > 0 ? 'var(--hc-red-ink)' : 'var(--hc-ink-soft)', fontWeight: row.overtimeHours > 0 ? 700 : 400 }}>
                          {row.overtimeHours > 0 ? `${row.overtimeHours}h ⚠️` : '—'}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'var(--hc-line)', overflow: 'hidden' }}>
                              <div className={FILL[barTone]} style={{ height: '100%', width: `${pct}%`, borderRadius: '4px', transition: 'width 0.3s' }} />
                            </div>
                            <span className={barTone === 'gray' ? undefined : INK[barTone]} style={{ fontSize: '0.75rem', fontWeight: 700, minWidth: '32px', color: barTone === 'gray' ? 'var(--hc-ink-soft)' : undefined }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={s.td}>{row.completedVisits}/{row.scheduledVisits}</td>
                        <td className={INK.orange} style={{ ...s.td, fontWeight: 600 }}>{row.totalMiles > 0 ? `${row.totalMiles} mi` : '—'}</td>
                        <td style={s.td}>
                          {row.activeShift ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--hc-green-ink)' }}>
                              w/ {row.activeShift.clientName}
                            </span>
                          ) : row.clockedHours > 0 ? (
                            <span className={chip('blue')} style={s.badge}>Done</span>
                          ) : (
                            <span style={{ color: 'var(--hc-ink-soft)', fontSize: '0.78rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // RENDER: Saved Routes Tab
  // ════════════════════════════════════════════════════════════
  const renderSaved = () => (
    <div>
      <div style={{ ...s.card, display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={s.cardTitle}>📁 Saved Routes</div>
        <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <select style={{ ...s.select, width: 'auto' }} value={savedFilter.status} onChange={(e) => setSavedFilter((p) => ({ ...p, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="draft">Drafts</option>
            <option value="published">Published</option>
          </select>
          <select style={{ ...s.select, width: 'auto' }} value={savedFilter.caregiverId} onChange={(e) => setSavedFilter((p) => ({ ...p, caregiverId: e.target.value }))}>
            <option value="">All caregivers</option>
            {caregivers.filter((c) => c.isActive !== false).map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </select>
          <button style={s.btnSm(SOLID.blue)} aria-label="Refresh" onClick={loadSavedRoutes}>↻</button>
        </div>
      </div>

      {savedRoutesLoading ? <div style={s.emptyState}>Loading...</div> : savedRoutes.length === 0 ? (
        <div style={{ ...s.card, ...s.emptyState }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📁</div>
          <div style={{ fontWeight: 700 }}>No saved routes found</div>
          <div style={{ fontSize: '0.82rem' }}>Routes you save from the Route Planner will appear here</div>
        </div>
      ) : (
        <div style={s.card}>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Date</th><th style={s.th}>Caregiver</th><th style={s.th}>Stops</th>
                <th style={s.th}>Miles</th><th style={s.th}>Service</th><th style={s.th}>Drive</th>
                <th style={s.th}>Status</th><th style={s.th}>Actions</th>
              </tr></thead>
              <tbody>
                {savedRoutes.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...s.td, fontWeight: 600 }}>{r.routeDate}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{r.caregiverName}</td>
                    <td style={s.td}>{r.stopCount || r.actualStopCount}</td>
                    <td className={INK.orange} style={{ ...s.td, fontWeight: 700 }}>{parseFloat(String(r.totalMiles ?? 0)).toFixed(2)} mi</td>
                    <td style={s.td}>{r.totalServiceMinutes ? `${(r.totalServiceMinutes / 60).toFixed(2)}h` : '—'}</td>
                    <td style={s.td}>{r.totalDriveMinutes ? `${r.totalDriveMinutes}m` : '—'}</td>
                    <td style={s.td}>
                      <span className={chip(r.status === 'published' ? 'green' : 'amber')} style={s.badge}>
                        {r.status}
                      </span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button style={s.btnSm(SOLID.blue)} onClick={() => loadSavedPlanIntoPlanner(r.id)}>Load</button>
                        {mayDelete && <button style={s.btnSm(SOLID.red)} aria-label="Delete saved route" onClick={() => deleteSavedPlan(r.id)}>✕</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )

  // ════════════════════════════════════════════════════════════
  // RENDER: GPS & Geofence Tab
  // ════════════════════════════════════════════════════════════
  const renderGeofence = () => {
    const clientsWithoutCoords = clients.filter((c) => c.isActive !== false && (!c.latitude || !c.longitude))
    const cgWithoutCoords = caregivers.filter((c) => c.isActive !== false && (!c.latitude || !c.longitude))
    const cgWithoutAddress = caregivers.filter((c) => c.isActive !== false && !c.address)

    return (
      <div>
        {/* Geocoding */}
        <div style={s.card}>
          <div style={s.cardTitle}>🌐 Address Geocoding</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
            Convert addresses to GPS coordinates. Required for route optimization and geofencing.
          </div>

          {cgWithoutAddress.length > 0 && (
            <div style={s.msg('warning')}>
              🏠 {cgWithoutAddress.length} caregiver(s) have <strong>no home address</strong> on file — add via Caregivers → Edit before geocoding:
              <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                {cgWithoutAddress.map((c) => c.firstName + ' ' + c.lastName).join(', ')}
              </div>
            </div>
          )}

          {(clientsWithoutCoords.length > 0 || cgWithoutCoords.length > 0) && (
            <div style={s.msg('warning')}>
              ⚠️ {clientsWithoutCoords.length} client(s) and {cgWithoutCoords.length} caregiver(s) need geocoding
            </div>
          )}

          {mayPlan && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button style={s.btn(SOLID.blue, geocoding)} onClick={() => geocodeAll('clients')} disabled={geocoding}>
              {geocoding ? '⏳ Geocoding...' : `📍 Geocode Clients (${clientsWithoutCoords.length} missing)`}
            </button>
            <button style={s.btn(SOLID.violet, geocoding)} onClick={() => geocodeAll('caregivers')} disabled={geocoding}>
              {geocoding ? '⏳ Geocoding...' : `📍 Geocode Caregivers (${cgWithoutCoords.length} missing)`}
            </button>
          </div>}

          {geocodeResults && (
            <div style={{ fontSize: '0.82rem', padding: '0.6rem', background: 'var(--hc-subtle)', borderRadius: '8px', border: '1px solid var(--hc-line)' }}>
              ✅ {geocodeResults.success} geocoded · ❌ {geocodeResults.failed} failed · Source: {geocodeResults.source}
              {(geocodeResults.errors?.length ?? 0) > 0 && (
                <div style={{ marginTop: '0.5rem', color: 'var(--hc-red-ink)' }}>
                  {(geocodeResults.errors || []).slice(0, 5).map((e, i) => (
                    <div key={i} style={{ fontSize: '0.75rem' }}>• {e.address}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Geofence setup */}
        {mayFence && (
          <div style={s.card}>
            <div style={s.cardTitle}>📍 Geofence Configuration</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', marginBottom: '0.75rem' }}>
              Set up automatic clock-in/out when caregivers arrive at or leave client locations.
            </div>

            {!editGeofence ? (
              <div style={s.row}>
                <div style={s.col(2)}>
                  <label style={s.label}>Select Client</label>
                  <select style={s.select} onChange={(e) => {
                    if (!e.target.value) return
                    const cl = clients.find((c) => c.id === e.target.value)
                    const existing = geofenceSettings.find((g) => g.clientId === e.target.value)
                    setEditGeofence({
                      clientId: e.target.value, clientName: cl ? `${cl.firstName} ${cl.lastName}` : '',
                      radiusFeet: existing?.radiusFeet || 300,
                      autoClockIn: existing?.autoClockIn ?? true,
                      autoClockOut: existing?.autoClockOut ?? true,
                      requireGps: existing?.requireGps ?? true,
                      notifyAdminOnOverride: existing?.notifyAdminOnOverride ?? true,
                    })
                    e.target.value = ''
                  }}>
                    <option value="">— Select client to configure —</option>
                    {clients.filter((c) => c.isActive !== false).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} {c.latitude ? '📍' : '⚠️'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div style={{ background: 'var(--hc-subtle)', borderRadius: '10px', padding: '1rem', border: '1px solid var(--hc-line)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                  ✏️ {editGeofence.clientName || 'Configure Geofence'}
                </div>
                <div style={s.row}>
                  <div style={s.col(1)}>
                    <label style={s.label}>Radius (feet)</label>
                    <input type="number" min="50" max="1000" style={s.input} value={editGeofence.radiusFeet}
                      onChange={(e) => setEditGeofence((p) => (p ? { ...p, radiusFeet: parseInt(e.target.value) || 300 } : p))} />
                    <div style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)', marginTop: '2px' }}>200ft = apartment, 300ft = house, 500ft = rural</div>
                  </div>
                  <div style={s.col(2)}>
                    <label style={s.label}>Options</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {([
                        { key: 'autoClockIn', label: 'Auto clock-in when entering geofence' },
                        { key: 'autoClockOut', label: 'Auto clock-out when leaving geofence' },
                        { key: 'requireGps', label: 'Require GPS (block clock-in without location)' },
                        { key: 'notifyAdminOnOverride', label: 'Notify admin on manual override' },
                      ] as Array<{ key: GeofenceFlag; label: string }>).map((opt) => (
                        <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.83rem' }}>
                          <input type="checkbox" checked={editGeofence[opt.key]}
                            onChange={(e) => setEditGeofence((p) => (p ? { ...p, [opt.key]: e.target.checked } : p))} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button style={s.btn(SOLID.green)} onClick={() => saveGeofence(editGeofence)}>Save</button>
                  <button className={ghostCls.soft} style={s.btnGhost} onClick={() => setEditGeofence(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Existing settings table */}
        <div style={s.card}>
          <div style={s.cardTitle}>📋 Geofence Settings ({geofenceSettings.length})</div>
          {geofenceLoading ? <div style={s.emptyState}>Loading...</div> : geofenceSettings.length === 0 ? (
            <div style={s.emptyState}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📍</div>
              <div style={{ fontWeight: 700 }}>No geofences yet</div>
              <div style={{ fontSize: '0.82rem' }}>Select a client above to set up auto clock-in/out</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Client</th><th style={s.th}>Radius</th>
                  <th style={s.th}>Auto In</th><th style={s.th}>Auto Out</th>
                  <th style={s.th}>GPS Req</th><th style={s.th}>Actions</th>
                </tr></thead>
                <tbody>
                  {geofenceSettings.map((gs) => (
                    <tr key={gs.id}>
                      <td style={{ ...s.td, fontWeight: 600 }}>
                        {gs.firstName} {gs.lastName}
                        <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)' }}>{[gs.address, gs.city].filter(Boolean).join(', ')}</div>
                      </td>
                      <td style={{ ...s.td, fontWeight: 700 }}>{gs.radiusFeet} ft</td>
                      <td style={s.td}>{gs.autoClockIn ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.autoClockOut ? '✅' : '❌'}</td>
                      <td style={s.td}>{gs.requireGps ? '✅' : '❌'}</td>
                      <td style={s.td}>
                        {mayFence && (
                          <button style={s.btnSm(SOLID.blue)} onClick={() => setEditGeofence({
                            clientId: gs.clientId, clientName: `${gs.firstName} ${gs.lastName}`,
                            radiusFeet: gs.radiusFeet, autoClockIn: gs.autoClockIn,
                            autoClockOut: gs.autoClockOut, requireGps: gs.requireGps,
                            notifyAdminOnOverride: gs.notifyAdminOnOverride,
                          })}>Edit</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ════════════════════════════════════════════════════════════
  // Main Render
  // ════════════════════════════════════════════════════════════
  if (loading) return <div style={{ ...s.page, textAlign: 'center', padding: '3rem', color: 'var(--hc-ink-soft)' }}>Loading route optimizer...</div>

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>🗺️ Route & Schedule Optimizer</h1>
        {apiStatus && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.7rem',
            borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700,
            background: apiStatus.googleApiKeyConfigured ? 'var(--hc-success-bg)' : 'var(--hc-warning-bg)',
            color: apiStatus.googleApiKeyConfigured ? 'var(--hc-success-ink)' : 'var(--hc-warning-ink)',
            border: `1px solid ${apiStatus.googleApiKeyConfigured ? 'var(--hc-success-line)' : 'var(--hc-warning-line)'}`,
          }}>
            {apiStatus.googleApiKeyConfigured ? '🟢 Google Routes API' : '🟡 Haversine Estimates'}
          </div>
        )}
      </div>

      {/* Message */}
      {message.text && <div style={s.msg(message.type)}>{message.text}</div>}

      {/* Tabs */}
      <div style={s.tabs}>
        {([
          { id: 'planner', icon: '🧭', label: 'Route Planner' },
          { id: 'daily', icon: '📅', label: 'Daily Overview' },
          { id: 'hours', icon: '⏱️', label: 'Hours' },
          { id: 'saved', icon: '📁', label: 'Saved Routes' },
          { id: 'geofence', icon: '📍', label: 'GPS & Geofence' },
        ] as Array<{ id: Tab; icon: string; label: string }>).map((t) => (
          <button key={t.id} style={s.tab(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'planner' && renderPlanner()}
      {activeTab === 'daily' && renderDaily()}
      {activeTab === 'hours' && renderHours()}
      {activeTab === 'saved' && renderSaved()}
      {activeTab === 'geofence' && renderGeofence()}
    </div>
  )
}

export default RouteOptimizer
