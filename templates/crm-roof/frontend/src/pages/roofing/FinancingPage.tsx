/**
 * Financing Page — Business/Storm tier (Roof)
 * Consumer financing applications (Wisetack, GreenSky, Sunlight).
 */
import { useState, useEffect } from 'react';
import { CreditCard, Plus, Check, X } from 'lucide-react';
import api from '../../api/client';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  funded: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-gray-100 text-gray-400',
};

const LENDER_LABELS: Record<string, string> = {
  wisetack: 'Wisetack',
  greensky: 'GreenSky',
  sunlight: 'Sunlight Financial',
  other: 'Other',
};

export default function FinancingPage() {
  const [apps, setApps] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ contactId: '', jobId: '', quoteId: '', lender: 'wisetack' as const, amountRequested: 0, termMonths: 60, notes: '' });

  useEffect(() => { load(); }, []);
  const load = async () => { try { const { data } = await api.get('/api/financing'); setApps(data || []); } catch (e) { console.error(e); } };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/financing', { ...form, amountRequested: Number(form.amountRequested), termMonths: Number(form.termMonths) });
    setShowCreate(false); setForm({ contactId: '', jobId: '', quoteId: '', lender: 'wisetack', amountRequested: 0, termMonths: 60, notes: '' });
    load();
  };

  const act = async (id: string, action: string, body: any = {}) => { await api.post(`/api/financing/${id}/${action}`, body); load(); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="w-6 h-6 text-orange-500" />Consumer Financing</h1><p className="text-sm text-gray-500 mt-1">Track financing applications across Wisetack, GreenSky, and other lenders</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Application</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Lender</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Approved</th><th className="px-4 py-3">Monthly</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {apps.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No financing applications yet.</td></tr> :
              apps.map((a) => (
                <tr key={a.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{a.contactId.substring(0, 8)}…</td>
                  <td className="px-4 py-3 text-sm font-semibold">{LENDER_LABELS[a.lender] || a.lender}</td>
                  <td className="px-4 py-3 font-mono text-sm">${Number(a.amountRequested).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-sm">{a.amountApproved ? `$${Number(a.amountApproved).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3 font-mono text-sm">{a.monthlyPayment ? `$${Number(a.monthlyPayment).toFixed(0)}` : '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[a.status]}`}>{a.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {a.status === 'pending' && <button onClick={() => act(a.id, 'mark-sent', { applicationUrl: prompt('Application URL:') || '', lenderReference: prompt('Lender ref #:') || '' })} className="text-blue-600 text-xs hover:underline">Send</button>}
                      {a.status === 'sent' && <><button onClick={() => { const amt = prompt('Approved amount:'); if (amt) act(a.id, 'approve', { amountApproved: Number(amt), termMonths: a.termMonths }); }} className="text-green-600 hover:bg-green-50 p-1 rounded" title="Approve"><Check className="w-4 h-4" /></button><button onClick={() => act(a.id, 'decline', { notes: prompt('Decline reason:') || '' })} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Decline"><X className="w-4 h-4" /></button></>}
                      {a.status === 'approved' && <button onClick={() => act(a.id, 'mark-funded')} className="text-emerald-600 text-xs hover:underline">Funded</button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">New Financing Application</h2>
            <form onSubmit={create} className="space-y-3">
              <input required placeholder="Contact ID" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Job ID (optional)" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Quote ID (optional)" value={form.quoteId} onChange={(e) => setForm({ ...form, quoteId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <select value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value as any })} className="w-full border rounded-lg px-3 py-2">
                {Object.entries(LENDER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Amount requested</label><input required type="number" step="0.01" value={form.amountRequested} onChange={(e) => setForm({ ...form, amountRequested: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">Term (months)</label><input type="number" value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
