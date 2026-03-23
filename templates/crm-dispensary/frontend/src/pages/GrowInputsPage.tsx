import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, AlertTriangle, Leaf, Shield, ShieldCheck, ShieldX, Clock,
  Package, Bug, Mountain, Droplets, FlaskConical, ChevronRight,
  ChevronDown, Copy, Eye, CheckCircle, XCircle, ToggleLeft, ToggleRight,
  Edit, Trash2, Minus, ArrowDownUp, FileText, QrCode, ExternalLink
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

/* ─── Constants ─── */

const inputTypes = [
  { value: '', label: 'All Types' },
  { value: 'nutrient', label: 'Nutrient' },
  { value: 'pesticide', label: 'Pesticide' },
  { value: 'soil', label: 'Soil' },
  { value: 'amendment', label: 'Amendment' },
  { value: 'growth_regulator', label: 'Growth Regulator' },
  { value: 'fungicide', label: 'Fungicide' },
  { value: 'insecticide', label: 'Insecticide' },
  { value: 'adjuvant', label: 'Adjuvant' },
  { value: 'ipm', label: 'IPM' },
  { value: 'other', label: 'Other' },
];

const typeColors: Record<string, string> = {
  nutrient: 'bg-green-100 text-green-700',
  pesticide: 'bg-red-100 text-red-700',
  soil: 'bg-amber-700/20 text-amber-800',
  amendment: 'bg-blue-100 text-blue-700',
  growth_regulator: 'bg-purple-100 text-purple-700',
  fungicide: 'bg-orange-100 text-orange-700',
  insecticide: 'bg-rose-100 text-rose-700',
  adjuvant: 'bg-cyan-100 text-cyan-700',
  ipm: 'bg-teal-100 text-teal-700',
  other: 'bg-gray-100 text-gray-700',
};

const categoryOptions = [
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'growing_media', label: 'Growing Media' },
  { value: 'supplement', label: 'Supplement' },
  { value: 'ph_adjustment', label: 'pH Adjustment' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'beneficial_insect', label: 'Beneficial Insect' },
  { value: 'other', label: 'Other' },
];

const applicationMethods = [
  { value: 'foliar_spray', label: 'Foliar Spray' },
  { value: 'soil_drench', label: 'Soil Drench' },
  { value: 'root_feed', label: 'Root Feed' },
  { value: 'top_dress', label: 'Top Dress' },
  { value: 'fogger', label: 'Fogger' },
  { value: 'dusting', label: 'Dusting' },
  { value: 'injection', label: 'Injection' },
  { value: 'granular', label: 'Granular' },
  { value: 'other', label: 'Other' },
];

const growPhases = [
  { value: 'clone', label: 'Clone' },
  { value: 'vegetative', label: 'Vegetative' },
  { value: 'flowering', label: 'Flowering' },
  { value: 'late_flower', label: 'Late Flower' },
  { value: 'flush', label: 'Flush' },
  { value: 'drying', label: 'Drying' },
  { value: 'all', label: 'All Phases' },
];

const ruleTypes = [
  { value: 'require_organic', label: 'Require Organic' },
  { value: 'ban_type', label: 'Ban Input Type' },
  { value: 'ban_ingredient', label: 'Ban Ingredient' },
  { value: 'max_applications_per_week', label: 'Max Applications/Week' },
  { value: 'pre_harvest_min_days', label: 'Pre-Harvest Interval (days)' },
];

const tabs = [
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'applications', label: 'Applications', icon: Droplets },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'traceability', label: 'Traceability', icon: QrCode },
];

/* ─── Initial Form States ─── */

const initialInputForm = {
  name: '',
  brand: '',
  type: 'nutrient',
  category: 'fertilizer',
  isOrganic: false,
  isOMRIListed: false,
  activeIngredients: [] as { name: string; concentration: string; unit: string }[],
  manufacturer: '',
  supplier: '',
  sku: '',
  unitOfMeasure: 'oz',
  currentStock: '',
  minStock: '',
  costPerUnit: '',
  storageRequirements: '',
  expirationDate: '',
  sdsUrl: '',
  epaRegistration: '',
  notes: '',
};

const initialApplicationForm = {
  inputId: '',
  targetType: 'plant',
  targetId: '',
  quantity: '',
  unit: 'ml',
  dilutionRatio: '',
  method: 'foliar_spray',
  targetArea: '',
  growPhase: 'vegetative',
  reason: '',
  notes: '',
};

const initialPolicyForm = {
  name: '',
  description: '',
  rules: [] as { ruleType: string; value: string; description: string }[],
  bannedIngredients: [] as string[],
  requiredCertifications: [] as string[],
};

/* ─── Main Page ─── */

export default function GrowInputsPage() {
  const [activeTab, setActiveTab] = useState('inventory');
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get('/api/grow-inputs/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader title="Grow Inputs" subtitle="Input materials management, applications, and compliance" />

      {/* Quick Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Total Inputs</p>
            <p className="text-2xl font-bold text-green-600">{stats.totalInputs || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Low Stock</p>
            <p className="text-2xl font-bold text-red-600">{stats.lowStock || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Applications This Week</p>
            <p className="text-2xl font-bold text-blue-600">{stats.applicationsThisWeek || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-500">Active Policies</p>
            <p className="text-2xl font-bold text-purple-600">{stats.activePolicies || 0}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-orange-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'inventory' && <InventoryTab />}
      {activeTab === 'applications' && <ApplicationsTab />}
      {activeTab === 'policies' && <PoliciesTab />}
      {activeTab === 'traceability' && <TraceabilityTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Inventory Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function InventoryTab() {
  const toast = useToast();
  const [inputs, setInputs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [organicOnly, setOrganicOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);

  // Alerts
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInput, setEditingInput] = useState<any>(null);
  const [formData, setFormData] = useState(initialInputForm);
  const [saving, setSaving] = useState(false);

  // Stock adjust
  const [stockModal, setStockModal] = useState(false);
  const [stockItem, setStockItem] = useState<any>(null);
  const [stockAdjust, setStockAdjust] = useState({ quantity: '', reason: '' });
  const [adjustingStock, setAdjustingStock] = useState(false);

  const loadInputs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      if (organicOnly) params.organicOnly = true;
      const data = await api.get('/api/grow-inputs', params);
      setInputs(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load grow inputs');
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, organicOnly]);

  const loadAlerts = useCallback(async () => {
    try {
      const data = await api.get('/api/grow-inputs/alerts');
      setLowStockCount(data?.lowStock || 0);
      setExpiringCount(data?.expiringSoon || 0);
    } catch {}
  }, []);

  useEffect(() => { loadInputs(); }, [loadInputs]);
  useEffect(() => { loadAlerts(); }, [loadAlerts]);
  useEffect(() => { setPage(1); }, [search, typeFilter, organicOnly]);

  const openCreate = () => {
    setEditingInput(null);
    setFormData({ ...initialInputForm, activeIngredients: [] });
    setModalOpen(true);
  };

  const openEdit = (item: any) => {
    setEditingInput(item);
    setFormData({
      name: item.name || '',
      brand: item.brand || '',
      type: item.type || 'nutrient',
      category: item.category || 'fertilizer',
      isOrganic: item.isOrganic || false,
      isOMRIListed: item.isOMRIListed || false,
      activeIngredients: item.activeIngredients || [],
      manufacturer: item.manufacturer || '',
      supplier: item.supplier || '',
      sku: item.sku || '',
      unitOfMeasure: item.unitOfMeasure || 'oz',
      currentStock: item.currentStock?.toString() || '',
      minStock: item.minStock?.toString() || '',
      costPerUnit: item.costPerUnit?.toString() || '',
      storageRequirements: item.storageRequirements || '',
      expirationDate: item.expirationDate?.split('T')[0] || '',
      sdsUrl: item.sdsUrl || '',
      epaRegistration: item.epaRegistration || '',
      notes: item.notes || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...formData,
        currentStock: formData.currentStock ? parseFloat(formData.currentStock) : 0,
        minStock: formData.minStock ? parseFloat(formData.minStock) : 0,
        costPerUnit: formData.costPerUnit ? parseFloat(formData.costPerUnit) : 0,
      };
      if (editingInput) {
        await api.put(`/api/grow-inputs/${editingInput.id}`, payload);
        toast.success('Input updated');
      } else {
        await api.post('/api/grow-inputs', payload);
        toast.success('Input created');
      }
      setModalOpen(false);
      loadInputs();
      loadAlerts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save input');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: any) => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await api.delete(`/api/grow-inputs/${item.id}`);
      toast.success('Input deleted');
      loadInputs();
      loadAlerts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const openStockAdjust = (item: any) => {
    setStockItem(item);
    setStockAdjust({ quantity: '', reason: '' });
    setStockModal(true);
  };

  const handleStockAdjust = async () => {
    if (!stockAdjust.quantity) { toast.error('Enter a quantity'); return; }
    setAdjustingStock(true);
    try {
      await api.post(`/api/grow-inputs/${stockItem.id}/adjust-stock`, {
        quantity: parseFloat(stockAdjust.quantity),
        reason: stockAdjust.reason,
      });
      toast.success('Stock adjusted');
      setStockModal(false);
      loadInputs();
      loadAlerts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to adjust stock');
    } finally {
      setAdjustingStock(false);
    }
  };

  const addIngredient = () => {
    setFormData({
      ...formData,
      activeIngredients: [...formData.activeIngredients, { name: '', concentration: '', unit: 'ppm' }],
    });
  };

  const removeIngredient = (index: number) => {
    setFormData({
      ...formData,
      activeIngredients: formData.activeIngredients.filter((_, i) => i !== index),
    });
  };

  const updateIngredient = (index: number, field: string, value: string) => {
    const updated = [...formData.activeIngredients];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, activeIngredients: updated });
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (val: string, row: any) => (
        <div>
          <span className="font-medium text-gray-900">{val}</span>
          {row.brand && <span className="block text-xs text-gray-500">{row.brand}</span>}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (val: string) => (
        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${typeColors[val] || 'bg-gray-100 text-gray-700'}`}>
          {val?.replace(/_/g, ' ')}
        </span>
      ),
    },
    { key: 'category', label: 'Category', render: (val: string) => <span className="capitalize text-gray-600">{val?.replace(/_/g, ' ') || '--'}</span> },
    {
      key: 'isOrganic',
      label: 'Organic',
      render: (val: boolean, row: any) => (
        <div className="flex items-center gap-1">
          {val ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
              <Leaf className="w-3 h-3" /> Organic
            </span>
          ) : (
            <span className="text-gray-400 text-xs">--</span>
          )}
          {row.isOMRIListed && (
            <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-green-600 text-white ml-1">OMRI</span>
          )}
        </div>
      ),
    },
    {
      key: 'currentStock',
      label: 'Stock',
      render: (val: number, row: any) => {
        const isLow = row.minStock && val <= row.minStock;
        return (
          <div className={isLow ? 'text-red-600 font-semibold' : 'text-gray-700'}>
            {val ?? 0} / {row.minStock ?? 0} {row.unitOfMeasure || ''}
            {isLow && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />}
          </div>
        );
      },
    },
    {
      key: 'costPerUnit',
      label: 'Cost',
      render: (val: number) => val ? `$${val.toFixed(2)}` : '--',
    },
    {
      key: 'expirationDate',
      label: 'Expiration',
      render: (val: string) => {
        if (!val) return <span className="text-gray-400">--</span>;
        const d = new Date(val);
        const daysLeft = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return (
          <span className={daysLeft <= 30 ? 'text-red-600 font-medium' : 'text-gray-700'}>
            {d.toLocaleDateString()}
            {daysLeft <= 30 && daysLeft > 0 && <span className="text-xs ml-1">({daysLeft}d)</span>}
            {daysLeft <= 0 && <span className="text-xs ml-1 text-red-700">(expired)</span>}
          </span>
        );
      },
    },
  ];

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEdit },
    { label: 'Adjust Stock', icon: ArrowDownUp, onClick: openStockAdjust },
    { label: 'Delete', icon: Trash2, onClick: handleDelete, className: 'text-red-600' },
  ];

  return (
    <>
      {/* Alert Banners */}
      {lowStockCount > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{lowStockCount} input{lowStockCount > 1 ? 's' : ''} below minimum stock level</span>
        </div>
      )}
      {expiringCount > 0 && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
          <Clock className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{expiringCount} input{expiringCount > 1 ? 's' : ''} expiring within 30 days</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or brand..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500"
        >
          {inputTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={() => setOrganicOnly(!organicOnly)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            organicOnly ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Leaf className="w-4 h-4" />
          Organic Only
        </button>
        <Button onClick={openCreate} className="ml-auto">
          <Plus className="w-4 h-4 mr-2 inline" />Add Input
        </Button>
      </div>

      <DataTable
        data={inputs}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        actions={actions}
        emptyMessage="No grow inputs found"
      />

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingInput ? 'Edit Grow Input' : 'Add Grow Input'} size="xl">
        <div className="grid md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="FoxFarm Big Bloom" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Brand</label>
            <input type="text" value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="FoxFarm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {inputTypes.filter((t) => t.value).map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
            <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.isOrganic} onChange={(e) => setFormData({ ...formData, isOrganic: e.target.checked })} className="w-4 h-4 rounded border-slate-600 text-green-500 focus:ring-green-500 bg-slate-800" />
              <span className="text-sm text-slate-300">Organic</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.isOMRIListed} onChange={(e) => setFormData({ ...formData, isOMRIListed: e.target.checked })} className="w-4 h-4 rounded border-slate-600 text-green-500 focus:ring-green-500 bg-slate-800" />
              <span className="text-sm text-slate-300">OMRI Listed</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Manufacturer</label>
            <input type="text" value={formData.manufacturer} onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Supplier</label>
            <input type="text" value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">SKU</label>
            <input type="text" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Unit of Measure</label>
            <select value={formData.unitOfMeasure} onChange={(e) => setFormData({ ...formData, unitOfMeasure: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500">
              <option value="oz">oz</option>
              <option value="ml">ml</option>
              <option value="L">L</option>
              <option value="gal">gal</option>
              <option value="g">g</option>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
              <option value="each">each</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Current Stock</label>
            <input type="number" step="0.01" value={formData.currentStock} onChange={(e) => setFormData({ ...formData, currentStock: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Minimum Stock</label>
            <input type="number" step="0.01" value={formData.minStock} onChange={(e) => setFormData({ ...formData, minStock: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Cost Per Unit ($)</label>
            <input type="number" step="0.01" value={formData.costPerUnit} onChange={(e) => setFormData({ ...formData, costPerUnit: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Expiration Date</label>
            <input type="date" value={formData.expirationDate} onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Storage Requirements</label>
            <input type="text" value={formData.storageRequirements} onChange={(e) => setFormData({ ...formData, storageRequirements: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Cool, dry place" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">SDS URL</label>
            <input type="url" value={formData.sdsUrl} onChange={(e) => setFormData({ ...formData, sdsUrl: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="https://..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">EPA Registration #</label>
            <input type="text" value={formData.epaRegistration} onChange={(e) => setFormData({ ...formData, epaRegistration: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>

          {/* Active Ingredients */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-300">Active Ingredients</label>
              <button onClick={addIngredient} className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Ingredient
              </button>
            </div>
            {formData.activeIngredients.length === 0 && (
              <p className="text-xs text-slate-500 italic">No active ingredients added</p>
            )}
            {formData.activeIngredients.map((ing, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Ingredient name"
                  value={ing.name}
                  onChange={(e) => updateIngredient(i, 'name', e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                />
                <input
                  type="text"
                  placeholder="Concentration"
                  value={ing.concentration}
                  onChange={(e) => updateIngredient(i, 'concentration', e.target.value)}
                  className="w-28 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                />
                <select
                  value={ing.unit}
                  onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
                  className="w-20 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                >
                  <option value="ppm">ppm</option>
                  <option value="%">%</option>
                  <option value="mg/L">mg/L</option>
                  <option value="g/L">g/L</option>
                </select>
                <button onClick={() => removeIngredient(i)} className="p-1.5 text-red-400 hover:text-red-300 hover:bg-slate-800 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingInput ? 'Update Input' : 'Add Input'}</Button>
        </div>
      </Modal>

      {/* Stock Adjust Modal */}
      <Modal isOpen={stockModal} onClose={() => setStockModal(false)} title={`Adjust Stock — ${stockItem?.name || ''}`} size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Current Stock: {stockItem?.currentStock ?? 0} {stockItem?.unitOfMeasure}</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Adjustment (use negative to reduce)</label>
            <input
              type="number"
              step="0.01"
              value={stockAdjust.quantity}
              onChange={(e) => setStockAdjust({ ...stockAdjust, quantity: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
              placeholder="+10 or -5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Reason</label>
            <input
              type="text"
              value={stockAdjust.reason}
              onChange={(e) => setStockAdjust({ ...stockAdjust, reason: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
              placeholder="Received shipment, spillage, etc."
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setStockModal(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleStockAdjust} disabled={adjustingStock}>{adjustingStock ? 'Adjusting...' : 'Adjust Stock'}</Button>
        </div>
      </Modal>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Applications Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function ApplicationsTab() {
  const toast = useToast();

  // Log application form
  const [formData, setFormData] = useState(initialApplicationForm);
  const [saving, setSaving] = useState(false);
  const [complianceResult, setComplianceResult] = useState<any>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);

  // Input search
  const [inputSearch, setInputSearch] = useState('');
  const [inputOptions, setInputOptions] = useState<any[]>([]);
  const [showInputDropdown, setShowInputDropdown] = useState(false);
  const [selectedInput, setSelectedInput] = useState<any>(null);

  // Target selection
  const [targetTab, setTargetTab] = useState<'plant' | 'batch' | 'room'>('plant');
  const [targetOptions, setTargetOptions] = useState<any[]>([]);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPagination, setHistoryPagination] = useState<any>(null);
  const [historyInputFilter, setHistoryInputFilter] = useState('');
  const [historyTargetFilter, setHistoryTargetFilter] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params: any = { page: historyPage, limit: 25 };
      if (historyInputFilter) params.inputId = historyInputFilter;
      if (historyTargetFilter) params.target = historyTargetFilter;
      if (historyDateFrom) params.dateFrom = historyDateFrom;
      if (historyDateTo) params.dateTo = historyDateTo;
      const data = await api.get('/api/grow-inputs/applications', params);
      setHistory(Array.isArray(data) ? data : data?.data || []);
      setHistoryPagination(data?.pagination || null);
    } catch {
      toast.error('Failed to load application history');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyInputFilter, historyTargetFilter, historyDateFrom, historyDateTo]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Search inputs as user types
  useEffect(() => {
    if (!inputSearch.trim()) { setInputOptions([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const data = await api.get('/api/grow-inputs', { search: inputSearch, limit: 10 });
        setInputOptions(Array.isArray(data) ? data : data?.data || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [inputSearch]);

  // Load targets based on target tab
  useEffect(() => {
    const loadTargets = async () => {
      try {
        let data;
        if (targetTab === 'plant') {
          data = await api.get('/api/cultivation/plants', { limit: 100 });
        } else if (targetTab === 'batch') {
          data = await api.get('/api/batches', { status: 'active', limit: 100 });
        } else {
          data = await api.get('/api/cultivation/rooms');
        }
        setTargetOptions(Array.isArray(data) ? data : data?.data || []);
      } catch {}
    };
    loadTargets();
  }, [targetTab]);

  const selectInput = (input: any) => {
    setSelectedInput(input);
    setFormData({ ...formData, inputId: input.id });
    setInputSearch(input.name);
    setShowInputDropdown(false);
    checkCompliance(input.id);
  };

  const checkCompliance = async (inputId: string) => {
    setCheckingCompliance(true);
    try {
      const result = await api.get(`/api/grow-inputs/${inputId}/check-compliance`);
      setComplianceResult(result);
    } catch {
      setComplianceResult(null);
    } finally {
      setCheckingCompliance(false);
    }
  };

  const handleLogApplication = async () => {
    if (!formData.inputId) { toast.error('Select an input'); return; }
    if (!formData.targetId) { toast.error('Select a target'); return; }
    if (!formData.quantity) { toast.error('Enter quantity'); return; }
    setSaving(true);
    try {
      await api.post('/api/grow-inputs/applications', {
        ...formData,
        targetType: targetTab,
        quantity: parseFloat(formData.quantity),
      });
      toast.success('Application logged');
      setFormData(initialApplicationForm);
      setSelectedInput(null);
      setInputSearch('');
      setComplianceResult(null);
      loadHistory();
    } catch (err: any) {
      toast.error(err.message || 'Failed to log application');
    } finally {
      setSaving(false);
    }
  };

  const historyColumns = [
    {
      key: 'appliedAt',
      label: 'Date',
      render: (val: string) => val ? new Date(val).toLocaleDateString() : '--',
    },
    {
      key: 'inputName',
      label: 'Input Name',
      render: (val: string) => <span className="font-medium text-gray-900">{val}</span>,
    },
    {
      key: 'inputType',
      label: 'Type',
      render: (val: string) => (
        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${typeColors[val] || 'bg-gray-100 text-gray-700'}`}>
          {val?.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'quantity',
      label: 'Quantity',
      render: (val: number, row: any) => `${val} ${row.unit || ''}`,
    },
    {
      key: 'targetLabel',
      label: 'Applied To',
      render: (val: string, row: any) => (
        <span className="text-gray-700">
          {val || row.targetId}
          <span className="text-xs text-gray-400 ml-1">({row.targetType})</span>
        </span>
      ),
    },
    {
      key: 'growPhase',
      label: 'Phase',
      render: (val: string) => <span className="capitalize text-gray-600">{val?.replace(/_/g, ' ') || '--'}</span>,
    },
    {
      key: 'method',
      label: 'Method',
      render: (val: string) => <span className="capitalize text-gray-600">{val?.replace(/_/g, ' ') || '--'}</span>,
    },
    {
      key: 'appliedBy',
      label: 'Applied By',
      render: (val: string) => val || '--',
    },
    {
      key: 'preHarvestWarning',
      label: '',
      render: (val: boolean) =>
        val ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
            <AlertTriangle className="w-3 h-3" /> Pre-Harvest
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Log Application Form */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Log Application</h3>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Input Search */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Input *</label>
            <input
              type="text"
              placeholder="Search inputs..."
              value={inputSearch}
              onChange={(e) => { setInputSearch(e.target.value); setShowInputDropdown(true); }}
              onFocus={() => inputSearch && setShowInputDropdown(true)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
            {showInputDropdown && inputOptions.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowInputDropdown(false)} />
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {inputOptions.map((opt: any) => (
                    <button
                      key={opt.id}
                      onClick={() => selectInput(opt)}
                      className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-900 flex items-center justify-between"
                    >
                      <span>{opt.name} <span className="text-gray-400">({opt.brand})</span></span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${typeColors[opt.type] || 'bg-gray-100 text-gray-700'}`}>{opt.type}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Compliance Check */}
          {selectedInput && (
            <div className="flex items-end">
              {checkingCompliance ? (
                <span className="text-sm text-gray-500 pb-2">Checking compliance...</span>
              ) : complianceResult ? (
                complianceResult.compliant ? (
                  <span className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-green-50 text-green-700 border border-green-200">
                    <CheckCircle className="w-4 h-4" /> Compliant
                  </span>
                ) : (
                  <div className="space-y-1">
                    {(complianceResult.violations || []).map((v: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-red-50 text-red-700 border border-red-200 block">
                        <XCircle className="w-3 h-3" /> {v.message || v.rule}
                      </span>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          )}

          {/* Target Tabs */}
          <div className="md:col-span-2 lg:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">Target *</label>
            <div className="flex gap-1 mb-2">
              {(['plant', 'batch', 'room'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTargetTab(t); setFormData({ ...formData, targetId: '' }); }}
                  className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${
                    targetTab === t ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <select
              value={formData.targetId}
              onChange={(e) => setFormData({ ...formData, targetId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
            >
              <option value="">Select {targetTab}...</option>
              {targetOptions.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {targetTab === 'plant' ? `${t.metrcTag || t.id} — ${t.strainName || ''}` :
                   targetTab === 'batch' ? `${t.batchNumber || t.id} — ${t.productName || ''}` :
                   t.name || t.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity *</label>
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
                placeholder="0.00"
              />
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="w-20 px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
              >
                <option value="ml">ml</option>
                <option value="L">L</option>
                <option value="oz">oz</option>
                <option value="gal">gal</option>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="tsp">tsp</option>
                <option value="tbsp">tbsp</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dilution Ratio</label>
            <input
              type="text"
              value={formData.dilutionRatio}
              onChange={(e) => setFormData({ ...formData, dilutionRatio: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
              placeholder="e.g. 1:100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Application Method</label>
            <select
              value={formData.method}
              onChange={(e) => setFormData({ ...formData, method: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
            >
              {applicationMethods.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Area</label>
            <input
              type="text"
              value={formData.targetArea}
              onChange={(e) => setFormData({ ...formData, targetArea: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
              placeholder="e.g. Row A, entire room"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grow Phase</label>
            <select
              value={formData.growPhase}
              onChange={(e) => setFormData({ ...formData, growPhase: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
            >
              {growPhases.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <input
              type="text"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
              placeholder="Routine feeding, pest outbreak..."
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input
              type="text"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-gray-900"
            />
          </div>

          <div className="flex items-end">
            <Button onClick={handleLogApplication} disabled={saving}>
              {saving ? 'Logging...' : 'Log Application'}
            </Button>
          </div>
        </div>
      </div>

      {/* Application History */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Application History</h3>
        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            placeholder="Filter by input..."
            value={historyInputFilter}
            onChange={(e) => { setHistoryInputFilter(e.target.value); setHistoryPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="text"
            placeholder="Filter by target..."
            value={historyTargetFilter}
            onChange={(e) => { setHistoryTargetFilter(e.target.value); setHistoryPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="date"
            value={historyDateFrom}
            onChange={(e) => { setHistoryDateFrom(e.target.value); setHistoryPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500"
          />
          <input
            type="date"
            value={historyDateTo}
            onChange={(e) => { setHistoryDateTo(e.target.value); setHistoryPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <DataTable
          data={history}
          columns={historyColumns}
          loading={historyLoading}
          pagination={historyPagination}
          onPageChange={setHistoryPage}
          emptyMessage="No applications logged yet"
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Policies Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function PoliciesTab() {
  const toast = useToast();
  const [policies, setPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const [formData, setFormData] = useState(initialPolicyForm);
  const [saving, setSaving] = useState(false);

  // Check input modal
  const [checkModal, setCheckModal] = useState(false);
  const [checkInputId, setCheckInputId] = useState('');
  const [checkInputSearch, setCheckInputSearch] = useState('');
  const [checkInputOptions, setCheckInputOptions] = useState<any[]>([]);
  const [showCheckDropdown, setShowCheckDropdown] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);

  // Banned ingredient input
  const [newBannedIngredient, setNewBannedIngredient] = useState('');

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/grow-inputs/policies');
      setPolicies(Array.isArray(data) ? data : data?.data || []);
    } catch {
      toast.error('Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPolicies(); }, [loadPolicies]);

  // Search for check input
  useEffect(() => {
    if (!checkInputSearch.trim()) { setCheckInputOptions([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const data = await api.get('/api/grow-inputs', { search: checkInputSearch, limit: 10 });
        setCheckInputOptions(Array.isArray(data) ? data : data?.data || []);
      } catch {}
    }, 300);
    return () => clearTimeout(timeout);
  }, [checkInputSearch]);

  const openCreate = () => {
    setEditingPolicy(null);
    setFormData({ ...initialPolicyForm, rules: [], bannedIngredients: [], requiredCertifications: [] });
    setModalOpen(true);
  };

  const openEdit = (policy: any) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name || '',
      description: policy.description || '',
      rules: policy.rules || [],
      bannedIngredients: policy.bannedIngredients || [],
      requiredCertifications: policy.requiredCertifications || [],
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) { toast.error('Policy name is required'); return; }
    setSaving(true);
    try {
      if (editingPolicy) {
        await api.put(`/api/grow-inputs/policies/${editingPolicy.id}`, formData);
        toast.success('Policy updated');
      } else {
        await api.post('/api/grow-inputs/policies', formData);
        toast.success('Policy created');
      }
      setModalOpen(false);
      loadPolicies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (policy: any) => {
    try {
      await api.put(`/api/grow-inputs/policies/${policy.id}`, { active: !policy.active });
      toast.success(policy.active ? 'Policy deactivated' : 'Policy activated');
      loadPolicies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle policy');
    }
  };

  const addRule = () => {
    setFormData({
      ...formData,
      rules: [...formData.rules, { ruleType: 'require_organic', value: '', description: '' }],
    });
  };

  const removeRule = (index: number) => {
    setFormData({
      ...formData,
      rules: formData.rules.filter((_, i) => i !== index),
    });
  };

  const updateRule = (index: number, field: string, value: string) => {
    const updated = [...formData.rules];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, rules: updated });
  };

  const addBannedIngredient = () => {
    if (!newBannedIngredient.trim()) return;
    setFormData({
      ...formData,
      bannedIngredients: [...formData.bannedIngredients, newBannedIngredient.trim()],
    });
    setNewBannedIngredient('');
  };

  const removeBannedIngredient = (index: number) => {
    setFormData({
      ...formData,
      bannedIngredients: formData.bannedIngredients.filter((_, i) => i !== index),
    });
  };

  const runCheckInput = async () => {
    if (!checkInputId) { toast.error('Select an input to check'); return; }
    setChecking(true);
    try {
      const result = await api.get(`/api/grow-inputs/${checkInputId}/check-compliance`);
      setCheckResult(result);
    } catch (err: any) {
      toast.error(err.message || 'Compliance check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2 inline" />Create Policy
          </Button>
          <Button variant="secondary" onClick={() => { setCheckModal(true); setCheckResult(null); setCheckInputSearch(''); setCheckInputId(''); }}>
            <Shield className="w-4 h-4 mr-2 inline" />Check Input
          </Button>
        </div>
      </div>

      {/* Policy Cards */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : policies.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center text-gray-500">
          No policies created yet. Create one to enforce input compliance rules.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {policies.map((policy) => (
            <div key={policy.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 truncate">{policy.name}</h4>
                  {policy.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">{policy.description}</p>
                  )}
                </div>
                <button onClick={() => toggleActive(policy)} className="ml-2 flex-shrink-0">
                  {policy.active ? (
                    <ToggleRight className="w-8 h-8 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-8 h-8 text-gray-300" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500 mb-4">
                <span className="flex items-center gap-1">
                  <Shield className="w-4 h-4" /> {policy.rules?.length || 0} rules
                </span>
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${policy.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {policy.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(policy)} className="text-sm text-orange-600 hover:text-orange-700 font-medium">Edit</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Policy Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingPolicy ? 'Edit Policy' : 'Create Policy'} size="xl">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Policy Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Organic Growing Standard" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500" placeholder="Policy description..." />
          </div>

          {/* Rules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-300">Rules</label>
              <button onClick={addRule} className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Rule
              </button>
            </div>
            {formData.rules.length === 0 && <p className="text-xs text-slate-500 italic">No rules added</p>}
            {formData.rules.map((rule, i) => (
              <div key={i} className="flex gap-2 mb-2 items-start">
                <select
                  value={rule.ruleType}
                  onChange={(e) => updateRule(i, 'ruleType', e.target.value)}
                  className="w-48 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                >
                  {ruleTypes.map((rt) => (
                    <option key={rt.value} value={rt.value}>{rt.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Value"
                  value={rule.value}
                  onChange={(e) => updateRule(i, 'value', e.target.value)}
                  className="w-24 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={rule.description}
                  onChange={(e) => updateRule(i, 'description', e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
                />
                <button onClick={() => removeRule(i)} className="p-1.5 text-red-400 hover:text-red-300 hover:bg-slate-800 rounded">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Banned Ingredients */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Banned Ingredients</label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Ingredient name"
                value={newBannedIngredient}
                onChange={(e) => setNewBannedIngredient(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addBannedIngredient()}
                className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-orange-500"
              />
              <button onClick={addBannedIngredient} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.bannedIngredients.map((ing, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-900/50 text-red-300 rounded-full border border-red-700">
                  {ing}
                  <button onClick={() => removeBannedIngredient(i)} className="hover:text-red-100">
                    <XCircle className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Required Certifications */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Required Certifications</label>
            <div className="flex flex-wrap gap-3">
              {['Organic', 'OMRI Listed', 'CDFA OIM', 'WSDA', 'Clean Green'].map((cert) => (
                <label key={cert} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiredCertifications.includes(cert)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData({ ...formData, requiredCertifications: [...formData.requiredCertifications, cert] });
                      } else {
                        setFormData({ ...formData, requiredCertifications: formData.requiredCertifications.filter((c) => c !== cert) });
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-600 text-orange-500 focus:ring-orange-500 bg-slate-800"
                  />
                  <span className="text-sm text-slate-300">{cert}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editingPolicy ? 'Update Policy' : 'Create Policy'}</Button>
        </div>
      </Modal>

      {/* Check Input Modal */}
      <Modal isOpen={checkModal} onClose={() => setCheckModal(false)} title="Check Input Compliance" size="md">
        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-1">Select Input</label>
            <input
              type="text"
              placeholder="Search inputs..."
              value={checkInputSearch}
              onChange={(e) => { setCheckInputSearch(e.target.value); setShowCheckDropdown(true); }}
              onFocus={() => checkInputSearch && setShowCheckDropdown(true)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-orange-500"
            />
            {showCheckDropdown && checkInputOptions.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCheckDropdown(false)} />
                <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {checkInputOptions.map((opt: any) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setCheckInputId(opt.id);
                        setCheckInputSearch(opt.name);
                        setShowCheckDropdown(false);
                        setCheckResult(null);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm text-white"
                    >
                      {opt.name} <span className="text-slate-400">({opt.brand})</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <Button onClick={runCheckInput} disabled={checking || !checkInputId}>
            {checking ? 'Checking...' : 'Run Compliance Check'}
          </Button>

          {checkResult && (
            <div className={`p-4 rounded-lg border ${checkResult.compliant ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'}`}>
              <div className="flex items-center gap-2 mb-2">
                {checkResult.compliant ? (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={`font-semibold ${checkResult.compliant ? 'text-green-300' : 'text-red-300'}`}>
                  {checkResult.compliant ? 'All Checks Passed' : 'Compliance Violations Found'}
                </span>
              </div>
              {checkResult.results && checkResult.results.map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm mt-1">
                  {r.passed ? (
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  )}
                  <span className={r.passed ? 'text-green-300' : 'text-red-300'}>{r.rule}: {r.message || (r.passed ? 'Passed' : 'Failed')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Traceability Tab
   ═══════════════════════════════════════════════════════════════════════════ */

function TraceabilityTab() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);
  const [showCustomerView, setShowCustomerView] = useState(false);

  const handleSearch = async () => {
    if (!search.trim()) { toast.error('Enter a product name or batch number'); return; }
    setSearching(true);
    setTraceData(null);
    try {
      const data = await api.get('/api/grow-inputs/traceability', { query: search });
      setTraceData(data);
      if (!data || (!data.product && !data.batch)) {
        toast.error('No traceability data found');
      }
    } catch (err: any) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const copyQRData = () => {
    if (!traceData) return;
    const qrPayload = {
      type: 'traceability',
      productId: traceData.product?.id,
      productName: traceData.product?.name,
      batchNumber: traceData.batch?.batchNumber,
      labResults: traceData.labResults ? {
        thc: traceData.labResults.thcPercent,
        cbd: traceData.labResults.cbdPercent,
        tested: traceData.labResults.testDate,
        passed: traceData.labResults.passed,
      } : null,
      inputsApplied: (traceData.inputs || []).length,
      harvestDate: traceData.batch?.harvestDate,
    };
    navigator.clipboard.writeText(JSON.stringify(qrPayload, null, 2));
    toast.success('QR data copied to clipboard');
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Product / Batch Traceability</h3>
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by product name or batch number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
          <Button onClick={handleSearch} disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {traceData && (
        <div className="space-y-4">
          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={copyQRData}>
              <Copy className="w-4 h-4 mr-2 inline" />Copy QR Data
            </Button>
            <Button variant="secondary" onClick={() => setShowCustomerView(!showCustomerView)}>
              <Eye className="w-4 h-4 mr-2 inline" />{showCustomerView ? 'View Full Details' : 'View as Customer'}
            </Button>
          </div>

          {showCustomerView ? (
            /* Customer View */
            <div className="bg-white rounded-lg shadow-sm p-6 max-w-lg mx-auto">
              <div className="text-center mb-6">
                {traceData.product?.imageUrl ? (
                  <img src={traceData.product.imageUrl} alt={traceData.product.name} className="w-24 h-24 object-cover rounded-lg mx-auto mb-3" />
                ) : (
                  <div className="w-24 h-24 bg-gray-100 rounded-lg mx-auto mb-3 flex items-center justify-center">
                    <Package className="w-10 h-10 text-gray-400" />
                  </div>
                )}
                <h3 className="text-xl font-bold text-gray-900">{traceData.product?.name || 'Product'}</h3>
                {traceData.product?.strain && <p className="text-gray-500">{traceData.product.strain}</p>}
              </div>

              {traceData.labResults && (
                <div className="border-t pt-4 mt-4">
                  <h4 className="font-semibold text-gray-700 mb-2">Lab Results</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-gray-500">THC</p>
                      <p className="text-lg font-bold text-gray-900">{traceData.labResults.thcPercent}%</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-gray-500">CBD</p>
                      <p className="text-lg font-bold text-gray-900">{traceData.labResults.cbdPercent}%</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {traceData.labResults.passed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                        <CheckCircle className="w-3 h-3" /> All Tests Passed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
                        <XCircle className="w-3 h-3" /> See Full Report
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t pt-4 mt-4 text-sm text-gray-600">
                <p><span className="font-medium">Batch:</span> {traceData.batch?.batchNumber || '--'}</p>
                <p><span className="font-medium">Harvested:</span> {traceData.batch?.harvestDate ? new Date(traceData.batch.harvestDate).toLocaleDateString() : '--'}</p>
                <p><span className="font-medium">Organic Inputs:</span> {(traceData.inputs || []).filter((i: any) => i.isOrganic).length} of {(traceData.inputs || []).length}</p>
              </div>
            </div>
          ) : (
            /* Full Traceability View */
            <div className="bg-white rounded-lg shadow-sm p-6">
              {/* Product Info */}
              <div className="flex items-start gap-4 mb-6">
                {traceData.product?.imageUrl ? (
                  <img src={traceData.product.imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg" />
                ) : (
                  <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package className="w-8 h-8 text-gray-400" />
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{traceData.product?.name || 'Product'}</h3>
                  {traceData.product?.strain && <p className="text-gray-500">{traceData.product.strain}</p>}
                  {traceData.product?.category && <p className="text-sm text-gray-400">{traceData.product.category}</p>}
                </div>
              </div>

              {/* Timeline */}
              <div className="relative pl-8 border-l-2 border-gray-200 space-y-6">
                {/* Batch Info */}
                {traceData.batch && (
                  <div className="relative">
                    <div className="absolute -left-[2.35rem] w-4 h-4 bg-blue-500 rounded-full border-2 border-white" />
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-900 mb-1">Batch Information</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <p><span className="text-blue-600">Batch #:</span> {traceData.batch.batchNumber}</p>
                        <p><span className="text-blue-600">Received:</span> {traceData.batch.receivedDate ? new Date(traceData.batch.receivedDate).toLocaleDateString() : '--'}</p>
                        <p><span className="text-blue-600">Supplier:</span> {traceData.batch.supplier || '--'}</p>
                        <p><span className="text-blue-600">Grower:</span> {traceData.batch.grower || '--'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lab Results */}
                {traceData.labResults && (
                  <div className="relative">
                    <div className="absolute -left-[2.35rem] w-4 h-4 bg-purple-500 rounded-full border-2 border-white" />
                    <div className="bg-purple-50 rounded-lg p-4">
                      <h4 className="font-semibold text-purple-900 mb-2">Lab Results</h4>
                      <div className="flex flex-wrap gap-3 text-sm mb-2">
                        <span className="px-3 py-1 bg-white rounded-lg font-medium text-gray-900">THC: {traceData.labResults.thcPercent}%</span>
                        <span className="px-3 py-1 bg-white rounded-lg font-medium text-gray-900">CBD: {traceData.labResults.cbdPercent}%</span>
                        {traceData.labResults.terpenes && (
                          <span className="px-3 py-1 bg-white rounded-lg font-medium text-gray-900">Terpenes: {traceData.labResults.totalTerpenes}%</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(traceData.labResults.contaminants || []).map((c: any, i: number) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                              c.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {c.passed ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Inputs Applied */}
                {traceData.inputs && traceData.inputs.length > 0 && (
                  <div className="relative">
                    <div className="absolute -left-[2.35rem] w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
                    <div className="bg-green-50 rounded-lg p-4">
                      <h4 className="font-semibold text-green-900 mb-2">Inputs Applied ({traceData.inputs.length})</h4>
                      <div className="space-y-2">
                        {traceData.inputs.map((inp: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-white rounded-lg p-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{inp.name}</span>
                              {inp.brand && <span className="text-gray-400">({inp.brand})</span>}
                              {inp.isOrganic && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-700">
                                  <Leaf className="w-2.5 h-2.5" /> Organic
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-gray-500">
                              <span>{inp.quantity} {inp.unit}</span>
                              <span>{inp.method?.replace(/_/g, ' ')}</span>
                              <span>{inp.date ? new Date(inp.date).toLocaleDateString() : ''}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Grow Room / Plant Info */}
                {(traceData.room || traceData.plant) && (
                  <div className="relative">
                    <div className="absolute -left-[2.35rem] w-4 h-4 bg-amber-500 rounded-full border-2 border-white" />
                    <div className="bg-amber-50 rounded-lg p-4">
                      <h4 className="font-semibold text-amber-900 mb-1">Grow Details</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {traceData.room && <p><span className="text-amber-600">Room:</span> {traceData.room.name}</p>}
                        {traceData.plant && <p><span className="text-amber-600">Plant Tag:</span> {traceData.plant.metrcTag}</p>}
                        {traceData.plant?.strainName && <p><span className="text-amber-600">Strain:</span> {traceData.plant.strainName}</p>}
                        {traceData.plant?.phase && <p><span className="text-amber-600">Phase:</span> {traceData.plant.phase}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
