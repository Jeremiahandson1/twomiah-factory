import { useState, useEffect } from 'react';
import { 
  Shield, Plus, Clock, AlertTriangle, CheckCircle,
  XCircle, Calendar, Loader2, FileText, Phone,
  ChevronRight, Search, Filter
} from 'lucide-react';
import api from '../../services/api';

const CLAIM_STATUS = {
  open: { label: 'Open', color: 'blue', icon: Clock },
  scheduled: { label: 'Scheduled', color: 'purple', icon: Calendar },
  in_progress: { label: 'In Progress', color: 'orange', icon: Clock },
  completed: { label: 'Completed', color: 'green', icon: CheckCircle },
  denied: { label: 'Denied', color: 'red', icon: XCircle },
};

/**
 * Warranty Management Page
 */
export default function WarrantiesPage() {
  const [tab, setTab] = useState('warranties'); // warranties, claims
  const [warranties, setWarranties] = useState([]);
  const [claims, setClaims] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showExpiring, setShowExpiring] = useState(false);
  const [showNewClaim, setShowNewClaim] = useState(false);

  useEffect(() => {
    loadData();
  }, [showExpiring]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [warrantiesRes, claimsRes, statsRes] = await Promise.all([
        api.get(`/api/warranties?expiringSoon=${showExpiring}`),
        api.get('/api/warranties/claims?status=open'),
        api.get('/api/warranties/stats'),
      ]);
      setWarranties(warrantiesRes.data || []);
      setClaims(claimsRes.data || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load warranties:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warranties</h1>
          <p className="text-gray-500">Track warranties and service claims</p>
        </div>
        <button
          onClick={() => setShowNewClaim(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          New Claim
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard icon={Shield} label="Active Warranties" value={stats.activeWarranties} />
          <StatCard 
            icon={AlertTriangle} 
            label="Expiring Soon" 
            value={stats.expiringSoon}
            color={stats.expiringSoon > 0 ? 'orange' : 'gray'}
          />
          <StatCard 
            icon={Clock} 
            label="Open Claims" 
            value={stats.openClaims}
            color={stats.openClaims > 0 ? 'blue' : 'gray'}
          />
          <StatCard icon={FileText} label="Total Claims" value={stats.totalClaims} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 border-b">
          {[
            { id: 'warranties', label: 'Warranties', icon: Shield },
            { id: 'claims', label: 'Claims', icon: FileText },
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
        
        {tab === 'warranties' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showExpiring}
              onChange={(e) => setShowExpiring(e.target.checked)}
              className="rounded border-gray-300 text-orange-500 focus:ring-orange-500"
            />
            Show expiring soon only
          </label>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {tab === 'warranties' && (
            <WarrantiesList warranties={warranties} onRefresh={loadData} />
          )}
          {tab === 'claims' && (
            <ClaimsList claims={claims} onRefresh={loadData} />
          )}
        </>
      )}

      {/* New Claim Modal */}
      {showNewClaim && (
        <NewClaimModal
          warranties={warranties}
          onSave={() => { setShowNewClaim(false); loadData(); }}
          onClose={() => setShowNewClaim(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function WarrantiesList({ warranties, onRefresh }) {
  if (warranties.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl">
        <Shield className="w-12 h-12 mx-auto text-gray-400 mb-3" />
        <p className="text-gray-500">No warranties found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Warranty</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Project</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Customer</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Expires</th>
            <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Claims</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {warranties.map(warranty => (
            <tr key={warranty.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    warranty.isExpiringSoon ? 'bg-orange-100' : 
                    warranty.isExpired ? 'bg-red-100' : 'bg-green-100'
                  }`}>
                    <Shield className={`w-5 h-5 ${
                      warranty.isExpiringSoon ? 'text-orange-600' : 
                      warranty.isExpired ? 'text-red-600' : 'text-green-600'
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{warranty.name}</p>
                    <p className="text-sm text-gray-500 capitalize">{warranty.category}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-500">
                {warranty.project?.name}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {warranty.contact?.name}
              </td>
              <td className="px-4 py-3">
                {warranty.isExpired ? (
                  <span className="text-red-600">Expired</span>
                ) : (
                  <div>
                    <p className={warranty.isExpiringSoon ? 'text-orange-600 font-medium' : 'text-gray-900'}>
                      {new Date(warranty.expiresAt).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-gray-500">{warranty.daysRemaining} days left</p>
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded">
                  {warranty._count?.claims || 0}
                </span>
              </td>
              <td className="px-4 py-3">
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClaimsList({ claims, onRefresh }) {
  const [allClaims, setAllClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    loadClaims();
  }, [statusFilter]);

  const loadClaims = async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const data = await api.get(`/api/warranties/claims${params}`);
      setAllClaims(data.data || []);
    } catch (error) {
      console.error('Failed to load claims:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSchedule = async (claimId) => {
    const date = prompt('Enter scheduled date (YYYY-MM-DD):');
    if (!date) return;
    try {
      await api.post(`/api/warranties/claims/${claimId}/schedule`, { scheduledDate: date });
      loadClaims();
      onRefresh();
    } catch (error) {
      alert('Failed to schedule');
    }
  };

  const handleComplete = async (claimId) => {
    try {
      await api.put(`/api/warranties/claims/${claimId}/status`, { status: 'completed' });
      loadClaims();
      onRefresh();
    } catch (error) {
      alert('Failed to update');
    }
  };

  const handleDeny = async (claimId) => {
    const reason = prompt('Enter denial reason:');
    if (!reason) return;
    try {
      await api.post(`/api/warranties/claims/${claimId}/deny`, { reason });
      loadClaims();
      onRefresh();
    } catch (error) {
      alert('Failed to deny');
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
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="denied">Denied</option>
        </select>
      </div>

      {allClaims.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <FileText className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No claims found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Claim</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Project</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Reported</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {allClaims.map(claim => {
                const status = CLAIM_STATUS[claim.status] || CLAIM_STATUS.open;
                const StatusIcon = status.icon;

                return (
                  <tr key={claim.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{claim.title}</p>
                      <p className="text-sm text-gray-500">{claim.warranty?.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900">{claim.project?.name}</p>
                      <p className="text-sm text-gray-500">{claim.contact?.name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(claim.reportedDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-${status.color}-100 text-${status.color}-700`}>
                        <StatusIcon className="w-3 h-3" />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        {claim.status === 'open' && (
                          <>
                            <button
                              onClick={() => handleSchedule(claim.id)}
                              className="px-3 py-1 text-sm bg-purple-500 text-white rounded-lg"
                            >
                              Schedule
                            </button>
                            <button
                              onClick={() => handleDeny(claim.id)}
                              className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                            >
                              Deny
                            </button>
                          </>
                        )}
                        {(claim.status === 'scheduled' || claim.status === 'in_progress') && (
                          <button
                            onClick={() => handleComplete(claim.id)}
                            className="px-3 py-1 text-sm bg-green-500 text-white rounded-lg"
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewClaimModal({ warranties, onSave, onClose }) {
  const [form, setForm] = useState({
    warrantyId: '',
    title: '',
    description: '',
    location: '',
    priority: 'normal',
    reportedMethod: 'phone',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/warranties/claims', form);
      onSave();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to create claim');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">New Warranty Claim</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Warranty</label>
              <select
                value={form.warrantyId}
                onChange={(e) => setForm({ ...form, warrantyId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select warranty...</option>
                {warranties.filter(w => !w.isExpired).map(w => (
                  <option key={w.id} value={w.id}>
                    {w.project?.name} - {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Issue Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Leak in master bathroom"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                rows={3}
                placeholder="Describe the issue..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Master bathroom, near shower"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reported Via</label>
                <select
                  value={form.reportedMethod}
                  onChange={(e) => setForm({ ...form, reportedMethod: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="portal">Client Portal</option>
                  <option value="in-person">In Person</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Creating...' : 'Create Claim'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
