import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  RefreshCw, Plus, Play, Pause, X, MoreVertical, Calendar, 
  DollarSign, User, Clock, Loader2, ChevronRight 
} from 'lucide-react';
import api from '../../services/api';

const FREQUENCIES = {
  weekly: 'Weekly',
  biweekly: 'Bi-Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const STATUS_STYLES = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function RecurringInvoiceList() {
  const navigate = useNavigate();
  const [recurring, setRecurring] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadData();
  }, [filter]);

  const loadData = async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.append('status', filter);

      const [listRes, statsRes] = await Promise.all([
        api.get(`/api/recurring?${params}`),
        api.get('/api/recurring/stats'),
      ]);

      setRecurring(listRes.data || []);
      setStats(statsRes);
    } catch (error) {
      console.error('Failed to load recurring invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async (id) => {
    try {
      await api.post(`/api/recurring/${id}/pause`);
      loadData();
    } catch (error) {
      alert('Failed to pause');
    }
  };

  const handleResume = async (id) => {
    try {
      await api.post(`/api/recurring/${id}/resume`);
      loadData();
    } catch (error) {
      alert('Failed to resume');
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this recurring invoice? This cannot be undone.')) return;
    try {
      await api.post(`/api/recurring/${id}/cancel`);
      loadData();
    } catch (error) {
      alert('Failed to cancel');
    }
  };

  const handleGenerateNow = async (id) => {
    try {
      const invoice = await api.post(`/api/recurring/${id}/generate`);
      navigate(`/invoices/${invoice.id}`);
    } catch (error) {
      alert('Failed to generate invoice');
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recurring Invoices</h1>
          <p className="text-gray-500">Automated billing schedules</p>
        </div>
        <Link
          to="/recurring/new"
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          New Recurring
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <RefreshCw className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.active}</p>
                <p className="text-sm text-gray-500">Active</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Pause className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.paused}</p>
                <p className="text-sm text-gray-500">Paused</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Calendar className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-gray-500">Total</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${stats.monthlyRecurringRevenue?.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Monthly Revenue</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'active', 'paused', 'cancelled'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === s
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {recurring.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <RefreshCw className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 mb-4">No recurring invoices</p>
          <Link
            to="/recurring/new"
            className="text-orange-600 hover:underline"
          >
            Create your first recurring invoice
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border divide-y">
          {recurring.map((item) => (
            <div key={item.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${item.status === 'active' ? 'bg-green-100' : 'bg-gray-100'}`}>
                    <RefreshCw className={`w-5 h-5 ${item.status === 'active' ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <Link to={`/recurring/${item.id}`} className="font-medium text-gray-900 hover:text-orange-600">
                      {item.contact?.name || 'Unknown Contact'}
                    </Link>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      <span>{FREQUENCIES[item.frequency] || item.frequency}</span>
                      <span>•</span>
                      <span>${Number(item.total).toLocaleString()}</span>
                      {item._count?.generatedInvoices > 0 && (
                        <>
                          <span>•</span>
                          <span>{item._count.generatedInvoices} generated</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Next run date */}
                  {item.status === 'active' && item.nextRunDate && (
                    <div className="text-right text-sm">
                      <p className="text-gray-500">Next: {new Date(item.nextRunDate).toLocaleDateString()}</p>
                    </div>
                  )}

                  {/* Status badge */}
                  <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[item.status]}`}>
                    {item.status}
                  </span>

                  {/* Actions */}
                  <div className="relative group">
                    <button className="p-2 hover:bg-gray-100 rounded-lg">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                    <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border py-1 hidden group-hover:block z-10">
                      <Link
                        to={`/recurring/${item.id}`}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        View Details
                      </Link>
                      {item.status === 'active' && (
                        <>
                          <button
                            onClick={() => handleGenerateNow(item.id)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Generate Invoice Now
                          </button>
                          <button
                            onClick={() => handlePause(item.id)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Pause
                          </button>
                        </>
                      )}
                      {item.status === 'paused' && (
                        <button
                          onClick={() => handleResume(item.id)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Resume
                        </button>
                      )}
                      {item.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancel(item.id)}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
