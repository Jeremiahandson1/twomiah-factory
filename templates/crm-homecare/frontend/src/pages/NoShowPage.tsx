/**
 * No-Show Tracking Page — Care Agency tier
 * Track caregiver no-shows and client cancellations to spot patterns.
 */
import { useState, useEffect } from 'react';
import { AlertTriangle, Plus, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

const REASON_COLORS: Record<string, string> = {
  caregiver_no_show: 'bg-red-100 text-red-700',
  caregiver_late: 'bg-yellow-100 text-yellow-700',
  client_cancel: 'bg-blue-100 text-blue-700',
  emergency: 'bg-purple-100 text-purple-700',
};

export default function NoShowPage() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ scheduleId: '', caregiverId: '', clientId: '', reason: 'caregiver_no_show', notes: '', reportedAt: '' });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/no-show`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setIncidents(json.data || json || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE_URL}/api/no-show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    setForm({ scheduleId: '', caregiverId: '', clientId: '', reason: 'caregiver_no_show', notes: '', reportedAt: '' });
    load();
  };

  // Compute simple stats
  const byReason = incidents.reduce((acc: any, i: any) => { acc[i.reason] = (acc[i.reason] || 0) + 1; return acc; }, {});

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><AlertTriangle className="w-6 h-6 text-orange-500" />No-Show Tracking</h1><p className="text-sm text-gray-500 mt-1">Track missed visits to spot patterns and protect revenue</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />Log Incident</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Object.entries(REASON_COLORS).map(([reason, color]) => (
          <div key={reason} className="bg-white rounded-lg border p-4">
            <div className="text-xs text-gray-500 uppercase">{reason.replace(/_/g, ' ')}</div>
            <div className="text-2xl font-bold mt-1">{byReason[reason] || 0}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Caregiver</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Notes</th></tr></thead>
          <tbody>
            {incidents.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No incidents logged.</td></tr> :
              incidents.map((i: any) => (
                <tr key={i.id} className="border-b">
                  <td className="px-4 py-3 text-sm">{i.reportedAt ? new Date(i.reportedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{(i.caregiverId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs">{(i.clientId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${REASON_COLORS[i.reason] || 'bg-gray-100'}`}>{(i.reason || '').replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{i.notes || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Log No-Show Incident</h2>
            <form onSubmit={create} className="space-y-3">
              <input placeholder="Schedule ID (optional)" value={form.scheduleId} onChange={(e) => setForm({ ...form, scheduleId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className="border rounded-lg px-3 py-2" />
                <input placeholder="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="datetime-local" value={form.reportedAt} onChange={(e) => setForm({ ...form, reportedAt: e.target.value })} className="border rounded-lg px-3 py-2" />
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="border rounded-lg px-3 py-2">
                  <option value="caregiver_no_show">Caregiver no-show</option>
                  <option value="caregiver_late">Caregiver late</option>
                  <option value="client_cancel">Client cancelled</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Log Incident</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
