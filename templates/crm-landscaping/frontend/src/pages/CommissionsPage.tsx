/**
 * Commissions Page — Fleet tier
 * Tech + sales rep commission tracking. Manages commission plans (how
 * commission is calculated) and commission records (individual earning
 * events from completed jobs / paid invoices).
 */
import { useState, useEffect } from 'react';
import { DollarSign, Plus, Check, Loader2 } from 'lucide-react';
import api from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-700',
};

export default function CommissionsPage() {
  const [tab, setTab] = useState<'records' | 'plans'>('records');
  const [commissions, setCommissions] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  const [planForm, setPlanForm] = useState({ name: '', planType: 'percent_of_invoice', flatRateAmount: 0, percentRate: 10, appliesToRole: 'technician' });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const [r1, r2] = await Promise.all([api.get('/api/commissions'), api.get('/api/commissions/plans')]);
      setCommissions(r1.data || []); setPlans(r2.data || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/commissions/plans', { ...planForm, flatRateAmount: Number(planForm.flatRateAmount), percentRate: Number(planForm.percentRate) });
    setShowPlan(false); setPlanForm({ name: '', planType: 'percent_of_invoice', flatRateAmount: 0, percentRate: 10, appliesToRole: 'technician' });
    load();
  };

  const act = async (id: string, action: string) => { await api.post(`/api/commissions/${id}/${action}`, {}); load(); };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-sky-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="w-6 h-6 text-sky-500" />Commissions</h1><p className="text-sm text-gray-500 mt-1">Tech + sales rep commission tracking</p></div>
        {tab === 'plans' && <button onClick={() => setShowPlan(true)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Plan</button>}
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button onClick={() => setTab('records')} className={`px-4 py-2 border-b-2 ${tab === 'records' ? 'border-sky-500 text-sky-600 font-semibold' : 'border-transparent text-gray-500'}`}>Earnings</button>
        <button onClick={() => setTab('plans')} className={`px-4 py-2 border-b-2 ${tab === 'plans' ? 'border-sky-500 text-sky-600 font-semibold' : 'border-transparent text-gray-500'}`}>Plans</button>
      </div>

      {tab === 'records' ? (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">User</th><th className="px-4 py-3">Base</th><th className="px-4 py-3">Rate</th><th className="px-4 py-3">Commission</th><th className="px-4 py-3">Earned</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {commissions.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No commission records yet.</td></tr> :
                commissions.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{c.userId.substring(0, 8)}…</td>
                    <td className="px-4 py-3 font-mono text-sm">${Number(c.baseAmount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm">{c.rateApplied ? `${c.rateApplied}%` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold">${Number(c.commissionAmount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{new Date(c.earnedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[c.status]}`}>{c.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.status === 'pending' && <button onClick={() => act(c.id, 'approve')} className="text-blue-600 hover:bg-blue-50 p-1 rounded" title="Approve"><Check className="w-4 h-4" /></button>}
                        {c.status === 'approved' && <button onClick={() => act(c.id, 'mark-paid')} className="text-green-600 hover:bg-green-50 p-1 rounded text-xs">Mark Paid</button>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.length === 0 ? <div className="col-span-full bg-white rounded-lg border p-12 text-center text-gray-400">No commission plans yet. Create one to start tracking commissions.</div> :
            plans.map((p) => (
              <div key={p.id} className="bg-white rounded-lg border p-5">
                <h3 className="font-bold text-lg">{p.name}</h3>
                <div className="text-sm text-gray-500 mb-3">{p.planType.replace(/_/g, ' ')} · {p.appliesToRole}</div>
                <div className="font-mono text-sm">
                  {p.planType === 'flat_rate' && <>${Number(p.flatRateAmount || 0).toFixed(2)} per job</>}
                  {(p.planType === 'percent_of_invoice' || p.planType === 'percent_of_margin') && <>{Number(p.percentRate || 0)}% of {p.planType === 'percent_of_invoice' ? 'invoice' : 'margin'}</>}
                  {p.planType === 'tiered' && <>Tiered: {(p.tiers || []).length} brackets</>}
                </div>
              </div>
            ))}
        </div>
      )}

      {showPlan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Commission Plan</h2>
            <form onSubmit={createPlan} className="space-y-3">
              <input required placeholder="Plan name (e.g., Tech Standard)" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="grid grid-cols-2 gap-3">
                <select value={planForm.planType} onChange={(e) => setPlanForm({ ...planForm, planType: e.target.value })} className="border rounded-lg px-3 py-2">
                  <option value="flat_rate">Flat rate per job</option>
                  <option value="percent_of_invoice">% of invoice</option>
                  <option value="percent_of_margin">% of margin</option>
                </select>
                <select value={planForm.appliesToRole} onChange={(e) => setPlanForm({ ...planForm, appliesToRole: e.target.value })} className="border rounded-lg px-3 py-2">
                  <option value="technician">Technician</option>
                  <option value="sales_rep">Sales Rep</option>
                  <option value="manager">Manager</option>
                  <option value="all">All roles</option>
                </select>
              </div>
              {planForm.planType === 'flat_rate' && <div><label className="text-xs text-gray-500">Flat amount per job</label><input type="number" step="0.01" value={planForm.flatRateAmount} onChange={(e) => setPlanForm({ ...planForm, flatRateAmount: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>}
              {planForm.planType !== 'flat_rate' && <div><label className="text-xs text-gray-500">Percent rate</label><input type="number" step="0.1" value={planForm.percentRate} onChange={(e) => setPlanForm({ ...planForm, percentRate: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>}
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowPlan(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-sky-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
