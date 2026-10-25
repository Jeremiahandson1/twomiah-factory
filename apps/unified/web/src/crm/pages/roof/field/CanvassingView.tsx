// Moved from templates/crm-roof/frontend/src/pages/roofing/CanvassingView.tsx: the canvasser's full-screen field tool
// (no menu, no sidebar — the template's /canvass), at /api/canvassing (server/crm/roof/field/canvassing.ts, the
// canvassing_tool feature). A canvasser starts a session, logs each door, reads the shop's script, and ends the session.
//
// Changes from the template:
//   · /sessions, a session's /stops and /scripts are { data, pagination } — the template read bare arrays, so it never
//     found the active session;
//   · the default export holds the canvassing_tool gate itself (the template's /canvass had none: a shop without the
//     feature got the page and every call refused), waiting for the company before deciding;
//   · the Log Stop tab is offered only to a seat that may log a door (canvassing:create), as the map's button already was;
//   · a door that became a lead links to its job and its homeowner (/crm/jobs/:id, /crm/contacts/:id);
//   · the map is Leaflet imported by the app (./PinMap.tsx) — the template's read `window.L` from a CDN script — and it
//     is drawn again after the Script or Sessions tab (the template's stayed blank: its map was bound to the old box);
//   · the default session name is today's date (the shared formatDate() with no date is empty here);
//   · "View All Sessions" with no session running shows them all (it switched to a tab that screen does not have);
//   · a seventh photo is refused as the template meant to (its check read a stale count); a CSV cell's quotes are
//     doubled; every refusal shows the server's sentence.
// The appointment time is sent as the datetime-local box gives it: the server reads it on the company's clock.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Plus, DoorOpen, CloudLightning, X,
  ChevronLeft, ChevronRight, Camera, ArrowRight,
  BookOpen, List, Map as MapIcon, Download, Navigation,
} from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useAuth, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { listOf } from './http'
import PinMap, { coord, type Pin } from './PinMap'
import { PIN_COLORS, type CanvassScript, type CanvassSession, type CanvassStop } from './canvassing'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const OUTCOME_CONFIG: Record<string, { label: string; emoji: string; color: string; bgColor: string }> = {
  no_answer: { label: 'No Answer', emoji: '🚪', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300' },
  not_interested: { label: 'Not Interested', emoji: '👋', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-50 border-red-300' },
  interested: { label: 'Interested', emoji: '⭐', color: 'text-yellow-700 dark:text-yellow-300', bgColor: 'bg-yellow-50 border-yellow-300' },
  appointment_set: { label: 'Appointment Set', emoji: '📅', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-50 border-green-300' },
  already_has_contractor: { label: 'Has Contractor', emoji: '🔨', color: 'text-amber-800 dark:text-amber-300', bgColor: 'bg-amber-50 border-amber-300' },
  vacant: { label: 'Vacant', emoji: '🏚️', color: 'text-gray-500', bgColor: 'bg-gray-50 border-gray-300' },
}

const DAMAGE_TAGS = ['Hail Damage', 'Wind Damage', 'Missing Shingles', 'Granule Loss', 'Dented Gutters', 'Skylight Damage']

type Session = CanvassSession
type Stop = CanvassStop
type Script = CanvassScript

function CanvassingView() {
  // canvassing:create, not marketing — the field rung HOLDS it, because door-knocking is that
  // rung's job (T41: "a canvasser cannot log a door knock, and that is the bug"). Gating these
  // on anything higher would take the screen back off the only people who use it. What it does
  // remove is the viewer's ability to start a session it is not walking. (T42)
  const mayCanvass = useMayWrite('canvassing:create');
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const navigate = useNavigate()

  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [tab, setTab] = useState<'map' | 'log' | 'script' | 'sessions'>('map')
  const [showStartModal, setShowStartModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [showSummary, setShowSummary] = useState<Session | null>(null)
  const [showAllSessions, setShowAllSessions] = useState(false)
  // A dialog over the map: the legend and the log button (z-[1000], over Leaflet) step aside for it.
  const overlayOpen = showLogModal || showStartModal || showEndConfirm || !!showSummary

  // Start session form
  const [newName, setNewName] = useState('')
  const [newWeather, setNewWeather] = useState('')
  const [newRadius, setNewRadius] = useState('')

  // Log door knock form
  const [logStep, setLogStep] = useState(0)
  const [logAddress, setLogAddress] = useState('')
  const [logCity, setLogCity] = useState('')
  const [logState, setLogState] = useState('')
  const [logZip, setLogZip] = useState('')
  const [logLat, setLogLat] = useState<number | null>(null)
  const [logLng, setLogLng] = useState<number | null>(null)
  const [logGpsStatus, setLogGpsStatus] = useState<'loading' | 'success' | 'denied' | 'idle'>('idle')
  const [logPhotos, setLogPhotos] = useState<string[]>([])
  const [logDamageNotes, setLogDamageNotes] = useState('')
  const [logDamageTags, setLogDamageTags] = useState<string[]>([])
  const [logOutcome, setLogOutcome] = useState('')
  const [logName, setLogName] = useState('')
  const [logPhone, setLogPhone] = useState('')
  const [logEmail, setLogEmail] = useState('')
  const [logAppointmentDate, setLogAppointmentDate] = useState('')
  const [logDoorHanger, setLogDoorHanger] = useState(false)
  const [logFollowUp, setLogFollowUp] = useState('')
  const [logNotes, setLogNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Script viewer
  const [scriptStep, setScriptStep] = useState(0)

  const load = useCallback(async () => {
    try {
      const [sessReply, scriptReply] = await Promise.all([
        // YOUR sessions — the first active one in the company was the owner's, and this app opened it. (T62)
        api.get('/api/canvassing/sessions', { mine: 1 }),
        api.get('/api/canvassing/scripts'),
      ])
      const allSessions = listOf<Session>(sessReply)
      setSessions(allSessions)
      setScripts(listOf<Script>(scriptReply))

      const active = allSessions.find((s: Session) => s.status === 'active')
      if (active) {
        setActiveSession(active)
        setStops(listOf<Stop>(await api.get(`/api/canvassing/sessions/${encodeURIComponent(active.id)}/stops`)))
      }
    } catch (e) {
      toastRef.current.error(errorText(e, 'Failed to load canvassing data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The doors on the map, each coloured by how it went.
  const pins = useMemo<Pin[]>(() => stops.flatMap((stop: Stop) => {
    const lat = coord(stop.lat)
    const lng = coord(stop.lng)
    if (lat === null || lng === null) return []
    return [{
      id: stop.id, lat, lng, color: PIN_COLORS[stop.outcome] || '#9CA3AF', title: stop.address || 'Unknown',
      lines: [OUTCOME_CONFIG[stop.outcome]?.label || stop.outcome, ...(stop.doorHangerLeft ? ['Door hanger left'] : [])],
    }]
  }), [stops])

  // GPS auto-fill
  const requestGps = () => {
    if (!navigator.geolocation) {
      setLogGpsStatus('denied')
      return
    }
    setLogGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLogLat(pos.coords.latitude)
        setLogLng(pos.coords.longitude)
        setLogGpsStatus('success')
        // The street address at this spot, from our server (GET /api/canvassing/reverse-geocode — Google, the server's
        // key); never a public geocoder from the browser. Nothing found: the canvasser types it.
        try {
          const a = await api.get('/api/canvassing/reverse-geocode', { lat: pos.coords.latitude, lng: pos.coords.longitude }) as { found?: boolean; address?: string; city?: string; state?: string; zip?: string }
          if (a?.found) {
            setLogAddress(a.address || '')
            setLogCity(a.city || '')
            setLogState(a.state || '')
            setLogZip(a.zip || '')
          }
        } catch { /* fallback to manual */ }
      },
      () => setLogGpsStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleStartSession = async () => {
    try {
      let centerLat: number | null = null, centerLng: number | null = null
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => { centerLat = pos.coords.latitude; centerLng = pos.coords.longitude; resolve() },
            () => resolve(),
            { timeout: 5000 },
          )
        })
      }
      const session = (await api.post('/api/canvassing/sessions', {
        name: newName || `Canvassing — ${formatDate(new Date())}`,
        weatherEvent: newWeather || null,
        radiusMiles: newRadius ? Number(newRadius) : null,
        centerLat,
        centerLng,
      })) as Session
      setActiveSession(session)
      setStops([])
      setShowStartModal(false)
      setNewName('')
      setNewWeather('')
      setNewRadius('')
      toast.success('Session started!')
    } catch (e) {
      toast.error(errorText(e, 'Failed to start session'))
    }
  }

  const handleEndSession = async () => {
    if (!activeSession) return
    try {
      const ended = (await api.post(`/api/canvassing/sessions/${encodeURIComponent(activeSession.id)}/end`, {})) as Session
      setShowEndConfirm(false)
      setShowSummary(ended)
      setActiveSession(null)
      toast.success('Session completed!')
    } catch (e) {
      toast.error(errorText(e, 'Failed to end session'))
    }
  }

  const openLogModal = () => {
    setLogStep(0)
    setLogAddress('')
    setLogCity('')
    setLogState('')
    setLogZip('')
    setLogLat(null)
    setLogLng(null)
    setLogGpsStatus('idle')
    setLogPhotos([])
    setLogDamageNotes('')
    setLogDamageTags([])
    setLogOutcome('')
    setLogName('')
    setLogPhone('')
    setLogEmail('')
    setLogAppointmentDate('')
    setLogDoorHanger(false)
    setLogFollowUp('')
    setLogNotes('')
    setShowLogModal(true)
    requestGps()
  }

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    // For now, just store as data URLs — in production these upload to R2
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const photo = reader.result
        // Six at most, counted at the moment each one lands (the template read the count from before the pick).
        if (typeof photo === 'string') setLogPhotos((prev) => (prev.length < 6 ? [...prev, photo] : prev))
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmitStop = async (andDone: boolean) => {
    if (!activeSession) return
    setSubmitting(true)
    try {
      const notes = [logDamageNotes, ...logDamageTags.map(t => `[${t}]`), logNotes].filter(Boolean).join('\n')
      // lat / lng are left out when GPS gave none: the server takes a number or nothing.
      const stop = (await api.post(`/api/canvassing/sessions/${encodeURIComponent(activeSession.id)}/stops`, {
        address: logAddress,
        city: logCity,
        state: logState,
        zip: logZip,
        ...(logLat !== null && logLng !== null ? { lat: logLat, lng: logLng } : {}),
        outcome: logOutcome || 'no_answer',
        notes: notes || null,
        homeownerName: logName || null,
        phone: logPhone || null,
        email: logEmail || null,
        // As the datetime-local box gives it, no zone: the server reads it on the company's clock.
        appointmentDate: logAppointmentDate || null,
        doorHangerLeft: logDoorHanger,
        followUpDate: logFollowUp || null,
        photos: logPhotos.length > 0 ? logPhotos : [],
      })) as Stop

      // Optimistic update
      setStops((prev) => [stop, ...prev])
      setActiveSession((prev: Session | null) => prev ? {
        ...prev,
        totalDoors: (prev.totalDoors || 0) + 1,
        answeredDoors: logOutcome !== 'no_answer' ? (prev.answeredDoors || 0) + 1 : prev.answeredDoors || 0,
        leadsCreated: stop.jobId ? (prev.leadsCreated || 0) + 1 : prev.leadsCreated || 0,
      } : prev)

      setShowLogModal(false)
      toast.success(stop.jobId ? 'Lead created!' : 'Stop logged!')

      if (andDone) {
        handleEndSession()
      }
    } catch (e) {
      toast.error(errorText(e, 'Failed to log stop'))
    } finally {
      setSubmitting(false)
    }
  }

  const exportSessionCsv = (session: Session, sessionStops: Stop[]) => {
    const rows = [['Address', 'City', 'State', 'Zip', 'Outcome', 'Notes', 'Door Hanger', 'Follow Up', 'Visited At']]
    sessionStops.forEach((s: Stop) => {
      rows.push([
        s.address || '', s.city || '', s.state || '', s.zip || '',
        OUTCOME_CONFIG[s.outcome]?.label || s.outcome,
        (s.notes || '').replace(/\n/g, ' '),
        s.doorHangerLeft ? 'Yes' : 'No',
        s.followUpDate || '',
        s.visitedAt || '',
      ])
    })
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.name || 'session'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loadSessionSummary = async (session: Session) => {
    try {
      setShowSummary((await api.get(`/api/canvassing/sessions/${encodeURIComponent(session.id)}`)) as Session)
    } catch (e) {
      toast.error(errorText(e, 'Failed to load session'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-slate-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  // ── SESSION SUMMARY VIEW ──
  if (showSummary) {
    const s = showSummary
    const summaryStops: Stop[] = s.stops || stops
    const appointments = summaryStops.filter((st: Stop) => st.outcome === 'appointment_set')
    const interested = summaryStops.filter((st: Stop) => st.outcome === 'interested')
    const followUps = summaryStops.filter((st: Stop) => st.followUpDate)
    const duration = s.startedAt && s.endedAt
      ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)
      : null
    const conversionRate = (s.totalDoors || 0) > 0 ? ((s.leadsCreated || 0) / (s.totalDoors || 1) * 100).toFixed(1) : '0'

    return (
      <div className="min-h-screen bg-gray-50 pb-20 dark:bg-slate-900">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 dark:bg-slate-900">
          <button aria-label="Back" onClick={() => setShowSummary(null)} className="text-gray-500 dark:text-slate-400"><ChevronLeft size={20} /></button>
          <h1 className="text-lg font-bold truncate">{s.name}</h1>
        </div>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
              <p className="text-2xl font-bold">{s.totalDoors || 0}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Total Doors</p>
            </div>
            <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
              <p className="text-2xl font-bold">{s.answeredDoors || 0}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Answered</p>
            </div>
            <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{s.leadsCreated || 0}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Leads Created</p>
            </div>
            <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
              <p className="text-2xl font-bold">{conversionRate}%</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">Conversion</p>
            </div>
          </div>

          {duration !== null && (
            <p className="text-sm text-gray-500 text-center dark:text-slate-400">Duration: {Math.floor(duration / 60)}h {duration % 60}m</p>
          )}

          {/* Grouped stops */}
          {appointments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-700 mb-2 dark:text-green-300">Appointments ({appointments.length})</h3>
              {appointments.map((st: Stop) => (
                <div key={st.id} className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2 text-gray-900 dark:text-slate-100 dark:bg-green-950/40">
                  <p className="text-sm font-medium">{st.address}</p>
                  {st.notes && <p className="text-xs text-gray-600 mt-1 dark:text-slate-400">{st.notes}</p>}
                  <LeadLinks stop={st} label="View job" navigate={navigate} />
                </div>
              ))}
            </div>
          )}

          {interested.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-yellow-700 mb-2 dark:text-yellow-300">Interested ({interested.length})</h3>
              {interested.map((st: Stop) => (
                <div key={st.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-2 text-gray-900 dark:text-slate-100 dark:bg-yellow-950/40">
                  <p className="text-sm font-medium">{st.address}</p>
                  <LeadLinks stop={st} label="View lead" navigate={navigate} />
                </div>
              ))}
            </div>
          )}

          {followUps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-blue-700 mb-2 dark:text-blue-300">Follow-Ups ({followUps.length})</h3>
              {followUps.map((st: Stop) => (
                <div key={st.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2 text-gray-900 dark:text-slate-100 dark:bg-blue-950/40">
                  <p className="text-sm font-medium">{st.address}</p>
                  <p className="text-xs text-gray-600 dark:text-slate-400">Follow up: {formatDate(st.followUpDate)}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => exportSessionCsv(s, summaryStops)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gray-100 rounded-xl text-sm font-medium text-gray-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Download size={16} /> Export Session CSV
          </button>
        </div>
      </div>
    )
  }

  // ── NO ACTIVE SESSION ──
  if (!activeSession) {
    return (
      <div className="min-h-screen bg-gray-50 pb-20 dark:bg-slate-900">
        <div className="bg-white border-b px-4 py-4 dark:bg-slate-900">
          <h1 className="text-xl font-bold">Canvassing</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Mobile field tool for door-to-door sales</p>
        </div>

        <div className="p-4 space-y-4">
          {/* POST /sessions asks canvassing:create — the read-only seat was offered it. (T43 viewer round, T68) */}
          {mayCanvass && <button
            onClick={() => {
              setNewName(`Canvassing — ${formatDate(new Date())}`)
              setShowStartModal(true)
            }}
            className="w-full py-4 bg-orange-600 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-2 active:bg-orange-700"
          >
            <Plus size={24} /> Start New Session
          </button>}

          {sessions.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-600 mb-2 dark:text-slate-400">Recent Sessions</h2>
              {(showAllSessions ? sessions : sessions.slice(0, 5)).map((s: Session) => (
                <button
                  key={s.id}
                  onClick={() => loadSessionSummary(s)}
                  className="w-full text-left bg-white rounded-xl p-4 border mb-2 active:bg-gray-50 dark:bg-slate-900"
                >
                  <p className="font-medium text-sm">{s.name}</p>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 dark:text-slate-400">
                    <span>{formatDate(s.startedAt || s.createdAt)}</span>
                    <span>{s.totalDoors || 0} doors</span>
                    <span className="text-green-700 font-medium dark:text-green-300">{s.leadsCreated || 0} leads</span>
                  </div>
                  {s.weatherEvent && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                      <CloudLightning size={12} /> {s.weatherEvent}
                    </p>
                  )}
                </button>
              ))}
              {/* The Sessions tab lives on the active session's screen, so the template's setTab('sessions') here showed
                  nothing; the list opens in place. */}
              {sessions.length > 5 && !showAllSessions && (
                <button onClick={() => setShowAllSessions(true)} className="text-sm text-orange-600 dark:text-orange-200 font-medium">
                  View All Sessions
                </button>
              )}
            </div>
          )}
        </div>

        {/* Start Session Modal */}
        {showStartModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
            <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">New Canvassing Session</h2>
                <button aria-label="Close" onClick={() => setShowStartModal(false)}><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Session Name</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Oak Park — March 12" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Weather Event</label>
                  <input value={newWeather} onChange={(e) => setNewWeather(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Hail storm March 10" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Target Radius (miles, optional)</label>
                  <input type="number" value={newRadius} onChange={(e) => setNewRadius(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. 0.5" />
                </div>
                {mayCanvass && (<button onClick={handleStartSession}
                  className="w-full py-3 bg-orange-600 text-white rounded-xl font-semibold active:bg-orange-700">
                  Start Canvassing
                </button>)}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── ACTIVE SESSION ──
  const defaultScript = scripts.find((s: Script) => s.isDefault) || scripts[0]

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0 dark:bg-slate-900">
        <div className="min-w-0">
          <h1 className="text-sm font-bold truncate">{activeSession.name}</h1>
          {activeSession.weatherEvent && (
            <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <CloudLightning size={10} /> {activeSession.weatherEvent}
            </p>
          )}
        </div>
        {mayCanvass && (<button onClick={() => setShowEndConfirm(true)}
          className="text-xs font-semibold text-red-700 bg-red-50 px-3 py-1.5 rounded-lg active:bg-red-100 dark:text-red-400 dark:bg-red-950/40">
          End Session
        </button>)}
      </div>

      {/* Live Stats */}
      <div className="flex gap-1 px-4 py-2 bg-gray-100 flex-shrink-0 dark:bg-slate-800">
        <div className="flex-1 text-center">
          <p className="text-lg font-bold">{activeSession.totalDoors || 0}</p>
          <p className="text-[10px] text-gray-500 dark:text-slate-400">Doors</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-lg font-bold">{activeSession.answeredDoors || 0}</p>
          <p className="text-[10px] text-gray-500 dark:text-slate-400">Answered</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-lg font-bold text-green-700 dark:text-green-300">{activeSession.leadsCreated || 0}</p>
          <p className="text-[10px] text-gray-500 dark:text-slate-400">Leads</p>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden relative">
        {/* MAP TAB */}
        {tab === 'map' && (
          <div className="h-full relative">
            <PinMap
              pins={pins}
              center={coord(activeSession.centerLat) !== null && coord(activeSession.centerLng) !== null ? [coord(activeSession.centerLat)!, coord(activeSession.centerLng)!] : null}
              circleMiles={coord(activeSession.radiusMiles)}
              fit={false}
              className="h-full w-full"
            />

            {/* Legend — z-[1000] to sit over Leaflet's panes, so it is not drawn while the log flow or another dialog (z-50) is open: it
                floated over the Log Door Knock screens (roofing retest). */}
            {!overlayOpen && <div data-testid="canvass-legend" className="absolute top-3 right-3 bg-white/95 rounded-lg shadow-lg p-2 text-[10px] space-y-1 z-[1000] text-gray-900 dark:text-slate-100 dark:bg-slate-900">
              {Object.entries(PIN_COLORS).map(([k, c]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                  <span>{OUTCOME_CONFIG[k]?.label}</span>
                </div>
              ))}
            </div>}

            {/* FAB */}
            {mayCanvass && !overlayOpen && (<button aria-label="Log a door" onClick={openLogModal}
              className="absolute bottom-6 right-6 w-16 h-16 bg-orange-600 text-white rounded-full shadow-xl flex items-center justify-center active:bg-orange-700 z-[1000]">
              <DoorOpen size={28} />
            </button>)}
          </div>
        )}

        {/* SCRIPT TAB */}
        {tab === 'script' && defaultScript && (
          <div className="h-full flex flex-col p-4">
            <h2 className="text-sm font-bold mb-3">{defaultScript.name}</h2>
            {(() => {
              const steps = Array.isArray(defaultScript.steps) ? defaultScript.steps : []
              if (steps.length === 0) return <p className="text-sm text-gray-500 dark:text-slate-400">No script steps configured.</p>
              const step = steps[scriptStep] || steps[0]
              return (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 bg-white rounded-xl p-5 border dark:bg-slate-900">
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold mb-1">Step {scriptStep + 1} of {steps.length}</p>
                    <h3 className="text-lg font-bold mb-3">{step.title}</h3>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap dark:text-slate-200">{step.body}</p>
                    {step.tips && (
                      <div className="mt-4 bg-yellow-50 rounded-lg p-3 dark:bg-yellow-950/40">
                        <p className="text-xs font-semibold text-yellow-800 mb-1 dark:text-yellow-300">Tips</p>
                        <p className="text-xs text-yellow-700 dark:text-yellow-300">{step.tips}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => setScriptStep(Math.max(0, scriptStep - 1))}
                      disabled={scriptStep === 0}
                      className="flex-1 py-3 border rounded-xl text-sm font-medium disabled:opacity-30">
                      <ChevronLeft size={16} className="inline" /> Previous
                    </button>
                    <button onClick={() => setScriptStep(Math.min(steps.length - 1, scriptStep + 1))}
                      disabled={scriptStep >= steps.length - 1}
                      className="flex-1 py-3 bg-orange-600 text-white rounded-xl text-sm font-medium disabled:opacity-30">
                      Next <ChevronRight size={16} className="inline" />
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
        {tab === 'script' && !defaultScript && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm dark:text-slate-400">No scripts configured</div>
        )}

        {/* SESSIONS TAB */}
        {tab === 'sessions' && (
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {sessions.map((s: Session) => (
              <button key={s.id} onClick={() => loadSessionSummary(s)}
                className="w-full text-left bg-white rounded-xl p-4 border active:bg-gray-50 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    s.status === 'active' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                    s.status === 'paused' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
                    'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                  }`}>{codeLabel(s.status)}</span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-500 dark:text-slate-400">
                  <span>{formatDate(s.startedAt || s.createdAt)}</span>
                  <span>{s.totalDoors || 0} doors</span>
                  <span>{s.leadsCreated || 0} leads</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="flex border-t bg-white flex-shrink-0 safe-area-bottom dark:bg-slate-900">
        {([
          { key: 'map' as const, icon: MapIcon, label: 'Map' },
          // Logging a door is canvassing:create, as the map's button is. (T42)
          ...(mayCanvass ? [{ key: 'log' as const, icon: DoorOpen, label: 'Log Stop', action: openLogModal }] : []),
          { key: 'script' as const, icon: BookOpen, label: 'Script' },
          { key: 'sessions' as const, icon: List, label: 'Sessions' },
        ] as { key: 'map' | 'log' | 'script' | 'sessions'; icon: typeof MapIcon; label: string; action?: () => void }[]).map((item) => (
          <button key={item.key}
            onClick={item.action || (() => setTab(item.key))}
            className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-medium ${
              tab === item.key ? 'text-orange-600 dark:text-orange-200' : 'text-gray-500 dark:text-slate-400'
            }`}>
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </div>

      {/* LOG DOOR KNOCK MODAL */}
      {showLogModal && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col dark:bg-slate-900">
          {/* Modal Header */}
          <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0 dark:bg-slate-900">
            <button aria-label="Close" onClick={() => setShowLogModal(false)} className="text-gray-500 dark:text-slate-400"><X size={20} /></button>
            <h2 className="font-bold">Log Door Knock</h2>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`w-2 h-2 rounded-full ${i <= logStep ? 'bg-orange-600' : 'bg-gray-300 dark:bg-slate-700 dark:text-slate-100'}`} />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* Step 0: Address */}
            {logStep === 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Where are you?</h3>

                {logGpsStatus === 'loading' && (
                  <div className="bg-blue-50 rounded-xl p-4 flex items-center gap-3 dark:bg-blue-950/40">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-600" />
                    <p className="text-sm text-blue-700 dark:text-blue-300">Getting your location...</p>
                  </div>
                )}

                {logGpsStatus === 'success' && logAddress && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 dark:bg-green-950/40">
                    <div className="flex items-center gap-2 mb-1">
                      <Navigation size={16} className="text-green-700 dark:text-green-300" />
                      <p className="text-sm font-medium text-green-800 dark:text-green-300">GPS Location Found</p>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-slate-200">{logAddress}{logCity ? `, ${logCity}` : ''}{logState ? `, ${logState}` : ''} {logZip}</p>
                  </div>
                )}

                {logGpsStatus === 'denied' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 dark:bg-yellow-950/40">
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">GPS unavailable — enter address manually</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Street Address</label>
                  <input value={logAddress} onChange={(e) => setLogAddress(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="1234 Oak St" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 dark:text-slate-400">City</label>
                    <input value={logCity} onChange={(e) => setLogCity(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 dark:text-slate-400">State</label>
                    <input value={logState} onChange={(e) => setLogState(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 dark:text-slate-400">Zip</label>
                    <input value={logZip} onChange={(e) => setLogZip(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                </div>

                {logGpsStatus !== 'success' && (
                  <button onClick={requestGps}
                    className="w-full py-2.5 border border-orange-200 rounded-lg text-sm text-orange-600 font-medium flex items-center justify-center gap-2 dark:text-orange-200">
                    <Navigation size={16} /> Use GPS Location
                  </button>
                )}
              </div>
            )}

            {/* Step 1: Damage Assessment */}
            {logStep === 1 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Damage Assessment</h3>

                <div>
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2 dark:text-slate-200">
                    <Camera size={16} /> Take Damage Photos
                  </label>
                  <input type="file" accept="image/*" capture="environment" multiple
                    onChange={handlePhotoCapture}
                    className="mt-2 w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-orange-50 file:text-orange-700 file:font-medium" />
                </div>

                {logPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {logPhotos.map((photo, i) => (
                      <div key={i} className="relative">
                        <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-20 object-cover rounded-lg" />
                        <button aria-label="Remove photo" onClick={() => setLogPhotos((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-xs">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Quick Tags</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {DAMAGE_TAGS.map((tag) => (
                      <button key={tag}
                        onClick={() => setLogDamageTags((prev) =>
                          prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                        )}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                          logDamageTags.includes(tag) ? 'bg-orange-100 border-orange-300 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40' : 'bg-white dark:bg-slate-900 border-gray-300 text-gray-600 dark:text-slate-300'
                        }`}>
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Damage Notes</label>
                  <textarea value={logDamageNotes} onChange={(e) => setLogDamageNotes(e.target.value)}
                    rows={3} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                    placeholder="What damage did you observe?" />
                </div>
              </div>
            )}

            {/* Step 2: Outcome */}
            {logStep === 2 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">What happened?</h3>

                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(OUTCOME_CONFIG).map(([key, cfg]) => (
                    <button key={key}
                      onClick={() => setLogOutcome(key)}
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        logOutcome === key ? cfg.bgColor + ' border-2' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700'
                      } dark:bg-slate-900`}>
                      <span className="text-2xl">{cfg.emoji}</span>
                      <p className={`text-sm font-semibold mt-1 ${logOutcome === key ? cfg.color : 'text-gray-700 dark:text-slate-200'} dark:text-slate-200`}>
                        {cfg.label}
                      </p>
                    </button>
                  ))}
                </div>

                {/* Expanded fields for interested / appointment_set */}
                {(logOutcome === 'interested' || logOutcome === 'appointment_set') && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3 border dark:bg-slate-900">
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Homeowner Name (optional)</label>
                      <input value={logName} onChange={(e) => setLogName(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="Full name" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Phone *</label>
                      <input type="tel" value={logPhone} onChange={(e) => setLogPhone(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="(555) 123-4567" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Email (optional)</label>
                      <input type="email" value={logEmail} onChange={(e) => setLogEmail(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="email@example.com" />
                    </div>
                    {logOutcome === 'appointment_set' && (
                      <div>
                        <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Appointment Date & Time</label>
                        <input type="datetime-local" value={logAppointmentDate}
                          onChange={(e) => setLogAppointmentDate(e.target.value)}
                          className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between bg-white border rounded-xl p-4 dark:bg-slate-900">
                  <span className="text-sm font-medium">Left door hanger</span>
                  <button onClick={() => setLogDoorHanger(!logDoorHanger)}
                    className={`w-12 h-6 rounded-full transition ${logDoorHanger ? 'bg-orange-600' : 'bg-gray-300 dark:bg-slate-700 dark:text-slate-100'}`}>
                    {/* The knob STAYS white in both themes — it is white to read against its own
                      coloured track, so `dark:bg-white` is the deliberate answer rather than an
                      omission. A dark surface here would hide the knob inside the track. (T41) */}
                  <div className={`w-5 h-5 bg-white dark:bg-white rounded-full shadow transition-transform ${logDoorHanger ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Follow-up Date (optional)</label>
                  <input type="date" value={logFollowUp} onChange={(e) => setLogFollowUp(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Additional Notes</label>
                  <textarea value={logNotes} onChange={(e) => setLogNotes(e.target.value)}
                    rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {logStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Confirm</h3>

                <div className="bg-white border rounded-xl p-4 space-y-2 dark:bg-slate-900">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-slate-400">Address</span>
                    <span className="font-medium">{logAddress || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500 dark:text-slate-400">Outcome</span>
                    <span className="font-medium">{OUTCOME_CONFIG[logOutcome]?.label || 'Not set'}</span>
                  </div>
                  {logPhotos.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-slate-400">Photos</span>
                      <span className="font-medium">{logPhotos.length} photo{logPhotos.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {logDamageTags.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-slate-400">Damage</span>
                      <span className="font-medium">{logDamageTags.join(', ')}</span>
                    </div>
                  )}
                  {logDoorHanger && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-slate-400">Door Hanger</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">Yes</span>
                    </div>
                  )}
                  {logName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-slate-400">Homeowner</span>
                      <span className="font-medium">{logName}</span>
                    </div>
                  )}
                </div>

                {(logOutcome === 'interested' || logOutcome === 'appointment_set') && logPhone && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 dark:bg-green-950/40">
                    <p className="text-sm text-green-800 font-medium dark:text-green-300">This will create a new lead in your CRM</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => handleSubmitStop(false)} disabled={submitting}
                    className="flex-1 py-3 bg-orange-600 text-white rounded-xl font-semibold disabled:opacity-50 active:bg-orange-700">
                    {submitting ? 'Saving...' : 'Log & Continue'}
                  </button>
                  <button onClick={() => handleSubmitStop(true)} disabled={submitting}
                    className="flex-1 py-3 border-2 border-orange-600 text-orange-600 rounded-xl font-semibold disabled:opacity-50 dark:text-orange-200">
                    Log & Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step Navigation */}
          {logStep < 3 && (
            <div className="p-4 border-t bg-white flex-shrink-0 dark:bg-slate-900">
              <div className="flex gap-3">
                {logStep > 0 && (
                  <button onClick={() => setLogStep(logStep - 1)}
                    className="flex-1 py-3 border rounded-xl text-sm font-medium">
                    Back
                  </button>
                )}
                <button onClick={() => setLogStep(logStep + 1)}
                  disabled={logStep === 0 && !logAddress}
                  className="flex-1 py-3 bg-orange-600 text-white rounded-xl text-sm font-semibold disabled:opacity-30 active:bg-orange-700">
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* End Session Confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full dark:bg-slate-900">
            <h3 className="text-lg font-bold mb-2">End Session?</h3>
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
              This will finalize your canvassing session with {activeSession.totalDoors || 0} doors knocked and {activeSession.leadsCreated || 0} leads created.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-2.5 border rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={handleEndSession}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold">End Session</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A door that became a lead: its roofing job and its homeowner (the contact the server made). */
function LeadLinks({ stop, label, navigate }: { stop: Stop; label: string; navigate: (to: string) => void }) {
  if (!stop.jobId && !stop.contactId) return null
  return (
    <div className="flex items-center gap-3 mt-1">
      {stop.jobId && (
        <button onClick={() => navigate(`/crm/jobs/${stop.jobId}`)} className="text-xs text-orange-600 flex items-center gap-1 dark:text-orange-200">
          {label} <ArrowRight size={12} />
        </button>
      )}
      {stop.contactId && (
        <button onClick={() => navigate(`/crm/contacts/${stop.contactId}`)} className="text-xs text-orange-600 flex items-center gap-1 dark:text-orange-200">
          View homeowner <ArrowRight size={12} />
        </button>
      )}
    </div>
  )
}

/**
 * The page as mounted: behind the canvassing_tool feature, as the menu's Canvassing item and /api/canvassing are. It
 * renders outside the app shell, so the shell's route gate does not cover it. Nothing is decided until the company has
 * arrived (until then hasFeature answers no for everything — roof M7).
 */
export default function CanvassingViewPage() {
  const { company, hasFeature } = useAuth()
  if (!company) return null
  if (!hasFeature('canvassing_tool')) return <Navigate to="/crm" replace />
  return <CanvassingView />
}
