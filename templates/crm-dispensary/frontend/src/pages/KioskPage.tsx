import { useState, useEffect } from 'react';
import {
  Monitor, Play, ExternalLink, Clock, Users, CheckCircle, XCircle,
  RefreshCw, BarChart3, ShoppingCart, AlertCircle
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const sessionStatusColors: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  abandoned: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-gray-100 text-gray-600',
};

export default function KioskPage() {
  const toast = useToast();
  const [tab, setTab] = useState('setup');
  const [sessions, setSessions] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
    if (tab === 'stats') loadStats();
  }, [tab, page, statusFilter]);

  const loadLocations = async () => {
    try {
      const data = await api.get('/api/locations');
      setLocations(Array.isArray(data) ? data : data?.data || []);
      if (data?.length > 0 || data?.data?.length > 0) {
        const locs = Array.isArray(data) ? data : data?.data || [];
        if (locs.length > 0) setSelectedLocation(locs[0].id);
      }
    } catch (err) {
      // Locations may not exist yet
    }
  };

  const loadSessions = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const data = await api.get('/api/kiosk/sessions', params);
      setSessions(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load kiosk sessions');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/kiosk/stats');
      setStats(data);
    } catch (err) {
      toast.error('Failed to load kiosk stats');
    } finally {
      setLoading(false);
    }
  };

  const launchKiosk = () => {
    const url = selectedLocation ? `/kiosk?location=${selectedLocation}` : '/kiosk';
    window.open(url, '_blank', 'fullscreen=yes');
  };

  const tabs = [
    { id: 'setup', label: 'Setup', icon: Monitor },
    { id: 'sessions', label: 'Sessions', icon: Users },
    { id: 'stats', label: 'Stats', icon: BarChart3 },
  ];

  const statusFilters = [
    { value: '', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'abandoned', label: 'Abandoned' },
    { value: 'expired', label: 'Expired' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kiosk Management</h1>
          <p className="text-gray-600">Setup and monitor in-store ordering kiosks</p>
        </div>
        <button
          onClick={() => { if (tab === 'sessions') loadSessions(); if (tab === 'stats') loadStats(); }}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Setup */}
      {tab === 'setup' && (
        <div className="max-w-2xl">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Monitor className="w-5 h-5 text-green-600" />
              Kiosk Setup
            </h2>

            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-medium text-green-800 mb-2">How to enable kiosk mode</h3>
                <ol className="list-decimal list-inside space-y-1 text-sm text-green-700">
                  <li>Select the location for this kiosk below</li>
                  <li>Click "Launch Kiosk" to open the customer-facing ordering interface</li>
                  <li>Set the browser to fullscreen mode (F11) on your kiosk device</li>
                  <li>Customers can browse products, add to cart, and place orders</li>
                  <li>Orders appear in your POS queue for fulfillment</li>
                </ol>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kiosk Location</label>
                <select
                  value={selectedLocation}
                  onChange={e => setSelectedLocation(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                >
                  <option value="">Select a location...</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>

              <Button onClick={launchKiosk} size="lg" className="w-full flex items-center justify-center gap-2">
                <Play className="w-5 h-5" />
                Launch Kiosk
                <ExternalLink className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="font-medium text-gray-900 mb-3">Recommended Hardware</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                Touch-screen display (15" or larger recommended)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                Stable internet connection (wired preferred)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                Chrome or Edge browser in kiosk mode
              </li>
              <li className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                Disable browser navigation bar for kiosk use
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Sessions */}
      {tab === 'sessions' && (
        <div>
          {/* Status Filter */}
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {statusFilters.map(s => (
              <button
                key={s.value}
                onClick={() => { setStatusFilter(s.value); setPage(1); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap ${
                  statusFilter === s.value
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Session ID</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Location</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Started</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Order #</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sessions.map(session => (
                      <tr key={session.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-gray-900">{session.id?.slice(0, 8)}</td>
                        <td className="px-4 py-3 text-gray-600">{session.locationName || '--'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${sessionStatusColors[session.status] || 'bg-gray-100 text-gray-600'}`}>
                            {session.status || 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{session.startedAt ? new Date(session.startedAt).toLocaleString() : '--'}</td>
                        <td className="px-4 py-3 text-gray-600">{session.customerName || '--'}</td>
                        <td className="px-4 py-3 text-gray-600">{session.orderNumber || '--'}</td>
                      </tr>
                    ))}
                    {sessions.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                          <Monitor className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          No kiosk sessions found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination && pagination.pages > 1 && (
                <div className="px-4 py-3 border-t flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    Page {pagination.page} of {pagination.pages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={page >= pagination.pages}
                      className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {tab === 'stats' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : stats ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Sessions Today</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalSessionsToday ?? 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Completion Rate</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.completionRate ?? 0}%</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Avg Session Time</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.avgSessionTime ?? '--'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Abandoned Rate</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.abandonedRate ?? 0}%</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No stats available yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
