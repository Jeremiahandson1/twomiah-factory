import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Loader2, X, CreditCard, Edit2, Trash2, Check, Users, UserPlus } from 'lucide-react';
import api from '../../services/api';
import ClientPicker from '../../components/salon/ClientPicker';

/**
 * Memberships — plans (GET/POST/PUT/DELETE /api/memberships) and the people on
 * them (GET/POST /api/memberships/enrollments).
 *
 * A plan is either recurring (no credit count) or a prepaid package (credits
 * that burn down per redeem). Both are the same table; creditsTotal decides.
 */

const CYCLES = ['monthly', 'annual', 'one_time'];

interface Plan {
  id: string;
  name?: string;
  description?: string;
  price?: number | string;
  billingCycle?: string;
  creditsTotal?: number | null;
  includedServices?: string[];
  active?: boolean;
}
interface Enrollment {
  id: string;
  planId?: string;
  planName?: string;
  contactId?: string;
  clientName?: string;
  clientPhone?: string;
  status?: string;
  creditsRemaining?: number | null;
  startDate?: string;
  renewsAt?: string;
}
interface ServiceOption { id: string; name?: string }

function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtDate(s?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function cycleLabel(c?: string): string {
  if (c === 'annual') return '/yr';
  if (c === 'one_time') return ' one-time';
  return '/mo';
}

export default function MembershipsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [enrolling, setEnrolling] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, enrollRes] = await Promise.all([
        api.get('/api/memberships?includeInactive=1'),
        api.get('/api/memberships/enrollments').catch(() => ({ data: [] })),
      ]);
      setPlans(plansRes.data || []);
      setEnrollments(enrollRes.data || []);
    } catch (error) {
      console.error('Failed to load memberships:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retire = async (plan: Plan) => {
    if (!confirm(`Retire the "${plan.name}" plan? Existing members keep their enrollment.`)) return;
    try {
      await api.delete('/api/memberships', plan.id);
      load();
    } catch {
      alert('Failed to retire plan');
    }
  };

  const redeem = async (e: Enrollment) => {
    try {
      await api.post(`/api/memberships/enrollments/${e.id}/redeem`);
      load();
    } catch (err) {
      alert((err as Error).message || 'Failed to redeem a credit');
    }
  };

  const activePlans = plans.filter((p) => p.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-rose-500" /> Memberships
          </h1>
          <p className="text-gray-500">Recurring plans and prepaid packages</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEnrolling(true)}
            disabled={activePlans.length === 0}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title={activePlans.length === 0 ? 'Create a plan first' : undefined}
          >
            <UserPlus className="w-4 h-4" /> Enroll Client
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700">
            <Plus className="w-4 h-4" /> New Plan
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {plans.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">No membership plans yet</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plans.map((p) => (
                <div key={p.id} className={`bg-white rounded-xl border p-5 flex flex-col ${p.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between">
                    <p className="font-semibold text-gray-900">{p.name || 'Untitled Plan'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.active ? 'Active' : 'Retired'}
                    </span>
                  </div>
                  {p.description && <p className="text-sm text-gray-500 mt-2">{p.description}</p>}
                  <div className="flex items-baseline gap-1 mt-3">
                    <span className="text-2xl font-bold text-gray-900">{money(p.price)}</span>
                    <span className="text-sm text-gray-400">{cycleLabel(p.billingCycle)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2 flex items-center gap-2">
                    <Check className="w-4 h-4 text-teal-500 flex-shrink-0" />
                    {p.creditsTotal ? `${p.creditsTotal} visit${p.creditsTotal === 1 ? '' : 's'} included` : 'Unlimited / recurring'}
                  </p>
                  <div className="mt-auto pt-3 flex items-center justify-between border-t mt-4">
                    <span className="text-xs text-gray-400">
                      {enrollments.filter((e) => e.planId === p.id && e.status === 'active').length} member(s)
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      {p.active && (
                        <button onClick={() => retire(p)} className="p-1 text-gray-400 hover:text-red-600" title="Retire"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Enrollments */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-500" /> Members
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 rounded-full">{enrollments.length}</span>
            </h2>
            {enrollments.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Nobody enrolled yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 font-medium">Plan</th>
                      <th className="px-4 py-3 font-medium">Started</th>
                      <th className="px-4 py-3 font-medium">Credits</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {enrollments.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {e.contactId ? (
                            <Link to={`/crm/clients/${e.contactId}`} className="hover:text-teal-600">{e.clientName || '—'}</Link>
                          ) : (e.clientName || '—')}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{e.planName || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{fmtDate(e.startDate)}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {e.creditsRemaining === null || e.creditsRemaining === undefined ? 'Unlimited' : e.creditsRemaining}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{e.status || 'active'}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {e.status === 'active' && e.creditsRemaining !== null && e.creditsRemaining !== undefined && e.creditsRemaining > 0 && (
                            <button onClick={() => redeem(e)} className="text-xs text-teal-600 hover:text-teal-700">Use a credit</button>
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
      {enrolling && (
        <EnrollModal
          plans={activePlans}
          onSave={() => { setEnrolling(false); load(); }}
          onClose={() => setEnrolling(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Plan Modal ---------------- */

function PlanModal({ plan, onSave, onClose }: { plan: Plan | null; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [included, setIncluded] = useState<string[]>(plan?.includedServices || []);
  const [form, setForm] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    price: plan?.price?.toString() || '',
    billingCycle: plan?.billingCycle || 'monthly',
    creditsTotal: plan?.creditsTotal?.toString() || '',
    active: plan?.active ?? true,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/api/service-menu');
        setServices(res.data || []);
      } catch { /* the plan can still be saved without picking services */ }
    })();
  }, []);

  const toggleService = (id: string) => {
    setIncluded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { alert('Plan name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description || null,
        price: form.price === '' ? null : Number(form.price),
        billingCycle: form.billingCycle,
        // Blank = unlimited/recurring, so it must be sent as null.
        creditsTotal: form.creditsTotal === '' ? null : Number(form.creditsTotal),
        includedServices: included,
        active: form.active,
      };
      if (plan) await api.put(`/api/memberships/${plan.id}`, payload);
      else await api.post('/api/memberships', payload);
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
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{plan ? 'Edit Plan' : 'New Plan'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price ($)</label>
                <input type="number" step="any" value={form.price} onChange={(e) => set('price', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Billing</label>
                <select value={form.billingCycle} onChange={(e) => set('billingCycle', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {CYCLES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visit credits</label>
                <input type="number" value={form.creditsTotal} onChange={(e) => set('creditsTotal', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="∞" />
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-2">Leave credits blank for an unlimited or open-ended membership.</p>

            {services.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Included services</label>
                <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={included.includes(s.id)} onChange={() => toggleService(s.id)} className="w-4 h-4" />
                      {s.name || 'Untitled'}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input id="planActive" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="planActive" className="text-sm font-medium text-gray-700">Active</label>
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

/* ---------------- Enroll Modal ---------------- */

function EnrollModal({ plans, onSave, onClose }: { plans: Plan[]; onSave: () => void; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [contactId, setContactId] = useState<string>('');
  const [planId, setPlanId] = useState<string>(plans[0]?.id || '');
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) { alert('A client is required'); return; }
    if (!planId) { alert('A plan is required'); return; }
    setSaving(true);
    try {
      // Credits are seeded from the plan by the backend, so they are not sent here.
      await api.post('/api/memberships/enrollments', { contactId, planId, startDate });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to enroll client');
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
            <h2 className="text-lg font-bold flex items-center gap-2"><UserPlus className="w-5 h-5 text-teal-600" /> Enroll Client</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client <span className="text-red-500">*</span></label>
              <ClientPicker value={contactId} onChange={(id) => setContactId(id)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan <span className="text-red-500">*</span></label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Enrolling...' : 'Enroll'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
