import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, X, Save, Phone, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

export default function AdjusterDirectoryPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [adjusters, setAdjusters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', adjusterCompany: '', insuranceCarrier: '', territory: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/insurance/adjusters', { headers });
      if (res.ok) setAdjusters(await res.json());
    } catch {
      toast.error('Failed to load adjusters');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const addAdjuster = async () => {
    if (!form.name.trim() || !form.insuranceCarrier.trim()) {
      toast.error('Name and carrier required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/insurance/adjusters', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setAddOpen(false);
      setForm({ name: '', phone: '', email: '', adjusterCompany: '', insuranceCarrier: '', territory: '', notes: '' });
      load();
      toast.success('Adjuster added');
    } catch {
      toast.error('Failed to add adjuster');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Adjuster Directory</h1>
            <p className="text-sm text-gray-500 mt-0.5">{adjusters.length} adjusters</p>
          </div>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Adjuster
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Carrier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Territory</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Jobs Together</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : adjusters.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-gray-400">No adjusters in directory yet. They'll be added as you log insurance claims.</td></tr>
                ) : (
                  adjusters.map((adj) => (
                    <tr key={adj.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{adj.name}</td>
                      <td className="px-4 py-3 text-gray-600">{adj.adjusterCompany || adj.company_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{adj.insuranceCarrier}</td>
                      <td className="px-4 py-3 text-gray-600">{adj.territory || '—'}</td>
                      <td className="px-4 py-3">
                        {adj.phone ? (
                          <a href={`tel:${adj.phone}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                            <Phone className="w-3 h-3" /> {adj.phone}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {adj.email ? (
                          <a href={`mailto:${adj.email}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                            <Mail className="w-3 h-3" /> {adj.email}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
                          {adj.jobsWorkedTogether || 0}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Add Adjuster</h2>
              <button onClick={() => setAddOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Insurance Carrier *</label>
                <input value={form.insuranceCarrier} onChange={(e) => setForm({ ...form, insuranceCarrier: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="e.g. State Farm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Company</label>
                  <input value={form.adjusterCompany} onChange={(e) => setForm({ ...form, adjusterCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Territory</label>
                  <input value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="e.g. Midwest" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={addAdjuster} disabled={submitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {submitting ? 'Adding...' : 'Add Adjuster'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
