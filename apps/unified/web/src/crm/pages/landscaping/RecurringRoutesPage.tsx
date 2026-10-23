// Moved from templates/crm-landscaping/frontend/src/pages/landscaping/RecurringRoutesPage.tsx.
//
// Fixed while moving: a stop's property was a free-text "Site ID" box — the operator had to type a property's internal
// id, which nothing on the screen showed. It is the property picker Snow Billing and Area Pricing use (T14 M7's fix,
// never carried to this page).
import { useState, useEffect } from 'react'
import { Plus, Trash2, MapPin, Loader2, Clock, DollarSign, AlertTriangle } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite } from '../../../shared'
import { SitePicker, useSites } from './SitePicker'
import { money } from '@twomiah/tenant-ui/src/money'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** A route card on the board (GET /api/recurring-routes/board). `weeklyRevenue` is absent without invoices:read. */
interface RouteCard {
  id: string;
  name: string;
  dayOfWeek: number;
  stopCount: number;
  estimatedMinutes: number;
  weeklyRevenue?: number;
}

interface BoardDay { dayOfWeek: number; dayName: string; routes: RouteCard[] }

/** GET /api/recurring-routes/board: the week's seven columns, and any route stored on no day of the week. */
interface Board { data?: BoardDay[]; unscheduled?: RouteCard[]; unscheduledNote?: string }

/** A stop of GET /api/recurring-routes/:id. `pricePerVisit` is absent without invoices:read. */
interface Stop {
  id: string;
  siteId: string;
  siteName?: string | null;
  serviceType: string;
  estimatedMinutes: number;
  pricePerVisit?: string | number;
}

interface RouteDetail { id: string; name: string; dayName: string; stops?: Stop[] }

type RouteForm = { name: string; dayOfWeek: number; estimatedHours: string; notes: string }
type StopForm = { siteId: string; serviceType: string; estimatedMinutes: string; pricePerVisit: string }

const EMPTY_ROUTE: RouteForm = { name: '', dayOfWeek: 1, estimatedHours: '', notes: '' }
const EMPTY_STOP: StopForm = { siteId: '', serviceType: 'mowing', estimatedMinutes: '30', pricePerVisit: '' }

/** The server's own words when it refused (the API client puts its `error` on `.message`), else the fallback. */
const serverMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const hours = (minutes: number) => Math.round(minutes / 60 * 10) / 10

export default function RecurringRoutesPage() {
  const toast = useToast()
  const confirm = useConfirm()
  /**
   * The route board's API asks the jobs verbs (a mow route IS recurring work): New Route jobs:create, Delete route
   * jobs:delete, Add / Remove stop jobs:update. Staff hold jobs:update, so the crew can still work the board they are
   * standing on; only building or scrapping a whole route goes. (T41)
   */
  const mayCreateRoute = useMayWrite('jobs:create')
  const mayDeleteRoute = useMayWrite('jobs:delete')
  const mayEditStops = useMayWrite('jobs:update')
  // A stop's price and the week's total are money (invoices:read); the server withholds both from staff. (T62)
  const maySeeMoney = useMayWrite('invoices:read')
  const [board, setBoard] = useState<BoardDay[]>([])
  /**
   * Routes stored against something that is not a day of the week (T58): the board is built from seven columns, so
   * the server hands those back separately and this is where they are said.
   */
  const [unscheduled, setUnscheduled] = useState<RouteCard[]>([])
  const [unscheduledNote, setUnscheduledNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<RouteDetail | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RouteForm>(EMPTY_ROUTE)
  const [stopForm, setStopForm] = useState<StopForm>(EMPTY_STOP)
  const { sites, reloadSites } = useSites()

  const loadBoard = async () => {
    try {
      const res = await api.get('/api/recurring-routes/board') as Board
      setBoard(Array.isArray(res?.data) ? res.data : [])
      setUnscheduled(Array.isArray(res?.unscheduled) ? res.unscheduled : [])
      setUnscheduledNote(typeof res?.unscheduledNote === 'string' ? res.unscheduledNote : '')
    } catch (error) { toast.error(serverMessage(error, 'Failed to load route board')) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadBoard() }, [])

  const openRoute = async (id: string) => {
    try {
      const res = await api.get(`/api/recurring-routes/${id}`) as RouteDetail
      setSelected(id); setDetail(res)
    } catch (error) { toast.error(serverMessage(error, 'Failed to load route')) }
  }

  const createRoute = async () => {
    if (!form.name) { toast.error('Route name required'); return }
    try {
      await api.post('/api/recurring-routes', form)
      toast.success('Route created')
      setShowForm(false); setForm(EMPTY_ROUTE)
      loadBoard()
    } catch (error) { toast.error(serverMessage(error, 'Failed to create route')) }
  }

  const deleteRoute = async (id: string) => {
    if (!(await confirm('Its stops go with it.', { title: 'Delete this route?', confirmText: 'Delete route' }))) return
    try { await api.delete(`/api/recurring-routes/${id}`); toast.success('Deleted'); setSelected(null); setDetail(null); loadBoard() }
    catch (error) { toast.error(serverMessage(error, 'Failed to delete')) }
  }

  const addStop = async () => {
    if (!detail || !stopForm.siteId) { toast.error('Pick the property to add'); return }
    try {
      await api.post(`/api/recurring-routes/${detail.id}/stops`, stopForm)
      toast.success('Stop added')
      setStopForm(EMPTY_STOP)
      openRoute(detail.id); loadBoard()
    } catch (error) { toast.error(serverMessage(error, 'Failed to add stop')) }
  }

  const removeStop = async (stopId: string) => {
    if (!detail) return
    try { await api.delete(`/api/recurring-routes/${detail.id}/stops/${stopId}`); openRoute(detail.id); loadBoard() }
    catch (error) { toast.error(serverMessage(error, 'Failed to remove stop')) }
  }

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>

  const card = (r: RouteCard, extra = '') => (
    <button type="button" key={r.id} onClick={() => openRoute(r.id)}
      className={`w-full text-left border dark:border-slate-700 rounded-lg p-2 bg-white cursor-pointer hover:shadow text-xs min-w-0 ${selected === r.id ? 'ring-2 ring-green-500' : ''} dark:bg-slate-900 ${extra}`}>
      <div className="font-medium truncate">{r.name}</div>
      <div className="text-gray-500 flex items-center gap-1 mt-1 dark:text-slate-400"><MapPin className="w-3 h-3" />{r.stopCount} stops</div>
      <div className="text-gray-500 flex items-center gap-1 dark:text-slate-400"><Clock className="w-3 h-3" />{hours(r.estimatedMinutes)}h</div>
      {/* Absent for a seat that may not see money (T62) — no "$0" in its place. */}
      {r.weeklyRevenue !== undefined && <div className="text-green-700 flex items-center gap-1 dark:text-green-300"><DollarSign className="w-3 h-3" />{r.weeklyRevenue}</div>}
    </button>
  )

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="w-6 h-6" /> Recurring Route Board</h1>
          <p className="text-gray-500 text-sm dark:text-slate-400">Weekly mow routes grouped by day. Build a route, add property stops in visit order.</p>
        </div>
        {mayCreateRoute && <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> New Route</button>}
      </div>

      {showForm && (
        <div className="bg-white border dark:border-slate-700 rounded-lg p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 items-end dark:bg-slate-900">
          <input className="input" aria-label="Route name" placeholder="Route name (e.g. Monday A)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" aria-label="Day" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: parseInt(e.target.value, 10) })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <input className="input" aria-label="Estimated hours" type="number" placeholder="Est. hours" value={form.estimatedHours} onChange={(e) => setForm({ ...form, estimatedHours: e.target.value })} />
          <button onClick={createRoute} className="btn-primary">Create</button>
        </div>
      )}

      <div className="grid md:grid-cols-7 gap-3 mb-6">
        {board.map((day) => (
          <div key={day.dayOfWeek} className="min-w-0">
            <div className="text-xs font-semibold text-gray-500 mb-2 dark:text-slate-400">{day.dayName}</div>
            <div className="space-y-2">
              {day.routes.map((r) => card(r))}
              {day.routes.length === 0 && <div className="text-[11px] text-gray-600 dark:text-slate-300">—</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Routes the seven columns above cannot hold; empty for any company that has only used this screen. (T58) */}
      {unscheduled.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 mb-6 dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Not on any day</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">{unscheduledNote}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {unscheduled.map((r) => card(r, 'w-auto'))}
              </div>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="bg-white border dark:border-slate-700 rounded-lg p-5 dark:bg-slate-900">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="font-semibold">{detail.name} <span className="text-sm text-gray-500 dark:text-slate-400">· {detail.dayName}</span></h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">{detail.stops?.length || 0} stops</p>
            </div>
            {mayDeleteRoute && <button onClick={() => deleteRoute(detail.id)} className="text-red-600 flex items-center gap-1 text-sm dark:text-red-400"><Trash2 className="w-4 h-4" /> Delete route</button>}
          </div>

          <div className="space-y-1 mb-4">
            {(detail.stops || []).map((s, i) => (
              <div key={s.id} className="flex justify-between items-center text-sm border-b dark:border-slate-700 py-2">
                <span><span className="text-gray-500 dark:text-slate-400 mr-2">{i + 1}.</span>{s.siteName || s.siteId} <span className="text-gray-500 dark:text-slate-400">· {s.serviceType} · {s.estimatedMinutes}min</span></span>
                <span className="flex items-center gap-3">
                  {s.pricePerVisit !== undefined && <span className="font-medium">{money(Number(s.pricePerVisit))}</span>}
                  {mayEditStops && <button aria-label="Remove stop" onClick={() => removeStop(s.id)} className="text-red-500 dark:text-red-400"><Trash2 className="w-4 h-4" /></button>}
                </span>
              </div>
            ))}
            {(detail.stops || []).length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No stops yet.</p>}
          </div>

          {mayEditStops && <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end border-t dark:border-slate-700 pt-3">
            <div className="col-span-2">
              <label htmlFor="route-stop-site" className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Property</label>
              <SitePicker id="route-stop-site" value={stopForm.siteId} sites={sites} onAdded={reloadSites} onChange={(siteId) => setStopForm({ ...stopForm, siteId })} />
            </div>
            <input className="input" aria-label="Service" placeholder="Service" value={stopForm.serviceType} onChange={(e) => setStopForm({ ...stopForm, serviceType: e.target.value })} />
            <input className="input" aria-label="Minutes" type="number" placeholder="Minutes" value={stopForm.estimatedMinutes} onChange={(e) => setStopForm({ ...stopForm, estimatedMinutes: e.target.value })} />
            {maySeeMoney && <input className="input" aria-label="Price per visit" type="number" placeholder="Price/visit" value={stopForm.pricePerVisit} onChange={(e) => setStopForm({ ...stopForm, pricePerVisit: e.target.value })} />}
            <button onClick={addStop} className="btn-primary">Add Stop</button>
          </div>}
        </div>
      )}
    </div>
  )
}
