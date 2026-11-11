// Lead Map (parity tier 2 #8; server crm/leads/leadMap.ts, GET /api/lead-map): the enquiries this seat reads, pinned where they
// are — the shared pin map (@twomiah/tenant-ui maps/PinMap, roofing's canvassing map). A pin's colour is the enquiry's state; its
// popup names who, what and where. Enquiries with no place yet are counted under the map, with why.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPin } from 'lucide-react'
import PinMap, { type Pin } from '@twomiah/tenant-ui/src/maps/PinMap'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { api } from '../../api'

interface LeadPin { id: string; name: string; status: string; jobType: string | null; location: string | null; receivedAt: string; lat: number; lng: number }
interface MapData { pins: LeadPin[]; notFound: number; noPlace: number; waiting: number; lookups: boolean }

/** Each state's pin colour and word (fixed colours: the pins sit on the map's own tiles in both themes). */
const STATES: Record<string, { color: string; word: string }> = {
  new: { color: '#2563eb', word: 'New' },
  contacted: { color: '#f59e0b', word: 'Contacted' },
  converted: { color: '#16a34a', word: 'Won' },
  lost: { color: '#6b7280', word: 'Lost' },
}
const stateOf = (s: string) => STATES[s] ?? { color: '#6b7280', word: 'Other' }

export default function LeadMapPage() {
  const [all, setAll] = useState(false)
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    api.get('/api/lead-map', all ? { show: 'all' } : undefined)
      .then((d: MapData) => { if (live) setData(d) })
      .catch((e: Error) => { if (live) setError(e.message || 'The lead map could not be loaded.') })
    return () => { live = false }
  }, [all])

  const pins: Pin[] = useMemo(() => (data?.pins || []).map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, color: stateOf(p.status).color, title: p.name,
    lines: [[stateOf(p.status).word, p.jobType].filter(Boolean).join(' · '), p.location || '', `Came in ${momentDate(p.receivedAt, { month: 'short', day: 'numeric', year: 'numeric' })}`].filter(Boolean),
  })), [data])

  const unplaced = data ? [
    data.waiting ? `${data.waiting} still to be placed${data.lookups ? ' (more are placed each time the map opens)' : ' (no map key is set up yet)'}` : '',
    data.notFound ? `${data.notFound} whose location couldn't be found` : '',
    data.noPlace ? `${data.noPlace} with no location given` : '',
  ].filter(Boolean) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MapPin className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> Lead Map</h1>
          <p className="mt-1 text-gray-600 dark:text-slate-300">Your enquiries where they are, from the location each one gave. Open one in the <Link to="/crm/leads" className="text-orange-700 underline dark:text-orange-300">Lead Inbox</Link>.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4" />
          Include won and lost
        </label>
      </div>

      <ul className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-slate-300" aria-label="What the colours mean">
        {Object.entries(STATES).filter(([k]) => all || k === 'new' || k === 'contacted').map(([k, s]) => (
          <li key={k} className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: s.color }} aria-hidden="true" />{s.word}</li>
        ))}
      </ul>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {!data && !error && <div className="flex h-80 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>}
      {data && (
        <>
          <PinMap api={api} pins={pins} tiles="roadmap" zoom={11} className="h-[32rem] rounded-xl border border-gray-200 dark:border-slate-700" />
          <p className="text-sm text-gray-600 dark:text-slate-300">
            {pins.length} {pins.length === 1 ? 'enquiry' : 'enquiries'} on the map{unplaced.length ? `; not on it: ${unplaced.join(', ')}.` : '.'}
          </p>
        </>
      )}
    </div>
  )
}
