// Moved from templates/crm/frontend/src/pages/DrawSchedulesPage.tsx.
/**
 * Draw Schedules Page — Construction tier
 * Construction loan draw schedule + individual draw requests.
 */
import { useState, useEffect } from 'react'
import { DollarSign, Plus, Check, X } from 'lucide-react'
import { api } from '../../api'
import { useAuth, usePrompt, useToast, errorText, PageLoading } from '../../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  active: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  completed: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  cancelled: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
};
const REQ_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  submitted: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  approved: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  paid: 'bg-emerald-100 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40',
  rejected: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
};

export default function DrawSchedulesPage() {
  // Projects is its own feature: with it off, /api/projects refuses — the page goes on with no projects to pick.
  const { hasFeature, can } = useAuth()
  const projectsOn = hasFeature('projects')
  // Each control asks what its route asks (server/crm/projects/drawSchedules.ts): a new schedule or draw is
  // draw-schedules:create; submit, approve, reject and mark paid are draw-schedules:update (live role check sweep, 2026-10-23).
  const mayCreate = can('draw-schedules:create')
  const mayUpdate = can('draw-schedules:update')
  const prompt = usePrompt()
  const toast = useToast()
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDraw, setShowDraw] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({ projectId: '', name: '', totalAmount: '', retainagePercent: '10', lenderName: '', lenderContact: '', notes: '' });
  const [drawForm, setDrawForm] = useState({ amountRequested: '' });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      // Projects is its own module; switched off it answers 403 and the page simply offers no project.
      const [{ data }, projRes] = await Promise.all([api.get('/api/draw-schedules'), (projectsOn ? api.get('/api/projects') : Promise.resolve({ data: [] })).catch(() => ({ data: [] }))]);
      setSchedules(data || []); setProjects(projRes.data || projRes || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const createSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/draw-schedules', { ...form, totalAmount: Number(form.totalAmount), retainagePercent: Number(form.retainagePercent || 0) });
    } catch (err) { toast.error(errorText(err, 'The schedule could not be created')); return; }
    setShowCreate(false); setForm({ projectId: '', name: '', totalAmount: '', retainagePercent: '10', lenderName: '', lenderContact: '', notes: '' });
    load();
  };

  const createDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    // The API takes the schedule and the gross amount. The template sent drawScheduleId and amountRequested, which it
    // refused, so no draw request could be made from this screen.
    try {
      await api.post('/api/draw-schedules/requests', { scheduleOfValuesId: selected.id, grossAmount: Number(drawForm.amountRequested) });
    } catch (err) { toast.error(errorText(err, 'The draw could not be created')); return; }
    setShowDraw(false); setDrawForm({ amountRequested: '' });
    loadDetail(selected.id);
  };

  const loadDetail = async (id: string) => { const r = await api.get(`/api/draw-schedules/${id}`); setSelected(r); load(); };

  /**
   * A draw moves draft → submitted → approved (or rejected, and resubmitted) → paid, as the server records it
   * (server/crm/projects/drawSchedules.ts). Approving asks for optional notes and rejecting for the reason — what the
   * server keeps (approval_notes, rejection_reason); backing out of either does nothing. The template asked for an
   * "approved amount" in the browser's own box, which no column holds, and a Cancel there approved the draw anyway.
   */
  const drawAction = async (id: string, action: 'submit' | 'approve' | 'reject' | 'mark-paid') => {
    let notes: string | undefined
    if (action === 'approve' || action === 'reject') {
      const answer = await prompt(action === 'approve' ? 'Approval notes (optional):' : 'Why is this draw rejected?', {
        title: action === 'approve' ? 'Approve draw' : 'Reject draw', confirmText: action === 'approve' ? 'Approve' : 'Reject',
      })
      if (answer === null) return
      if (action === 'reject' && !answer.trim()) { toast.error('Give the reason — it is what the draw record shows later'); return }
      notes = answer.trim() || undefined
    }
    try {
      await api.post(`/api/draw-schedules/requests/${id}/${action}`, notes ? { notes } : {});
    } catch (e) { toast.error(errorText(e, 'The draw could not be updated')); }
    if (selected) loadDetail(selected.id);
  };

  if (loading) return <PageLoading what="your draw schedules" />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6 text-orange-500 dark:text-orange-200" />Draw Schedules</h1><p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Track construction loan draws against project milestones</p></div>
        {mayCreate && <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Schedule</button>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {schedules.length === 0 && <div className="bg-white rounded-lg border p-6 text-center text-gray-500 dark:text-slate-400 text-sm dark:bg-slate-900">No draw schedules yet.</div>}
          {schedules.map((s) => (
            <button key={s.id} onClick={() => loadDetail(s.id)} className={`w-full text-left bg-white dark:bg-slate-900 rounded-lg border p-4 hover:shadow ${selected?.id === s.id ? 'border-orange-500 shadow' : ''}`}>
              <div className="flex items-start justify-between">
                <div><div className="font-semibold">{s.name}</div><div className="text-xs text-gray-500 mt-1 dark:text-slate-400">{s.lenderName || 'No lender'}</div></div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}>{codeLabel(s.status)}</span>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">Total</span><span className="font-mono">{money(Number(s.totalAmount))}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">Drawn</span><span className="font-mono text-green-700 dark:text-green-300">{money(Number(s.drawnAmount || 0))}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">Remaining</span><span className="font-mono">{money(Number(s.remainingAmount || s.totalAmount))}</span></div>
              </div>
              <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">{s.drawCount || 0} draws</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-white rounded-lg border dark:bg-slate-900">
              <div className="p-4 border-b flex items-center justify-between">
                <div><h2 className="font-bold">{selected.name}</h2><div className="text-sm text-gray-500 dark:text-slate-400">{selected.lenderName}</div></div>
                {mayCreate && <button onClick={() => setShowDraw(true)} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"><Plus className="w-3 h-3" />Draw</button>}
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b dark:bg-slate-900"><tr className="text-left text-xs font-semibold text-gray-500 uppercase dark:text-slate-400"><th className="px-4 py-3">#</th><th className="px-4 py-3">Gross</th><th className="px-4 py-3">Retainage</th><th className="px-4 py-3">Net</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
                <tbody>
                  {(selected.requests || []).length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No draws yet.</td></tr> :
                    selected.requests.map((r: any) => (
                      <tr key={r.id} className="border-b">
                        <td className="px-4 py-3 font-mono text-sm">#{r.drawNumber}</td>
                        {/* The draw's own columns (gross, retainage, net). The template read amountRequested,
                            amountApproved and percentComplete, which no draw carries — every row printed $NaN. */}
                        <td className="px-4 py-3 font-mono text-sm">{money(Number(r.grossAmount))}</td>
                        <td className="px-4 py-3 font-mono text-sm">{money(Number(r.retainageAmount))}</td>
                        <td className="px-4 py-3 font-mono text-sm">{money(Number(r.netAmount))}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${REQ_STATUS_COLORS[r.status]}`}>{codeLabel(r.status)}</span></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {mayUpdate && (r.status === 'draft' || r.status === 'rejected') && <button onClick={() => drawAction(r.id, 'submit')} className="text-orange-700 hover:bg-orange-50 p-1 rounded text-xs dark:text-orange-200">Submit</button>}
                            {mayUpdate && r.status === 'submitted' && <button aria-label="Approve" onClick={() => drawAction(r.id, 'approve')} className="text-green-700 hover:bg-green-50 p-1 rounded dark:text-green-300"><Check className="w-4 h-4" /></button>}
                            {mayUpdate && r.status === 'submitted' && <button aria-label="Reject" onClick={() => drawAction(r.id, 'reject')} className="text-red-600 hover:bg-red-50 p-1 rounded dark:text-red-400 dark:hover:bg-red-950/40"><X className="w-4 h-4" /></button>}
                            {mayUpdate && r.status === 'approved' && <button onClick={() => drawAction(r.id, 'mark-paid')} className="text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 p-1 rounded text-xs">Mark Paid</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : <div className="bg-white rounded-lg border p-12 text-center text-gray-500 dark:text-slate-400 dark:bg-slate-900">Select a draw schedule to view its draws</div>}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 dark:bg-slate-900">
            <h2 className="text-xl font-bold mb-4">New Draw Schedule</h2>
            <form onSubmit={createSchedule} className="space-y-3">
              <select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full border rounded-lg px-3 py-2"><option value="">Select project...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input required placeholder="Schedule name (e.g., Main construction loan)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input required type="number" step="0.01" placeholder="Total loan amount" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <label className="block text-sm text-gray-600 dark:text-slate-300">Retainage held back from each draw (%)
                <input required type="number" min="0" max="100" step="0.01" value={form.retainagePercent} onChange={(e) => setForm({ ...form, retainagePercent: e.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2" />
              </label>
              <input placeholder="Lender name" value={form.lenderName} onChange={(e) => setForm({ ...form, lenderName: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Lender contact (email/phone)" value={form.lenderContact} onChange={(e) => setForm({ ...form, lenderContact: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}

      {showDraw && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6 dark:bg-slate-900">
            <h2 className="text-xl font-bold mb-4">New Draw Request</h2>
            <form onSubmit={createDraw} className="space-y-3">
              <input required type="number" step="0.01" placeholder="Amount requested" value={drawForm.amountRequested} onChange={(e) => setDrawForm({ ...drawForm, amountRequested: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowDraw(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create Draw</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
