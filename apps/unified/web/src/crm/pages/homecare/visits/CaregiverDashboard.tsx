// Moved from templates/crm-homecare/frontend/src/components/CaregiverDashboard.tsx — the caregiver's own app: their
// day (clock in and out, the visit's care tasks, medications, vitals and photos), their schedule, clients and
// history, and self service (open shifts, availability, a miss report, an incident report, time off). Shown at
// /crm/dashboard, inside the app's shell, for whoever does not run the agency's schedule (visits/index.tsx
// CaregiverHome; crm/verticals/homecare.tsx).
//
// Server (each reply read from its route): /api/time-entries (visits/timeTracking.ts: clock-in → the entry +
// sandataRequired, clock-out → the entry, /active → { id, clientId, startTime, clientName } or null, /recent → { data }
// with clientName / hoursWorked, /:id/gps, /check-warnings, /:id/photos), /api/schedules/:id?includeMovedIn=1
// (scheduling/schedules.ts, { data }: dayOfWeek, date, startTime, endTime, effectiveDate, endDate, frequency,
// anchorDate, suspendedFrom, movedIn, exceptions[exceptionDate, exceptionType, override…]), /api/clients (the
// caregiver's own, { data }), /api/shift-swaps (requesterId, targetId, shiftDate, requesterFirst …),
// /api/visit-change-requests (requestedBy, visitDate, originalStartTime, proposedDate …), /api/open-shifts/available and
// /:id/claim, /api/caregivers/:id/availability and PUT /api/caregiver-availability/:id, /api/pto,
// /api/scheduling/caregiver-hours/:id (totalHours), /api/route-optimizer/geofence/check, /api/emergency/
// client-unavailable, /api/documents/unsigned/:id and /:id/sign, /api/messages/unread-count, /api/payroll-verification/
// me/pending, /api/push/vapid-key and /subscribe, /api/caregivers/caregivers (the swap's coworker picker).
//
// Changes from the template (each in the visits group's report):
//   · no token anywhere: the app's client, its cookies; every reply read as the server answers it — lists are
//     { data } rows, every field camelCase (client_id → clientId, start_time → startTime, sandata_required →
//     sandataRequired …);
//   · the shell is the app's: the template's own sidebar, header and Logout became a tab row (the phone keeps its
//     bottom bar and "More" drawer), and every sign-out is the app's (useAuth().logout). Two-factor sign-in is the
//     app's own page (/crm/account, linked from Settings);
//   · the offline punch queue (./offlinePunches.ts) and GPS (./useGeolocation.ts) work as they did: a tap with no
//     signal is saved with its time and sent on reconnect, on reopening the app and every 30 s; the 60-second GPS
//     breadcrumbs and shift warnings now run whenever a server-recorded visit is open on this screen (the template
//     started them only at a clock-in made on this page load, never stopped them at the clock-out, and a second
//     clock-in started a second timer);
//   · the counter-offer asks through the app's prompt (the template's four window.prompt()), every message is the app's
//     toast, the payday prompt takes no token;
//   · instants print on the agency's clock (the history's dates), calendar days through lib/date; every colour is a
//     frame token or a light/dark pair, and the white-on-colour fills that read under 4.5:1 are darker shades.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useAuth, usePrompt, useToast } from '../../../../shared'
import { usePolling } from '../lib/usePolling'
import { isBiweeklyOn, toYMD } from '../lib/biweekly'
import { CLIENT_UNAVAILABLE_REASONS } from '../lib/cancelReasons'
import { formatDate, parseLocalDate, toLocalYMD } from '../lib/date'
import { formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock'
import { needsSandata, visitNeedsSandata, evvWeekMet, openSandata } from '../lib/sandata'
import { compressPhoto } from '../lib/visitPhoto'
import SignaturePad from '../lib/SignaturePad'
import CaregiverClientModal from './CaregiverClientModal'
import CareTaskChecklist from './CareTaskChecklist'
import ShiftMissReport from './caregiver/ShiftMissReport'
import IncidentReportForm from './caregiver/IncidentReportForm'
import CaregiverHelp from './caregiver/CaregiverHelp'
import CaregiverMessages from './caregiver/CaregiverMessages'
import PaydayVerificationModal, { type PendingVerification } from './caregiver/PaydayVerificationModal'
import VisitCarePanel from './caregiver/VisitCarePanel'
import { SandataPrompt, SandataIdBox, SandataHelp, SandataNotice, useSandataContext, type SandataPromptState } from './caregiver/SandataEvv'
import { useGeolocation, type GeoPosition } from './useGeolocation'
import { savePunch, newLocalId, offlineSession, flushPunches, isUnreachable, pendingPunches, postPunch } from './offlinePunches'

// ── The rows this screen reads ───────────────────────────────────────────────────────────────

interface ScheduleException {
  exceptionDate: string
  exceptionType: string
  overrideStartTime: string | null
  overrideEndTime: string | null
  overrideCaregiverId: string | null
  overrideClientId: string | null
}

/** A row of GET /api/schedules/:caregiverId (a pattern, a one-time shift, or a day moved in from someone else). */
interface CgSchedule {
  id: string
  caregiverId?: string | null
  clientId: string
  dayOfWeek: number | null
  date: string | null
  startTime: string | null
  endTime: string | null
  effectiveDate?: string | null
  endDate?: string | null
  frequency?: string | null
  anchorDate?: string | null
  suspendedFrom?: string | null
  notes?: string | null
  movedIn?: boolean
  exceptions?: ScheduleException[]
}
/** A visit on a day: the pattern with that day's exception applied. */
interface Shift extends CgSchedule { resolvedDate?: string; occurrenceDate?: string }

/** A row of GET /api/clients (a caregiver's own clients). */
interface CgClient { id: string; firstName: string | null; lastName: string | null; phone?: string | null; address?: string | null; city?: string | null }

/** The open visit: the server's (clock-in reply, /active) or one saved on this phone. */
interface ActiveSession {
  id: string
  clientId?: string | null
  startTime: string
  offline?: boolean
  sandataRequired?: boolean | null
}

/** A row of GET /api/time-entries/recent. */
interface RecentVisit { id: string; clientId: string; startTime: string; hoursWorked: string | null; clientName: string | null }

/** A row of GET /api/shift-swaps. */
interface SwapRequest {
  id: string
  scheduleId: string | null
  requesterId: string
  targetId: string | null
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  reason: string | null
  status: string
  requesterFirst: string | null
  requesterLast: string | null
  clientFirst: string | null
  clientLast: string | null
}

/** A row of GET /api/visit-change-requests. */
interface ChangeRequest {
  id: string
  scheduleId: string | null
  requestType: string
  requestedBy: string
  status: string
  visitDate: string
  originalStartTime: string | null
  cancelReason: string | null
  proposedDate: string | null
  proposedStartTime: string | null
  proposedEndTime: string | null
  counterDate: string | null
  counterStartTime: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

/** A row of GET /api/open-shifts/available. */
interface OpenShift { id: string; date: string; startTime: string | null; endTime: string | null; clientFirstName: string | null; clientLastName: string | null }

/** A row of GET /api/pto (the caller's own). */
interface TimeOffRequest { id: string; startDate: string; endDate: string; reason: string | null; status: string | null }

/** A row of GET /api/documents/unsigned/:userId. */
interface UnsignedDoc { id: string; name: string | null; fileName: string | null; description: string | null; expirationDate: string | null }

/** A row of GET /api/caregivers/caregivers. */
interface Coworker { id: string; firstName: string | null; lastName: string | null }

interface DayAvailability { available: boolean; start: string; end: string }
interface Availability { status: string; maxHoursPerWeek: number; weeklyAvailability: Record<number, DayAvailability>; notes: string }

interface PendingPhoto { dataUri: string; caption: string; category: string; sizeBytes: number }

type CgPage = 'home' | 'schedule' | 'clients' | 'history' | 'open-shifts' | 'availability' | 'time-off' | 'miss-report' | 'incident-report' | 'settings'
type ToastKind = 'success' | 'error' | 'warning' | 'info'

const MAIN_PAGES: { page: CgPage; icon: string; label: string }[] = [
  { page: 'home', icon: '🏠', label: 'Home' },
  { page: 'schedule', icon: '📅', label: 'Schedule' },
  { page: 'clients', icon: '👥', label: 'Clients' },
  { page: 'history', icon: '📜', label: 'History' },
]
const SELF_PAGES: { page: CgPage; icon: string; label: string }[] = [
  { page: 'open-shifts', icon: '📋', label: 'Open Shifts' },
  { page: 'availability', icon: '⏰', label: 'Availability' },
  { page: 'miss-report', icon: '🚨', label: 'Report Miss' },
  { page: 'incident-report', icon: '⚠️', label: 'Report Incident' },
  { page: 'time-off', icon: '🏖️', label: 'Time Off' },
]

const DEFAULT_WEEK: Record<number, DayAvailability> = {
  0: { available: false, start: '09:00', end: '17:00' },
  1: { available: true, start: '09:00', end: '17:00' },
  2: { available: true, start: '09:00', end: '17:00' },
  3: { available: true, start: '09:00', end: '17:00' },
  4: { available: true, start: '09:00', end: '17:00' },
  5: { available: true, start: '09:00', end: '17:00' },
  6: { available: false, start: '09:00', end: '17:00' },
}

// A punch must never hang on a dead connection: give up after 20s and treat it as "no signal", so the tap is saved on
// the phone instead of lost.
const PUNCH_TIMEOUT_MS = 20000

/** Web push for this browser, when the agency has a key and the browser a service worker. */
const subscribeToPush = async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.ready
    const { publicKey } = (await api.get('/api/push/vapid-key')) as { publicKey?: string }
    if (!publicKey || publicKey === 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') return
    const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
    await api.post('/api/push/subscribe', { subscription })
  } catch (e) {
    console.log('[Push] subscription skipped:', e instanceof Error ? e.message : e)
  }
}

// ── Brand fills (the frame's tokens): white on the deep brand reads in both themes ──────────
const BRAND_FILL = 'var(--hc-brand-deep)'
const BRAND_INK = 'var(--color-teal-dark)'
const BRAND_TINT = 'var(--color-teal-light)'

// Light/dark pairs used more than once.
const PAIR_INK = 'text-gray-900 dark:text-slate-100'
const PAIR_SOFT = 'text-gray-700 dark:text-slate-300'
const PAIR_MUTED = 'text-gray-600 dark:text-slate-400'
const CHIP_PENDING = 'rounded-md border px-2.5 py-1 text-xs font-semibold border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
const ACTION_BTN = 'rounded-md border bg-white px-2.5 py-1 text-xs font-semibold dark:bg-slate-900'

const CaregiverDashboard = () => {
  const { user, company, logout } = useAuth()
  const toast = useToast()
  const askText = usePrompt()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const say = useCallback((msg: string, kind: ToastKind = 'success') => { toastRef.current[kind](msg) }, [])
  const myId = user?.id || ''

  const [currentPage, setCurrentPage] = useState<CgPage>('home')
  const [schedules, setSchedules] = useState<CgSchedule[]>([])
  const [clients, setClients] = useState<CgClient[]>([])
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  // Documents waiting for this caregiver's signature (their own, and company policies)
  const [unsignedDocs, setUnsignedDocs] = useState<UnsignedDoc[]>([])
  const [signTarget, setSignTarget] = useState<UnsignedDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedClient, setSelectedClient] = useState('')
  const [elapsedTime, setElapsedTime] = useState(0)
  const [visitNote, setVisitNote] = useState('')
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  const [viewingClientId, setViewingClientId] = useState<string | null>(null)

  // Sandata EVV: which of my clients are in Sandata, and the "check in/out on Sandata too" prompt.
  const { ctx: sandataCtx, reload: reloadSandata } = useSandataContext()
  const sandataCtxRef = useRef(sandataCtx)
  sandataCtxRef.current = sandataCtx
  const [sandataPrompt, setSandataPrompt] = useState<SandataPromptState | null>(null)
  const [showSandataHelp, setShowSandataHelp] = useState(false)
  const sandataClient = (id: string | null | undefined) => (sandataCtx?.clients || []).find((c) => c.id === id)
  const sessionClientId = (s: ActiveSession | null) => (s ? (s.clientId ?? null) : null)
  // The visit's Sandata decision was made at clock-in; after a reload it comes from the context.
  const sessionSandataRequired = (s: ActiveSession | null): boolean | null | undefined => {
    if (!s) return undefined
    if (s.sandataRequired !== undefined) return s.sandataRequired
    const av = sandataCtx?.activeVisit
    return av && av.timeEntryId === s.id ? av.sandataRequired : undefined
  }

  // Visits for clients in Sandata must also be checked in and out on Sandata Mobile Connect. `sandataRequired` is the
  // server's per-visit answer (weekly EVV allowance): false = this week's EVV hours are already met, so this visit does
  // NOT go to Sandata. Unknown (offline) -> prompt.
  const promptSandata = (kind: 'in' | 'out', clientId: string | null | undefined, sandataRequired: boolean | null | undefined) => {
    if (!clientId) return
    const cl = (sandataCtxRef.current?.clients || []).find((c) => c.id === clientId)
    if (visitNeedsSandata(cl, sandataRequired)) {
      setSandataPrompt({ kind, clientId, clientName: `${cl?.firstName || ''} ${cl?.lastName || ''}`.trim() })
    } else if (kind === 'in' && evvWeekMet(cl, sandataRequired)) {
      say(`EVV hours for ${cl?.firstName || 'this client'} are already done this week — no Sandata check-in needed for this visit.`, 'success')
    }
  }

  // GPS: the browser's position, watched while this screen is open.
  const { position: location, error: locationError, getPosition } = useGeolocation({ watch: true })

  // Self-service state
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([])
  const [claimingShiftId, setClaimingShiftId] = useState<string | null>(null) // the claim in flight
  const [claimedShifts, setClaimedShifts] = useState<Record<string, { assigned: boolean; message: string }>>({}) // this visit to the page
  const [myHoursThisWeek, setMyHoursThisWeek] = useState(0)
  const [availability, setAvailability] = useState<Availability>({ status: 'available', maxHoursPerWeek: 40, weeklyAvailability: DEFAULT_WEEK, notes: '' })
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [newTimeOff, setNewTimeOff] = useState({ startDate: '', endDate: '', reason: '' })
  const [message, setMessage] = useState<{ text: string; type: '' | 'success' | 'error' }>({ text: '', type: '' })
  const [showMissReport, setShowMissReport] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showMessages, setShowMessages] = useState(false)
  // Payday verification: last pay period's hours to confirm. Null unless the agency switched the prompt on.
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null)
  useEffect(() => {
    api.get('/api/payroll-verification/me/pending')
      .then((d: { pending?: PendingVerification | null }) => { if (d?.pending) setPendingVerification(d.pending) })
      .catch(() => {})
  }, [])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [showMoreDrawer, setShowMoreDrawer] = useState(false)

  // ── Visits (ported from the CVHC home care CRM) ──────────────────────────
  // Set when the server refuses a clock-out because a note is required (VA clients): the note modal stays open with the
  // reason instead of closing on a generic error.
  const [noteError, setNoteError] = useState('')
  const [clockingIn, setClockingIn] = useState(false)
  const [clockingOut, setClockingOut] = useState(false)
  // Visit photos staged for upload on clock-out
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [photoUploading, setPhotoUploading] = useState(false)
  // Shift swap requests (to me and from me)
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [swapModal, setSwapModal] = useState<Shift | null>(null)
  const [swapForm, setSwapForm] = useState({ targetCaregiverId: '', reason: '' })
  const [swapSending, setSwapSending] = useState(false)
  // "Client refused / not available": the visit comes off the books (not billed, not paid); nobody needs covering, so
  // no open shift.
  const [unavailModal, setUnavailModal] = useState<Shift | null>(null)
  const [unavailForm, setUnavailForm] = useState({ reason: '', note: '' })
  const [unavailSubmitting, setUnavailSubmitting] = useState(false)
  const [moveModal, setMoveModal] = useState<Shift | null>(null)
  const [moveForm, setMoveForm] = useState({ date: '', startTime: '', endTime: '', reason: '' })
  const [myReschedules, setMyReschedules] = useState<ChangeRequest[]>([]) // this caregiver's own pending asks
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]) // what CLIENTS asked about my visits
  const [crResolving, setCrResolving] = useState<string | null>(null)
  const [otherCaregivers, setOtherCaregivers] = useState<Coworker[]>([])

  const loadSwapRequests = async () => {
    try { setSwapRequests(rows<SwapRequest>(await api.get('/api/shift-swaps'))) } catch { /* keep the dashboard working */ }
  }

  const loadOtherCaregivers = async () => {
    try {
      const list = rows<Coworker>(await api.get('/api/caregivers/caregivers'))
      setOtherCaregivers(list.filter((c) => c.id !== myId))
    } catch { /* the swap's picker stays empty */ }
  }
  useEffect(() => { loadSwapRequests(); loadOtherCaregivers() }, [myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const occurrenceOf = (s: Shift) => s.resolvedDate || (s.date ? s.date.split('T')[0] : '')

  const submitClientUnavailable = async () => {
    if (!unavailModal) return
    if (!unavailForm.reason) { say('Pick a reason', 'error'); return }
    if (unavailForm.reason === 'other' && !unavailForm.note.trim()) { say('Add a short note for "Other"', 'error'); return }
    const date = occurrenceOf(unavailModal)
    setUnavailSubmitting(true)
    try {
      await api.post('/api/emergency/client-unavailable', { scheduleId: unavailModal.id, date, reason: unavailForm.reason, note: unavailForm.note || null })
      say('Saved — the office has been notified and this visit will not be billed')
      setUnavailModal(null); setUnavailForm({ reason: '', note: '' })
      loadData()
    } catch (e) { say(errorMessage(e, 'Could not save'), 'error') }
    finally { setUnavailSubmitting(false) }
  }

  const submitSwapRequest = async () => {
    if (!swapModal || !swapForm.targetCaregiverId) { say('Pick a coworker to swap with', 'error'); return }
    if (swapSending) return
    setSwapSending(true)
    try {
      await api.post('/api/shift-swaps', {
        scheduleId: swapModal.id,
        // The day the caregiver tapped — a repeating shift has no date of its own.
        shiftDate: occurrenceOf(swapModal) || undefined,
        targetCaregiverId: swapForm.targetCaregiverId,
        reason: swapForm.reason || null,
      })
      say('Swap request sent')
      setSwapModal(null); setSwapForm({ targetCaregiverId: '', reason: '' })
      await loadSwapRequests() // the Swap button becomes "Swap sent"
    } catch (e) { say(errorMessage(e, 'Failed'), 'error') }
    finally { setSwapSending(false) }
  }

  // Ask the office to move a shift to another day/time. Nothing changes until the office approves it — the visit is
  // billed and EVV'd against the scheduled time.
  const openMoveModal = (shift: Shift) => {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    const onDate = occurrenceOf(shift) || toYMD(t)!
    setMoveModal({ ...shift, occurrenceDate: onDate })
    setMoveForm({ date: onDate, startTime: (shift.startTime || '').slice(0, 5), endTime: (shift.endTime || '').slice(0, 5), reason: '' })
  }

  // One open request per visit — the server enforces it (409); this just hides a button that can only fail.
  const movePendingFor = (shift: Shift) => {
    const onDate = occurrenceOf(shift)
    return myReschedules.some((cr) => cr.scheduleId === shift.id && String(cr.visitDate).slice(0, 10) === onDate)
  }

  // The same for a swap: one open swap per visit day (the server refuses a second with 409). Open = waiting on the
  // coworker (pending) or on the office (accepted).
  const swapPendingFor = (shift: Shift) => {
    const onDate = occurrenceOf(shift)
    return swapRequests.some((r) => r.requesterId === myId && r.scheduleId === shift.id
      && String(r.shiftDate).slice(0, 10) === onDate && (r.status === 'pending' || r.status === 'accepted'))
  }

  const submitMoveRequest = async () => {
    if (!moveModal) return
    const { date, startTime, endTime, reason } = moveForm
    if (!date || !startTime || !endTime) { say('Pick the new day and times', 'error'); return }
    const origStart = (moveModal.startTime || '').slice(0, 5)
    const origEnd = (moveModal.endTime || '').slice(0, 5)
    if (date === moveModal.occurrenceDate && startTime === origStart && endTime === origEnd) {
      say('That is the same day and time it already has', 'error'); return
    }
    try {
      await api.post('/api/visit-change-requests/reschedule-request', {
        scheduleId: moveModal.id, visitDate: moveModal.occurrenceDate,
        startTime: moveModal.startTime, endTime: moveModal.endTime,
        proposedDate: date, proposedStartTime: startTime, proposedEndTime: endTime, reason: reason || null,
      })
      say('Sent to the office — the shift moves once they approve it')
      setMoveModal(null)
      loadChangeRequests()
    } catch (e) { say(errorMessage(e, 'Failed'), 'error') }
  }

  const respondToSwap = async (req: SwapRequest, accepted: boolean) => {
    try {
      await api.put(`/api/shift-swaps/${req.id}/respond`, { accepted })
      say(accepted ? 'Swap accepted — admin approval pending' : 'Swap declined')
      loadSwapRequests()
    } catch (e) { say(errorMessage(e, 'Failed'), 'error') }
  }

  // Every open request on this caregiver's visits. What the CLIENT asked is theirs to answer; what THEY asked is waiting
  // on the office (and must never be shown with Approve/Deny).
  const loadChangeRequests = async () => {
    try {
      const list = rows<ChangeRequest>(await api.get('/api/visit-change-requests'))
      setChangeRequests(list.filter((cr) => cr.requestedBy !== 'caregiver'))
      setMyReschedules(list.filter((cr) => cr.requestedBy === 'caregiver'))
    } catch { /* keep the dashboard working */ }
  }

  const resolveChangeRequest = async (crId: string, action: string, extra: Record<string, string> = {}) => {
    setCrResolving(crId)
    try {
      await api.put(`/api/visit-change-requests/${crId}/resolve`, { action, ...extra })
      say('Request resolved', 'success'); loadChangeRequests(); loadData()
    } catch (e) {
      say((e as { status?: number })?.status === 0 ? 'Network error' : errorMessage(e, 'Failed to resolve'), 'error')
    } finally { setCrResolving(null) }
  }

  const counterOffer = async (cr: ChangeRequest) => {
    const counterDate = await askText('Suggest a different date (YYYY-MM-DD):', { title: 'Counter-offer', placeholder: 'YYYY-MM-DD' })
    if (!counterDate) return
    const counterStart = await askText('Start time (HH:MM):', { title: 'Counter-offer', placeholder: 'HH:MM' })
    if (!counterStart) return
    const counterEnd = await askText('End time (HH:MM):', { title: 'Counter-offer', placeholder: 'HH:MM' })
    if (!counterEnd) return
    const msg = await askText('Optional message to client:', { title: 'Counter-offer' })
    resolveChangeRequest(cr.id, 'counter', { counterDate, counterStartTime: counterStart, counterEndTime: counterEnd, counterMessage: msg || '' })
  }

  // Send punches saved on the phone while there was no signal: now, when the connection comes back, when the app is
  // reopened, and every 30s while any wait.
  useEffect(() => {
    if (!myId) return
    let stopped = false
    const trySend = async () => {
      if (stopped || !pendingPunches(myId).length) return
      const r = await flushPunches({ userId: myId })
      if (stopped) return
      if (r.sent) { say(`✅ Saved ${r.sent === 1 ? 'punch' : `${r.sent} punches`} sent to the office.`, 'success'); loadData() }
      for (const x of r.rejected) {
        say(`⚠️ A saved ${x.punch.kind === 'in' ? 'clock-in' : 'clock-out'} could not be recorded: ${x.error}`, 'error')
      }
      if (r.rejected.length && !r.sent) loadData()
    }
    trySend()
    const onVisible = () => { if (document.visibilityState === 'visible') trySend() }
    window.addEventListener('online', trySend)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(trySend, 30000)
    return () => {
      stopped = true
      window.removeEventListener('online', trySend)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [myId]) // eslint-disable-line react-hooks/exhaustive-deps

  // A photo is downscaled to a JPEG data URI (lib/visitPhoto — the same as a mid-visit photo).
  const handlePhotoFile = async (file: File | null | undefined, category = 'other') => {
    if (!file) return
    try {
      const { dataUri, sizeBytes } = await compressPhoto(file)
      setPendingPhotos((prev) => [...prev, { dataUri, caption: '', category, sizeBytes }])
    } catch (e) { say(errorMessage(e, 'That photo could not be read'), 'error') }
  }

  useEffect(() => {
    loadData()
    subscribeToPush()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Unread messages, every 90 s while the screen is visible.
  usePolling(async () => {
    try {
      const data: { count?: number } = await api.get('/api/messages/unread-count')
      setUnreadMessages(Number(data?.count) || 0)
    } catch { /* rate limited or offline - skip */ }
  }, 90000)

  // The open visit's clock.
  useEffect(() => {
    if (!activeSession) { setElapsedTime(0); return }
    const start = new Date(activeSession.startTime).getTime()
    const tick = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [activeSession])

  useEffect(() => {
    if (currentPage === 'open-shifts') loadOpenShifts()
    if (currentPage === 'availability') loadAvailability()
    if (currentPage === 'time-off') loadTimeOffRequests()
  }, [currentPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    if (!myId) { setLoading(false); return }
    const ok = <T,>(p: Promise<T>) => p.then((d) => ({ ok: true as const, d }), () => ({ ok: false as const, d: null }))
    try {
      const [schedulesRes, clientsRes, activeRes, visitsRes] = await Promise.all([
        // includeMovedIn: days moved ONTO this caregiver from someone else's pattern.
        ok(api.get(`/api/schedules/${myId}`, { includeMovedIn: 1 })),
        ok(listAll('/api/clients')),
        ok(api.get('/api/time-entries/active')),
        ok(api.get('/api/time-entries/recent', { limit: 10 })),
      ])

      if (schedulesRes.ok) setSchedules(rows<CgSchedule>(schedulesRes.d))
      if (clientsRes.ok) setClients(rows<CgClient>(clientsRes.d))
      if (activeRes.ok) {
        const data = activeRes.d as ActiveSession | null
        if (data?.id) {
          setActiveSession({ id: data.id, clientId: data.clientId, startTime: data.startTime })
          setSelectedClient(data.clientId || '')
        } else {
          // The server has no open visit. A clock-in still saved on this phone is one — keep showing it; otherwise drop
          // an offline visit that has synced.
          const saved = offlineSession(myId)
          if (saved) { setActiveSession(saved); setSelectedClient(saved.clientId || '') }
          else setActiveSession((s) => (s && s.offline ? null : s))
        }
      } else {
        // Couldn't reach the server — a visit saved on the phone is still in progress.
        const saved = offlineSession(myId)
        if (saved) { setActiveSession((s) => s || saved); setSelectedClient((c) => c || saved.clientId || '') }
      }
      if (visitsRes.ok) setRecentVisits(rows<RecentVisit>(visitsRes.d))
      loadMyHours()
      loadChangeRequests()
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadOpenShifts = async () => {
    try { setOpenShifts(rows<OpenShift>(await api.get('/api/open-shifts/available'))) }
    catch (error) { console.error('Failed to load open shifts:', error) }
  }

  const loadAvailability = async () => {
    try {
      const data = (await api.get(`/api/caregivers/${myId}/availability`)) as {
        status?: string; maxHoursPerWeek?: number; weeklyAvailability?: unknown; notes?: string | null
      } | null
      if (data) {
        const week = typeof data.weeklyAvailability === 'string' ? JSON.parse(data.weeklyAvailability) : data.weeklyAvailability
        setAvailability((prev) => ({
          status: data.status || prev.status,
          maxHoursPerWeek: data.maxHoursPerWeek || prev.maxHoursPerWeek,
          weeklyAvailability: week && typeof week === 'object' ? week as Record<number, DayAvailability> : prev.weeklyAvailability,
          notes: data.notes || '',
        }))
      }
    } catch (error) {
      console.error('Failed to load availability:', error)
    }
  }

  const loadTimeOffRequests = async () => {
    // My time-off requests (GET /api/pto lists only the caller's own for a caregiver).
    try { setTimeOffRequests(rows<TimeOffRequest>(await api.get('/api/pto'))) }
    catch (error) { console.error('Failed to load time off:', error) }
  }

  const loadMyHours = async () => {
    try {
      const data: { totalHours?: string } = await api.get(`/api/scheduling/caregiver-hours/${myId}`)
      setMyHoursThisWeek(parseFloat(String(data?.totalHours)) || 0)
    } catch (error) {
      console.error('Failed to load hours:', error)
    }
  }

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage({ text: '', type: '' }), 4000)
  }

  // GPS breadcrumbs every 60 seconds while a visit recorded on the server is open, with the 15-minute shift warning.
  const liveEntryId = activeSession && !activeSession.offline && !String(activeSession.id).startsWith('offline-') ? activeSession.id : null
  useEffect(() => {
    if (!liveEntryId) return
    const interval = setInterval(() => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            api.post(`/api/time-entries/${liveEntryId}/gps`, {
              latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy,
              speed: pos.coords.speed, heading: pos.coords.heading,
            }).catch(() => {})
          },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 },
        )
      }
      // 15-minute shift warning check (runs every 60s alongside GPS)
      api.post('/api/time-entries/check-warnings', { timeEntryId: liveEntryId })
        .then((d: { warning?: boolean; overTime?: boolean; minutesRemaining?: number; minutesOver?: number }) => {
          if (d?.warning && !d.overTime) say(`⏰ ${d.minutesRemaining} min remaining — start wrapping up your shift!`, 'warning')
          else if (d?.warning && d.overTime) say(`⚠️ You are ${d.minutesOver} min over your scheduled time — please clock out`, 'error')
        })
        .catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [liveEntryId, say])

  const geofenceTriggeredRef = useRef(new Set<string>()) // which clients we've already auto-clocked for

  // A suspended schedule (service paused) generates nothing on/after suspendedFrom.
  const isSuspendedOn = (schedule: CgSchedule, ymd: string) =>
    !!(schedule.suspendedFrom && ymd && ymd >= String(schedule.suspendedFrom).slice(0, 10))

  // Does a recurring pattern happen on this date? Effective / end dates, bi-weekly parity (the one shared rule,
  // lib/biweekly) and suspension — the same answer the server's engine gives.
  const isScheduleActiveForDate = (schedule: CgSchedule, targetDate: Date) => {
    const ymd = toYMD(parseLocalDate(targetDate))!
    if (schedule.effectiveDate && ymd < String(schedule.effectiveDate).slice(0, 10)) return false
    if (schedule.endDate && ymd > String(schedule.endDate).slice(0, 10)) return false
    if (schedule.frequency === 'biweekly' && schedule.anchorDate && !isBiweeklyOn(ymd, schedule.anchorDate)) return false
    if (isSuspendedOn(schedule, ymd)) return false
    return true
  }

  // Per-day exceptions ride along on each recurring row: 'cancelled' removes that one date, 'modified' changes its times
  // or moves it to another client / caregiver. Returns the shift to show for that date, or null.
  const applyExceptionForDate = (schedule: CgSchedule, dateStr: string): Shift | null => {
    const ex = (schedule.exceptions || []).find((e) => String(e.exceptionDate).slice(0, 10) === dateStr)
    if (!ex) return schedule
    if (ex.exceptionType === 'cancelled') return null
    if (ex.exceptionType === 'modified') {
      if (ex.overrideCaregiverId && schedule.caregiverId && ex.overrideCaregiverId !== schedule.caregiverId) return null
      const out: Shift = { ...schedule, startTime: ex.overrideStartTime || schedule.startTime, endTime: ex.overrideEndTime || schedule.endTime }
      if (ex.overrideClientId && ex.overrideClientId !== schedule.clientId) out.clientId = ex.overrideClientId
      return out
    }
    return schedule
  }

  // ── GEOFENCE AUTO CLOCK-IN/OUT ────────────────────────────────────────────
  const runGeofenceCheck = async (currentLocation: GeoPosition | null, currentSession: ActiveSession | null, currentSchedules: CgSchedule[]) => {
    if (!currentLocation?.latitude) return
    const lat = currentLocation.latitude
    const lng = currentLocation.longitude

    const now = new Date()
    const todayDay = now.getDay()
    const nowMins = now.getHours() * 60 + now.getMinutes()

    // Clients with a visit that really happens today — the pattern's dates, bi-weekly parity, suspension and that
    // day's exception (a cancelled visit never auto-clocks anyone in).
    const todayDate = new Date(now); todayDate.setHours(0, 0, 0, 0)
    const todayYmd = toYMD(todayDate)!
    const todaysVisits = (currentSchedules || [])
      .filter((s) => s.date
        ? (String(s.date).slice(0, 10) === todayYmd && !isSuspendedOn(s, todayYmd))
        : (s.dayOfWeek === todayDay && isScheduleActiveForDate(s, todayDate)))
      .map((s) => applyExceptionForDate(s, todayYmd))
      .filter((s): s is Shift => !!s)
    const todayClients = [...new Set(todaysVisits.map((s) => s.clientId).filter(Boolean))]
    // Proximity alone must not clock anyone in: a visit for THIS client has to be live now (15 minutes before its
    // start through its end).
    const hasShiftNow = (clientId: string) => todaysVisits.some((s) => {
      if (s.clientId !== clientId || !s.startTime) return false
      const [sh, sm] = s.startTime.split(':').map(Number)
      const startMin = sh * 60 + sm
      let endMin = startMin + 8 * 60
      if (s.endTime) {
        const [eh, em] = s.endTime.split(':').map(Number)
        endMin = eh * 60 + em
        if (endMin <= startMin) endMin += 24 * 60 // overnight
      }
      return nowMins >= startMin - 15 && nowMins <= endMin
    })

    if (!todayClients.length) return

    for (const clientId of todayClients) {
      const alreadyTriggered = geofenceTriggeredRef.current.has(clientId)
      try {
        let data: { withinGeofence?: boolean; autoClockIn?: boolean; autoClockOut?: boolean; clientName?: string }
        try { data = await api.post('/api/route-optimizer/geofence/check', { clientId, latitude: lat, longitude: lng }) }
        catch { continue }

        // AUTO CLOCK-IN: within geofence, not clocked in, not already triggered
        if (data.withinGeofence && data.autoClockIn && !currentSession && !alreadyTriggered && hasShiftNow(clientId)) {
          geofenceTriggeredRef.current.add(clientId)
          say(`📍 You've arrived at ${data.clientName} — clocking you in automatically`, 'success')
          try {
            const clockData: ActiveSession & { sandataRequired?: boolean | null } = await api.post('/api/time-entries/clock-in', { clientId, latitude: lat, longitude: lng, autoClockIn: true })
            setActiveSession({ id: clockData.id, clientId: clockData.clientId, startTime: clockData.startTime, sandataRequired: clockData.sandataRequired })
            setSelectedClient(clientId)
            promptSandata('in', clientId, clockData.sandataRequired)
          } catch (e) {
            // Refused (e.g. no live visit on the server's view) — allow a later retry.
            if ((e as { status?: number })?.status !== 0) geofenceTriggeredRef.current.delete(clientId)
          }
          break // only clock into one client at a time
        }

        // AUTO CLOCK-OUT: was within geofence but now left, currently clocked into this client
        if (!data.withinGeofence && data.autoClockOut && currentSession?.clientId === clientId && alreadyTriggered) {
          // Only auto clock-out if they've been there at least 10 minutes
          const minsElapsed = (now.getTime() - new Date(currentSession.startTime).getTime()) / 60000
          if (minsElapsed >= 10) {
            say(`📍 You've left ${data.clientName}'s location — clocking you out automatically`, 'success')
            geofenceTriggeredRef.current.delete(clientId)
            setShowNoteModal(true) // prompt for visit note before clocking out
          }
        }
      } catch {
        // Silently fail — don't interrupt the caregiver
      }
    }
  }

  // Geofence polling when location is available: on every new fix, and every 30 seconds.
  useEffect(() => {
    if (!location) return
    runGeofenceCheck(location, activeSession, schedules)
    const interval = setInterval(() => { runGeofenceCheck(location, activeSession, schedules) }, 30000)
    return () => clearInterval(interval)
  }, [location, activeSession, clients, schedules]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClockIn = async () => {
    if (!selectedClient) { say('Please select a client.', 'info'); return }
    if (clockingIn) return
    setClockingIn(true)
    const tapAt = new Date().toISOString() // the real clock-in time, even if the send fails

    try {
      // Never wait on GPS at the tap: use the fix already in hand.
      const lat = location?.latitude || null
      const lng = location?.longitude || null
      if (!lat) getPosition?.() // warm it for the clock-out

      const res = await postPunch('/api/time-entries/clock-in', { clientId: selectedClient, latitude: lat, longitude: lng }, PUNCH_TIMEOUT_MS)
      if (isUnreachable(res)) {
        // No signal: save the tap on the phone with its real time; it sends itself later.
        const localId = newLocalId()
        const saved = savePunch({ userId: myId, localId, kind: 'in', at: tapAt, clientId: selectedClient, latitude: lat, longitude: lng })
        if (!saved) throw new Error('No signal, and this phone could not save the clock-in. Call the office with your start time.')
        say(`No signal — clock-in saved on your phone at ${formatAgencyDateTime(tapAt, { hour: 'numeric', minute: '2-digit' })}. It will send by itself when you have signal.`, 'warning')
        setActiveSession({ id: `offline-${localId}`, offline: true, clientId: selectedClient, startTime: tapAt })
        promptSandata('in', selectedClient, undefined)
        return
      }

      // The server answered: a refusal (auto transition off, an offline overlap, …) is shown, never queued.
      const data = (await res!.json().catch(() => ({}))) as Partial<ActiveSession> & { error?: string }
      if (!res!.ok || !data.id) throw new Error(data.error || 'Failed')

      setActiveSession({ id: data.id, clientId: data.clientId, startTime: data.startTime || tapAt, sandataRequired: data.sandataRequired })
      if (!lat) say('Clocked in (location unavailable)', 'warning')
      promptSandata('in', selectedClient, data.sandataRequired)
      reloadSandata()
    } catch (error) {
      say('Failed to clock in: ' + errorMessage(error, 'Failed'), 'error')
    } finally {
      setClockingIn(false)
    }
  }

  const handleClockOut = () => {
    if (!activeSession) { say('No active session.', 'info'); return }
    setNoteError('')
    setShowNoteModal(true)
  }

  const completeClockOut = async () => {
    // Guard: a stale modal (reload, re-login) must close cleanly instead of trapping the caregiver.
    if (!activeSession?.id) { say('No active session — reopen and try again.', 'error'); setShowNoteModal(false); return }
    if (clockingOut) return // ignore re-taps while the first one is in flight
    const isOfflineVisit = String(activeSession.id).startsWith('offline-')
    // A visit saved offline is only on this phone until it syncs — the note is the only record of the visit if the
    // office has to fix it, so ask for one.
    if (isOfflineVisit && !String(visitNote || '').trim()) {
      setNoteError('No signal — please add a short visit note so this visit can be saved on your phone.')
      return
    }
    setClockingOut(true)
    const tapAt = new Date().toISOString() // the real clock-out time, even if the send fails
    const finishSavedOffline = () => {
      say(`No signal — clock-out saved on your phone at ${formatAgencyDateTime(tapAt, { hour: 'numeric', minute: '2-digit' })}. It will send by itself when you have signal.${pendingPhotos.length ? ' Photos could not be saved offline.' : ''}`, 'warning')
      setActiveSession(null)
      setSelectedClient('')
      setVisitNote('')
      setNoteError('')
      setPendingPhotos([])
      setShowNoteModal(false)
    }
    try {
      const lat = location?.latitude || null
      const lng = location?.longitude || null
      const outClientId = sessionClientId(activeSession)
      const outSandataRequired = sessionSandataRequired(activeSession)

      if (isOfflineVisit) {
        // Its clock-in is still on the phone — queue the clock-out behind it.
        const saved = savePunch({ userId: myId, localId: newLocalId(), kind: 'out', at: tapAt,
          inLocalId: String(activeSession.id).slice('offline-'.length), entryId: null,
          latitude: lat, longitude: lng, notes: visitNote })
        if (!saved) throw new Error('This phone could not save the clock-out. Call the office with your end time.')
        finishSavedOffline()
        promptSandata('out', outClientId, outSandataRequired)
        return
      }

      const res = await postPunch(`/api/time-entries/${activeSession.id}/clock-out`, { latitude: lat, longitude: lng, notes: visitNote }, PUNCH_TIMEOUT_MS)
      if (isUnreachable(res)) {
        const saved = savePunch({ userId: myId, localId: newLocalId(), kind: 'out', at: tapAt,
          inLocalId: null, entryId: activeSession.id, latitude: lat, longitude: lng, notes: visitNote })
        if (!saved) throw new Error('No signal, and this phone could not save the clock-out. Call the office with your end time.')
        finishSavedOffline()
        promptSandata('out', outClientId, outSandataRequired)
        return
      }

      if (!res!.ok) {
        const data = (await res!.json().catch(() => ({}))) as { error?: string; code?: string }
        // VA client with no note: keep the modal open so they can add one and retry.
        if (data.code === 'va_note_required') {
          setNoteError(data.error || 'A visit note is required for this client.')
          return
        }
        throw new Error(data.error || 'Failed')
      }

      const outData = (await res!.json().catch(() => null)) as { sandataRequired?: boolean | null } | null
      // Clock-out succeeded — upload any staged visit photos before resetting.
      if (pendingPhotos.length > 0) {
        setPhotoUploading(true)
        let failed = 0
        for (const p of pendingPhotos) {
          try {
            await api.post(`/api/time-entries/${activeSession.id}/photos`, { imageBase64: p.dataUri, caption: p.caption, category: p.category })
          } catch { failed++ }
        }
        setPhotoUploading(false)
        if (failed > 0) say(`${pendingPhotos.length - failed}/${pendingPhotos.length} photos uploaded`, 'warning')
      }

      setActiveSession(null)
      setSelectedClient('')
      setVisitNote('')
      setNoteError('')
      setPendingPhotos([])
      setShowNoteModal(false)
      // The clock-out prompt follows the clock-in decision.
      promptSandata('out', outClientId, outData && outData.sandataRequired != null ? outData.sandataRequired : outSandataRequired)
      loadData()
      reloadSandata()
    } catch (error) {
      say('Failed to clock out: ' + errorMessage(error, 'Failed'), 'error')
      setShowNoteModal(false) // never trap the caregiver in the notes modal on error
    } finally {
      setClockingOut(false)
    }
  }

  // A claim answers ON the card: the button turns into "Sending…" (every Claim is disabled while one is in flight) and
  // then into the claim's state, and the card stays where it was. Run 3: the card vanished on a list reload, the next
  // shift slid under the finger, and a second tap claimed it.
  const handlePickupShift = async (shiftId: string) => {
    if (claimingShiftId) return
    setClaimingShiftId(shiftId)
    try {
      const data: { assigned?: boolean; message?: string } = await api.post(`/api/open-shifts/${shiftId}/claim`)
      // "It's yours — …" when the office offered it first-come, otherwise pending approval.
      setClaimedShifts((prev) => ({ ...prev, [shiftId]: { assigned: !!data?.assigned, message: data?.message || 'Shift claimed — pending approval' } }))
      showMsg(data?.message || 'Shift claimed!')
      loadData()
    } catch (error) {
      showMsg(errorMessage(error, 'Failed'), 'error')
    } finally {
      setClaimingShiftId(null)
    }
  }

  const handleSaveAvailability = async () => {
    try {
      await api.put(`/api/caregiver-availability/${myId}`, {
        status: availability.status,
        maxHoursPerWeek: availability.maxHoursPerWeek,
        weeklyAvailability: availability.weeklyAvailability,
        notes: availability.notes,
      })
      showMsg('Availability saved!')
    } catch (error) {
      showMsg(errorMessage(error, 'Failed'), 'error')
    }
  }

  const handleRequestTimeOff = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTimeOff.startDate || !newTimeOff.endDate) { showMsg('Select dates', 'error'); return }
    try {
      // A time-off REQUEST (dates, pending until the office answers it in PTO & Time Off) — not an absence.
      await api.post('/api/pto', { type: 'pto', startDate: newTimeOff.startDate, endDate: newTimeOff.endDate, reason: newTimeOff.reason })
      showMsg('Request submitted!')
      setNewTimeOff({ startDate: '', endDate: '', reason: '' })
      loadTimeOffRequests()
    } catch (error) {
      showMsg(errorMessage(error, 'Failed'), 'error')
    }
  }

  const goTo = (page: CgPage) => { setCurrentPage(page); setShowMoreDrawer(false) }

  const getClientName = (id: string | null | undefined) => {
    const c = clients.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown'
  }

  const formatTime = (t: string | null | undefined) => {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hr = parseInt(h)
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
  }

  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  /** A calendar day ('YYYY-MM-DD'), e.g. "Tue, Oct 21". */
  const formatDay = (d: string | null | undefined) => d ? formatDate(String(d).slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) : ''
  const getDayName = (n: number) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] || ''

  // Today's appointments from the schedules
  const getTodaysAppointments = (): Shift[] => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayOfWeek = today.getDay()
    const todayStr = toYMD(today)! // the local calendar day, not UTC's

    const recurring = schedules
      .filter((s) => s.dayOfWeek === dayOfWeek && s.dayOfWeek !== null && !s.date && isScheduleActiveForDate(s, today))
      .map((s) => applyExceptionForDate(s, todayStr))
      .filter((s): s is Shift => !!s)
    const oneTime = schedules
      .filter((s) => s.date && String(s.date).slice(0, 10) === todayStr && !isSuspendedOn(s, todayStr))
      .map((s) => applyExceptionForDate(s, todayStr))
      .filter((s): s is Shift => !!s)
    // A moved-in (covering) shift identical to an own shift today is shown once.
    const ownToday = new Set(recurring.map((s) => `${s.clientId}|${s.startTime}|${s.endTime}`))
    const oneTimeDeduped = oneTime.filter((s) => !s.movedIn || !ownToday.has(`${s.clientId}|${s.startTime}|${s.endTime}`))

    return [...recurring, ...oneTimeDeduped].sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'))
  }

  const getClientById = (id: string | null | undefined) => clients.find((c) => c.id === id)

  const loadUnsignedDocs = async () => {
    if (!myId) return
    try { setUnsignedDocs(rows<UnsignedDoc>(await api.get(`/api/documents/unsigned/${myId}`))) } catch { /* not fatal */ }
  }
  useEffect(() => { loadUnsignedDocs() }, [myId]) // eslint-disable-line react-hooks/exhaustive-deps

  const submitDocSignature = async (dataUri: string, typedName: string | null) => {
    if (!signTarget) return
    await api.post(`/api/documents/${signTarget.id}/sign`, { signatureImageBase64: dataUri, typedName })
    say('Signed ✓')
    setSignTarget(null)
    loadUnsignedDocs()
  }

  // ── RENDER PAGES ────────────────────────────────────────────────────────────
  const renderHomePage = () => {
    const todaysAppointments = getTodaysAppointments()
    const incoming = swapRequests.filter((s) => s.targetId === myId && s.status === 'pending')
    const sessionClient = sandataClient(sessionClientId(activeSession))
    const sessionRequired = sessionSandataRequired(activeSession)

    return (
      <>
        {/* White on indigo-700 → purple-800: dark enough in both themes (the template's #667eea carried white at 3.7:1). */}
        <div className="hc-card" style={{ background: 'linear-gradient(135deg, #4338ca 0%, #6b21a8 100%)', color: '#fff', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.9rem' }}>Hours This Week</div>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{myHoursThisWeek.toFixed(2)}h</div>
            </div>
            <div style={{ fontSize: '3rem', opacity: 0.5 }} aria-hidden="true">⏱️</div>
          </div>
          {myHoursThisWeek > 35 && (
            <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.25)', borderRadius: '6px', fontSize: '0.85rem' }}>
              ⚠️ Approaching 40 hour limit
            </div>
          )}
        </div>

        {/* Incoming swap requests — a coworker wants me to take their shift */}
        {incoming.length > 0 && (
          <div className="hc-card border-l-4 border-indigo-500" style={{ marginBottom: '1rem' }}>
            <div className="hc-card-title !text-indigo-700 dark:!text-indigo-300">
              🔄 {incoming.length} shift swap request{incoming.length === 1 ? '' : 's'} for you
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {incoming.map((req) => (
                <div key={req.id} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-gray-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-slate-100">
                  <div className="font-semibold">{req.requesterFirst} {req.requesterLast} wants you to take their shift</div>
                  <div className="text-[0.82rem] text-indigo-700 dark:text-indigo-300">
                    {req.shiftDate && formatDay(req.shiftDate)} {req.startTime ? `· ${formatTime(req.startTime)}–${formatTime(req.endTime)}` : ''} {req.clientFirst ? `· ${req.clientFirst} ${req.clientLast}` : ''}
                  </div>
                  {req.reason && <div className="mt-1 text-[0.82rem] italic text-gray-700 dark:text-slate-300">"{req.reason}"</div>}
                  <div className="mt-1.5 flex gap-1.5">
                    <button onClick={() => respondToSwap(req, true)} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white">✓ Take it</button>
                    <button onClick={() => respondToSwap(req, false)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 dark:border-red-800 dark:bg-slate-900 dark:text-red-300">✕ Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Moves this caregiver asked for — so a request doesn't vanish after sending */}
        {myReschedules.length > 0 && (
          <div className="hc-card border-l-4 border-emerald-600" style={{ marginBottom: '1rem' }}>
            <div className="hc-card-title !text-emerald-700 dark:!text-emerald-300">Waiting on the Office ({myReschedules.length})</div>
            <div className="flex flex-col gap-2">
              {myReschedules.map((cr) => (
                <div key={cr.id} className="rounded-lg border border-green-200 bg-green-50 p-3 text-[0.88rem] text-gray-800 dark:border-green-900 dark:bg-green-950/40 dark:text-slate-100">
                  <div className="font-bold text-emerald-800 dark:text-emerald-200">{cr.clientFirstName} {cr.clientLastName}</div>
                  <div className={`mt-0.5 ${PAIR_SOFT}`}>
                    {cr.visitDate} {formatTime(cr.originalStartTime)} → <strong>{cr.proposedDate} {formatTime(cr.proposedStartTime)}–{formatTime(cr.proposedEndTime)}</strong>
                  </div>
                  <div className={`mt-1 text-[0.8rem] ${PAIR_MUTED}`}>
                    {cr.status === 'counter_offered'
                      ? `Office suggested ${cr.counterDate} at ${formatTime(cr.counterStartTime)} — call the office to confirm.`
                      : 'Pending — work the original time until it is approved.'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What clients asked about my visits */}
        {changeRequests.length > 0 && (
          <div className="hc-card border-l-4 border-amber-600" style={{ marginBottom: '1rem' }}>
            <div className="hc-card-title !text-amber-800 dark:!text-amber-300">Client Requests ({changeRequests.length})</div>
            <div className="flex flex-col gap-3">
              {changeRequests.slice(0, 5).map((cr) => (
                <div key={cr.id} className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-gray-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-slate-100">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className={`font-semibold ${PAIR_INK}`}>{cr.clientFirstName} {cr.clientLastName}</div>
                      <div className={`text-[0.85rem] ${PAIR_MUTED}`}>
                        {cr.requestType === 'cancel' ? 'Wants to cancel' : 'Wants to reschedule'} — {cr.visitDate} {formatTime(cr.originalStartTime)}
                      </div>
                      {cr.cancelReason && <div className="mt-1 text-[0.82rem] text-amber-800 dark:text-amber-200">Reason: {cr.cancelReason}</div>}
                      {cr.requestType === 'reschedule' && cr.proposedDate && (
                        <div className="mt-1 text-[0.82rem] text-blue-700 dark:text-blue-300">
                          Proposed: {cr.proposedDate} {cr.proposedStartTime?.slice(0, 5)} - {cr.proposedEndTime?.slice(0, 5)}
                        </div>
                      )}
                      {cr.status === 'counter_offered' && (
                        <div className="mt-1 text-[0.82rem] text-violet-700 dark:text-violet-300">
                          You suggested {cr.counterDate} {cr.counterStartTime?.slice(0, 5)} — waiting on the client.
                        </div>
                      )}
                    </div>
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${cr.requestType === 'cancel'
                      ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'}`}>
                      {cr.requestType === 'cancel' ? 'Cancel' : 'Reschedule'}
                    </span>
                  </div>
                  {cr.status === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="rounded-md bg-emerald-700 px-3 py-1.5 text-[0.8rem] font-semibold text-white disabled:opacity-60"
                        disabled={crResolving === cr.id} onClick={() => resolveChangeRequest(cr.id, 'approve')}>Approve</button>
                      <button className="rounded-md bg-red-700 px-3 py-1.5 text-[0.8rem] font-semibold text-white disabled:opacity-60"
                        disabled={crResolving === cr.id} onClick={() => resolveChangeRequest(cr.id, 'deny')}>Deny</button>
                      {cr.requestType === 'reschedule' && (
                        <button className="rounded-md bg-violet-700 px-3 py-1.5 text-[0.8rem] font-semibold text-white disabled:opacity-60"
                          disabled={crResolving === cr.id} onClick={() => counterOffer(cr)}>Counter-Offer</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Today's Appointments */}
        <div className="hc-card" style={{ marginBottom: '1rem' }}>
          <div className="hc-card-title">📅 Today's Appointments</div>
          {todaysAppointments.length === 0 ? (
            <p className="text-muted text-center" style={{ padding: '1rem 0' }}>No appointments scheduled for today</p>
          ) : (
            <div className="flex flex-col gap-3">
              {todaysAppointments.map((appt, idx) => {
                const client = getClientById(appt.clientId)
                const isCurrentClient = activeSession?.clientId === appt.clientId
                return (
                  <div key={appt.id || idx} className={`rounded-lg p-4 ${isCurrentClient
                    ? 'border-2 border-blue-600 bg-blue-100 dark:border-blue-400 dark:bg-blue-950/60'
                    : 'border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className={`text-lg font-semibold ${PAIR_INK}`}>
                          {client ? `${client.firstName} ${client.lastName}` : 'Unknown Client'}
                          {isCurrentClient && <span className="ml-2 text-sm text-emerald-700 dark:text-emerald-300">● Active</span>}
                        </div>
                        <div className={`mt-1 text-sm ${PAIR_MUTED}`}>🕐 {formatTime(appt.startTime)} - {formatTime(appt.endTime)}</div>
                        {client && (
                          <div className={`mt-2 text-[0.85rem] ${PAIR_MUTED}`}>
                            {client.phone && <span>📞 {client.phone}</span>}
                            {client.address && <span style={{ marginLeft: client.phone ? '1rem' : 0 }}>📍 {client.address}{client.city ? `, ${client.city}` : ''}</span>}
                          </div>
                        )}
                        {appt.notes && (
                          <div className="mt-2 rounded bg-amber-100 p-2 text-[0.85rem] text-gray-700 dark:bg-amber-900/40 dark:text-amber-100">📝 {appt.notes}</div>
                        )}
                      </div>
                      <div className="ml-4 flex flex-col gap-2">
                        <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setViewingClientId(appt.clientId)}>View</button>
                        {!activeSession && (
                          <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => setSelectedClient(appt.clientId)}>Select</button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* SANDATA EVV — visits for clients in Sandata are also checked in/out on Sandata Mobile Connect */}
        {sandataPrompt && (
          <SandataPrompt prompt={sandataPrompt} client={sandataClient(sandataPrompt.clientId)} ctx={sandataCtx}
            email={user?.email} onClose={() => setSandataPrompt(null)} />
        )}

        {/* Documents waiting for this caregiver's signature */}
        {unsignedDocs.length > 0 && (
          <div className="hc-card mb-4 border-l-4 border-red-600 dark:border-red-500">
            <div className="hc-card-title !text-red-700 dark:!text-red-300">
              ✍️ {unsignedDocs.length} document{unsignedDocs.length === 1 ? '' : 's'} need your signature
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {unsignedDocs.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-gray-900 dark:border-red-900 dark:bg-red-950 dark:text-slate-100">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{d.name || d.fileName || 'Document'}</div>
                    {d.description && <div className="text-xs text-gray-600 dark:text-slate-300">{d.description}</div>}
                    {d.expirationDate && <div className="mt-0.5 text-xs text-red-700 dark:text-red-300">Expires {String(d.expirationDate).slice(0, 10)}</div>}
                  </div>
                  <button type="button" onClick={() => setSignTarget(d)}
                    className="ml-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-bold text-white dark:bg-teal-700 dark:text-white">✍️ Sign</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MOBILE-FIRST CLOCK-IN — Full prominent card */}
        <div className="hc-card" style={{ padding: 0, overflow: 'hidden' }}>
          {activeSession ? (
            // ACTIVE SESSION — big timer, center-stage
            <div className="bg-gradient-to-br from-green-50 to-green-100 px-6 py-8 text-center dark:from-green-950 dark:to-slate-900">
              <div className="mb-1 text-sm font-semibold text-green-800 dark:text-green-200">
                🟢 Clocked In with {getClientName(activeSession.clientId)}
              </div>
              <div className="my-2 font-mono text-6xl font-black leading-tight text-green-700 dark:text-green-300">
                {formatElapsed(elapsedTime)}
              </div>
              <div className={`mb-6 text-[0.82rem] ${PAIR_MUTED}`}>
                {location ? `📍 GPS Active (±${location.accuracy?.toFixed(0)}m)` : '📍 Location unavailable'}
              </div>
              <button onClick={handleClockOut}
                className="w-full rounded-xl bg-red-700 p-[1.125rem] text-[1.15rem] font-extrabold tracking-wide text-white shadow-lg">
                🛑 Clock Out
              </button>
              {evvWeekMet(sessionClient, sessionRequired) && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                  ✅ This week's EVV hours are done — no Sandata for this visit.
                </div>
              )}
              {visitNeedsSandata(sessionClient, sessionRequired) && (
                <>
                  <button type="button" onClick={openSandata}
                    className="mt-3 w-full rounded-xl border-2 border-orange-700 bg-white py-3 font-bold text-orange-700 dark:border-orange-400 dark:bg-slate-900 dark:text-orange-200">
                    📲 Open the Sandata app (check in / check out)
                    <div className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">Not installed yet? This takes you to the store to download it.</div>
                  </button>
                  <SandataIdBox client={sessionClient} />
                  <button type="button" onClick={() => setShowSandataHelp((v) => !v)}
                    className="mt-1 bg-transparent text-sm text-orange-700 underline dark:text-orange-200">
                    {showSandataHelp ? 'Hide login help' : 'How do I log in to Sandata?'}
                  </button>
                  {showSandataHelp && <SandataHelp agencyId={sandataCtx?.sandataAgencyId || null} isWisconsin={!!sandataCtx?.isWisconsin} email={user?.email} />}
                </>
              )}
              {liveEntryId && (
                <div className="mt-5 rounded-xl bg-white p-1 text-left dark:bg-slate-800">
                  <CareTaskChecklist timeEntryId={liveEntryId} />
                </div>
              )}
              {/* During the visit: the MAR (a dose given / refused / held), vitals, and a photo now — not only on the
                  clock-out sheet (Run 3 HIGH 7). */}
              {liveEntryId && activeSession.clientId && (
                <div className="mt-3 rounded-xl bg-white p-1 text-left dark:bg-slate-800">
                  <VisitCarePanel timeEntryId={liveEntryId} clientId={activeSession.clientId} />
                </div>
              )}
            </div>
          ) : (
            // CLOCK IN — prominent select + button
            <div style={{ padding: '1.5rem' }}>
              <div className={`mb-4 text-center text-lg font-extrabold ${PAIR_INK}`}>⏰ Ready to Start a Shift?</div>
              {(sandataCtx?.clients || []).some(needsSandata) && (
                <div className="mb-3 text-center">
                  <button type="button" onClick={() => setShowSandataHelp((v) => !v)}
                    className="bg-transparent text-sm text-orange-700 underline dark:text-orange-200">
                    📲 {showSandataHelp ? 'Hide Sandata login help' : 'Set up Sandata (needed for your Sandata visits)'}
                  </button>
                  {showSandataHelp && <SandataHelp agencyId={sandataCtx?.sandataAgencyId || null} isWisconsin={!!sandataCtx?.isWisconsin} email={user?.email} />}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: '0.875rem' }}>
                <label htmlFor="cg-clock-in-client" style={{ fontWeight: 700 }}>Select Client *</label>
                <select id="cg-clock-in-client" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
                  className="box-border w-full rounded-[10px] border-2 border-gray-300 bg-white p-3.5 text-base text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                  <option value="">Choose client...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
                {/* Sandata client: the ID to paste into Sandata, ready before they even clock in. */}
                {selectedClient && <SandataIdBox client={sandataClient(selectedClient)} />}
              </div>
              <div className={`mb-4 rounded-lg border px-3.5 py-2.5 text-[0.85rem] ${location
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200'
                : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {location ? `✅ GPS Active (±${location.accuracy?.toFixed(0)}m)` : locationError ? '⚠️ Location unavailable — you can still clock in' : '📍 Getting your location...'}
              </div>
              <button onClick={handleClockIn} disabled={!selectedClient || clockingIn}
                className={`w-full rounded-xl p-[1.125rem] text-[1.15rem] font-extrabold transition ${selectedClient
                  ? 'text-white shadow-lg'
                  : 'cursor-not-allowed bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}
                style={selectedClient ? { background: BRAND_FILL } : undefined}>
                {clockingIn ? '⏳ Clocking in…' : '▶️ Clock In'}
              </button>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
          <button type="button" className="hc-card text-center" style={{ cursor: 'pointer', padding: '1rem', marginBottom: 0 }} onClick={() => goTo('open-shifts')}>
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">📋</div>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>Open Shifts</div>
          </button>
          <button type="button" className="hc-card text-center" style={{ cursor: 'pointer', padding: '1rem', marginBottom: 0 }} onClick={() => goTo('availability')}>
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">⏰</div>
            <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>Availability</div>
          </button>
          <button type="button" className="hc-card border border-red-300 !bg-red-50 text-center dark:border-red-800 dark:!bg-red-950/50" style={{ cursor: 'pointer', padding: '1rem', marginBottom: 0 }}
            onClick={() => setShowMissReport(true)}>
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">🚨</div>
            <div className="text-red-700 dark:text-red-300" style={{ fontWeight: 600, fontSize: '0.82rem' }}>Miss Report</div>
          </button>
          <button type="button" className="hc-card relative border border-indigo-200 !bg-indigo-50 text-center dark:border-indigo-800 dark:!bg-indigo-950/50" style={{ cursor: 'pointer', padding: '1rem', marginBottom: 0 }}
            onClick={() => setShowMessages(true)}>
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">💬</div>
            <div className="text-indigo-700 dark:text-indigo-300" style={{ fontWeight: 600, fontSize: '0.82rem' }}>Messages</div>
            {unreadMessages > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-[16px] rounded-full bg-red-700 px-1.5 text-center text-[0.62rem] font-bold text-white">{unreadMessages}</span>
            )}
          </button>
          <button type="button" className="hc-card border border-emerald-200 !bg-emerald-50 text-center dark:border-emerald-800 dark:!bg-emerald-950/50" style={{ cursor: 'pointer', padding: '1rem', marginBottom: 0 }}
            onClick={() => setShowHelp(true)}>
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">❓</div>
            <div className="text-emerald-800 dark:text-emerald-300" style={{ fontWeight: 600, fontSize: '0.82rem' }}>Help</div>
          </button>
        </div>
      </>
    )
  }

  const renderOpenShiftsPage = () => (
    <>
      <div className="schedule-header"><h3>📋 Available Shifts</h3></div>
      {openShifts.length === 0 ? (
        <div className="hc-card text-center"><p style={{ fontSize: '3rem', margin: '1rem 0' }}>✅</p><p className="text-muted">No open shifts</p></div>
      ) : (
        <div className="flex flex-col gap-3">
          {openShifts.map((shift) => (
            <div key={shift.id} className="hc-card" style={{ padding: '1rem', marginBottom: 0 }}>
              <div className="flex items-start justify-between">
                <div>
                  <div style={{ fontWeight: 600 }}>{shift.clientFirstName} {shift.clientLastName}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--hc-muted)' }}>📅 {formatDay(shift.date)}</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--hc-muted)' }}>🕐 {formatTime(shift.startTime)} - {formatTime(shift.endTime)}</div>
                </div>
                {claimedShifts[shift.id] ? (
                  <span role="status"
                    className={claimedShifts[shift.id].assigned
                      ? 'shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-bold border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-bold border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'}>
                    {claimedShifts[shift.id].assigned ? '✅ Yours' : '⏳ Claimed — waiting for the office'}
                  </span>
                ) : (
                  <button className="hc-btn hc-btn-sm hc-btn-primary" disabled={!!claimingShiftId}
                    aria-busy={claimingShiftId === shift.id}
                    onClick={() => handlePickupShift(shift.id)}>
                    {claimingShiftId === shift.id ? 'Sending…' : 'Claim'}
                  </button>
                )}
              </div>
              {claimedShifts[shift.id] && (
                <div className="mt-2 rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-700 dark:bg-slate-800 dark:text-slate-200">{claimedShifts[shift.id].message}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )

  const setDay = (day: number, patch: Partial<DayAvailability>) => {
    const d = availability.weeklyAvailability[day] || { available: false, start: '09:00', end: '17:00' }
    setAvailability({ ...availability, weeklyAvailability: { ...availability.weeklyAvailability, [day]: { ...d, ...patch } } })
  }
  const timeInput = 'rounded border border-gray-300 bg-white px-1 py-0.5 text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

  const renderAvailabilityPage = () => (
    <>
      <div className="schedule-header"><h3>⏰ My Availability</h3></div>
      <div className="hc-card">
        <div className="form-group">
          <label htmlFor="cg-avail-status">Status</label>
          <select id="cg-avail-status" value={availability.status} onChange={(e) => setAvailability({ ...availability, status: e.target.value })}>
            <option value="available">✅ Available</option>
            <option value="limited">⚠️ Limited</option>
            <option value="unavailable">❌ Unavailable</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="cg-avail-max">Max Hours/Week: {availability.maxHoursPerWeek}</label>
          <input id="cg-avail-max" type="range" min="0" max="60" value={availability.maxHoursPerWeek} onChange={(e) => setAvailability({ ...availability, maxHoursPerWeek: parseInt(e.target.value) })} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <label>Weekly Schedule</label>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => {
            const d = availability.weeklyAvailability[day] || { available: false, start: '09:00', end: '17:00' }
            return (
              <div key={day} className={`mb-1 flex items-center gap-2 rounded-md p-2 ${d.available
                ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100'
                : 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>
                <input type="checkbox" checked={d.available} aria-label={`Available ${getDayName(day)}`} onChange={(e) => setDay(day, { available: e.target.checked })} style={{ width: 'auto' }} />
                <span style={{ width: '60px', fontWeight: 500 }}>{getDayName(day).slice(0, 3)}</span>
                {d.available && (
                  <>
                    <input type="time" value={d.start} className={timeInput} aria-label={`${getDayName(day)} start`} onChange={(e) => setDay(day, { start: e.target.value })} />
                    <span>-</span>
                    <input type="time" value={d.end} className={timeInput} aria-label={`${getDayName(day)} end`} onChange={(e) => setDay(day, { end: e.target.value })} />
                  </>
                )}
              </div>
            )
          })}
        </div>
        <div className="form-group">
          <label htmlFor="cg-avail-notes">Notes</label>
          <textarea id="cg-avail-notes" value={availability.notes} onChange={(e) => setAvailability({ ...availability, notes: e.target.value })} rows={2} placeholder="Any notes..." />
        </div>
        <button className="hc-btn hc-btn-primary hc-btn-block" onClick={handleSaveAvailability}>💾 Save</button>
      </div>
    </>
  )

  const TIME_OFF_ROW: Record<string, string> = {
    approved: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100',
    denied: 'bg-red-100 text-red-950 dark:bg-red-950/60 dark:text-red-100',
    pending: 'bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100',
  }
  const TIME_OFF_CHIP: Record<string, string> = { approved: 'bg-emerald-700', denied: 'bg-red-700', pending: 'bg-amber-700' }

  const renderTimeOffPage = () => (
    <>
      <div className="schedule-header"><h3>🏖️ Time Off</h3></div>
      <div className="hc-card" style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: '0 0 1rem 0' }}>Request Time Off</h4>
        <form onSubmit={handleRequestTimeOff}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="cg-to-start">Start</label>
              <input id="cg-to-start" type="date" value={newTimeOff.startDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, startDate: e.target.value })} min={toLocalYMD(new Date())} required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="cg-to-end">End</label>
              <input id="cg-to-end" type="date" value={newTimeOff.endDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, endDate: e.target.value })} min={newTimeOff.startDate || toLocalYMD(new Date())} required />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="cg-to-reason">Reason</label>
            <input id="cg-to-reason" type="text" value={newTimeOff.reason} onChange={(e) => setNewTimeOff({ ...newTimeOff, reason: e.target.value })} placeholder="Vacation, etc." />
          </div>
          <button type="submit" className="hc-btn hc-btn-primary">Submit</button>
        </form>
      </div>
      <div className="hc-card">
        <h4 style={{ margin: '0 0 1rem 0' }}>My Requests</h4>
        {timeOffRequests.length === 0 ? <p className="text-muted text-center">None</p> : (
          <div className="flex flex-col gap-2">
            {timeOffRequests.map((r) => {
              const st = r.status === 'approved' || r.status === 'denied' ? r.status : 'pending'
              return (
                <div key={r.id} className={`flex items-center justify-between rounded-md p-3 ${TIME_OFF_ROW[st]}`}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{formatDay(r.startDate)} - {formatDay(r.endDate)}</div>
                    {r.reason && <div className="text-[0.85rem] opacity-90">{r.reason}</div>}
                  </div>
                  <span className={`rounded-xl px-3 py-1 text-xs font-semibold text-white ${TIME_OFF_CHIP[st]}`}>
                    {(r.status || 'pending').toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  // The three things a caregiver can do about one visit: say the client wasn't available, ask a coworker to take it,
  // or ask the office to move it.
  const shiftActions = (s: Shift) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      <button onClick={() => { setUnavailModal(s); setUnavailForm({ reason: '', note: '' }) }}
        className={`${ACTION_BTN} border-red-200 text-red-700 dark:border-red-800 dark:text-red-300`}
        title="Client refused care, wasn't home, or cancelled — the visit won't be billed">🚫 Client N/A</button>
      {swapPendingFor(s) ? (
        <span className={CHIP_PENDING} title="Waiting on your coworker and the office">⏳ Swap sent</span>
      ) : (
        <button onClick={() => { setSwapModal(s); setSwapForm({ targetCaregiverId: '', reason: '' }) }}
          className={`${ACTION_BTN} border-indigo-200 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300`}
          title="Ask a coworker to take this shift">🔄 Swap</button>
      )}
      {movePendingFor(s) ? (
        <span className={CHIP_PENDING} title="Waiting on the office">⏳ Move sent</span>
      ) : (
        <button onClick={() => openMoveModal(s)}
          className={`${ACTION_BTN} border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300`}
          title="Ask the office to move this shift to another day or time">🕐 Move</button>
      )}
    </div>
  )

  const renderSchedulePage = () => {
    // Every schedule (recurring + one-time + moved-in) resolved into concrete dated visits for the next 14 days, each
    // with that day's exception applied — cancelled gone, modified at its new time.
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const todayStr = toYMD(today)!
    const concreteShifts: (Shift & { resolvedDate: string })[] = []

    schedules.forEach((s) => {
      if (s.date) {
        const dateStr = String(s.date).slice(0, 10)
        if (dateStr >= todayStr && !isSuspendedOn(s, dateStr)) {
          const resolved = applyExceptionForDate(s, dateStr)
          if (resolved) concreteShifts.push({ ...resolved, resolvedDate: dateStr })
        }
      } else if (s.dayOfWeek != null) {
        for (let d = 0; d < 14; d++) {
          const target = new Date(today)
          target.setDate(target.getDate() + d)
          if (target.getDay() !== s.dayOfWeek) continue
          if (!isScheduleActiveForDate(s, target)) continue
          const dateStr = toYMD(target)!
          const resolved = applyExceptionForDate(s, dateStr)
          if (resolved) concreteShifts.push({ ...resolved, resolvedDate: dateStr })
        }
      }
    })

    // A moved-in copy identical to an own shift is shown once.
    const ownKeys = new Set(concreteShifts.filter((s) => !s.movedIn).map((s) => `${s.clientId}|${s.resolvedDate}|${s.startTime}|${s.endTime}`))
    const shifts = concreteShifts.filter((s) => !s.movedIn || !ownKeys.has(`${s.clientId}|${s.resolvedDate}|${s.startTime}|${s.endTime}`))
    shifts.sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate) || (a.startTime || '').localeCompare(b.startTime || ''))

    const byDate: Record<string, Shift[]> = {}
    shifts.forEach((s) => { (byDate[s.resolvedDate] ||= []).push(s) })
    const todayShifts = byDate[todayStr] || []
    const upcomingKeys = Object.keys(byDate).sort().filter((d) => d > todayStr)
    const formatDateLabel = (dateStr: string) => formatDate(dateStr, { weekday: 'long', month: 'short', day: 'numeric' })

    // Week at a glance: 7 days from today with the hours each day.
    const hoursOf = (s: Shift) => {
      const [sh, sm] = (s.startTime || '00:00').split(':').map(Number)
      const [eh, em] = (s.endTime || '00:00').split(':').map(Number)
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins < 0) mins += 24 * 60
      return mins / 60
    }
    const weekDays: { key: string; dt: Date; shifts: Shift[]; totalHrs: number; isToday: boolean }[] = []
    for (let d = 0; d < 7; d++) {
      const dt = new Date(today); dt.setDate(today.getDate() + d)
      const key = toYMD(dt)!
      const dayShifts = byDate[key] || []
      weekDays.push({ key, dt, shifts: dayShifts, totalHrs: dayShifts.reduce((sum, s) => sum + hoursOf(s), 0), isToday: d === 0 })
    }
    const weekTotalHrs = weekDays.reduce((s, d) => s + d.totalHrs, 0)

    const row = (s: Shift, i: number) => (
      <div key={s.id + '-' + i} className="flex flex-wrap items-center justify-between gap-2 py-2" style={{ borderTop: '1px solid var(--hc-line)' }}>
        <div className="min-w-[140px] flex-1">
          <div style={{ fontWeight: 500 }}>{getClientName(s.clientId)}{s.movedIn ? ' (covering)' : ''}</div>
          <div className={`text-sm ${PAIR_MUTED}`}>{formatTime(s.startTime)} - {formatTime(s.endTime)}</div>
        </div>
        {shiftActions(s)}
      </div>
    )

    return (
      <>
        <div className="schedule-header"><h3>📅 My Schedule</h3></div>

        <div style={{ marginBottom: '0.75rem' }}>
          <div className={`mb-1.5 flex items-center justify-between text-[0.85rem] ${PAIR_SOFT}`}>
            <strong>This Week</strong>
            <span>{weekTotalHrs.toFixed(1)}h total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weekDays.map((d) => (
              <div key={d.key} className={`rounded-md border px-1 py-1.5 text-center text-[0.7rem] ${d.isToday
                ? 'border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-950/60'
                : d.shifts.length > 0 ? 'border-transparent bg-green-50 dark:bg-green-950/40' : 'border-transparent bg-gray-100 dark:bg-slate-800'}`}>
                <div className={`font-bold ${d.isToday ? 'text-blue-800 dark:text-blue-200' : PAIR_SOFT}`}>{formatDate(d.dt, { weekday: 'short' })}</div>
                <div className={`mt-0.5 text-[0.95rem] font-bold ${PAIR_INK}`}>{d.dt.getDate()}</div>
                {d.shifts.length > 0 ? (
                  <>
                    <div className="mt-1 font-bold text-emerald-700 dark:text-emerald-300">{d.totalHrs.toFixed(1)}h</div>
                    <div className={PAIR_MUTED}>{d.shifts.length} shift{d.shifts.length !== 1 ? 's' : ''}</div>
                  </>
                ) : (
                  <div className={`mt-1 ${PAIR_MUTED}`}>off</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {shifts.length === 0 ? (
          <div className="hc-card text-center"><p className="text-muted">No upcoming shifts</p></div>
        ) : (
          <div>
            {todayShifts.length > 0 && (
              <div className="hc-card border-l-4 border-blue-600" style={{ marginBottom: '0.75rem' }}>
                <div className="mb-2 font-semibold text-blue-700 dark:text-blue-300">Today — {formatDateLabel(todayStr)}</div>
                {todayShifts.map(row)}
              </div>
            )}
            {upcomingKeys.map((dateStr) => (
              <div key={dateStr} className="hc-card" style={{ marginBottom: '0.75rem' }}>
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">{formatDateLabel(dateStr)}</div>
                {byDate[dateStr].map(row)}
              </div>
            ))}
          </div>
        )}
      </>
    )
  }

  const linkStyle: CSSProperties = { cursor: 'pointer', color: 'var(--hc-blue-ink)', background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'left' }

  const renderHistoryPage = () => (
    <div className="hc-card">
      <div className="hc-card-title">Recent Visits</div>
      {recentVisits.length === 0 ? <p className="text-muted text-center">None</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="hc-table">
            <thead><tr><th>Date</th><th>Client</th><th>Hours</th></tr></thead>
            <tbody>
              {recentVisits.map((v, i) => (
                <tr key={v.id || i}>
                  <td>{formatAgencyDate(v.startTime, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td><button type="button" onClick={() => setViewingClientId(v.clientId)} style={linkStyle}>{v.clientName || getClientName(v.clientId)}</button></td>
                  <td>{v.hoursWorked ? `${parseFloat(v.hoursWorked).toFixed(2)}h` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const renderClientsPage = () => {
    const myClients = clients.filter((c) => schedules.some((s) => s.clientId === c.id))
    return (
      <>
        <div className="schedule-header"><h3>👥 My Clients</h3></div>
        {myClients.length === 0 ? <div className="hc-card text-center"><p className="text-muted">No clients</p></div> : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {myClients.map((c) => (
              <button key={c.id} type="button" className="hc-card" onClick={() => setViewingClientId(c.id)} style={{ cursor: 'pointer', textAlign: 'left', marginBottom: 0, width: '100%' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h4 style={{ margin: 0 }}>{c.firstName} {c.lastName}</h4>
                    <p style={{ margin: '0.25rem 0 0 0', color: 'var(--hc-muted)', fontSize: '0.9rem' }}>📞 {c.phone || 'N/A'} • 📍 {c.city || 'N/A'}</p>
                  </div>
                  <span style={{ color: 'var(--hc-blue-ink)', fontSize: '1.2rem' }} aria-hidden="true">→</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim()

  const renderSettingsPage = () => (
    <>
      <div className="hc-card">
        <div className="hc-card-title">Profile</div>
        <div className="form-group"><label htmlFor="cg-name">Name</label><input id="cg-name" type="text" value={fullName} disabled /></div>
        <div className="form-group"><label htmlFor="cg-email">Email</label><input id="cg-email" type="text" value={user?.email || ''} disabled /></div>
      </div>
      <div className="hc-card">
        <div className="hc-card-title">GPS Status</div>
        <div className={`alert ${location ? 'alert-success' : 'alert-info'}`}>
          {location ? <>GPS Active (±{location.accuracy?.toFixed(0)}m)</> : <>{locationError || 'Location unavailable'} - Clock in still works</>}
        </div>
      </div>
      {/* Their own two-factor sign-in (a caregiver's account opens clients' care plans and medications too): the app's
          own page. */}
      <div className="hc-card">
        <div className="hc-card-title">Sign-in & Security</div>
        <p style={{ marginBottom: '0.75rem', color: 'var(--hc-ink-soft)' }}>Turn on two-factor sign-in and manage your password.</p>
        <Link to="/crm/account" className="hc-btn hc-btn-secondary">Open sign-in &amp; security</Link>
      </div>
      <button className="hc-btn hc-btn-danger hc-btn-block" onClick={() => { logout() }}>Log Out</button>
    </>
  )

  if (loading) return <div className="loading"><div className="spinner" /></div>

  const tabStyle = (active: boolean): CSSProperties => active
    ? { background: BRAND_TINT, color: BRAND_INK, fontWeight: 700 }
    : { background: 'transparent', color: 'var(--hc-ink-soft)', fontWeight: 600 }

  return (
    <div className="w-full max-[768px]:pb-24">
      {message.text && (
        <div role={message.type === 'error' ? 'alert' : 'status'} style={{ position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem', borderRadius: '8px', zIndex: 1001,
          background: message.type === 'error' ? 'var(--hc-danger-bg)' : 'var(--hc-success-bg)',
          color: message.type === 'error' ? 'var(--hc-danger-ink)' : 'var(--hc-success-ink)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {message.text}
        </div>
      )}

      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <h1>{company?.name || 'Caregiver Portal'}</h1>
          <p>Caregiver Portal{fullName ? ` · ${fullName}` : ''}</p>
        </div>
        <button onClick={() => { logout() }}
          className="whitespace-nowrap rounded-lg bg-red-100 px-3.5 py-1.5 text-[0.82rem] font-bold text-red-700 dark:bg-red-950/60 dark:text-red-200">
          ⏻ Logout
        </button>
      </div>

      {/* The sections (the template's sidebar); on a phone, the bottom bar and its "More" drawer. */}
      <nav aria-label="Caregiver sections" className="hidden flex-wrap items-center gap-1 px-6 min-[769px]:flex">
        {[...MAIN_PAGES, ...SELF_PAGES, { page: 'settings' as CgPage, icon: '⚙️', label: 'Settings' }].map(({ page, icon, label }) => (
          <button key={page} type="button" onClick={() => goTo(page)} aria-current={currentPage === page ? 'page' : undefined}
            className="rounded-lg px-3 py-1.5 text-sm" style={tabStyle(currentPage === page)}>
            {icon} {label}
          </button>
        ))}
      </nav>

      <div className="container">
        {currentPage === 'home' && renderHomePage()}
        {currentPage === 'schedule' && renderSchedulePage()}
        {currentPage === 'clients' && renderClientsPage()}
        {currentPage === 'history' && renderHistoryPage()}
        {currentPage === 'open-shifts' && renderOpenShiftsPage()}
        {currentPage === 'availability' && renderAvailabilityPage()}
        {currentPage === 'time-off' && renderTimeOffPage()}
        {currentPage === 'miss-report' && <ShiftMissReport onClose={() => setCurrentPage('home')} />}
        {currentPage === 'incident-report' && <IncidentReportForm onClose={() => setCurrentPage('home')} />}
        {currentPage === 'settings' && renderSettingsPage()}
      </div>

      <SandataNotice userId={myId} ctx={sandataCtx} companyPhone={company?.phone}
        onSetup={() => { setCurrentPage('home'); setShowSandataHelp(true) }} />

      {showNoteModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header"><h2>Visit Notes</h2><button className="close-btn" aria-label="Close" onClick={() => { setShowNoteModal(false); setNoteError('') }}>×</button></div>
            <p className={noteError ? '' : 'text-muted'} role={noteError ? 'alert' : undefined} style={noteError ? { color: 'var(--hc-red-ink)', fontWeight: 600 } : undefined}>
              {noteError || 'Add notes (optional)'}
            </p>
            <div className="form-group">
              <textarea value={visitNote} aria-label="Visit note"
                onChange={(e) => { setVisitNote(e.target.value); if (noteError) setNoteError('') }}
                placeholder="How did the visit go?" rows={4}
                style={noteError ? { borderColor: 'var(--hc-red-ink)' } : undefined} />
            </div>

            {/* Visit photos — proof of care; uploaded once the clock-out goes through */}
            <div className="form-group">
              <label htmlFor="cg-visit-photos" style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>
                📷 Photos ({pendingPhotos.length}) <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--hc-ink-soft)' }}>optional</span>
              </label>
              <input id="cg-visit-photos" type="file" accept="image/*" capture="environment" multiple
                onChange={(e) => { Array.from(e.target.files || []).forEach((f) => handlePhotoFile(f, 'task')); e.target.value = '' }}
                style={{ display: 'block', marginBottom: 8 }} />
              {pendingPhotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, marginBottom: 6 }}>
                  {pendingPhotos.map((p, i) => (
                    <div key={i} style={{ position: 'relative', border: '1px solid var(--hc-line)', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                      <img src={p.dataUri} alt={p.caption || `Photo ${i + 1}`} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                      <button type="button" onClick={() => setPendingPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(185,28,28,0.95)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 14, lineHeight: '20px' }}
                        title="Remove" aria-label={`Remove photo ${i + 1}`}>×</button>
                      <input type="text" value={p.caption} aria-label={`Caption for photo ${i + 1}`}
                        onChange={(e) => setPendingPhotos((prev) => prev.map((x, idx) => idx === i ? { ...x, caption: e.target.value } : x))}
                        placeholder="Caption…"
                        style={{ width: '100%', border: 'none', borderTop: '1px solid var(--hc-line)', padding: '3px 5px', fontSize: '0.7rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' }} />
                    </div>
                  ))}
                </div>
              )}
              {photoUploading && <div style={{ fontSize: '0.8rem', color: 'var(--hc-info-ink)' }}>Uploading photos…</div>}
            </div>

            <div className="form-actions">
              <button className="hc-btn hc-btn-secondary" disabled={clockingOut} onClick={() => { setShowNoteModal(false); setNoteError('') }}>Cancel</button>
              <button className="hc-btn hc-btn-primary" disabled={clockingOut} onClick={completeClockOut}
                style={clockingOut ? { opacity: 0.7, cursor: 'wait' } : undefined}>
                {clockingOut ? '⏳ Clocking out…' : 'Clock Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      <CaregiverClientModal clientId={viewingClientId} isOpen={!!viewingClientId} onClose={() => setViewingClientId(null)} />

      <SignaturePad
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        documentName={signTarget?.name || signTarget?.fileName || undefined}
        onSign={submitDocSignature}
      />

      {swapModal && (
        <div className="modal active" onClick={() => setSwapModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🔄 Request Shift Swap</h2><button className="close-btn" aria-label="Close" onClick={() => setSwapModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(swapModal.clientId)} on {occurrenceOf(swapModal)} ({formatTime(swapModal.startTime)}–{formatTime(swapModal.endTime)})
            </p>
            <div className="form-group">
              <label htmlFor="cg-swap-target">Ask coworker</label>
              <select id="cg-swap-target" value={swapForm.targetCaregiverId} onChange={(e) => setSwapForm({ ...swapForm, targetCaregiverId: e.target.value })}>
                <option value="">Pick a coworker…</option>
                {otherCaregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="cg-swap-reason">Reason (optional, but helps)</label>
              <textarea id="cg-swap-reason" value={swapForm.reason} onChange={(e) => setSwapForm({ ...swapForm, reason: e.target.value })} placeholder="Doctor appointment, family emergency, etc." rows={3} />
            </div>
            <div className="form-actions">
              <button className="hc-btn hc-btn-secondary" onClick={() => setSwapModal(null)}>Cancel</button>
              <button className="hc-btn hc-btn-primary" onClick={submitSwapRequest} disabled={swapSending}>{swapSending ? 'Sending…' : 'Send Request'}</button>
            </div>
          </div>
        </div>
      )}

      {unavailModal && (
        <div className="modal active" onClick={() => !unavailSubmitting && setUnavailModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🚫 Client Not Available</h2><button className="close-btn" aria-label="Close" onClick={() => setUnavailModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(unavailModal.clientId)} on {occurrenceOf(unavailModal)} ({formatTime(unavailModal.startTime)}–{formatTime(unavailModal.endTime)})
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--hc-ink-soft)', margin: '0 0 0.75rem' }}>
              Use this when the <strong>client</strong> is the reason the visit didn't happen. The office is notified and the visit is not billed or paid.
              If <strong>you</strong> can't make a shift, use <em>Report Miss</em> instead so it can be covered.
            </p>
            <div className="form-group">
              <label htmlFor="cg-unavail-reason">What happened? *</label>
              <select id="cg-unavail-reason" value={unavailForm.reason} onChange={(e) => setUnavailForm({ ...unavailForm, reason: e.target.value })}>
                <option value="">Pick a reason…</option>
                {CLIENT_UNAVAILABLE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="cg-unavail-note">Note {unavailForm.reason === 'other' ? '*' : '(optional)'}</label>
              <textarea id="cg-unavail-note" value={unavailForm.note} onChange={(e) => setUnavailForm({ ...unavailForm, note: e.target.value })} placeholder="Who you spoke to, what they said, anything the office should know" rows={3} maxLength={500} />
            </div>
            <div className="form-actions">
              <button className="hc-btn hc-btn-secondary" onClick={() => setUnavailModal(null)} disabled={unavailSubmitting}>Cancel</button>
              <button className="hc-btn hc-btn-primary" onClick={submitClientUnavailable} disabled={unavailSubmitting || !unavailForm.reason}>{unavailSubmitting ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {moveModal && (
        <div className="modal active" onClick={() => setMoveModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🕐 Ask to Move This Shift</h2><button className="close-btn" aria-label="Close" onClick={() => setMoveModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(moveModal.clientId)} — currently {moveModal.occurrenceDate} ({formatTime(moveModal.startTime)}–{formatTime(moveModal.endTime)})
            </p>
            <div className="form-group">
              <label htmlFor="cg-move-date">New day</label>
              <input id="cg-move-date" type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="cg-move-start">Start</label>
                <input id="cg-move-start" type="time" value={moveForm.startTime} onChange={(e) => setMoveForm({ ...moveForm, startTime: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label htmlFor="cg-move-end">End</label>
                <input id="cg-move-end" type="time" value={moveForm.endTime} onChange={(e) => setMoveForm({ ...moveForm, endTime: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="cg-move-reason">Reason (helps the office decide)</label>
              <textarea id="cg-move-reason" value={moveForm.reason} onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })} placeholder="Client asked for a later start, appointment conflict, etc." rows={3} />
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--hc-warning-ink)', background: 'var(--hc-warning-bg)', border: '1px solid var(--hc-warning-line)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              Work the shift at its current time until the office approves the move. Your pay and the client's billing follow the schedule, not the request.
            </div>
            <div className="form-actions">
              <button className="hc-btn hc-btn-secondary" onClick={() => setMoveModal(null)}>Cancel</button>
              <button className="hc-btn hc-btn-primary" onClick={submitMoveRequest}>Send Request</button>
            </div>
          </div>
        </div>
      )}

      {showMessages && <CaregiverMessages onClose={() => { setShowMessages(false); setUnreadMessages(0) }} />}

      {/* Payday verification — can be put off, so it never blocks clocking in or out */}
      {pendingVerification && !showMessages && (
        <PaydayVerificationModal
          pending={pendingVerification}
          onResolved={() => setPendingVerification(null)}
          onLater={() => setPendingVerification(null)}
        />
      )}

      {showHelp && <CaregiverHelp onClose={() => setShowHelp(false)} />}

      {/* Shift Miss Report sheet */}
      {showMissReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <ShiftMissReport onClose={() => setShowMissReport(false)} />
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation ── */}
      {showMoreDrawer && <div className="mobile-more-drawer-overlay" onClick={() => setShowMoreDrawer(false)} />}

      <div className={`mobile-more-drawer ${showMoreDrawer ? 'open' : ''}`}>
        <div className="mobile-more-drawer-handle" />
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Self Service</div>
          {SELF_PAGES.map(({ page, icon, label }) => (
            <button key={page} className={`mobile-more-drawer-item ${currentPage === page ? 'active' : ''}`} onClick={() => goTo(page)}>
              <span className="mobile-more-drawer-item-icon">{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Account</div>
          <button className={`mobile-more-drawer-item ${currentPage === 'settings' ? 'active' : ''}`} onClick={() => goTo('settings')}>
            <span className="mobile-more-drawer-item-icon">⚙️</span>
            Settings
          </button>
          <button className="mobile-more-drawer-item" onClick={() => { logout() }} style={{ color: 'var(--hc-red-ink)' }}>
            <span className="mobile-more-drawer-item-icon" style={{ background: 'var(--hc-danger-bg)' }}>⏻</span>
            Log Out
          </button>
        </div>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Caregiver sections">
        {MAIN_PAGES.map(({ page, icon, label }) => (
          <button key={page} className={`mobile-bottom-nav-item ${currentPage === page ? 'active' : ''}`} onClick={() => goTo(page)}>
            <span className="mobile-bottom-nav-icon">{icon}</span>
            {label}
          </button>
        ))}
        <button className={`mobile-bottom-nav-item ${showMoreDrawer ? 'active' : ''}`} onClick={() => setShowMoreDrawer((v) => !v)}>
          <span className="mobile-bottom-nav-icon">⋯</span>
          More
        </button>
      </nav>
    </div>
  )
}

export default CaregiverDashboard
