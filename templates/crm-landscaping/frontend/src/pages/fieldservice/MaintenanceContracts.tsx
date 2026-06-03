import { useState, useEffect } from 'react';
import {
  FileText, Plus, Search, Calendar, DollarSign, Users,
  AlertTriangle, RefreshCw, XCircle, Clock, Loader2,
  Edit2, ChevronRight, Check, X
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const PLAN_TYPES = ['annual', 'semi-annual', 'quarterly'] as const;
const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'semi-annual', 'annual'] as const;
const CONTRACT_STATUSES = ['active', 'expired', 'cancelled', 'pending'] as const;

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

const INCLUDED_SERVICES = [
  'AC Tune-Up',
  'Heating Tune-Up',
  'Filter Replacement',
  'Duct Inspection',
  'Refrigerant Check',
  'Electrical Inspection',
  'Thermostat Calibration',
  'Coil Cleaning',
  'Drain Line Flush',
  'Safety Inspection',
];

/**
 * Maintenance Contracts — Recurring maintenance contract management
 */
export default function MaintenanceContracts() {
  const toast = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/agreements?status=${statusFilter}`);
      setContracts(res.data || res || []);
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
      if (c.status !== 'active') return false;
      const end = new Date(c.endDate);
      const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return end <= thirtyDays;
    }).length,
    monthlyRevenue: contracts
      .filter(c => c.status === 'active')
      .reduce((sum, c) => {
        const price = Number(c.price) || 0;
        if (c.billingFrequency === 'monthly') return sum + price;
        if (c.billingFrequency === 'quarterly') return sum + price / 3;
        if (c.billingFrequency === 'semi-annual') return sum + price / 6;
        if (c.billingFrequency === 'annual') return sum + price / 12;
        return sum + price;
      }, 0),
    total: contracts.length,
  };

  const handleRenew = async (contractId) => {
    if (!confirm('Renew this contract for another term?')) return;
    try {
      await api.post(`/api/agreements/${contractId}/renew`);
      toast.success('Contract renewed');
      loadData();
    } catch (error) {
      toast.error('Failed to renew contract');
    }
  };

  const handleCancel = async (contractId) => {
    if (!confirm('Cancel this maintenance contract?')) return;
    try {
      await api.put(`/api/agreements/${contractId}`, { status: 'cancelled' });
      toast.success('Contract cancelled');
      loadData();
    } catch (error) {
      toast.error('Failed to cancel contract');
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
        <button
          onClick={() => { setSelectedContract(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          New Contract
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Active Contracts" value={stats.active} />
        <StatCard icon={AlertTriangle} label="Expiring Soon" value={stats.expiringSoon} color="orange" />
        <StatCard
          icon={DollarSign}
          label="Monthly Revenue"
          value={`$${stats.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          color="green"
        />
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
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Plan</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Next Service</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Amount</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Expires</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {filteredContracts.map(contract => {
                const isExpiringSoon =
                  contract.status === 'active' &&
                  new Date(contract.endDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

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
                        {contract.plan?.name || contract.planType || '-'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        {contract.billingFrequency || contract.plan?.billingFrequency || ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700 dark:text-slate-300">
                        {contract.nextServiceDate
                          ? new Date(contract.nextServiceDate).toLocaleDateString()
                          : '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-gray-900 dark:text-white">
                        ${Number(contract.price || 0).toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">
                        /{contract.billingFrequency || 'mo'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[contract.status] || 'bg-gray-100 text-gray-700'}`}>
                        {contract.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {isExpiringSoon && (
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                        )}
                        <span className={`text-sm ${isExpiringSoon ? 'text-orange-600' : 'text-gray-500 dark:text-slate-400'}`}>
                          {contract.endDate
                            ? new Date(contract.endDate).toLocaleDateString()
                            : '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {contract.status === 'active' && (
                          <button
                            onClick={() => handleRenew(contract.id)}
                            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10 rounded"
                            title="Renew"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => { setSelectedContract(contract); setShowForm(true); }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {contract.status === 'active' && (
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

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function ContractFormModal({ contract, onSave, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({
    contactId: contract?.contactId || '',
    planId: contract?.planId || '',
    planType: contract?.planType || 'annual',
    startDate: contract?.startDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    billingFrequency: contract?.billingFrequency || 'monthly',
    price: contract?.price || '',
    includedServices: contract?.includedServices || [],
    autoRenew: contract?.autoRenew ?? true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFormData();
  }, []);

  const loadFormData = async () => {
    try {
      const [contactsRes, plansRes] = await Promise.all([
        api.get('/api/contacts?limit=200'),
        api.get('/api/agreements/plans'),
      ]);
      setContacts(contactsRes.data || contactsRes || []);
      setPlans(plansRes || []);
    } catch (error) {
      console.error('Failed to load form data:', error);
    }
  };

  const toggleService = (service) => {
    setForm(prev => ({
      ...prev,
      includedServices: prev.includedServices.includes(service)
        ? prev.includedServices.filter(s => s !== service)
        : [...prev.includedServices, service],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (contract) {
        await api.put(`/api/agreements/${contract.id}`, form);
      } else {
        await api.post('/api/agreements', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save contract');
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
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
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
                      price: plan?.price || form.price,
                      billingFrequency: plan?.billingFrequency || form.billingFrequency,
                    });
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  <option value="">Select a plan...</option>
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} - ${Number(p.price).toFixed(0)}/{p.billingFrequency}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Plan Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Plan Type</label>
                <select
                  value={form.planType}
                  onChange={(e) => setForm({ ...form, planType: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  {PLAN_TYPES.map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>

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

              {/* Price */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Included Services */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Included Services</label>
              <div className="grid grid-cols-2 gap-2">
                {INCLUDED_SERVICES.map(service => (
                  <label
                    key={service}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      form.includedServices.includes(service)
                        ? 'border-orange-300 bg-orange-50 dark:border-orange-500 dark:bg-orange-500/10'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.includedServices.includes(service)}
                      onChange={() => toggleService(service)}
                      className="w-4 h-4 rounded text-orange-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-slate-300">{service}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Auto-Renew */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500"
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
