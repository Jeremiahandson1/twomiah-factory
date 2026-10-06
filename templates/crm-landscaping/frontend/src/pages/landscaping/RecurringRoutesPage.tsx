import { useState, useEffect } from 'react';
import { Plus, Trash2, MapPin, Loader2, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useMayWrite } from '../../shared';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function RecurringRoutesPage() {
  const toast = useToast();
  /**
   * "Staff are shown Add Service/Edit, Add Equipment and New Route, which 403." (T41 landscaping)
   *
   * The route board's own API decides this, and it does not use a `routes:` resource — a mow route
   * IS recurring work, so src/routes/recurringRoutes.ts gates on the jobs verbs:
   *
   *   New Route     POST /                      jobs:create   ← staff do not hold this
   *   Delete route  DELETE /:id                 jobs:delete   ← nor this
   *   Add Stop      POST /:id/stops             jobs:update   ← staff DO hold it, and keep it
   *   Remove stop   DELETE /:id/stops/:stopId   jobs:update   ← likewise
   *
   * So the crew can still work the board they are standing on — reorder the day, drop a stop that
   * has been cancelled — and only building or scrapping a whole route goes. Hiding Add Stop as well
   * would have been the easy over-correction and would have made the page read-only for the people
   * who actually run the route.
   */
  const mayCreateRoute = useMayWrite('jobs:create');
  const mayDeleteRoute = useMayWrite('jobs:delete');
  const [board, setBoard] = useState<any[]>([]);
  /**
   * Routes stored against something that is not a day of the week. (T58)
   *
   * The board is built from the seven day columns, so a route on day 9 — which the old write path
   * accepted without a word — matched no column and was simply not on the screen, with its stops and
   * its weekly revenue. The server now hands those back separately rather than leaving them out, and
   * this is where they get said: a crew's day missing from the board they work off is worse than a
   * refusal, and worst of all when nothing mentions it.
   */
  const [unscheduled, setUnscheduled] = useState<any[]>([]);
  const [unscheduledNote, setUnscheduledNote] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({ name: '', dayOfWeek: 1, estimatedHours: '', notes: '' });
  const [stopForm, setStopForm] = useState<any>({ siteId: '', serviceType: 'mowing', estimatedMinutes: 30, pricePerVisit: '' });

  const loadBoard = async () => {
    try {
      const res = await api.get('/api/recurring-routes/board');
      setBoard(res.data || []);
      setUnscheduled(Array.isArray(res.unscheduled) ? res.unscheduled : []);
      setUnscheduledNote(typeof res.unscheduledNote === 'string' ? res.unscheduledNote : '');
    } catch { toast.error('Failed to load route board'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadBoard(); }, []);

  const openRoute = async (id: string) => {
    try {
      const res = await api.get(`/api/recurring-routes/${id}`);
      setSelected(id); setDetail(res);
    } catch { toast.error('Failed to load route'); }
  };

  const createRoute = async () => {
    if (!form.name) { toast.error('Route name required'); return; }
    try {
      await api.post('/api/recurring-routes', form);
      toast.success('Route created');
      setShowForm(false); setForm({ name: '', dayOfWeek: 1, estimatedHours: '', notes: '' });
      loadBoard();
    } catch (e: any) { toast.error(e?.message || 'Failed to create route'); }
  };

  const deleteRoute = async (id: string) => {
    if (!confirm('Delete this route?')) return;
    try { await api.delete(`/api/recurring-routes/${id}`); toast.success('Deleted'); setSelected(null); setDetail(null); loadBoard(); }
    catch { toast.error('Failed to delete'); }
  };

  const addStop = async () => {
    if (!detail || !stopForm.siteId) { toast.error('Site ID required'); return; }
    try {
      await api.post(`/api/recurring-routes/${detail.id}/stops`, stopForm);
      toast.success('Stop added');
      setStopForm({ siteId: '', serviceType: 'mowing', estimatedMinutes: 30, pricePerVisit: '' });
      openRoute(detail.id); loadBoard();
    } catch (e: any) { toast.error(e?.message || 'Failed to add stop'); }
  };

  const removeStop = async (stopId: string) => {
    try { await api.delete(`/api/recurring-routes/${detail.id}/stops/${stopId}`); openRoute(detail.id); loadBoard(); }
    catch { toast.error('Failed to remove stop'); }
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="w-6 h-6" /> Recurring Route Board</h1>
          <p className="text-gray-500 text-sm dark:text-slate-400">Weekly mow routes grouped by day. Build a route, add property stops in visit order.</p>
        </div>
        {mayCreateRoute && <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-green-700 text-white rounded-lg px-4 py-2 text-sm"><Plus className="w-4 h-4" /> New Route</button>}
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 items-end dark:bg-slate-900">
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Route name (e.g. Monday A)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <select className="border rounded px-2 py-1.5 text-sm" value={form.dayOfWeek} onChange={e => setForm({ ...form, dayOfWeek: parseInt(e.target.value, 10) })}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Est. hours" value={form.estimatedHours} onChange={e => setForm({ ...form, estimatedHours: e.target.value })} />
          <button onClick={createRoute} className="bg-green-700 text-white rounded px-3 py-1.5 text-sm">Create</button>
        </div>
      )}

      <div className="grid md:grid-cols-7 gap-3 mb-6">
        {board.map(day => (
          <div key={day.dayOfWeek} className="min-w-0">
            <div className="text-xs font-semibold text-gray-500 mb-2 dark:text-slate-400">{day.dayName}</div>
            <div className="space-y-2">
              {day.routes.map((r: any) => (
                <div key={r.id} onClick={() => openRoute(r.id)}
                  className={`border rounded-lg p-2 bg-white cursor-pointer hover:shadow text-xs ${selected === r.id ? 'ring-2 ring-green-500' : ''} dark:bg-slate-900`}>
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-gray-500 flex items-center gap-1 mt-1 dark:text-slate-400"><MapPin className="w-3 h-3" />{r.stopCount} stops</div>
                  <div className="text-gray-500 flex items-center gap-1 dark:text-slate-400"><Clock className="w-3 h-3" />{Math.round(r.estimatedMinutes / 60 * 10) / 10}h</div>
                  <div className="text-green-700 flex items-center gap-1 dark:text-green-300"><DollarSign className="w-3 h-3" />{r.weeklyRevenue}</div>
                </div>
              ))}
              {day.routes.length === 0 && <div className="text-[11px] text-gray-300">—</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Routes the seven columns above cannot hold. Empty for any tenant that has only used this
          screen; the write path refuses these now, but rows already stored would otherwise stay
          invisible for ever. (T58) */}
      {unscheduled.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 mb-6 dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Not on any day</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">{unscheduledNote}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {unscheduled.map((r: any) => (
                  <div key={r.id} onClick={() => openRoute(r.id)}
                    className={`border rounded-lg p-2 bg-white cursor-pointer hover:shadow text-xs min-w-0 ${selected === r.id ? 'ring-2 ring-green-500' : ''} dark:bg-slate-900`}>
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-gray-500 flex items-center gap-1 mt-1 dark:text-slate-400"><MapPin className="w-3 h-3" />{r.stopCount} stops</div>
                    <div className="text-gray-500 flex items-center gap-1 dark:text-slate-400"><Clock className="w-3 h-3" />{Math.round(r.estimatedMinutes / 60 * 10) / 10}h</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="font-semibold">{detail.name} <span className="text-sm text-gray-500 dark:text-slate-400">· {detail.dayName}</span></h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">{detail.stops?.length || 0} stops</p>
            </div>
            {mayDeleteRoute && <button onClick={() => deleteRoute(detail.id)} className="text-red-600 flex items-center gap-1 text-sm dark:text-red-400"><Trash2 className="w-4 h-4" /> Delete route</button>}
          </div>

          <div className="space-y-1 mb-4">
            {(detail.stops || []).map((s: any, i: number) => (
              <div key={s.id} className="flex justify-between items-center text-sm border-b py-2">
                <span><span className="text-gray-500 dark:text-slate-400 mr-2">{i + 1}.</span>{s.siteName || s.siteId} <span className="text-gray-500 dark:text-slate-400">· {s.serviceType} · {s.estimatedMinutes}min</span></span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">${Number(s.pricePerVisit).toFixed(2)}</span>
                  <button onClick={() => removeStop(s.id)} className="text-red-500 dark:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </span>
              </div>
            ))}
            {(detail.stops || []).length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No stops yet.</p>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end border-t pt-3">
            <input className="border rounded px-2 py-1.5 text-sm" placeholder="Site ID" value={stopForm.siteId} onChange={e => setStopForm({ ...stopForm, siteId: e.target.value })} />
            <input className="border rounded px-2 py-1.5 text-sm" placeholder="Service" value={stopForm.serviceType} onChange={e => setStopForm({ ...stopForm, serviceType: e.target.value })} />
            <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Minutes" value={stopForm.estimatedMinutes} onChange={e => setStopForm({ ...stopForm, estimatedMinutes: e.target.value })} />
            <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Price/visit" value={stopForm.pricePerVisit} onChange={e => setStopForm({ ...stopForm, pricePerVisit: e.target.value })} />
            <button onClick={addStop} className="bg-green-700 text-white rounded px-3 py-1.5 text-sm">Add Stop</button>
          </div>
        </div>
      )}
    </div>
  );
}
