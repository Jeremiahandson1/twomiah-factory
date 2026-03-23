import { useState, useEffect } from 'react';
import { MapPin, Package, ArrowRightLeft, ClipboardList, Plus, Edit, Trash2, Search, ArrowRight, Check } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const LOCATION_TYPES = ['dispensary', 'warehouse', 'cultivation', 'manufacturing', 'distribution', 'other'];

const initialLocationForm = {
  name: '',
  type: 'dispensary',
  address: '',
  city: '',
  state: '',
  zip: '',
  licenseNumber: '',
  phone: '',
  isActive: true,
};

export default function LocationsPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('locations');

  // Locations
  const [locations, setLocations] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationModal, setLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<any>(null);
  const [locationForm, setLocationForm] = useState(initialLocationForm);
  const [savingLocation, setSavingLocation] = useState(false);
  const [deleteLocationOpen, setDeleteLocationOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<any>(null);
  const [deletingLocation, setDeletingLocation] = useState(false);

  // Inventory
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [inventory, setInventory] = useState<any[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');

  // Transfers
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromLocationId: '', toLocationId: '', items: [] as any[], notes: '' });
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [receiveModal, setReceiveModal] = useState(false);
  const [receivingTransfer, setReceivingTransfer] = useState<any>(null);
  const [receiveItems, setReceiveItems] = useState<any[]>([]);
  const [savingReceive, setSavingReceive] = useState(false);
  const [transferProducts, setTransferProducts] = useState<any[]>([]);

  // Count
  const [countLocationId, setCountLocationId] = useState('');
  const [countItems, setCountItems] = useState<any[]>([]);
  const [countInput, setCountInput] = useState({ sku: '', counted: '' });
  const [submittingCount, setSubmittingCount] = useState(false);
  const [countResults, setCountResults] = useState<any>(null);

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    if (tab === 'inventory' && selectedLocationId) loadInventory();
    if (tab === 'transfers') loadTransfers();
  }, [tab, selectedLocationId]);

  const loadLocations = async () => {
    setLoadingLocations(true);
    try {
      const data = await api.get('/api/locations');
      setLocations(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load locations:', err);
    } finally {
      setLoadingLocations(false);
    }
  };

  const loadInventory = async () => {
    if (!selectedLocationId) return;
    setLoadingInventory(true);
    try {
      const params: any = { limit: 100 };
      if (inventorySearch) params.search = inventorySearch;
      const data = await api.get(`/api/locations/${selectedLocationId}/inventory`, params);
      setInventory(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load inventory:', err);
    } finally {
      setLoadingInventory(false);
    }
  };

  const loadTransfers = async () => {
    setLoadingTransfers(true);
    try {
      const data = await api.get('/api/locations/transfers');
      setTransfers(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setLoadingTransfers(false);
    }
  };

  // Location CRUD
  const openCreateLocation = () => {
    setEditingLocation(null);
    setLocationForm(initialLocationForm);
    setLocationModal(true);
  };

  const openEditLocation = (loc: any) => {
    setEditingLocation(loc);
    setLocationForm({
      name: loc.name || '',
      type: loc.type || 'dispensary',
      address: loc.address || '',
      city: loc.city || '',
      state: loc.state || '',
      zip: loc.zip || '',
      licenseNumber: loc.licenseNumber || '',
      phone: loc.phone || '',
      isActive: loc.isActive ?? true,
    });
    setLocationModal(true);
  };

  const handleSaveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast.error('Location name is required');
      return;
    }
    setSavingLocation(true);
    try {
      if (editingLocation) {
        await api.put(`/api/locations/${editingLocation.id}`, locationForm);
        toast.success('Location updated');
      } else {
        await api.post('/api/locations', locationForm);
        toast.success('Location created');
      }
      setLocationModal(false);
      loadLocations();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save location');
    } finally {
      setSavingLocation(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!locationToDelete) return;
    setDeletingLocation(true);
    try {
      await api.delete(`/api/locations/${locationToDelete.id}`);
      toast.success('Location deleted');
      setDeleteLocationOpen(false);
      setLocationToDelete(null);
      loadLocations();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete location');
    } finally {
      setDeletingLocation(false);
    }
  };

  // Transfer
  const openCreateTransfer = async () => {
    setTransferForm({ fromLocationId: '', toLocationId: '', items: [], notes: '' });
    setTransferModal(true);
    try {
      const data = await api.get('/api/products', { limit: 200 });
      setTransferProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  const addTransferItem = () => {
    setTransferForm(prev => ({
      ...prev,
      items: [...prev.items, { productId: '', productName: '', quantity: 1 }],
    }));
  };

  const updateTransferItem = (index: number, field: string, value: any) => {
    setTransferForm(prev => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      if (field === 'productId') {
        const product = transferProducts.find(p => p.id === value);
        items[index].productName = product?.name || '';
      }
      return { ...prev, items };
    });
  };

  const removeTransferItem = (index: number) => {
    setTransferForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleCreateTransfer = async () => {
    if (!transferForm.fromLocationId || !transferForm.toLocationId) {
      toast.error('Select from and to locations');
      return;
    }
    if (transferForm.fromLocationId === transferForm.toLocationId) {
      toast.error('From and To locations must differ');
      return;
    }
    if (transferForm.items.length === 0) {
      toast.error('Add at least one product');
      return;
    }
    setSavingTransfer(true);
    try {
      await api.post('/api/locations/transfers', transferForm);
      toast.success('Transfer created');
      setTransferModal(false);
      loadTransfers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create transfer');
    } finally {
      setSavingTransfer(false);
    }
  };

  const openReceiveTransfer = (transfer: any) => {
    setReceivingTransfer(transfer);
    setReceiveItems((transfer.items || []).map((item: any) => ({
      ...item,
      receivedQuantity: item.quantity,
    })));
    setReceiveModal(true);
  };

  const handleReceiveTransfer = async () => {
    if (!receivingTransfer) return;
    setSavingReceive(true);
    try {
      await api.post(`/api/locations/transfers/${receivingTransfer.id}/receive`, {
        items: receiveItems,
      });
      toast.success('Transfer received');
      setReceiveModal(false);
      setReceivingTransfer(null);
      loadTransfers();
    } catch (err: any) {
      toast.error(err.message || 'Failed to receive transfer');
    } finally {
      setSavingReceive(false);
    }
  };

  // Inventory Count
  const addCountItem = () => {
    if (!countInput.sku.trim()) return;
    setCountItems(prev => [
      ...prev,
      { sku: countInput.sku, counted: parseInt(countInput.counted) || 0 },
    ]);
    setCountInput({ sku: '', counted: '' });
  };

  const removeCountItem = (index: number) => {
    setCountItems(prev => prev.filter((_, i) => i !== index));
  };

  const submitCount = async () => {
    if (!countLocationId) {
      toast.error('Select a location');
      return;
    }
    if (countItems.length === 0) {
      toast.error('Add at least one item');
      return;
    }
    setSubmittingCount(true);
    try {
      const result = await api.post(`/api/locations/${countLocationId}/count`, {
        items: countItems,
      });
      setCountResults(result);
      toast.success('Count submitted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit count');
    } finally {
      setSubmittingCount(false);
    }
  };

  const tabs = [
    { id: 'locations', label: 'Locations', icon: MapPin },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'transfers', label: 'Transfers', icon: ArrowRightLeft },
    { id: 'count', label: 'Count', icon: ClipboardList },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <p className="text-gray-600">Multi-location inventory management</p>
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

      {/* Locations Tab */}
      {tab === 'locations' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateLocation}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Location
            </Button>
          </div>
          {loadingLocations ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : locations.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-2">No locations added yet</p>
              <p className="text-sm text-gray-400">Add your first location to manage inventory across sites</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map(loc => (
                <div key={loc.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-green-600" />
                      <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                    </div>
                    <span className={`px-2 py-0.5 text-xs rounded-full capitalize ${
                      loc.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {loc.isActive !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 capitalize mb-2">{loc.type}</p>
                  {(loc.address || loc.city) && (
                    <p className="text-sm text-gray-600 mb-2">
                      {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ')}
                    </p>
                  )}
                  {loc.licenseNumber && (
                    <p className="text-xs text-gray-400 mb-2">License: {loc.licenseNumber}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t">
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">{loc.productCount ?? 0}</p>
                      <p className="text-xs text-gray-500">Products</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-gray-900">
                        ${Number(loc.inventoryValue || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">Inventory Value</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t">
                    <button onClick={() => openEditLocation(loc)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button onClick={() => { setLocationToDelete(loc); setDeleteLocationOpen(true); }} className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inventory Tab */}
      {tab === 'inventory' && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-64">
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              >
                <option value="">Select location</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            {selectedLocationId && (
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadInventory()}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            )}
          </div>
          {!selectedLocationId ? (
            <div className="bg-white rounded-lg shadow-sm p-12 text-center">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Select a location to view inventory</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Min</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Aisle/Shelf/Bin</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RFID Tag</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Counted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loadingInventory ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center">
                          <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                        </td>
                      </tr>
                    ) : inventory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No inventory at this location</td>
                      </tr>
                    ) : inventory.map(item => (
                      <tr key={item.id} className={`hover:bg-gray-50 ${item.quantity <= (item.minQuantity || 0) ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.productName || item.name || '—'}</td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600">{item.sku || '—'}</td>
                        <td className={`px-4 py-3 text-sm text-right font-medium ${item.quantity <= (item.minQuantity || 0) ? 'text-red-600' : 'text-gray-900'}`}>
                          {item.quantity ?? 0}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-500">{item.minQuantity ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {[item.aisle, item.shelf, item.bin].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-500">{item.rfidTag || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {item.lastCounted ? new Date(item.lastCounted).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transfers Tab */}
      {tab === 'transfers' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateTransfer}>
              <Plus className="w-4 h-4 mr-2 inline" />
              New Transfer
            </Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Items</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingTransfers ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : transfers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No transfers yet</td>
                    </tr>
                  ) : transfers.map(transfer => (
                    <tr key={transfer.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {transfer.createdAt ? new Date(transfer.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{transfer.fromLocationName || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{transfer.toLocationName || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-600">{transfer.items?.length || transfer.itemCount || 0}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          transfer.status === 'received' ? 'bg-green-100 text-green-700' :
                          transfer.status === 'in_transit' ? 'bg-blue-100 text-blue-700' :
                          transfer.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {transfer.status || 'pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {transfer.status === 'in_transit' && (
                          <button
                            onClick={() => openReceiveTransfer(transfer)}
                            className="text-sm text-green-600 hover:text-green-700 flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Receive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Count Tab */}
      {tab === 'count' && (
        <div className="max-w-3xl space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Inventory Count</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <select
                value={countLocationId}
                onChange={(e) => setCountLocationId(e.target.value)}
                className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              >
                <option value="">Select location</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU / Product</label>
                <input
                  type="text"
                  value={countInput.sku}
                  onChange={(e) => setCountInput({ ...countInput, sku: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addCountItem()}
                  className="w-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Scan or type SKU"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Count</label>
                <input
                  type="number"
                  value={countInput.counted}
                  onChange={(e) => setCountInput({ ...countInput, counted: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addCountItem()}
                  className="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="0"
                />
              </div>
              <Button onClick={addCountItem} variant="secondary">
                <Plus className="w-4 h-4 mr-1 inline" /> Add
              </Button>
            </div>

            {countItems.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Counted</th>
                      <th className="px-4 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {countItems.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-sm font-mono text-gray-900">{item.sku}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-900">{item.counted}</td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => removeCountItem(idx)} className="text-red-500 hover:text-red-700">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Button onClick={submitCount} disabled={submittingCount || countItems.length === 0}>
              {submittingCount ? 'Submitting...' : `Submit Count (${countItems.length} items)`}
            </Button>
          </div>

          {/* Discrepancies */}
          {countResults && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Count Results</h3>
              {countResults.discrepancies && countResults.discrepancies.length > 0 ? (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-red-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-red-600 uppercase">SKU</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-red-600 uppercase">Expected</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-red-600 uppercase">Counted</th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-red-600 uppercase">Difference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {countResults.discrepancies.map((d: any, idx: number) => (
                        <tr key={idx}>
                          <td className="px-4 py-2 text-sm font-mono text-gray-900">{d.sku}</td>
                          <td className="px-4 py-2 text-sm text-right text-gray-600">{d.expected}</td>
                          <td className="px-4 py-2 text-sm text-right text-gray-600">{d.counted}</td>
                          <td className={`px-4 py-2 text-sm text-right font-medium ${(d.counted - d.expected) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {d.counted - d.expected > 0 ? '+' : ''}{d.counted - d.expected}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600">
                  <Check className="w-5 h-5" />
                  <span>No discrepancies found. All counts match.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Location Modal */}
      <Modal
        isOpen={locationModal}
        onClose={() => setLocationModal(false)}
        title={editingLocation ? 'Edit Location' : 'Add Location'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
              <input
                type="text"
                value={locationForm.name}
                onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
                placeholder="Main Store"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
              <select
                value={locationForm.type}
                onChange={(e) => setLocationForm({ ...locationForm, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                {LOCATION_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Address</label>
            <input
              type="text"
              value={locationForm.address}
              onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">City</label>
              <input
                type="text"
                value={locationForm.city}
                onChange={(e) => setLocationForm({ ...locationForm, city: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">State</label>
              <input
                type="text"
                value={locationForm.state}
                onChange={(e) => setLocationForm({ ...locationForm, state: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">ZIP</label>
              <input
                type="text"
                value={locationForm.zip}
                onChange={(e) => setLocationForm({ ...locationForm, zip: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">License Number</label>
              <input
                type="text"
                value={locationForm.licenseNumber}
                onChange={(e) => setLocationForm({ ...locationForm, licenseNumber: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Phone</label>
              <input
                type="tel"
                value={locationForm.phone}
                onChange={(e) => setLocationForm({ ...locationForm, phone: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={locationForm.isActive}
              onChange={(e) => setLocationForm({ ...locationForm, isActive: e.target.checked })}
              className="w-4 h-4 text-green-600 border-slate-500 rounded focus:ring-green-500"
            />
            <span className="text-sm text-slate-300">Active</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setLocationModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveLocation} disabled={savingLocation}>
            {savingLocation ? 'Saving...' : editingLocation ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal
        isOpen={transferModal}
        onClose={() => setTransferModal(false)}
        title="New Transfer"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">From Location *</label>
              <select
                value={transferForm.fromLocationId}
                onChange={(e) => setTransferForm({ ...transferForm, fromLocationId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                <option value="">Select</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">To Location *</label>
              <select
                value={transferForm.toLocationId}
                onChange={(e) => setTransferForm({ ...transferForm, toLocationId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
              >
                <option value="">Select</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">Products</label>
              <button onClick={addTransferItem} className="text-sm text-green-400 hover:text-green-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Product
              </button>
            </div>
            {transferForm.items.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">No products added</p>
            ) : (
              <div className="space-y-2">
                {transferForm.items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={item.productId}
                      onChange={(e) => updateTransferItem(idx, 'productId', e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white text-sm"
                    >
                      <option value="">Select product</option>
                      {transferProducts.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateTransferItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                      className="w-24 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white text-sm"
                      placeholder="Qty"
                    />
                    <button onClick={() => removeTransferItem(idx)} className="text-red-400 hover:text-red-300">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setTransferModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreateTransfer} disabled={savingTransfer}>
            {savingTransfer ? 'Creating...' : 'Create Transfer'}
          </Button>
        </div>
      </Modal>

      {/* Receive Transfer Modal */}
      <Modal
        isOpen={receiveModal}
        onClose={() => { setReceiveModal(false); setReceivingTransfer(null); }}
        title="Receive Transfer"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Confirm received quantities for each item.</p>
          {receiveItems.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-white">{item.productName || `Product ${idx + 1}`}</span>
              <span className="text-sm text-slate-400">Sent: {item.quantity}</span>
              <input
                type="number"
                value={item.receivedQuantity}
                onChange={(e) => {
                  const items = [...receiveItems];
                  items[idx] = { ...items[idx], receivedQuantity: parseInt(e.target.value) || 0 };
                  setReceiveItems(items);
                }}
                className="w-24 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-white text-sm"
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => { setReceiveModal(false); setReceivingTransfer(null); }} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleReceiveTransfer} disabled={savingReceive}>
            {savingReceive ? 'Receiving...' : 'Confirm Receipt'}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteLocationOpen}
        onClose={() => { setDeleteLocationOpen(false); setLocationToDelete(null); }}
        onConfirm={handleDeleteLocation}
        title="Delete Location"
        message={`Are you sure you want to delete "${locationToDelete?.name}"?`}
        confirmText="Delete"
      />
    </div>
  );
}
