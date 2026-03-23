import { useState, useEffect, useCallback } from 'react';
import {
  MapPin, Navigation, Clock, CheckCircle, Truck, User, Phone, Battery,
  RefreshCw, Plus, ChevronRight, Circle, ArrowRight, Route, X
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader, StatusBadge } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const stopStatusColors: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  arrived: 'bg-blue-100 text-blue-700',
  departed: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
};

export default function TrackingPage() {
  const toast = useToast();
  const [tab, setTab] = useState('routes');
  const [routes, setRoutes] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoute, setSelectedRoute] = useState<any>(null);

  // Create route modal
  const [createModal, setCreateModal] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState<any[]>([]);
  const [availableOrders, setAvailableOrders] = useState<any[]>([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);

  useEffect(() => {
    if (tab === 'routes') loadRoutes();
    if (tab === 'drivers') loadDrivers();
  }, [tab, page]);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/tracking/routes', { status: 'active', page, limit: 20 });
      setRoutes(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load routes');
    } finally {
      setLoading(false);
    }
  };

  const loadDrivers = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/tracking/drivers');
      setDrivers(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load driver locations');
    } finally {
      setLoading(false);
    }
  };

  const loadRouteDetail = async (routeId: string) => {
    try {
      const data = await api.get(`/api/tracking/routes/${routeId}`);
      setSelectedRoute(data);
    } catch (err) {
      toast.error('Failed to load route detail');
    }
  };

  const openCreateModal = async () => {
    setCreateModal(true);
    setSelectedDriver('');
    setSelectedOrders([]);
    try {
      const [driversData, ordersData] = await Promise.all([
        api.get('/api/tracking/drivers'),
        api.get('/api/delivery/orders', { status: 'queued', limit: 100 }),
      ]);
      setAvailableDrivers(Array.isArray(driversData) ? driversData : driversData?.data || []);
      setAvailableOrders(Array.isArray(ordersData) ? ordersData : ordersData?.data || []);
    } catch (err) {
      toast.error('Failed to load data for route creation');
    }
  };

  const handleCreateRoute = async () => {
    if (!selectedDriver) {
      toast.error('Please select a driver');
      return;
    }
    if (selectedOrders.length === 0) {
      toast.error('Please select at least one delivery order');
      return;
    }
    setCreating(true);
    try {
      await api.post('/api/tracking/routes', {
        driverId: selectedDriver,
        orderIds: selectedOrders,
      });
      toast.success('Route created and optimized');
      setCreateModal(false);
      loadRoutes();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create route');
    } finally {
      setCreating(false);
    }
  };

  const toggleOrder = (orderId: string) => {
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const getBatteryColor = (level: number) => {
    if (level > 50) return 'text-green-500';
    if (level > 20) return 'text-yellow-500';
    return 'text-red-500';
  };

  const tabs = [
    { id: 'routes', label: 'Active Routes', icon: Route },
    { id: 'drivers', label: 'Driver Locations', icon: Navigation },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delivery Tracking</h1>
          <p className="text-gray-600">Monitor routes and driver locations in real time</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Create Route
          </Button>
          <button
            onClick={() => tab === 'routes' ? loadRoutes() : loadDrivers()}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSelectedRoute(null); }}
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

      {/* Active Routes */}
      {tab === 'routes' && !selectedRoute && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {routes.map(route => (
                <div
                  key={route.id}
                  onClick={() => loadRouteDetail(route.id)}
                  className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 cursor-pointer hover:border-green-200 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Route className="w-5 h-5 text-green-600" />
                        <span className="font-semibold text-gray-900">Route #{route.id?.slice(0, 8)}</span>
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          Active
                        </span>
                      </div>
                      <div className="grid md:grid-cols-4 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="w-4 h-4" />
                          <span>{route.driverName || 'Unassigned'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="w-4 h-4" />
                          <span>{route.completedStops || 0}/{route.stopCount || 0} stops</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Navigation className="w-4 h-4" />
                          <span>Current: Stop {route.currentStop || 1}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Truck className="w-4 h-4" />
                          <span>{route.totalDistance ? `${route.totalDistance} mi` : '--'}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                </div>
              ))}
              {routes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Route className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No active routes</p>
                  <p className="text-sm mt-1">Create a route to start tracking deliveries</p>
                </div>
              )}
            </div>
          )}

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-4">
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

      {/* Route Detail */}
      {tab === 'routes' && selectedRoute && (
        <div>
          <button
            onClick={() => setSelectedRoute(null)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to routes
          </button>

          <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <Route className="w-5 h-5 text-green-600" />
              <h2 className="text-lg font-semibold text-gray-900">Route #{selectedRoute.id?.slice(0, 8)}</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div><strong>Driver:</strong> {selectedRoute.driverName || 'Unassigned'}</div>
              <div><strong>Total Stops:</strong> {selectedRoute.stops?.length || 0}</div>
              <div><strong>Distance:</strong> {selectedRoute.totalDistance ? `${selectedRoute.totalDistance} mi` : '--'}</div>
            </div>
          </div>

          {/* Map placeholder */}
          <div className="bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 h-64 flex items-center justify-center mb-4">
            <div className="text-center text-gray-400">
              <MapPin className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">Map view with stop locations</p>
            </div>
          </div>

          {/* Stops list */}
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900 mb-3">Stops</h3>
            {(selectedRoute.stops || []).map((stop: any, idx: number) => (
              <div key={stop.id || idx} className="bg-white rounded-lg shadow-sm p-4 border border-gray-100 flex items-center gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-sm font-bold">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{stop.customerName || stop.address || `Stop ${idx + 1}`}</p>
                  <p className="text-sm text-gray-500">{stop.address || '--'}</p>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${stopStatusColors[stop.status] || 'bg-gray-100 text-gray-600'}`}>
                  {(stop.status || 'pending').replace('_', ' ')}
                </span>
              </div>
            ))}
            {(!selectedRoute.stops || selectedRoute.stops.length === 0) && (
              <p className="text-center text-gray-500 py-4">No stops on this route</p>
            )}
          </div>
        </div>
      )}

      {/* Driver Locations */}
      {tab === 'drivers' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {drivers.map(driver => (
                <div key={driver.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold">
                        {(driver.name || 'D')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{driver.name || 'Unknown Driver'}</p>
                        <p className="text-xs text-gray-500">{driver.phone || '--'}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 ${getBatteryColor(driver.batteryLevel || 0)}`}>
                      <Battery className="w-4 h-4" />
                      <span className="text-xs font-medium">{driver.batteryLevel ?? '--'}%</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      <span>{driver.lastLocation || 'Location unknown'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Updated: {driver.lastUpdated ? new Date(driver.lastUpdated).toLocaleString() : '--'}</span>
                    </div>
                  </div>
                </div>
              ))}
              {drivers.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <Navigation className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No driver locations available</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Route Modal */}
      <Modal isOpen={createModal} onClose={() => setCreateModal(false)} title="Create Optimized Route" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Driver *</label>
            <select
              value={selectedDriver}
              onChange={e => setSelectedDriver(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
            >
              <option value="">Choose a driver...</option>
              {availableDrivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Delivery Orders * ({selectedOrders.length} selected)
            </label>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {availableOrders.length === 0 ? (
                <p className="p-4 text-sm text-gray-500 text-center">No queued orders available</p>
              ) : (
                availableOrders.map(order => (
                  <label key={order.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      onChange={() => toggleOrder(order.id)}
                      className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    />
                    <div className="flex-1 text-sm">
                      <span className="font-medium text-gray-900">#{order.orderNumber || order.id?.slice(0, 8)}</span>
                      <span className="mx-2 text-gray-400">|</span>
                      <span className="text-gray-600">{order.customerName || 'Unknown'}</span>
                      <span className="mx-2 text-gray-400">|</span>
                      <span className="text-gray-500">{order.address || 'No address'}</span>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">
            Cancel
          </button>
          <Button onClick={handleCreateRoute} disabled={creating}>
            {creating ? 'Optimizing...' : 'Create & Optimize Route'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
