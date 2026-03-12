import { useState, useEffect, useCallback } from 'react';
import { Plus, Users, Phone, Briefcase, X, HardHat } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

export default function CrewsPage() {
  const { token } = useAuth();
  const toast = useToast();

  const [crews, setCrews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    foremanName: '',
    foremanPhone: '',
    crewSize: '',
    isSubcontractor: false,
    notes: '',
  });

  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crews', { headers });
      const data = await res.json();
      setCrews(Array.isArray(data) ? data : data.data || []);
    } catch {
      toast.error('Failed to load crews');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Crew name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/crews', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, crewSize: form.crewSize ? Number(form.crewSize) : null }),
      });
      if (!res.ok) throw new Error();
      const crew = await res.json();
      setCrews((prev) => [...prev, crew]);
      setModalOpen(false);
      setForm({ name: '', foremanName: '', foremanPhone: '', crewSize: '', isSubcontractor: false, notes: '' });
      toast.success('Crew created');
    } catch {
      toast.error('Failed to create crew');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Crews</h1>
            <p className="text-sm text-gray-500 mt-0.5">{crews.length} crews</p>
          </div>
          <button
            onClick={() => { setForm({ name: '', foremanName: '', foremanPhone: '', crewSize: '', isSubcontractor: false, notes: '' }); setModalOpen(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Add Crew
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {crews.map((crew) => (
            <div key={crew.id} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{crew.name}</h3>
                    {crew.isSubcontractor && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Subcontractor</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {crew.foremanName && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <HardHat className="w-4 h-4 text-gray-400" />
                    <span>{crew.foremanName}</span>
                  </div>
                )}
                {crew.foremanPhone && (
                  <a href={`tel:${crew.foremanPhone}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                    <Phone className="w-4 h-4" />
                    <span>{crew.foremanPhone}</span>
                  </a>
                )}
                <div className="flex items-center gap-4 pt-2 border-t text-gray-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {crew.crewSize || '—'} members
                  </span>
                  <span className="flex items-center gap-1">
                    <Briefcase className="w-3.5 h-3.5" />
                    {crew.activeJobCount ?? crew.jobCount ?? 0} active
                  </span>
                </div>
              </div>
            </div>
          ))}

          {crews.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              No crews yet. Add your first crew to get started.
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Add Crew</h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Crew Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Foreman Name</label>
                <input value={form.foremanName} onChange={(e) => setForm({ ...form, foremanName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Foreman Phone</label>
                <input value={form.foremanPhone} onChange={(e) => setForm({ ...form, foremanPhone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Crew Size</label>
                <input type="number" value={form.crewSize} onChange={(e) => setForm({ ...form, crewSize: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isSubcontractor} onChange={(e) => setForm({ ...form, isSubcontractor: e.target.checked })} className="rounded" />
                Subcontractor
              </label>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Crew'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
