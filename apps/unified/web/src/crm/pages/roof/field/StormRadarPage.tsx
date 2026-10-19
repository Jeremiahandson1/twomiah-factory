/**
 * Storm Radar — moved from templates/crm-roof/frontend/src/pages/roofing/StormRadarPage.tsx. Weather events overlaid on
 * the customer base, at /api/storm-radar (server/crm/roof/field/stormRadar.ts, the storm_radar_overlay feature).
 *
 * Shows the provider's status at the top; once configured, the recent events and the contacts matched to them.
 *
 * Changes from the template:
 *   · /events and /matches are { data, pagination };
 *   · a failed sync shows the server's sentence ({ error, code: 'not_configured' | 'sync_failed' }), and every result is
 *     a toast where the template used window.alert; a failed match or status change says so (the template dropped it);
 *   · a match's contact links to /crm/contacts/:id, where the template printed the first eight characters of its id;
 *   · "Not interested" reads at contrast in both themes (it was gray-400 on gray-100, with no dark pair); the Sync button
 *     stays orange when disabled, faded (white on gray-300 was unreadable).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, Radio, RefreshCw } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { listOf } from './http'

const SEVERITY_COLORS: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  moderate: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  severe: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
  extreme: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
}

const MATCH_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  contacted: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
  quoted: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  booked: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  not_interested: 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800',
}

interface RadarStatus { provider: string; configured: boolean; message: string }

interface RadarEvent {
  id: string
  eventType: string | null
  severity: string | null
  city: string | null
  state: string | null
  zip: string | null
  hailSizeInches: string | number | null
  windSpeedMph: number | null
  startedAt: string | null
}

interface RadarMatch {
  id: string
  contactId: string
  /** Who the match is (GET /api/storm-radar/matches carries the contact's name). */
  contactName?: string | null
  distanceMiles: string | number | null
  status: string
  createdAt: string
}

export default function StormRadarPage() {
  // The server puts sync, match and the match decision all on storms:create — manager
  // and above. A crew reads the radar; it does not pull the feed or claim a match. (T42)
  const mayWorkStorms = useMayWrite('storms:create')
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [status, setStatus] = useState<RadarStatus | null>(null)
  const [events, setEvents] = useState<RadarEvent[]>([])
  const [matches, setMatches] = useState<RadarMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    // Settle each call independently — a not-yet-provisioned Storm Radar can make
    // events/matches fail, but status must still populate so we show honest copy
    // instead of a blank "provider: ." and a developer-facing setup message.
    const [s, e, m] = await Promise.allSettled([
      api.get('/api/storm-radar/status'),
      api.get('/api/storm-radar/events'),
      api.get('/api/storm-radar/matches'),
    ])
    if (s.status === 'fulfilled') setStatus(s.value as RadarStatus)
    if (e.status === 'fulfilled') setEvents(listOf<RadarEvent>(e.value))
    if (m.status === 'fulfilled') setMatches(listOf<RadarMatch>(m.value))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sync = async () => {
    setSyncing(true)
    try {
      const res = (await api.post('/api/storm-radar/sync', {})) as { fetchedCount?: number; insertedCount?: number }
      toastRef.current.success(`Synced: ${res.fetchedCount ?? 0} fetched, ${res.insertedCount ?? 0} new events.`)
      load()
    } catch (err) {
      // The server's sentence: "Storm Radar is not connected yet…" (not_configured) or "Could not sync…" (sync_failed).
      toastRef.current.error(errorText(err, 'Could not sync storm events.'))
    } finally { setSyncing(false) }
  }

  const matchEvent = async (eventId: string) => {
    try {
      const res = (await api.post(`/api/storm-radar/events/${encodeURIComponent(eventId)}/match`, {})) as { matchedCount?: number }
      toastRef.current.success(`Matched ${res.matchedCount ?? 0} contacts.`)
      load()
    } catch (err) {
      toastRef.current.error(errorText(err, 'Could not match contacts to this event.'))
    }
  }

  const updateMatchStatus = async (id: string, newStatus: string) => {
    try {
      await api.post(`/api/storm-radar/matches/${encodeURIComponent(id)}/status`, { status: newStatus })
    } catch (err) {
      toastRef.current.error(errorText(err, 'Could not change the status.'))
    }
    load()
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500 dark:text-orange-200" /></div>

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Radio className="w-6 h-6 text-orange-500 dark:text-orange-200" />Storm Radar</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Weather events overlaid on your customer base — drive storm-season lead generation</p>
        </div>
        {mayWorkStorms && (
          <button onClick={sync} disabled={syncing || !status?.configured} className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        )}
      </div>

      {!status?.configured && (
        <div className="mb-6 bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3 dark:bg-yellow-950/40">
          <AlertTriangle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5 dark:text-yellow-300" />
          <div>
            <div className="font-semibold text-yellow-900 dark:text-yellow-300">Storm Radar isn't turned on yet</div>
            <div className="text-sm text-yellow-800 mt-1 dark:text-yellow-300">Live storm tracking for your area isn't enabled on your account yet. Contact support to switch it on and start generating storm-season leads.</div>
          </div>
        </div>
      )}

      {status?.configured && (
        <div className="mb-6 bg-green-50 border border-green-300 rounded-lg p-3 text-sm text-green-800 dark:text-green-300 dark:bg-green-950/40">
          ✓ Storm Radar active using <strong>{status.provider}</strong>. Click "Sync Now" to pull the latest events.
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-x-auto mb-6 dark:bg-slate-900">
        <div className="p-4 border-b font-semibold">Recent Storm Events ({events.length})</div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-900"><tr className="text-left text-xs font-semibold text-gray-500 uppercase dark:text-slate-400"><th className="px-4 py-3">Type</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Hail</th><th className="px-4 py-3">Wind</th><th className="px-4 py-3">Started</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {events.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No storm events yet. {status?.configured ? 'Click "Sync Now" to pull events.' : 'Configure a weather provider to start pulling events.'}</td></tr> :
              events.map((e) => (
                <tr key={e.id} className="border-b hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3 text-sm font-semibold">{(e.eventType || '').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_COLORS[e.severity || ''] || 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'}`}>{e.severity || '—'}</span></td>
                  <td className="px-4 py-3 text-sm">{e.city ? `${e.city}, ` : ''}{e.state || ''} {e.zip || ''}</td>
                  <td className="px-4 py-3 text-sm">{e.hailSizeInches ? `${e.hailSizeInches}"` : '—'}</td>
                  <td className="px-4 py-3 text-sm">{e.windSpeedMph ? `${e.windSpeedMph} mph` : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">{e.startedAt ? formatDate(e.startedAt) : '—'}</td>
                  <td className="px-4 py-3">{mayWorkStorms && (<button onClick={() => matchEvent(e.id)} className="text-xs text-orange-600 hover:underline dark:text-orange-200">Match Contacts</button>)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto dark:bg-slate-900">
        <div className="p-4 border-b font-semibold">Storm Leads from Matches ({matches.length})</div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-900"><tr className="text-left text-xs font-semibold text-gray-500 uppercase dark:text-slate-400"><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Distance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Matched</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {matches.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No storm leads yet. Match a storm event to contacts to generate leads.</td></tr> :
              matches.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="px-4 py-3 text-sm">
                    <Link to={`/crm/contacts/${m.contactId}`} className="text-orange-600 hover:underline dark:text-orange-200">{m.contactName || 'View contact'}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm">{m.distanceMiles ? `${m.distanceMiles} mi` : '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${MATCH_STATUS_COLORS[m.status] || 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'}`}>{(m.status || '').replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">{formatDate(m.createdAt)}</td>
                  <td className="px-4 py-3">
                    <select aria-label="Match status" disabled={!mayWorkStorms} value={m.status} onChange={(e) => updateMatchStatus(m.id, e.target.value)} className="text-xs border rounded px-2 py-1">
                      <option value="new">New</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option><option value="booked">Booked</option><option value="not_interested">Not Interested</option>
                    </select>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
