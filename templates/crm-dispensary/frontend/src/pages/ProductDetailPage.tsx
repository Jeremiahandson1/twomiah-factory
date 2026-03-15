import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Upload, Package, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { ConfirmModal } from '../components/ui/Modal';

const strainTypes = [
  { value: 'sativa', label: 'Sativa' },
  { value: 'indica', label: 'Indica' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'cbd', label: 'CBD' },
  { value: 'n/a', label: 'N/A' },
];

const categoryOptions = [
  { value: 'flower', label: 'Flower' },
  { value: 'edibles', label: 'Edibles' },
  { value: 'concentrates', label: 'Concentrates' },
  { value: 'vapes', label: 'Vapes' },
  { value: 'pre-rolls', label: 'Pre-Rolls' },
  { value: 'topicals', label: 'Topicals' },
  { value: 'merch', label: 'Merch' },
];

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const toast = useToast();
  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    category: 'flower',
    strainType: 'hybrid',
    strainName: '',
    thcPercent: '',
    cbdPercent: '',
    price: '',
    costPrice: '',
    stock: '',
    unit: 'gram',
    sku: '',
    barcode: '',
    description: '',
    isMerch: false,
    lowStockThreshold: '10',
  });

  useEffect(() => {
    loadProduct();
  }, [id]);

  const loadProduct = async () => {
    try {
      const data = await api.get(`/api/products/${id}`);
      setProduct(data);
      setForm({
        name: data.name || '',
        category: data.category || 'flower',
        strainType: data.strainType || 'hybrid',
        strainName: data.strainName || '',
        thcPercent: data.thcPercent != null ? String(data.thcPercent) : '',
        cbdPercent: data.cbdPercent != null ? String(data.cbdPercent) : '',
        price: data.price != null ? String(data.price) : '',
        costPrice: data.costPrice != null ? String(data.costPrice) : '',
        stock: data.stockQuantity != null ? String(data.stockQuantity) : '',
        unit: data.unit || 'gram',
        sku: data.sku || '',
        barcode: data.barcode || '',
        description: data.description || '',
        isMerch: data.isMerch || false,
        lowStockThreshold: data.lowStockThreshold != null ? String(data.lowStockThreshold) : '10',
      });
    } catch (err) {
      toast.error('Failed to load product');
      navigate('/crm/products');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Product name is required');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/api/products/${id}`, {
        ...form,
        thcPercent: form.thcPercent ? parseFloat(form.thcPercent) : null,
        cbdPercent: form.cbdPercent ? parseFloat(form.cbdPercent) : null,
        price: form.price ? parseFloat(form.price) : 0,
        costPrice: form.costPrice ? parseFloat(form.costPrice) : null,
        stockQuantity: form.stock ? parseInt(form.stock) : 0,
        lowStockThreshold: form.lowStockThreshold ? parseInt(form.lowStockThreshold) : 10,
      });
      toast.success('Product updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update product');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/products/${id}`);
      toast.success('Product deleted');
      navigate('/crm/products');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete product');
    } finally {
      setDeleting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const result = await api.request(`/api/products/${id}/image`, {
        method: 'POST',
        body: formData,
      });
      setProduct((prev: any) => ({ ...prev, imageUrl: result?.imageUrl }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload image');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/crm/products')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{product?.name || 'Product'}</h1>
            <p className="text-gray-500">SKU: {product?.sku || '—'}</p>
          </div>
        </div>
        <div className="flex gap-3">
          {isManager && (
            <button
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2 inline" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Image */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Product Image</h2>
          <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden mb-4">
            {product?.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <Package className="w-16 h-16 text-gray-300" />
            )}
          </div>
          <label className="block">
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer text-sm font-medium text-gray-700 transition-colors">
              <Upload className="w-4 h-4" /> Upload Image
            </span>
          </label>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Basic Information</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                >
                  {categoryOptions.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                >
                  <option value="gram">Gram</option>
                  <option value="eighth">Eighth (3.5g)</option>
                  <option value="quarter">Quarter (7g)</option>
                  <option value="half">Half (14g)</option>
                  <option value="ounce">Ounce (28g)</option>
                  <option value="unit">Unit</option>
                  <option value="pack">Pack</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                <input
                  type="text"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
                <input
                  type="text"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* Strain / Lab Data */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Strain & Lab Data</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Strain Type</label>
                <select
                  value={form.strainType}
                  onChange={(e) => setForm({ ...form, strainType: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                >
                  {strainTypes.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Strain Name</label>
                <input
                  type="text"
                  value={form.strainName}
                  onChange={(e) => setForm({ ...form, strainName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">THC %</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.thcPercent}
                  onChange={(e) => setForm({ ...form, thcPercent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CBD %</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.cbdPercent}
                  onChange={(e) => setForm({ ...form, cbdPercent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Pricing</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Retail Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              {form.price && form.costPrice && (
                <div className="md:col-span-2 p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-700">
                    Margin: ${(parseFloat(form.price) - parseFloat(form.costPrice)).toFixed(2)} ({((1 - parseFloat(form.costPrice) / parseFloat(form.price)) * 100).toFixed(1)}%)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Inventory */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Inventory</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                <input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
                <input
                  type="number"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Product"
        message={`Are you sure you want to delete "${product?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />
    </div>
  );
}
