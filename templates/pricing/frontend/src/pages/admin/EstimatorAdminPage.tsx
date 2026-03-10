import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../../services/api';

type Tab = 'products' | 'pitch';
type Tier = 'good' | 'better' | 'best';

interface TierData {
  materialName: string;
  costPerUnit: number;
  manufacturer: string;
  productLine: string;
  warrantyYears: number;
  features: string[];
}

interface AddonData {
  id?: string;
  name: string;
  description: string;
  pricingType: 'flat' | 'per_unit' | 'per_sq_ft';
  price: number;
  unit: string;
  defaultSelected: boolean;
  sortOrder: number;
}

interface ProductData {
  id?: string;
  name: string;
  description: string;
  category: string;
  measurementUnit: string;
  pitchAdjustable: boolean;
  defaultWasteFactor: number;
  laborRate: number;
  laborUnit: string;
  setupFee: number;
  minimumCharge: number;
  markupRetail: number;
  markup1yr: number;
  markup30day: number;
  markupToday: number;
  active: boolean;
  tiers: Record<Tier, TierData>;
  addons: AddonData[];
}

interface PitchMultiplier {
  pitch: string;
  multiplier: number;
}

const EMPTY_TIER: TierData = {
  materialName: '',
  costPerUnit: 0,
  manufacturer: '',
  productLine: '',
  warrantyYears: 0,
  features: [],
};

const EMPTY_PRODUCT: ProductData = {
  name: '',
  description: '',
  category: '',
  measurementUnit: 'sq_ft',
  pitchAdjustable: false,
  defaultWasteFactor: 1.10,
  laborRate: 0,
  laborUnit: 'sq_ft',
  setupFee: 0,
  minimumCharge: 0,
  markupRetail: 50,
  markup1yr: 40,
  markup30day: 30,
  markupToday: 20,
  active: true,
  tiers: { good: { ...EMPTY_TIER }, better: { ...EMPTY_TIER }, best: { ...EMPTY_TIER } },
  addons: [],
};

const EMPTY_ADDON: AddonData = {
  name: '',
  description: '',
  pricingType: 'flat',
  price: 0,
  unit: '',
  defaultSelected: false,
  sortOrder: 0,
};

const DEFAULT_PITCH_MULTIPLIERS: PitchMultiplier[] = [
  { pitch: '4/12', multiplier: 1.054 },
  { pitch: '5/12', multiplier: 1.083 },
  { pitch: '6/12', multiplier: 1.118 },
  { pitch: '7/12', multiplier: 1.158 },
  { pitch: '8/12', multiplier: 1.202 },
  { pitch: '9/12', multiplier: 1.250 },
  { pitch: '10/12', multiplier: 1.302 },
  { pitch: '11/12', multiplier: 1.357 },
  { pitch: '12/12', multiplier: 1.414 },
];

const MEASUREMENT_UNITS = [
  { value: 'sq_ft', label: 'Square Feet' },
  { value: 'lin_ft', label: 'Linear Feet' },
  { value: 'squares', label: 'Squares' },
  { value: 'count', label: 'Count' },
];

const PRICING_TYPES = [
  { value: 'flat', label: 'Flat Rate' },
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'per_sq_ft', label: 'Per Sq Ft' },
];

const inputClass = 'w-full h-[56px] px-4 text-lg rounded-xl border-2 border-gray-300 bg-white focus:border-blue-600 outline-none transition-colors';
const smallInputClass = 'w-full h-[48px] px-3 text-base rounded-xl border-2 border-gray-300 bg-white focus:border-blue-600 outline-none transition-colors';
const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

export default function EstimatorAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('products');
  const [products, setProducts] = useState<ProductData[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedProductIndex, setSelectedProductIndex] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductData | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [pitchMultipliers, setPitchMultipliers] = useState<PitchMultiplier[]>(DEFAULT_PITCH_MULTIPLIERS);
  const [saving, setSaving] = useState(false);
  const [featureInput, setFeatureInput] = useState<Record<Tier, string>>({ good: '', better: '', best: '' });
  const [addonForm, setAddonForm] = useState<AddonData | null>(null);
  const [productSection, setProductSection] = useState<'tiers' | 'addons'>('tiers');

  const loadProducts = useCallback(async () => {
    try {
      const res = await api.get('/api/estimator/admin/products');
      setProducts(res.data.products || []);
      setCategories(res.data.categories || []);
    } catch (err) {
      console.error('Failed to load products', err);
    }
  }, []);

  const loadPitchMultipliers = useCallback(async () => {
    try {
      const res = await api.get('/api/estimator/admin/pitch-multipliers');
      if (res.data?.length > 0) {
        setPitchMultipliers(res.data);
      }
    } catch (err) {
      console.error('Failed to load pitch multipliers', err);
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadPitchMultipliers();
  }, [loadProducts, loadPitchMultipliers]);

  // Product CRUD
  const handleSaveProduct = async () => {
    if (!editingProduct) return;
    setSaving(true);
    try {
      if (editingProduct.id) {
        await api.put(`/api/estimator/admin/products/${editingProduct.id}`, editingProduct);
      } else {
        await api.post('/api/estimator/admin/products', editingProduct);
      }
      await loadProducts();
      setShowProductForm(false);
      setEditingProduct(null);
    } catch (err) {
      console.error('Failed to save product', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (product: ProductData) => {
    try {
      await api.put(`/api/estimator/admin/products/${product.id}`, {
        ...product,
        active: !product.active,
      });
      await loadProducts();
    } catch (err) {
      console.error('Failed to toggle product', err);
    }
  };

  // Tiers
  const handleSaveTiers = async () => {
    if (selectedProductIndex === null) return;
    const product = products[selectedProductIndex];
    if (!product?.id) return;
    setSaving(true);
    try {
      await api.post(`/api/estimator/admin/products/${product.id}/tiers`, {
        tiers: product.tiers,
      });
      await loadProducts();
    } catch (err) {
      console.error('Failed to save tiers', err);
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (tier: Tier, field: keyof TierData, value: any) => {
    if (selectedProductIndex === null) return;
    setProducts(prev => {
      const next = [...prev];
      next[selectedProductIndex] = {
        ...next[selectedProductIndex],
        tiers: {
          ...next[selectedProductIndex].tiers,
          [tier]: {
            ...next[selectedProductIndex].tiers[tier],
            [field]: value,
          },
        },
      };
      return next;
    });
  };

  const addFeature = (tier: Tier) => {
    const val = featureInput[tier].trim();
    if (!val || selectedProductIndex === null) return;
    const current = products[selectedProductIndex].tiers[tier].features;
    if (current.includes(val)) return;
    updateTier(tier, 'features', [...current, val]);
    setFeatureInput(prev => ({ ...prev, [tier]: '' }));
  };

  const removeFeature = (tier: Tier, index: number) => {
    if (selectedProductIndex === null) return;
    const current = [...products[selectedProductIndex].tiers[tier].features];
    current.splice(index, 1);
    updateTier(tier, 'features', current);
  };

  // Addons
  const handleSaveAddon = async () => {
    if (!addonForm || selectedProductIndex === null) return;
    const product = products[selectedProductIndex];
    if (!product?.id) return;
    setSaving(true);
    try {
      if (addonForm.id) {
        await api.put(`/api/estimator/admin/products/${product.id}/addons/${addonForm.id}`, addonForm);
      } else {
        await api.post(`/api/estimator/admin/products/${product.id}/addons`, addonForm);
      }
      await loadProducts();
      setAddonForm(null);
    } catch (err) {
      console.error('Failed to save addon', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAddon = async (addonId: string) => {
    if (selectedProductIndex === null) return;
    const product = products[selectedProductIndex];
    if (!product?.id) return;
    try {
      await api.delete(`/api/estimator/admin/products/${product.id}/addons/${addonId}`);
      await loadProducts();
    } catch (err) {
      console.error('Failed to delete addon', err);
    }
  };

  const handleReorderAddon = async (index: number, direction: 'up' | 'down') => {
    if (selectedProductIndex === null) return;
    const product = products[selectedProductIndex];
    const addons = [...product.addons];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= addons.length) return;
    [addons[index], addons[newIndex]] = [addons[newIndex], addons[index]];
    addons.forEach((a, i) => { a.sortOrder = i; });
    setProducts(prev => {
      const next = [...prev];
      next[selectedProductIndex] = { ...next[selectedProductIndex], addons };
      return next;
    });
  };

  // Pitch Multipliers
  const handleSavePitchMultipliers = async () => {
    setSaving(true);
    try {
      await api.put('/api/estimator/admin/pitch-multipliers', { multipliers: pitchMultipliers });
    } catch (err) {
      console.error('Failed to save pitch multipliers', err);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof ProductData, value: any) => {
    if (!editingProduct) return;
    setEditingProduct({ ...editingProduct, [field]: value });
  };

  const selectedProduct = selectedProductIndex !== null ? products[selectedProductIndex] : null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Estimator Admin</h1>
          <p className="text-lg text-gray-500 mt-1">Manage products, tiers, and pricing</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'products' as Tab, label: 'Products' },
            { key: 'pitch' as Tab, label: 'Pitch Multipliers' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`h-[48px] px-6 rounded-xl font-semibold text-base transition-colors
                ${activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border-2 border-gray-200 hover:border-gray-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Products Tab */}
        {activeTab === 'products' && !showProductForm && (
          <div className="flex gap-6">
            {/* Product List */}
            <div className="w-[380px] flex-shrink-0 space-y-3">
              <button
                onClick={() => {
                  setEditingProduct({ ...EMPTY_PRODUCT });
                  setShowProductForm(true);
                }}
                className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold
                           rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Product
              </button>

              {products.map((product, i) => (
                <button
                  key={product.id || i}
                  onClick={() => setSelectedProductIndex(i)}
                  className={`w-full text-left px-4 py-3 rounded-xl border-2 min-h-[56px] transition-colors
                    ${selectedProductIndex === i
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{product.name}</p>
                      <p className="text-sm text-gray-500 capitalize">
                        {product.category} | {MEASUREMENT_UNITS.find(u => u.value === product.measurementUnit)?.label}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${product.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </div>
                  </div>
                </button>
              ))}

              {products.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <p className="text-lg">No products yet</p>
                  <p className="text-sm mt-1">Add your first product to get started</p>
                </div>
              )}
            </div>

            {/* Product Detail */}
            {selectedProduct ? (
              <div className="flex-1 space-y-6">
                {/* Product header */}
                <div className="bg-white rounded-2xl border-2 border-gray-200 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{selectedProduct.name}</h2>
                      <p className="text-gray-500 capitalize">{selectedProduct.category}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingProduct({ ...selectedProduct });
                          setShowProductForm(true);
                        }}
                        className="h-[48px] px-5 bg-gray-100 hover:bg-gray-200 text-gray-700
                                   font-semibold rounded-xl transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(selectedProduct)}
                        className={`h-[48px] px-5 rounded-xl font-semibold transition-colors
                          ${selectedProduct.active
                            ? 'bg-red-50 text-red-700 hover:bg-red-100'
                            : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                      >
                        {selectedProduct.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setProductSection('tiers')}
                    className={`h-[48px] px-5 rounded-xl font-semibold transition-colors
                      ${productSection === 'tiers' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border-2 border-gray-200'}`}
                  >
                    Tiers
                  </button>
                  <button
                    onClick={() => setProductSection('addons')}
                    className={`h-[48px] px-5 rounded-xl font-semibold transition-colors
                      ${productSection === 'addons' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border-2 border-gray-200'}`}
                  >
                    Add-ons
                  </button>
                </div>

                {/* Tiers Section */}
                {productSection === 'tiers' && (
                  <div className="space-y-5">
                    {(['good', 'better', 'best'] as Tier[]).map(tier => {
                      const data = selectedProduct.tiers[tier] || EMPTY_TIER;
                      const tierColors: Record<Tier, string> = {
                        good: 'border-emerald-500',
                        better: 'border-blue-500',
                        best: 'border-purple-500',
                      };
                      return (
                        <div key={tier} className={`bg-white rounded-2xl border-2 ${tierColors[tier]} overflow-hidden`}>
                          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                            <h3 className="text-lg font-bold text-gray-900 capitalize">{tier}</h3>
                          </div>
                          <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className={labelClass}>Material Name</label>
                                <input
                                  value={data.materialName}
                                  onChange={e => updateTier(tier, 'materialName', e.target.value)}
                                  className={smallInputClass}
                                  placeholder="e.g. Owens Corning Duration"
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Cost Per Unit ($)</label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={data.costPerUnit || ''}
                                  onChange={e => updateTier(tier, 'costPerUnit', Number(e.target.value) || 0)}
                                  className={smallInputClass}
                                  placeholder="0.00"
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Manufacturer</label>
                                <input
                                  value={data.manufacturer}
                                  onChange={e => updateTier(tier, 'manufacturer', e.target.value)}
                                  className={smallInputClass}
                                  placeholder="e.g. Owens Corning"
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Product Line</label>
                                <input
                                  value={data.productLine}
                                  onChange={e => updateTier(tier, 'productLine', e.target.value)}
                                  className={smallInputClass}
                                  placeholder="e.g. TruDefinition"
                                />
                              </div>
                              <div>
                                <label className={labelClass}>Warranty (Years)</label>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  value={data.warrantyYears || ''}
                                  onChange={e => updateTier(tier, 'warrantyYears', Number(e.target.value) || 0)}
                                  className={smallInputClass}
                                  placeholder="0"
                                />
                              </div>
                            </div>

                            {/* Features */}
                            <div>
                              <label className={labelClass}>Features</label>
                              <div className="flex flex-wrap gap-2 mb-2">
                                {data.features.map((f, i) => (
                                  <span key={i} className="flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
                                    {f}
                                    <button
                                      onClick={() => removeFeature(tier, i)}
                                      className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </span>
                                ))}
                              </div>
                              <div className="flex gap-2">
                                <input
                                  value={featureInput[tier]}
                                  onChange={e => setFeatureInput(prev => ({ ...prev, [tier]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeature(tier); } }}
                                  className={`flex-1 ${smallInputClass}`}
                                  placeholder="Type feature and press Enter"
                                />
                                <button
                                  onClick={() => addFeature(tier)}
                                  className="h-[48px] px-4 bg-gray-100 hover:bg-gray-200 rounded-xl font-semibold text-gray-700 transition-colors"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <button
                      onClick={handleSaveTiers}
                      disabled={saving}
                      className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                                 text-white text-lg font-bold rounded-xl transition-colors
                                 flex items-center justify-center gap-2"
                    >
                      {saving ? 'Saving...' : 'Save All Tiers'}
                    </button>
                  </div>
                )}

                {/* Addons Section */}
                {productSection === 'addons' && (
                  <div className="space-y-4">
                    <button
                      onClick={() => setAddonForm({ ...EMPTY_ADDON, sortOrder: selectedProduct.addons.length })}
                      className="w-full h-[48px] bg-gray-100 hover:bg-gray-200 text-gray-700
                                 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add Add-on
                    </button>

                    {selectedProduct.addons.map((addon, i) => (
                      <div key={addon.id || i} className="bg-white rounded-xl border-2 border-gray-200 p-4 flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleReorderAddon(i, 'up')}
                            disabled={i === 0}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700
                                       disabled:opacity-30 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleReorderAddon(i, 'down')}
                            disabled={i === selectedProduct.addons.length - 1}
                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700
                                       disabled:opacity-30 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900">{addon.name}</p>
                          <p className="text-sm text-gray-500">
                            ${addon.price.toFixed(2)} / {addon.pricingType.replace('_', ' ')}
                            {addon.defaultSelected && ' | Default selected'}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAddonForm({ ...addon })}
                            className="min-w-[48px] min-h-[48px] flex items-center justify-center
                                       text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => addon.id && handleDeleteAddon(addon.id)}
                            className="min-w-[48px] min-h-[48px] flex items-center justify-center
                                       text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}

                    {selectedProduct.addons.length === 0 && !addonForm && (
                      <div className="text-center py-8 text-gray-400">
                        <p>No add-ons configured</p>
                      </div>
                    )}

                    {/* Addon Form */}
                    {addonForm && (
                      <div className="bg-white rounded-2xl border-2 border-blue-500 p-5 space-y-4">
                        <h3 className="font-bold text-gray-900">{addonForm.id ? 'Edit' : 'New'} Add-on</h3>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={labelClass}>Name</label>
                            <input
                              value={addonForm.name}
                              onChange={e => setAddonForm({ ...addonForm, name: e.target.value })}
                              className={smallInputClass}
                              placeholder="Add-on name"
                            />
                          </div>
                          <div>
                            <label className={labelClass}>Description</label>
                            <input
                              value={addonForm.description}
                              onChange={e => setAddonForm({ ...addonForm, description: e.target.value })}
                              className={smallInputClass}
                              placeholder="Brief description"
                            />
                          </div>
                          <div>
                            <label className={labelClass}>Pricing Type</label>
                            <select
                              value={addonForm.pricingType}
                              onChange={e => setAddonForm({ ...addonForm, pricingType: e.target.value as any })}
                              className={smallInputClass}
                            >
                              {PRICING_TYPES.map(pt => (
                                <option key={pt.value} value={pt.value}>{pt.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={labelClass}>Price ($)</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={addonForm.price || ''}
                              onChange={e => setAddonForm({ ...addonForm, price: Number(e.target.value) || 0 })}
                              className={smallInputClass}
                              placeholder="0.00"
                            />
                          </div>
                          <div>
                            <label className={labelClass}>Unit</label>
                            <input
                              value={addonForm.unit}
                              onChange={e => setAddonForm({ ...addonForm, unit: e.target.value })}
                              className={smallInputClass}
                              placeholder="e.g. sq ft, each"
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              onClick={() => setAddonForm({ ...addonForm, defaultSelected: !addonForm.defaultSelected })}
                              className={`h-[48px] px-4 rounded-xl font-semibold border-2 transition-colors
                                ${addonForm.defaultSelected
                                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                                  : 'border-gray-300 bg-white text-gray-600'}`}
                            >
                              {addonForm.defaultSelected ? 'Default: ON' : 'Default: OFF'}
                            </button>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={handleSaveAddon}
                            disabled={saving || !addonForm.name}
                            className="flex-1 h-[48px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300
                                       text-white font-bold rounded-xl transition-colors"
                          >
                            {saving ? 'Saving...' : 'Save Add-on'}
                          </button>
                          <button
                            onClick={() => setAddonForm(null)}
                            className="h-[48px] px-6 bg-gray-100 hover:bg-gray-200 text-gray-700
                                       font-semibold rounded-xl transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-lg">Select a product to manage</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Product Form (Add/Edit) */}
        {activeTab === 'products' && showProductForm && editingProduct && (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={() => {
                  setShowProductForm(false);
                  setEditingProduct(null);
                }}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl
                           hover:bg-gray-100 transition-colors"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h2 className="text-2xl font-bold text-gray-900">
                {editingProduct.id ? 'Edit Product' : 'New Product'}
              </h2>
            </div>

            <div className="bg-white rounded-2xl border-2 border-gray-200 p-6 space-y-5">
              <div>
                <label className={labelClass}>Name <span className="text-red-500">*</span></label>
                <input
                  value={editingProduct.name}
                  onChange={e => updateField('name', e.target.value)}
                  className={inputClass}
                  placeholder="Product name"
                />
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <input
                  value={editingProduct.description}
                  onChange={e => updateField('description', e.target.value)}
                  className={inputClass}
                  placeholder="Brief description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Category</label>
                  <input
                    value={editingProduct.category}
                    onChange={e => updateField('category', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. Roofing"
                    list="categories"
                  />
                  <datalist id="categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div>
                  <label className={labelClass}>Measurement Unit</label>
                  <select
                    value={editingProduct.measurementUnit}
                    onChange={e => updateField('measurementUnit', e.target.value)}
                    className={inputClass}
                  >
                    {MEASUREMENT_UNITS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => updateField('pitchAdjustable', !editingProduct.pitchAdjustable)}
                  className={`h-[48px] px-5 rounded-xl font-semibold border-2 transition-colors
                    ${editingProduct.pitchAdjustable
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-white text-gray-600'}`}
                >
                  Pitch Adjustable: {editingProduct.pitchAdjustable ? 'YES' : 'NO'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Default Waste Factor</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={editingProduct.defaultWasteFactor}
                    onChange={e => updateField('defaultWasteFactor', Number(e.target.value) || 1)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Labor Rate ($/unit)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editingProduct.laborRate || ''}
                    onChange={e => updateField('laborRate', Number(e.target.value) || 0)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className={labelClass}>Labor Unit</label>
                  <select
                    value={editingProduct.laborUnit}
                    onChange={e => updateField('laborUnit', e.target.value)}
                    className={inputClass}
                  >
                    {MEASUREMENT_UNITS.map(u => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Setup Fee ($)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editingProduct.setupFee || ''}
                    onChange={e => updateField('setupFee', Number(e.target.value) || 0)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className={labelClass}>Minimum Charge ($)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editingProduct.minimumCharge || ''}
                    onChange={e => updateField('minimumCharge', Number(e.target.value) || 0)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-5">
                <h3 className="font-bold text-gray-900 mb-4">Markup Percentages (%)</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className={labelClass}>Retail</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editingProduct.markupRetail}
                      onChange={e => updateField('markupRetail', Number(e.target.value) || 0)}
                      className={smallInputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>1-Year</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editingProduct.markup1yr}
                      onChange={e => updateField('markup1yr', Number(e.target.value) || 0)}
                      className={smallInputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>30-Day</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editingProduct.markup30day}
                      onChange={e => updateField('markup30day', Number(e.target.value) || 0)}
                      className={smallInputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Today</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editingProduct.markupToday}
                      onChange={e => updateField('markupToday', Number(e.target.value) || 0)}
                      className={smallInputClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSaveProduct}
                disabled={saving || !editingProduct.name || !editingProduct.category}
                className="flex-1 h-[56px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300
                           text-white text-lg font-bold rounded-xl transition-colors"
              >
                {saving ? 'Saving...' : 'Save Product'}
              </button>
              <button
                onClick={() => {
                  setShowProductForm(false);
                  setEditingProduct(null);
                }}
                className="h-[56px] px-8 bg-gray-100 hover:bg-gray-200 text-gray-700
                           text-lg font-semibold rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Pitch Multipliers Tab */}
        {activeTab === 'pitch' && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden">
              <div className="px-5 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Pitch Multipliers</h2>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="grid grid-cols-2 gap-4 px-5 py-3 bg-gray-50">
                  <span className="text-sm font-semibold text-gray-500">Pitch</span>
                  <span className="text-sm font-semibold text-gray-500">Multiplier</span>
                </div>
                {pitchMultipliers.map((pm, i) => (
                  <div key={pm.pitch} className="grid grid-cols-2 gap-4 px-5 py-3 items-center">
                    <span className="text-lg font-semibold text-gray-900">{pm.pitch}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.001"
                      value={pm.multiplier}
                      onChange={e => {
                        const val = Number(e.target.value) || 1;
                        setPitchMultipliers(prev => {
                          const next = [...prev];
                          next[i] = { ...next[i], multiplier: val };
                          return next;
                        });
                      }}
                      className={smallInputClass}
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleSavePitchMultipliers}
              disabled={saving}
              className="w-full mt-6 h-[56px] bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                         text-white text-lg font-bold rounded-xl transition-colors"
            >
              {saving ? 'Saving...' : 'Save Pitch Multipliers'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
