/**
 * Lien Waivers Page — Construction tier
 * Four types: conditional/unconditional × progress/final.
 */
import { useState, useEffect } from 'react';
import { Shield, Plus, Check, X, Loader2 } from 'lucide-react';
import api from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  requested: 'bg-blue-100 text-blue-700',
  received: 'bg-purple-100 text-purple-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  conditional_progress: 'Conditional Progress',
  unconditional_progress: 'Unconditional Progress',
  conditional_final: 'Conditional Final',
  unconditional_final: 'Unconditional Final',
};

export default function LienWaiversPage() {
  const [waivers, setWaivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({ projectId: '', vendorName: '', vendorType: 'subcontractor', waiverType: 'conditional_progress', throughDate: '', amountPrevious: 0, amountCurrent: 0, amountTotal: 0, notes: '' });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const [{ data }, projRes] = await Promise.all([api.get('/api/lien-waivers'), api.get('/api/projects')]);
      setWaivers(data || []); setProjects(projRes.data || projRes || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const createWaiver = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(form.amountPrevious) + Number(form.amountCurrent);
    await api.post('/api/lien-waivers', { ...form, amountPrevious: Number(form.amountPrevious), amountCurrent: Number(form.amountCurrent), amountTotal: total });
    setShowCreate(false); setForm({ projectId: '', vendorName: '', vendorType: 'subcontractor', waiverType: 'conditional_progress', throughDate: '', amountPrevious: 0, amountCurrent: 0, amountTotal: 0, notes: '' });
    load();
  };

  const act = async (id: string, action: string) => { await api.post(`/api/lien-waivers/${id}/${action}`, {}); load(); };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-orange-500" />Lien Waivers</h1><p className="text-sm text-gray-500 mt-1">Protect against mechanic's liens on every payment cycle</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Waiver</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Vendor</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {waivers.length === 0 ? <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No lien waivers yet.</td></tr> :
              waivers.map((w) => (
                <tr key={w.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{w.vendorName}<div className="text-xs text-gray-500">{w.vendorType}</div></td>
                  <td className="px-4 py-3 text-sm">{TYPE_LABELS[w.waiverType]}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{w.project?.name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-sm">${Number(w.amountTotal).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[w.status]}`}>{w.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {w.status === 'draft' && <button onClick={() => act(w.id, 'request')} className="text-blue-600 hover:bg-blue-50 p-1 rounded" title="Send request">Send</button>}
                      {w.status === 'requested' && <button onClick={() => act(w.id, 'receive')} className="text-purple-600 hover:bg-purple-50 p-1 rounded" title="Mark received">Received</button>}
                      {w.status === 'received' && <><button onClick={() => act(w.id, 'approve')} className="text-green-600 hover:bg-green-50 p-1 rounded"><Check className="w-4 h-4" /></button><button onClick={() => act(w.id, 'reject')} className="text-red-600 hover:bg-red-50 p-1 rounded"><X className="w-4 h-4" /></button></>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Lien Waiver</h2>
            <form onSubmit={createWaiver} className="space-y-3">
              <select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full border rounded-lg px-3 py-2"><option value="">Select project...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input required placeholder="Vendor / subcontractor name" value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.vendorType} onChange={(e) => setForm({ ...form, vendorType: e.target.value })} className="border rounded-lg px-3 py-2"><option value="contractor">Contractor</option><option value="subcontractor">Subcontractor</option><option value="supplier">Supplier</option><option value="laborer">Laborer</option></select>
                <select value={form.waiverType} onChange={(e) => setForm({ ...form, waiverType: e.target.value })} className="border rounded-lg px-3 py-2">{Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-gray-500">Through Date</label><input type="date" value={form.throughDate} onChange={(e) => setForm({ ...form, throughDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">Previous $</label><input type="number" step="0.01" value={form.amountPrevious} onChange={(e) => setForm({ ...form, amountPrevious: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">Current $</label><input type="number" step="0.01" value={form.amountCurrent} onChange={(e) => setForm({ ...form, amountCurrent: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
