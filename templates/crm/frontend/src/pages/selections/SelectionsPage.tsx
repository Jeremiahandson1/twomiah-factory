import { useState, useEffect } from 'react';
import { 
  Palette, Plus, Check, Clock, Package, Truck,
  DollarSign, AlertTriangle, ChevronRight, Search,
  Loader2, Image, ArrowUpRight, ArrowDownRight, Filter
} from 'lucide-react';
import api from '../../services/api';

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'gray', icon: Clock },
  selected: { label: 'Selected', color: 'blue', icon: Check },
  approved: { label: 'Approved', color: 'green', icon: Check },
  ordered: { label: 'Ordered', color: 'purple', icon: Package },
  received: { label: 'Received', color: 'emerald', icon: Truck },
};

/**
 * Project Selections Page
 */
export default function SelectionsPage({ projectId }) {
  const [selections, setSelections] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showOptionPicker, setShowOptionPicker] = useState(null);
  const [showAddSelection, setShowAddSelection] = useState(false);

  useEffect(() => {
    loadData();
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [selectionsRes, summaryRes, categoriesRes] = await Promise.all([
        api.get(`/api/selections/project/${projectId}`),
        api.get(`/api/selections/project/${projectId}/summary`),
        api.get('/api/selections/categories'),
      ]);
      setSelections(selectionsRes || []);
      setSummary(summaryRes);
      setCategories(categoriesRes || []);
    } catch (error) {
      console.error('Failed to load selections:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredSelections = selections.filter(sel => {
    if (filter === 'all') return true;
    if (filter === 'pending') return sel.status === 'pending';
    if (filter === 'upgrades') return sel.priceDifference > 0;
    if (filter === 'credits') return sel.priceDifference < 0;
    return true;
  });

  // Group by category
  const grouped = filteredSelections.reduce((acc, sel) => {
    const cat = sel.category?.name || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(sel);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Selections</h2>
          <p className="text-gray-500">Client finish and fixture selections</p>
        </div>
        <button
          onClick={() => setShowAddSelection(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-4 h-4" />
          Add Selection
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-4">
          <SummaryCard
            label="Total"
            value={summary.total}
            icon={Palette}
          />
          <SummaryCard
            label="Pending"
            value={summary.pending}
            icon={Clock}
            color={summary.overdue > 0 ? 'orange' : 'gray'}
            subtitle={summary.overdue > 0 ? `${summary.overdue} overdue` : null}
          />
          <SummaryCard
            label="Allowance"
            value={`$${summary.totalAllowance.toLocaleString()}`}
            icon={DollarSign}
            color="blue"
          />
          <SummaryCard
            label="Selected"
            value={`$${summary.totalSelected.toLocaleString()}`}
            icon={Check}
            color="green"
          />
          <SummaryCard
            label="Net Change"
            value={`${summary.netDifference >= 0 ? '+' : ''}$${summary.netDifference.toLocaleString()}`}
            icon={summary.netDifference >= 0 ? ArrowUpRight : ArrowDownRight}
            color={summary.netDifference > 0 ? 'orange' : summary.netDifference < 0 ? 'green' : 'gray'}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {['all', 'pending', 'upgrades', 'credits'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm capitalize ${
              filter === f
                ? 'bg-orange-100 text-orange-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Selections by Category */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <Palette className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500">No selections yet</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b">
                <h3 className="font-medium text-gray-900">{category}</h3>
              </div>
              <div className="divide-y">
                {items.map(selection => (
                  <SelectionRow
                    key={selection.id}
                    selection={selection}
                    onSelect={() => setShowOptionPicker(selection)}
                    onRefresh={loadData}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Option Picker Modal */}
      {showOptionPicker && (
        <OptionPickerModal
          selection={showOptionPicker}
          onSelect={(optionId) => handleSelectOption(showOptionPicker.id, optionId)}
          onClose={() => setShowOptionPicker(null)}
        />
      )}

      {/* Add Selection Modal */}
      {showAddSelection && (
        <AddSelectionModal
          projectId={projectId}
          categories={categories}
          onSave={() => { setShowAddSelection(false); loadData(); }}
          onClose={() => setShowAddSelection(false)}
        />
      )}
    </div>
  );

  async function handleSelectOption(selectionId, optionId) {
    try {
      await api.post(`/api/selections/${selectionId}/select`, { optionId });
      setShowOptionPicker(null);
      loadData();
    } catch (error) {
      alert('Failed to save selection');
    }
  }
}

function SummaryCard({ label, value, icon: Icon, color = 'gray', subtitle }) {
  const colors = {
    gray: 'bg-gray-50 text-gray-600',
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
      {subtitle && <p className="text-xs mt-1 font-medium">{subtitle}</p>}
    </div>
  );
}

function SelectionRow({ selection, onSelect, onRefresh }) {
  const [showActions, setShowActions] = useState(false);
  const status = STATUS_CONFIG[selection.status] || STATUS_CONFIG.pending;
  const StatusIcon = status.icon;

  const isOverdue = selection.dueDate && 
    new Date(selection.dueDate) < new Date() && 
    selection.status === 'pending';

  const handleApprove = async () => {
    try {
      await api.post(`/api/selections/${selection.id}/approve`);
      onRefresh();
    } catch (error) {
      alert('Failed to approve');
    }
  };

  const handleMarkOrdered = async () => {
    const orderNumber = prompt('Enter order/PO number (optional):');
    try {
      await api.post(`/api/selections/${selection.id}/ordered`, { orderNumber });
      onRefresh();
    } catch (error) {
      alert('Failed to update');
    }
  };

  const handleMarkReceived = async () => {
    try {
      await api.post(`/api/selections/${selection.id}/received`, {});
      onRefresh();
    } catch (error) {
      alert('Failed to update');
    }
  };

  return (
    <div className="p-4 hover:bg-gray-50">
      <div className="flex items-start gap-4">
        {/* Image or placeholder */}
        <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
          {selection.selectedOption?.imageUrl ? (
            <img
              src={selection.selectedOption.imageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <Palette className="w-6 h-6 text-gray-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-gray-900">{selection.name}</p>
              {selection.location && (
                <p className="text-sm text-gray-500">{selection.location}</p>
              )}
            </div>
            <span className={`px-2 py-1 text-xs rounded-full bg-${status.color}-100 text-${status.color}-700`}>
              {status.label}
            </span>
          </div>

          {/* Selected option */}
          {selection.selectedOption ? (
            <div className="mt-2 p-2 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium">{selection.selectedOption.name}</p>
              <p className="text-xs text-gray-500">
                {selection.selectedOption.manufacturer} {selection.selectedOption.model}
              </p>
            </div>
          ) : (
            <button
              onClick={onSelect}
              className="mt-2 text-sm text-orange-600 hover:text-orange-700"
            >
              + Select an option
            </button>
          )}

          {/* Pricing */}
          <div className="mt-2 flex items-center gap-4 text-sm">
            <span className="text-gray-500">
              Allowance: ${selection.allowance?.toLocaleString() || 0}
            </span>
            {selection.priceDifference !== 0 && selection.priceDifference !== undefined && (
              <span className={selection.priceDifference > 0 ? 'text-orange-600' : 'text-green-600'}>
                {selection.priceDifference > 0 ? '+' : ''}${selection.priceDifference.toLocaleString()}
                {selection.priceDifference > 0 ? ' upgrade' : ' credit'}
              </span>
            )}
          </div>

          {/* Due date */}
          {selection.dueDate && (
            <p className={`mt-1 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
              {isOverdue ? '⚠️ Overdue: ' : 'Due: '}
              {new Date(selection.dueDate).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {selection.status === 'pending' && (
            <button
              onClick={onSelect}
              className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg"
            >
              Select
            </button>
          )}
          {selection.status === 'selected' && (
            <button
              onClick={handleApprove}
              className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg"
            >
              Approve
            </button>
          )}
          {selection.status === 'approved' && (
            <button
              onClick={handleMarkOrdered}
              className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-lg"
            >
              Mark Ordered
            </button>
          )}
          {selection.status === 'ordered' && (
            <button
              onClick={handleMarkReceived}
              className="px-3 py-1.5 text-sm bg-emerald-500 text-white rounded-lg"
            >
              Mark Received
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OptionPickerModal({ selection, onSelect, onClose }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    try {
      const data = await api.get(`/api/selections/options?categoryId=${selection.categoryId}`);
      setOptions(data || []);
    } catch (error) {
      console.error('Failed to load options:', error);
    } finally {
      setLoading(false);
    }
  };

  const filtered = options.filter(opt =>
    opt.name.toLowerCase().includes(search.toLowerCase()) ||
    opt.manufacturer?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b">
            <h2 className="text-lg font-bold">Select {selection.name}</h2>
            <p className="text-sm text-gray-500">
              Allowance: ${selection.allowance?.toLocaleString() || 0} • 
              Qty: {selection.quantity} {selection.unit}
            </p>
          </div>

          {/* Search */}
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search options..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          {/* Options Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No options found
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {filtered.map(option => {
                  const totalPrice = option.price * selection.quantity;
                  const diff = totalPrice - (selection.allowance || 0);

                  return (
                    <button
                      key={option.id}
                      onClick={() => onSelect(option.id)}
                      className="p-4 border rounded-xl text-left hover:border-orange-500 hover:bg-orange-50 transition-colors"
                    >
                      {option.imageUrl ? (
                        <img
                          src={option.imageUrl}
                          alt=""
                          className="w-full h-32 object-cover rounded-lg mb-3"
                        />
                      ) : (
                        <div className="w-full h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center">
                          <Image className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                      <p className="font-medium text-gray-900 truncate">{option.name}</p>
                      <p className="text-sm text-gray-500 truncate">
                        {option.manufacturer} {option.model}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-bold">${totalPrice.toLocaleString()}</span>
                        {diff !== 0 && (
                          <span className={`text-sm ${diff > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            {diff > 0 ? '+' : ''}${diff.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t">
            <button onClick={onClose} className="w-full px-4 py-2 border rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddSelectionModal({ projectId, categories, onSave, onClose }) {
  const [form, setForm] = useState({
    categoryId: '',
    name: '',
    location: '',
    allowance: '',
    quantity: 1,
    unit: 'each',
    dueDate: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post(`/api/selections/project/${projectId}`, form);
      onSave();
    } catch (error) {
      alert('Failed to create selection');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">Add Selection</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Select category...</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Kitchen Countertops"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Master Bath, Kitchen"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Allowance ($)</label>
                <input
                  type="number"
                  value={form.allowance}
                  onChange={(e) => setForm({ ...form, allowance: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg">
                {saving ? 'Adding...' : 'Add Selection'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
