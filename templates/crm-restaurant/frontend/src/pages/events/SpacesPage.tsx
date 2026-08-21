import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, DoorOpen, Edit2, Trash2, Users, Wallet } from 'lucide-react';
import api from '../../services/api';

/**
 * Spaces — the rooms you can sell. Minimum spend is the number the sales
 * conversation actually turns on, so it's shown on the card rather than buried
 * in the edit form.
 */

const AMENITY_SUGGESTIONS = ['Private bar', 'AV / screen', 'Step-free access', 'Dance floor', 'Patio', 'Heaters', 'Exclusive use', 'Own entrance'];

interface Space {
  id: string;
  name?: string;
  description?: string;
  seatedCapacity?: number;
  standingCapacity?: number;
  minimumSpend?: number | string;
  hireFee?: number | string;
  amenities?: string[];
  active?: boolean;
}

function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function SpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Space | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/event-spaces?includeInactive=1');
      setSpaces(res.data || []);
    } catch (error) {
      console.error('Failed to load spaces:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retire = async (s: Space) => {
    if (!confirm(`Retire "${s.name}"? Past events keep it in their history.`)) return;
    try {
      await api.delete('/api/event-spaces', s.id);
      load();
    } catch {
      alert('Failed to retire space');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <DoorOpen className="w-6 h-6 text-teal-600" /> Spaces
          </h1>
          <p className="text-gray-500">What you can sell, who it holds, what it has to spend</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Space
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : spaces.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">No spaces yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {spaces.map((s) => (
            <div key={s.id} className={`bg-white rounded-xl border p-5 flex flex-col ${s.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-gray-900">{s.name || 'Untitled'}</p>
                {!s.active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Retired</span>}
              </div>
              {s.description && <p className="text-sm text-gray-500 mt-1">{s.description}</p>}

              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {s.seatedCapacity ? (
                  <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    <Users className="w-3 h-3" /> {s.seatedCapacity} seated
                  </span>
                ) : null}
                {s.standingCapacity ? (
                  <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {s.standingCapacity} standing
                  </span>
                ) : null}
              </div>

              <div className="mt-3 space-y-1 text-sm">
                <p className="flex items-center gap-2 text-gray-700">
                  <Wallet className="w-4 h-4 text-teal-500" />
                  <span className="font-semibold">{money(s.minimumSpend)}</span>
                  <span className="text-gray-400">minimum spend</span>
                </p>
                {s.hireFee ? <p className="text-xs text-gray-400 pl-6">plus {money(s.hireFee)} hire fee</p> : null}
              </div>

              {(s.amenities || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {(s.amenities || []).map((a, i) => (
                    <span key={i} className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{a}</span>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-4 flex items-center justify-end gap-2 border-t mt-4">
                <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                {s.active && (
                  <button onClick={() => retire(s)} className="p-1 text-gray-400 hover:text-red-600" title="Retire"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <SpaceModal
          space={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ---------------- Space Modal ---------------- */

function SpaceModal({ space, onSave, onClose }: { space: Space | null; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [amenities, setAmenities] = useState<string[]>(space?.amenities || []);
  const [form, setForm] = useState({
    name: space?.name || '',
    description: space?.description || '',
    seatedCapacity: space?.seatedCapacity?.toString() || '',
    standingCapacity: space?.standingCapacity?.toString() || '',
    minimumSpend: space?.minimumSpend?.toString() || '',
    hireFee: space?.hireFee?.toString() || '',
    active: space?.active ?? true,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Space name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description || null,
        seatedCapacity: form.seatedCapacity === '' ? null : Number(form.seatedCapacity),
        standingCapacity: form.standingCapacity === '' ? null : Number(form.standingCapacity),
        minimumSpend: form.minimumSpend === '' ? null : Number(form.minimumSpend),
        hireFee: form.hireFee === '' ? null : Number(form.hireFee),
        amenities,
        active: form.active,
      };
      if (space) await api.put(`/api/event-spaces/${space.id}`, payload);
      else await api.post('/api/event-spaces', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save space');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{space ? 'Edit Space' : 'New Space'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="The Cellar" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seated capacity</label>
                <input type="number" value={form.seatedCapacity} onChange={(e) => set('seatedCapacity', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Standing capacity</label>
                <input type="number" value={form.standingCapacity} onChange={(e) => set('standingCapacity', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Minimum spend ($)</label>
                <input type="number" step="any" value={form.minimumSpend} onChange={(e) => set('minimumSpend', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hire fee ($)</label>
                <input type="number" step="any" value={form.hireFee} onChange={(e) => set('hireFee', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amenities</label>
              <div className="flex flex-wrap gap-2">
                {AMENITY_SUGGESTIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleAmenity(a)}
                    className={`text-xs px-2 py-1 rounded-full border ${amenities.includes(a) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input id="spaceActive" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="spaceActive" className="text-sm font-medium text-gray-700">Bookable</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Space'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
