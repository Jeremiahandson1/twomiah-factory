import { useState, useEffect, useCallback } from 'react';
import { Truck, MapPin, Clock, CheckCircle, User, Phone, Package, RefreshCw, Plus } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const deliveryStatuses = [
  { value: '', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusColors: Record<string, string> = {
  queued: 'bg-yellow-100 text-yellow-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function DeliveryPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const [zoneModal, setZoneModal] = useState(false);
  const [zoneForm, setZoneForm] = useState({ name: '', zipCodes: '', fee: '', minOrder: '', isActive: true });
  const [savingZone, setSavingZone] = useState(false);

  useEffect(() => {
    if (tab === 'active') loadDeliveries();
    if (tab === 'zones') loadZones();
  }, [tab, statusFilter]);

  const loadDeliveries = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50 };
      if (statusFilter) params.status = statusFilter;
      const data = await api.get('/api/delivery/orders', params);
      setDeliveries(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  const loadZones = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/delivery/zones');
      setZones(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load zones:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateDeliveryStatus = async (id: string, status: string) => {
    try {
      await api.put(`/api/delivery/orders/${id}/status`, { deliveryStatus: status });
      toast.success(`Delivery marked as ${status.replace('_', ' ')}`);
      loadDeliveries();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update delivery');
    }
  };

  const handleSaveZone = async () => {
    if (!zoneForm.name.trim()) {
      toast.error('Zone name is required');
      return;
    }
    setSavingZone(true);
    try {
      await api.post('/api/delivery/zones', {
        name: zoneForm.name,
        zipCodes: zoneForm.zipCodes.split(',').map(z => z.trim()).filter(Boolean),
        deliveryFee: parseFloat(zoneForm.fee) || 0,
        minimumOrder: parseFloat(zoneForm.minOrder) || 0,
        active: zoneForm.isActive,
      });
      toast.success('Zone created');
      setZoneModal(false);
      setZoneForm({ name: '', zipCodes: '', fee: '', minOrder: '', isActive: true });
      loadZones();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create zone');
    } finally {
      setSavingZone(false);
    }
  };

  const tabs = [
    { id: 'active', label: 'Active Deliveries', icon: Truck },
    { id: 'queue', label: 'Delivery Queue', icon: Clock },
    { id: 'zones', label: 'Zones', icon: MapPin },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delivery Management</h1>
          <p className="text-gray-600">Track and manage cannabis deliveries</p>
        </div>
        <button
          onClick={() => tab === 'active' || tab === 'queue' ? loadDeliveries() : loadZones()}
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

      {/* Active Deliveries / Queue */}
      {(tab === 'active' || tab === 'queue') && (
        <div>
          {/* Status Filter */}
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {deliveryStatuses.map(s => (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
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
            <div className="space-y-3">
              {deliveries.map(delivery => (
                <div key={delivery.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold text-gray-900">#{delivery.orderNumber || delivery.id?.slice(0, 8)}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[delivery.status] || 'bg-gray-100 text-gray-600'}`}>
                          {(delivery.status || 'queued').replace('_', ' ')}
                        </span>
                      </div>
                      <div className="grid md:grid-cols-3 gap-3 text-sm">
                        <div className="flex items-center gap-2 text-gray-600">
                          <User className="w-4 h-4" />
                          <span>{delivery.customerName || 'Unknown'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span>{delivery.customerPhone || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="w-4 h-4" />
                          <span>{delivery.address || '—'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <span className="text-gray-500">
                          <Package className="w-3 h-3 inline mr-1" />
                          {delivery.itemCount || 0} items
                        </span>
                        <span className="font-medium text-gray-900">${Number(delivery.total || 0).toFixed(2)}</span>
                        {delivery.driverName && (
                          <span className="text-blue-600">Driver: {delivery.driverName}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      {delivery.status === 'queued' && (
                        <button
                          onClick={() => updateDeliveryStatus(delivery.id, 'assigned')}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          Assign
                        </button>
                      )}
                      {delivery.status === 'assigned' && (
                        <button
                          onClick={() => updateDeliveryStatus(delivery.id, 'in_transit')}
                          className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                        >
                          Start
                        </button>
                      )}
                      {delivery.status === 'in_transit' && (
                        <button
                          onClick={() => updateDeliveryStatus(delivery.id, 'delivered')}
                          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          Delivered
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {deliveries.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Truck className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No deliveries found</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Zones */}
      {tab === 'zones' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => { setZoneForm({ name: '', zipCodes: '', fee: '', minOrder: '', isActive: true }); setZoneModal(true); }}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Zone
            </Button>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zones.map(zone => (
              <div key={zone.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-green-600" />
                    {zone.name}
                  </h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${zone.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {zone.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>ZIP codes: {Array.isArray(zone.zipCodes) ? zone.zipCodes.join(', ') : zone.zipCodes || '—'}</p>
                  <p>Delivery fee: ${Number(zone.fee || 0).toFixed(2)}</p>
                  <p>Min order: ${Number(zone.minOrder || 0).toFixed(2)}</p>
                </div>
              </div>
            ))}
            {zones.length === 0 && !loading && (
              <p className="col-span-full text-center text-gray-500 py-8">No delivery zones configured</p>
            )}
          </div>

          <Modal
            isOpen={zoneModal}
            onClose={() => setZoneModal(false)}
            title="Add Delivery Zone"
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone Name *</label>
                <input
                  type="text"
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Downtown"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Codes (comma-separated)</label>
                <input
                  type="text"
                  value={zoneForm.zipCodes}
                  onChange={(e) => setZoneForm({ ...zoneForm, zipCodes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="90210, 90211, 90212"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Fee ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={zoneForm.fee}
                    onChange={(e) => setZoneForm({ ...zoneForm, fee: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="5.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Order ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={zoneForm.minOrder}
                    onChange={(e) => setZoneForm({ ...zoneForm, minOrder: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                    placeholder="50.00"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={zoneForm.isActive}
                  onChange={(e) => setZoneForm({ ...zoneForm, isActive: e.target.checked })}
                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">Active</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setZoneModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
              <Button onClick={handleSaveZone} disabled={savingZone}>
                {savingZone ? 'Saving...' : 'Create Zone'}
              </Button>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
