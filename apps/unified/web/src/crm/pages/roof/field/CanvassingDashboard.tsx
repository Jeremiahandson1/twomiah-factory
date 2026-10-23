// Moved from templates/crm-roof/frontend/src/pages/roofing/CanvassingDashboard.tsx. The office's view of door-to-door
// canvassing at /api/canvassing (server/crm/roof/field/canvassing.ts, the canvassing_tool feature): the sessions the seat
// may read (the team's for canvassing:manage or canvassing:read, otherwise its own), a session's doors on a map, this
// month's leaderboard, and the shop's scripts.
//
// Changes from the template:
//   · /sessions and /scripts are { data, pagination } — the template read bare arrays, so the page would have been empty;
//   · the rep picker's names are /api/company/users (roofing's /api/users), asked of a seat that holds users:read or
//     team:read, the server's rule (the template asked team:read alone);
//   · a door that became a lead links to its job and its homeowner (/crm/jobs/:id, /crm/contacts/:id);
//   · the map is Leaflet imported by the app (./PinMap.tsx) — the template's read `window.L` from a CDN script;
//   · a script refused by the server shows its sentence (as the template's did); "Vacant" carries its dark pair.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, CloudLightning, Plus, Save, Trash2, Trophy, X } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useAuth, useMayWrite, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { companyDayBounds, companyDayStart, companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { displayName } from '../lib/user'
import { listOf } from './http'
import PinMap, { coord, type Pin } from './PinMap'
import { PIN_COLORS, type CanvassScript, type CanvassSession, type CanvassStop, type ScriptStep } from './canvassing'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  no_answer: { label: 'No Answer', color: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800' },
  not_interested: { label: 'Not Interested', color: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40' },
  interested: { label: 'Interested', color: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' },
  appointment_set: { label: 'Appointment', color: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' },
  already_has_contractor: { label: 'Has Contractor', color: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40' },
  vacant: { label: 'Vacant', color: 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800' },
}

/** A login, as /api/company/users answers it to a roster seat. */
interface Rep { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }

export default function CanvassingDashboard() {
  // The script library is the shop's pitch and sits on marketing:update — deliberately NOT
  // canvassing:*, which the field rung holds so it can log a knock. A grant that hands over the
  // playbook along with the clipboard is the over-widening the T41 note already undid. (T42)
  const mayWriteScripts = useMayWrite('marketing:update')
  // Knocking doors is canvassing:create (the field seat holds it): the canvasser's own full-screen view.
  const mayCanvass = useMayWrite('canvassing:create')
  const { user } = useAuth()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [sessions, setSessions] = useState<CanvassSession[]>([])
  const [users, setUsers] = useState<Rep[]>([])
  const [scripts, setScripts] = useState<CanvassScript[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterRep, setFilterRep] = useState('')
  const [filterWeather, setFilterWeather] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Detail view
  const [selectedSession, setSelectedSession] = useState<CanvassSession | null>(null)
  const [sessionStops, setSessionStops] = useState<CanvassStop[]>([])

  // Script editor
  const [showScriptEditor, setShowScriptEditor] = useState(false)
  const [editingScript, setEditingScript] = useState<CanvassScript | null>(null)
  const [scriptName, setScriptName] = useState('')
  const [scriptSteps, setScriptSteps] = useState<ScriptStep[]>([])
  const [scriptIsDefault, setScriptIsDefault] = useState(false)

  // The rep list is GET /api/company/users — users:read or team:read. Crew hold neither, so for them it would be a
  // refused request and an empty "All Reps" picker. Asked only of a seat it answers; the picker only when it has names.
  // (T63) null until the permission list arrives — the request waits for a real yes (T64).
  const { known, can } = usePermissions()
  const maySeeRoster: boolean | null = known ? (can('users:read') || can('team:read')) : null

  const load = useCallback(async () => {
    try {
      const [sessReply, usersReply, scriptReply] = await Promise.all([
        api.get('/api/canvassing/sessions'),
        maySeeRoster ? api.get('/api/company/users').catch(() => []) : Promise.resolve([]),
        api.get('/api/canvassing/scripts'),
      ])
      setSessions(listOf<CanvassSession>(sessReply))
      setUsers(Array.isArray(usersReply) ? (usersReply as Rep[]) : [])
      setScripts(listOf<CanvassScript>(scriptReply))
    } catch (e) {
      toastRef.current.error(errorText(e, 'Failed to load canvassing data'))
    } finally {
      setLoading(false)
    }
  }, [maySeeRoster])

  useEffect(() => { load() }, [load])

  const loadSessionDetail = async (session: CanvassSession) => {
    try {
      const data = (await api.get(`/api/canvassing/sessions/${encodeURIComponent(session.id)}`)) as CanvassSession
      setSelectedSession(data)
      setSessionStops(Array.isArray(data.stops) ? data.stops : [])
    } catch (e) {
      toast.error(errorText(e, 'Failed to load session detail'))
    }
  }

  const detailPins = useMemo<Pin[]>(() => sessionStops.flatMap((stop) => {
    const lat = coord(stop.lat)
    const lng = coord(stop.lng)
    if (lat === null || lng === null) return []
    return [{ id: stop.id, lat, lng, color: PIN_COLORS[stop.outcome] || '#9CA3AF', title: stop.address || 'Unknown', lines: [OUTCOME_LABELS[stop.outcome]?.label || stop.outcome] }]
  }), [sessionStops])

  const filteredSessions = sessions.filter((s) => {
    if (filterRep && s.userId !== filterRep) return false
    if (filterWeather && !s.weatherEvent?.toLowerCase().includes(filterWeather.toLowerCase())) return false
    // The picked days are the company's: from its midnight on the first to the end of the last (not UTC's, not the browser's).
    if (filterDateFrom && new Date(s.startedAt || s.createdAt) < new Date(companyDayBounds(filterDateFrom).from)) return false
    if (filterDateTo && new Date(s.startedAt || s.createdAt) > new Date(companyDayBounds(filterDateTo).to)) return false
    return true
  })

  // Leaderboard: leads this month
  const thisMonth = companyDayStart(companyTodayKey().slice(0, 8) + '01') // the 1st, at the company's midnight
  const monthSessions = sessions.filter((s) => new Date(s.startedAt || s.createdAt) >= thisMonth)
  const repLeads: Record<string, { name: string; leads: number; doors: number }> = {}
  monthSessions.forEach((s) => {
    const u = users.find((r) => r.id === s.userId)
    // A canvasser is not handed the roster, and sees only their own sessions — so their row is "You", not "Unknown". (T64)
    const name = u ? displayName(u) : (s.userId === user?.id ? displayName(user) : 'Unknown')
    if (!repLeads[s.userId]) repLeads[s.userId] = { name, leads: 0, doors: 0 }
    repLeads[s.userId].leads += s.leadsCreated || 0
    repLeads[s.userId].doors += s.totalDoors || 0
  })
  const leaderboard = Object.values(repLeads).sort((a, b) => b.leads - a.leads)

  const userMap: Record<string, string> = {}
  users.forEach((u) => { userMap[u.id] = displayName(u) })
  if (user?.id && !userMap[user.id]) userMap[user.id] = displayName(user)

  const openScriptEditor = (script?: CanvassScript) => {
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

  // The server refuses a script with no name or nothing to say (T60): its own sentence is what the person sees, and the
  // editor stays open with their work in it.
  const saveScript = async () => {
    try {
      const payload = { name: scriptName, steps: scriptSteps, isDefault: scriptIsDefault }
      if (editingScript) await api.put(`/api/canvassing/scripts/${encodeURIComponent(editingScript.id)}`, payload)
      else await api.post('/api/canvassing/scripts', payload)
      setShowScriptEditor(false)
      load()
      toast.success('Script saved!')
    } catch (e) {
      toast.error(errorText(e, 'Failed to save script'))
    }
  }

  const deleteScript = async (script: CanvassScript) => {
    if (script.isDefault) { toast.error('Cannot delete the default script'); return }
    try {
      await api.delete(`/api/canvassing/scripts/${encodeURIComponent(script.id)}`)
      load()
      toast.success('Script deleted')
    } catch (e) {
      toast.error(errorText(e, 'Failed to delete script'))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  // ── SESSION DETAIL ──
  if (selectedSession) {
    const s = selectedSession
    const appointments = sessionStops.filter((st) => st.outcome === 'appointment_set')
    const duration = s.startedAt && s.endedAt
      ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)
      : null
    const lat = coord(s.centerLat)
    const lng = coord(s.centerLng)

    return (
      <div className="p-6">
        <button onClick={() => { setSelectedSession(null); setSessionStops([]) }}
          className="text-sm text-orange-600 dark:text-orange-200 font-medium mb-4 flex items-center gap-1 hover:underline">
          &larr; Back to Dashboard
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{s.name}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 dark:text-slate-400">
              <span>{formatDate(s.startedAt || s.createdAt)}</span>
              {s.weatherEvent && (
                <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <CloudLightning size={14} /> {s.weatherEvent}
                </span>
              )}
              {duration !== null && <span>{Math.floor(duration / 60)}h {duration % 60}m</span>}
            </div>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
            s.status === 'active' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' : 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
          }`}>{codeLabel(s.status)}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
            <p className="text-2xl font-bold">{s.totalDoors || 0}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">Total Doors</p>
          </div>
          <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
            <p className="text-2xl font-bold">{s.answeredDoors || 0}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">Answered</p>
          </div>
          <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{s.leadsCreated || 0}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">Leads Created</p>
          </div>
          <div className="bg-white rounded-xl p-4 border dark:bg-slate-900">
            <p className="text-2xl font-bold">{appointments.length}</p>
            <p className="text-sm text-gray-500 dark:text-slate-400">Appointments</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2 dark:text-slate-400">Map</h3>
            <PinMap pins={detailPins} center={lat !== null && lng !== null ? [lat, lng] : null} className="h-80 rounded-xl border" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2 dark:text-slate-400">Stops ({sessionStops.length})</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {sessionStops.map((stop) => (
                <div key={stop.id} className="bg-white rounded-lg p-3 border text-sm dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{stop.address || 'Unknown'}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${OUTCOME_LABELS[stop.outcome]?.color || 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'}`}>
                      {OUTCOME_LABELS[stop.outcome]?.label || stop.outcome}
                    </span>
                  </div>
                  {stop.notes && <p className="text-xs text-gray-500 mt-1 truncate dark:text-slate-400">{stop.notes}</p>}
                  {(stop.jobId || stop.contactId) && (
                    <div className="flex items-center gap-3 mt-1">
                      {stop.jobId && (
                        <Link to={`/crm/jobs/${stop.jobId}`} className="text-xs text-orange-600 dark:text-orange-200 hover:underline">
                          View job &rarr;
                        </Link>
                      )}
                      {stop.contactId && (
                        <Link to={`/crm/contacts/${stop.contactId}`} className="text-xs text-orange-600 dark:text-orange-200 hover:underline">
                          View homeowner &rarr;
                        </Link>
                      )}
                    </div>
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Canvassing Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Review canvassing activity and manage scripts</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {mayCanvass && (
          <Link to="/crm/canvass" className="flex items-center gap-2 px-4 py-2 border border-orange-600 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-50 dark:border-orange-400 dark:text-orange-300 dark:hover:bg-orange-950/40">
            Open the canvasser view
          </Link>
        )}
        {mayWriteScripts && (
          <button onClick={() => openScriptEditor()}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700">
            <Plus size={16} /> Manage Scripts
          </button>
        )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {users.length > 0 && (
          <select aria-label="Rep" value={filterRep} onChange={(e) => setFilterRep(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900">
            <option value="">All Reps</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{displayName(u)}</option>
            ))}
          </select>
        )}
        <input type="text" value={filterWeather} onChange={(e) => setFilterWeather(e.target.value)}
          placeholder="Filter by weather event..." className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900" />
        <input type="date" aria-label="From" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900" />
        <span className="text-sm text-gray-500 dark:text-slate-400">to</span>
        <input type="date" aria-label="To" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900" />
      </div>

      {/* ONE COLUMN ON A PHONE (T58d): three columns is a desk layout; a canvasser is holding a phone at a front door. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500 uppercase dark:bg-slate-900 dark:text-slate-400">
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
                {filteredSessions.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer" onClick={() => loadSessionDetail(s)}>
                    <td className="px-4 py-3 text-sm">{userMap[s.userId] || 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-[200px]">{s.name}</p>
                      {s.weatherEvent && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-0.5">
                          <CloudLightning size={10} /> {s.weatherEvent}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{formatDate(s.startedAt || s.createdAt)}</td>
                    <td className="px-4 py-3">{s.totalDoors || 0}</td>
                    <td className="px-4 py-3 font-semibold text-green-700 dark:text-green-300">{s.leadsCreated || 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        s.status === 'active' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                        s.status === 'paused' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
                        'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                      }`}>{codeLabel(s.status)}</span>
                    </td>
                    <td className="px-4 py-3"><ChevronRight size={16} className="text-gray-500 dark:text-slate-400" /></td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No sessions found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-4 dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-yellow-500 dark:text-yellow-300" />
              <h3 className="text-sm font-semibold">This Month's Leaderboard</h3>
            </div>
            {leaderboard.length > 0 ? (
              <div className="space-y-2">
                {leaderboard.map((rep, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
                        i === 1 ? 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800' :
                        i === 2 ? 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40' :
                        'bg-gray-50 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                      }`}>{i + 1}</span>
                      <span className="text-sm font-medium truncate">{rep.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-700 dark:text-green-300">{rep.leads} leads</p>
                      <p className="text-[10px] text-gray-500 dark:text-slate-400">{rep.doors} doors</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">No activity this month</p>
            )}
          </div>

          <div className="bg-white rounded-xl border p-4 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Canvassing Scripts</h3>
              {mayWriteScripts && (<button onClick={() => openScriptEditor()} className="text-xs text-orange-600 dark:text-orange-200 font-medium">+ New</button>)}
            </div>
            {scripts.length > 0 ? (
              <div className="space-y-2">
                {scripts.map((script) => (
                  <div key={script.id} className="flex items-center justify-between py-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{script.name}</p>
                      <p className="text-[10px] text-gray-500 dark:text-slate-400">
                        {Array.isArray(script.steps) ? script.steps.length : 0} steps
                        {script.isDefault && <span className="ml-1 text-blue-600 dark:text-blue-400 font-medium">(default)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {mayWriteScripts && (
                        <button onClick={(e) => { e.stopPropagation(); openScriptEditor(script) }}
                          className="text-xs text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-100 px-2 py-1">Edit</button>
                      )}
                      {!script.isDefault && mayWriteScripts && (
                        <button aria-label="Delete script" onClick={(e) => { e.stopPropagation(); deleteScript(script) }}
                          className="text-gray-400 hover:text-red-600 px-1 py-1">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">No scripts yet</p>
            )}
          </div>
        </div>
      </div>

      {showScriptEditor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto dark:bg-slate-900">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingScript ? 'Edit Script' : 'New Script'}</h2>
              <button aria-label="Close" onClick={() => setShowScriptEditor(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Script Name</label>
                <input value={scriptName} onChange={(e) => setScriptName(e.target.value)}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Hail Damage — Standard" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={scriptIsDefault} onChange={(e) => setScriptIsDefault(e.target.checked)} id="isDefault" />
                <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-slate-200">Set as default script</label>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Steps</label>
                <div className="space-y-3 mt-2">
                  {scriptSteps.map((step, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Step {i + 1}</span>
                        {scriptSteps.length > 1 && (
                          <button aria-label="Remove step" onClick={() => setScriptSteps((prev) => prev.filter((_, j) => j !== i))}
                            className="text-xs text-red-500 dark:text-red-400"><Trash2 size={12} /></button>
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
                  <button onClick={() => setScriptSteps((prev) => [...prev, { title: '', body: '', tips: '' }])}
                    className="w-full py-2 border-2 border-dashed rounded-lg text-sm text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-100 hover:border-orange-300">
                    + Add Step
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowScriptEditor(false)}
                  className="flex-1 py-2.5 border rounded-xl text-sm font-medium">Cancel</button>
                <button onClick={saveScript}
                  className="flex-1 py-2.5 bg-orange-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
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
