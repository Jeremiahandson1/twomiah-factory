import { useState, useEffect, createContext, useContext } from 'react';
import {
  FileText, Plus, Search, Calendar, DollarSign, Users,
  AlertTriangle, RefreshCw, XCircle, Clock, Star, TrendingUp,
  Loader2, Edit2, ChevronRight, CalendarPlus, Check
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgreementsApi, AgreementsPageProps } from './types';
import { useConfirm } from '../ui/ConfirmProvider'
import { useMayWrite } from '../auth/PermissionsContext'

// UTC-safe date formatting (carried from templates' utils/date). Date-only values stored as UTC midnight
// are parsed at LOCAL midnight so viewers west of UTC don't shift a day back.
function formatDate(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '';
  let d: Date;
  if (value instanceof Date) { d = value; }
  else {
    const s = String(value);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s) || /T00:00:00(\.000)?Z?$/.test(s);
    d = dateOnly ? new Date(s.slice(0, 10) + 'T00:00:00') : new Date(s);
  }
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

// api + the recurrence flag are injected once at the page root; child components read them via useAgreements().
const AgreementsCtx = createContext<{ api: AgreementsApi; recurrence: boolean }>({ api: null as any, recurrence: false });
const useAgreements = () => useContext(AgreementsCtx);

interface AgreementContact {
  name?: string;
  email?: string;
  phone?: string;
}

interface AgreementPlan {
  name?: string;
}

interface Agreement {
  id: string;
  status: string;
  contact?: AgreementContact;
  plan?: AgreementPlan;
  /** null when the plan sets no visit allowance — not the same as none left. (T41) */
  visitsRemaining?: number | null;
  visitsIncluded?: number;
  visitsCompleted?: number;
  visitsScheduled?: number;
  endDate: string;
  amount: string | number; // the agreement's billed amount per period (the API field; there is no "price")
  billingFrequency: string;
  planId?: string;
  contactId?: string;
  startDate?: string;
  autoRenew?: boolean;
  renewalType?: 'auto' | 'manual' | string; // the API field (there is no autoRenew on an agreement)
  autoSchedule?: boolean;
  recurrenceRule?: { frequency?: string } | null;
  nextServiceDate?: string | null;
  reminderDaysBefore?: number;
}

interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  billingFrequency: string;
  visitsIncluded: number;
  discountPercent: number;
  priorityService: boolean;
  durationMonths: number;
  autoRenew: boolean;
  active: boolean;
  _count?: { agreements?: number };
}

interface AgreementStats {
  activeAgreements: number;
  expiringIn30Days: number;
  renewingIn30Days?: number;
  monthlyRecurringRevenue?: number;
  annualRecurringRevenue?: number;
}

interface Visit {
  id: string;
  scheduledDate: string;
  serviceType?: string;
  agreement?: {
    contact?: AgreementContact;
    plan?: AgreementPlan;
  };
}

interface Contact {
  id: string;
  name: string;
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color?: string;
}

interface AgreementRowProps {
  agreement: Agreement;
  onView: () => void;
  onRenew: () => void;
}

interface PlansTabProps {
  plans: Plan[];
  onEdit: (plan: Plan) => void;
  onRefresh: () => void;
}

interface PlanFormModalProps {
  plan: Plan | null;
  onSave: () => void;
  onClose: () => void;
}

interface AgreementFormModalProps {
  agreement: Agreement | null;
  plans: Plan[];
  onSave: () => void;
  onClose: () => void;
}

/**
 * Service Agreements / Memberships Page
 */
export default function AgreementsPage({ api, config }: AgreementsPageProps) {
  /**
   * THREE BUTTONS THAT ONLY EVER LED TO A 403. (T41)
   *
   *   "Field service and Showcase (New Plan, Bill due agreements, New Agreement)." … "The server is
   *    right every time. The UI just doesn't hide what the role can't do."
   *   "Email shown in the staff nav but says no access; Agreements buttons 403 for staff."
   *
   * Each asks the permission ITS OWN endpoint asks, read off
   * packages/tenant-backend/src/agreements/agreements.ts — not a plausible guess:
   *
   *   New Plan              POST /plans         agreements:create
   *   New Agreement         POST /              agreements:create
   *   Bill due agreements   POST /billing/run   invoices:create   ← raises real invoices, so it is
   *                                                                 the INVOICING right, not this
   *                                                                 module's. A manager holds both;
   *                                                                 a technician holds neither.
   *   Edit plan             PUT /plans/:id      agreements:update
   *   Renew                 POST /:id/renew     agreements:update
   *
   * `useMayWrite` offers a control unless we KNOW the person would be refused — crm-roof and
   * crm-store mount no permissions provider, and hiding these from everybody there, the owner
   * included, would be a worse bug than the one being fixed.
   */
  const mayCreate = useMayWrite('agreements:create')
  const mayUpdate = useMayWrite('agreements:update')
  const mayBill = useMayWrite('invoices:create')
  const confirm = useConfirm()
  const [tab, setTab] = useState<string>('agreements'); // agreements, plans, visits
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<AgreementStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [showPlanForm, setShowPlanForm] = useState<boolean>(false);
  const [showAgreementForm, setShowAgreementForm] = useState<boolean>(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const runBilling = async () => {
    try {
      const result = await api.post('/api/agreements/billing/run', {});
      const failed = (result?.failures || []).length;
      alert(`Billed ${result?.invoiced ?? 0} agreement(s), charged ${result?.charged ?? 0}` + (failed ? `, ${failed} failed` : ''));
      loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not run billing');
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [agreementsRes, plansRes, statsRes] = await Promise.all([
        api.get(`/api/agreements?status=${statusFilter}`),
        api.get('/api/agreements/plans'),
        api.get('/api/agreements/reports/stats'),
      ]);
      setAgreements(agreementsRes.data || []);
      setPlans(plansRes || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load agreements:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAgreements = agreements.filter((a: Agreement) =>
    !search ||
    a.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.plan?.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AgreementsCtx.Provider value={{ api, recurrence: !!config?.recurrence }}>
    <div className="space-y-6">
      {/* Header */}
      {/* MEASURED, not guessed: at 390px this header row was the whole page's sideways scroll —
          three buttons and a title in a nowrap flex, documentElement.scrollWidth 510 against a
          390px viewport, the "New Agreement" button's right edge at 510. (T41 "Agreements header
          510px") Wrapping costs nothing above the breakpoint, where it never wraps. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Service Agreements</h1>
          <p className="text-gray-500 dark:text-slate-400">Manage maintenance memberships</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mayCreate && (
            <button
              onClick={() => { setSelectedPlan(null); setShowPlanForm(true); }}
              className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              <FileText className="w-4 h-4" />
              New Plan
            </button>
          )}
          {mayBill && (
            <button onClick={runBilling} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200">

              Bill due agreements

            </button>
          )}
          {mayCreate && (
            <button
              onClick={() => { setSelectedAgreement(null); setShowAgreementForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
            >
              <Plus className="w-4 h-4" />
              New Agreement
            </button>
          )}
        </div>
      </div>

      {/* Stats — the two revenue tiles are ABSENT for a seat that may not see the money, not
          drawn as "$0". (T42, fleet-wide: "Hidden money shown as \$0 instead of hidden … Showcase
          agreement tiles ('\$0 Monthly Revenue'). Hide the tiles instead.")

          The server has stripped `monthlyRecurringRevenue` / `annualRecurringRevenue` for the field
          rung since T41 — the counts stay, the revenue goes — and these two StatCards then read
          `stats.monthlyRecurringRevenue?.toLocaleString(…) || 0`, which renders "$0" for an absent
          key. A technician was being told the shop's recurring revenue was nothing, which is a
          FIGURE, and a wrong one; a missing tile is not. Keyed on the key's presence rather than on
          a permission, so the screen and the payload cannot disagree. */}
      {stats && (
        <div className={`grid grid-cols-2 gap-4 ${stats.monthlyRecurringRevenue === undefined ? 'lg:grid-cols-3' : 'lg:grid-cols-5'}`}>
          <StatCard
            icon={FileText}
            label="Active Agreements"
            value={stats.activeAgreements}
          />
          <StatCard
            icon={AlertTriangle}
            label="Expiring in 30 Days"
            value={stats.expiringIn30Days}
            color="orange"
          />
          <StatCard
            icon={RefreshCw}
            label="Renewing in 30 Days"
            value={stats.renewingIn30Days ?? 0}
            color="blue"
          />
          {stats.monthlyRecurringRevenue !== undefined && (
            <StatCard
              icon={DollarSign}
              label="Monthly Revenue"
              value={`$${stats.monthlyRecurringRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="green"
            />
          )}
          {stats.annualRecurringRevenue !== undefined && (
            <StatCard
              icon={TrendingUp}
              label="Annual Revenue"
              value={`$${stats.annualRecurringRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="blue"
            />
          )}
        </div>
      )}

      {/* Tabs — the row SCROLLS rather than pushing the page. Three tabs with icons come to 364px
          inside a 358px column, so after the header was wrapped this strip was the last 6px of
          sideways scroll left on Agreements in all three verticals that mount it. (T41) */}
      <div className="flex gap-2 border-b overflow-x-auto">
        {[
          { id: 'agreements', label: 'Agreements', icon: FileText },
          { id: 'plans', label: 'Plans', icon: Star },
          { id: 'visits', label: 'Upcoming Visits', icon: Calendar },
        ].map((t: { id: string; label: string; icon: LucideIcon }) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
              tab === t.id
                ? 'border-orange-500 text-orange-600 dark:text-orange-300'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Agreements Tab */}
      {tab === 'agreements' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                placeholder="Search agreements..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
              <option value="">All</option>
            </select>
          </div>

          {/* Agreements List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-x-auto dark:bg-slate-900">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-900">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Customer</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Plan</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Status</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Visits</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Expires</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Autopay</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Price</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAgreements.map((agreement: Agreement) => (
                    <AgreementRow
                      onChanged={loadData}
                      key={agreement.id}
                      agreement={agreement}
                      onView={() => { setSelectedAgreement(agreement); }}
                      onRenew={() => handleRenew(agreement.id)}
                    />
                  ))}
                </tbody>
              </table>
              {filteredAgreements.length === 0 && (
                <div className="text-center py-12 text-gray-500 dark:text-slate-400">
                  No agreements found
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Plans Tab */}
      {tab === 'plans' && (
        <PlansTab
          plans={plans}
          onEdit={(plan: Plan) => { setSelectedPlan(plan); setShowPlanForm(true); }}
          onRefresh={loadData}
        />
      )}

      {/* Visits Tab */}
      {tab === 'visits' && (
        <VisitsTab />
      )}

      {/* Modals */}
      {showPlanForm && (
        <PlanFormModal
          plan={selectedPlan}
          onSave={() => { setShowPlanForm(false); loadData(); }}
          onClose={() => setShowPlanForm(false)}
        />
      )}

      {showAgreementForm && (
        <AgreementFormModal
          agreement={selectedAgreement}
          plans={plans}
          onSave={() => { setShowAgreementForm(false); loadData(); }}
          onClose={() => setShowAgreementForm(false)}
        />
      )}
    </div>
    </AgreementsCtx.Provider>
  );

  async function handleRenew(agreementId: string) {
    if (!(await confirm('Renew this agreement for another term?', { title: 'Renew agreement', confirmText: 'Renew it', danger: false }))) return;
    try {
      await api.post(`/api/agreements/${agreementId}/renew`);
      loadData();
    } catch (error) {
      alert('Failed to renew agreement');
    }
  }
}

/**
 * THE TILES STAYED LIGHT-COLOURED IN DARK MODE. (T41: "Agreements tiles stay light (3.57:1)")
 *
 * Each entry set only `bg-X-50 text-X-700` — a pale tint with mid-dark ink, which is a correct
 * pairing on a white page and a near-white block on a dark one. It is the same defect the shared
 * Equipment page's tiles had (T32 M14) and the fix is the same shape: each tint names its dark
 * counterpart, so the tile stays a tint OF ITS OWN HUE rather than turning grey, and the ink moves
 * to the light end of that hue.
 *
 * This is the shared Agreements page, so it is every vertical that sells maintenance plans, not
 * just the one the report happened to open.
 */
function StatCard({ icon: Icon, label, value, color = 'gray' }: StatCardProps) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-700 dark:bg-slate-800 dark:text-slate-200',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

/**
 * Autopay for one agreement. Charging needs a card on file — the customer adds
 * one from the Payment Method screen in their portal.
 */
function AutopayToggle({ agreement, onChanged }: { agreement: Agreement; onChanged?: () => void }) {
  const { api } = useAgreements();
  // PUT /:id/autopay asks agreements:update. DISABLED rather than hidden, unlike the buttons above:
  // the switch is also the only place the page SHOWS whether autopay is on, and a technician looking
  // at an agreement should still be able to see that. Hiding it would remove the fact, not the write.
  const mayUpdate = useMayWrite('agreements:update');
  const [busy, setBusy] = useState(false);
  const on = (agreement as unknown as { autopay?: boolean }).autopay === true;
  const lastError = (agreement as unknown as { autopayLastError?: string | null }).autopayLastError;

  const toggle = async () => {
    setBusy(true);
    try {
      await api.put(`/api/agreements/${agreement.id}/autopay`, { enabled: !on });
      // page convention: alert() for anything the owner must notice
      onChanged?.();
    } catch (err: unknown) {
      // The API explains exactly why (usually: no saved card yet) — say that.
      alert(err instanceof Error ? err.message : 'Could not change autopay');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || agreement.status !== 'active' || !mayUpdate}
        title={!mayUpdate ? (on ? 'Autopay is on. Changing it needs permission to edit agreements.' : 'Autopay is off. Changing it needs permission to edit agreements.')
          : agreement.status !== 'active' ? 'Only active agreements can autopay' : 'Charge the customer automatically each billing period'}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-700 dark:text-slate-100'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
      {lastError && (
        <p className="mt-1 text-[11px] text-red-600 max-w-[12rem] dark:text-red-400" title={lastError}>Last charge failed</p>
      )}
    </div>
  );
}

/** What the Visits column says: the allowance left this term, else what has been done. (T41) */
function visitsLabel(a: Agreement): string {
  const included = Number(a.visitsIncluded || 0);
  if (included > 0) return `${a.visitsRemaining ?? 0} of ${included} left`;
  const done = Number(a.visitsCompleted || 0) + Number(a.visitsScheduled || 0);
  return done > 0 ? `${done} booked` : 'No visit cap';
}

/** The breakdown behind that figure, so the number is never the only thing on offer. */
function visitsDetail(a: Agreement): string {
  const parts = [`${Number(a.visitsCompleted || 0)} done`, `${Number(a.visitsScheduled || 0)} booked`];
  if (Number(a.visitsIncluded || 0) > 0) parts.push(`${a.visitsIncluded} included each term`);
  else parts.push('this plan sets no visit allowance');
  return `This term: ${parts.join(', ')}`;
}

function AgreementRow({ agreement, onView, onRenew, onChanged }: AgreementRowProps & { onChanged?: () => void }) {
  const { api } = useAgreements();
  // POST /:id/renew asks agreements:update, and so does the autopay toggle below (PUT /:id/autopay).
  const mayUpdate = useMayWrite('agreements:update');
  const endingSoon = agreement.status === 'active' && new Date(agreement.endDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isExpiringSoon = endingSoon && agreement.renewalType !== 'auto'; // auto-renew agreements renew instead
  const renewsSoon = endingSoon && agreement.renewalType === 'auto';

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
    pending: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
    expired: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
    cancelled: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  };

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-slate-800">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900 dark:text-slate-100">{agreement.contact?.name}</p>
        <p className="text-sm text-gray-500 dark:text-slate-400">{agreement.contact?.email}</p>
      </td>
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900 dark:text-slate-100">{agreement.plan?.name}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 rounded-full text-xs ${statusColors[agreement.status]}`}>
          {agreement.status}
        </span>
      </td>
      {/*
        THIS CELL READ " remaining". (T41)

        `{agreement.visitsRemaining} remaining` — and nothing computed visitsRemaining, so React
        rendered the undefined as nothing and every row in every tenant said the word with no figure
        in front of it. The server now sends the allowance, what is booked and what is done; this
        says which, and says "no visit cap" rather than "0 remaining" when the plan sets none.
      */}
      <td className="px-4 py-3 text-sm" title={visitsDetail(agreement)}>
        {visitsLabel(agreement)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {isExpiringSoon && agreement.status === 'active' && (
            <AlertTriangle className="w-4 h-4 text-orange-500 dark:text-orange-300" />
          )}
          <span className={`text-sm ${isExpiringSoon ? 'text-orange-600 dark:text-orange-300' : 'text-gray-500 dark:text-slate-400'}`}>
            {formatDate(agreement.endDate)}
          </span>
          {renewsSoon && <span className="text-xs text-blue-600 dark:text-blue-400">Renews</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        <AutopayToggle agreement={agreement} onChanged={onChanged} />
      </td>
      <td className="px-4 py-3 text-right font-medium">
        ${(Number(agreement.amount) || 0).toFixed(2)}
        <span className="text-xs text-gray-500 ml-1 dark:text-slate-400">/{agreement.billingFrequency}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          {agreement.status === 'active' && mayUpdate && (
            <button
              onClick={onRenew}
              className="p-1.5 text-green-700 hover:bg-green-50 rounded dark:text-green-300"
              title="Renew"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onView}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function PlansTab({ plans, onEdit, onRefresh }: PlansTabProps) {
  const { api } = useAgreements();
  // Asked here rather than threaded down from the page: useMayWrite is a hook, so the component that
  // draws the control asks the question itself and there is no prop to forget. (T41)
  const mayUpdate = useMayWrite('agreements:update');
  return (
    <div className="grid grid-cols-3 gap-6">
      {plans.map((plan: Plan) => (
        <div key={plan.id} className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{plan.name}</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">{plan._count?.agreements || 0} active</p>
            </div>
            {mayUpdate && (
              <button
                onClick={() => onEdit(plan)}
                className="p-1 text-gray-400 hover:text-gray-600"
                aria-label={`Edit ${plan.name}`}
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="text-3xl font-bold text-gray-900 mb-4 dark:text-slate-100">
            ${(Number(plan.price) || 0).toFixed(0)}
            <span className="text-base font-normal text-gray-500 dark:text-slate-400">/{plan.billingFrequency}</span>
          </div>

          {plan.description && (
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">{plan.description}</p>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500 dark:text-green-300" />
              <span>{plan.visitsIncluded} visits included</span>
            </div>
            {plan.discountPercent > 0 && (
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500 dark:text-green-300" />
                <span>{plan.discountPercent}% member discount</span>
              </div>
            )}
            {plan.priorityService && (
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500 dark:text-green-300" />
                <span>Priority scheduling</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500 dark:text-green-300" />
              <span>{plan.durationMonths} month term</span>
            </div>
          </div>
        </div>
      ))}

      {plans.length === 0 && (
        <div className="col-span-3 text-center py-12 text-gray-500 dark:text-slate-400">
          No plans created yet
        </div>
      )}
    </div>
  );
}

function VisitsTab() {
  const { api } = useAgreements();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadVisits();
  }, []);

  const loadVisits = async () => {
    try {
      const data = await api.get('/api/agreements/visits/upcoming');
      setVisits(data || []);
    } catch (error) {
      console.error('Failed to load visits:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border dark:bg-slate-900">
      <div className="p-4 border-b">
        <h3 className="font-medium text-gray-900 dark:text-slate-100">Upcoming Service Visits</h3>
      </div>
      {visits.length === 0 ? (
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">
          No upcoming visits
        </div>
      ) : (
        <div className="divide-y">
          {visits.map((visit: Visit) => (
            <div key={visit.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  {visit.agreement?.contact?.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {visit.agreement?.plan?.name} - {visit.serviceType || 'Maintenance'}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900 dark:text-slate-100">
                  {formatDate(visit.scheduledDate)}
                </p>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {visit.agreement?.contact?.phone}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanFormModal({ plan, onSave, onClose }: PlanFormModalProps) {
  const { api } = useAgreements();
  const [form, setForm] = useState<{
    name: string;
    description: string;
    price: string | number;
    billingFrequency: string;
    visitsIncluded: string | number;
    discountPercent: string | number;
    priorityService: boolean;
    durationMonths: string | number;
    autoRenew: boolean;
  }>({
    name: plan?.name || '',
    description: plan?.description || '',
    price: plan?.price || '',
    billingFrequency: plan?.billingFrequency || 'annual',
    visitsIncluded: plan?.visitsIncluded || 2,
    discountPercent: plan?.discountPercent || 10,
    priorityService: plan?.priorityService || false,
    durationMonths: plan?.durationMonths || 12,
    autoRenew: plan?.autoRenew ?? true,
  });
  const [saving, setSaving] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // The number fields hold text while they are typed — coercing on every keystroke drops a minus
    // sign in silence, because a lone "-" reads back as "" from a number input and Number("") is 0.
    // They become numbers here, once, and a figure that is not one is refused rather than replaced.
    const payload = {
      ...form,
      price: Number(form.price),
      visitsIncluded: Number(form.visitsIncluded),
      discountPercent: Number(form.discountPercent),
      durationMonths: Number(form.durationMonths),
    };
    for (const [k, v] of [['Price', payload.price], ['Visits included', payload.visitsIncluded],
      ['Discount %', payload.discountPercent], ['Term (months)', payload.durationMonths]] as Array<[string, number]>) {
      if (!Number.isFinite(v) || v < 0) { alert(`${k} must be zero or more`); return; }
    }
    setSaving(true);
    try {
      if (plan) {
        await api.put(`/api/agreements/plans/${plan.id}`, payload);
      } else {
        await api.post('/api/agreements/plans', payload);
      }
      onSave();
    } catch (error) {
      alert('Failed to save plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold mb-4">{plan ? 'Edit Plan' : 'Create Plan'}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Plan Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., HVAC Maintenance Plan"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
              <textarea
                value={form.description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Price</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, price: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Billing</label>
                <select
                  value={form.billingFrequency}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, billingFrequency: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                {/* Per TERM, not per year — the term is this plan's own Duration below, and the
                    allowance the Visits column counts against is the term's. (T41) */}
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Visits per term</label>
                <input
                  type="number"
                  value={form.visitsIncluded}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, visitsIncluded: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Discount %</label>
                <input
                  type="number"
                  value={form.discountPercent}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, discountPercent: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Term (months)</label>
                <input
                  type="number"
                  value={form.durationMonths}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, durationMonths: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.priorityService}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, priorityService: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500 dark:text-orange-300"
                />
                <span className="text-sm text-gray-700 dark:text-slate-200">Priority Service</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.autoRenew}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, autoRenew: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500 dark:text-orange-300"
                />
                <span className="text-sm text-gray-700 dark:text-slate-200">Auto-Renew</span>
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AgreementFormModal({ agreement, plans, onSave, onClose }: AgreementFormModalProps) {
  const { api, recurrence } = useAgreements();
  const defaultNextDate = new Date();
  defaultNextDate.setDate(defaultNextDate.getDate() + 30);
  const [form, setForm] = useState<{
    planId: string;
    contactId: string;
    startDate: string;
    autoRenew: boolean;
    autoSchedule: boolean;
    recurrenceFrequency: string;
    nextServiceDate: string;
    reminderDaysBefore: string | number;
  }>({
    planId: agreement?.planId || '',
    contactId: agreement?.contactId || '',
    startDate: agreement?.startDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    autoRenew: agreement?.renewalType ? agreement.renewalType === 'auto' : true,
    autoSchedule: agreement?.autoSchedule ?? false,
    recurrenceFrequency: agreement?.recurrenceRule?.frequency || 'quarterly',
    nextServiceDate: agreement?.nextServiceDate?.split('T')[0] || defaultNextDate.toISOString().split('T')[0],
    reminderDaysBefore: agreement?.reminderDaysBefore ?? 7,
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const data = await api.get('/api/contacts?limit=100');
      setContacts(data.data || []);
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Contractor crm sent the whole form; the field-service build sends the core fields and saves
      // recurrence separately. Build the same core payload for both.
      const payload: Record<string, unknown> = {
        planId: form.planId,
        contactId: form.contactId,
        startDate: form.startDate,
        autoRenew: form.autoRenew,
      };
      const saveRecurrence = async (id: string, on: boolean) => {
        await api.put(`/api/agreements/${id}/recurrence`, {
          recurrenceRule: { frequency: form.recurrenceFrequency },
          nextServiceDate: form.nextServiceDate,
          autoSchedule: on,
          reminderDaysBefore: Number(form.reminderDaysBefore) || 0,
        });
      };
      if (agreement) {
        await api.put(`/api/agreements/${agreement.id}`, payload);
        if (recurrence && (form.autoSchedule || agreement.autoSchedule)) {
          await saveRecurrence(agreement.id, form.autoSchedule);
        }
      } else {
        const created = await api.post('/api/agreements', payload);
        if (recurrence && form.autoSchedule && created?.id) {
          await saveRecurrence(created.id, true);
        }
      }
      onSave();
    } catch (error) {
      alert(error instanceof Error && error.message ? error.message : 'Failed to save agreement');
    } finally {
      setSaving(false);
    }
  };

  const reminderDate = form.autoSchedule && form.nextServiceDate
    ? (() => { const d = new Date(form.nextServiceDate); d.setDate(d.getDate() - (Number(form.reminderDaysBefore) || 0)); return d.toLocaleDateString(); })()
    : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold mb-4">{agreement ? 'Edit Agreement' : 'New Agreement'}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Customer</label>
              <select
                value={form.contactId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select customer...</option>
                {contacts.map((c: Contact) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Plan</label>
              <select
                value={form.planId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, planId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select plan...</option>
                {plans.filter((p: Plan) => p.active).map((p: Plan) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - ${(Number(p.price) || 0).toFixed(0)}/{p.billingFrequency}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, autoRenew: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500 dark:text-orange-300"
              />
              <span className="text-sm text-gray-700 dark:text-slate-200">Auto-renew when term ends</span>
            </label>

            {/* Scheduling — fs / landscaping maintenance contracts (config.recurrence) */}
            {recurrence && (
            <div className="border-t pt-4 mt-4">
              <label className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  checked={form.autoSchedule}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, autoSchedule: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500 dark:text-orange-300"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-slate-200">Auto-schedule recurring visits</span>
              </label>

              {form.autoSchedule && (
                <div className="space-y-3 pl-6 border-l-2 border-orange-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Frequency</label>
                    <select
                      value={form.recurrenceFrequency}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, recurrenceFrequency: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="biannual">Every 6 Months</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Next Service Date</label>
                    <input
                      type="date"
                      value={form.nextServiceDate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, nextServiceDate: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Generate job this many days before visit</label>
                    <input
                      type="number"
                      value={form.reminderDaysBefore}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, reminderDaysBefore: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      min="0"
                      max="60"
                    />
                  </div>

                  {reminderDate && (
                    <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800 dark:text-blue-300 dark:bg-blue-950/40">
                      <p>Next visit: <strong>{formatDate(form.nextServiceDate)}</strong></p>
                      <p>Job will be created on: <strong>{reminderDate}</strong></p>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Create Agreement'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
