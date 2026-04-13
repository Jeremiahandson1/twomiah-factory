/**
 * Draw Schedules Page — Construction tier
 * Construction loan draw schedule + individual draw requests.
 */
import { useState, useEffect } from 'react';
import { DollarSign, Plus, Check, Loader2 } from 'lucide-react';
import api from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};
const REQ_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  paid: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function DrawSchedulesPage() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDraw, setShowDraw] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({ projectId: '', name: '', totalAmount: 0, lenderName: '', lenderContact: '', notes: '' });
  const [drawForm, setDrawForm] = useState({ amountRequested: 0, percentComplete: 0, notes: '' });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const [{ data }, projRes] = await Promise.all([api.get('/api/draw-schedules'), api.get('/api/projects')]);
      setSchedules(data || []); setProjects(projRes.data || projRes || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const createSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/draw-schedules', { ...form, totalAmount: Number(form.totalAmount) });
    setShowCreate(false); setForm({ projectId: '', name: '', totalAmount: 0, lenderName: '', lenderContact: '', notes: '' });
    load();
  };

  const createDraw = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/draw-schedules/requests', { ...drawForm, amountRequested: Number(drawForm.amountRequested), percentComplete: Number(drawForm.percentComplete), drawScheduleId: selected.id });
    setShowDraw(false); setDrawForm({ amountRequested: 0, percentComplete: 0, notes: '' });
    loadDetail(selected.id);
  };

  const loadDetail = async (id: string) => { const r = await api.get(`/api/draw-schedules/${id}`); setSelected(r); load(); };

  const drawAction = async (id: string, action: string) => {
    const amountApproved = action === 'approve' ? Number(prompt('Approved amount:') || 0) : undefined;
    await api.post(`/api/draw-schedules/requests/${id}/${action}`, { amountApproved });
    if (selected) loadDetail(selected.id);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6 text-orange-500" />Draw Schedules</h1><p className="text-sm text-gray-500 mt-1">Track construction loan draws against project milestones</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Schedule</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {schedules.length === 0 && <div className="bg-white rounded-lg border p-6 text-center text-gray-400 text-sm">No draw schedules yet.</div>}
          {schedules.map((s) => (
            <button key={s.id} onClick={() => loadDetail(s.id)} className={`w-full text-left bg-white rounded-lg border p-4 hover:shadow ${selected?.id === s.id ? 'border-orange-500 shadow' : ''}`}>
              <div className="flex items-start justify-between">
                <div><div className="font-semibold">{s.name}</div><div className="text-xs text-gray-500 mt-1">{s.lenderName || 'No lender'}</div></div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s.status]}`}>{s.status}</span>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Total</span><span className="font-mono">${Number(s.totalAmount).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Drawn</span><span className="font-mono text-green-600">${Number(s.drawnAmount || 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Remaining</span><span className="font-mono">${Number(s.remainingAmount || s.totalAmount).toLocaleString()}</span></div>
              </div>
              <div className="mt-2 text-xs text-gray-500">{s.drawCount || 0} draws</div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {selected ? (
            <div className="bg-white rounded-lg border">
              <div className="p-4 border-b flex items-center justify-between">
                <div><h2 className="font-bold">{selected.name}</h2><div className="text-sm text-gray-500">{selected.lenderName}</div></div>
                <button onClick={() => setShowDraw(true)} className="bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1"><Plus className="w-3 h-3" />Draw</button>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">#</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">% Complete</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
                <tbody>
                  {(selected.requests || []).length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No draws yet.</td></tr> :
                    selected.requests.map((r: any) => (
                      <tr key={r.id} className="border-b">
                        <td className="px-4 py-3 font-mono text-sm">#{r.drawNumber}</td>
                        <td className="px-4 py-3 font-mono text-sm">${Number(r.amountRequested).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-sm">{r.amountApproved ? `$${Number(r.amountApproved).toLocaleString()}` : '—'}</td>
                        <td className="px-4 py-3 text-sm">{r.percentComplete ? `${r.percentComplete}%` : '—'}</td>
                        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${REQ_STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {r.status === 'pending' && <button onClick={() => drawAction(r.id, 'submit')} className="text-blue-600 hover:bg-blue-50 p-1 rounded text-xs">Submit</button>}
                            {r.status === 'submitted' && <button onClick={() => drawAction(r.id, 'approve')} className="text-green-600 hover:bg-green-50 p-1 rounded"><Check className="w-4 h-4" /></button>}
                            {r.status === 'approved' && <button onClick={() => drawAction(r.id, 'mark-paid')} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded text-xs">Mark Paid</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : <div className="bg-white rounded-lg border p-12 text-center text-gray-400">Select a draw schedule to view its draws</div>}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Draw Schedule</h2>
            <form onSubmit={createSchedule} className="space-y-3">
              <select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full border rounded-lg px-3 py-2"><option value="">Select project...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input required placeholder="Schedule name (e.g., Main construction loan)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input required type="number" step="0.01" placeholder="Total loan amount" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" />
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
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">New Draw Request</h2>
            <form onSubmit={createDraw} className="space-y-3">
              <input required type="number" step="0.01" placeholder="Amount requested" value={drawForm.amountRequested} onChange={(e) => setDrawForm({ ...drawForm, amountRequested: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" />
              <input type="number" step="0.1" min="0" max="100" placeholder="% complete" value={drawForm.percentComplete} onChange={(e) => setDrawForm({ ...drawForm, percentComplete: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Notes" value={drawForm.notes} onChange={(e) => setDrawForm({ ...drawForm, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowDraw(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create Draw</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
