import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';

interface Promotion {
  id: string;
  name: string;
  description: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  appliesTo: 'all' | 'category' | 'product';
  categoryId?: string;
  productId?: string;
  categoryName?: string;
  productName?: string;
  startDate: string;
  endDate: string;
  promoCode?: string;
  active: boolean;
  usageCount: number;
}

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [saving, setSaving] = useState(false);

  // Form
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDiscountType, setFormDiscountType] = useState<'percent' | 'flat'>('percent');
  const [formDiscountValue, setFormDiscountValue] = useState(0);
  const [formAppliesTo, setFormAppliesTo] = useState<'all' | 'category' | 'product'>('all');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formProductId, setFormProductId] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formPromoCode, setFormPromoCode] = useState('');
  const [formActive, setFormActive] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [promoData, catData, prodData] = await Promise.all([
          api.get('/api/promotions'),
          api.get('/api/pricebook/categories'),
          api.get('/api/pricebook/products'),
        ]);
        setPromotions(promoData);
        setCategories(catData);
        setProducts(prodData);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function resetForm() {
    setFormName('');
    setFormDescription('');
    setFormDiscountType('percent');
    setFormDiscountValue(0);
    setFormAppliesTo('all');
    setFormCategoryId('');
    setFormProductId('');
    setFormStartDate('');
    setFormEndDate('');
    setFormPromoCode('');
    setFormActive(true);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setShowForm(true);
  }

  function openEdit(promo: Promotion) {
    setEditing(promo);
    setFormName(promo.name);
    setFormDescription(promo.description);
    setFormDiscountType(promo.discountType);
    setFormDiscountValue(promo.discountValue);
    setFormAppliesTo(promo.appliesTo);
    setFormCategoryId(promo.categoryId || '');
    setFormProductId(promo.productId || '');
    setFormStartDate(promo.startDate.split('T')[0]);
    setFormEndDate(promo.endDate.split('T')[0]);
    setFormPromoCode(promo.promoCode || '');
    setFormActive(promo.active);
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      name: formName,
      description: formDescription,
      discountType: formDiscountType,
      discountValue: formDiscountValue,
      appliesTo: formAppliesTo,
      categoryId: formAppliesTo === 'category' ? formCategoryId : undefined,
      productId: formAppliesTo === 'product' ? formProductId : undefined,
      startDate: formStartDate,
      endDate: formEndDate,
      promoCode: formPromoCode || undefined,
      active: formActive,
    };
    try {
      if (editing) {
        const updated = await api.put(`/api/promotions/${editing.id}`, payload);
        setPromotions(promotions.map((p) => (p.id === editing.id ? updated : p)));
      } else {
        const created = await api.post('/api/promotions', payload);
        setPromotions([...promotions, created]);
      }
      setShowForm(false);
    } catch {
      // handle
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this promotion?')) return;
    try {
      await api.delete(`/api/promotions/${id}`);
      setPromotions(promotions.filter((p) => p.id !== id));
    } catch {
      // handle
    }
  }

  async function toggleActive(promo: Promotion) {
    try {
      const updated = await api.put(`/api/promotions/${promo.id}`, { active: !promo.active });
      setPromotions(promotions.map((p) => (p.id === promo.id ? updated : p)));
    } catch {
      // handle
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Promotions</h1>
          <button
            onClick={openCreate}
            className="px-5 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
          >
            + Create Promotion
          </button>
        </div>

        {/* Promotions List */}
        {promotions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg">No promotions created yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {promotions.map((promo) => (
              <div key={promo.id} className="bg-white rounded-xl shadow-lg p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className={`font-bold text-lg ${promo.active ? 'text-gray-900' : 'text-gray-400'}`}>
                        {promo.name}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        promo.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {promo.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {promo.description && (
                      <p className="text-sm text-gray-500 mt-1">{promo.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(promo)}
                      className="p-3 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleActive(promo)}
                      className={`relative w-14 h-8 rounded-full transition-colors ${
                        promo.active ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                        promo.active ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                    <button
                      onClick={() => handleDelete(promo.id)}
                      className="p-3 text-red-500 hover:bg-red-50 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500">Discount</p>
                    <p className="font-bold text-gray-900">
                      {promo.discountType === 'percent' ? `${promo.discountValue}%` : `$${promo.discountValue}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Applies To</p>
                    <p className="font-semibold text-gray-700 capitalize">
                      {promo.appliesTo === 'all' ? 'All Products' : promo.categoryName || promo.productName || promo.appliesTo}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Dates</p>
                    <p className="text-sm text-gray-700">
                      {new Date(promo.startDate).toLocaleDateString()} - {new Date(promo.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Promo Code</p>
                    <p className="font-mono text-sm text-gray-700">{promo.promoCode || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Uses</p>
                    <p className="font-bold text-gray-900">{promo.usageCount}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">
                  {editing ? 'Edit Promotion' : 'Create Promotion'}
                </h2>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
                  <input
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    placeholder="Spring Sale"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Discount Type</label>
                    <select
                      value={formDiscountType}
                      onChange={(e) => setFormDiscountType(e.target.value as 'percent' | 'flat')}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    >
                      <option value="percent">Percentage (%)</option>
                      <option value="flat">Flat Amount ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Discount Value</label>
                    <input
                      type="number"
                      value={formDiscountValue}
                      onChange={(e) => setFormDiscountValue(Number(e.target.value))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Applies To</label>
                  <select
                    value={formAppliesTo}
                    onChange={(e) => setFormAppliesTo(e.target.value as 'all' | 'category' | 'product')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                  >
                    <option value="all">All Products</option>
                    <option value="category">Specific Category</option>
                    <option value="product">Specific Product</option>
                  </select>
                </div>
                {formAppliesTo === 'category' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                    <select
                      value={formCategoryId}
                      onChange={(e) => setFormCategoryId(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    >
                      <option value="">Select category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {formAppliesTo === 'product' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Product</label>
                    <select
                      value={formProductId}
                      onChange={(e) => setFormProductId(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={formStartDate}
                      onChange={(e) => setFormStartDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={formEndDate}
                      onChange={(e) => setFormEndDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[48px]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Promo Code (optional)</label>
                  <input
                    value={formPromoCode}
                    onChange={(e) => setFormPromoCode(e.target.value.toUpperCase())}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono min-h-[48px]"
                    placeholder="SPRING2026"
                  />
                </div>
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer min-h-[48px]">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="w-5 h-5 rounded text-blue-600"
                  />
                  <span className="font-semibold text-gray-700">Active</span>
                </label>
              </div>
              <div className="p-6 border-t border-gray-200 flex gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formName}
                  className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[48px]"
                >
                  {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
