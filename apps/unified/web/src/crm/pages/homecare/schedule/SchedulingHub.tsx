// Moved from templates/crm-homecare/frontend/src/components/admin/SchedulingHub.tsx — the agency's Schedule Hub at
// /crm/scheduling (the template's AdminDashboard section 'scheduling'): the Schedule tab (the weekly grid, the month
// calendar, the week view a Coverage "Fix It" opens), Bookings, Tools (coverage, conflict heatmap, the two optimizers)
// and Staffing (open shifts, swaps and absences, reschedule requests, availability), with the full-page New Schedule form.
//
// Server — every reply read from its route (camelCase rows; lists are { data, pagination }):
//   /api/scheduling/week-view | coverage-overview | conflict-heatmap | suggest-caregivers   scheduling/schedulingHub.ts
//   /api/scheduling/check-weekly-hours | check-travel-time                                   scheduling/schedulingHub.ts
//   /api/schedules/caregiver/:id (list), POST /api/schedules, DELETE /api/schedules/:id,
//   /api/schedules/:id/reassign | suspend | resume                                           scheduling/schedules.ts
//   /api/schedules-all (list), PUT /api/schedules-all/:id                                     scheduling/schedulesAll.ts
//   POST /api/schedules-enhanced                                                               scheduling/schedulesEnhanced.ts
//   /api/open-shifts (list), POST, /:id/approve | reject | cancel                              scheduling/openShifts.ts
//   /api/shift-swaps (list), /:id/approve | reject                                             scheduling/shiftSwaps.ts
//   /api/absences (list), POST, DELETE                                                         scheduling/absences.ts
//   /api/visit-change-requests (list), PUT /:id/resolve                                        visits/visitChangeRequests.ts
//   /api/caregivers (list), /api/caregivers/:id/availability | blackout-dates                  hr/caregivers.ts
//   DELETE /api/blackout-dates/:id                                                             scheduling/blackoutDates.ts
//   /api/clients (list)                                                                        clients/clients.ts
//   /api/prospects (list of `lead` rows), POST, /:id/convert; /api/prospect-appointments       clients/prospects.ts
//   /api/dashboard/caregiver-patterns/:id                                                      planning/dashboard.ts
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useConfirm, usePrompt, useToast } from '../../../../shared'
import { api, rows, errorMessage } from '../lib/http'
import { getTodayCT } from '../lib/timezone'
import { formatDate } from '../lib/datetime'
import { isBiweeklyOn } from '../lib/biweekly'
import { endsBeforeStart, shiftTimesError } from '../lib/shiftTimes'
import { toLocalYMD, parseLocalDate, formatDate as formatDay } from '../lib/date'
import DragDropScheduler from './DragDropScheduler'
import ScheduleOptimizer from './ScheduleOptimizer'
import RosterOptimizer from './RosterOptimizer'
import MakeShiftAvailableModal, { type OfferedVisit } from './MakeShiftAvailableModal'
import { C, FILL, MARKS, dialog, field, overlay, pill, tint, type Tone } from './theme'
import { fullName, isRecurringRow, type Caregiver, type Client, type SavedReply, type ScheduleRow } from './types'

function getWeekStart(date: Date | string): Date {
  const d = parseLocalDate(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

// ── Replies ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A prospect is a `lead` row (GET /api/prospects): its name is homeownerName; open while not converted / dismissed. */
interface Lead { id: string; homeownerName: string | null; phone?: string | null; email?: string | null; status: string }
/** GET /api/prospect-appointments?month&year: { id, leadId, scheduledDate, scheduledTime, notes, status, homeownerName }. */
interface ProspectAppt { id: string; leadId: string | null; scheduledDate: string; scheduledTime: string | null; notes: string | null; status: string; homeownerName: string | null }
/** One occurrence of the week view (server/data/homecareScheduling.ts weekOccurrences, plus isRecurring). */
interface WeekOcc { id: string; caregiverId: string; clientId: string; startTime: string; endTime: string; isRecurring: boolean }
interface WeekView { weekStart: string; weekEnd: string; caregivers: Array<{ caregiver: { id: string; firstName: string; lastName: string }; days: Record<string, WeekOcc[]> }> }
interface Coverage {
  caregivers: Array<{ id: string; name: string; maxHours: number; scheduledHours: number; utilizationPercent: number }>
  underScheduledClients: Array<{ id: string; name: string; authorizedUnits: number; scheduledUnits: number; shortfallUnits: number; coveragePercent: number }>
  summary: { totalCaregivers: number; totalScheduledHours: string; underScheduledClientCount: number; totalShortfallUnits: number; totalShortfallHours: string }
}
interface Heatmap { weekStart: string; caregivers: Array<{ id: string; firstName: string; lastName: string; maxHoursPerWeek: number; total: number; days: Array<{ date: string; hours: number; shifts: number }> }> }
interface Suggestion { id: string; firstName: string; lastName: string; score: number; tier: string; reasons?: string[] }
interface OtCheck { currentWeeklyHours: number; proposedHours: number; projectedHours: number; overtimeHours: number; warnings: string[] }
interface TravelCheck { hasTravelConflict: boolean; adjacentShifts: Array<{ clientName: string; distanceMiles: number; estimatedDriveMinutes: number; gapMinutes: number; isInsufficient: boolean }> }
interface Patterns { overallReliability: number; periodMonths: number; riskDays: Array<{ day: string; reliabilityPct: number; absences: number; noShows: number; lateArrivals: number }> }
interface OpenShift {
  id: string; status: string; urgency: string | null; notes: string | null; shiftDate: string | null; startTime: string; endTime: string
  clientFirstName: string | null; clientLastName: string | null; claimedByFirst: string | null; claimedByLast: string | null; offeredTo: string | null
}
interface Swap {
  id: string; status: string; shiftDate: string | null; startTime: string | null; endTime: string | null
  clientFirst: string | null; clientLast: string | null; requesterFirst: string | null; requesterLast: string | null; targetFirst: string | null; targetLast: string | null
}
interface ChangeRequest {
  id: string; requestType: string; requestedBy: string | null; visitDate: string | null; originalStartTime: string | null; originalEndTime: string | null
  proposedDate: string | null; proposedStartTime: string | null; proposedEndTime: string | null; requestReason: string | null; cancelReason: string | null
  clientFirstName: string | null; clientLastName: string | null; caregiverFirstName: string | null; caregiverLastName: string | null
}
interface Absence { id: string; caregiverId: string; date: string; type: string | null; reason: string | null }
interface Blackout { id: string; startDate: string; endDate: string; reason: string | null }
type AvailRow = Record<string, unknown> & { status?: string | null; maxHoursPerWeek?: number | null }

// ── Local state shapes ───────────────────────────────────────────────────────────────────────────────────────────────

type ScheduleKind = 'one-time' | 'multi-day' | 'recurring' | 'bi-weekly'
type EditScope = 'this' | 'following' | 'all'
interface CreateForm {
  caregiverId: string; clientId: string; scheduleType: ScheduleKind; dayOfWeek: string; date: string
  startTime: string; endTime: string; notes: string; endDate: string; isTraining: boolean; overnight: boolean
}
interface EditModal {
  id: string; clientId: string; caregiverId: string | null; dayOfWeek: string; date: string; startTime: string; endTime: string
  notes: string; scheduleType: 'recurring' | 'one-time'; frequency: string; anchorDate: string | null; scope?: EditScope
  editDate: string; suspendedFrom: string | null; overnight: boolean; suspendFromDate?: string
}
type AvailForm = Record<string, string | number | boolean>
type MainTab = 'schedule' | 'bookings' | 'tools' | 'staffing'

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Mon' }, { key: 'tuesday', label: 'Tue' }, { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' }, { key: 'friday', label: 'Fri' }, { key: 'saturday', label: 'Sat' }, { key: 'sunday', label: 'Sun' },
]
const DEFAULT_AVAIL: AvailForm = {
  status: 'available', maxHoursPerWeek: 40,
  mondayAvailable: true, mondayStartTime: '08:00', mondayEndTime: '17:00',
  tuesdayAvailable: true, tuesdayStartTime: '08:00', tuesdayEndTime: '17:00',
  wednesdayAvailable: true, wednesdayStartTime: '08:00', wednesdayEndTime: '17:00',
  thursdayAvailable: true, thursdayStartTime: '08:00', thursdayEndTime: '17:00',
  fridayAvailable: true, fridayStartTime: '08:00', fridayEndTime: '17:00',
  saturdayAvailable: false, saturdayStartTime: '08:00', saturdayEndTime: '17:00',
  sundayAvailable: false, sundayStartTime: '08:00', sundayEndTime: '17:00',
}
const SHIFT_PRESETS = [
  { label: 'Morning (8–12)', start: '08:00', end: '12:00' },
  { label: 'Afternoon (12–4)', start: '12:00', end: '16:00' },
  { label: 'Evening (4–8)', start: '16:00', end: '20:00' },
  { label: 'Full Day (8–4)', start: '08:00', end: '16:00' },
  { label: 'Half AM (8–12)', start: '08:00', end: '12:00' },
  { label: 'Half PM (1–5)', start: '13:00', end: '17:00' },
]
const TIERS: Record<string, { tone: Tone; label: string }> = {
  excellent: { tone: 'green', label: '★ Excellent' },
  good: { tone: 'blue', label: '✓ Good' },
  maybe: { tone: 'amber', label: '? Maybe' },
  avoid: { tone: 'red', label: '⚠ Avoid' },
}
const tierStyle = (tier: string) => TIERS[tier] || TIERS.maybe

// A prospect is open until it is converted or dismissed (the lead table's statuses: new, contacted, converted, dismissed).
const isOpenLead = (p: Lead) => p.status !== 'converted' && p.status !== 'dismissed'

const formatTime = (t: string | null | undefined): string => {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
}
const getDayName = (dow: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] || 'Unknown'
const calculateHours = (start: string, end: string): string => {
  if (!start || !end) return '0'
  const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
  let mins = toMin(end) - toMin(start)
  if (mins <= 0) mins += 24 * 60
  return Number(mins / 60 || 0).toFixed(2)
}

const lbl: CSSProperties = { display: 'block', marginBottom: '0.3rem', fontWeight: 600, fontSize: '0.85rem' }
const lbl9: CSSProperties = { display: 'block', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }
const bigField: CSSProperties = { width: '100%', padding: '0.6rem', borderRadius: '8px', border: `2px solid ${C.line}`, fontSize: '0.95rem' }
const statCard: CSSProperties = { padding: '0.75rem', textAlign: 'center' }
const statVal = (color: string): CSSProperties => ({ fontSize: '1.75rem', fontWeight: 800, color, lineHeight: 1 })
const statLabel: CSSProperties = { fontSize: '0.72rem', color: C.muted, marginTop: '0.25rem' }

const SchedulingHub = () => {
  const toast = useToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const { hasFeature } = useAuth()

  // ── Navigation ──
  const [mainTab, setMainTab] = useState<MainTab>('schedule')
  const [scheduleView, setScheduleView] = useState<'grid' | 'month' | 'week'>('grid')
  const [toolsTab, setToolsTab] = useState<'coverage' | 'heatmap' | 'optimizer' | 'roster'>('coverage')
  const [staffingTab, setStaffingTab] = useState<'open-shifts' | 'swaps' | 'reschedules' | 'availability'>('open-shifts')
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  // ── Shared data ──
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  // The template showed its own corner banner; the app's toasts carry the same words now.
  const showMsg = (text: string, type: 'success' | 'error' | 'warning' = 'success') => { toast[type](text) }

  // ── The full-page create form ──
  const [createPanelOpen, setCreatePanelOpen] = useState(false)
  const [selectedCaregiverId, setSelectedCaregiverId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [caregiverSchedules, setCaregiverSchedules] = useState<ScheduleRow[]>([])
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState<CreateForm>({
    caregiverId: '', clientId: '', scheduleType: 'one-time', dayOfWeek: '', date: getTodayCT(),
    startTime: '09:00', endTime: '13:00', notes: '', endDate: '', isTraining: false, overnight: false,
  })
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [conflicts, setConflicts] = useState<Array<{ day: number }>>([])
  const [otWarning, setOtWarning] = useState<OtCheck | null>(null)
  const [travelWarning, setTravelWarning] = useState<TravelCheck | null>(null)
  const [cgPatterns, setCgPatterns] = useState<Patterns | null>(null)
  // Bi-weekly "first on" date. '' = the Start Date. The server aligns whatever is sent to each selected weekday, so it
  // need not be a Sunday (a this-week's-Sunday default put a Sat+Sun pair on two different fortnights).
  const [biWeeklyAnchorDate, setBiWeeklyAnchorDate] = useState('')

  // ── Edit box ──
  const [editModal, setEditModal] = useState<EditModal | null>(null)
  const [makeAvailableModal, setMakeAvailableModal] = useState<{ schedule: OfferedVisit; date: string; clientName: string; caregiverName: string } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [suspendBusy, setSuspendBusy] = useState(false)

  // ── Week view ──
  // The week view is always this week: the template had no control to move it (its navigateWeek was never wired).
  const [weekOf] = useState(toLocalYMD(getWeekStart(new Date())))
  const [weekData, setWeekData] = useState<WeekView | null>(null)
  const [reassignModal, setReassignModal] = useState<{ schedule: WeekOcc; currentCaregiver: { id: string; firstName: string; lastName: string } } | null>(null)
  const [reassignReason, setReassignReason] = useState('admin_decision')

  // ── Month calendar ──
  const [calCurrentDate, setCalCurrentDate] = useState(new Date())
  const [calSchedules, setCalSchedules] = useState<ScheduleRow[]>([])
  const [calSelectedDay, setCalSelectedDay] = useState<number | null>(null)
  const [calDaySchedules, setCalDaySchedules] = useState<ScheduleRow[]>([])
  const [calFilterCaregiver, setCalFilterCaregiver] = useState('')

  // ── Prospects ──
  const [prospects, setProspects] = useState<Lead[]>([])
  const [prospectAppts, setProspectAppts] = useState<ProspectAppt[]>([])
  const [showProspectForm, setShowProspectForm] = useState(false)
  const [prospectForm, setProspectForm] = useState({ firstName: '', lastName: '', phone: '', notes: '' })
  const [showProspectApptForm, setShowProspectApptForm] = useState(false)
  const [prospectApptForm, setProspectApptForm] = useState({ prospectId: '', appointmentDate: '', startTime: '10:00', location: '' })
  const [prospectSaving, setProspectSaving] = useState(false)

  // ── Coverage ──
  const [coverageData, setCoverageData] = useState<Coverage | null>(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageWeekOf, setCoverageWeekOf] = useState(toLocalYMD(getWeekStart(new Date())))

  // ── Caregiver suggestions (create form) ──
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)

  // ── Conflict heatmap ──
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null)
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  const [heatmapWeekOf, setHeatmapWeekOf] = useState(toLocalYMD(getWeekStart(new Date())))
  const loadHeatmap = async () => {
    setHeatmapLoading(true)
    try { setHeatmap(await api.get('/api/scheduling/conflict-heatmap', { weekOf: heatmapWeekOf }) as Heatmap) }
    catch (e) { console.error(e) }
    finally { setHeatmapLoading(false) }
  }
  useEffect(() => {
    if (mainTab === 'tools' && toolsTab === 'heatmap') loadHeatmap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, toolsTab, heatmapWeekOf])

  // ── Open shifts ──
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([])
  const [openShiftsLoading, setOpenShiftsLoading] = useState(false)
  const [openShiftFilter, setOpenShiftFilter] = useState('active') // open + accepted-awaiting-approval
  const [showCreateShift, setShowCreateShift] = useState(false)
  const [createShiftPreFill, setCreateShiftPreFill] = useState<{ clientId?: string; date?: string; start?: string; end?: string }>({})

  // ── Swaps ──
  const [swaps, setSwaps] = useState<Swap[]>([])
  const [swapsLoading, setSwapsLoading] = useState(false)
  const [swapFilter, setSwapFilter] = useState('')

  // ── Reschedule requests (caregiver- and client-originated) ──
  const [reschedReqs, setReschedReqs] = useState<ChangeRequest[]>([])
  const [reschedLoading, setReschedLoading] = useState(false)
  const [reschedBusy, setReschedBusy] = useState<string | null>(null)

  // ── Absences ──
  const [absences, setAbsences] = useState<Absence[]>([])
  const [absencesLoading, setAbsencesLoading] = useState(false)
  const [showAbsenceForm, setShowAbsenceForm] = useState(false)
  const [absenceForm, setAbsenceForm] = useState({ caregiverId: '', date: '', type: 'call_out', reason: '' })
  const [pendingAbsenceShift, setPendingAbsenceShift] = useState<{ date: string; schedules: ScheduleRow[] } | null>(null)

  // ── Availability ──
  const [availCaregiver, setAvailCaregiver] = useState('')
  const [blackoutDates, setBlackoutDates] = useState<Blackout[]>([])
  const [showBlackoutForm, setShowBlackoutForm] = useState(false)
  const [newBlackout, setNewBlackout] = useState({ startDate: '', endDate: '', reason: '' })
  const [availForm, setAvailForm] = useState<AvailForm>(DEFAULT_AVAIL)

  // ═══ LOADING ═══

  useEffect(() => {
    loadCoreData()
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (scheduleView === 'week') loadWeekView() }, [scheduleView, weekOf])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (scheduleView === 'month') loadCalendarData() }, [scheduleView, calCurrentDate])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mainTab === 'tools' && toolsTab === 'coverage') loadCoverage() }, [mainTab, toolsTab, coverageWeekOf])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mainTab === 'staffing' && staffingTab === 'open-shifts') loadOpenShifts() }, [mainTab, staffingTab, openShiftFilter])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mainTab === 'staffing' && staffingTab === 'swaps') { loadSwaps(); loadAbsences() } }, [mainTab, staffingTab, swapFilter])
  // Pending reschedules load with the Staffing tab itself, so the badge is right before anyone opens the sub-tab — a
  // request nobody sees is a caregiver assuming silence meant yes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mainTab === 'staffing') loadReschedules() }, [mainTab, staffingTab])

  // Scheduling warnings: overtime and travel time. (The template also asked GET /api/authorizations/check/:clientId,
  // which neither its server nor this one has; it always answered 404 and its box never showed. The authorization
  // advice arrives with the save instead: authWarnings.)
  useEffect(() => {
    if (!formData.caregiverId || !formData.date || !formData.startTime || !formData.endTime || !showForm) { setOtWarning(null); setTravelWarning(null); return }
    const slot = { caregiverId: formData.caregiverId, date: formData.date, startTime: formData.startTime, endTime: formData.endTime }
    api.post('/api/scheduling/check-weekly-hours', slot).then((d: OtCheck) => setOtWarning(d)).catch(() => setOtWarning(null))
    if (formData.clientId) {
      api.post('/api/scheduling/check-travel-time', { ...slot, clientId: formData.clientId }).then((d: TravelCheck) => setTravelWarning(d)).catch(() => setTravelWarning(null))
    }
  }, [formData.caregiverId, formData.clientId, formData.date, formData.startTime, formData.endTime, showForm])

  // Schedule saves return authWarnings (authorization balance, etc). They are advisory — the shift IS created — so they
  // ride on the success message as a warning: a red "No active authorization" over a 201 read as a failure (Run 5).
  const showSaved = (text: string, body: SavedReply | null | undefined, failed = false) => {
    const w = body?.authWarnings
    if (Array.isArray(w) && w.length) showMsg(`${text} ⚠️ ${w[0]}`, failed ? 'error' : 'warning')
    else showMsg(text, failed ? 'error' : 'success')
  }

  // Every caregiver and client, not the lists' first page of 50 (a 51st caregiver was missing from every picker).
  const loadCoreData = async () => {
    try {
      const [cg, cl, pr] = await Promise.all([
        api.get('/api/caregivers', { limit: 1000 }),
        api.get('/api/clients', { limit: 1000 }),
        api.get('/api/prospects').catch(() => null),
      ])
      setCaregivers(rows<Caregiver>(cg))
      setClients(rows<Client>(cl))
      setProspects(rows<Lead>(pr))
    } catch (e) { console.error('Failed to load data:', e) }
    finally { setLoading(false) }
  }

  const loadWeekView = async () => {
    try { setWeekData(await api.get('/api/scheduling/week-view', { weekOf }) as WeekView) }
    catch (e) { console.error(e) }
  }

  const loadCoverage = async () => {
    setCoverageLoading(true)
    try { setCoverageData(await api.get('/api/scheduling/coverage-overview', { weekOf: coverageWeekOf }) as Coverage) }
    catch (e) { console.error(e) }
    finally { setCoverageLoading(false) }
  }

  const loadSuggestions = async () => {
    if (!formData.clientId) { showMsg('Pick a client first', 'error'); return }
    setSuggestLoading(true)
    try {
      const params: Record<string, string> = { clientId: formData.clientId }
      if (formData.date) params.date = formData.date
      if (formData.startTime) params.startTime = formData.startTime
      if (formData.endTime) params.endTime = formData.endTime
      const data = await api.get('/api/scheduling/suggest-caregivers', params) as { suggestions?: Suggestion[] }
      setSuggestions(data?.suggestions || [])
      setShowSuggestions(true)
    } catch (e) { showMsg('Suggest failed: ' + errorMessage(e), 'error') }
    finally { setSuggestLoading(false) }
  }

  const apptParams = () => ({ month: calCurrentDate.getMonth() + 1, year: calCurrentDate.getFullYear() })
  const loadCalendarData = async () => {
    try {
      const [schedData, prospData, apptData] = await Promise.all([
        api.get('/api/schedules-all'),
        api.get('/api/prospects').catch(() => null),
        api.get('/api/prospect-appointments', apptParams()).catch(() => null),
      ])
      setCalSchedules(rows<ScheduleRow>(schedData))
      setProspects(rows<Lead>(prospData))
      setProspectAppts(rows<ProspectAppt>(apptData))
    } catch (e) { console.error(e) }
  }
  const loadProspects = async () => { try { setProspects(rows<Lead>(await api.get('/api/prospects'))) } catch (e) { console.error(e) } }
  const loadProspectAppts = async () => { try { setProspectAppts(rows<ProspectAppt>(await api.get('/api/prospect-appointments', apptParams()))) } catch (e) { console.error(e) } }

  const loadOpenShifts = async () => {
    setOpenShiftsLoading(true)
    try { setOpenShifts(rows<OpenShift>(await api.get('/api/open-shifts', openShiftFilter ? { status: openShiftFilter } : {}))) }
    catch (e) { console.error(e) }
    finally { setOpenShiftsLoading(false) }
  }

  const loadSwaps = async () => {
    setSwapsLoading(true)
    try { setSwaps(rows<Swap>(await api.get('/api/shift-swaps', swapFilter ? { status: swapFilter } : {}))) }
    catch (e) { console.error(e) }
    finally { setSwapsLoading(false) }
  }

  // Reschedule requests — a caregiver asking to move one of their shifts, or a client asking through the portal.
  // Approving here is what actually moves the shift on the schedule.
  const loadReschedules = async () => {
    setReschedLoading(true)
    try { setReschedReqs(rows<ChangeRequest>(await api.get('/api/visit-change-requests', { status: 'pending' }))) }
    catch (e) { console.error(e) }
    finally { setReschedLoading(false) }
  }

  const resolveReschedule = async (id: string, action: 'approve' | 'deny', adminNotes?: string) => {
    setReschedBusy(id)
    try {
      await api.put(`/api/visit-change-requests/${id}/resolve`, { action, adminNotes: adminNotes || null })
      showMsg(action === 'approve' ? 'Shift moved' : 'Request denied')
      loadReschedules()
      // The grid / week view is now stale — an approved move rewrote the schedule.
      if (scheduleView === 'week') loadWeekView()
      if (scheduleView === 'month') loadCalendarData()
    } catch (e) { showMsg(errorMessage(e), 'error') }
    finally { setReschedBusy(null) }
  }

  const loadAbsences = async () => {
    setAbsencesLoading(true)
    try { setAbsences(rows<Absence>(await api.get('/api/absences'))) }
    catch (e) { console.error(e) }
    finally { setAbsencesLoading(false) }
  }

  // ═══ HELPERS ═══

  const getClientName = (id: string) => { const c = clients.find((cl) => cl.id === id); return c ? fullName(c) : 'Unknown' }
  const getCaregiverName = (id: string | null) => { const c = caregivers.find((cg) => cg.id === id); return c ? fullName(c) : 'Unknown' }
  const cgColor = (id: string | null) => MARKS.slice(0, 8)[caregivers.findIndex((c) => c.id === id) % 8] || C.muted
  const calculateTotalHours = (list: ScheduleRow[]) => {
    const total = list.reduce((t, s) => {
      const hrs = parseFloat(calculateHours(s.startTime, s.endTime))
      return t + (s.frequency === 'biweekly' ? hrs / 2 : hrs)
    }, 0)
    return Number(total || 0).toFixed(2)
  }
  const groupSchedules = () => {
    const recurringByDay: Record<string, ScheduleRow[]> = {}, oneTimeByDate: Record<string, ScheduleRow[]> = {}
    caregiverSchedules.forEach((s) => {
      if (isRecurringRow(s)) (recurringByDay[String(s.dayOfWeek)] ||= []).push(s)
      else if (s.date) (oneTimeByDate[s.date.split('T')[0]] ||= []).push(s)
    })
    Object.values(recurringByDay).forEach((arr) => arr.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')))
    Object.values(oneTimeByDate).forEach((arr) => arr.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')))
    return { recurringByDay, oneTimeByDate }
  }
  const detectConflicts = (list: ScheduleRow[]) => {
    const found: Array<{ day: number }> = []
    const recurring = list.filter((s) => isRecurringRow(s) && s.isActive !== false)
    recurring.forEach((a, i) => {
      recurring.slice(i + 1).forEach((b) => {
        if (a.dayOfWeek !== b.dayOfWeek) return
        // Two bi-weekly rows on the same weekday only collide when they share a fortnight.
        if (a.frequency === 'biweekly' && b.frequency === 'biweekly' && a.anchorDate && b.anchorDate && !isBiweeklyOn(a.anchorDate, b.anchorDate)) return
        if (a.startTime < b.endTime && a.endTime > b.startTime) found.push({ day: Number(a.dayOfWeek) })
      })
    })
    return found
  }

  // Shown only when the end time is earlier than the start: ticking it says the shift really ends the next day.
  // Unticked, the save is refused (lib/shiftTimes.ts, and the server's same rule).
  const overnightCheck = (start: string, end: string, checked: boolean, onChange: (v: boolean) => void) => endsBeforeStart(start, end) ? (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', margin: '-0.5rem 0 1rem', padding: '0.6rem 0.75rem', borderRadius: '8px', background: tint('amber').bg, border: `1px solid ${tint('amber').line}`, color: tint('amber').ink, fontSize: '0.82rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span><strong>Overnight shift</strong> — it ends the next day at {formatTime(end)}. Leave this unticked if the end time is a mistake.</span>
    </label>
  ) : null

  // ═══ THE CREATE FORM (pre-fillable: + New, an empty week cell, Coverage "Fix It") ═══

  const openCreatePanel = ({ caregiverId = '', clientId = '', date = '', dayOfWeek = '' }: { caregiverId?: string; clientId?: string; date?: string; dayOfWeek?: string } = {}) => {
    setSelectedCaregiverId(caregiverId)
    setFormData((prev) => ({
      ...prev,
      caregiverId: caregiverId || '',
      clientId: clientId || '',
      date: date || getTodayCT(),
      dayOfWeek: dayOfWeek !== '' ? dayOfWeek.toString() : '',
      // A specific date cell means "add a shift on THAT date" — a one-time shift. Recurring only when a weekday was
      // chosen without a concrete date (a cell click once made a recurring shift whose start was clamped forward).
      scheduleType: (dayOfWeek !== '' && !date) ? 'recurring' : 'one-time',
      startTime: '09:00', endTime: '13:00', notes: '',
    }))
    setSelectedDays([])
    if (caregiverId) loadCaregiverSchedules(caregiverId)
    setShowForm(true)
    setCreatePanelOpen(true)
  }

  const closeCreatePanel = () => {
    setCreatePanelOpen(false)
    setShowForm(false)
    setSelectedCaregiverId('')
    setCaregiverSchedules([])
    setConflicts([])
  }

  const loadCaregiverSchedules = async (cgId: string) => {
    if (!cgId) return
    try {
      const list = rows<ScheduleRow>(await api.get(`/api/schedules/caregiver/${cgId}`))
      setCaregiverSchedules(list)
      setConflicts(detectConflicts(list))
    } catch { setCaregiverSchedules([]); setConflicts([]) }
  }

  const handleCaregiverSelectCreate = (cgId: string) => {
    setSelectedCaregiverId(cgId)
    setFormData((prev) => ({ ...prev, caregiverId: cgId }))
    loadCaregiverSchedules(cgId)
    // Reliability patterns
    if (cgId) api.get(`/api/dashboard/caregiver-patterns/${cgId}`).then((d: Patterns) => setCgPatterns(d)).catch(() => setCgPatterns(null))
    else setCgPatterns(null)
  }

  const toggleDaySelection = (idx: number) => setSelectedDays((prev) => (prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx].sort((a, b) => a - b)))
  const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5])
  const clearDays = () => setSelectedDays([])
  const applyPreset = (preset: { start: string; end: string }) => setFormData((prev) => ({ ...prev, startTime: preset.start, endTime: preset.end }))

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!formData.caregiverId || !formData.clientId) { showMsg('Select both caregiver and client', 'error'); return }
    if (formData.scheduleType === 'recurring' && formData.dayOfWeek === '') { showMsg('Select a day of week', 'error'); return }
    if (formData.scheduleType === 'one-time' && !formData.date) { showMsg('Select a date', 'error'); return }
    if ((formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly') && selectedDays.length === 0) { showMsg('Select at least one day', 'error'); return }
    const timesError = shiftTimesError(formData.startTime, formData.endTime, formData.overnight)
    if (timesError) { showMsg(timesError, 'error'); return }
    const overnight = endsBeforeStart(formData.startTime, formData.endTime) && !!formData.overnight
    const today = getTodayCT()
    // Sent as typed; the server aligns it per weekday so Sat+Sun starting 9/12 anchor to 9/12 and 9/13 — the same weekend.
    const anchorStr = biWeeklyAnchorDate || formData.date || today
    setSaving(true)
    try {
      if (formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly') {
        const freq = formData.scheduleType === 'bi-weekly' ? 'biweekly' : 'weekly'
        let created = 0, dup = 0, failed = 0
        let firstFailure: string | null = null, lastWarnings: string[] | null = null
        for (const dayOfWeek of selectedDays) {
          try {
            const body = await api.post('/api/schedules-enhanced', {
              caregiverId: formData.caregiverId, clientId: formData.clientId, scheduleType: 'recurring',
              dayOfWeek, date: null, startTime: formData.startTime, endTime: formData.endTime, notes: formData.notes,
              frequency: freq, effectiveDate: formData.date || today, anchorDate: anchorStr,
              isTraining: formData.isTraining, overnight,
            }) as SavedReply
            if (body?.authWarnings?.length) lastWarnings = body.authWarnings
            created++
          } catch (err) {
            if ((err as { status?: number }).status === 409) dup++
            else { failed++; if (!firstFailure) firstFailure = errorMessage(err) }
          }
        }
        // 409 = the duplicate guard refused an identical active shift. Say WHY anything failed, not just how many.
        const label = freq === 'biweekly' ? 'bi-weekly' : 'recurring'
        let m = `Created ${created} ${label} schedule${created !== 1 ? 's' : ''}`
        if (dup > 0) m += ` — ${dup} already scheduled`
        if (failed > 0) m += ` — ${failed} failed: ${firstFailure}`
        showSaved(m, { authWarnings: lastWarnings || undefined }, failed > 0)
      } else if (formData.scheduleType === 'recurring') {
        const body = await api.post('/api/schedules-enhanced', {
          caregiverId: formData.caregiverId, clientId: formData.clientId, scheduleType: 'recurring',
          dayOfWeek: parseInt(formData.dayOfWeek), date: null, startTime: formData.startTime, endTime: formData.endTime,
          notes: formData.notes, frequency: 'weekly', effectiveDate: formData.date || today, anchorDate: null,
          isTraining: formData.isTraining, overnight,
        }) as SavedReply
        showSaved('Schedule created!', body)
      } else {
        const body = await api.post('/api/schedules', {
          caregiverId: formData.caregiverId, clientId: formData.clientId, scheduleType: 'one-time',
          dayOfWeek: null, date: formData.date, startTime: formData.startTime, endTime: formData.endTime, notes: formData.notes,
          isTraining: formData.isTraining, overnight,
        }) as SavedReply
        showSaved('Schedule created!', body)
      }
      setFormData((prev) => ({ ...prev, clientId: '', scheduleType: 'one-time', dayOfWeek: '', date: getTodayCT(), startTime: '09:00', endTime: '13:00', notes: '', endDate: '', isTraining: false, overnight: false }))
      setSelectedDays([])
      loadCaregiverSchedules(selectedCaregiverId)
      if (scheduleView === 'week') loadWeekView()
      if (scheduleView === 'month') loadCalendarData()
    } catch (err) {
      if ((err as { status?: number }).status === 409) showMsg('That shift is already scheduled for this caregiver.', 'error')
      else showMsg('Could not create schedule: ' + errorMessage(err), 'error')
    } finally { setSaving(false) }
  }

  // The 🗑 on a "Current Schedule" row: names WHICH shift is going, in the wording for its kind.
  const handleDeleteSchedule = async (scheduleId: string, schedule: ScheduleRow) => {
    const isRecurring = isRecurringRow(schedule)
    const what = `${getClientName(schedule.clientId)}, ${isRecurring ? `${getDayName(Number(schedule.dayOfWeek))}s` : formatDate(schedule.date, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatTime(schedule.startTime)} – ${formatTime(schedule.endTime)}`
    if (isRecurring) {
      // scope=all on a recurring pattern ENDS it as of today and keeps every past (worked) occurrence. A full history
      // erase lives in the grid's scope box (scope=purge), behind its own confirm.
      if (!(await confirm(`Stop ${what} going forward? Past (already-worked) occurrences are kept.`, { danger: true, title: 'Stop recurring schedule', confirmText: 'Stop it' }))) return
    } else if (!(await confirm(`Delete ${what}?`, { danger: true, title: 'Delete schedule', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/schedules/${scheduleId}?scope=all`)
      showMsg(isRecurring ? 'Schedule stopped going forward' : 'Schedule deleted')
      loadCaregiverSchedules(selectedCaregiverId)
      if (scheduleView === 'month') loadCalendarData()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
  }

  // The most recent date this weekday came round, today included: when the office opens a repeating shift to fix it at
  // payday, the day they mean is almost always the last time it actually ran.
  const lastOccurrenceOnOrBefore = (dow: number) => {
    const t = new Date()
    t.setHours(12, 0, 0, 0)
    t.setDate(t.getDate() - ((t.getDay() - Number(dow) + 7) % 7))
    return toLocalYMD(t)
  }

  const openEditModal = (schedule: ScheduleRow) => {
    const isRecurring = isRecurringRow(schedule)
    setEditModal({
      id: schedule.id, clientId: schedule.clientId,
      caregiverId: schedule.caregiverId || null,
      dayOfWeek: isRecurring ? String(schedule.dayOfWeek) : '',
      date: schedule.date ? schedule.date.split('T')[0] : '',
      startTime: schedule.startTime || '09:00', endTime: schedule.endTime || '13:00',
      notes: schedule.notes || '', scheduleType: isRecurring ? 'recurring' : 'one-time',
      frequency: schedule.frequency || 'weekly',
      anchorDate: schedule.anchorDate ? schedule.anchorDate.split('T')[0] : '',
      // A repeating shift is ONE row every week is re-derived from, so an edit has to say which weeks it means.
      scope: isRecurring ? 'this' : undefined,
      editDate: isRecurring ? lastOccurrenceOnOrBefore(Number(schedule.dayOfWeek)) : '',
      suspendedFrom: schedule.suspendedFrom ? schedule.suspendedFrom.split('T')[0] : null,
      // A shift already saved as running past midnight opens as overnight.
      overnight: endsBeforeStart(schedule.startTime, schedule.endTime),
    })
  }

  // Suspend / resume a client's service. scope 'this' (this weekday) or 'client' (all of the client's days). Nothing is
  // deleted — the schedule is paused from a date and resumes exactly as it was.
  const handleSuspend = async (scope: 'this' | 'client') => {
    if (!editModal) return
    const fromDate = editModal.suspendFromDate || toLocalYMD(new Date())
    setSuspendBusy(true)
    try {
      const r = await api.post(`/api/schedules/${editModal.id}/suspend`, { scope, fromDate }) as { suspended: number }
      const who = scope === 'client' ? `all of ${getClientName(editModal.clientId)}'s days` : `${getDayName(parseInt(editModal.dayOfWeek))}s`
      showMsg(`Service suspended for ${who} starting ${formatDay(fromDate, { month: 'short', day: 'numeric' })} (${r.suspended} shift${r.suspended !== 1 ? 's' : ''})`)
      setEditModal(null)
      loadCaregiverSchedules(selectedCaregiverId); loadCalendarData(); loadWeekView()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
    finally { setSuspendBusy(false) }
  }

  const handleResume = async (scope: 'this' | 'client') => {
    if (!editModal) return
    setSuspendBusy(true)
    try {
      const r = await api.post(`/api/schedules/${editModal.id}/resume`, { scope }) as { resumed: number }
      showMsg(`Service resumed (${r.resumed} shift${r.resumed !== 1 ? 's' : ''})`)
      setEditModal(null)
      loadCaregiverSchedules(selectedCaregiverId); loadCalendarData(); loadWeekView()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
    finally { setSuspendBusy(false) }
  }

  const handleSaveEdit = async () => {
    if (!editModal) return
    const timesError = shiftTimesError(editModal.startTime, editModal.endTime, editModal.overnight)
    if (timesError) { showMsg(timesError, 'error'); return }
    const isRecurring = editModal.scheduleType === 'recurring'
    if (isRecurring && editModal.scope !== 'all' && !editModal.editDate) { showMsg('Pick which date this change applies to', 'error'); return }
    setEditSaving(true)
    try {
      await api.put(`/api/schedules-all/${editModal.id}`, {
        scope: isRecurring ? editModal.scope : undefined,
        editDate: isRecurring && editModal.scope !== 'all' ? editModal.editDate : undefined,
        clientId: editModal.clientId,
        dayOfWeek: isRecurring ? parseInt(editModal.dayOfWeek) : null,
        date: !isRecurring ? editModal.date : null,
        startTime: editModal.startTime, endTime: editModal.endTime, notes: editModal.notes,
        frequency: editModal.frequency || 'weekly', anchorDate: editModal.anchorDate || null,
        overnight: endsBeforeStart(editModal.startTime, editModal.endTime) && !!editModal.overnight,
      })
      const pretty = editModal.editDate ? formatDay(editModal.editDate, { weekday: 'short', month: 'short', day: 'numeric' }) : ''
      if (!isRecurring) showMsg('Schedule updated')
      else if (editModal.scope === 'this') showMsg(`Changed ${pretty} only`)
      else if (editModal.scope === 'following') showMsg(`Changed from ${pretty} onward`)
      else showMsg('Changed every occurrence, past weeks included')
      setEditModal(null)
      // Refresh EVERY view: the Month and Week tabs otherwise kept the pre-edit time, which looked like no save.
      loadCaregiverSchedules(selectedCaregiverId)
      loadCalendarData()
      loadWeekView()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
    finally { setEditSaving(false) }
  }

  const handleReassign = async (scheduleId: string, newCaregiverId: string, reason: string) => {
    try {
      await api.put(`/api/schedules/${scheduleId}/reassign`, { newCaregiverId, reason: reason || reassignReason })
      showMsg('Reassigned!'); loadWeekView(); setReassignReason('admin_decision')
    } catch { showMsg('Failed to reassign', 'error') }
  }

  // ═══ MONTH CALENDAR ═══

  const calDaysInMonth = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() + 1, 0).getDate()
  const calFirstDay = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), 1).getDay()

  const getCalSchedulesForDay = (day: number): ScheduleRow[] => {
    const target = new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), day)
    const dow = target.getDay()
    const dateStr = toLocalYMD(target)
    const results: ScheduleRow[] = []
    calSchedules.forEach((s) => {
      if (s.date) {
        if (s.date.split('T')[0] === dateStr) {
          // Suspended: the server engine drops one-time rows on/after suspendedFrom too — match it.
          if (s.suspendedFrom && dateStr >= s.suspendedFrom.slice(0, 10)) return
          // One-time rows can be cancelled via exception (client unavailable) — match the server engine.
          const exc = (s.exceptions || []).find((e) => (e.exceptionDate || '').slice(0, 10) === dateStr)
          if (!(exc && exc.exceptionType === 'cancelled')) results.push(s)
        }
        return
      }
      if (isRecurringRow(s)) {
        if (Number(s.dayOfWeek) !== dow) return
        // A pattern exists from its effective date on (an ungated view drew an edited pattern twice on past dates).
        const startsOn = (s.effectiveDate || s.anchorDate || s.createdAt || '').slice(0, 10)
        if (startsOn && dateStr < startsOn) return
        if (s.endDate && dateStr > s.endDate.slice(0, 10)) return
        // Suspended service: hide occurrences on/after the suspend date, as the server engine does.
        if (s.suspendedFrom && dateStr >= s.suspendedFrom.slice(0, 10)) return
        if (s.frequency === 'biweekly' && s.anchorDate && !isBiweeklyOn(dateStr, s.anchorDate)) return
        const exc = (s.exceptions || []).find((e) => (e.exceptionDate || '').slice(0, 10) === dateStr)
        if (exc && exc.exceptionType === 'cancelled') return
        if (exc && exc.exceptionType === 'modified') {
          results.push({
            ...s,
            startTime: exc.overrideStartTime || s.startTime,
            endTime: exc.overrideEndTime || s.endTime,
            clientId: exc.overrideClientId || s.clientId,
            // A visit covered by someone else for one day shows THAT caregiver.
            caregiverId: exc.overrideCaregiverId || s.caregiverId,
            notes: exc.overrideNotes != null ? exc.overrideNotes : s.notes,
          })
          return
        }
        results.push(s)
      }
    })
    const filtered = calFilterCaregiver ? results.filter((s) => s.caregiverId === calFilterCaregiver) : results
    return filtered.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
  }

  const getProspectApptsForDay = (day: number) => {
    const dateStr = toLocalYMD(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), day))
    return prospectAppts.filter((a) => a.scheduledDate && a.scheduledDate.slice(0, 10) === dateStr)
  }

  // ═══ PROSPECTS (the `lead` rows: one name, phone, a description) ═══

  const createProspect = async () => {
    if (!prospectForm.firstName || !prospectForm.lastName) { showMsg('Name required', 'error'); return }
    setProspectSaving(true)
    try {
      await api.post('/api/prospects', {
        name: `${prospectForm.firstName.trim()} ${prospectForm.lastName.trim()}`.trim(),
        phone: prospectForm.phone || undefined,
        description: prospectForm.notes || undefined,
      })
      showMsg('Prospect added!'); setProspectForm({ firstName: '', lastName: '', phone: '', notes: '' })
      setShowProspectForm(false); loadProspects()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
    finally { setProspectSaving(false) }
  }

  const createProspectAppt = async () => {
    if (!prospectApptForm.prospectId || !prospectApptForm.appointmentDate) { showMsg('Select prospect and date', 'error'); return }
    setProspectSaving(true)
    try {
      await api.post('/api/prospect-appointments', {
        leadId: prospectApptForm.prospectId,
        scheduledDate: prospectApptForm.appointmentDate,
        scheduledTime: prospectApptForm.startTime || null,
        notes: prospectApptForm.location || null,
      })
      showMsg('Appointment scheduled!'); setProspectApptForm({ prospectId: '', appointmentDate: '', startTime: '10:00', location: '' })
      setShowProspectApptForm(false); loadProspectAppts()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
    finally { setProspectSaving(false) }
  }

  const convertProspect = async (prospectId: string) => {
    if (!(await confirm('Convert this prospect to a full client?', { danger: true }))) return
    try {
      const result = await api.post(`/api/prospects/${prospectId}/convert`) as { client: { firstName: string; lastName: string } }
      showMsg(`Converted: ${result.client.firstName} ${result.client.lastName}`)
      loadProspects(); loadCoreData()
    } catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
  }

  const deleteProspectAppt = async (id: string) => {
    if (!(await confirm('Cancel this appointment?', { danger: true }))) return
    try { await api.delete(`/api/prospect-appointments/${id}`); showMsg('Cancelled'); loadProspectAppts() }
    catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
  }

  // ═══ OPEN SHIFTS ═══

  const createOpenShift = async (data: Record<string, unknown>) => {
    try {
      await api.post('/api/open-shifts', data)
      showMsg('Open shift posted!'); setShowCreateShift(false); setCreateShiftPreFill({}); loadOpenShifts()
    } catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }

  const approveOpenShift = async (shift: OpenShift) => {
    try {
      await api.post(`/api/open-shifts/${shift.id}/approve`)
      showMsg(`Approved — the shift is on ${shift.claimedByFirst || 'their'}'s schedule`); loadOpenShifts()
    } catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }
  const turnDownOpenShift = async (shift: OpenShift) => {
    if (!(await confirm(`Turn down ${shift.claimedByFirst || 'this caregiver'}? The shift goes back to available for the others.`, { danger: false }))) return
    try {
      await api.post(`/api/open-shifts/${shift.id}/reject`, { reason: 'Turned down by office' })
      showMsg('Turned down — the shift is available again'); loadOpenShifts()
    } catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }
  const removeOpenShift = async (shift: OpenShift) => {
    if (!(await confirm('Remove this from Available Shifts? Caregivers will no longer see it. The visit stays with the caregiver it was scheduled for.', { danger: true }))) return
    try {
      await api.post(`/api/open-shifts/${shift.id}/cancel`)
      showMsg('Removed from Available Shifts'); loadOpenShifts()
    } catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }

  // ═══ STAFFING ═══

  // Approving moves that ONE day to the coworker. The pop-up names the day and both people, and the result is said
  // out loud (Run 4).
  const approveSwap = async (sw: Swap) => {
    const day = sw.shiftDate ? formatDate(sw.shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }) : 'this shift'
    const from = `${sw.requesterFirst || ''} ${sw.requesterLast || ''}`.trim() || 'the caregiver'
    const to = `${sw.targetFirst || ''} ${sw.targetLast || ''}`.trim() || 'the coworker'
    if (!(await confirm(`Move ${day} (${sw.startTime?.slice(0, 5) || ''}–${sw.endTime?.slice(0, 5) || ''}) from ${from} to ${to}? Both are notified.`, { title: 'Approve shift swap', confirmText: 'Approve swap', danger: false }))) return
    try { await api.put(`/api/shift-swaps/${sw.id}/approve`); showMsg(`Swap approved — ${day} is now ${to}'s. Both caregivers were notified.`); loadSwaps() }
    catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }

  // Backing out of the reason box backs out of the rejection (the template rejected even on Cancel).
  const rejectSwap = async (id: string) => {
    const reason = await prompt('Rejection reason (optional):', { title: 'Turn down swap', confirmText: 'Turn down' })
    if (reason === null) return
    try { await api.put(`/api/shift-swaps/${id}/reject`, { reason }); loadSwaps() }
    catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }

  // After recording an absence, find the shifts it hits and offer to post each as an open shift.
  const recordAbsence = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/absences', absenceForm)
      showMsg('Absence recorded!')
      try {
        const scheds = rows<ScheduleRow>(await api.get(`/api/schedules/caregiver/${absenceForm.caregiverId}`))
        const dow = parseLocalDate(absenceForm.date).getDay()
        const affected = scheds.filter((s) => {
          if (s.date) return s.date.split('T')[0] === absenceForm.date
          if (isRecurringRow(s)) return Number(s.dayOfWeek) === dow
          return false
        })
        if (affected.length > 0) setPendingAbsenceShift({ date: absenceForm.date, schedules: affected })
      } catch { /* the absence is saved; the coverage prompt is a convenience */ }
      setAbsenceForm({ caregiverId: '', date: '', type: 'call_out', reason: '' })
      setShowAbsenceForm(false); loadAbsences()
    } catch (err) { showMsg('Failed: ' + errorMessage(err), 'error') }
  }

  const deleteAbsence = async (id: string) => {
    if (!(await confirm('Delete this absence?', { danger: true }))) return
    try { await api.delete(`/api/absences/${id}`); loadAbsences() }
    catch (e) { showMsg('Failed: ' + errorMessage(e), 'error') }
  }

  const postOpenShiftFromAbsence = (sched: ScheduleRow) => {
    if (!pendingAbsenceShift) return
    setCreateShiftPreFill({ clientId: sched.clientId, date: pendingAbsenceShift.date, start: sched.startTime?.slice(0, 5) || '09:00', end: sched.endTime?.slice(0, 5) || '13:00' })
    setPendingAbsenceShift(null)
    setShowCreateShift(true)
  }

  // ═══ AVAILABILITY ═══

  const loadAvailability = async (cgId: string) => {
    setAvailCaregiver(cgId); if (!cgId) return
    try {
      const [avail, boDates] = await Promise.all([
        api.get(`/api/caregivers/${cgId}/availability`) as Promise<AvailRow | null>,
        api.get(`/api/caregivers/${cgId}/blackout-dates`).catch(() => null),
      ])
      if (avail) {
        const t = (k: string) => (typeof avail[k] === 'string' ? (avail[k] as string).slice(0, 5) : '') || ''
        const next: AvailForm = { status: avail.status || 'available', maxHoursPerWeek: avail.maxHoursPerWeek || 40 }
        for (const { key } of DAYS_OF_WEEK) {
          const weekend = key === 'saturday' || key === 'sunday'
          next[`${key}Available`] = weekend ? !!avail[`${key}Available`] : avail[`${key}Available`] !== false
          next[`${key}StartTime`] = t(`${key}StartTime`) || '08:00'
          next[`${key}EndTime`] = t(`${key}EndTime`) || '17:00'
        }
        setAvailForm(next)
      }
      setBlackoutDates(rows<Blackout>(boDates))
    } catch (e) { console.error(e) }
  }

  const saveAvailability = async () => {
    // The field holds what was typed; it is checked here, not clamped as the user types.
    const maxH = Number(availForm.maxHoursPerWeek)
    if (String(availForm.maxHoursPerWeek).trim() === '' || !Number.isFinite(maxH) || maxH < 0 || maxH > 168) { showMsg('Max hours per week must be a number from 0 to 168', 'error'); return }
    try { await api.put(`/api/caregivers/${availCaregiver}/availability`, { ...availForm, maxHoursPerWeek: maxH }); showMsg('Availability saved!') }
    catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
  }

  const addBlackout = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post(`/api/caregivers/${availCaregiver}/blackout-dates`, newBlackout)
      showMsg('Blackout date added!'); setNewBlackout({ startDate: '', endDate: '', reason: '' }); setShowBlackoutForm(false); loadAvailability(availCaregiver)
    } catch (err) { showMsg('Error: ' + errorMessage(err), 'error') }
  }

  const deleteBlackout = async (id: string) => {
    if (!(await confirm('Delete this blackout date?', { danger: true }))) return
    try { await api.delete(`/api/blackout-dates/${id}`); loadAvailability(availCaregiver) }
    catch (e) { showMsg('Error: ' + errorMessage(e), 'error') }
  }

  // ═══ STYLE HELPERS ═══

  const pendingSwaps = swaps.filter((sw) => sw.status === 'accepted').length
  const blue = tint('blue'), green = tint('green'), amber = tint('amber'), red = tint('red'), violet = tint('violet'), orange = tint('orange')

  const mainTabStyle = (active: boolean): CSSProperties => ({
    padding: isMobile ? '0.6rem 0.75rem' : '0.65rem 1.25rem',
    border: 'none', borderBottom: active ? `3px solid ${C.brandLine}` : '3px solid transparent',
    background: 'none', cursor: 'pointer', fontSize: isMobile ? '0.82rem' : '0.9rem',
    fontWeight: active ? 700 : 500, color: active ? C.brandInk : C.muted, transition: 'all 0.15s', whiteSpace: 'nowrap',
  })
  const subTabStyle = (active: boolean): CSSProperties => ({
    padding: '0.4rem 0.85rem', borderRadius: '6px', border: 'none',
    background: active ? C.brandFill : C.subtle, color: active ? '#fff' : C.ink,
    cursor: 'pointer', fontSize: '0.82rem', fontWeight: active ? 600 : 400, transition: 'all 0.15s', whiteSpace: 'nowrap',
  })
  const viewBtn = (active: boolean): CSSProperties => ({
    padding: '0.35rem 0.75rem', border: `1px solid ${active ? 'transparent' : C.line}`, borderRadius: '6px',
    background: active ? C.brandFill : C.surface, color: active ? '#fff' : C.ink, cursor: 'pointer', fontSize: '0.82rem', fontWeight: active ? 600 : 400,
  })
  const countBadge = (n: number) => <span style={{ ...pill({ fill: FILL.red }), marginLeft: '0.4rem' }}>{n}</span>
  const weekNav = (value: string, set: (v: string) => void, extra?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { const d = parseLocalDate(value); d.setDate(d.getDate() - 7); set(toLocalYMD(getWeekStart(d))) }}>◀ Prev</button>
      <input type="date" value={value} onChange={(e) => set(toLocalYMD(getWeekStart(parseLocalDate(e.target.value))))}
        style={{ padding: '0.3rem 0.5rem', border: `1px solid ${C.line}`, borderRadius: '6px', fontSize: '0.85rem' }} />
      <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { const d = parseLocalDate(value); d.setDate(d.getDate() + 7); set(toLocalYMD(getWeekStart(d))) }}>Next ▶</button>
      <button className="hc-btn hc-btn-sm hc-btn-primary" disabled={value === toLocalYMD(getWeekStart(new Date()))} onClick={() => set(toLocalYMD(getWeekStart(new Date())))}>📍 Today</button>
      {extra}
    </div>
  )
  const loadingCard = (text = 'Loading...', pad = '2rem') => <div className="hc-card" style={{ textAlign: 'center', padding: pad }}>{text}</div>
  const emptyCard = (body: ReactNode, pad = '1.5rem') => <div className="hc-card" style={{ textAlign: 'center', padding: pad, color: C.muted }}>{body}</div>

  // ═══ SCHEDULE TAB ═══

  const renderScheduleTab = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button style={viewBtn(scheduleView === 'grid')} onClick={() => setScheduleView('grid')}>📋 Grid</button>
          <button style={viewBtn(scheduleView === 'month')} onClick={() => setScheduleView('month')}>📆 Month</button>
        </div>
        {scheduleView === 'month' && (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginLeft: 'auto' }}>
            <button className="hc-btn hc-btn-secondary hc-btn-sm" aria-label="Previous month" onClick={() => setCalCurrentDate(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() - 1))}>‹</button>
            <strong style={{ fontSize: '0.88rem' }}>{formatDay(calCurrentDate, { month: 'long', year: 'numeric' })}</strong>
            <button className="hc-btn hc-btn-secondary hc-btn-sm" aria-label="Next month" onClick={() => setCalCurrentDate(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth() + 1))}>›</button>
            <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setCalCurrentDate(new Date())}>Today</button>
            <select value={calFilterCaregiver} onChange={(e) => setCalFilterCaregiver(e.target.value)} style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.82rem' }}>
              <option value="">All Caregivers</option>
              {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
            </select>
          </div>
        )}
        <button className="hc-btn hc-btn-primary" style={{ marginLeft: scheduleView === 'grid' ? 'auto' : '0', fontSize: '0.88rem' }} onClick={() => openCreatePanel()}>+ New Schedule</button>
      </div>

      {scheduleView === 'grid' && <DragDropScheduler />}

      {scheduleView === 'week' && (
        <div>
          <p style={{ fontSize: '0.82rem', color: C.muted, marginBottom: '0.75rem' }}>💡 Click a shift to reassign · Click an empty cell to add a schedule</p>
          {weekData ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="hc-table" style={{ minWidth: '800px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '140px' }}>Caregiver</th>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => {
                      const date = parseLocalDate(weekData.weekStart); date.setDate(date.getDate() + idx)
                      const isToday = toLocalYMD(date) === getTodayCT()
                      return (
                        <th key={day} style={{ textAlign: 'center', minWidth: '95px', background: isToday ? C.todayBg : undefined }}>
                          <div>{day}</div>
                          <div style={{ fontSize: '0.72rem', color: isToday ? C.todayInk : C.inkSoft, fontWeight: isToday ? 700 : 400 }}>{date.getDate()}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(weekData.caregivers || []).map(({ caregiver, days: dayData }) => (
                    <tr key={caregiver.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cgColor(caregiver.id) }} />
                          <strong style={{ fontSize: '0.85rem' }}>{caregiver.firstName} {caregiver.lastName?.[0]}.</strong>
                        </div>
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map((di) => {
                        const date = parseLocalDate(weekData.weekStart); date.setDate(date.getDate() + di)
                        const isToday = toLocalYMD(date) === getTodayCT()
                        const dateStr = toLocalYMD(date)
                        const cell = dayData[String(di)] || []
                        const hasShifts = cell.length > 0
                        return (
                          <td key={di}
                            onClick={() => { if (!hasShifts) openCreatePanel({ caregiverId: caregiver.id, date: dateStr, dayOfWeek: di.toString() }) }}
                            style={{ padding: '0.25rem', verticalAlign: 'top', background: isToday ? C.todayBg : undefined, cursor: hasShifts ? 'default' : 'pointer' }}
                            onMouseEnter={(e) => { if (!hasShifts) e.currentTarget.style.background = green.bg }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = isToday ? C.todayBg : '' }}>
                            {hasShifts ? cell.map((sched) => (
                              <div key={sched.id} onClick={(e) => { e.stopPropagation(); setReassignModal({ schedule: sched, currentCaregiver: caregiver }) }}
                                style={{ fontSize: '0.7rem', padding: '0.25rem 0.4rem', marginBottom: '0.2rem', borderRadius: '4px', background: sched.isRecurring ? blue.bg : green.bg, color: C.ink, borderLeft: `3px solid ${cgColor(caregiver.id)}`, cursor: 'pointer' }}
                                title={`${getClientName(sched.clientId)} · ${formatTime(sched.startTime)}–${formatTime(sched.endTime)}`}>
                                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getClientName(sched.clientId).split(' ')[0]}</div>
                                <div style={{ color: C.inkSoft }}>{formatTime(sched.startTime)}</div>
                              </div>
                            )) : (
                              <div style={{ height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: '0.7rem' }}>+ add</div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : loadingCard('Loading week view...')}
        </div>
      )}

      {scheduleView === 'month' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button className="hc-btn hc-btn-sm" onClick={() => setShowProspectApptForm(!showProspectApptForm)} style={{ background: FILL.orange, color: '#fff', border: 'none' }}>{showProspectApptForm ? '✕ Cancel' : '+ Prospect Appt'}</button>
            <button className="hc-btn hc-btn-sm" onClick={() => setShowProspectForm(!showProspectForm)} style={{ background: showProspectForm ? FILL.grey : FILL.violet, color: '#fff', border: 'none' }}>{showProspectForm ? '✕ Cancel' : '+ New Prospect'}</button>
          </div>
          {showProspectForm && (
            <div className="hc-card" style={{ marginBottom: '1rem', border: `2px solid ${violet.ink}`, background: violet.bg }}>
              <h4 style={{ margin: '0 0 0.75rem', color: violet.ink }}>👤 Add Prospect</h4>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={lbl}>First Name *</label><input value={prospectForm.firstName} onChange={(e) => setProspectForm((p) => ({ ...p, firstName: e.target.value }))} style={field} /></div>
                <div><label style={lbl}>Last Name *</label><input value={prospectForm.lastName} onChange={(e) => setProspectForm((p) => ({ ...p, lastName: e.target.value }))} style={field} /></div>
                <div><label style={lbl}>Phone</label><input value={prospectForm.phone} onChange={(e) => setProspectForm((p) => ({ ...p, phone: e.target.value }))} style={field} /></div>
              </div>
              <div style={{ marginTop: '0.75rem' }}><label style={lbl}>Notes</label><textarea value={prospectForm.notes} onChange={(e) => setProspectForm((p) => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...field, resize: 'vertical' }} /></div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <button className="hc-btn hc-btn-primary hc-btn-sm" onClick={createProspect} disabled={prospectSaving}>{prospectSaving ? 'Saving...' : '✓ Save Prospect'}</button>
                <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setShowProspectForm(false)}>Cancel</button>
              </div>
            </div>
          )}
          {showProspectApptForm && (
            <div className="hc-card" style={{ marginBottom: '1rem', border: `2px solid ${orange.ink}`, background: orange.bg }}>
              <h4 style={{ margin: '0 0 0.75rem', color: orange.ink }}>📋 Schedule Prospect Appointment</h4>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={lbl}>Prospect *</label><select value={prospectApptForm.prospectId} onChange={(e) => setProspectApptForm((p) => ({ ...p, prospectId: e.target.value }))} style={field}><option value="">Select prospect...</option>{prospects.filter(isOpenLead).map((p) => <option key={p.id} value={p.id}>{p.homeownerName}</option>)}</select></div>
                <div><label style={lbl}>Date *</label><input type="date" value={prospectApptForm.appointmentDate} onChange={(e) => setProspectApptForm((p) => ({ ...p, appointmentDate: e.target.value }))} style={field} /></div>
                <div><label style={lbl}>Time</label><input type="time" value={prospectApptForm.startTime} onChange={(e) => setProspectApptForm((p) => ({ ...p, startTime: e.target.value }))} style={field} /></div>
              </div>
              <div style={{ marginTop: '0.75rem' }}><input value={prospectApptForm.location} onChange={(e) => setProspectApptForm((p) => ({ ...p, location: e.target.value }))} placeholder="Location / notes" style={field} /></div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <button className="hc-btn hc-btn-sm" onClick={createProspectAppt} disabled={prospectSaving} style={{ background: FILL.orange, color: '#fff' }}>{prospectSaving ? 'Saving...' : '✓ Schedule'}</button>
                <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setShowProspectApptForm(false)}>Cancel</button>
              </div>
            </div>
          )}
          {prospects.filter(isOpenLead).length > 0 && (
            <div className="hc-card" style={{ marginBottom: '1rem', padding: '0.75rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: violet.ink }}>👤 Active Prospects ({prospects.filter(isOpenLead).length})</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {prospects.filter(isOpenLead).map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.75rem', background: violet.bg, border: `1px solid ${violet.line}`, borderRadius: '20px', fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: 600 }}>{p.homeownerName}</span>
                    {p.phone && <span style={{ color: C.inkSoft }}>{p.phone}</span>}
                    <button onClick={() => convertProspect(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem' }} title="Convert to Client" aria-label={`Convert ${p.homeownerName || 'prospect'} to a client`}>✅</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="hc-card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', background: C.line }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem', background: C.subtle, color: C.ink }}>{d}</div>)}
              {Array.from({ length: calFirstDay }, (_, i) => <div key={`e${i}`} style={{ background: C.ground, minHeight: isMobile ? '50px' : '80px' }} />)}
              {Array.from({ length: calDaysInMonth }, (_, i) => {
                const day = i + 1, todayParts = getTodayCT().split('-').map(Number)
                const isToday = day === todayParts[2] && calCurrentDate.getMonth() === todayParts[1] - 1 && calCurrentDate.getFullYear() === todayParts[0]
                const dayScheds = getCalSchedulesForDay(day)
                const dayProspectAppts = getProspectApptsForDay(day)
                return (
                  <div key={day} onClick={() => { setCalDaySchedules(dayScheds); setCalSelectedDay(day) }}
                    style={{ background: isToday ? C.todayBg : C.surface, minHeight: isMobile ? '50px' : '80px', padding: '0.25rem', cursor: 'pointer' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: isToday ? 700 : 400, color: isToday ? C.todayInk : C.ink, marginBottom: '0.2rem' }}>{day}</div>
                    {dayScheds.slice(0, isMobile ? 1 : 2).map((sc, idx) => {
                      // Time, client and caregiver: the label once read "Caregiver 9:00am" and never said who the visit was for.
                      const label = `${formatTime(sc.startTime)} ${getClientName(sc.clientId)} · ${getCaregiverName(sc.caregiverId)}`
                      return (
                        <div key={idx} title={label} style={{ fontSize: '0.62rem', padding: '0.1rem 0.2rem', marginBottom: '1px', borderRadius: '2px', background: cgColor(sc.caregiverId) + '20', borderLeft: `2px solid ${cgColor(sc.caregiverId)}`, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {isMobile ? formatTime(sc.startTime) : label}
                        </div>
                      )
                    })}
                    {dayProspectAppts.map((pa, idx) => <div key={`pa${idx}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.2rem', marginBottom: '1px', borderRadius: '2px', background: orange.bg, borderLeft: `2px solid ${FILL.orange}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: orange.ink }}>{isMobile ? '🟠' : `🟠 ${pa.homeownerName || 'Prospect'}`}</div>)}
                    {(dayScheds.length + dayProspectAppts.length) > (isMobile ? 1 : 3) && <div style={{ fontSize: '0.6rem', color: C.muted, textAlign: 'center' }}>+{(dayScheds.length + dayProspectAppts.length) - (isMobile ? 1 : 3)} more</div>}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="hc-card" style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
              {caregivers.map((cg) => (
                <div key={cg.id} onClick={() => setCalFilterCaregiver(calFilterCaregiver === cg.id ? '' : cg.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', padding: '0.2rem 0.5rem', borderRadius: '6px', background: calFilterCaregiver === cg.id ? C.line : 'transparent' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: cgColor(cg.id) }} />
                  <span style={{ fontSize: '0.82rem' }}>{cg.firstName} {cg.lastName}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><div style={{ width: '10px', height: '10px', borderRadius: '3px', background: FILL.orange }} /><span style={{ fontSize: '0.82rem', color: orange.ink }}>Prospect</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // ═══ TOOLS TAB ═══

  const renderToolsTab = () => (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button style={subTabStyle(toolsTab === 'coverage')} onClick={() => setToolsTab('coverage')}>📈 Coverage</button>
        <button style={subTabStyle(toolsTab === 'heatmap')} onClick={() => setToolsTab('heatmap')}>🔥 Conflict Heatmap</button>
        <button style={subTabStyle(toolsTab === 'optimizer')} onClick={() => setToolsTab('optimizer')}>🧠 Optimizer</button>
        <button style={subTabStyle(toolsTab === 'roster')} onClick={() => setToolsTab('roster')}>📊 Roster Optimizer</button>
      </div>

      {toolsTab === 'coverage' && (
        <div>
          <div className="hc-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: 0 }}>📈 Coverage Overview</h3>
            {weekNav(coverageWeekOf, setCoverageWeekOf,
              <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setCoverageWeekOf(toLocalYMD(getWeekStart(new Date())))}>Today</button>)}
          </div>
          {coverageLoading ? loadingCard() : coverageData ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="hc-card" style={statCard}><div style={statVal(blue.ink)}>{coverageData.summary?.totalCaregivers ?? 0}</div><div style={statLabel}>Active Caregivers</div></div>
                <div className="hc-card" style={statCard}><div style={statVal(green.ink)}>{coverageData.summary?.totalScheduledHours ?? 0}h</div><div style={statLabel}>Scheduled</div></div>
                <div className="hc-card" style={statCard}><div style={statVal((coverageData.summary?.underScheduledClientCount ?? 0) > 0 ? red.ink : green.ink)}>{coverageData.summary?.underScheduledClientCount ?? 0}</div><div style={statLabel}>Under-Scheduled</div></div>
                <div className="hc-card" style={statCard}><div style={statVal((coverageData.summary?.totalShortfallUnits ?? 0) > 0 ? red.ink : green.ink)}>{coverageData.summary?.totalShortfallUnits ?? 0}u</div><div style={statLabel}>Shortfall ({coverageData.summary?.totalShortfallHours ?? 0}h)</div></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '1rem' }}>
                <div className="hc-card">
                  <h3 style={{ margin: '0 0 0.75rem' }}>👥 Caregiver Hours</h3>
                  <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {coverageData.caregivers.map((cg) => {
                      const tone = cg.utilizationPercent > 100 ? red : cg.utilizationPercent > 80 ? amber : green
                      const bar = cg.utilizationPercent > 100 ? '#DC2626' : cg.utilizationPercent > 80 ? '#F59E0B' : '#10B981'
                      return (
                        <div key={cg.id} style={{ padding: '0.6rem', borderBottom: `1px solid ${C.subtle}`, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{cg.name}</div><div style={{ fontSize: '0.78rem', color: C.muted }}>{Number(cg.scheduledHours || 0).toFixed(2)}h / {cg.maxHours}h</div></div>
                          <div style={{ width: '90px' }}><div style={{ height: '7px', background: C.line, borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: `${Math.min(cg.utilizationPercent, 100)}%`, height: '100%', background: bar }} /></div></div>
                          <div style={{ minWidth: '40px', textAlign: 'right', fontWeight: 600, fontSize: '0.82rem', color: tone.ink }}>{cg.utilizationPercent}%</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="hc-card">
                  <h3 style={{ margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    ⚠️ Under-Scheduled {coverageData.underScheduledClients.length > 0 && <span style={pill('red')}>{coverageData.underScheduledClients.length}</span>}
                  </h3>
                  {coverageData.underScheduledClients.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: green.ink }}>✅ All clients fully scheduled!</div>
                  ) : (
                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      {coverageData.underScheduledClients.map((cl) => (
                        <div key={cl.id} style={{ padding: '0.6rem', borderBottom: `1px solid ${C.surface}`, background: red.bg }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div><div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{cl.name}</div><div style={{ fontSize: '0.78rem', color: C.inkSoft }}>{cl.scheduledUnits}/{cl.authorizedUnits} units</div></div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={pill({ fill: FILL.red })}>-{cl.shortfallUnits}u</span>
                              {/* Fix It: the Schedule tab's week view, with the create form pre-filled for this client */}
                              <button onClick={() => { setMainTab('schedule'); setScheduleView('week'); openCreatePanel({ clientId: cl.id }) }}
                                style={{ padding: '0.25rem 0.6rem', borderRadius: '6px', border: 'none', background: FILL.green, color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                Fix It →
                              </button>
                            </div>
                          </div>
                          <div style={{ height: '5px', background: red.line, borderRadius: '3px', overflow: 'hidden', marginTop: '0.4rem' }}><div style={{ width: `${cl.coveragePercent}%`, height: '100%', background: '#DC2626' }} /></div>
                          <div style={{ fontSize: '0.7rem', color: C.inkSoft, marginTop: '0.2rem' }}>{cl.coveragePercent}%</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : <div className="hc-card" style={{ textAlign: 'center', padding: '2rem' }}>Failed to load. <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={loadCoverage}>Retry</button></div>}
        </div>
      )}

      {toolsTab === 'heatmap' && (
        <div>
          <div className="hc-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: 0 }}>🔥 Conflict Heatmap</h3>
            {weekNav(heatmapWeekOf, setHeatmapWeekOf)}
          </div>

          {heatmapLoading ? <p style={{ padding: '1rem' }}>Loading…</p> : !heatmap ? null : (
            <div className="hc-card" style={{ padding: '1rem', overflowX: 'auto' }}>
              <div style={{ fontSize: '0.85rem', color: C.ink, marginBottom: '0.5rem' }}>
                Week of <strong>{heatmap.weekStart}</strong>. Cell color = scheduled hours that day. Right column = week total vs cap.
                <span style={{ marginLeft: 10, display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.75rem' }}>
                  <span style={{ width: 14, height: 14, background: C.subtle, border: `1px solid ${C.line}`, display: 'inline-block', borderRadius: 2 }}></span> 0
                  <span style={{ width: 14, height: 14, background: HEAT[0], display: 'inline-block', borderRadius: 2 }}></span> 1-4
                  <span style={{ width: 14, height: 14, background: HEAT[1], display: 'inline-block', borderRadius: 2 }}></span> 4-8
                  <span style={{ width: 14, height: 14, background: HEAT[2], display: 'inline-block', borderRadius: 2 }}></span> 8-12
                  <span style={{ width: 14, height: 14, background: HEAT[3], display: 'inline-block', borderRadius: 2 }}></span> 12+
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: C.subtle }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Caregiver</th>
                    {(heatmap.caregivers[0]?.days || []).map((d) => (
                      <th key={d.date} style={{ padding: '6px 8px', textAlign: 'center' }}>
                        {formatDay(d.date, { weekday: 'short' })}
                        <div style={{ fontSize: '0.7rem', color: C.inkSoft, fontWeight: 400 }}>{d.date.slice(5)}</div>
                      </th>
                    ))}
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Week / Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {heatmap.caregivers.map((cg) => {
                    const pct = cg.maxHoursPerWeek > 0 ? (cg.total / cg.maxHoursPerWeek) : 0
                    const overCap = cg.total > cg.maxHoursPerWeek
                    return (
                      <tr key={cg.id} style={{ borderTop: `1px solid ${C.subtle}` }}>
                        <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{cg.firstName} {cg.lastName}</td>
                        {cg.days.map((d) => {
                          // Fixed light fills with a fixed dark ink: the pair reads (6.4:1 or better) in both themes.
                          const bg = d.hours > 12 ? HEAT[3] : d.hours > 8 ? HEAT[2] : d.hours > 4 ? HEAT[1] : d.hours > 0 ? HEAT[0] : null
                          return (
                            <td key={d.date} style={{ padding: 2, textAlign: 'center' }}>
                              <div title={`${d.shifts} shift(s) · ${d.hours}h`}
                                style={{ background: bg || C.subtle, color: bg ? '#111827' : C.ink, padding: '6px 2px', borderRadius: 4, fontWeight: d.hours > 8 ? 700 : 500, fontSize: '0.82rem' }}>
                                {d.hours > 0 ? `${d.hours}h` : ''}
                              </div>
                            </td>
                          )
                        })}
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 700, color: overCap ? red.ink : pct >= 0.9 ? amber.ink : C.ink }}>
                          {cg.total.toFixed(1)}h / {cg.maxHoursPerWeek}h
                          {overCap && <div style={{ fontSize: '0.7rem' }}>⚠ over cap</div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {toolsTab === 'optimizer' && <ScheduleOptimizer caregivers={caregivers} clients={clients} />}
      {toolsTab === 'roster' && <RosterOptimizer />}
    </div>
  )

  // ═══ STAFFING TAB ═══

  const statusPill = (status: string | null | undefined, map: Record<string, Tone | 'neutral'>, fallback: Tone) =>
    pill(map[status || ''] || fallback)

  const renderStaffingTab = () => (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button style={subTabStyle(staffingTab === 'open-shifts')} onClick={() => setStaffingTab('open-shifts')}>🚨 Open Shifts</button>
        <button style={subTabStyle(staffingTab === 'swaps')} onClick={() => setStaffingTab('swaps')}>
          🔄 Swaps & Absences {pendingSwaps > 0 && countBadge(pendingSwaps)}
        </button>
        <button style={subTabStyle(staffingTab === 'reschedules')} onClick={() => setStaffingTab('reschedules')}>
          🕐 Reschedules {reschedReqs.length > 0 && countBadge(reschedReqs.length)}
        </button>
        <button style={subTabStyle(staffingTab === 'availability')} onClick={() => setStaffingTab('availability')}>⏰ Availability</button>
      </div>

      {staffingTab === 'reschedules' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>🕐 Reschedule Requests</h3>
            <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={loadReschedules}>↻ Refresh</button>
          </div>
          <div style={{ fontSize: '0.85rem', color: C.muted, marginBottom: '0.75rem' }}>
            Approving moves the shift on the schedule — the caregiver's phone, the grid, payroll and billing all follow. Denying leaves it exactly as it is.
          </div>
          {reschedLoading ? loadingCard('Loading...', '1.5rem') :
            reschedReqs.length === 0 ? emptyCard('Nothing waiting') : (
              <div className="hc-card" style={{ overflowX: 'auto' }}>
                <table className="hc-table" style={{ fontSize: '0.88rem' }}>
                  <thead><tr><th>Asked by</th><th>Client</th><th>Caregiver</th><th>Now</th><th>→</th><th>Requested</th><th>Reason</th><th>Actions</th></tr></thead>
                  <tbody>
                    {reschedReqs.map((cr) => (
                      <tr key={cr.id}>
                        <td><span style={pill(cr.requestedBy === 'caregiver' ? 'blue' : 'amber')}>{(cr.requestedBy || 'client').toUpperCase()}</span></td>
                        <td><strong>{cr.clientFirstName} {cr.clientLastName}</strong></td>
                        <td>{cr.caregiverFirstName} {cr.caregiverLastName}</td>
                        <td>{formatDate(cr.visitDate, { month: 'short', day: 'numeric' })} {cr.originalStartTime?.slice(0, 5)}–{cr.originalEndTime?.slice(0, 5)}</td>
                        <td>→</td>
                        <td>
                          {cr.requestType === 'cancel'
                            ? <em style={{ color: red.ink }}>Cancel</em>
                            : <strong>{formatDate(cr.proposedDate, { month: 'short', day: 'numeric' })} {cr.proposedStartTime?.slice(0, 5)}–{cr.proposedEndTime?.slice(0, 5)}</strong>}
                        </td>
                        <td style={{ maxWidth: 220 }}>{cr.requestReason || cr.cancelReason || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button className="hc-btn hc-btn-sm hc-btn-success" disabled={reschedBusy === cr.id} onClick={() => resolveReschedule(cr.id, 'approve')}>✓ Approve</button>
                            <button className="hc-btn hc-btn-sm hc-btn-danger" disabled={reschedBusy === cr.id}
                              onClick={async () => {
                                // The deny note goes to whoever asked: the client's portal for a client request, the caregiver's phone otherwise.
                                const who = cr.requestedBy === 'client' ? 'the client sees this in their portal' : 'the caregiver sees this'
                                const note = await prompt(`Reason for denying (${who}):`, { title: 'Deny request', confirmText: 'Deny' })
                                if (note === null) return
                                resolveReschedule(cr.id, 'deny', note)
                              }}>✗ Deny</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {staffingTab === 'open-shifts' && (
        <div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <select value={openShiftFilter} onChange={(e) => setOpenShiftFilter(e.target.value)} style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: `1px solid ${C.line}` }}>
              <option value="active">Open &amp; waiting for approval</option><option value="open">Open</option><option value="claimed">Waiting for approval</option><option value="filled">Filled</option><option value="cancelled">Removed</option><option value="all">All</option>
            </select>
            <button className="hc-btn hc-btn-primary hc-btn-sm" onClick={() => { setCreateShiftPreFill({}); setShowCreateShift(true) }}>+ Post Open Shift</button>
          </div>
          {openShiftsLoading ? loadingCard() :
            openShifts.length === 0 ? emptyCard(<><div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>No {openShiftFilter || ''} open shifts</>, '2rem') : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {openShifts.map((shift) => (
                  <div key={shift.id} className="hc-card" style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <strong>{shift.clientFirstName || ''} {shift.clientLastName || ''}</strong>
                        <div style={{ fontSize: '0.85rem', color: C.muted }}>{shift.shiftDate ? formatDate(shift.shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }) : ''} · {formatTime(shift.startTime)} – {formatTime(shift.endTime)}</div>
                        <div style={{ fontSize: '0.82rem', color: C.inkSoft, marginTop: '0.3rem' }}>Offered to: {shift.offeredTo || 'all caregivers'}</div>
                        {shift.claimedByFirst && (
                          <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {shift.status === 'filled' ? 'Taken by' : 'Accepted by'} <strong>{shift.claimedByFirst} {shift.claimedByLast}</strong>
                          </div>
                        )}
                        {shift.notes && <div style={{ fontSize: '0.82rem', color: C.muted, marginTop: '0.3rem' }}>{shift.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={statusPill(shift.status, { open: 'amber', claimed: 'blue', cancelled: 'neutral' }, 'green')}>
                          {shift.status === 'claimed' ? 'WAITING FOR APPROVAL' : shift.status === 'cancelled' ? 'REMOVED' : shift.status?.toUpperCase()}
                        </span>
                        {shift.urgency === 'urgent' && <span style={pill('red')}>URGENT</span>}
                        {shift.status === 'claimed' && <>
                          <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => approveOpenShift(shift)}>✓ Approve</button>
                          <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => turnDownOpenShift(shift)}>✗ Turn down</button>
                        </>}
                        {(shift.status === 'open' || shift.status === 'claimed') && (
                          <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => removeOpenShift(shift)}>🗑 Remove</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {staffingTab === 'swaps' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>🔄 Shift Swaps</h3>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['', 'pending', 'accepted', 'approved', 'rejected'].map((f) => (
                <button key={f} className={`hc-btn hc-btn-sm ${swapFilter === f ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setSwapFilter(f)}>{f ? f.charAt(0).toUpperCase() + f.slice(1) : 'All'}</button>
              ))}
            </div>
          </div>
          {swapsLoading ? loadingCard('Loading...', '1.5rem') :
            swaps.length === 0 ? emptyCard('No swap requests found') : (
              <div className="hc-card" style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                <table className="hc-table" style={{ fontSize: '0.88rem' }}>
                  <thead><tr><th>Date</th><th>Time</th><th>Client</th><th>From</th><th>→</th><th>To</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {swaps.map((sw) => (
                      <tr key={sw.id}>
                        <td><strong>{sw.shiftDate ? formatDate(sw.shiftDate, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</strong></td>
                        <td>{sw.startTime?.slice(0, 5)}–{sw.endTime?.slice(0, 5)}</td>
                        <td>{sw.clientFirst} {sw.clientLast}</td>
                        <td><strong>{sw.requesterFirst} {sw.requesterLast}</strong></td>
                        <td>→</td>
                        <td>{sw.targetFirst ? <strong>{sw.targetFirst} {sw.targetLast}</strong> : <em style={{ color: C.muted }}>Open</em>}</td>
                        <td><span style={statusPill(sw.status, { pending: 'amber', accepted: 'blue', approved: 'green' }, 'red')}>{sw.status?.toUpperCase()}</span></td>
                        <td>{sw.status === 'accepted' && <div style={{ display: 'flex', gap: '0.25rem' }}><button className="hc-btn hc-btn-sm hc-btn-success" title="Approve swap" aria-label="Approve swap" onClick={() => approveSwap(sw)}>✓</button><button className="hc-btn hc-btn-sm hc-btn-danger" title="Turn down swap" aria-label="Turn down swap" onClick={() => rejectSwap(sw.id)}>✗</button></div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>📋 Absences</h3>
            <button className="hc-btn hc-btn-primary hc-btn-sm" onClick={() => setShowAbsenceForm(!showAbsenceForm)}>{showAbsenceForm ? '✕ Cancel' : '+ Record Absence'}</button>
          </div>
          {showAbsenceForm && (
            <div className="hc-card" style={{ marginBottom: '1rem' }}>
              <form onSubmit={recordAbsence}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group"><label>Caregiver *</label><select value={absenceForm.caregiverId} onChange={(e) => setAbsenceForm({ ...absenceForm, caregiverId: e.target.value })} required><option value="">Select...</option>{caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}</select></div>
                  <div className="form-group"><label>Date *</label><input type="date" value={absenceForm.date} onChange={(e) => setAbsenceForm({ ...absenceForm, date: e.target.value })} required /></div>
                  <div className="form-group"><label>Type</label><select value={absenceForm.type} onChange={(e) => setAbsenceForm({ ...absenceForm, type: e.target.value })}><option value="call_out">Call Out</option><option value="no_show">No Show</option><option value="sick">Sick</option><option value="personal">Personal</option></select></div>
                </div>
                <div className="form-group"><label>Reason</label><textarea value={absenceForm.reason} onChange={(e) => setAbsenceForm({ ...absenceForm, reason: e.target.value })} rows={2} /></div>
                <button type="submit" className="hc-btn hc-btn-primary hc-btn-sm">Record Absence</button>
              </form>
            </div>
          )}

          {/* After an absence: offer to post an open shift for each client it leaves uncovered */}
          {pendingAbsenceShift && (
            <div className="hc-card" style={{ marginBottom: '1rem', border: `2px solid ${amber.line}`, background: amber.bg }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: amber.ink, marginBottom: '0.5rem' }}>⚠️ Absence recorded — these clients need coverage:</div>
                  {pendingAbsenceShift.schedules.map((sched, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: C.surface, borderRadius: '6px', marginBottom: '0.35rem' }}>
                      <div style={{ flex: 1, fontSize: '0.88rem' }}>
                        <strong>{getClientName(sched.clientId)}</strong>
                        <span style={{ color: C.muted, marginLeft: '0.5rem' }}>{formatTime(sched.startTime)} – {formatTime(sched.endTime)}</span>
                        <span style={{ color: C.muted, marginLeft: '0.5rem' }}>{formatDay(pendingAbsenceShift.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      </div>
                      <button onClick={() => postOpenShiftFromAbsence(sched)} style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', border: 'none', background: FILL.amber, color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}>Post Open Shift →</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setPendingAbsenceShift(null)} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: C.inkSoft, cursor: 'pointer', fontSize: '1.2rem', marginLeft: '0.5rem' }}>×</button>
              </div>
            </div>
          )}

          {absencesLoading ? loadingCard('Loading...', '1.5rem') :
            absences.length === 0 ? emptyCard('No absences recorded') : (
              <div className="hc-card" style={{ overflowX: 'auto' }}>
                <table className="hc-table" style={{ fontSize: '0.88rem' }}>
                  <thead><tr><th>Caregiver</th><th>Date</th><th>Type</th><th>Reason</th><th>Actions</th></tr></thead>
                  <tbody>
                    {absences.map((ab) => (
                      <tr key={ab.id}>
                        <td><strong>{getCaregiverName(ab.caregiverId)}</strong></td>
                        <td>{formatDate(ab.date)}</td>
                        <td><span style={statusPill(ab.type, { no_show: 'red', sick: 'blue' }, 'amber')}>{ab.type?.replace('_', ' ').toUpperCase()}</span></td>
                        <td>{ab.reason || '—'}</td>
                        <td><button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => deleteAbsence(ab.id)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {staffingTab === 'availability' && (
        <div>
          <div className="hc-card" style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Caregiver Availability</h3>
            <select value={availCaregiver} onChange={(e) => loadAvailability(e.target.value)} style={{ width: '100%', padding: '0.6rem', fontSize: '0.95rem', borderRadius: '6px', border: `1px solid ${C.line}` }}>
              <option value="">Select a caregiver...</option>
              {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
            </select>
          </div>
          {availCaregiver && (
            <>
              <div className="hc-card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem' }}>Status & Capacity</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group"><label>Status</label><select value={String(availForm.status)} onChange={(e) => setAvailForm({ ...availForm, status: e.target.value })}><option value="available">Available</option><option value="on_call">On-Call</option><option value="medical_leave">Medical Leave</option><option value="vacation">Vacation</option><option value="unavailable">Unavailable</option></select></div>
                  <div className="form-group"><label>Max Hours/Week</label><input type="number" value={String(availForm.maxHoursPerWeek)} onChange={(e) => setAvailForm({ ...availForm, maxHoursPerWeek: e.target.value })} min="0" step="5" /></div>
                </div>
              </div>
              <div className="hc-card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.75rem' }}>Weekly Schedule</h3>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {DAYS_OF_WEEK.map((day) => {
                    const avKey = `${day.key}Available`, stKey = `${day.key}StartTime`, enKey = `${day.key}EndTime`
                    const on = !!availForm[avKey]
                    return (
                      <div key={day.key} style={{ padding: '0.6rem 0.75rem', background: on ? green.bg : C.hover, borderRadius: '6px', border: `1px solid ${on ? green.line : C.line}` }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', marginBottom: on ? '0.5rem' : 0 }}>
                          <input type="checkbox" checked={on} onChange={(e) => setAvailForm({ ...availForm, [avKey]: e.target.checked })} style={{ width: 'auto' }} />
                          <strong style={{ minWidth: '40px' }}>{day.label}</strong>
                          {!on && <span style={{ fontSize: '0.82rem', color: C.muted }}>Off</span>}
                        </label>
                        {on && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '2rem' }}>
                            <input type="time" value={String(availForm[stKey])} onChange={(e) => setAvailForm({ ...availForm, [stKey]: e.target.value })} style={{ padding: '0.3rem', borderRadius: '4px', border: `1px solid ${C.line}` }} />
                            <span style={{ alignSelf: 'center' }}>to</span>
                            <input type="time" value={String(availForm[enKey])} onChange={(e) => setAvailForm({ ...availForm, [enKey]: e.target.value })} style={{ padding: '0.3rem', borderRadius: '4px', border: `1px solid ${C.line}` }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button className="hc-btn hc-btn-primary" onClick={saveAvailability} style={{ marginTop: '1rem' }}>Save Availability</button>
              </div>
              <div className="hc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>🚫 Blackout Dates</h3>
                  <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setShowBlackoutForm(!showBlackoutForm)}>{showBlackoutForm ? 'Cancel' : '+ Add'}</button>
                </div>
                {showBlackoutForm && (
                  <form onSubmit={addBlackout} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: `1px solid ${C.subtle}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <div className="form-group"><label>Start *</label><input type="date" value={newBlackout.startDate} onChange={(e) => setNewBlackout({ ...newBlackout, startDate: e.target.value })} required /></div>
                      <div className="form-group"><label>End *</label><input type="date" value={newBlackout.endDate} onChange={(e) => setNewBlackout({ ...newBlackout, endDate: e.target.value })} required /></div>
                    </div>
                    <div className="form-group"><label>Reason</label><input type="text" value={newBlackout.reason} onChange={(e) => setNewBlackout({ ...newBlackout, reason: e.target.value })} placeholder="e.g., Vacation" /></div>
                    <button type="submit" className="hc-btn hc-btn-primary hc-btn-sm">Add Blackout</button>
                  </form>
                )}
                {blackoutDates.length === 0 ? <p style={{ color: C.muted, textAlign: 'center', padding: '0.75rem' }}>No blackout dates</p> : (
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {[...blackoutDates].sort((a, b) => parseLocalDate(a.startDate).getTime() - parseLocalDate(b.startDate).getTime()).map((bd) => (
                      <div key={bd.id} style={{ padding: '0.6rem 0.75rem', background: red.bg, borderLeft: '3px solid #DC2626', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div><strong style={{ fontSize: '0.88rem' }}>{formatDate(bd.startDate)} – {formatDate(bd.endDate)}</strong>{bd.reason && <div style={{ fontSize: '0.82rem', color: C.inkSoft }}>{bd.reason}</div>}</div>
                        <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => deleteBlackout(bd.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  // The Edit Schedule and Move-to-Available pop-ups, rendered by BOTH returns below: the create form returns early, and
  // without them there a click on a "Current Schedule" row did nothing.
  const renderScheduleModals = () => (
    <>
      {editModal && (
        <div style={overlay(2000)} onClick={() => setEditModal(null)}>
          <div style={{ ...dialog, padding: '1.5rem', maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0, color: blue.ink }}>✏️ Edit Schedule</h3>
              <button onClick={() => setEditModal(null)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: C.muted }}>✕</button>
            </div>
            <div style={{ marginBottom: '1.25rem', padding: '0.5rem 0.75rem', background: blue.bg, borderRadius: '6px', fontSize: '0.85rem', color: blue.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span>{editModal.scheduleType === 'recurring' ? '🔄 Recurring' : '📅 One-Time'} Schedule</span>
              {editModal.scheduleType === 'recurring' && (
                <div>
                  <div style={{ display: 'flex', gap: '0.3rem', marginBottom: editModal.frequency === 'biweekly' ? '0.4rem' : 0 }}>
                    <button type="button" onClick={() => setEditModal((prev) => prev && ({ ...prev, frequency: 'weekly', anchorDate: null }))} style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', background: editModal.frequency === 'weekly' ? FILL.blue : C.line, color: editModal.frequency === 'weekly' ? '#fff' : C.ink }}>Weekly</button>
                    <button type="button" onClick={() => setEditModal((prev) => prev && ({ ...prev, frequency: 'biweekly', anchorDate: prev.anchorDate || prev.editDate || getTodayCT() }))} style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', border: 'none', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', background: editModal.frequency === 'biweekly' ? FILL.orange : C.line, color: editModal.frequency === 'biweekly' ? '#fff' : C.ink }}>Bi-Weekly</button>
                  </div>
                  {editModal.frequency === 'biweekly' && (
                    <div style={{ padding: '0.5rem', background: orange.bg, borderRadius: '6px', border: `1px solid ${orange.line}` }}>
                      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: orange.ink, marginBottom: '0.25rem' }}>📅 First "on" date (this weekday, then every 2 weeks)</label>
                      <input type="date" value={editModal.anchorDate || ''} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, anchorDate: e.target.value }))} style={{ width: '100%', padding: '0.3rem', border: `1px solid ${C.line}`, borderRadius: '4px', fontSize: '0.82rem' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* A repeating shift is ONE row every week is re-derived from, so an edit has to say which weeks it means:
                without this every edit silently changed weeks already worked. */}
            {editModal.scheduleType === 'recurring' && (() => {
              const dayName = getDayName(parseInt(editModal.dayOfWeek))
              const opts: Array<{ key: EditScope; label: string; hint: string; warn?: boolean }> = [
                { key: 'this', label: 'Just this day', hint: 'Only the date below changes. Every other week stays as it is.' },
                { key: 'following', label: `This day and all future ${dayName}s`, hint: 'Use when the shift changed for good. Weeks before the date below are left alone.' },
                { key: 'all', label: `Every ${dayName} — past and future`, hint: 'Also changes weeks already worked, including ones payroll has been run on.', warn: true },
              ]
              return (
                <div style={{ marginBottom: '1.25rem', padding: '0.85rem', background: C.subtle, borderRadius: '8px', border: `1px solid ${C.line}` }}>
                  <label style={{ display: 'block', marginBottom: '0.6rem', fontWeight: 700, fontSize: '0.9rem', color: C.ink }}>Apply this change to</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {opts.map((o) => {
                      const on = editModal.scope === o.key
                      const t = o.warn ? red : blue
                      return (
                        <button key={o.key} type="button" onClick={() => setEditModal((prev) => prev && ({ ...prev, scope: o.key }))}
                          style={{ textAlign: 'left', padding: '0.6rem 0.7rem', borderRadius: '6px', cursor: 'pointer', border: on ? `2px solid ${t.ink}` : `2px solid ${C.line}`, background: on ? t.bg : C.surface, color: C.ink }}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem', color: on && o.warn ? red.ink : C.ink }}>
                            {on ? '● ' : '○ '}{o.label}{o.warn ? '  ⚠️' : ''}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: on && o.warn ? red.ink : C.inkSoft, marginTop: '0.15rem', paddingLeft: '1rem' }}>{o.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                  {editModal.scope !== 'all' && (
                    <div style={{ marginTop: '0.7rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600, fontSize: '0.8rem', color: C.ink }}>
                        {editModal.scope === 'this' ? 'Which day?' : 'Changed as of'}
                      </label>
                      <input type="date" value={editModal.editDate || ''} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, editDate: e.target.value }))}
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.88rem' }} />
                      <div style={{ fontSize: '0.74rem', color: C.inkSoft, marginTop: '0.25rem' }}>A past date is fine — that is how you correct a week before running payroll.</div>
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{ marginBottom: '1rem' }}>
              <label style={lbl9}>Client</label>
              <select value={editModal.clientId} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, clientId: e.target.value }))} style={bigField}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
            {editModal.scheduleType === 'recurring' ? (
              <div style={{ marginBottom: '1rem' }}>
                <label style={lbl9}>Day of Week</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.4rem' }}>
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => {
                    const on = editModal.dayOfWeek === idx.toString()
                    return (
                      <button key={day} type="button" onClick={() => setEditModal((prev) => prev && ({ ...prev, dayOfWeek: idx.toString() }))}
                        style={{ padding: '0.5rem 0.2rem', borderRadius: '6px', border: `2px solid ${on ? FILL.blue : C.line}`, background: on ? FILL.blue : C.surface, color: on ? '#fff' : C.ink, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>{day}</button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                <label style={lbl9}>Date</label>
                <input type="date" value={editModal.date} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, date: e.target.value }))} style={bigField} />
              </div>
            )}
            <div style={{ marginBottom: '1rem' }}>
              <label style={lbl9}>Quick Presets</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {SHIFT_PRESETS.map((p, i) => <button key={i} type="button" onClick={() => setEditModal((prev) => prev && ({ ...prev, startTime: p.start, endTime: p.end }))} style={presetBtn(editModal.startTime === p.start && editModal.endTime === p.end)}>{p.label}</button>)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div><label style={lbl9}>Start Time</label><input type="time" value={editModal.startTime} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, startTime: e.target.value }))} style={bigField} /></div>
              <div><label style={lbl9}>End Time</label><input type="time" value={editModal.endTime} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, endTime: e.target.value }))} style={bigField} /></div>
            </div>
            <div style={{ marginBottom: '1rem', padding: '0.5rem', background: C.subtle, borderRadius: '6px', textAlign: 'center', fontSize: '0.9rem' }}>
              <span style={{ fontWeight: 600 }}>{formatTime(editModal.startTime)} – {formatTime(editModal.endTime)}</span>
              <span style={{ color: C.inkSoft, marginLeft: '0.75rem' }}>({calculateHours(editModal.startTime, editModal.endTime)} hours)</span>
            </div>
            {overnightCheck(editModal.startTime, editModal.endTime, editModal.overnight, (v) => setEditModal((prev) => prev && ({ ...prev, overnight: v })))}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={lbl9}>Notes</label>
              <textarea value={editModal.notes} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, notes: e.target.value }))} placeholder="Optional notes..." rows={2} style={{ ...bigField, resize: 'vertical' }} />
            </div>
            {/* Suspend / resume service — pause visits without deleting the schedule */}
            {editModal.scheduleType === 'recurring' && (
              <div style={{ marginBottom: '1.25rem', padding: '0.85rem', borderRadius: '8px', background: editModal.suspendedFrom ? amber.bg : C.subtle, border: `1px solid ${editModal.suspendedFrom ? amber.line : C.line}` }}>
                {editModal.suspendedFrom ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: amber.ink, marginBottom: '0.5rem' }}>
                      ⏸ Service suspended from {formatDay(editModal.suspendedFrom, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" disabled={suspendBusy} onClick={() => handleResume('this')} className="hc-btn hc-btn-secondary" style={{ flex: 1, minWidth: '140px' }}>▶ Resume {getDayName(parseInt(editModal.dayOfWeek))}s</button>
                      <button type="button" disabled={suspendBusy} onClick={() => handleResume('client')} className="hc-btn hc-btn-secondary" style={{ flex: 1, minWidth: '140px' }}>▶ Resume all {getClientName(editModal.clientId)}’s days</button>
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'block', fontWeight: 700, fontSize: '0.9rem', color: C.ink, marginBottom: '0.5rem' }}>Suspend service</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: C.inkSoft }}>Starting</span>
                      <input type="date" value={editModal.suspendFromDate || toLocalYMD(new Date())} onChange={(e) => setEditModal((prev) => prev && ({ ...prev, suspendFromDate: e.target.value }))}
                        style={{ padding: '0.4rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.85rem' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" disabled={suspendBusy} onClick={() => handleSuspend('this')} className="hc-btn hc-btn-secondary" style={{ flex: 1, minWidth: '140px' }}>⏸ Just {getDayName(parseInt(editModal.dayOfWeek))}s</button>
                      <button type="button" disabled={suspendBusy} onClick={() => handleSuspend('client')} className="hc-btn hc-btn-secondary" style={{ flex: 1, minWidth: '140px', border: `1px solid ${amber.line}`, color: amber.ink }}>⏸ All {getClientName(editModal.clientId)}’s days</button>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: C.inkSoft, marginTop: '0.4rem' }}>Pauses visits from that date on. Nothing is deleted — past visits stay, and you can resume anytime.</div>
                  </>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={handleSaveEdit} disabled={editSaving} className="hc-btn hc-btn-primary" style={{ flex: 1, minWidth: '160px' }}>{editSaving ? 'Saving...' : '✓ Save Changes'}</button>
              <button type="button"
                onClick={() => {
                  setMakeAvailableModal({
                    schedule: { id: editModal.id, date: editModal.date || null, startTime: editModal.startTime, endTime: editModal.endTime, caregiverId: editModal.caregiverId },
                    date: editModal.date || editModal.editDate,
                    clientName: getClientName(editModal.clientId),
                    caregiverName: getCaregiverName(editModal.caregiverId || selectedCaregiverId),
                  })
                  setEditModal(null)
                }}
                className="hc-btn" style={{ background: FILL.amber, color: '#fff', border: 'none' }}
                title="Mark this shift as available for another caregiver to pick up">📋 Move to Available Shifts</button>
              <button onClick={() => setEditModal(null)} className="hc-btn hc-btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {makeAvailableModal && (
        <MakeShiftAvailableModal
          schedule={makeAvailableModal.schedule}
          date={makeAvailableModal.date}
          clientName={makeAvailableModal.clientName}
          caregiverName={makeAvailableModal.caregiverName}
          onClose={() => setMakeAvailableModal(null)}
          onDone={({ notified, texted, warning }) => {
            showMsg(warning || `Posted to Available Shifts — ${notified} caregiver${notified === 1 ? '' : 's'} can accept it${texted ? `, ${texted} texted` : ''}`, warning ? 'warning' : 'success')
            loadCaregiverSchedules(selectedCaregiverId)
            if (mainTab === 'staffing' && staffingTab === 'open-shifts') loadOpenShifts()
          }}
        />
      )}
    </>
  )

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  // ── The create form replaces the whole page ──
  if (createPanelOpen) {
    const { recurringByDay, oneTimeByDate } = groupSchedules()
    const multi = formData.scheduleType === 'multi-day' || formData.scheduleType === 'bi-weekly'
    const bi = formData.scheduleType === 'bi-weekly'
    const kindTone = bi ? orange : blue
    const kindFill = bi ? FILL.orange : FILL.blue
    const scheduleItem: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: C.subtle, border: `1px solid ${C.line}`, borderRadius: '8px', marginBottom: '0.4rem', fontSize: '0.88rem', cursor: 'pointer' }
    const groupHead: CSSProperties = { fontSize: '0.82rem', fontWeight: 700, color: blue.ink, marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }
    const binBtn: CSSProperties = { background: 'none', border: 'none', color: red.ink, cursor: 'pointer', fontSize: '1rem' }
    const dayPick = (on: boolean, fill: string): CSSProperties => ({
      padding: '0.5rem 0.1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
      border: `2px solid ${on ? fill : C.line}`, background: on ? fill : C.surface, color: on ? '#fff' : C.ink,
    })
    const smallDate: CSSProperties = { width: '100%', padding: '0.5rem', borderRadius: '6px', border: `1px solid ${C.line}`, fontSize: '0.88rem' }
    const dateRange = (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600, fontSize: '0.82rem' }}>Start Date *</label>
          <input type="date" value={formData.date} onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))} style={smallDate} />
        </div>
        {/* "End Date" is not sent: neither create takes an end date (nor did the template's). */}
        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600, fontSize: '0.82rem' }}>End Date <span style={{ color: C.inkSoft, fontWeight: 400 }}>(optional)</span></label>
          <input type="date" value={formData.endDate || ''} onChange={(e) => setFormData((prev) => ({ ...prev, endDate: e.target.value }))} min={formData.date || undefined} style={smallDate} />
        </div>
      </div>
    )
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: `2px solid ${C.line}` }}>
          <button onClick={closeCreatePanel} style={{ background: C.subtle, border: 'none', borderRadius: '8px', padding: '0.5rem 0.85rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, color: C.ink }}>← Back</button>
          <h2 style={{ margin: 0 }}>➕ New Schedule</h2>
        </div>

        <div style={{ display: 'flex', gap: '2.5rem', alignItems: 'flex-start' }}>
          {/* LEFT — the form */}
          <div style={{ flex: '0 0 480px', minWidth: 0 }}>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>Caregiver *</label>
                <button type="button" onClick={loadSuggestions} disabled={suggestLoading || !formData.clientId}
                  title={formData.clientId ? 'Rank caregivers by fit (preferences, availability, distance, certs, OT)' : 'Pick a client first'}
                  style={{ background: 'none', border: `1px solid ${C.brandLine}`, color: C.brandInk, borderRadius: 6, padding: '0.2rem 0.55rem', fontSize: '0.78rem', fontWeight: 700, cursor: formData.clientId ? 'pointer' : 'not-allowed', opacity: formData.clientId ? 1 : 0.5 }}>
                  {suggestLoading ? '…' : '✨ Suggest'}
                </button>
              </div>
              <select value={selectedCaregiverId} onChange={(e) => handleCaregiverSelectCreate(e.target.value)} style={{ ...bigField, padding: '0.65rem' }}>
                <option value="">Choose a caregiver...</option>
                {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
              </select>

              {showSuggestions && (
                <div style={{ marginTop: '0.5rem', border: `1px solid ${C.line}`, borderRadius: 8, padding: '0.5rem', background: C.hover, maxHeight: 320, overflow: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ fontSize: '0.82rem', color: C.ink }}>Ranked suggestions ({suggestions.length})</strong>
                    <button type="button" onClick={() => setShowSuggestions(false)} aria-label="Close suggestions" style={{ background: 'none', border: 'none', color: C.inkSoft, cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                  </div>
                  {suggestions.length === 0 && <div style={{ padding: '0.5rem', fontSize: '0.82rem', color: C.inkSoft }}>No matches found. Try a different time or date.</div>}
                  {suggestions.slice(0, 12).map((sg, idx) => {
                    const t = tierStyle(sg.tier)
                    return (
                      <button key={sg.id} type="button" onClick={() => { handleCaregiverSelectCreate(sg.id); setShowSuggestions(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.6rem', marginBottom: 4, background: C.surface, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700 }}>{idx + 1}. {sg.firstName} {sg.lastName}</span>
                          <span style={{ background: tint(t.tone).bg, color: tint(t.tone).ink, fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{t.label} · {sg.score}</span>
                        </div>
                        {sg.reasons && sg.reasons.length > 0 && <div style={{ marginTop: 3, fontSize: '0.72rem', color: C.muted }}>{sg.reasons.slice(0, 4).join(' · ')}</div>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {cgPatterns && cgPatterns.riskDays?.length > 0 && (
              <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.82rem', background: orange.bg, border: `1px solid ${orange.line}`, color: orange.ink }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Reliability alert ({cgPatterns.overallReliability}% overall)</div>
                {cgPatterns.riskDays.map((d, i) => (
                  <div key={i} style={{ fontSize: '0.78rem' }}>{d.day}: {d.reliabilityPct}% reliable ({d.absences} absences, {d.noShows} no-shows, {d.lateArrivals} late in {cgPatterns.periodMonths}mo)</div>
                ))}
              </div>
            )}

            {conflicts.length > 0 && (
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: red.bg, border: `1px solid ${red.line}`, borderRadius: '8px', color: red.ink }}>
                <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>⚠️ Existing Conflicts</div>
                {conflicts.map((c, i) => <div key={i} style={{ fontSize: '0.82rem' }}>{getDayName(c.day)}: overlapping shifts</div>)}
              </div>
            )}

            {selectedCaregiverId && (
              <form onSubmit={handleCreateSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={lbl9}>Type</label>
                  <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: `2px solid ${C.line}` }}>
                    {([{ type: 'one-time', icon: '📅', label: 'One-Time' }, { type: 'multi-day', icon: '📆', label: 'Multi-Day' }, { type: 'recurring', icon: '🔄', label: 'Recurring' }, { type: 'bi-weekly', icon: '📊', label: 'Bi-Weekly' }] as const).map((opt, i) => {
                      const on = formData.scheduleType === opt.type
                      return (
                        <button key={opt.type} type="button" onClick={() => { setFormData((prev) => ({ ...prev, scheduleType: opt.type, dayOfWeek: '' })); setSelectedDays([]) }}
                          style={{ flex: 1, padding: '0.6rem 0.2rem', border: 'none', borderLeft: i > 0 ? `2px solid ${C.line}` : 'none', background: on ? FILL.blue : C.surface, color: on ? '#fff' : C.ink, cursor: 'pointer', fontSize: '0.78rem' }}>
                          {opt.icon} {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {formData.scheduleType === 'one-time' && (
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={lbl9}>Date *</label>
                    <input type="date" value={formData.date} onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))} required style={{ ...bigField, padding: '0.65rem' }} />
                  </div>
                )}

                {multi && (
                  <div style={{ marginBottom: '1rem', background: kindTone.bg, padding: '0.85rem', borderRadius: '8px', border: `1px solid ${kindTone.line}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <label style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>{bi ? 'Days (Every Other Week) *' : 'Select Days *'}</label>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button type="button" onClick={selectWeekdays} style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', border: 'none', background: kindFill, color: '#fff', cursor: 'pointer', fontSize: '0.72rem' }}>Mon–Fri</button>
                        <button type="button" onClick={clearDays} style={{ padding: '0.25rem 0.6rem', borderRadius: '4px', border: `1px solid ${C.line}`, background: C.surface, color: C.inkSoft, cursor: 'pointer', fontSize: '0.72rem' }}>Clear</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.35rem', marginBottom: '0.5rem' }}>
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
                        <button key={day} type="button" onClick={() => toggleDaySelection(idx)} style={dayPick(selectedDays.includes(idx), kindFill)}>{day}</button>
                      ))}
                    </div>
                    {bi && (
                      <div style={{ padding: '0.6rem', background: C.surface, borderRadius: '6px', border: `1px solid ${orange.line}`, marginBottom: '0.75rem' }}>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: orange.ink, marginBottom: '0.3rem' }}>📅 First "on" date</label>
                        <input type="date" value={biWeeklyAnchorDate || formData.date} onChange={(e) => setBiWeeklyAnchorDate(e.target.value)} style={smallDate} />
                        <div style={{ fontSize: '0.72rem', color: orange.ink, marginTop: '0.3rem' }}>Defaults to the Start Date. Each selected day begins on or after this date, then repeats every 2 weeks — Sat + Sun starting on a Saturday stay on the same weekend.</div>
                      </div>
                    )}
                    {dateRange}
                  </div>
                )}

                {formData.scheduleType === 'recurring' && (
                  <div style={{ marginBottom: '1rem', background: blue.bg, padding: '0.85rem', borderRadius: '8px', border: `1px solid ${blue.line}` }}>
                    <label style={lbl9}>Day of Week *</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.35rem', marginBottom: '0.75rem' }}>
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day, idx) => (
                        <button key={day} type="button" onClick={() => setFormData((prev) => ({ ...prev, dayOfWeek: idx.toString() }))} style={dayPick(formData.dayOfWeek === idx.toString(), FILL.blue)}>{day}</button>
                      ))}
                    </div>
                    {dateRange}
                  </div>
                )}

                <div style={{ marginBottom: '1rem' }}>
                  <label style={lbl9}>Client *</label>
                  <select value={formData.clientId} onChange={(e) => setFormData((prev) => ({ ...prev, clientId: e.target.value }))} required style={{ ...bigField, padding: '0.65rem' }}>
                    <option value="">Select client...</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.serviceType ? ` (${c.serviceType.replace(/_/g, ' ')})` : ''}</option>)}
                  </select>
                </div>

                {/* ── Scheduling warnings ── */}
                {otWarning && otWarning.warnings?.length > 0 && (
                  <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.82rem', background: amber.bg, border: `1px solid ${amber.line}`, color: amber.ink }}>
                    {otWarning.warnings.map((w, i) => <div key={i} style={{ fontWeight: 600 }}>{w}</div>)}
                    <div style={{ fontSize: '0.75rem', marginTop: 2, fontWeight: 400 }}>Current: {otWarning.currentWeeklyHours}h + This shift: {otWarning.proposedHours}h = {otWarning.projectedHours}h</div>
                  </div>
                )}
                {travelWarning && travelWarning.hasTravelConflict && (
                  <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: 8, fontSize: '0.82rem', background: orange.bg, border: `1px solid ${orange.line}`, color: orange.ink }}>
                    <div style={{ fontWeight: 600 }}>Travel time warning</div>
                    {travelWarning.adjacentShifts.filter((s) => s.isInsufficient).map((s, i) => (
                      <div key={i} style={{ fontSize: '0.78rem', marginTop: 2 }}>{s.gapMinutes} min gap to {s.clientName} but ~{s.estimatedDriveMinutes} min drive ({s.distanceMiles} mi)</div>
                    ))}
                  </div>
                )}

                <div style={{ marginBottom: '1rem' }}>
                  <label style={lbl9}>Quick Presets</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {SHIFT_PRESETS.map((p, i) => <button key={i} type="button" onClick={() => applyPreset(p)} style={presetBtn(formData.startTime === p.start && formData.endTime === p.end)}>{p.label}</button>)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <div><label style={lbl9}>Start *</label><input type="time" value={formData.startTime} onChange={(e) => setFormData((prev) => ({ ...prev, startTime: e.target.value }))} required style={{ ...bigField, padding: '0.65rem' }} /></div>
                  <div><label style={lbl9}>End *</label><input type="time" value={formData.endTime} onChange={(e) => setFormData((prev) => ({ ...prev, endTime: e.target.value }))} required style={{ ...bigField, padding: '0.65rem' }} /></div>
                </div>
                <div style={{ marginBottom: '1rem', padding: '0.6rem', background: C.subtle, borderRadius: '8px', textAlign: 'center', fontSize: '0.88rem' }}>
                  <span style={{ fontWeight: 600 }}>{formatTime(formData.startTime)} – {formatTime(formData.endTime)}</span>
                  <span style={{ color: C.inkSoft, marginLeft: '0.75rem' }}>({calculateHours(formData.startTime, formData.endTime)}h)</span>
                </div>
                {overnightCheck(formData.startTime, formData.endTime, formData.overnight, (v) => setFormData((prev) => ({ ...prev, overnight: v })))}

                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={lbl9}>Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Special instructions..." rows={2} style={{ ...bigField, padding: '0.65rem', resize: 'vertical' }} />
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.75rem', borderRadius: '8px', background: formData.isTraining ? amber.bg : C.subtle, border: '1px solid', borderColor: formData.isTraining ? amber.line : C.line, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!formData.isTraining} onChange={(e) => setFormData((prev) => ({ ...prev, isTraining: e.target.checked }))} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: formData.isTraining ? amber.ink : C.ink }}>Training shift (don't bill client)</div>
                    <div style={{ fontSize: '0.78rem', color: C.inkSoft, marginTop: 2 }}>Use this for a trainee shadowing another caregiver. The caregiver still gets paid; the client is not double-billed.</div>
                  </div>
                </label>
                <button type="submit" className="hc-btn hc-btn-primary" disabled={saving || (multi && selectedDays.length === 0)} style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', justifyContent: 'center' }}>
                  {saving ? 'Saving...' : formData.scheduleType === 'multi-day' ? `✓ Create ${selectedDays.length} Weekly Schedule${selectedDays.length !== 1 ? 's' : ''}` : bi ? `✓ Create ${selectedDays.length} Bi-Weekly Schedule${selectedDays.length !== 1 ? 's' : ''}` : '✓ Create Schedule'}
                </button>
              </form>
            )}
          </div>

          {/* RIGHT — the caregiver's existing schedules */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedCaregiverId && caregiverSchedules.length > 0 && (
              <div style={{ position: 'sticky', top: '1rem' }}>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: C.ink, fontWeight: 700 }}>
                  Current Schedule <span style={{ fontSize: '0.85rem', color: C.muted, fontWeight: 400 }}>— {calculateTotalHours(caregiverSchedules.filter(isRecurringRow))} hrs/wk</span>
                </h4>
                {Object.entries(recurringByDay).map(([dayNum, scheds]) => (
                  <div key={dayNum} style={{ marginBottom: '1rem' }}>
                    <div style={groupHead}>{getDayName(parseInt(dayNum))}</div>
                    {scheds.map((s) => (
                      <div key={s.id} onClick={() => openEditModal(s)} style={scheduleItem}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{getClientName(s.clientId)}</span>
                          <span style={{ color: C.inkSoft, marginLeft: '0.75rem' }}>{formatTime(s.startTime)} – {formatTime(s.endTime)}</span>
                          {s.frequency === 'biweekly' && <span style={{ marginLeft: '0.5rem', padding: '0.15rem 0.4rem', background: orange.bg, color: orange.ink, borderRadius: '4px', fontSize: '0.72rem' }}>Bi-Wk</span>}
                          {s.suspendedFrom && <span title={`Suspended from ${s.suspendedFrom.slice(0, 10)}`} style={{ marginLeft: '0.5rem', padding: '0.15rem 0.4rem', background: amber.bg, color: amber.ink, borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>⏸ Suspended</span>}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(s.id, s) }} aria-label={`Delete ${getClientName(s.clientId)} ${formatTime(s.startTime)} – ${formatTime(s.endTime)}`} title="Delete this schedule" style={binBtn}>🗑</button>
                      </div>
                    ))}
                  </div>
                ))}
                {Object.entries(oneTimeByDate).sort().map(([dateKey, scheds]) => (
                  <div key={dateKey} style={{ marginBottom: '1rem' }}>
                    <div style={groupHead}>{formatDay(dateKey, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    {scheds.map((s) => (
                      <div key={s.id} onClick={() => openEditModal(s)} style={scheduleItem}>
                        <div><span style={{ fontWeight: 600 }}>{getClientName(s.clientId)}</span><span style={{ color: C.inkSoft, marginLeft: '0.75rem' }}>{formatTime(s.startTime)} – {formatTime(s.endTime)}</span></div>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(s.id, s) }} aria-label={`Delete ${getClientName(s.clientId)} ${formatTime(s.startTime)} – ${formatTime(s.endTime)}`} title="Delete this schedule" style={binBtn}>🗑</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {selectedCaregiverId && caregiverSchedules.length === 0 && (
              <div style={{ padding: '3rem', textAlign: 'center', color: C.muted, background: C.hover, borderRadius: '12px', border: `2px dashed ${C.line}` }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</div>
                No existing schedules for this caregiver
              </div>
            )}
          </div>
        </div>
        {renderScheduleModals()}
      </>
    )
  }

  return (
    <>
      <div style={{ marginBottom: '1rem' }}><h2 style={{ margin: 0 }}>📅 Scheduling</h2></div>

      <div style={{ display: 'flex', borderBottom: `2px solid ${C.line}`, marginBottom: '1.25rem', overflowX: 'auto' }}>
        <button style={mainTabStyle(mainTab === 'schedule')} onClick={() => setMainTab('schedule')}>📅 Schedule</button>
        <button style={mainTabStyle(mainTab === 'bookings')} onClick={() => setMainTab('bookings')}>🗓️ Bookings</button>
        <button style={mainTabStyle(mainTab === 'tools')} onClick={() => setMainTab('tools')}>🔧 Tools</button>
        <button style={mainTabStyle(mainTab === 'staffing')} onClick={() => setMainTab('staffing')}>
          👥 Staffing {(pendingSwaps + reschedReqs.length) > 0 && countBadge(pendingSwaps + reschedReqs.length)}
        </button>
      </div>

      {mainTab === 'schedule' && renderScheduleTab()}
      {mainTab === 'bookings' && <BookingsTab online={hasFeature('online_booking')} />}
      {mainTab === 'tools' && renderToolsTab()}
      {mainTab === 'staffing' && renderStaffingTab()}

      {/* REASSIGN */}
      {reassignModal && (
        <div className="modal active" onClick={() => setReassignModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header"><h2>Reassign Shift</h2><button className="close-btn" aria-label="Close" onClick={() => setReassignModal(null)}>×</button></div>
            <div style={{ margin: '1rem 0', padding: '1rem', background: C.subtle, borderRadius: '8px' }}>
              <div style={{ fontWeight: 600 }}>{getClientName(reassignModal.schedule.clientId)}</div>
              <div style={{ fontSize: '0.88rem', color: C.inkSoft }}>{formatTime(reassignModal.schedule.startTime)} – {formatTime(reassignModal.schedule.endTime)}</div>
              <div style={{ fontSize: '0.82rem', color: C.inkSoft, marginTop: '0.4rem' }}>Currently: <strong>{reassignModal.currentCaregiver.firstName} {reassignModal.currentCaregiver.lastName}</strong></div>
            </div>
            <div className="form-group">
              <label>Reason *</label>
              <select value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 8, border: `1px solid ${C.line}`, marginBottom: '0.75rem' }}>
                <option value="admin_decision">Admin Decision</option>
                <option value="caregiver_request">Caregiver Request</option>
                <option value="client_request">Client Request</option>
                <option value="call_out">Call Out / Absence</option>
                <option value="schedule_optimization">Schedule Optimization</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>Reassign to:</label>
              <select onChange={(e) => { if (e.target.value) { handleReassign(reassignModal.schedule.id, e.target.value, reassignReason); setReassignModal(null) } }} defaultValue="">
                <option value="">Select caregiver...</option>
                {caregivers.filter((cg) => cg.id !== reassignModal.currentCaregiver.id).map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
              </select>
            </div>
            <div className="modal-actions"><button className="hc-btn hc-btn-secondary" onClick={() => setReassignModal(null)}>Cancel</button></div>
          </div>
        </div>
      )}

      {/* POST OPEN SHIFT */}
      {showCreateShift && (
        <div className="modal active" onClick={() => { setShowCreateShift(false); setCreateShiftPreFill({}) }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header"><h2>Post Open Shift</h2><button className="close-btn" aria-label="Close" onClick={() => { setShowCreateShift(false); setCreateShiftPreFill({}) }}>×</button></div>
            <form onSubmit={(e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              createOpenShift({ clientId: fd.get('clientId'), shiftDate: fd.get('date'), startTime: fd.get('start'), endTime: fd.get('end'), urgency: fd.get('urgency'), notes: fd.get('notes'), careTypeId: fd.get('careType') || null })
            }}>
              <div className="form-group"><label>Client *</label><select name="clientId" required defaultValue={createShiftPreFill.clientId || ''}><option value="">Select...</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                <div className="form-group"><label>Date *</label><input type="date" name="date" required defaultValue={createShiftPreFill.date || ''} /></div>
                <div className="form-group"><label>Start *</label><input type="time" name="start" defaultValue={createShiftPreFill.start || '09:00'} required /></div>
                <div className="form-group"><label>End *</label><input type="time" name="end" defaultValue={createShiftPreFill.end || '13:00'} required /></div>
              </div>
              <div className="form-group"><label>Urgency</label><select name="urgency"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
              <div className="form-group"><label>Notes</label><textarea name="notes" rows={2} /></div>
              <div className="modal-actions"><button type="submit" className="hc-btn hc-btn-primary">Post Shift</button><button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setShowCreateShift(false); setCreateShiftPreFill({}) }}>Cancel</button></div>
            </form>
          </div>
        </div>
      )}

      {renderScheduleModals()}

      {/* CALENDAR DAY DETAIL */}
      {calSelectedDay && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setCalSelectedDay(null) }} style={overlay(1000)}>
          <div style={{ ...dialog, maxWidth: '500px', maxHeight: '80vh', overflow: 'hidden', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{formatDay(new Date(calCurrentDate.getFullYear(), calCurrentDate.getMonth(), calSelectedDay), { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
                <p style={{ margin: 0, fontSize: '0.82rem', color: C.muted }}>{calDaySchedules.length} appointment{calDaySchedules.length !== 1 ? 's' : ''}{getProspectApptsForDay(calSelectedDay).length > 0 && ` + ${getProspectApptsForDay(calSelectedDay).length} prospect`}</p>
              </div>
              <button onClick={() => setCalSelectedDay(null)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: C.muted }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
              {calDaySchedules.length === 0 && getProspectApptsForDay(calSelectedDay).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: C.muted }}>📅 No appointments this day</div>
              ) : (
                <>
                  {calDaySchedules.map((sc, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: C.subtle, borderRadius: '8px', borderLeft: `4px solid ${cgColor(sc.caregiverId)}`, marginBottom: '0.5rem' }}>
                      <div style={{ minWidth: '70px', textAlign: 'center' }}><div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formatTime(sc.startTime)}</div><div style={{ fontSize: '0.78rem', color: C.inkSoft }}>{formatTime(sc.endTime)}</div></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{getClientName(sc.clientId)}</div>
                        <div style={{ fontSize: '0.82rem', color: C.inkSoft }}><span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: cgColor(sc.caregiverId), marginRight: '0.4rem' }} />{getCaregiverName(sc.caregiverId)}</div>
                        {sc.dayOfWeek !== null && <span style={pill(sc.frequency === 'biweekly' ? 'orange' : 'blue')}>{sc.frequency === 'biweekly' ? 'Bi-Weekly' : 'Recurring'}</span>}
                      </div>
                    </div>
                  ))}
                  {getProspectApptsForDay(calSelectedDay).map((pa, idx) => (
                    <div key={`pa${idx}`} style={{ display: 'flex', gap: '0.75rem', padding: '0.75rem', background: orange.bg, borderRadius: '8px', borderLeft: `4px solid ${FILL.orange}`, marginBottom: '0.5rem' }}>
                      <div style={{ minWidth: '70px', textAlign: 'center' }}><div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formatTime(pa.scheduledTime)}</div></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: orange.ink }}>🟠 {pa.homeownerName || 'Prospect'}</div>
                        {pa.notes && <div style={{ fontSize: '0.78rem', color: C.inkSoft }}>📍 {pa.notes}</div>}
                        <span style={{ ...pill('orange'), border: `1px solid ${orange.line}` }}>Prospect</span>
                      </div>
                      <button onClick={() => deleteProspectAppt(pa.id)} style={{ background: 'none', border: 'none', color: red.ink, cursor: 'pointer', fontSize: '0.9rem', alignSelf: 'flex-start' }} title="Cancel" aria-label="Cancel the appointment">🗑</button>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div style={{ padding: '0.75rem 1.25rem', borderTop: `1px solid ${C.line}`, textAlign: 'right' }}><button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setCalSelectedDay(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  )
}

// The heatmap's fills (light, the same in both themes) under a fixed dark ink.
const HEAT = ['#D1FAE5', '#A7F3D0', '#FCD34D', '#F87171']

function presetBtn(on: boolean): CSSProperties {
  return {
    padding: '0.35rem 0.6rem', borderRadius: '16px', border: `1px solid ${on ? tint('blue').line : C.line}`, cursor: 'pointer', fontSize: '0.78rem',
    background: on ? tint('blue').bg : C.surface, color: C.ink,
  }
}

// The Bookings tab. The template fetched the website's bookings through GET /api/bookings/external (a proxy to the
// separate website service); in one app the bookings are the app's own (the shared Bookings screens at /crm/bookings,
// apps/unified/web/src/booking), and that proxy is gone (docs/CUTOVER_LEDGER.md). So this tab sends the office there.
function BookingsTab({ online }: { online: boolean }) {
  return (
    <div className="hc-card" style={{ padding: '1.25rem' }}>
      {online ? (
        <>
          <p style={{ margin: '0 0 0.75rem', color: C.ink }}>Bookings made on your website are in Bookings, with their calendar and waitlist.</p>
          <Link to="/crm/bookings" className="hc-btn hc-btn-primary">Open Bookings →</Link>
        </>
      ) : (
        <p style={{ margin: 0, color: C.muted }}>Online booking is not switched on for your agency, so there are no website bookings to show.</p>
      )}
    </div>
  )
}

export default SchedulingHub
