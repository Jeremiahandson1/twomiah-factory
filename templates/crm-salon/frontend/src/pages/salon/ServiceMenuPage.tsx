import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Scissors, Edit2, Trash2, Clock, RotateCcw, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

/**
 * Service Menu — what the salon sells (GET/POST/PUT/DELETE /api/service-menu).
 *
 * The rebook interval on each service is not decoration: it is the input to the
 * Rebooking report. A service with no interval never generates a reminder, so
 * the form says so out loud rather than leaving an owner guessing.
 */

const CATEGORIES = ['hair', 'colour', 'nails', 'skin', 'massage', 'waxing', 'other'];

interface Service {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  durationMin?: number;
  price?: number | string;
  priceIsFrom?: boolean;
  rebookIntervalDays?: number | null;
  requiresPatchTest?: boolean;
  active?: boolean;
}

function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function ServiceMenuPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Service | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/service-menu?includeInactive=1');
      setServices(res.data || []);
    } catch (error) {
      console.error('Failed to load service menu:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retire = async (svc: Service) => {
    if (!confirm(`Retire "${svc.name}"? Past service records keep it for rebooking history.`)) return;
    try {
      await api.delete('/api/service-menu', svc.id);
      load();
    } catch {
      alert('Failed to retire service');
    }
  };

  const byCategory = CATEGORIES
    .map((cat) => ({ cat, items: services.filter((s) => (s.category || 'other') === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
            <Scissors className="w-6 h-6 text-teal-600" /> Service Menu
          </h1>
          <p className="text-gray-500 dark:text-slate-400">What you offer, how long it takes, when they're due back</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Service
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No services yet</div>
      ) : (
        <div className="space-y-6">
          {byCategory.map((group) => (
            <div key={group.cat}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 dark:text-slate-400">{group.cat}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map((s) => (
                  <div key={s.id} className={`bg-white rounded-xl border p-5 flex flex-col ${s.active ? '' : 'opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-gray-900 dark:text-slate-100">{s.name || 'Untitled'}</p>
                      {!s.active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">Retired</span>}
                    </div>
                    {s.description && <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">{s.description}</p>}

                    <div className="flex items-baseline gap-2 mt-3">
                      {s.priceIsFrom && <span className="text-sm text-gray-400">from</span>}
                      <span className="text-2xl font-bold text-gray-900 dark:text-slate-100">{money(s.price)}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">
                        <Clock className="w-3 h-3" /> {s.durationMin ?? 60} min
                      </span>
                      {s.rebookIntervalDays ? (
                        <span className="inline-flex items-center gap-1 bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">
                          <RotateCcw className="w-3 h-3" /> rebook {s.rebookIntervalDays}d
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full dark:bg-slate-900">
                          no rebook reminder
                        </span>
                      )}
                      {s.requiresPatchTest && (
                        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" /> patch test
                        </span>
                      )}
                    </div>

                    <div className="mt-auto pt-4 flex items-center justify-end gap-2 border-t mt-4">
                      <button onClick={() => { setEditing(s); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      {s.active && (
                        <button onClick={() => retire(s)} className="p-1 text-gray-400 hover:text-red-600" title="Retire"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ServiceModal
          service={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ---------------- Service Modal ---------------- */

function ServiceModal({ service, onSave, onClose }: { service: Service | null; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: service?.name || '',
    category: service?.category || 'hair',
    description: service?.description || '',
    durationMin: service?.durationMin?.toString() || '60',
    price: service?.price?.toString() || '',
    priceIsFrom: service?.priceIsFrom ?? false,
    rebookIntervalDays: service?.rebookIntervalDays?.toString() || '',
    requiresPatchTest: service?.requiresPatchTest ?? false,
    active: service?.active ?? true,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Service name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        description: form.description || null,
        durationMin: form.durationMin === '' ? 60 : Number(form.durationMin),
        price: form.price === '' ? null : Number(form.price),
        priceIsFrom: form.priceIsFrom,
        // Blank clears the interval, which switches this service's rebooking
        // reminders off — so it must be sent as null, not omitted.
        rebookIntervalDays: form.rebookIntervalDays === '' ? null : Number(form.rebookIntervalDays),
        requiresPatchTest: form.requiresPatchTest,
        active: form.active,
      };
      if (service) await api.put(`/api/service-menu/${service.id}`, payload);
      else await api.post('/api/service-menu', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{service ? 'Edit Service' : 'New Service'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Category</label>
                <select value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Duration (min)</label>
                <input type="number" value={form.durationMin} onChange={(e) => set('durationMin', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Price ($)</label>
                <input type="number" step="any" value={form.price} onChange={(e) => set('price', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Rebook (days)</label>
                <input type="number" value={form.rebookIntervalDays} onChange={(e) => set('rebookIntervalDays', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="42" />
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-2">
              Leave rebook blank for on-demand services — those never appear on the Rebooking report.
            </p>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input id="priceIsFrom" type="checkbox" checked={form.priceIsFrom} onChange={(e) => set('priceIsFrom', e.target.checked)} className="w-4 h-4" />
                <label htmlFor="priceIsFrom" className="text-sm font-medium text-gray-700 dark:text-slate-200">Price is a starting point ("from $250")</label>
              </div>
              <div className="flex items-center gap-2">
                <input id="requiresPatchTest" type="checkbox" checked={form.requiresPatchTest} onChange={(e) => set('requiresPatchTest', e.target.checked)} className="w-4 h-4" />
                <label htmlFor="requiresPatchTest" className="text-sm font-medium text-gray-700 dark:text-slate-200">Requires a patch test</label>
              </div>
              <div className="flex items-center gap-2">
                <input id="active" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
                <label htmlFor="active" className="text-sm font-medium text-gray-700 dark:text-slate-200">Active on the menu</label>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Service'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
