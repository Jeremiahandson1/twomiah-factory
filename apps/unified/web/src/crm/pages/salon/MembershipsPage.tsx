// Moved from templates/crm-salon/frontend/src/pages/salon/MembershipsPage.tsx.
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2, X, CreditCard, Edit2, Trash2, Check, Users, UserPlus } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite, useAuth, usePermissions } from '../../../shared'
import ClientPicker from './ClientPicker';
import { todayKey as todayStr } from '../../../shared'
import { money as fmtMoney } from '../../../shared'
import { useToast } from '../../../shared'
import { useConfirm } from '../../../shared'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

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
  autoCharge?: boolean;
  lastCharge?: { status: string; attempt: number; failureMessage?: string | null } | null;
}
interface ServiceOption { id: string; name?: string }

// Blank stays an em dash; an amount is formatted by the one formatter that knows currency has two
// decimals, rather than a fourth copy that renders $12.50 as "$12.5". (Salon T28 M2)
function money(v: number | string | undefined | null): string {
  if (v === null || v === undefined || v === '') return '—';
  return fmtMoney(v);
}
function fmtDate(s?: string): string {
  if (!s) return '—';
  const str = String(s);
  // date-only ("2026-08-29") parsed at LOCAL midnight, else it rolls back a day. (CC-07)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str) || /T00:00:00(\.000)?Z?$/.test(str);
  const d = dateOnly ? new Date(str.slice(0, 10) + 'T00:00:00') : new Date(str);
  if (isNaN(d.getTime())) return '—';
  return dateOnly ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : momentDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
}
function cycleLabel(c?: string): string {
  if (c === 'annual') return '/yr';
  if (c === 'one_time') return ' one-time';
  return '/mo';
}

interface FailedCharge {
  enrollmentId: string; invoiceId: string; invoiceNumber?: string; clientName?: string; planName?: string; amount: string | number;
  attempt: number; tries: number; status: string; reason?: string | null; backupTried: boolean; paused: boolean; triesLeft: number; nextTryAt: string | null; canRetryNow: boolean;
}
interface RetryCfg { tries: number; intervalDays: number; mayChange: boolean; limits: { tries: { min: number; max: number }; intervalDays: { min: number; max: number } } }

export default function MembershipsPage() {
  // Plans: POST pricebook:create, PUT/DELETE pricebook:update. Enrolments: POST contacts:create, cancel (PUT) and
  // "Use a credit" contacts:update (memberships.ts). (T43 viewer round, T68)
  const mayCreatePlan = useMayWrite('pricebook:create');
  const mayEditPlan = useMayWrite('pricebook:update');
  const mayEnroll = useMayWrite('contacts:create');
  const mayWorkEnrollment = useMayWrite('contacts:update');
  // Charging a member's card on file each period: Card on File on, and a seat that takes payments (the server asks the same).
  const { hasFeature } = useAuth();
  const { known, can } = usePermissions();
  const mayAutoCharge = hasFeature('card_on_file') && known && can('invoices:update');
  const confirm = useConfirm();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  // How many there are in all: the list is one page of the server's (up to 500), and a count of the page alone
  // under-reported every plan's members past the first page. (Moved from crm-salon, which read 100 and counted those.)
  const [enrollmentTotal, setEnrollmentTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [enrolling, setEnrolling] = useState<boolean>(false);
  // Declined cards (salon parity row 6): the list, and how the salon chases them (tries and days between).
  const [failed, setFailed] = useState<FailedCharge[]>([]);
  const [retryCfg, setRetryCfg] = useState<RetryCfg | null>(null);
  const [retryForm, setRetryForm] = useState<{ tries: string; intervalDays: string } | null>(null);
  const [retryErr, setRetryErr] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, enrollRes, failedRes, cfgRes] = await Promise.all([
        api.get('/api/memberships?includeInactive=1'),
        api.get('/api/memberships/enrollments', { limit: 500 }).catch(() => ({ data: [], pagination: { total: 0 } })),
        api.get('/api/memberships/failed-charges').catch(() => ({ data: [] })),
        api.get('/api/memberships/retry-settings').catch(() => null),
      ]);
      setFailed(failedRes?.data || []);
      setRetryCfg(cfgRes ? ((cfgRes as any).data ?? cfgRes) : null);
      setPlans(plansRes.data || []);
      setEnrollments(enrollRes.data || []);
      setEnrollmentTotal(Number(enrollRes.pagination?.total ?? (enrollRes.data || []).length));
    } catch (error) {
      console.error('Failed to load memberships:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const retire = async (plan: Plan) => {
    if (!(await confirm(`Retire the "${plan.name}" plan? Existing members keep their enrollment.`, { title: 'Retire plan', confirmText: 'Retire it' }))) return;
    try {
      await api.delete('/api/memberships', plan.id);
      load();
    } catch {
      toast.error('Failed to retire plan');
    }
  };

  const cancelEnrollment = async (e: Enrollment) => {
    if (!(await confirm(`Cancel ${e.clientName || 'this client'}'s ${e.planName || 'membership'}? Remaining credits are forfeited.`, { title: 'Cancel membership', confirmText: 'Cancel membership' }))) return;
    try {
      await api.put(`/api/memberships/enrollments/${e.id}`, { status: 'cancelled' });
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to cancel the membership');
    }
  };

  // Paused for a declined card: start it again — billing restarts and the unpaid invoice is charged to the card on file now.
  const resume = async (e: Enrollment) => {
    if (!(await confirm(`Start ${e.clientName || 'this client'}'s ${e.planName || 'membership'} again? The unpaid invoice is charged to the card on file now. If it is declined, the membership stays paused.`, { title: 'Resume membership', confirmText: 'Resume it', danger: false }))) return;
    try {
      const r: any = await api.post(`/api/memberships/enrollments/${e.id}/resume`, {});
      const result = r?.data?.resumeResult ?? r?.resumeResult;
      if (result === 'paid' || result === 'no_invoice') toast.success('Membership resumed');
      else toast.error('The card was not accepted — the membership is still paused. The member has been sent a new link to update their card.');
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to resume the membership');
    }
  };

  const setAutoCharge = async (e: Enrollment, on: boolean) => {
    if (on && !(await confirm(`Has ${e.clientName || 'the client'} agreed to be charged for ${e.planName || 'this plan'} on their card on file each period? Each charge is made on your own Stripe account and they are emailed a receipt.`, { title: 'Charge their card automatically', confirmText: 'They agreed', danger: false }))) return;
    try {
      await api.put(`/api/memberships/enrollments/${e.id}/auto-charge`, on ? { on, clientAgreed: true } : { on });
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Could not change automatic card payments');
    }
  };

  // "Retry now": the next try of a declined charge without waiting out the days between tries.
  const retryNow = async (enrollmentId: string, who?: string | null) => {
    setRetrying(enrollmentId);
    try {
      const r: any = await api.post(`/api/memberships/enrollments/${enrollmentId}/retry`, {});
      const result = r?.data?.retryResult ?? r?.retryResult;
      if (result === 'paid') toast.success(`${who || 'The member'}'s card was charged`);
      else toast.error('The card was declined again.');
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Could not try the card again');
    } finally {
      setRetrying(null);
    }
  };

  const saveRetry = async () => {
    if (!retryForm) return;
    setRetryErr({});
    try {
      await api.put('/api/memberships/retry-settings', { tries: Number(retryForm.tries), intervalDays: Number(retryForm.intervalDays) });
      setRetryForm(null);
      toast.success('Saved');
      load();
    } catch (err: any) {
      setRetryErr(err?.data?.fields || {});
      toast.error((err as Error).message || 'Could not save');
    }
  };

  const redeem = async (e: Enrollment) => {
    try {
      await api.post(`/api/memberships/enrollments/${e.id}/redeem`);
      load();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to redeem a credit');
    }
  };

  const activePlans = plans.filter((p) => p.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
            <CreditCard className="w-6 h-6 text-rose-500 dark:text-rose-300" /> Memberships
          </h1>
          <p className="text-gray-500 dark:text-slate-400">Recurring plans and prepaid packages</p>
        </div>
        <div className="flex gap-2">
          {mayEnroll && <button
            onClick={() => setEnrolling(true)}
            disabled={activePlans.length === 0}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
            title={activePlans.length === 0 ? 'Create a plan first' : undefined}
          >
            <UserPlus className="w-4 h-4" /> Enroll Client
          </button>}
          {mayCreatePlan && <button onClick={() => { setEditing(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">
            <Plus className="w-4 h-4" /> New Plan
          </button>}
        </div>
      </div>

      {!loading && retryCfg && (
        <section className="bg-white rounded-xl border p-4 dark:bg-slate-900 dark:border-slate-700" aria-labelledby="declined-heading">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 id="declined-heading" className="font-semibold text-gray-900 dark:text-slate-100">When a card is declined</h2>
              <p className="text-sm text-gray-600 dark:text-slate-300" data-testid="retry-summary">
                The charge is tried up to {retryCfg.tries} time{retryCfg.tries === 1 ? '' : 's'} in all, {retryCfg.intervalDays} day{retryCfg.intervalDays === 1 ? '' : 's'} apart. A backup card on the client's chart is tried straight away when the main card is declined. Staff who can see payments are emailed every time.
              </p>
            </div>
            {retryCfg.mayChange && !retryForm && (
              <button onClick={() => setRetryForm({ tries: String(retryCfg.tries), intervalDays: String(retryCfg.intervalDays) })} className="text-sm text-teal-700 hover:underline dark:text-teal-300">Change</button>
            )}
          </div>
          {retryForm && (
            <div className="mt-3 flex items-end gap-3 flex-wrap">
              <label className="text-sm">
                <span className="block text-gray-700 dark:text-slate-200">Tries in all (the first charge counts)</span>
                <input type="number" min={retryCfg.limits.tries.min} max={retryCfg.limits.tries.max} value={retryForm.tries} onChange={(e) => setRetryForm({ ...retryForm, tries: e.target.value })} className="w-24 px-3 py-2 border rounded-lg" />
                {retryErr.tries && <span className="block text-xs text-red-700 dark:text-red-300" role="alert">{retryErr.tries}</span>}
              </label>
              <label className="text-sm">
                <span className="block text-gray-700 dark:text-slate-200">Days between tries</span>
                <input type="number" min={retryCfg.limits.intervalDays.min} max={retryCfg.limits.intervalDays.max} value={retryForm.intervalDays} onChange={(e) => setRetryForm({ ...retryForm, intervalDays: e.target.value })} className="w-24 px-3 py-2 border rounded-lg" />
                {retryErr.intervalDays && <span className="block text-xs text-red-700 dark:text-red-300" role="alert">{retryErr.intervalDays}</span>}
              </label>
              <button onClick={saveRetry} className="px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800">Save</button>
              <button onClick={() => { setRetryForm(null); setRetryErr({}); }} className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
            </div>
          )}
          {failed.length > 0 && (
            <div className="mt-4" data-testid="failed-charges">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Cards that failed ({failed.length})</h3>
              <ul className="divide-y">
                {failed.map((f) => (
                  <li key={f.invoiceId} className="py-2 flex items-center justify-between gap-3 flex-wrap text-sm">
                    <div>
                      <span className="font-medium text-gray-900 dark:text-slate-100">{f.clientName || 'Member'}</span>
                      <span className="text-gray-600 dark:text-slate-300"> · {f.planName || 'Membership'} · {fmtMoney(f.amount)} · invoice {f.invoiceNumber}</span>
                      <span className="block text-xs text-amber-800 dark:text-amber-200">
                        {f.status === 'needs_action' ? 'Needs the client to approve the charge' : 'Declined'} — try {f.attempt} of {f.tries}{f.backupTried ? ', backup card tried too' : ''}.
                        {f.paused ? ' The membership is paused: resume it once they have a new card.' : f.nextTryAt ? ` Next automatic try ${fmtDate(f.nextTryAt)}.` : ''}
                      </span>
                    </div>
                    {f.canRetryNow && mayAutoCharge && (
                      <button onClick={() => retryNow(f.enrollmentId, f.clientName)} disabled={retrying === f.enrollmentId} className="text-sm text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">{retrying === f.enrollmentId ? 'Trying…' : 'Retry now'}</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {plans.length === 0 ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No membership plans yet</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Same as the service cards: the plan card stayed white in dark mode while its text
                  switched, so "Blowout Club" and "$99 /mo" sat at 1.10:1. The Members table below was
                  already themed correctly, which is why the failure was confined to this card. (T20 H2) */}
              {plans.map((p) => (
                <div key={p.id} className={`bg-white rounded-xl border p-5 flex flex-col dark:bg-slate-900 dark:border-slate-700 ${p.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between">
                    <p className="font-semibold text-gray-900 dark:text-slate-100">{p.name || 'Untitled Plan'}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.active ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' : 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'}`}>
                      {p.active ? 'Active' : 'Retired'}
                    </span>
                  </div>
                  {p.description && <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">{p.description}</p>}
                  <div className="flex items-baseline gap-1 mt-3">
                    <span className="text-2xl font-bold text-gray-900 dark:text-slate-100">{money(p.price)}</span>
                    <span className="text-sm text-gray-500 dark:text-slate-400">{cycleLabel(p.billingCycle)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2 flex items-center gap-2 dark:text-slate-400">
                    <Check className="w-4 h-4 text-teal-500 flex-shrink-0 dark:text-teal-300" />
                    {p.creditsTotal ? `${p.creditsTotal} visit${p.creditsTotal === 1 ? '' : 's'} included` : 'Unlimited / recurring'}
                  </p>
                  <div className="mt-auto pt-3 flex items-center justify-between border-t mt-4">
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {enrollments.filter((e) => e.planId === p.id && e.status === 'active').length} member(s)
                    </span>
                    {mayEditPlan && <div className="flex items-center gap-2">
                      <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1 text-gray-400 hover:text-gray-600" title="Edit"><Edit2 className="w-4 h-4" /></button>
                      {p.active && (
                        <button onClick={() => retire(p)} className="p-1 text-gray-400 hover:text-red-600" title="Retire"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Enrollments */}
          <div className="bg-white rounded-xl border p-5 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-slate-100">
              <Users className="w-4 h-4 text-teal-500 dark:text-teal-300" /> Members
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded-full dark:bg-slate-800 dark:text-slate-400">{enrollmentTotal}</span>
            </h2>
            {enrollmentTotal > enrollments.length && (
              <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">Showing the latest {enrollments.length} of {enrollmentTotal}; member counts below are of these.</p>
            )}
            {enrollments.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">Nobody enrolled yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left dark:bg-slate-900 dark:text-slate-400">
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
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
                          {e.contactId ? (
                            <Link to={`/crm/clients/${e.contactId}`} className="hover:text-teal-700 dark:hover:text-teal-300">{e.clientName || '—'}</Link>
                          ) : (e.clientName || '—')}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{e.planName || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{fmtDate(e.startDate)}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                          {e.creditsRemaining === null || e.creditsRemaining === undefined ? 'Unlimited' : e.creditsRemaining}
                        </td>
                        <td className="px-4 py-3">
                          {e.status === 'active' && hasFeature('card_on_file') && (e.autoCharge || e.lastCharge) && (
                            <span className="mb-1 block text-xs text-gray-600 dark:text-slate-300" data-testid="auto-charge-status">
                              {e.autoCharge ? 'Card charged automatically' : 'Card not charged automatically'}
                              {e.lastCharge && e.lastCharge.status !== 'succeeded' && e.lastCharge.status !== 'pending' && (
                                <span className="block text-amber-800 dark:text-amber-200">Last card charge {e.lastCharge.status === 'needs_action' ? 'needs the client to approve it' : 'was declined'}{e.autoCharge ? ' — will try again' : ''}; the invoice is still open.</span>
                              )}
                            </span>
                          )}
                          {e.status === 'paused' && (
                            <span className="mb-1 block text-xs text-amber-800 dark:text-amber-200" data-testid="paused-note">Paused — the card was declined on every try. The member has been emailed a link to update it; no credits can be used until it is paid.</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${e.status === 'active' && e.creditsRemaining === 0 ? 'bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'}`}>{e.status === 'active' && e.creditsRemaining === 0 ? 'used up' : (e.status || 'active')}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {mayWorkEnrollment && e.status === 'active' && e.creditsRemaining !== null && e.creditsRemaining !== undefined && e.creditsRemaining > 0 && (
                            <button onClick={() => redeem(e)} className="text-xs text-teal-700 hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200">Use a credit</button>
                          )}
                          {mayWorkEnrollment && e.status === 'active' && hasFeature('card_on_file') && e.autoCharge && (
                            <button onClick={() => setAutoCharge(e, false)} className="ml-3 text-xs text-gray-700 hover:underline dark:text-slate-300">Stop charging card</button>
                          )}
                          {mayAutoCharge && e.status === 'active' && !e.autoCharge && (
                            <button onClick={() => setAutoCharge(e, true)} className="ml-3 text-xs text-teal-700 hover:underline dark:text-teal-300">Charge card automatically</button>
                          )}
                          {mayAutoCharge && e.status === 'active' && e.autoCharge && e.lastCharge && (e.lastCharge.status === 'declined' || e.lastCharge.status === 'needs_action') && failed.some((f) => f.enrollmentId === e.id && f.canRetryNow) && (
                            <button onClick={() => retryNow(e.id, e.clientName)} disabled={retrying === e.id} className="ml-3 text-xs text-teal-700 hover:underline disabled:opacity-50 dark:text-teal-300">Retry now</button>
                          )}
                          {mayAutoCharge && e.status === 'paused' && (
                            <button onClick={() => resume(e)} className="ml-3 text-xs text-teal-700 hover:underline dark:text-teal-300">Resume</button>
                          )}
                          {mayWorkEnrollment && (e.status === 'active' || e.status === 'paused') && (
                            <button onClick={() => cancelEnrollment(e)} className="ml-3 text-xs text-red-600 hover:text-red-700 dark:hover:text-red-300 dark:text-red-400">Cancel</button>
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
  const toast = useToast();
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
    if (!form.name.trim()) { toast.error('Plan name is required'); return; }
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
      toast.error((err as Error).message || 'Failed to save plan');
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
            <button aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Name <span className="text-red-700 dark:text-red-400">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Price ($)</label>
                {/* A plan priced below zero produced a card reading "$-10 /mo". (Salon T28 M1) */}
                <input type="number" step="any" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Billing</label>
                <select value={form.billingCycle} onChange={(e) => set('billingCycle', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                  {CYCLES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Visit credits</label>
                <input type="number" min="0" step="1" value={form.creditsTotal} onChange={(e) => set('creditsTotal', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="∞" />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">Leave credits blank for an unlimited or open-ended membership.</p>

            {services.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Included services</label>
                <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={included.includes(s.id)} onChange={() => toggleService(s.id)} className="w-4 h-4" />
                      {s.name || 'Untitled'}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input id="planActive" type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="w-4 h-4" />
              <label htmlFor="planActive" className="text-sm font-medium text-gray-700 dark:text-slate-200">Active</label>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50">
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
  const toast = useToast();
  const { hasFeature } = useAuth();
  const { known, can } = usePermissions();
  const mayAutoCharge = hasFeature('card_on_file') && known && can('invoices:update');
  const [autoCharge, setAutoCharge] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactId, setContactId] = useState<string>('');
  const [planId, setPlanId] = useState<string>(plans[0]?.id || '');
  const [startDate, setStartDate] = useState<string>(todayStr());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId) { toast.error('A client is required'); return; }
    if (!planId) { toast.error('A plan is required'); return; }
    setSaving(true);
    try {
      // Credits are seeded from the plan by the backend, so they are not sent here.
      await api.post('/api/memberships/enrollments', { contactId, planId, startDate, ...(autoCharge ? { autoCharge: true, clientAgreed: true } : {}) });
      onSave();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to enroll client');
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
            <h2 className="text-lg font-bold flex items-center gap-2"><UserPlus className="w-5 h-5 text-teal-700 dark:text-teal-300" /> Enroll Client</h2>
            <button aria-label="Close" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Client <span className="text-red-700 dark:text-red-400">*</span></label>
              <ClientPicker value={contactId} onChange={(id) => setContactId(id)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Plan <span className="text-red-700 dark:text-red-400">*</span></label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name || 'Untitled'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            {mayAutoCharge && (
              <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200">
                <input type="checkbox" checked={autoCharge} onChange={(e) => setAutoCharge(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>
                  The client agrees to be charged this plan&rsquo;s price to their card on file each period.
                  <span className="block text-xs text-gray-600 dark:text-slate-300">They need a card on their chart first. It is charged on your own Stripe account, and they are emailed a receipt. If a charge is declined it is tried again, then the invoice is left open for you.</span>
                </span>
              </label>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-teal-700 text-white rounded-lg hover:bg-teal-800 disabled:opacity-50">
                {saving ? 'Enrolling...' : 'Enroll'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
