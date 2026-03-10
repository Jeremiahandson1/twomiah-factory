import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

interface Category {
  id: string;
  name: string;
  sortOrder: number;
  productCount: number;
}

interface Product {
  id: string;
  name: string;
  image?: string;
  measurementType: string;
  mode: string;
  categoryId: string;
}

interface PriceRange {
  id?: string;
  min: number;
  max: number;
  parPrice: number;
  retailPrice: number;
  yr1Price: number;
  thirtyDayPrice: number;
  todayPrice: number;
}

interface Addon {
  id?: string;
  name: string;
  price: number;
  type: 'flat' | 'per_unit' | 'percentage';
  required: boolean;
  image?: string;
  dependsOn?: string;
  group: string;
  sortOrder: number;
}

interface Guardrails {
  floorPrice: number;
  maxRepDiscount: number;
  maxSeniorRepDiscount: number;
  managerPinThreshold: number;
}

type ActiveTab = 'ranges' | 'addons' | 'guardrails';

export default function PricebookPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('ranges');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Ranges state
  const [ranges, setRanges] = useState<PriceRange[]>([]);
  const [yr1Markup, setYr1Markup] = useState(8);
  const [thirtyDayMarkup, setThirtyDayMarkup] = useState(5);
  const [todayDiscount, setTodayDiscount] = useState(3);

  // Addons state
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonGroups, setAddonGroups] = useState<string[]>([]);

  // Guardrails state
  const [guardrails, setGuardrails] = useState<Guardrails>({
    floorPrice: 0,
    maxRepDiscount: 10,
    maxSeniorRepDiscount: 15,
    managerPinThreshold: 20,
  });

  // New category / product
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [showNewProduct, setShowNewProduct] = useState(false);

  useEffect(() => {
    async function loadCategories() {
      try {
        const data = await api.get('/api/pricebook/categories');
        setCategories(data);
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    }
    loadCategories();
  }, []);

  useEffect(() => {
    if (!selectedCategoryId) {
      setProducts([]);
      setSelectedProductId(null);
      return;
    }
    async function loadProducts() {
      try {
        const data = await api.get(`/api/pricebook/categories/${selectedCategoryId}/products`);
        setProducts(data);
      } catch {
        // handle
      }
    }
    loadProducts();
  }, [selectedCategoryId]);

  const loadProductDetails = useCallback(async (productId: string) => {
    try {
      const data = await api.get(`/api/pricebook/products/${productId}`);
      setRanges(data.ranges || []);
      setAddons(data.addons || []);
      setGuardrails(data.guardrails || {
        floorPrice: 0,
        maxRepDiscount: 10,
        maxSeniorRepDiscount: 15,
        managerPinThreshold: 20,
      });
      if (data.markups) {
        setYr1Markup(data.markups.yr1 || 8);
        setThirtyDayMarkup(data.markups.thirtyDay || 5);
        setTodayDiscount(data.markups.today || 3);
      }
      const groups = [...new Set(data.addons?.map((a: Addon) => a.group) || [])];
      setAddonGroups(groups as string[]);
    } catch {
      // handle
    }
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      loadProductDetails(selectedProductId);
    }
  }, [selectedProductId, loadProductDetails]);

  function recalcPrices(rangeList: PriceRange[]): PriceRange[] {
    return rangeList.map((r) => ({
      ...r,
      yr1Price: Math.round(r.retailPrice * (1 + yr1Markup / 100) * 100) / 100,
      thirtyDayPrice: Math.round(r.retailPrice * (1 + thirtyDayMarkup / 100) * 100) / 100,
      todayPrice: Math.round(r.retailPrice * (1 - todayDiscount / 100) * 100) / 100,
    }));
  }

  function updateRange(index: number, field: keyof PriceRange, value: number) {
    const updated = [...ranges];
    (updated[index] as any)[field] = value;
    setRanges(recalcPrices(updated));
  }

  function addRange() {
    const lastMax = ranges.length > 0 ? ranges[ranges.length - 1].max : 0;
    const newRange: PriceRange = {
      min: lastMax + 1,
      max: lastMax + 100,
      parPrice: 0,
      retailPrice: 0,
      yr1Price: 0,
      thirtyDayPrice: 0,
      todayPrice: 0,
    };
    setRanges([...ranges, newRange]);
  }

  function removeRange(index: number) {
    setRanges(ranges.filter((_, i) => i !== index));
  }

  async function saveRanges() {
    if (!selectedProductId) return;
    setSaving(true);
    try {
      await api.post(`/api/pricebook/products/${selectedProductId}/ranges`, {
        ranges,
        markups: { yr1: yr1Markup, thirtyDay: thirtyDayMarkup, today: todayDiscount },
      });
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  function addAddon(group: string) {
    const newAddon: Addon = {
      name: '',
      price: 0,
      type: 'flat',
      required: false,
      group,
      sortOrder: addons.filter((a) => a.group === group).length,
    };
    setAddons([...addons, newAddon]);
  }

  function addAddonGroup() {
    const name = prompt('Group name:');
    if (name && !addonGroups.includes(name)) {
      setAddonGroups([...addonGroups, name]);
    }
  }

  function updateAddon(index: number, field: keyof Addon, value: any) {
    const updated = [...addons];
    (updated[index] as any)[field] = value;
    setAddons(updated);
  }

  function removeAddon(index: number) {
    setAddons(addons.filter((_, i) => i !== index));
  }

  function moveAddon(index: number, direction: 'up' | 'down') {
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= addons.length) return;
    const updated = [...addons];
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    setAddons(updated);
  }

  async function saveAddons() {
    if (!selectedProductId) return;
    setSaving(true);
    try {
      await api.post(`/api/pricebook/products/${selectedProductId}/addons`, { addons });
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function saveGuardrails() {
    if (!selectedProductId) return;
    setSaving(true);
    try {
      await api.post(`/api/pricebook/products/${selectedProductId}/guardrails`, guardrails);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    try {
      const cat = await api.post('/api/pricebook/categories', { name: newCategoryName });
      setCategories([...categories, cat]);
      setNewCategoryName('');
      setShowNewCategory(false);
    } catch {
      // handle
    }
  }

  async function addProduct() {
    if (!newProductName.trim() || !selectedCategoryId) return;
    try {
      const prod = await api.post(`/api/pricebook/categories/${selectedCategoryId}/products`, {
        name: newProductName,
      });
      setProducts([...products, prod]);
      setNewProductName('');
      setShowNewProduct(false);
    } catch {
      // handle
    }
  }

  function moveCategoryOrder(index: number, direction: 'up' | 'down') {
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    const updated = [...categories];
    [updated[index], updated[swapIdx]] = [updated[swapIdx], updated[index]];
    setCategories(updated);
    // Persist order
    api.post('/api/pricebook/categories/reorder', {
      order: updated.map((c) => c.id),
    });
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen">
        {/* Left Panel: Categories */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Categories</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {categories.map((cat, i) => (
              <div
                key={cat.id}
                className={`flex items-center gap-2 p-3 cursor-pointer border-b border-gray-100 transition-colors ${
                  selectedCategoryId === cat.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-gray-50'
                }`}
                onClick={() => {
                  setSelectedCategoryId(cat.id);
                  setSelectedProductId(null);
                }}
              >
                <div className="flex flex-col gap-0.5 mr-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveCategoryOrder(i, 'up'); }}
                    disabled={i === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveCategoryOrder(i, 'down'); }}
                    disabled={i === categories.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{cat.name}</p>
                  <p className="text-xs text-gray-500">{cat.productCount} products</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-gray-200">
            {showNewCategory ? (
              <div className="flex gap-2">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Category name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  onKeyDown={(e) => e.key === 'Enter' && addCategory()}
                  autoFocus
                />
                <button onClick={addCategory} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold min-h-[44px]">
                  Add
                </button>
                <button onClick={() => setShowNewCategory(false)} className="px-3 py-2 bg-gray-200 rounded-lg text-sm min-h-[44px]">
                  X
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewCategory(true)}
                className="w-full py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm min-h-[48px]"
              >
                + Add Category
              </button>
            )}
          </div>
        </div>

        {/* Middle: Products list or Product detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedCategoryId ? (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <p className="text-lg">Select a category to view products</p>
            </div>
          ) : !selectedProductId ? (
            /* Product List */
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {categories.find((c) => c.id === selectedCategoryId)?.name} - Products
                </h2>
                {showNewProduct ? (
                  <div className="flex gap-2">
                    <input
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      placeholder="Product name"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                      onKeyDown={(e) => e.key === 'Enter' && addProduct()}
                      autoFocus
                    />
                    <button onClick={addProduct} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm min-h-[44px]">
                      Add
                    </button>
                    <button onClick={() => setShowNewProduct(false)} className="px-3 py-2 bg-gray-200 rounded-lg text-sm min-h-[44px]">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewProduct(true)}
                    className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors text-sm min-h-[48px]"
                  >
                    + Add Product
                  </button>
                )}
              </div>

              {products.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <p>No products in this category yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProductId(p.id)}
                      className="bg-white rounded-xl shadow-lg p-5 text-left hover:shadow-xl hover:border-blue-300 border-2 border-transparent transition-all min-h-[120px]"
                    >
                      {p.image && (
                        <img src={p.image} alt={p.name} className="w-full h-32 object-cover rounded-lg mb-3" />
                      )}
                      <h3 className="font-bold text-gray-900 text-lg">{p.name}</h3>
                      <div className="flex gap-2 mt-2">
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">{p.measurementType}</span>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">{p.mode}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Product Detail */
            <div className="flex-1 overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <button
                    onClick={() => setSelectedProductId(null)}
                    className="p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-xl font-bold text-gray-900">{selectedProduct?.name}</h2>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
                  {(['ranges', 'addons', 'guardrails'] as ActiveTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 py-3 text-sm font-bold rounded-lg transition-colors min-h-[48px] capitalize ${
                        activeTab === tab
                          ? 'bg-white text-blue-600 shadow'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Ranges Tab */}
                {activeTab === 'ranges' && (
                  <div>
                    <div className="bg-white rounded-xl shadow-lg p-5 mb-4">
                      <h3 className="font-bold text-gray-900 mb-3">Markup Percentages</h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">1-Year Markup %</label>
                          <input
                            type="number"
                            value={yr1Markup}
                            onChange={(e) => {
                              setYr1Markup(Number(e.target.value));
                              setRanges(recalcPrices(ranges));
                            }}
                            className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">30-Day Markup %</label>
                          <input
                            type="number"
                            value={thirtyDayMarkup}
                            onChange={(e) => {
                              setThirtyDayMarkup(Number(e.target.value));
                              setRanges(recalcPrices(ranges));
                            }}
                            className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 mb-1">Today Discount %</label>
                          <input
                            type="number"
                            value={todayDiscount}
                            onChange={(e) => {
                              setTodayDiscount(Number(e.target.value));
                              setRanges(recalcPrices(ranges));
                            }}
                            className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Min</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Max</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Par Price</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Retail Price</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">1yr Price</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">30-Day</th>
                              <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase">Today</th>
                              <th className="px-4 py-3 w-12"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {ranges.map((r, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-4 py-2">
                                  <input
                                    type="number"
                                    value={r.min}
                                    onChange={(e) => updateRange(i, 'min', Number(e.target.value))}
                                    className="w-20 px-2 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="number"
                                    value={r.max}
                                    onChange={(e) => updateRange(i, 'max', Number(e.target.value))}
                                    className="w-20 px-2 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="number"
                                    value={r.parPrice}
                                    onChange={(e) => updateRange(i, 'parPrice', Number(e.target.value))}
                                    className="w-24 px-2 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <input
                                    type="number"
                                    value={r.retailPrice}
                                    onChange={(e) => updateRange(i, 'retailPrice', Number(e.target.value))}
                                    className="w-24 px-2 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <span className="text-sm font-medium text-gray-600">${r.yr1Price.toFixed(2)}</span>
                                </td>
                                <td className="px-4 py-2">
                                  <span className="text-sm font-medium text-gray-600">${r.thirtyDayPrice.toFixed(2)}</span>
                                </td>
                                <td className="px-4 py-2">
                                  <span className="text-sm font-medium text-green-600">${r.todayPrice.toFixed(2)}</span>
                                </td>
                                <td className="px-4 py-2">
                                  <button
                                    onClick={() => removeRange(i)}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="p-4 border-t border-gray-100 flex justify-between">
                        <button
                          onClick={addRange}
                          className="px-5 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm min-h-[48px]"
                        >
                          + Add Row
                        </button>
                        <button
                          onClick={saveRanges}
                          disabled={saving}
                          className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors text-sm min-h-[48px]"
                        >
                          {saving ? 'Saving...' : 'Save Ranges'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Addons Tab */}
                {activeTab === 'addons' && (
                  <div>
                    {addonGroups.map((group) => {
                      const groupAddons = addons.filter((a) => a.group === group);
                      return (
                        <div key={group} className="bg-white rounded-xl shadow-lg p-5 mb-4">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-gray-900">{group}</h3>
                            <button
                              onClick={() => addAddon(group)}
                              className="px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 text-sm min-h-[44px]"
                            >
                              + Add Addon
                            </button>
                          </div>

                          <div className="space-y-3">
                            {groupAddons.map((addon) => {
                              const globalIdx = addons.indexOf(addon);
                              return (
                                <div key={globalIdx} className="border border-gray-200 rounded-lg p-4">
                                  <div className="flex items-start gap-3">
                                    <div className="flex flex-col gap-1 mt-1">
                                      <button
                                        onClick={() => moveAddon(globalIdx, 'up')}
                                        className="p-1 text-gray-400 hover:text-gray-700"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => moveAddon(globalIdx, 'down')}
                                        className="p-1 text-gray-400 hover:text-gray-700"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                      </button>
                                    </div>

                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-1">Name</label>
                                        <input
                                          value={addon.name}
                                          onChange={(e) => updateAddon(globalIdx, 'name', e.target.value)}
                                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-1">Price</label>
                                        <input
                                          type="number"
                                          value={addon.price}
                                          onChange={(e) => updateAddon(globalIdx, 'price', Number(e.target.value))}
                                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-gray-500 mb-1">Type</label>
                                        <select
                                          value={addon.type}
                                          onChange={(e) => updateAddon(globalIdx, 'type', e.target.value)}
                                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm min-h-[44px]"
                                        >
                                          <option value="flat">Flat</option>
                                          <option value="per_unit">Per Unit</option>
                                          <option value="percentage">Percentage</option>
                                        </select>
                                      </div>
                                      <div className="flex items-end gap-3">
                                        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                                          <input
                                            type="checkbox"
                                            checked={addon.required}
                                            onChange={(e) => updateAddon(globalIdx, 'required', e.target.checked)}
                                            className="w-5 h-5 rounded text-blue-600"
                                          />
                                          <span className="text-sm text-gray-700">Required</span>
                                        </label>
                                        <button
                                          onClick={() => removeAddon(globalIdx)}
                                          className="p-2 text-red-500 hover:bg-red-50 rounded min-h-[44px]"
                                        >
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    <div className="flex justify-between mt-4">
                      <button
                        onClick={addAddonGroup}
                        className="px-5 py-3 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm min-h-[48px]"
                      >
                        + Add Group
                      </button>
                      <button
                        onClick={saveAddons}
                        disabled={saving}
                        className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors text-sm min-h-[48px]"
                      >
                        {saving ? 'Saving...' : 'Save Addons'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Guardrails Tab */}
                {activeTab === 'guardrails' && (
                  <div className="bg-white rounded-xl shadow-lg p-6">
                    <h3 className="font-bold text-gray-900 mb-6">Pricing Guardrails</h3>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Floor Price</label>
                        <p className="text-xs text-gray-500 mb-2">Minimum price allowed (auto-populated from par)</p>
                        <input
                          type="number"
                          value={guardrails.floorPrice}
                          onChange={(e) => setGuardrails({ ...guardrails, floorPrice: Number(e.target.value) })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Max Rep Discount %</label>
                        <input
                          type="number"
                          value={guardrails.maxRepDiscount}
                          onChange={(e) => setGuardrails({ ...guardrails, maxRepDiscount: Number(e.target.value) })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Max Senior Rep Discount %</label>
                        <input
                          type="number"
                          value={guardrails.maxSeniorRepDiscount}
                          onChange={(e) => setGuardrails({ ...guardrails, maxSeniorRepDiscount: Number(e.target.value) })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Manager PIN Required Below % Threshold</label>
                        <input
                          type="number"
                          value={guardrails.managerPinThreshold}
                          onChange={(e) => setGuardrails({ ...guardrails, managerPinThreshold: Number(e.target.value) })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                        />
                      </div>
                    </div>
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={saveGuardrails}
                        disabled={saving}
                        className="px-8 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
                      >
                        {saving ? 'Saving...' : 'Save Guardrails'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
