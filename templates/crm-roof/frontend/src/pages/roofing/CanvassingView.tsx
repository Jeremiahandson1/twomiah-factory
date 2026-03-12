import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, DoorOpen, CloudLightning, X,
  ChevronLeft, ChevronRight, Camera, ArrowRight,
  BookOpen, List, Map as MapIcon, Download, Navigation,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

const OUTCOME_CONFIG: Record<string, { label: string; emoji: string; color: string; bgColor: string }> = {
  no_answer: { label: 'No Answer', emoji: '🚪', color: 'text-gray-600', bgColor: 'bg-gray-100 border-gray-300' },
  not_interested: { label: 'Not Interested', emoji: '👋', color: 'text-red-600', bgColor: 'bg-red-50 border-red-300' },
  interested: { label: 'Interested', emoji: '⭐', color: 'text-yellow-600', bgColor: 'bg-yellow-50 border-yellow-300' },
  appointment_set: { label: 'Appointment Set', emoji: '📅', color: 'text-green-600', bgColor: 'bg-green-50 border-green-300' },
  already_has_contractor: { label: 'Has Contractor', emoji: '🔨', color: 'text-orange-600', bgColor: 'bg-orange-50 border-orange-300' },
  vacant: { label: 'Vacant', emoji: '🏚️', color: 'text-gray-500', bgColor: 'bg-gray-50 border-gray-300' },
}

const PIN_COLORS: Record<string, string> = {
  no_answer: '#9CA3AF',
  not_interested: '#EF4444',
  interested: '#EAB308',
  appointment_set: '#22C55E',
  already_has_contractor: '#F97316',
  vacant: '#9CA3AF',
}

const DAMAGE_TAGS = ['Hail Damage', 'Wind Damage', 'Missing Shingles', 'Granule Loss', 'Dented Gutters', 'Skylight Damage']

type Session = any
type Stop = any
type Script = any

export default function CanvassingView() {
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)

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

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    try {
      const [sessRes, scriptRes] = await Promise.all([
        fetch('/api/canvassing/sessions', { headers }),
        fetch('/api/canvassing/scripts', { headers }),
      ])
      const sessData = await sessRes.json()
      const scriptData = await scriptRes.json()
      const allSessions = Array.isArray(sessData) ? sessData : []
      setSessions(allSessions)
      setScripts(Array.isArray(scriptData) ? scriptData : [])

      const active = allSessions.find((s: Session) => s.status === 'active')
      if (active) {
        setActiveSession(active)
        const stopsRes = await fetch(`/api/canvassing/sessions/${active.id}/stops`, { headers })
        const stopsData = await stopsRes.json()
        setStops(Array.isArray(stopsData) ? stopsData : [])
      }
    } catch {
      toast.error('Failed to load canvassing data')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // Initialize Leaflet map when we have an active session
  useEffect(() => {
    if (!mapRef.current || !activeSession) return
    if (leafletMapRef.current) return // already initialized

    const L = (window as any).L
    if (!L) return

    const lat = activeSession.centerLat || 32.78
    const lng = activeSession.centerLng || -96.8
    const map = L.map(mapRef.current).setView([lat, lng], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    if (activeSession.radiusMiles) {
      L.circle([lat, lng], { radius: activeSession.radiusMiles * 1609.34, color: '#3B82F6', fillOpacity: 0.05, weight: 1 }).addTo(map)
    }

    leafletMapRef.current = map
    return () => { map.remove(); leafletMapRef.current = null }
  }, [activeSession])

  // Update map markers when stops change
  useEffect(() => {
    if (!leafletMapRef.current) return
    const L = (window as any).L
    if (!L) return

    const map = leafletMapRef.current
    // Remove existing markers
    map.eachLayer((layer: any) => {
      if (layer instanceof L.CircleMarker) map.removeLayer(layer)
    })

    stops.forEach((stop: Stop) => {
      if (!stop.lat || !stop.lng) return
      const color = PIN_COLORS[stop.outcome] || '#9CA3AF'
      L.circleMarker([Number(stop.lat), Number(stop.lng)], {
        radius: 8,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9,
      }).addTo(map).bindPopup(`
        <strong>${stop.address || 'Unknown'}</strong><br/>
        ${OUTCOME_CONFIG[stop.outcome]?.label || stop.outcome}
        ${stop.doorHangerLeft ? '<br/><em>Door hanger left</em>' : ''}
      `)
    })
  }, [stops])

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
        // Reverse geocode
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&addressdetails=1`,
          )
          const data = await res.json()
          if (data.address) {
            const a = data.address
            setLogAddress(`${a.house_number || ''} ${a.road || ''}`.trim())
            setLogCity(a.city || a.town || a.village || '')
            setLogState(a.state || '')
            setLogZip(a.postcode || '')
          }
        } catch { /* fallback to manual */ }
      },
      () => setLogGpsStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleStartSession = async () => {
    try {
      let centerLat = null, centerLng = null
      if (navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => { centerLat = pos.coords.latitude; centerLng = pos.coords.longitude; resolve() },
            () => resolve(),
            { timeout: 5000 },
          )
        })
      }
      const res = await fetch('/api/canvassing/sessions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newName || `Canvassing — ${new Date().toLocaleDateString()}`,
          weatherEvent: newWeather || null,
          radiusMiles: newRadius ? Number(newRadius) : null,
          centerLat,
          centerLng,
        }),
      })
      const session = await res.json()
      setActiveSession(session)
      setStops([])
      setShowStartModal(false)
      setNewName('')
      setNewWeather('')
      setNewRadius('')
      toast.success('Session started!')
    } catch {
      toast.error('Failed to start session')
    }
  }

  const handleEndSession = async () => {
    if (!activeSession) return
    try {
      const res = await fetch(`/api/canvassing/sessions/${activeSession.id}/end`, {
        method: 'POST', headers,
      })
      const ended = await res.json()
      setShowEndConfirm(false)
      setShowSummary(ended)
      setActiveSession(null)
      leafletMapRef.current = null
      toast.success('Session completed!')
    } catch {
      toast.error('Failed to end session')
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
        if (reader.result && logPhotos.length < 6) {
          setLogPhotos((prev) => [...prev, reader.result as string])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmitStop = async (andDone: boolean) => {
    if (!activeSession) return
    setSubmitting(true)
    try {
      const notes = [logDamageNotes, ...logDamageTags.map(t => `[${t}]`), logNotes].filter(Boolean).join('\n')
      const res = await fetch(`/api/canvassing/sessions/${activeSession.id}/stops`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          address: logAddress,
          city: logCity,
          state: logState,
          zip: logZip,
          lat: logLat,
          lng: logLng,
          outcome: logOutcome || 'no_answer',
          notes: notes || null,
          homeownerName: logName || null,
          phone: logPhone || null,
          email: logEmail || null,
          appointmentDate: logAppointmentDate || null,
          doorHangerLeft: logDoorHanger,
          followUpDate: logFollowUp || null,
          photos: logPhotos.length > 0 ? logPhotos : [],
        }),
      })
      const stop = await res.json()

      // Optimistic update
      setStops((prev) => [stop, ...prev])
      setActiveSession((prev: any) => prev ? {
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
    } catch {
      toast.error('Failed to log stop')
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
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
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
      const res = await fetch(`/api/canvassing/sessions/${session.id}`, { headers })
      const data = await res.json()
      setShowSummary(data)
    } catch {
      toast.error('Failed to load session')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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
    const conversionRate = s.totalDoors > 0 ? ((s.leadsCreated || 0) / s.totalDoors * 100).toFixed(1) : '0'

    return (
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
          <button onClick={() => setShowSummary(null)} className="text-gray-500"><ChevronLeft size={20} /></button>
          <h1 className="text-lg font-bold truncate">{s.name}</h1>
        </div>

        <div className="p-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl p-4 border">
              <p className="text-2xl font-bold">{s.totalDoors || 0}</p>
              <p className="text-xs text-gray-500">Total Doors</p>
            </div>
            <div className="bg-white rounded-xl p-4 border">
              <p className="text-2xl font-bold">{s.answeredDoors || 0}</p>
              <p className="text-xs text-gray-500">Answered</p>
            </div>
            <div className="bg-white rounded-xl p-4 border">
              <p className="text-2xl font-bold text-green-600">{s.leadsCreated || 0}</p>
              <p className="text-xs text-gray-500">Leads Created</p>
            </div>
            <div className="bg-white rounded-xl p-4 border">
              <p className="text-2xl font-bold">{conversionRate}%</p>
              <p className="text-xs text-gray-500">Conversion</p>
            </div>
          </div>

          {duration !== null && (
            <p className="text-sm text-gray-500 text-center">Duration: {Math.floor(duration / 60)}h {duration % 60}m</p>
          )}

          {/* Grouped stops */}
          {appointments.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-700 mb-2">Appointments ({appointments.length})</h3>
              {appointments.map((st: Stop) => (
                <div key={st.id} className="bg-green-50 border border-green-200 rounded-lg p-3 mb-2">
                  <p className="text-sm font-medium">{st.address}</p>
                  {st.notes && <p className="text-xs text-gray-600 mt-1">{st.notes}</p>}
                  {st.jobId && (
                    <button onClick={() => navigate(`/crm/jobs/${st.jobId}`)} className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                      View in CRM <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {interested.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-yellow-700 mb-2">Interested ({interested.length})</h3>
              {interested.map((st: Stop) => (
                <div key={st.id} className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-2">
                  <p className="text-sm font-medium">{st.address}</p>
                  {st.jobId && (
                    <button onClick={() => navigate(`/crm/jobs/${st.jobId}`)} className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                      View lead <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {followUps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-blue-700 mb-2">Follow-Ups ({followUps.length})</h3>
              {followUps.map((st: Stop) => (
                <div key={st.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
                  <p className="text-sm font-medium">{st.address}</p>
                  <p className="text-xs text-gray-600">Follow up: {new Date(st.followUpDate).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => exportSessionCsv(s, summaryStops)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gray-100 rounded-xl text-sm font-medium text-gray-700"
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
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="bg-white border-b px-4 py-4">
          <h1 className="text-xl font-bold">Canvassing</h1>
          <p className="text-sm text-gray-500 mt-1">Mobile field tool for door-to-door sales</p>
        </div>

        <div className="p-4 space-y-4">
          <button
            onClick={() => {
              setNewName(`Canvassing — ${new Date().toLocaleDateString()}`)
              setShowStartModal(true)
            }}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-2 active:bg-blue-700"
          >
            <Plus size={24} /> Start New Session
          </button>

          {sessions.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-600 mb-2">Recent Sessions</h2>
              {sessions.slice(0, 5).map((s: Session) => (
                <button
                  key={s.id}
                  onClick={() => loadSessionSummary(s)}
                  className="w-full text-left bg-white rounded-xl p-4 border mb-2 active:bg-gray-50"
                >
                  <p className="font-medium text-sm">{s.name}</p>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span>{new Date(s.startedAt || s.createdAt).toLocaleDateString()}</span>
                    <span>{s.totalDoors || 0} doors</span>
                    <span className="text-green-600 font-medium">{s.leadsCreated || 0} leads</span>
                  </div>
                  {s.weatherEvent && (
                    <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                      <CloudLightning size={12} /> {s.weatherEvent}
                    </p>
                  )}
                </button>
              ))}
              {sessions.length > 5 && (
                <button onClick={() => setTab('sessions')} className="text-sm text-blue-600 font-medium">
                  View All Sessions
                </button>
              )}
            </div>
          )}
        </div>

        {/* Start Session Modal */}
        {showStartModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
            <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">New Canvassing Session</h2>
                <button onClick={() => setShowStartModal(false)}><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Session Name</label>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Oak Park — March 12" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Weather Event</label>
                  <input value={newWeather} onChange={(e) => setNewWeather(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. Hail storm March 10" />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Target Radius (miles, optional)</label>
                  <input type="number" value={newRadius} onChange={(e) => setNewRadius(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="e.g. 0.5" />
                </div>
                <button onClick={handleStartSession}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold active:bg-blue-700">
                  Start Canvassing
                </button>
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
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-bold truncate">{activeSession.name}</h1>
          {activeSession.weatherEvent && (
            <p className="text-xs text-blue-600 flex items-center gap-1">
              <CloudLightning size={10} /> {activeSession.weatherEvent}
            </p>
          )}
        </div>
        <button onClick={() => setShowEndConfirm(true)}
          className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg active:bg-red-100">
          End Session
        </button>
      </div>

      {/* Live Stats */}
      <div className="flex gap-1 px-4 py-2 bg-gray-100 flex-shrink-0">
        <div className="flex-1 text-center">
          <p className="text-lg font-bold">{activeSession.totalDoors || 0}</p>
          <p className="text-[10px] text-gray-500">Doors</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-lg font-bold">{activeSession.answeredDoors || 0}</p>
          <p className="text-[10px] text-gray-500">Answered</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-lg font-bold text-green-600">{activeSession.leadsCreated || 0}</p>
          <p className="text-[10px] text-gray-500">Leads</p>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden relative">
        {/* MAP TAB */}
        {tab === 'map' && (
          <div className="h-full relative">
            <div ref={mapRef} className="h-full w-full" />

            {/* Legend */}
            <div className="absolute top-3 right-3 bg-white/95 rounded-lg shadow-lg p-2 text-[10px] space-y-1 z-[1000]">
              {Object.entries(PIN_COLORS).map(([k, c]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c }} />
                  <span>{OUTCOME_CONFIG[k]?.label}</span>
                </div>
              ))}
            </div>

            {/* FAB */}
            <button onClick={openLogModal}
              className="absolute bottom-6 right-6 w-16 h-16 bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center active:bg-blue-700 z-[1000]">
              <DoorOpen size={28} />
            </button>
          </div>
        )}

        {/* SCRIPT TAB */}
        {tab === 'script' && defaultScript && (
          <div className="h-full flex flex-col p-4">
            <h2 className="text-sm font-bold mb-3">{defaultScript.name}</h2>
            {(() => {
              const steps = Array.isArray(defaultScript.steps) ? defaultScript.steps : []
              if (steps.length === 0) return <p className="text-sm text-gray-500">No script steps configured.</p>
              const step = steps[scriptStep] || steps[0]
              return (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 bg-white rounded-xl p-5 border">
                    <p className="text-xs text-blue-600 font-semibold mb-1">Step {scriptStep + 1} of {steps.length}</p>
                    <h3 className="text-lg font-bold mb-3">{step.title}</h3>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{step.body}</p>
                    {step.tips && (
                      <div className="mt-4 bg-yellow-50 rounded-lg p-3">
                        <p className="text-xs font-semibold text-yellow-800 mb-1">Tips</p>
                        <p className="text-xs text-yellow-700">{step.tips}</p>
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
                      className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-30">
                      Next <ChevronRight size={16} className="inline" />
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
        {tab === 'script' && !defaultScript && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">No scripts configured</div>
        )}

        {/* SESSIONS TAB */}
        {tab === 'sessions' && (
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {sessions.map((s: Session) => (
              <button key={s.id} onClick={() => loadSessionSummary(s)}
                className="w-full text-left bg-white rounded-xl p-4 border active:bg-gray-50">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    s.status === 'active' ? 'bg-green-100 text-green-700' :
                    s.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{s.status}</span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>{new Date(s.startedAt || s.createdAt).toLocaleDateString()}</span>
                  <span>{s.totalDoors || 0} doors</span>
                  <span>{s.leadsCreated || 0} leads</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="flex border-t bg-white flex-shrink-0 safe-area-bottom">
        {[
          { key: 'map' as const, icon: MapIcon, label: 'Map' },
          { key: 'log' as const, icon: DoorOpen, label: 'Log Stop', action: openLogModal },
          { key: 'script' as const, icon: BookOpen, label: 'Script' },
          { key: 'sessions' as const, icon: List, label: 'Sessions' },
        ].map((item) => (
          <button key={item.key}
            onClick={item.action || (() => setTab(item.key))}
            className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-medium ${
              tab === item.key ? 'text-blue-600' : 'text-gray-400'
            }`}>
            <item.icon size={20} />
            {item.label}
          </button>
        ))}
      </div>

      {/* LOG DOOR KNOCK MODAL */}
      {showLogModal && (
        <div className="fixed inset-0 bg-white z-50 flex flex-col">
          {/* Modal Header */}
          <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
            <button onClick={() => setShowLogModal(false)} className="text-gray-500"><X size={20} /></button>
            <h2 className="font-bold">Log Door Knock</h2>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`w-2 h-2 rounded-full ${i <= logStep ? 'bg-blue-600' : 'bg-gray-300'}`} />
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* Step 0: Address */}
            {logStep === 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Where are you?</h3>

                {logGpsStatus === 'loading' && (
                  <div className="bg-blue-50 rounded-xl p-4 flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                    <p className="text-sm text-blue-700">Getting your location...</p>
                  </div>
                )}

                {logGpsStatus === 'success' && logAddress && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Navigation size={16} className="text-green-600" />
                      <p className="text-sm font-medium text-green-800">GPS Location Found</p>
                    </div>
                    <p className="text-sm text-gray-700">{logAddress}{logCity ? `, ${logCity}` : ''}{logState ? `, ${logState}` : ''} {logZip}</p>
                  </div>
                )}

                {logGpsStatus === 'denied' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                    <p className="text-sm text-yellow-800">GPS unavailable — enter address manually</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700">Street Address</label>
                  <input value={logAddress} onChange={(e) => setLogAddress(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="1234 Oak St" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">City</label>
                    <input value={logCity} onChange={(e) => setLogCity(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">State</label>
                    <input value={logState} onChange={(e) => setLogState(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Zip</label>
                    <input value={logZip} onChange={(e) => setLogZip(e.target.value)}
                      className="w-full border rounded-lg px-2 py-2 text-sm" />
                  </div>
                </div>

                {logGpsStatus !== 'success' && (
                  <button onClick={requestGps}
                    className="w-full py-2.5 border border-blue-200 rounded-lg text-sm text-blue-600 font-medium flex items-center justify-center gap-2">
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
                  <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Camera size={16} /> Take Damage Photos
                  </label>
                  <input type="file" accept="image/*" capture="environment" multiple
                    onChange={handlePhotoCapture}
                    className="mt-2 w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium" />
                </div>

                {logPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {logPhotos.map((photo, i) => (
                      <div key={i} className="relative">
                        <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-20 object-cover rounded-lg" />
                        <button onClick={() => setLogPhotos((prev) => prev.filter((_, j) => j !== i))}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs">
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-700">Quick Tags</label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {DAMAGE_TAGS.map((tag) => (
                      <button key={tag}
                        onClick={() => setLogDamageTags((prev) =>
                          prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                        )}
                        className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
                          logDamageTags.includes(tag) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600'
                        }`}>
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Damage Notes</label>
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
                        logOutcome === key ? cfg.bgColor + ' border-2' : 'bg-white border-gray-200'
                      }`}>
                      <span className="text-2xl">{cfg.emoji}</span>
                      <p className={`text-sm font-semibold mt-1 ${logOutcome === key ? cfg.color : 'text-gray-700'}`}>
                        {cfg.label}
                      </p>
                    </button>
                  ))}
                </div>

                {/* Expanded fields for interested / appointment_set */}
                {(logOutcome === 'interested' || logOutcome === 'appointment_set') && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3 border">
                    <div>
                      <label className="text-sm font-medium text-gray-700">Homeowner Name *</label>
                      <input value={logName} onChange={(e) => setLogName(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="Full name" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Phone *</label>
                      <input type="tel" value={logPhone} onChange={(e) => setLogPhone(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="(555) 123-4567" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-700">Email (optional)</label>
                      <input type="email" value={logEmail} onChange={(e) => setLogEmail(e.target.value)}
                        className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" placeholder="email@example.com" />
                    </div>
                    {logOutcome === 'appointment_set' && (
                      <div>
                        <label className="text-sm font-medium text-gray-700">Appointment Date & Time</label>
                        <input type="datetime-local" value={logAppointmentDate}
                          onChange={(e) => setLogAppointmentDate(e.target.value)}
                          className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between bg-white border rounded-xl p-4">
                  <span className="text-sm font-medium">Left door hanger</span>
                  <button onClick={() => setLogDoorHanger(!logDoorHanger)}
                    className={`w-12 h-6 rounded-full transition ${logDoorHanger ? 'bg-blue-600' : 'bg-gray-300'}`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${logDoorHanger ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Follow-up Date (optional)</label>
                  <input type="date" value={logFollowUp} onChange={(e) => setLogFollowUp(e.target.value)}
                    className="w-full mt-1 border rounded-lg px-3 py-2.5 text-sm" />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Additional Notes</label>
                  <textarea value={logNotes} onChange={(e) => setLogNotes(e.target.value)}
                    rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {logStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Confirm</h3>

                <div className="bg-white border rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Address</span>
                    <span className="font-medium">{logAddress || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Outcome</span>
                    <span className="font-medium">{OUTCOME_CONFIG[logOutcome]?.label || 'Not set'}</span>
                  </div>
                  {logPhotos.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Photos</span>
                      <span className="font-medium">{logPhotos.length} photo{logPhotos.length !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                  {logDamageTags.length > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Damage</span>
                      <span className="font-medium">{logDamageTags.join(', ')}</span>
                    </div>
                  )}
                  {logDoorHanger && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Door Hanger</span>
                      <span className="font-medium text-blue-600">Yes</span>
                    </div>
                  )}
                  {logName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Homeowner</span>
                      <span className="font-medium">{logName}</span>
                    </div>
                  )}
                </div>

                {(logOutcome === 'interested' || logOutcome === 'appointment_set') && logPhone && (
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                    <p className="text-sm text-green-800 font-medium">This will create a new lead in your CRM</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button onClick={() => handleSubmitStop(false)} disabled={submitting}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold disabled:opacity-50 active:bg-blue-700">
                    {submitting ? 'Saving...' : 'Log & Continue'}
                  </button>
                  <button onClick={() => handleSubmitStop(true)} disabled={submitting}
                    className="flex-1 py-3 border-2 border-blue-600 text-blue-600 rounded-xl font-semibold disabled:opacity-50">
                    Log & Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step Navigation */}
          {logStep < 3 && (
            <div className="p-4 border-t bg-white flex-shrink-0">
              <div className="flex gap-3">
                {logStep > 0 && (
                  <button onClick={() => setLogStep(logStep - 1)}
                    className="flex-1 py-3 border rounded-xl text-sm font-medium">
                    Back
                  </button>
                )}
                <button onClick={() => setLogStep(logStep + 1)}
                  disabled={logStep === 0 && !logAddress}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold disabled:opacity-30 active:bg-blue-700">
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
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold mb-2">End Session?</h3>
            <p className="text-sm text-gray-600 mb-4">
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
