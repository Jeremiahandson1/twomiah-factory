import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, UtensilsCrossed, Edit2, Trash2, Users, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../services/api';

/**
 * Catering menus — packages priced per head.
 *
 * `courses` is structured ([{course, options[]}]) rather than a text blob so the
 * same data renders on the BEO, on a client-facing quote, and in the kitchen's
 * prep list without anyone re-typing it. The editor keeps that structure while
 * staying as fast to type as a plain list.
 */

const CATEGORIES = ['canape', 'lunch', 'dinner', 'buffet', 'bar', 'dessert', 'other'];

interface Course { course?: string; options?: string[] }
interface Package {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  pricePerPerson?: number | string;
  minGuests?: number;
  courses?: Course[];
  dietaryNotes?: string;
  active?: boolean;
}

function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function MenusPage() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Package | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/menu-packages?includeInactive=1');
      setPackages(res.data || []);
    } catch (error) {
      console.error('Failed to load menus:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retire = async (p: Package) => {
    if (!confirm(`Retire "${p.name}"? Booked events keep it on their menu.`)) return;
    try {
      await api.delete('/api/menu-packages', p.id);
      load();
    } catch {
      alert('Failed to retire package');
    }
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const byCategory = CATEGORIES
    .map((cat) => ({ cat, items: packages.filter((p) => (p.category || 'other') === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-teal-600" /> Catering Menus
          </h1>
          <p className="text-gray-500">Packages priced per head, with their courses and minimums</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Package
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">No packages yet</div>
      ) : (
        <div className="space-y-6">
          {byCategory.map((group) => (
            <div key={group.cat}>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{group.cat}</h2>
              <div className="space-y-2">
                {group.items.map((p) => {
                  const open = expanded.has(p.id);
                  const courses = p.courses || [];
                  return (
                    <div key={p.id} className={`bg-white rounded-xl border ${p.active ? '' : 'opacity-60'}`}>
                      <div className="p-4 flex items-center gap-4 flex-wrap">
                        <button
                          onClick={() => toggle(p.id)}
                          disabled={courses.length === 0}
                          className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          aria-label={open ? 'Collapse' : 'Expand'}
                        >
                          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-[200px]">
                          <p className="font-semibold text-gray-900">
                            {p.name || 'Untitled'}
                            {!p.active && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Retired</span>}
                          </p>
                          {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-gray-900">{money(p.pricePerPerson)}</p>
                          <p className="text-xs text-gray-400">per person</p>
                        </div>
                        {p.minGuests ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            <Users className="w-3 h-3" /> min {p.minGuests}
                          </span>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                          {p.active && <button onClick={() => retire(p)} className="p-1 text-gray-400 hover:text-red-600" title="Retire"><Trash2 className="w-4 h-4" /></button>}
                        </div>
                      </div>
                      {open && courses.length > 0 && (
                        <div className="border-t px-4 py-3 space-y-3">
                          {courses.map((c, i) => (
                            <div key={i}>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{c.course || `Course ${i + 1}`}</p>
                              <ul className="mt-1 space-y-0.5">
                                {(c.options || []).map((o, j) => (
                                  <li key={j} className="text-sm text-gray-600">{o}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          {p.dietaryNotes && <p className="text-xs text-gray-400 pt-1 border-t">{p.dietaryNotes}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <PackageModal
          pkg={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ---------------- Package Modal ---------------- */

interface CourseDraft { course: string; options: string }

function PackageModal({ pkg, onSave, onClose }: { pkg: Package | null; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  // Options are edited as one-per-line text — fastest to type, and converted
  // back into the structured shape on save.
  const [courses, setCourses] = useState<CourseDraft[]>(
    (pkg?.courses || []).length
      ? (pkg!.courses || []).map((c) => ({ course: c.course || '', options: (c.options || []).join('\n') }))
      : [{ course: '', options: '' }]
  );
  const [form, setForm] = useState({
    name: pkg?.name || '',
    description: pkg?.description || '',
    category: pkg?.category || 'dinner',
    pricePerPerson: pkg?.pricePerPerson?.toString() || '',
    minGuests: pkg?.minGuests?.toString() || '',
    dietaryNotes: pkg?.dietaryNotes || '',
    active: pkg?.active ?? true,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const setCourse = (i: number, k: keyof CourseDraft, v: string) =>
    setCourses((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Package name is required'); return; }
    setSaving(true);
    try {
      const structured = courses
        .map((c) => ({ course: c.course.trim(), options: c.options.split('\n').map((s) => s.trim()).filter(Boolean) }))
        .filter((c) => c.course || c.options.length);

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description || null,
        category: form.category,
        pricePerPerson: form.pricePerPerson === '' ? null : Number(form.pricePerPerson),
        // Blank clears the minimum, which switches the guard off for this
        // package — so it has to be sent as null, not omitted.
        minGuests: form.minGuests === '' ? null : Number(form.minGuests),
        courses: structured,
        dietaryNotes: form.dietaryNotes || null,
        active: form.active,
      };
      if (pkg) await api.put(`/api/menu-packages/${pkg.id}`, payload);
      else await api.post('/api/menu-packages', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save package');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{pkg ? 'Edit Package' : 'New Package'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => set('category', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">$ / person</label>
                <input type="number" step="any" value={form.pricePerPerson} onChange={(e) => set('pricePerPerson', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min guests</label>
                <input type="number" value={form.minGuests} onChange={(e) => set('minGuests', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Courses</label>
                <button
                  type="button"
                  onClick={() => setCourses((rows) => [...rows, { course: '', options: '' }])}
                  className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700"
                >
                  <Plus className="w-3 h-3" /> Add course
                </button>
              </div>
              <div className="space-y-3">
                {courses.map((c, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text" value={c.course} onChange={(e) => setCourse(i, 'course', e.target.value)}
                        placeholder="Starter" className="flex-1 px-3 py-2 border rounded-lg text-sm font-medium"
                      />
                      <button
                        type="button"
                        onClick={() => setCourses((rows) => (rows.length === 1 ? [{ course: '', options: '' }] : rows.filter((_, idx) => idx !== i)))}
                        className="text-gray-400 hover:text-red-600"
                        title="Remove course"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea
                      value={c.options} onChange={(e) => setCourse(i, 'options', e.target.value)}
                      rows={3} className="w-full px-3 py-2 border rounded-lg text-sm"
                      placeholder={'One choice per line\nBurrata, heirloom tomato, basil\nChicken liver parfait, sourdough'}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dietary notes</label>
              <input type="text" value={form.dietaryNotes} onChange={(e) => set('dietaryNotes', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Vegan and GF versions available with 7 days notice" />
            </div>
            <div className="flex items-center gap-2">
              <input id="pkgActive" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="pkgActive" className="text-sm font-medium text-gray-700">Offered</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Package'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
