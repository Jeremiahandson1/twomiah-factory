/**
 * PTO Management Page — Care Agency tier
 * Caregiver time-off requests. Uses existing /api/pto route which backs
 * the caregiver_time_off table.
 */
import { useState, useEffect } from 'react';
import { CalendarDays, Plus, Check, X, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
};

const TYPE_LABELS: Record<string, string> = {
  pto: 'PTO',
  vacation: 'Vacation',
  sick: 'Sick Leave',
};

export default function PtoPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ caregiverId: '', type: 'pto' as 'pto' | 'vacation' | 'sick', startDate: '', endDate: '', reason: '' });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/pto`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setRequests(json.data || json || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE_URL}/api/pto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    setForm({ caregiverId: '', type: 'pto', startDate: '', endDate: '', reason: '' });
    load();
  };

  const act = async (id: string, action: string) => {
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE_URL}/api/pto/${id}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    load();
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="w-6 h-6 text-teal-600" />PTO & Time Off</h1><p className="text-sm text-gray-500 mt-1">Caregiver time-off requests — PTO, vacation, sick leave</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />Request Time Off</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Caregiver</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Start</th><th className="px-4 py-3">End</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {requests.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No time off requests yet.</td></tr> :
              requests.map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs">{(r.caregiverId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3 text-sm">{TYPE_LABELS[r.type] || r.type}</td>
                  <td className="px-4 py-3 text-sm">{r.startDate ? new Date(r.startDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-sm">{r.endDate ? new Date(r.endDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{r.reason || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-gray-100'}`}>{r.status || 'pending'}</span></td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => act(r.id, 'approve')} className="text-green-600 hover:bg-green-50 p-1 rounded" title="Approve"><Check className="w-4 h-4" /></button>
                        <button onClick={() => act(r.id, 'deny')} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Deny"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Request Time Off</h2>
            <form onSubmit={create} className="space-y-3">
              <input required placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })} className="w-full border rounded-lg px-3 py-2">
                <option value="pto">PTO</option><option value="vacation">Vacation</option><option value="sick">Sick Leave</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Start date</label><input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">End date</label><input required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full border rounded-lg px-3 py-2" /></div>
              </div>
              <textarea placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded-lg">Submit</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
