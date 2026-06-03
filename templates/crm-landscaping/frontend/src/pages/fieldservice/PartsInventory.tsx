import { useState, useEffect } from 'react';
import {
  Package, Plus, Search, AlertTriangle, Warehouse, BarChart3,
  Edit2, Loader2, X, DollarSign
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const CATEGORIES = [
  'Filters',
  'Compressors',
  'Thermostats',
  'Refrigerant',
  'Electrical',
  'Misc',
];

/**
 * Parts Inventory — Track parts and materials for field service
 */
export default function PartsInventory() {
  const toast = useToast();
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showLowStock, setShowLowStock] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedPart, setSelectedPart] = useState(null);

  useEffect(() => {
    loadParts();
  }, [search, categoryFilter, showLowStock]);

  const loadParts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      if (showLowStock) params.set('lowStock', 'true');
      const res = await api.get(`/api/inventory/items?${params.toString()}`);
      setParts(res.data || res || []);
    } catch (error) {
      console.error('Failed to load parts:', error);
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (partId) => {
    if (!confirm('Delete this part from inventory?')) return;
    try {
      await api.delete(`/api/inventory/items/${partId}`);
      toast.success('Part deleted');
      loadParts();
    } catch (error) {
      toast.error('Failed to delete part');
    }
  };

  const lowStockCount = parts.filter(p => p.isLowStock || (p.reorderPoint && Number(p.totalStock) < Number(p.reorderPoint))).length;
  const totalValue = parts.reduce((sum, p) => sum + (Number(p.unitCost) || 0) * (Number(p.totalStock) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Parts Inventory</h1>
          <p className="text-gray-500 dark:text-slate-400">Track parts and materials</p>
        </div>
        <button
          onClick={() => { setSelectedPart(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Part
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Package} label="Total Parts" value={parts.length} />
        <StatCard icon={Warehouse} label="Categories" value={CATEGORIES.length} />
        <StatCard icon={AlertTriangle} label="Low Stock" value={lowStockCount} color="red" />
        <StatCard
          icon={DollarSign}
          label="Total Value"
          value={`$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts by name or part number..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(cat => (
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
          <span className="text-sm text-gray-600 dark:text-slate-400">Low Stock Only</span>
        </label>
      </div>

      {/* Parts Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Part Name</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Part #</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Category</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Qty on Hand</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Min Stock</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Unit Cost</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 dark:text-slate-400">Location</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-700">
              {parts.map(part => {
                const qty = Number(part.totalStock) || 0;
                const minStock = Number(part.reorderPoint) || 0;
                const isLow = part.isLowStock || (minStock > 0 && qty < minStock);

                return (
                  <tr key={part.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isLow && <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{part.name}</p>
                          {part.description && (
                            <p className="text-sm text-gray-500 dark:text-slate-400 truncate max-w-xs">{part.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400 font-mono">
                      {part.sku || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {part.category ? (
                        <span className="px-2 py-1 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-xs rounded-full">
                          {part.category}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-medium ${isLow ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>
                        {qty}
                      </span>
                      {isLow && (
                        <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                          LOW
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-slate-400">
                      {minStock || '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900 dark:text-white">
                      ${Number(part.unitCost || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">
                      {part.location || part.locationName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelectedPart(part); setShowForm(true); }}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {parts.length === 0 && (
            <div className="text-center py-12">
              <Package className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No parts found</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 text-orange-600 hover:text-orange-700"
              >
                Add your first part
              </button>
            </div>
          )}
        </div>
      )}

      {/* Part Form Modal */}
      {showForm && (
        <PartFormModal
          part={selectedPart}
          onSave={() => { setShowForm(false); loadParts(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    red: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function PartFormModal({ part, onSave, onClose }) {
  const [form, setForm] = useState({
    name: part?.name || '',
    sku: part?.sku || '',
    description: part?.description || '',
    category: part?.category || '',
    unitCost: part?.unitCost || '',
    unitPrice: part?.unitPrice || '',
    unit: part?.unit || 'each',
    reorderPoint: part?.reorderPoint || '',
    vendor: part?.vendor || '',
    location: part?.location || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (part) {
        await api.put(`/api/inventory/items/${part.id}`, form);
      } else {
        await api.post('/api/inventory/items', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save part');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6 text-gray-900 dark:text-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{part ? 'Edit Part' : 'Add Part'}</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Part Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="e.g., 16x25x1 Pleated Filter"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Part Number / SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="Auto-generated if empty"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Unit Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sell Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.unitPrice}
                    onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Min Stock Level</label>
                <input
                  type="number"
                  value={form.reorderPoint}
                  onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="Reorder alert threshold"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  <option value="each">Each</option>
                  <option value="ft">Foot</option>
                  <option value="lb">Pound</option>
                  <option value="gal">Gallon</option>
                  <option value="box">Box</option>
                  <option value="can">Can</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="Warehouse, Truck #1, etc."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Vendor</label>
                <input
                  type="text"
                  value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="Supplier name"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                rows={2}
                placeholder="Optional notes about this part"
              />
            </div>

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
                {saving ? 'Saving...' : part ? 'Update Part' : 'Add Part'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
