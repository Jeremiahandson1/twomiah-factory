import { useState, useEffect, useCallback } from 'react';
import { Car, Clock, User, Hash, CheckCircle, RefreshCw, ArrowRight, Package } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';

function formatWaitTime(checkinTime: string): string {
  if (!checkinTime) return '—';
  const diff = Math.floor((Date.now() - new Date(checkinTime).getTime()) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff}m`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m`;
}

const statusColors: Record<string, string> = {
  waiting: 'bg-yellow-100 text-yellow-700',
  assigned: 'bg-blue-100 text-blue-700',
  bringing_out: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
};

export default function CurbsidePage() {
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const [pickups, setPickups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active: 0, avgCompletionTime: '—', completedToday: 0 });

  const loadPickups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/curbside/pickups', { status: tab === 'active' ? 'active' : undefined });
      setPickups(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load pickups');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadStats = async () => {
    try {
      const data = await api.get('/api/curbside/stats');
      if (data) {
        setStats({
          active: data.active ?? 0,
          avgCompletionTime: data.avgCompletionTime ? `${data.avgCompletionTime}m` : '—',
          completedToday: data.completedToday ?? 0,
        });
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  useEffect(() => {
    loadPickups();
    loadStats();
  }, [tab]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      loadPickups();
      loadStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/curbside/pickups/${id}/status`, { status });
      toast.success(`Pickup ${status.replace('_', ' ')}`);
      loadPickups();
      loadStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const tabs = [
    { id: 'active', label: 'Active Pickups', icon: Car },
    { id: 'customer', label: 'Customer View', icon: User },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Curbside Pickup</h1>
          <p className="text-gray-600">Manage curbside check-ins and fulfillment</p>
        </div>
        <button onClick={() => { loadPickups(); loadStats(); }} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">Active Pickups</p>
          <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">Avg Completion Time</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avgCompletionTime}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
          <p className="text-sm text-gray-500">Completed Today</p>
          <p className="text-2xl font-bold text-green-600">{stats.completedToday}</p>
        </div>
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

      {/* Active Pickups */}
      {tab === 'active' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pickups.map(pickup => (
                <div key={pickup.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                        <User className="w-4 h-4 text-green-600" />
                        {pickup.customerName || 'Unknown'}
                      </h3>
                      <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[pickup.status] || 'bg-gray-100 text-gray-600'}`}>
                        {(pickup.status || 'waiting').replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500 flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {formatWaitTime(pickup.checkinTime || pickup.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm text-gray-600 mb-4">
                    <p className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-gray-400" />
                      {pickup.vehicleDescription || pickup.vehicle || 'No vehicle info'}
                    </p>
                    {pickup.parkingSpot && (
                      <p className="flex items-center gap-2">
                        <Hash className="w-4 h-4 text-gray-400" />
                        Spot: {pickup.parkingSpot}
                      </p>
                    )}
                    {pickup.orderNumber && (
                      <p className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-gray-400" />
                        Order #{pickup.orderNumber}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-3 border-t">
                    {pickup.status === 'waiting' && (
                      <button
                        onClick={() => updateStatus(pickup.id, 'assigned')}
                        className="flex-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-1"
                      >
                        Assign Staff
                      </button>
                    )}
                    {pickup.status === 'assigned' && (
                      <button
                        onClick={() => updateStatus(pickup.id, 'bringing_out')}
                        className="flex-1 px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center justify-center gap-1"
                      >
                        <ArrowRight className="w-3 h-3" />
                        Bringing Out
                      </button>
                    )}
                    {pickup.status === 'bringing_out' && (
                      <button
                        onClick={() => updateStatus(pickup.id, 'completed')}
                        className="flex-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center justify-center gap-1"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Complete
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {pickups.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <Car className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No active curbside pickups</p>
                  <p className="text-sm mt-1">Check-ins will appear here when customers arrive</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Customer View */}
      {tab === 'customer' && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Car className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Curbside Pickup</h2>
            <p className="text-gray-600 mb-6">This is what your customer sees after checking in.</p>

            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Checked In</p>
                    <p className="text-xs text-gray-500">We know you are here</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Staff Assigned</p>
                    <p className="text-xs text-gray-500">Someone is preparing your order</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">On The Way</p>
                    <p className="text-xs text-gray-500">Staff is bringing your order out</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center">
                    <Package className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-900">Complete</p>
                    <p className="text-xs text-gray-500">Enjoy your purchase!</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
