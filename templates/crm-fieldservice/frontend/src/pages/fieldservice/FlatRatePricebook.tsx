import { useState, useEffect } from 'react';
import {
  BookOpen, Plus, Search, DollarSign, Clock, Package,
  Loader2, Edit2, X, FolderTree, Percent
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const SERVICE_CATEGORIES = ['Diagnostic', 'Repair', 'Installation', 'Maintenance'];

/**
 * Flat Rate Pricebook — Standard pricing for common field services
 */
export default function FlatRatePricebook() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    loadData();
  }, [search, selectedCategory]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (selectedCategory) params.set('categoryId', selectedCategory);
      const [itemsRes, catsRes] = await Promise.all([
        api.get(`/api/pricebook/items?${params.toString()}`),
        api.get('/api/pricebook/categories?flat=true'),
      ]);
      setItems(Array.isArray(itemsRes?.data) ? itemsRes.data : Array.isArray(itemsRes) ? itemsRes : []);
      setCategories(Array.isArray(catsRes) ? catsRes : []);
    } catch (error) {
      console.error('Failed to load pricebook:', error);
      toast.error('Failed to load pricebook');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (itemId) => {
    if (!confirm('Remove this rate from the pricebook?')) return;
    try {
      await api.delete(`/api/pricebook/items/${itemId}`);
      toast.success('Rate removed');
      loadData();
    } catch (error) {
      toast.error('Failed to delete rate');
    }
  };

  // Group items by category
  const groupedItems = items.reduce((groups, item) => {
    const catName = item.category?.name || item.categoryName || 'Uncategorized';
    if (!groups[catName]) groups[catName] = [];
    groups[catName].push(item);
    return groups;
  }, {});

  const avgPrice = items.length
    ? Math.round(items.reduce((s, i) => s + Number(i.price || 0), 0) / items.length)
    : 0;

  const avgDuration = items.length
    ? (items.reduce((s, i) => s + Number(i.laborHours || 0), 0) / items.length).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Flat Rate Pricebook</h1>
          <p className="text-gray-500 dark:text-slate-400">Standard pricing for field services</p>
        </div>
        <button
          onClick={() => { setSelectedItem(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Rate
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Total Services" value={items.length} />
        <StatCard icon={FolderTree} label="Categories" value={Object.keys(groupedItems).length} />
        <StatCard icon={DollarSign} label="Avg Price" value={`$${avgPrice}`} color="green" />
        <StatCard icon={Clock} label="Avg Duration" value={`${avgDuration} hrs`} color="blue" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
          {categories.length === 0 && SERVICE_CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Pricebook Table — grouped by category */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-slate-800 rounded-xl">
          <BookOpen className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 dark:text-slate-400">No rates found</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-orange-600 hover:text-orange-700"
          >
            Add your first service rate
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedItems).map(([categoryName, categoryItems]) => (
            <div key={categoryName} className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden">
              {/* Category Header */}
              <div className="px-4 py-3 bg-gray-50 dark:bg-slate-900 border-b dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{categoryName}</h3>
                  <span className="text-sm text-gray-500 dark:text-slate-400">
                    {categoryItems.length} service{categoryItems.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Services Table */}
              <table className="w-full">
                <thead>
                  <tr className="border-b dark:border-slate-700">
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Service</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Flat Rate</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Duration</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">Parts Included</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-700">
                  {categoryItems.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
                        {item.code && (
                          <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">{item.code}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2 max-w-xs">
                          {item.description || item.customerDescription || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-bold text-gray-900 dark:text-white text-lg">
                          ${Number(item.price || 0).toFixed(2)}
                        </p>
                        {item.cost > 0 && (
                          <p className="text-xs text-gray-500 dark:text-slate-400">
                            Cost: ${Number(item.cost || item.totalCost || 0).toFixed(2)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.laborHours > 0 ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-sm text-gray-700 dark:text-slate-300">
                              {item.laborHours} hr{item.laborHours !== 1 ? 's' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.partsIncluded ? (
                          <p className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2 max-w-xs">
                            {Array.isArray(item.partsIncluded)
                              ? item.partsIncluded.join(', ')
                              : item.partsIncluded}
                          </p>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setSelectedItem(item); setShowForm(true); }}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 rounded"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Rate Form Modal */}
      {showForm && (
        <RateFormModal
          item={selectedItem}
          categories={categories}
          onSave={() => { setShowForm(false); loadData(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function RateFormModal({ item, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    code: item?.code || '',
    categoryId: item?.categoryId || '',
    description: item?.description || '',
    customerDescription: item?.customerDescription || '',
    price: item?.price || '',
    cost: item?.cost || '',
    laborHours: item?.laborHours || '',
    partsIncluded: item?.partsIncluded
      ? (Array.isArray(item.partsIncluded) ? item.partsIncluded.join(', ') : item.partsIncluded)
      : '',
    taxable: item?.taxable ?? true,
  });
  const [saving, setSaving] = useState(false);

  const margin = form.price && form.cost
    ? ((form.price - form.cost) / form.price * 100).toFixed(1)
    : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        partsIncluded: form.partsIncluded
          ? form.partsIncluded.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      };
      if (item) {
        await api.put(`/api/pricebook/items/${item.id}`, payload);
      } else {
        await api.post('/api/pricebook/items', payload);
      }
      onSave();
    } catch (error) {
      alert('Failed to save rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto text-gray-900 dark:text-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">{item ? 'Edit Rate' : 'Add Rate'}</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Service Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="e.g., AC Diagnostic - Residential"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Code</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  placeholder="e.g., DIAG-001"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                >
                  <option value="">Select category...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                  {categories.length === 0 && SERVICE_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  rows={2}
                  placeholder="Internal description of this service"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Customer Description</label>
                <textarea
                  value={form.customerDescription}
                  onChange={(e) => setForm({ ...form, customerDescription: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                  rows={2}
                  placeholder="What the customer sees on the invoice"
                />
              </div>
            </div>

            {/* Pricing Section */}
            <div className="p-4 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
              <h3 className="font-medium text-gray-900 dark:text-white mb-3">Pricing</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Flat Rate</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Cost</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Est. Duration</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.25"
                      value={form.laborHours}
                      onChange={(e) => setForm({ ...form, laborHours: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                      placeholder="hrs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Margin</label>
                  <div className={`px-3 py-2 rounded-lg font-medium ${
                    Number(margin) > 30 ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400' : 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'
                  }`}>
                    {margin}%
                  </div>
                </div>
              </div>
            </div>

            {/* Parts Included */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Parts Included</label>
              <input
                type="text"
                value={form.partsIncluded}
                onChange={(e) => setForm({ ...form, partsIncluded: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600"
                placeholder="Comma-separated, e.g., 1x Filter, 1x Capacitor"
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Separate multiple parts with commas</p>
            </div>

            {/* Options */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                className="w-4 h-4 rounded text-orange-500"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">Taxable</span>
            </label>

            {/* Actions */}
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
                {saving ? 'Saving...' : item ? 'Update Rate' : 'Add Rate'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
