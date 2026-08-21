/**
 * AIA G702/G703 Forms Page — Construction tier
 * Application for Payment (G702) + Continuation Sheet (G703) for GC pay apps.
 */
import { useState, useEffect } from 'react';
import { FileText, Plus, Loader2 } from 'lucide-react';
import api from '../services/api';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  signed: 'bg-blue-100 text-blue-700',
  submitted: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
};

export default function AiaFormsPage() {
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({
    projectId: '', formType: 'G702', applicationNumber: 1, periodTo: '',
    contractSum: 0, netChangeByChangeOrders: 0, retainagePercent: 10, lessPreviousCertificates: 0,
    lineItems: [{ itemNumber: '1', description: '', scheduledValue: 0, workPreviouslyCompleted: 0, workThisPeriod: 0, materialsStored: 0, totalCompletedAndStored: 0, percentComplete: 0, balanceToFinish: 0, retainage: 0 }],
  });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const [{ data }, projRes] = await Promise.all([api.get('/api/aia-forms'), api.get('/api/projects')]);
      setForms(data || []); setProjects(projRes.data || projRes || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { itemNumber: String(form.lineItems.length + 1), description: '', scheduledValue: 0, workPreviouslyCompleted: 0, workThisPeriod: 0, materialsStored: 0, totalCompletedAndStored: 0, percentComplete: 0, balanceToFinish: 0, retainage: 0 }] });
  const updateLine = (i: number, field: string, value: any) => {
    const items = [...form.lineItems];
    (items[i] as any)[field] = value;
    // auto-calc totals
    if (['workPreviouslyCompleted', 'workThisPeriod', 'materialsStored', 'scheduledValue'].includes(field)) {
      items[i].totalCompletedAndStored = Number(items[i].workPreviouslyCompleted) + Number(items[i].workThisPeriod) + Number(items[i].materialsStored);
      items[i].percentComplete = items[i].scheduledValue > 0 ? (items[i].totalCompletedAndStored / items[i].scheduledValue) * 100 : 0;
      items[i].balanceToFinish = Number(items[i].scheduledValue) - items[i].totalCompletedAndStored;
    }
    setForm({ ...form, lineItems: items });
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/aia-forms', {
      ...form, applicationNumber: Number(form.applicationNumber), contractSum: Number(form.contractSum),
      netChangeByChangeOrders: Number(form.netChangeByChangeOrders), retainagePercent: Number(form.retainagePercent),
      lessPreviousCertificates: Number(form.lessPreviousCertificates),
      lineItems: form.lineItems.map((li) => ({ ...li, scheduledValue: Number(li.scheduledValue), workPreviouslyCompleted: Number(li.workPreviouslyCompleted), workThisPeriod: Number(li.workThisPeriod), materialsStored: Number(li.materialsStored), totalCompletedAndStored: Number(li.totalCompletedAndStored), percentComplete: Number(li.percentComplete), balanceToFinish: Number(li.balanceToFinish), retainage: Number(li.retainage) })),
    });
    setShowCreate(false); load();
  };

  const sign = async (id: string) => { const signedBy = prompt('Signed by:'); if (signedBy) { await api.post(`/api/aia-forms/${id}/sign`, { signedBy }); load(); } };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6 text-orange-500" />AIA G702/G703 Forms</h1><p className="text-sm text-gray-500 mt-1">Application and Certificate for Payment — standard AIA forms</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Pay App</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">App #</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Period To</th><th className="px-4 py-3">Payment Due</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {forms.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No pay applications yet.</td></tr> :
              forms.map((f) => (
                <tr key={f.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">#{f.applicationNumber}</td>
                  <td className="px-4 py-3 font-semibold">{f.formType}</td>
                  <td className="px-4 py-3 text-sm">{f.project?.name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(f.periodTo).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-mono text-sm">${Number(f.currentPaymentDue).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[f.status]}`}>{f.status}</span></td>
                  <td className="px-4 py-3">{f.status === 'draft' && <button onClick={() => sign(f.id)} className="text-blue-600 text-xs hover:underline">Sign</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-auto">
          <div className="bg-white rounded-xl w-full max-w-4xl p-6 my-8">
            <h2 className="text-xl font-bold mb-4">New AIA Pay Application</h2>
            <form onSubmit={create} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <select required value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="border rounded-lg px-3 py-2"><option value="">Project...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <select value={form.formType} onChange={(e) => setForm({ ...form, formType: e.target.value })} className="border rounded-lg px-3 py-2"><option value="G702">G702 (App for Payment)</option><option value="G703">G703 (Continuation)</option></select>
                <input type="number" placeholder="App #" value={form.applicationNumber} onChange={(e) => setForm({ ...form, applicationNumber: Number(e.target.value) })} className="border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-gray-500">Period To</label><input type="date" required value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">Contract Sum</label><input type="number" step="0.01" value={form.contractSum} onChange={(e) => setForm({ ...form, contractSum: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
                <div><label className="text-xs text-gray-500">Retainage %</label><input type="number" step="0.1" value={form.retainagePercent} onChange={(e) => setForm({ ...form, retainagePercent: Number(e.target.value) })} className="w-full border rounded-lg px-3 py-2" /></div>
              </div>

              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2"><div className="text-sm font-semibold">G703 Line Items</div><button type="button" onClick={addLineItem} className="text-sm text-blue-600 hover:underline">+ Add row</button></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50"><tr><th className="p-1">#</th><th className="p-1">Description</th><th className="p-1">Sch. Value</th><th className="p-1">Prev. Done</th><th className="p-1">This Period</th><th className="p-1">Stored</th><th className="p-1">Total</th><th className="p-1">%</th></tr></thead>
                    <tbody>
                      {form.lineItems.map((li, i) => (
                        <tr key={i}>
                          <td className="p-1"><input value={li.itemNumber} onChange={(e) => updateLine(i, 'itemNumber', e.target.value)} className="w-12 border rounded px-1 py-0.5" /></td>
                          <td className="p-1"><input value={li.description} onChange={(e) => updateLine(i, 'description', e.target.value)} className="w-full border rounded px-1 py-0.5" /></td>
                          <td className="p-1"><input type="number" step="0.01" value={li.scheduledValue} onChange={(e) => updateLine(i, 'scheduledValue', e.target.value)} className="w-24 border rounded px-1 py-0.5" /></td>
                          <td className="p-1"><input type="number" step="0.01" value={li.workPreviouslyCompleted} onChange={(e) => updateLine(i, 'workPreviouslyCompleted', e.target.value)} className="w-24 border rounded px-1 py-0.5" /></td>
                          <td className="p-1"><input type="number" step="0.01" value={li.workThisPeriod} onChange={(e) => updateLine(i, 'workThisPeriod', e.target.value)} className="w-24 border rounded px-1 py-0.5" /></td>
                          <td className="p-1"><input type="number" step="0.01" value={li.materialsStored} onChange={(e) => updateLine(i, 'materialsStored', e.target.value)} className="w-24 border rounded px-1 py-0.5" /></td>
                          <td className="p-1 text-right font-mono">${Number(li.totalCompletedAndStored).toFixed(0)}</td>
                          <td className="p-1 text-right">{Number(li.percentComplete).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create Pay App</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
