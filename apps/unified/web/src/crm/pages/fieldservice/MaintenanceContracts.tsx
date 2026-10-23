// Moved from templates/crm-fieldservice/frontend/src/pages/fieldservice/MaintenanceContracts.tsx.
import { useState, useEffect } from 'react'
import { formatDate } from '../../date'
import { daysUntilDay } from '@twomiah/tenant-ui/src/time/companyClock'
import {
  FileText, Plus, Search, Calendar, DollarSign, Users,
  AlertTriangle, RefreshCw, XCircle, Clock, Loader2,
  Edit2, ChevronRight, Check, X,
  type LucideIcon,
} from 'lucide-react';
import type { FormEvent } from 'react'
import { api } from '../../../api'
import { useToast, useConfirm } from '../../../shared'
import { useMayWrite } from '../../../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { CUSTOMER_PICKER_PARAMS, customersOnly } from '@twomiah/tenant-ui/src/contacts/types'
import { todayKey } from '@twomiah/tenant-ui/src/time/day'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

/** The server's own words when it refused (the API client puts its `error` on `.message`), else the fallback. */
const serverMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'semi-annual', 'annual'] as const;
const CONTRACT_STATUSES = ['active', 'expired', 'cancelled', 'pending'] as const;

/** A plan, as GET /api/agreements/plans returns it (a bare array). `price` is withheld without invoices:read. */
interface AgreementPlan {
  id: string;
  name: string;
  price?: string | number;
  billingFrequency?: string | null;
  visitsIncluded?: number | null;
}

/** A row of GET /api/agreements (tenant-backend agreements.ts withRelations). `amount` is withheld without invoices:read. */
interface Contract {
  id: string;
  number?: string | null;
  name?: string | null;
  status: string;
  contactId: string;
  planId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  nextServiceDate?: string | null;
  renewalType?: 'auto' | 'manual' | string | null;
  billingFrequency?: string | null;
  amount?: string | number;
  contact?: { id: string; name: string; email?: string | null; phone?: string | null } | null;
  plan?: AgreementPlan | null;
  /** This term's visits (tenant-backend agreements.ts withRelations): the plan's allowance, booked and done. */
  visitsIncluded?: number;
  visitsScheduled?: number;
  visitsCompleted?: number;
}

/**
 * What the Visits column says. A plan with an allowance puts its term's visits on the Schedule when the contract is made
 * (server scheduleTermVisits; live test 2026-10-22: "a contract with 2 visits a year should create visit jobs").
 */
const visitsText = (c: Contract) => {
  const included = Number(c.visitsIncluded || 0), booked = Number(c.visitsScheduled || 0), done = Number(c.visitsCompleted || 0)
  if (included > 0) return `${booked} booked · ${done} done of ${included}`
  return booked + done > 0 ? `${booked} booked · ${done} done` : 'Booked by hand'
}

/** A row of GET /api/contacts — the picker reads the id and the name. */
interface ContactOption {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  expired: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
  cancelled: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  pending: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
};

/**
 * Maintenance Contracts — Recurring maintenance contract management
 */
export default function MaintenanceContracts() {
  const toast = useToast();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  // Each control asks its route's question (POST /api/agreements agreements:create; PUT, renew agreements:update),
  // and the money asks invoices:read — the server sends no `amount` without it, and this page drew "$0.00" for
  // every contract and a $0.00 Monthly Revenue. (T62: "Landscaping Maintenance Contracts 'New Contract'";
  // "Agreements prices … drawn as $0")
  const mayCreate = useMayWrite('agreements:create');
  const mayUpdate = useMayWrite('agreements:update');
  const maySeeMoney = useMayWrite('invoices:read');
  const confirm = useConfirm();

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      // A list ({ data, pagination }), 50 a page by default; this screen has no pager and counts its tiles from
      // what it holds, so it asks for 200.
      const res = await api.get('/api/agreements', { status: statusFilter || undefined, limit: 200 });
      setContracts(Array.isArray(res?.data) ? (res.data as Contract[]) : []);
    } catch (error) {
      console.error('Failed to load contracts:', error);
      toast.error('Failed to load maintenance contracts');
    } finally {
      setLoading(false);
    }
  };

  const filteredContracts = contracts.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.contact?.name?.toLowerCase().includes(q) ||
      c.plan?.name?.toLowerCase().includes(q)
    );
  });

  const stats = {
    active: contracts.filter(c => c.status === 'active').length,
    expiringSoon: contracts.filter(c => {
      if (c.status !== 'active' || c.renewalType === 'auto') return false; // auto-renew contracts renew, they don't expire
      if (!c.endDate) return false;
      const end = new Date(c.endDate);
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return end <= thirtyDays;
    }).length,
    monthlyRevenue: contracts
      .filter(c => c.status === 'active')
      .reduce((sum, c) => {
        const price = Number(c.amount) || 0;
        if (c.billingFrequency === 'monthly') return sum + price;
        if (c.billingFrequency === 'quarterly') return sum + price / 3;
        if (c.billingFrequency === 'semi-annual') return sum + price / 6;
        if (c.billingFrequency === 'annual') return sum + price / 12;
        return sum + price;
      }, 0),
    total: contracts.length,
  };

  const handleRenew = async (contractId: string) => {
    if (!(await confirm('It runs for another year from its current end date.', { title: 'Renew this contract?', confirmText: 'Renew', danger: false }))) return;
    try {
      await api.post(`/api/agreements/${contractId}/renew`);
      toast.success('Contract renewed');
      loadData();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to renew contract'));
    }
  };

  const handleCancel = async (contractId: string) => {
    if (!(await confirm('The contract is marked cancelled.', { title: 'Cancel this maintenance contract?', confirmText: 'Cancel contract' }))) return;
    try {
      // The cancel route, not a status edit: it also stops the agreement's Stripe subscription.
      await api.post(`/api/agreements/${contractId}/cancel`, {});
      toast.success('Contract cancelled');
      loadData();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to cancel contract'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Maintenance Contracts</h1>
          <p className="text-gray-500 dark:text-slate-400">Recurring service agreements</p>
        </div>
        {mayCreate && <button
          onClick={() => { setSelectedContract(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          New Contract
        </button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Active Contracts" value={stats.active} />
        <StatCard icon={AlertTriangle} label="Expiring Soon" value={stats.expiringSoon} color="orange" />
        {maySeeMoney && <StatCard
          icon={DollarSign}
          label="Monthly Revenue"
          value={`${money(stats.monthlyRevenue)}`}
          color="green"
        />}
        <StatCard icon={Users} label="Total Contracts" value={stats.total} color="blue" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or plan..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
        >
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
          <option value="pending">Pending</option>
          <option value="">All Statuses</option>
        </select>
      </div>

      {/* Contracts Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Plan</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Next Service</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Visits this term</th>
                {maySeeMoney && <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Amount</th>}
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Expires</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {filteredContracts.map(contract => {
                const endingSoon =
                  contract.status === 'active' && !!contract.endDate &&
                  daysUntilDay(contract.endDate) <= 30;
                const isExpiringSoon = endingSoon && contract.renewalType !== 'auto';
                const renewsSoon = endingSoon && contract.renewalType === 'auto';

                return (
                  <tr key={contract.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {contract.contact?.name || 'Unknown Customer'}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {contract.contact?.email || contract.contact?.phone || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {contract.plan?.name || contract.name || '-'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {contract.billingFrequency || contract.plan?.billingFrequency || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700 dark:text-slate-300">
                        {contract.nextServiceDate
                          ? formatDate(contract.nextServiceDate)
                          : '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{visitsText(contract)}</td>
                    {maySeeMoney && <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {money(Number(contract.amount || 0))}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        /{contract.billingFrequency || 'mo'}
                      </p>
                    </td>}
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[contract.status] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>
                        {codeLabel(contract.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {isExpiringSoon && (
                          <AlertTriangle className="w-4 h-4 text-orange-500 dark:text-orange-200" />
                        )}
                        <span className={`text-sm ${isExpiringSoon ? 'text-orange-600 dark:text-orange-200' : 'text-gray-500 dark:text-slate-400'}`}>
                          {contract.endDate
                            ? formatDate(contract.endDate)
                            : '-'}
                        </span>
                        {renewsSoon && <span className="text-xs text-blue-600 dark:text-blue-400">Renews</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {mayUpdate && contract.status === 'active' && (
                          <button
                            onClick={() => handleRenew(contract.id)}
                            className="p-1.5 text-green-700 hover:bg-green-50 dark:hover:bg-green-500/10 rounded dark:text-green-300"
                            title="Renew"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        {mayUpdate && <button
                          onClick={() => { setSelectedContract(contract); setShowForm(true); }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>}
                        {mayUpdate && contract.status === 'active' && (
                          <button
                            onClick={() => handleCancel(contract.id)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded"
                            title="Cancel"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredContracts.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-slate-400">
              No contracts found
            </div>
          )}
        </div>
      )}

      {/* Contract Form Modal */}
      {showForm && (
        <ContractFormModal
          contract={selectedContract}
          onSave={() => { setShowForm(false); loadData(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

type StatColor = 'gray' | 'orange' | 'green' | 'blue';

function StatCard({ icon: Icon, label, value, color = 'gray' }: { icon: LucideIcon; label: string; value: number | string; color?: StatColor }) {
  const colors: Record<StatColor, string> = {
    gray: 'bg-gray-50 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-200',
    green: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}

function ContractFormModal({ contract, onSave, onClose }: {
  contract: Contract | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [plans, setPlans] = useState<AgreementPlan[]>([]);
  // Only fields the server stores (agreements.ts agreementFields: contactId, planId, name, amount, billingFrequency,
  // startDate, endDate, renewalType/autoRenew, terms, notes, status). The template also had a "Plan Type" select and
  // an "Included Services" checklist; neither is an agreement field, the server dropped both, and an edit never
  // showed them again — so they are gone rather than pretending to save. What a contract includes is its plan's.
  const [form, setForm] = useState<{
    contactId: string;
    planId: string;
    startDate: string;
    billingFrequency: string;
    amount: string;
    autoRenew: boolean;
    firstVisitDate: string;
  }>({
    contactId: contract?.contactId || '',
    planId: contract?.planId || '',
    startDate: contract?.startDate?.split('T')[0] || todayKey(),
    billingFrequency: contract?.billingFrequency || 'monthly',
    amount: contract?.amount != null ? String(contract.amount) : '', // the agreement's billed amount (API field `amount`)
    autoRenew: contract?.renewalType ? contract.renewalType === 'auto' : true, // the API stores renewalType
    firstVisitDate: '',
  });
  /** The picked plan's visits per term: they go on the Schedule when the contract is saved (server scheduleTermVisits). */
  const planVisits = Number(plans.find((p) => p.id === form.planId)?.visitsIncluded || 0);
  const [scheduling, setScheduling] = useState(false);
  const scheduleTerm = async () => {
    if (!contract) return;
    setScheduling(true);
    try {
      const r = await api.post(`/api/agreements/${contract.id}/schedule-visits`, {});
      const made = Number(r?.made || 0);
      toast.success(made > 0 ? `${made} visit${made === 1 ? '' : 's'} put on the Schedule: ${(r?.dates || []).map((d: string) => formatDate(d)).join(', ')}` : "This term's visits are already on the Schedule");
      onSave();
    } catch (error) {
      toast.error(serverMessage(error, 'The visits could not be scheduled'));
    } finally { setScheduling(false); }
  };
  // A seat without invoices:read is never sent `amount` (agreements.ts withholds it), so on an edit its blank box
  // means "not shown", not "blank": the box is left off the form and `amount` out of the request.
  const amountHidden = !!contract && contract.amount === undefined;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFormData();
  }, []);

  const loadFormData = async () => {
    try {
      const [contactsRes, plansRes] = await Promise.all([
        api.get('/api/contacts', { limit: 200, ...CUSTOMER_PICKER_PARAMS }),
        api.get('/api/agreements/plans'),
      ]);
      // Contacts are a list ({ data, pagination }); the plans are a bare array.
      setContacts(Array.isArray(contactsRes?.data) ? customersOnly(contactsRes.data as ContactOption[]) : []);
      setPlans(Array.isArray(plansRes) ? (plansRes as AgreementPlan[]) : []);
    } catch (error) {
      console.error('Failed to load form data:', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // A blank amount is never a value the server takes ('' is refused with a 400). Left out, an edit keeps the
      // stored amount (or takes a newly picked plan's), and a new contract takes its plan's price — or the server
      // says, in its own words, that it needs one.
      const { amount, firstVisitDate, ...rest } = form;
      const payload = amountHidden || amount.trim() === '' ? rest : { ...rest, amount };
      if (contract) {
        await api.put(`/api/agreements/${contract.id}`, payload);
      } else {
        const made = await api.post('/api/agreements', { ...payload, ...(planVisits > 0 && firstVisitDate ? { firstVisitDate } : {}) });
        // Say where the visits went: the Schedule, on these days.
        if (Number(made?.visitsMade || 0) > 0) toast.success(`${made.visitsMade} visit${made.visitsMade === 1 ? '' : 's'} put on the Schedule: ${(made.visitDates || []).map((d: string) => formatDate(d)).join(', ')}`);
      }
      onSave();
    } catch (error) {
      toast.error(serverMessage(error, 'Failed to save contract'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto text-gray-900 dark:text-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">
              {contract ? 'Edit Contract' : 'New Maintenance Contract'}
            </h2>
            <button aria-label="Close" onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Customer */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Customer</label>
              <select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                required
              >
                <option value="">Select customer...</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Plan Selection */}
            {plans.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Plan</label>
                <select
                  value={form.planId}
                  onChange={(e) => {
                    const plan = plans.find(p => p.id === e.target.value);
                    setForm({
                      ...form,
                      planId: e.target.value,
                      amount: plan?.price != null ? String(plan.price) : form.amount,
                      billingFrequency: plan?.billingFrequency || form.billingFrequency,
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  <option value="">Select a plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {/* `price` is withheld without invoices:read — the name alone then, not a "$0". */}
                      {p.price !== undefined ? `${p.name} - ${money((Number(p.price) || 0), 0)}/${p.billingFrequency}` : p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Start Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  required
                />
              </div>

              {/* Billing Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Billing Frequency</label>
                <select
                  value={form.billingFrequency}
                  onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  {BILLING_FREQUENCIES.map(f => (
                    <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                  ))}
                </select>
              </div>

              {/* Price — left off an edit whose amount this seat was never sent (see amountHidden). Not `required`:
                  a picked plan supplies it, and the server names what is missing when neither does. */}
              {!amountHidden && <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                    placeholder={form.planId ? "Plan's price" : ''}
                  />
                </div>
              </div>}
            </div>

            {/* The plan's visits per term go on the Schedule with the contract. */}
            {planVisits > 0 && (
              <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-600 space-y-2" data-testid="contract-visits">
                <p className="text-sm text-gray-700 dark:text-slate-200">
                  This plan includes <strong>{planVisits} visit{planVisits === 1 ? '' : 's'}</strong> a term.{' '}
                  {contract
                    ? `This term: ${Number(contract.visitsScheduled || 0)} booked, ${Number(contract.visitsCompleted || 0)} done.`
                    : 'They go on the Schedule when you save, spread evenly across the term from the first visit.'}
                </p>
                {!contract && (
                  <div>
                    <label htmlFor="contract-first-visit" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">First visit</label>
                    <input id="contract-first-visit" type="date" min={form.startDate} value={form.firstVisitDate || form.startDate}
                      onChange={(e) => setForm({ ...form, firstVisitDate: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600" />
                  </div>
                )}
                {contract && contract.status === 'active' && Number(contract.visitsScheduled || 0) + Number(contract.visitsCompleted || 0) < planVisits && (
                  <button type="button" onClick={scheduleTerm} disabled={scheduling} className="px-4 py-2 border rounded-lg text-sm text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 disabled:opacity-60">
                    {scheduling ? 'Scheduling…' : "Schedule this term's visits"}
                  </button>
                )}
              </div>
            )}

            {/* Auto-Renew */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500 dark:text-orange-200"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">Auto-renew when term ends</span>
            </label>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : contract ? 'Update Contract' : 'Create Contract'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
