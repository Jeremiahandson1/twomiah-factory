import { useState, useEffect } from 'react';
import { 
  Package, Plus, Search, Filter, Warehouse, Truck,
  AlertTriangle, ArrowRightLeft, ShoppingCart, BarChart3,
  Edit2, Trash2, Loader2, ChevronRight, Minus, Check
} from 'lucide-react';
import api from '../../services/api';

/**
 * Inventory Management Page
 */
export default function InventoryPage() {
  const [tab, setTab] = useState('items'); // items, locations, orders, reports
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [showLowStock, setShowLowStock] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    loadData();
  }, [search, category, showLowStock]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsRes, locsRes, catsRes] = await Promise.all([
        api.get(`/api/inventory/items?search=${search}&category=${category}&lowStock=${showLowStock}`),
        api.get('/api/inventory/locations'),
        api.get('/api/inventory/categories'),
      ]);
      setItems(itemsRes.data || []);
      setLocations(locsRes || []);
      setCategories(catsRes || []);
    } catch (error) {
      console.error('Failed to load inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500">Track parts and materials</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTransfer(true)}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            <ArrowRightLeft className="w-4 h-4" />
            Transfer
          </button>
          <button
            onClick={() => { setSelectedItem(null); setShowItemForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard 
          icon={Package} 
          label="Total Items" 
          value={items.length}
        />
        <StatCard 
          icon={Warehouse} 
          label="Locations" 
          value={locations.length}
        />
        <StatCard 
          icon={AlertTriangle} 
          label="Low Stock" 
          value={items.filter(i => i.isLowStock).length}
          color="red"
        />
        <StatCard 
          icon={BarChart3} 
          label="Total Value" 
          value="$--"
          color="green"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: 'items', label: 'Items', icon: Package },
          { id: 'locations', label: 'Locations', icon: Warehouse },
          { id: 'orders', label: 'Purchase Orders', icon: ShoppingCart },
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

      {/* Items Tab */}
      {tab === 'items' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showLowStock}
                onChange={(e) => setShowLowStock(e.target.checked)}
                className="w-4 h-4 rounded text-orange-500"
              />
              <span className="text-sm text-gray-600">Low Stock Only</span>
            </label>
          </div>

          {/* Items Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="bg-white rounded-xl border overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Item</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">SKU</th>
                    <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Category</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">In Stock</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Cost</th>
                    <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Price</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {item.isLowStock && (
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{item.name}</p>
                            {item.description && (
                              <p className="text-sm text-gray-500 truncate max-w-xs">{item.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.sku}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{item.category || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${item.isLowStock ? 'text-red-600' : 'text-gray-900'}`}>
                          {item.totalStock} {item.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-500">
                        ${Number(item.unitCost).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-900">
                        ${Number(item.unitPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => { setSelectedItem(item); setShowAdjust(true); }}
                            className="p-1 text-gray-400 hover:text-gray-600"
                            title="Adjust Stock"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setSelectedItem(item); setShowItemForm(true); }}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No items found
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Locations Tab */}
      {tab === 'locations' && (
        <LocationsTab 
          locations={locations} 
          onAddLocation={() => setShowLocationForm(true)}
          onRefresh={loadData}
        />
      )}

      {/* Purchase Orders Tab */}
      {tab === 'orders' && (
        <PurchaseOrdersTab locations={locations} />
      )}

      {/* Modals */}
      {showItemForm && (
        <ItemFormModal
          item={selectedItem}
          onSave={() => { setShowItemForm(false); loadData(); }}
          onClose={() => setShowItemForm(false)}
        />
      )}

      {showLocationForm && (
        <LocationFormModal
          onSave={() => { setShowLocationForm(false); loadData(); }}
          onClose={() => setShowLocationForm(false)}
        />
      )}

      {showTransfer && (
        <TransferModal
          items={items}
          locations={locations}
          onSave={() => { setShowTransfer(false); loadData(); }}
          onClose={() => setShowTransfer(false)}
        />
      )}

      {showAdjust && selectedItem && (
        <AdjustStockModal
          item={selectedItem}
          locations={locations}
          onSave={() => { setShowAdjust(false); loadData(); }}
          onClose={() => setShowAdjust(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function LocationsTab({ locations, onAddLocation, onRefresh }) {
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadLocationInventory = async (locationId) => {
    setLoading(true);
    try {
      const data = await api.get(`/api/inventory/locations/${locationId}/inventory`);
      setInventory(data);
      setSelectedLocation(locationId);
    } catch (error) {
      console.error('Failed to load location inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Locations List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Locations</h3>
          <button
            onClick={onAddLocation}
            className="text-sm text-orange-600 hover:text-orange-700"
          >
            + Add
          </button>
        </div>
        
        {locations.map(loc => (
          <button
            key={loc.id}
            onClick={() => loadLocationInventory(loc.id)}
            className={`w-full p-4 rounded-xl border text-left transition-colors ${
              selectedLocation === loc.id
                ? 'border-orange-300 bg-orange-50'
                : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              {loc.type === 'truck' ? (
                <Truck className="w-5 h-5 text-blue-500" />
              ) : (
                <Warehouse className="w-5 h-5 text-gray-500" />
              )}
              <div>
                <p className="font-medium text-gray-900">{loc.name}</p>
                <p className="text-sm text-gray-500">
                  {loc._count?.stockLevels || 0} items
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
            </div>
          </button>
        ))}
      </div>

      {/* Location Inventory */}
      <div className="col-span-2">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : inventory ? (
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <h3 className="font-medium text-gray-900">{inventory.name} Inventory</h3>
            </div>
            <div className="divide-y max-h-96 overflow-y-auto">
              {inventory.stockLevels?.map(sl => (
                <div key={sl.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{sl.item.name}</p>
                    <p className="text-sm text-gray-500">{sl.item.sku}</p>
                  </div>
                  <p className="font-medium">
                    {sl.quantity} {sl.item.unit}
                  </p>
                </div>
              ))}
              {!inventory.stockLevels?.length && (
                <div className="p-8 text-center text-gray-500">
                  No items at this location
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-gray-500">
            Select a location to view inventory
          </div>
        )}
      </div>
    </div>
  );
}

function PurchaseOrdersTab({ locations }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const data = await api.get('/api/inventory/purchase-orders');
      setOrders(data.data || []);
    } catch (error) {
      console.error('Failed to load orders:', error);
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
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Purchase Orders</h3>
        <button className="text-sm text-orange-600 hover:text-orange-700">
          + New Order
        </button>
      </div>
      {orders.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No purchase orders yet
        </div>
      ) : (
        <div className="divide-y">
          {orders.map(order => (
            <div key={order.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{order.number}</p>
                <p className="text-sm text-gray-500">{order.vendor}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs ${
                order.status === 'received' ? 'bg-green-100 text-green-700' :
                order.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {order.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemFormModal({ item, onSave, onClose }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    sku: item?.sku || '',
    description: item?.description || '',
    category: item?.category || '',
    unitCost: item?.unitCost || '',
    unitPrice: item?.unitPrice || '',
    unit: item?.unit || 'each',
    reorderPoint: item?.reorderPoint || '',
    vendor: item?.vendor || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (item) {
        await api.put(`/api/inventory/items/${item.id}`, form);
      } else {
        await api.post('/api/inventory/items', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <h2 className="text-lg font-bold mb-4">{item ? 'Edit Item' : 'Add Item'}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Auto-generated"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.unitCost}
                  onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="each">Each</option>
                  <option value="ft">Foot</option>
                  <option value="lb">Pound</option>
                  <option value="gal">Gallon</option>
                  <option value="box">Box</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Point</label>
                <input
                  type="number"
                  value={form.reorderPoint}
                  onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function LocationFormModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', type: 'warehouse' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/inventory/locations', form);
      onSave();
    } catch (error) {
      alert('Failed to save location');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Location</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Main Warehouse, Truck #1, etc."
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="warehouse">Warehouse</option>
                <option value="truck">Truck/Vehicle</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function TransferModal({ items, locations, onSave, onClose }) {
  const [form, setForm] = useState({
    itemId: '',
    fromLocationId: '',
    toLocationId: '',
    quantity: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/inventory/transfer', form);
      onSave();
    } catch (error) {
      alert(error.message || 'Failed to transfer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Transfer Stock</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item</label>
              <select
                value={form.itemId}
                onChange={(e) => setForm({ ...form, itemId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select item...</option>
                {items.map(item => (
                  <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
              <select
                value={form.fromLocationId}
                onChange={(e) => setForm({ ...form, fromLocationId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select source...</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <select
                value={form.toLocationId}
                onChange={(e) => setForm({ ...form, toLocationId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select destination...</option>
                {locations.filter(l => l.id !== form.fromLocationId).map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                min="1"
                required
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function AdjustStockModal({ item, locations, onSave, onClose }) {
  const [form, setForm] = useState({
    locationId: '',
    quantity: '',
    reason: '',
  });
  const [adjustType, setAdjustType] = useState('add');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const quantity = adjustType === 'add' ? parseInt(form.quantity) : -parseInt(form.quantity);
      await api.post('/api/inventory/adjust', {
        itemId: item.id,
        locationId: form.locationId,
        quantity,
        reason: form.reason,
      });
      onSave();
    } catch (error) {
      alert(error.message || 'Failed to adjust');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Adjust Stock - {item.name}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdjustType('add')}
                className={`flex-1 py-2 rounded-lg border ${
                  adjustType === 'add' ? 'bg-green-100 border-green-300 text-green-700' : ''
                }`}
              >
                Add Stock
              </button>
              <button
                type="button"
                onClick={() => setAdjustType('remove')}
                className={`flex-1 py-2 rounded-lg border ${
                  adjustType === 'remove' ? 'bg-red-100 border-red-300 text-red-700' : ''
                }`}
              >
                Remove Stock
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <select
                value={form.locationId}
                onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                min="1"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
              <input
                type="text"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="Received shipment, damaged, etc."
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Adjust'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
