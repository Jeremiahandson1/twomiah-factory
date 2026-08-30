import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, X, HeartPulse, Edit2, Trash2, Check, Users,
} from 'lucide-react';
import api from '../../services/api';

/**
 * Wellness Plans — list/CRUD plans (GET/POST/PUT/DELETE /api/wellness-plans)
 * and review current enrollments
 * (GET /api/wellness-plans/enrollments).
 */

const SPECIES = ['', 'dog', 'cat', 'avian', 'reptile', 'equine', 'exotic', 'other'];

interface WellnessPlan {
  id: string;
  name?: string;
  description?: string;
  species?: string;
  monthlyPrice?: number | string;
  annualPrice?: number | string;
  benefits?: string[];
  active?: boolean;
}
interface Enrollment {
  id: string;
  planId?: string;
  planName?: string;
  patientId?: string;
  patientName?: string;
  ownerName?: string;
  status?: string;
  startDate?: string;
}

function money(v: number | string | undefined | null): string {
  const n = Number(v || 0);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string): string {
  if (!s) return '—';
  // Date-only / midnight-UTC values must render at local midnight, or a negative
  // UTC offset shows the previous day (VET-03). Datetimes render as-is.
  const str = String(s);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) || /T00:00:00(\.000)?Z?$/.test(str);
  const d = dateOnly ? new Date(str.slice(0, 10) + 'T00:00:00') : new Date(str);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WellnessPlansPage() {
  const [plans, setPlans] = useState<WellnessPlan[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<WellnessPlan | null>(null);
  const [showEnroll, setShowEnroll] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, enrollRes] = await Promise.all([
        api.get('/api/wellness-plans'),
        api.get('/api/wellness-plans/enrollments').catch(() => ({ data: [] })),
      ]);
      setPlans(plansRes.data || []);
      setEnrollments(enrollRes.data || []);
    } catch (error) {
      console.error('Failed to load wellness plans:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (plan: WellnessPlan) => {
    if (!confirm(`Delete the "${plan.name}" plan?`)) return;
    try {
      await api.delete('/api/wellness-plans', plan.id);
      load();
    } catch {
      alert('Failed to delete plan');
    }
  };

  // Cancel (unenrol) an enrollment — recurring billing, so it must be stoppable. (VET-14)
  const unenroll = async (e: Enrollment) => {
    if (!confirm(`Cancel ${e.patientName || 'this patient'}'s enrollment in ${e.planName || 'this plan'}?`)) return;
    try {
      await api.put(`/api/wellness-plans/enrollments/${e.id}`, { status: 'cancelled' });
      load();
    } catch {
      alert('Failed to cancel enrollment');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
            <HeartPulse className="w-6 h-6 text-rose-500" /> Wellness Plans
          </h1>
          <p className="text-gray-500 dark:text-slate-400">Recurring preventive-care memberships</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Plans */}
          {plans.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No wellness plans yet</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plans.map((p) => (
                <div key={p.id} className="bg-white rounded-xl border p-5 flex flex-col dark:bg-slate-900">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-slate-100">{p.name || 'Untitled Plan'}</p>
                      {p.species && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">{p.species}</span>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {p.description && <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">{p.description}</p>}
                  <div className="flex items-baseline gap-3 mt-3">
                    <span className="text-2xl font-bold text-gray-900 dark:text-slate-100">{money(p.monthlyPrice)}</span>
                    <span className="text-sm text-gray-400">/mo</span>
                    {p.annualPrice ? <span className="text-sm text-gray-400">· {money(p.annualPrice)}/yr</span> : null}
                  </div>
                  {(p.benefits || []).length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {(p.benefits || []).map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-slate-400">
                          <Check className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" /> {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-auto pt-3 flex items-center justify-end gap-2 border-t mt-4">
                    <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => remove(p)} className="p-1 text-gray-400 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Enrollments */}
          <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100">
                <Users className="w-4 h-4 text-teal-500" /> Enrollments
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{enrollments.length}</span>
              </h2>
              <button onClick={() => setShowEnroll(true)} disabled={plans.length === 0} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm disabled:opacity-50" title={plans.length === 0 ? 'Create a plan first' : ''}>
                <Plus className="w-4 h-4" /> Enroll Patient
              </button>
            </div>
            {enrollments.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No active enrollments</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Patient</th>
                      <th className="px-4 py-3 font-medium">Owner</th>
                      <th className="px-4 py-3 font-medium">Plan</th>
                      <th className="px-4 py-3 font-medium">Started</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {enrollments.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">{e.patientName || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{e.ownerName || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{e.planName || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{fmtDate(e.startDate)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize dark:bg-slate-800 dark:text-slate-400">{e.status || 'active'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(e.status || 'active') === 'active' && (
                            <button onClick={() => unenroll(e)} className="text-xs text-red-600 hover:text-red-700">Cancel</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showForm && (
        <PlanModal
          plan={editing}
          onSave={() => { setShowForm(false); setEditing(null); load(); }}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {showEnroll && (
        <EnrollModal
          plans={plans}
          onSave={() => { setShowEnroll(false); load(); }}
          onClose={() => setShowEnroll(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Enroll Modal ---------------- */

interface PatientLite { id: string; name?: string; species?: string; ownerName?: string }

function EnrollModal({ plans, onSave, onClose }: { plans: WellnessPlan[]; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [patientId, setPatientId] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id || '');

  useEffect(() => {
    api.get('/api/patients?limit=500')
      .then((res) => setPatients(res.data || []))
      .catch(() => setPatients([]));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId) { alert('Select a patient'); return; }
    if (!planId) { alert('Select a plan'); return; }
    setSaving(true);
    try {
      // ownerId is derived server-side from the patient. (VET-14)
      await api.post('/api/wellness-plans/enrollments', { patientId, planId });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to enroll patient');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Enroll Patient</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Patient <span className="text-red-500">*</span></label>
              <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select a patient…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || 'Unnamed'}{p.ownerName ? ` — ${p.ownerName}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Plan <span className="text-red-500">*</span></label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select a plan…</option>
                {plans.map((pl) => (
                  <option key={pl.id} value={pl.id}>{pl.name || 'Plan'}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Plan Modal ---------------- */

function PlanModal({ plan, onSave, onClose }: { plan: WellnessPlan | null; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    species: plan?.species || '',
    monthlyPrice: plan?.monthlyPrice ?? '',
    annualPrice: plan?.annualPrice ?? '',
    benefits: (plan?.benefits || []).join('\n'),
    active: plan?.active ?? true,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Plan name is required'); return; }
    setSaving(true);
    try {
      const benefits = form.benefits.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        active: form.active,
      };
      if (form.description) payload.description = form.description;
      if (form.species) payload.species = form.species;
      if (form.monthlyPrice !== '') payload.monthlyPrice = Number(form.monthlyPrice);
      if (form.annualPrice !== '') payload.annualPrice = Number(form.annualPrice);
      if (benefits.length) payload.benefits = benefits;

      if (plan) await api.put(`/api/wellness-plans/${plan.id}`, payload);
      else await api.post('/api/wellness-plans', payload);
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to save plan');
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
            <h2 className="text-lg font-bold">{plan ? 'Edit Plan' : 'New Plan'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Species</label>
                <select value={form.species} onChange={(e) => set('species', e.target.value)} className="w-full px-3 py-2 border rounded-lg capitalize">
                  {SPECIES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Monthly ($)</label>
                <input type="number" step="any" value={form.monthlyPrice} onChange={(e) => set('monthlyPrice', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Annual ($)</label>
                <input type="number" step="any" value={form.annualPrice} onChange={(e) => set('annualPrice', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Benefits <span className="text-xs text-gray-400">(one per line)</span></label>
              <textarea value={form.benefits} onChange={(e) => set('benefits', e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg" placeholder={'2 wellness exams\nCore vaccines\n10% off services'} />
            </div>
            <div className="flex items-center gap-2">
              <input id="active" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="active" className="text-sm font-medium text-gray-700 dark:text-slate-200">Active</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
