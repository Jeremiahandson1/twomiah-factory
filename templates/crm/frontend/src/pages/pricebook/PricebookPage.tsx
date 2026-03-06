import { useState, useEffect } from 'react';
import { 
  BookOpen, Plus, Search, Filter, Edit2, Copy, Trash2,
  Loader2, ChevronRight, DollarSign, Clock, Package,
  Image, Star, Percent, Upload, Download, FolderTree
} from 'lucide-react';
import api from '../../services/api';

/**
 * Pricebook Management Page
 */
export default function PricebookPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showItemForm, setShowItemForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showGBB, setShowGBB] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    loadData();
  }, [search, selectedCategory]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [itemsRes, catsRes] = await Promise.all([
        api.get(`/api/pricebook/items?search=${search}&categoryId=${selectedCategory}`),
        api.get('/api/pricebook/categories?flat=true'),
      ]);
      setItems(itemsRes.data || []);
      setCategories(catsRes || []);
    } catch (error) {
      console.error('Failed to load pricebook:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (itemId) => {
    try {
      await api.post(`/api/pricebook/items/${itemId}/duplicate`);
      loadData();
    } catch (error) {
      alert('Failed to duplicate item');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricebook</h1>
          <p className="text-gray-500">Flat-rate service catalog</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCategoryForm(true)}
            className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            <FolderTree className="w-4 h-4" />
            Categories
          </button>
          <button
            onClick={() => { setSelectedItem(null); setShowItemForm(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
          >
            <Plus className="w-4 h-4" />
            Add Service
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Total Services" value={items.length} />
        <StatCard icon={FolderTree} label="Categories" value={categories.length} />
        <StatCard 
          icon={DollarSign} 
          label="Avg Price" 
          value={items.length ? `$${Math.round(items.reduce((s, i) => s + Number(i.price), 0) / items.length)}` : '$0'} 
        />
        <StatCard 
          icon={Percent} 
          label="Avg Margin" 
          value={items.length ? `${Math.round(items.reduce((s, i) => s + Number(i.margin || 0), 0) / items.length)}%` : '0%'}
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
            placeholder="Search services..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border rounded-lg"
        >
          <option value="">All Categories</option>
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <BookOpen className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No services found</p>
          <button
            onClick={() => setShowItemForm(true)}
            className="mt-4 text-orange-600 hover:text-orange-700"
          >
            Add your first service
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <ServiceCard
              key={item.id}
              item={item}
              onEdit={() => { setSelectedItem(item); setShowItemForm(true); }}
              onDuplicate={() => handleDuplicate(item.id)}
              onGBB={() => { setSelectedItem(item); setShowGBB(true); }}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showItemForm && (
        <ServiceFormModal
          item={selectedItem}
          categories={categories}
          onSave={() => { setShowItemForm(false); loadData(); }}
          onClose={() => setShowItemForm(false)}
        />
      )}

      {showCategoryForm && (
        <CategoriesModal
          categories={categories}
          onSave={loadData}
          onClose={() => setShowCategoryForm(false)}
        />
      )}

      {showGBB && selectedItem && (
        <GoodBetterBestModal
          item={selectedItem}
          onSave={() => { setShowGBB(false); loadData(); }}
          onClose={() => setShowGBB(false)}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color = 'gray' }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
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

function ServiceCard({ item, onEdit, onDuplicate, onGBB }) {
  return (
    <div className="bg-white rounded-xl border p-4 hover:shadow-lg transition-shadow">
      <div className="flex items-start gap-3">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover" />
        ) : (
          <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
            <Package className="w-6 h-6 text-gray-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{item.name}</p>
          <p className="text-sm text-gray-500">{item.code}</p>
          {item.category && (
            <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
              {item.category.name}
            </span>
          )}
        </div>
      </div>

      {item.description && (
        <p className="mt-3 text-sm text-gray-600 line-clamp-2">{item.description}</p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-gray-500">Price</p>
          <p className="font-bold text-gray-900">${Number(item.price).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500">Cost</p>
          <p className="font-medium text-gray-700">${Number(item.totalCost || item.cost).toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500">Margin</p>
          <p className={`font-medium ${Number(item.margin) > 30 ? 'text-green-600' : 'text-orange-600'}`}>
            {item.margin}%
          </p>
        </div>
      </div>

      {item.laborHours > 0 && (
        <div className="mt-2 flex items-center gap-1 text-sm text-gray-500">
          <Clock className="w-4 h-4" />
          {item.laborHours} hours
        </div>
      )}

      {item._count?.goodBetterBest > 0 && (
        <div className="mt-2 flex items-center gap-1 text-sm text-blue-600">
          <Star className="w-4 h-4" />
          Good-Better-Best options
        </div>
      )}

      <div className="mt-4 pt-4 border-t flex items-center gap-2">
        <button
          onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
        >
          <Edit2 className="w-4 h-4" />
          Edit
        </button>
        <button
          onClick={onGBB}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
        >
          <Star className="w-4 h-4" />
          Options
        </button>
        <button
          onClick={onDuplicate}
          className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ServiceFormModal({ item, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    code: item?.code || '',
    categoryId: item?.categoryId || '',
    description: item?.description || '',
    customerDescription: item?.customerDescription || '',
    price: item?.price || '',
    cost: item?.cost || '',
    laborHours: item?.laborHours || '',
    taxable: item?.taxable ?? true,
    showToCustomer: item?.showToCustomer ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (item) {
        await api.put(`/api/pricebook/items/${item.id}`, form);
      } else {
        await api.post('/api/pricebook/items', form);
      }
      onSave();
    } catch (error) {
      alert('Failed to save service');
    } finally {
      setSaving(false);
    }
  };

  // Calculate margin
  const margin = form.price && form.cost 
    ? ((form.price - form.cost) / form.price * 100).toFixed(1) 
    : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
          <h2 className="text-lg font-bold mb-4">{item ? 'Edit Service' : 'Add Service'}</h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Service Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., AC Tune-Up"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Auto-generated"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">No Category</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Internal Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="For your team's reference"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Description</label>
                <textarea
                  value={form.customerDescription}
                  onChange={(e) => setForm({ ...form, customerDescription: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                  placeholder="What customers will see on quotes/invoices"
                />
              </div>
            </div>

            {/* Pricing */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-3">Pricing</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) => setForm({ ...form, cost: e.target.value })}
                      className="w-full pl-7 pr-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Labor Hours</label>
                  <input
                    type="number"
                    step="0.25"
                    value={form.laborHours}
                    onChange={(e) => setForm({ ...form, laborHours: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Margin</label>
                  <div className={`px-3 py-2 rounded-lg font-medium ${
                    margin > 30 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {margin}%
                  </div>
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.taxable}
                  onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500"
                />
                <span className="text-sm text-gray-700">Taxable</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.showToCustomer}
                  onChange={(e) => setForm({ ...form, showToCustomer: e.target.checked })}
                  className="w-4 h-4 rounded text-orange-500"
                />
                <span className="text-sm text-gray-700">Show to customers</span>
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Saving...' : 'Save Service'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function CategoriesModal({ categories, onSave, onClose }) {
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newCategory.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/pricebook/categories', { name: newCategory });
      setNewCategory('');
      onSave();
    } catch (error) {
      alert('Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Manage Categories</h2>
          
          <div className="space-y-2 mb-4 max-h-64 overflow-y-auto">
            {categories.map(cat => (
              <div key={cat.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span>{cat.name}</span>
                <span className="text-sm text-gray-500">{cat._count?.items || 0} items</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category name"
              className="flex-1 px-3 py-2 border rounded-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg"
            >
              Add
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-4 px-4 py-2 border rounded-lg"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function GoodBetterBestModal({ item, onSave, onClose }) {
  const [options, setOptions] = useState([
    { tier: 'good', name: 'Basic', description: '', price: '', features: [], recommended: false },
    { tier: 'better', name: 'Standard', description: '', price: '', features: [], recommended: true },
    { tier: 'best', name: 'Premium', description: '', price: '', features: [], recommended: false },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const data = await api.get(`/api/pricebook/items/${item.id}/options`);
      if (data.length > 0) {
        setOptions(data.map(o => ({ ...o, features: o.features || [] })));
      }
    } catch (error) {
      console.error('Failed to load options:', error);
    }
  };

  const updateOption = (tier, field, value) => {
    setOptions(opts => opts.map(o => 
      o.tier === tier ? { ...o, [field]: value } : o
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/api/pricebook/items/${item.id}/options`, { 
        options: options.filter(o => o.name && o.price)
      });
      onSave();
    } catch (error) {
      alert('Failed to save options');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full p-6">
          <h2 className="text-lg font-bold mb-2">Good-Better-Best Options</h2>
          <p className="text-gray-500 mb-4">for {item.name}</p>

          <div className="grid grid-cols-3 gap-4">
            {options.map((opt) => (
              <div 
                key={opt.tier} 
                className={`p-4 rounded-xl border-2 ${
                  opt.recommended ? 'border-orange-500 bg-orange-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${
                    opt.tier === 'good' ? 'bg-gray-200 text-gray-700' :
                    opt.tier === 'better' ? 'bg-blue-100 text-blue-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {opt.tier}
                  </span>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name="recommended"
                      checked={opt.recommended}
                      onChange={() => {
                        setOptions(opts => opts.map(o => ({ ...o, recommended: o.tier === opt.tier })));
                      }}
                      className="text-orange-500"
                    />
                    Recommended
                  </label>
                </div>

                <input
                  type="text"
                  value={opt.name}
                  onChange={(e) => updateOption(opt.tier, 'name', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg mb-2 font-medium"
                  placeholder="Option name"
                />

                <div className="relative mb-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={opt.price}
                    onChange={(e) => updateOption(opt.tier, 'price', e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg text-xl font-bold"
                    placeholder="0.00"
                  />
                </div>

                <textarea
                  value={opt.description}
                  onChange={(e) => updateOption(opt.tier, 'description', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={3}
                  placeholder="Description..."
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-6">
            <button onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
              {saving ? 'Saving...' : 'Save Options'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
