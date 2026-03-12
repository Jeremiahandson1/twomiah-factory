import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CloudLightning, ChevronRight,
  Trophy, Plus, X, Trash2, Save,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  no_answer: { label: 'No Answer', color: 'bg-gray-100 text-gray-700' },
  not_interested: { label: 'Not Interested', color: 'bg-red-100 text-red-700' },
  interested: { label: 'Interested', color: 'bg-yellow-100 text-yellow-700' },
  appointment_set: { label: 'Appointment', color: 'bg-green-100 text-green-700' },
  already_has_contractor: { label: 'Has Contractor', color: 'bg-orange-100 text-orange-700' },
  vacant: { label: 'Vacant', color: 'bg-gray-100 text-gray-600' },
}

const PIN_COLORS: Record<string, string> = {
  no_answer: '#9CA3AF',
  not_interested: '#EF4444',
  interested: '#EAB308',
  appointment_set: '#22C55E',
  already_has_contractor: '#F97316',
  vacant: '#9CA3AF',
}

type Session = any
type Stop = any
type Script = any

export default function CanvassingDashboard() {
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [sessions, setSessions] = useState<Session[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterRep, setFilterRep] = useState('')
  const [filterWeather, setFilterWeather] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Detail view
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [sessionStops, setSessionStops] = useState<Stop[]>([])
  const detailMapRef = useRef<HTMLDivElement>(null)
  const detailLeafletRef = useRef<any>(null)

  // Script editor
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  const [editingScript, setEditingScript] = useState<Script | null>(null)
  const [scriptName, setScriptName] = useState('')
  const [scriptSteps, setScriptSteps] = useState<{ title: string; body: string; tips: string }[]>([])
  const [scriptIsDefault, setScriptIsDefault] = useState(false)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const load = useCallback(async () => {
    try {
      const [sessRes, usersRes, scriptRes] = await Promise.all([
        fetch('/api/canvassing/sessions', { headers }),
        fetch('/api/users', { headers }),
        fetch('/api/canvassing/scripts', { headers }),
      ])
      const sessData = await sessRes.json()
      setSessions(Array.isArray(sessData) ? sessData : [])
      const usersData = await usersRes.json()
      setUsers(Array.isArray(usersData) ? usersData : usersData.data || [])
      const scriptData = await scriptRes.json()
      setScripts(Array.isArray(scriptData) ? scriptData : [])
    } catch {
      toast.error('Failed to load canvassing data')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const loadSessionDetail = async (session: Session) => {
    try {
      const res = await fetch(`/api/canvassing/sessions/${session.id}`, { headers })
      const data = await res.json()
      setSelectedSession(data)
      setSessionStops(data.stops || [])
    } catch {
      toast.error('Failed to load session detail')
    }
  }

  // Render detail map
  useEffect(() => {
    if (!detailMapRef.current || !selectedSession) return
    if (detailLeafletRef.current) { detailLeafletRef.current.remove(); detailLeafletRef.current = null }

    const L = (window as any).L
    if (!L) return

    const lat = selectedSession.centerLat || 32.78
    const lng = selectedSession.centerLng || -96.8
    const map = L.map(detailMapRef.current).setView([lat, lng], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    sessionStops.forEach((stop: Stop) => {
      if (!stop.lat || !stop.lng) return
      const color = PIN_COLORS[stop.outcome] || '#9CA3AF'
      L.circleMarker([Number(stop.lat), Number(stop.lng)], {
        radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9,
      }).addTo(map).bindPopup(`<strong>${stop.address || 'Unknown'}</strong><br/>${OUTCOME_LABELS[stop.outcome]?.label || stop.outcome}`)
    })

    // Fit bounds if stops exist
    const validStops = sessionStops.filter((s: Stop) => s.lat && s.lng)
    if (validStops.length > 1) {
      const bounds = L.latLngBounds(validStops.map((s: Stop) => [Number(s.lat), Number(s.lng)]))
      map.fitBounds(bounds, { padding: [30, 30] })
    }

    detailLeafletRef.current = map
    return () => { map.remove(); detailLeafletRef.current = null }
  }, [selectedSession, sessionStops])

  const filteredSessions = sessions.filter((s: Session) => {
    if (filterRep && s.userId !== filterRep) return false
    if (filterWeather && !s.weatherEvent?.toLowerCase().includes(filterWeather.toLowerCase())) return false
    if (filterDateFrom && new Date(s.startedAt || s.createdAt) < new Date(filterDateFrom)) return false
    if (filterDateTo && new Date(s.startedAt || s.createdAt) > new Date(filterDateTo + 'T23:59:59')) return false
    return true
  })

  // Leaderboard: leads this month
  const thisMonth = new Date()
  thisMonth.setDate(1)
  thisMonth.setHours(0, 0, 0, 0)
  const monthSessions = sessions.filter((s: Session) => new Date(s.startedAt || s.createdAt) >= thisMonth)
  const repLeads: Record<string, { name: string; leads: number; doors: number }> = {}
  monthSessions.forEach((s: Session) => {
    const u = users.find((u: any) => u.id === s.userId)
    const name = u ? (u.name || u.firstName + ' ' + u.lastName || u.email) : 'Unknown'
    if (!repLeads[s.userId]) repLeads[s.userId] = { name, leads: 0, doors: 0 }
    repLeads[s.userId].leads += s.leadsCreated || 0
    repLeads[s.userId].doors += s.totalDoors || 0
  })
  const leaderboard = Object.values(repLeads).sort((a, b) => b.leads - a.leads)

  const userMap: Record<string, string> = {}
  users.forEach((u: any) => { userMap[u.id] = u.name || u.firstName + ' ' + u.lastName || u.email })

  // Script editor handlers
  const openScriptEditor = (script?: Script) => {
    if (script) {
      setEditingScript(script)
      setScriptName(script.name)
      setScriptSteps(Array.isArray(script.steps) ? script.steps : [])
      setScriptIsDefault(script.isDefault)
    } else {
      setEditingScript(null)
      setScriptName('')
      setScriptSteps([{ title: '', body: '', tips: '' }])
      setScriptIsDefault(false)
    }
    setShowScriptEditor(true)
  }

  const saveScript = async () => {
    try {
      const payload = { name: scriptName, steps: scriptSteps, isDefault: scriptIsDefault }
      if (editingScript) {
        await fetch(`/api/canvassing/scripts/${editingScript.id}`, {
          method: 'PUT', headers, body: JSON.stringify(payload),
        })
      } else {
        await fetch('/api/canvassing/scripts', {
          method: 'POST', headers, body: JSON.stringify(payload),
        })
      }
      setShowScriptEditor(false)
      load()
      toast.success('Script saved!')
    } catch {
      toast.error('Failed to save script')
    }
  }

  const deleteScript = async (script: Script) => {
    if (script.isDefault) { toast.error('Cannot delete the default script'); return }
    try {
      await fetch(`/api/canvassing/scripts/${script.id}`, { method: 'DELETE', headers })
      load()
      toast.success('Script deleted')
    } catch {
      toast.error('Failed to delete script')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  // ── SESSION DETAIL ──
  if (selectedSession) {
    const s = selectedSession
    const appointments = sessionStops.filter((st: Stop) => st.outcome === 'appointment_set')
    const duration = s.startedAt && s.endedAt
      ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)
      : null

    return (
      <div className="p-6">
        <button onClick={() => { setSelectedSession(null); setSessionStops([]) }}
          className="text-sm text-blue-600 font-medium mb-4 flex items-center gap-1 hover:underline">
          &larr; Back to Dashboard
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{s.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
              <span>{new Date(s.startedAt || s.createdAt).toLocaleDateString()}</span>
              {s.weatherEvent && (
                <span className="text-blue-600 flex items-center gap-1">
                  <CloudLightning size={14} /> {s.weatherEvent}
                </span>
              )}
              {duration !== null && <span>{Math.floor(duration / 60)}h {duration % 60}m</span>}
            </div>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
            s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>{s.status}</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border">
            <p className="text-2xl font-bold">{s.totalDoors || 0}</p>
            <p className="text-sm text-gray-500">Total Doors</p>
          </div>
          <div className="bg-white rounded-xl p-4 border">
            <p className="text-2xl font-bold">{s.answeredDoors || 0}</p>
            <p className="text-sm text-gray-500">Answered</p>
          </div>
          <div className="bg-white rounded-xl p-4 border">
            <p className="text-2xl font-bold text-green-600">{s.leadsCreated || 0}</p>
            <p className="text-sm text-gray-500">Leads Created</p>
          </div>
          <div className="bg-white rounded-xl p-4 border">
            <p className="text-2xl font-bold">{appointments.length}</p>
            <p className="text-sm text-gray-500">Appointments</p>
          </div>
        </div>

        {/* Map + Stops */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Map</h3>
            <div ref={detailMapRef} className="h-80 rounded-xl border" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2">Stops ({sessionStops.length})</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {sessionStops.map((stop: Stop) => (
                <div key={stop.id} className="bg-white rounded-lg p-3 border text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{stop.address || 'Unknown'}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${OUTCOME_LABELS[stop.outcome]?.color || 'bg-gray-100'}`}>
                      {OUTCOME_LABELS[stop.outcome]?.label || stop.outcome}
                    </span>
                  </div>
                  {stop.notes && <p className="text-xs text-gray-500 mt-1 truncate">{stop.notes}</p>}
                  {stop.jobId && (
                    <button onClick={() => navigate(`/crm/jobs/${stop.jobId}`)}
                      className="text-xs text-blue-600 mt-1 hover:underline">
                      View CRM Lead &rarr;
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── DASHBOARD ──
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Canvassing Dashboard</h1>
          <p className="text-sm text-gray-500">Review canvassing activity and manage scripts</p>
        </div>
        <button onClick={() => openScriptEditor()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> Manage Scripts
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select value={filterRep} onChange={(e) => setFilterRep(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white">
          <option value="">All Reps</option>
          {users.map((u: any) => (
            <option key={u.id} value={u.id}>{u.name || u.firstName + ' ' + u.lastName || u.email}</option>
          ))}
        </select>
        <input type="text" value={filterWeather} onChange={(e) => setFilterWeather(e.target.value)}
          placeholder="Filter by weather event..." className="text-sm border rounded-lg px-3 py-1.5 bg-white" />
        <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white" />
        <span className="text-sm text-gray-400">to</span>
        <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Sessions Table */}
        <div className="col-span-2">
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">Rep</th>
                  <th className="px-4 py-3">Session</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Doors</th>
                  <th className="px-4 py-3">Leads</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s: Session) => (
                  <tr key={s.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => loadSessionDetail(s)}>
                    <td className="px-4 py-3 text-sm">{userMap[s.userId] || 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[200px]">{s.name}</p>
                      {s.weatherEvent && (
                        <p className="text-xs text-blue-600 flex items-center gap-1 mt-0.5">
                          <CloudLightning size={10} /> {s.weatherEvent}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(s.startedAt || s.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{s.totalDoors || 0}</td>
                    <td className="px-4 py-3 font-semibold text-green-600">{s.leadsCreated || 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        s.status === 'active' ? 'bg-green-100 text-green-700' :
                        s.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3"><ChevronRight size={16} className="text-gray-400" /></td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No sessions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Leaderboard + Scripts */}
        <div className="space-y-6">
          {/* Leaderboard */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-yellow-500" />
              <h3 className="text-sm font-semibold">This Month's Leaderboard</h3>
            </div>
            {leaderboard.length > 0 ? (
              <div className="space-y-2">
                {leaderboard.map((rep, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-yellow-100 text-yellow-700' :
                        i === 1 ? 'bg-gray-100 text-gray-600' :
                        i === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>{i + 1}</span>
                      <span className="text-sm font-medium truncate">{rep.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-600">{rep.leads} leads</p>
                      <p className="text-[10px] text-gray-400">{rep.doors} doors</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No activity this month</p>
            )}
          </div>

          {/* Scripts */}
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Canvassing Scripts</h3>
              <button onClick={() => openScriptEditor()} className="text-xs text-blue-600 font-medium">+ New</button>
            </div>
            {scripts.length > 0 ? (
              <div className="space-y-2">
                {scripts.map((script: Script) => (
                  <div key={script.id} className="flex items-center justify-between py-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{script.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {Array.isArray(script.steps) ? script.steps.length : 0} steps
                        {script.isDefault && <span className="ml-1 text-blue-600 font-medium">(default)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openScriptEditor(script) }}
                        className="text-xs text-gray-400 hover:text-blue-600 px-2 py-1">Edit</button>
                      {!script.isDefault && (
                        <button onClick={(e) => { e.stopPropagation(); deleteScript(script) }}
                          className="text-xs text-gray-400 hover:text-red-600 px-1 py-1">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No scripts yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Script Editor Modal */}
      {showScriptEditor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingScript ? 'Edit Script' : 'New Script'}</h2>
              <button onClick={() => setShowScriptEditor(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Script Name</label>
                <input value={scriptName} onChange={(e) => setScriptName(e.target.value)}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Hail Damage — Standard" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={scriptIsDefault} onChange={(e) => setScriptIsDefault(e.target.checked)} id="isDefault" />
                <label htmlFor="isDefault" className="text-sm text-gray-700">Set as default script</label>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">Steps</label>
                <div className="space-y-3 mt-2">
                  {scriptSteps.map((step, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500">Step {i + 1}</span>
                        {scriptSteps.length > 1 && (
                          <button onClick={() => setScriptSteps(prev => prev.filter((_, j) => j !== i))}
                            className="text-xs text-red-500"><Trash2 size={12} /></button>
                        )}
                      </div>
                      <input value={step.title} onChange={(e) => {
                        const updated = [...scriptSteps]; updated[i] = { ...updated[i], title: e.target.value }; setScriptSteps(updated)
                      }} placeholder="Step title" className="w-full border rounded px-2 py-1.5 text-sm" />
                      <textarea value={step.body} onChange={(e) => {
                        const updated = [...scriptSteps]; updated[i] = { ...updated[i], body: e.target.value }; setScriptSteps(updated)
                      }} placeholder="Script body text..." rows={3} className="w-full border rounded px-2 py-1.5 text-sm" />
                      <input value={step.tips} onChange={(e) => {
                        const updated = [...scriptSteps]; updated[i] = { ...updated[i], tips: e.target.value }; setScriptSteps(updated)
                      }} placeholder="Tips (optional)" className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  ))}
                  <button onClick={() => setScriptSteps(prev => [...prev, { title: '', body: '', tips: '' }])}
                    className="w-full py-2 border-2 border-dashed rounded-lg text-sm text-gray-400 hover:text-blue-600 hover:border-blue-300">
                    + Add Step
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowScriptEditor(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={saveScript}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                  <Save size={16} /> Save Script
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
