// The storm map at /crm/storm-map (storm_customer_map — not ready): which of your past customers a storm hit, by where they
// are. Server: server/crm/roof/field/stormMap.ts (GET /api/storm-map/events/:id/customers, PUT .../path, POST /noaa-check)
// and the storm board's own POST /api/storms/events/:id/generate-leads, which reads the same drawn path.
//
// Draw the storm's path (click the corners on the map, or click a centre and give a radius), save it, and the list is the
// customers inside it. A customer with no pin on the map can only be matched by zip, and says so.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudLightning, Circle as CircleIcon, MapPinned, Pentagon, Undo2, Trash2, Zap } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { whenDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { listOf } from './http'
import ShapeMap, { type DrawnArea, type LatLng, type Shape } from './ShapeMap'
import type { Pin } from './PinMap'

interface StormEvent { id: string; eventDate: string; eventType: string; hailSizeInches: string | number | null; windSpeedMph: number | null; affectedZipCodes: string[] | null; source: string; path?: Shape | null }
interface Customer {
  contactId: string; name: string; phone: string | null; email: string | null; address: string | null; city: string | null; zip: string | null
  lat: number | null; lng: number | null; by: 'path' | 'zip'; located: boolean; pastCustomer: boolean
  job: { id: string; number: string | null; status: string; completedAt: string | null } | null
}
interface Summary { scope: string; matching: 'path' | 'zip'; matched: number; inPath: number; byZipOnly: number; customersLooked: number; onTheMap: number; notOnTheMap: number; truncated: boolean; note: string }

const yearsAgo = (iso: string | null) => {
  if (!iso) return null
  const y = (Date.now() - new Date(iso).getTime()) / (365.25 * 86400000)
  return y >= 0 && Number.isFinite(y) ? Math.floor(y) : null
}
const label = (e: StormEvent) => `${whenDate(e.eventDate)} · ${e.eventType}${e.hailSizeInches ? ` ${e.hailSizeInches}"` : ''}${e.windSpeedMph ? ` ${e.windSpeedMph} mph` : ''}${e.path ? ' · path drawn' : ''}`

export default function StormMapPage() {
  const mayDraw = useMayWrite('storms:update')
  const mayMakeLeads = useMayWrite('storms:create')
  const mayCheckNoaa = useMayWrite('storms:update')
  const mayAssign = useMayWrite('canvassing:manage')
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [events, setEvents] = useState<StormEvent[]>([])
  const [eventId, setEventId] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [scope, setScope] = useState<'past' | 'all'>('past')
  const [saved, setSaved] = useState<Shape | null>(null)
  const [mode, setMode] = useState<'off' | 'polygon' | 'circle'>('off')
  const [corners, setCorners] = useState<LatLng[]>([])
  const [centre, setCentre] = useState<LatLng | null>(null)
  const [radius, setRadius] = useState('2')
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState('2')

  const loadEvents = useCallback(async () => {
    try {
      const list = listOf<StormEvent>(await api.get('/api/storms/events'))
      setEvents(list)
      setEventId((cur) => cur || list[0]?.id || '')
    } catch (e) { toastRef.current.error(errorText(e, 'Could not load the storm board')) }
  }, [])
  useEffect(() => { loadEvents() }, [loadEvents])

  const loadCustomers = useCallback(async (id: string, s: 'past' | 'all') => {
    if (!id) { setCustomers([]); setSummary(null); setSaved(null); return }
    try {
      const r = (await api.get(`/api/storm-map/events/${encodeURIComponent(id)}/customers`, { scope: s })) as { data: Customer[]; summary: Summary; event: { path: Shape | null } }
      setCustomers(r.data || []); setSummary(r.summary); setSaved(r.event?.path ?? null)
    } catch (e) { toastRef.current.error(errorText(e, 'Could not load the customers')) }
  }, [])
  useEffect(() => { loadCustomers(eventId, scope) }, [eventId, scope, loadCustomers])

  const draft: Shape | null = mode === 'polygon' ? { kind: 'polygon', points: corners }
    : mode === 'circle' && centre ? { kind: 'circle', lat: centre[0], lng: centre[1], radiusMiles: Math.max(0.1, Number(radius) || 0.1) } : null
  const readyToSave = (mode === 'polygon' && corners.length >= 3) || (mode === 'circle' && !!centre && Number(radius) > 0)

  const stopDrawing = () => { setMode('off'); setCorners([]); setCentre(null) }
  const pick = (lat: number, lng: number) => {
    if (mode === 'polygon') setCorners((c) => [...c, [lat, lng]])
    else if (mode === 'circle') setCentre([lat, lng])
  }
  const savePath = async (shape: Shape | null) => {
    setBusy(true)
    try {
      await api.put(`/api/storm-map/events/${encodeURIComponent(eventId)}/path`, { path: shape })
      toast.success(shape ? 'Storm path saved' : 'Storm path removed')
      stopDrawing()
      await Promise.all([loadCustomers(eventId, scope), loadEvents()])
    } catch (e) { toast.error(errorText(e, 'Could not save the path')) } finally { setBusy(false) }
  }
  const makeLeads = async () => {
    setBusy(true)
    try {
      const r = (await api.post(`/api/storms/events/${encodeURIComponent(eventId)}/generate-leads`, {})) as { leadCount: number }
      toast.success(`${r.leadCount} lead${r.leadCount === 1 ? '' : 's'} made — they are on the Storm Leads board`)
    } catch (e) { toast.error(errorText(e, 'Could not make the leads')) } finally { setBusy(false) }
  }
  // The saved path becomes a canvass territory around this storm (the office then gives it to reps on Territories).
  const makeTerritory = async () => {
    const ev = events.find((e) => e.id === eventId)
    if (!ev || !saved) return
    setBusy(true)
    try {
      await api.post('/api/territories', { name: `Storm ${whenDate(ev.eventDate)} ${ev.eventType}`, boundary: saved, stormEventId: ev.id })
      toast.success('Territory made — open Territories to give it to your reps')
    } catch (e) { toast.error(errorText(e, 'Could not make the territory')) } finally { setBusy(false) }
  }
  const checkNoaa = async () => {
    setBusy(true)
    try {
      const r = (await api.post('/api/storm-map/noaa-check', { days: Number(days) })) as { message: string }
      toast.success(r.message)
      await loadEvents()
    } catch (e) { toast.error(errorText(e, 'Could not check the storm feed')) } finally { setBusy(false) }
  }

  const areas: DrawnArea[] = useMemo(() => (saved ? [{ id: 'path', shape: saved, color: '#2563eb', label: 'Storm path' }] : []), [saved])
  const pins: Pin[] = useMemo(() => customers.filter((c) => c.lat !== null && c.lng !== null).map((c) => ({
    id: c.contactId, lat: c.lat as number, lng: c.lng as number, color: c.by === 'path' ? '#dc2626' : '#f59e0b', title: c.name,
    lines: [c.address || '', c.job?.number ? `Job ${c.job.number}` : ''].filter(Boolean),
  })), [customers])

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CloudLightning size={24} /> Storm Map</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Which of your past customers a storm hit — draw where it fell.</p>
        </div>
        {mayCheckNoaa && (
          <div className="flex items-center gap-2">
            <select aria-label="Days to check" value={days} onChange={(e) => setDays(e.target.value)} className="border rounded-lg px-2 py-2 text-sm bg-white dark:bg-slate-900">
              {['1', '2', '3', '7', '14'].map((d) => <option key={d} value={d}>Last {d} day{d === '1' ? '' : 's'}</option>)}
            </select>
            <button onClick={checkNoaa} disabled={busy} className="px-3 py-2 rounded-lg border text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">Check NOAA now</button>
          </div>
        )}
      </div>

      {events.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No storms on the board yet. Add one under Storm Leads{mayCheckNoaa ? ', or check NOAA now' : ''}.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium" htmlFor="storm-pick">Storm</label>
            <select id="storm-pick" value={eventId} onChange={(e) => { stopDrawing(); setEventId(e.target.value) }} className="border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 min-w-64">
              {events.map((e) => <option key={e.id} value={e.id}>{label(e)}</option>)}
            </select>
            <div className="inline-flex rounded-lg border overflow-hidden text-sm" role="group" aria-label="Who to show">
              {(['past', 'all'] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} aria-pressed={scope === s} className={`px-3 py-2 ${scope === s ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900'}`}>{s === 'past' ? 'Past customers' : 'Everyone'}</button>
              ))}
            </div>
          </div>

          {mayDraw && (
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'off' ? (
                <>
                  <button onClick={() => setMode('polygon')} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><Pentagon size={16} /> Draw the path</button>
                  <button onClick={() => setMode('circle')} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><CircleIcon size={16} /> Circle</button>
                  {saved && mayAssign && <button onClick={makeTerritory} disabled={busy} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><MapPinned size={16} /> Make a territory from this path</button>}
                  {saved && <button onClick={() => savePath(null)} disabled={busy} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-red-600"><Trash2 size={16} /> Remove the path</button>}
                </>
              ) : (
                <>
                  <span className="text-sm text-gray-600 dark:text-slate-300">{mode === 'polygon' ? `Click the corners on the map (${corners.length} so far).` : centre ? 'Centre set — give the radius.' : 'Click the centre on the map.'}</span>
                  {mode === 'circle' && (
                    <label className="text-sm inline-flex items-center gap-1">Radius
                      <input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="decimal" className="border rounded px-2 py-1 w-16 bg-white dark:bg-slate-900" /> miles
                    </label>
                  )}
                  {mode === 'polygon' && <button onClick={() => setCorners((c) => c.slice(0, -1))} disabled={!corners.length} className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1"><Undo2 size={16} /> Undo</button>}
                  <button onClick={() => savePath(draft)} disabled={!readyToSave || busy} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">Save the path</button>
                  <button onClick={stopDrawing} className="px-3 py-2 rounded-lg border text-sm">Cancel</button>
                </>
              )}
            </div>
          )}

          <ShapeMap areas={areas} pins={pins} draft={draft} drawing={mode !== 'off'} onPick={pick} fit={mode === 'off'} className="h-96" />

          {summary && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div className="font-medium">
                {summary.matched} {scope === 'past' ? 'past customer' : 'customer'}{summary.matched === 1 ? '' : 's'}
                {summary.matching === 'path' ? ` — ${summary.inPath} inside the path, ${summary.byZipOnly} by zip only` : ' matched by zip'}
              </div>
              <div className="text-gray-600 dark:text-slate-300">{summary.note}</div>
              {summary.truncated && <div className="text-amber-700 dark:text-amber-300">Showing the first {customers.length}.</div>}
              {mayMakeLeads && summary.matched > 0 && (
                <button onClick={makeLeads} disabled={busy} className="mt-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50"><Zap size={16} /> Make leads from this storm</button>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-left"><tr><th className="p-2">Customer</th><th className="p-2">Address</th><th className="p-2">Job</th><th className="p-2">Roof</th><th className="p-2">Placed</th></tr></thead>
              <tbody>
                {customers.map((c) => {
                  const age = yearsAgo(c.job?.completedAt ?? null)
                  return (
                    <tr key={c.contactId} className="border-t">
                      <td className="p-2"><Link className="text-blue-600 hover:underline" to={`/crm/contacts/${c.contactId}`}>{c.name}</Link>{c.phone ? <div className="text-xs text-gray-500">{c.phone}</div> : null}</td>
                      <td className="p-2">{[c.address, c.city, c.zip].filter(Boolean).join(', ') || '—'}</td>
                      <td className="p-2">{c.job ? <Link className="text-blue-600 hover:underline" to={`/crm/jobs/${c.job.id}`}>{c.job.number || 'Job'}</Link> : '—'}</td>
                      <td className="p-2">{age !== null ? `${age} yr${age === 1 ? '' : 's'} old` : c.job?.completedAt ? formatDate(c.job.completedAt) : '—'}</td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs ${c.by === 'path' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>{c.by === 'path' ? 'Inside the path' : c.located ? 'By zip' : 'By zip only — no pin'}</span></td>
                    </tr>
                  )
                })}
                {customers.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-gray-500 dark:text-slate-400">No customers matched this storm.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
