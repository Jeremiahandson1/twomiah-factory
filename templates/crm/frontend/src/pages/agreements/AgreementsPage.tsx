import { useState, useEffect } from 'react';
import { 
  FileText, Plus, Search, Calendar, DollarSign, Users,
  AlertTriangle, RefreshCw, XCircle, Clock, Star, TrendingUp,
  Loader2, Edit2, ChevronRight, CalendarPlus, Check
} from 'lucide-react';
import api from '../../services/api';

/**
 * Service Agreements / Memberships Page
 */
export default function AgreementsPage() {
  const [tab, setTab] = useState('agreements'); // agreements, plans, visits
  const [agreements, setAgreements] = useState([]);
  const [plans, setPlans] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showAgreementForm, setShowAgreementForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedAgreement, setSelectedAgreement] = useState(null);

  useEffect(() => {
    loadData();
  }, [statusFilter]);

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

  const filteredAgreements = agreements.filter(a =>
    !search || 
    a.contact?.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.plan?.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service Agreements</h1>
          <p className="text-gray-500">Manage maintenance memberships</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelectedPlan(null); setShowPlanForm(true); }}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            <FileText className="w-4 h-4" />
            New Plan
          </button>
          <button
            onClick={() => { setSelectedAgreement(null); setShowAgreementForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            New Agreement
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
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
            icon={DollarSign} 
            label="Monthly Revenue" 
            value={`$${stats.monthlyRecurringRevenue?.toLocaleString() || 0}`}
            color="green"
          />
          <StatCard 
            icon={TrendingUp} 
            label="Annual Revenue" 
            value={`$${stats.annualRecurringRevenue?.toLocaleString() || 0}`}
            color="blue"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'agreements', label: 'Agreements', icon: FileText },
          { id: 'plans', label: 'Plans', icon: Star },
          { id: 'visits', label: 'Upcoming Visits', icon: Calendar },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 -mb-px ${
              tab === t.id
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
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
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search agreements..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
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
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Customer</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Plan</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Visits</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Expires</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Price</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAgreements.map(agreement => (
                    <AgreementRow 
                      key={agreement.id} 
                      agreement={agreement}
                      onView={() => { setSelectedAgreement(agreement); }}
                      onRenew={() => handleRenew(agreement.id)}
                    />
                  ))}
                </tbody>
              </table>
              {filteredAgreements.length === 0 && (
                <div className="text-center py-12 text-gray-500">
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
          onEdit={(plan) => { setSelectedPlan(plan); setShowPlanForm(true); }}
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
  );

  async function handleRenew(agreementId) {
    if (!confirm('Renew this agreement for another term?')) return;
    try {
      await api.post(`/api/agreements/${agreementId}/renew`);
      loadData();
    } catch (error) {
      alert('Failed to renew agreement');
    }
  }
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function AgreementRow({ agreement, onView, onRenew }) {
  const isExpiringSoon = new Date(agreement.endDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  
  const statusColors = {
    active: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    expired: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-700',
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{agreement.contact?.name}</p>
        <p className="text-sm text-gray-500">{agreement.contact?.email}</p>
      </td>
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{agreement.plan?.name}</p>
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 rounded-full text-xs ${statusColors[agreement.status]}`}>
          {agreement.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">
        {agreement.visitsRemaining} remaining
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {isExpiringSoon && agreement.status === 'active' && (
            <AlertTriangle className="w-4 h-4 text-orange-500" />
          )}
          <span className={`text-sm ${isExpiringSoon ? 'text-orange-600' : 'text-gray-500'}`}>
            {new Date(agreement.endDate).toLocaleDateString()}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-medium">
        ${Number(agreement.price).toFixed(2)}
        <span className="text-xs text-gray-500 ml-1">/{agreement.billingFrequency}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          {agreement.status === 'active' && (
            <button
              onClick={onRenew}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded"
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

function PlansTab({ plans, onEdit, onRefresh }) {
  return (
    <div className="grid grid-cols-3 gap-6">
      {plans.map(plan => (
        <div key={plan.id} className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
              <p className="text-sm text-gray-500">{plan._count?.agreements || 0} active</p>
            </div>
            <button
              onClick={() => onEdit(plan)}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          </div>

          <div className="text-3xl font-bold text-gray-900 mb-4">
            ${Number(plan.price).toFixed(0)}
            <span className="text-base font-normal text-gray-500">/{plan.billingFrequency}</span>
          </div>

          {plan.description && (
            <p className="text-sm text-gray-600 mb-4">{plan.description}</p>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500" />
              <span>{plan.visitsIncluded} visits included</span>
            </div>
            {plan.discountPercent > 0 && (
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span>{plan.discountPercent}% member discount</span>
              </div>
            )}
            {plan.priorityService && (
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span>Priority scheduling</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500" />
              <span>{plan.durationMonths} month term</span>
            </div>
          </div>
        </div>
      ))}

      {plans.length === 0 && (
        <div className="col-span-3 text-center py-12 text-gray-500">
          No plans created yet
        </div>
      )}
    </div>
  );
}

function VisitsTab() {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);

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
    <div className="bg-white rounded-xl border">
      <div className="p-4 border-b">
        <h3 className="font-medium text-gray-900">Upcoming Service Visits</h3>
      </div>
      {visits.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No upcoming visits
        </div>
      ) : (
        <div className="divide-y">
          {visits.map(visit => (
            <div key={visit.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {visit.agreement?.contact?.name}
                </p>
                <p className="text-sm text-gray-500">
                  {visit.agreement?.plan?.name} - {visit.serviceType || 'Maintenance'}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900">
                  {new Date(visit.scheduledDate).toLocaleDateString()}
                </p>
                <p className="text-sm text-gray-500">
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

function PlanFormModal({ plan, onSave, onClose }) {
  const [form, setForm] = useState({
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
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (plan) {
        await api.put(`/api/agreements/plans/${plan.id}`, form);
      } else {
        await api.post('/api/agreements/plans', form);
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
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">{plan ? 'Edit Plan' : 'Create Plan'}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., HVAC Maintenance Plan"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Billing</label>
                <select
                  value={form.billingFrequency}
                  onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Visits/Year</label>
                <input
                  type="number"
                  value={form.visitsIncluded}
                  onChange={(e) => setForm({ ...form, visitsIncluded: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Discount %</label>
                <input
                  type="number"
                  value={form.discountPercent}
                  onChange={(e) => setForm({ ...form, discountPercent: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Term (months)</label>
                <input
                  type="number"
                  value={form.durationMonths}
                  onChange={(e) => setForm({ ...form, durationMonths: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.priorityService}
                  onChange={(e) => setForm({ ...form, priorityService: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500"
                />
                <span className="text-sm text-gray-700">Priority Service</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.autoRenew}
                  onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500"
                />
                <span className="text-sm text-gray-700">Auto-Renew</span>
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

function AgreementFormModal({ agreement, plans, onSave, onClose }) {
  const [form, setForm] = useState({
    planId: agreement?.planId || '',
    contactId: agreement?.contactId || '',
    startDate: agreement?.startDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    autoRenew: agreement?.autoRenew ?? true,
  });
  const [contacts, setContacts] = useState([]);
  const [saving, setSaving] = useState(false);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (agreement) {
        await api.put(`/api/agreements/${agreement.id}`, form);
      } else {
        await api.post('/api/agreements', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save agreement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">{agreement ? 'Edit Agreement' : 'New Agreement'}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select customer...</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
              <select
                value={form.planId}
                onChange={(e) => setForm({ ...form, planId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select plan...</option>
                {plans.filter(p => p.active).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} - ${Number(p.price).toFixed(0)}/{p.billingFrequency}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.autoRenew}
                onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500"
              />
              <span className="text-sm text-gray-700">Auto-renew when term ends</span>
            </label>

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
