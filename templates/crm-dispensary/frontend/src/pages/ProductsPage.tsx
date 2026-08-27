import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Package, Filter } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const categories = [
  { value: '', label: 'All' },
  { value: 'flower', label: 'Flower' },
  { value: 'edibles', label: 'Edibles' },
  { value: 'concentrates', label: 'Concentrates' },
  { value: 'vapes', label: 'Vapes' },
  { value: 'pre-rolls', label: 'Pre-Rolls' },
  { value: 'topicals', label: 'Topicals' },
  { value: 'merch', label: 'Merch' },
];

const strainTypes = [
  { value: 'sativa', label: 'Sativa', color: 'bg-orange-100 text-orange-700' },
  { value: 'indica', label: 'Indica', color: 'bg-purple-100 text-purple-700' },
  { value: 'hybrid', label: 'Hybrid', color: 'bg-green-100 text-green-700' },
  { value: 'cbd', label: 'CBD', color: 'bg-blue-100 text-blue-700' },
  { value: 'n/a', label: 'N/A', color: 'bg-gray-100 text-gray-600' },
];

const initialFormData = {
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
  imageUrl: '',
  isMerch: false,
};

export default function ProductsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormData);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (file: File) => {
    setUploadingImage(true);
    try {
      const res: any = await api.uploadImage('/api/products/upload-image', file);
      setFormData((prev) => ({ ...prev, imageUrl: res.url }));
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Could not upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (category) params.category = category;
      const data = await api.get('/api/products', params);
      setProducts(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [page, search, category]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    setPage(1);
  }, [search, category]);

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Product name is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/products', {
        ...formData,
        thcPercent: formData.thcPercent ? parseFloat(formData.thcPercent) : null,
        cbdPercent: formData.cbdPercent ? parseFloat(formData.cbdPercent) : null,
        price: formData.price ? parseFloat(formData.price) : 0,
        costPrice: formData.costPrice ? parseFloat(formData.costPrice) : null,
        stockQuantity: formData.stock ? parseInt(formData.stock) : 0,
      });
      toast.success('Product created');
      setModalOpen(false);
      setFormData(initialFormData);
      loadProducts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create product');
    } finally {
      setSaving(false);
    }
  };

  const getStrainBadge = (strainType: string) => {
    const strain = strainTypes.find(s => s.value === strainType);
    if (!strain) return null;
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${strain.color}`}>
        {strain.label}
      </span>
    );
  };

  const getStockColor = (stock: number) => {
    if (stock <= 0) return 'text-red-600 font-semibold';
    if (stock <= 10) return 'text-amber-600 font-medium';
    return 'text-green-600';
  };

  const columns = [
    {
      key: 'name',
      label: 'Product',
      render: (val: string, row: any) => (
        <div className="flex items-center gap-3">
          {row.imageUrl ? (
            <img src={row.imageUrl} alt={val} className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center dark:bg-slate-800">
              <Package className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900 dark:text-slate-100">{val}</p>
            {row.strainName && <p className="text-xs text-gray-500 dark:text-slate-400">{row.strainName}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (val: string) => (
        <span className="capitalize text-gray-700 dark:text-slate-200">{val?.replace('-', ' ') || '—'}</span>
      ),
    },
    {
      key: 'strainType',
      label: 'Strain',
      render: (val: string) => getStrainBadge(val) || <span className="text-gray-400">—</span>,
    },
    {
      key: 'thcPercent',
      label: 'THC%',
      render: (val: number) => val != null ? <span className="text-gray-700 dark:text-slate-200">{val}%</span> : <span className="text-gray-400">—</span>,
    },
    {
      key: 'price',
      label: 'Price',
      render: (val: number) => <span className="font-medium text-gray-900 dark:text-slate-100">${Number(val || 0).toFixed(2)}</span>,
    },
    {
      key: 'stockQuantity',
      label: 'Stock',
      render: (val: number, row: any) => {
        const stock = val ?? row?.stockQuantity ?? row?.stock ?? 0;
        return <span className={getStockColor(stock)}>{stock}</span>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Cannabis product catalog"
        action={
          <Button onClick={() => { setFormData(initialFormData); setModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Add Product
          </Button>
        }
      />

      {/* Category Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              category === cat.value
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        data={products}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={(row: any) => navigate(`/crm/products/${row.id}`)}
        emptyMessage="No products found"
      />

      {/* Add Product Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add Product"
        size="lg"
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Product Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="Blue Dream 3.5g"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            >
              {categories.filter(c => c.value).map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Strain Type</label>
            <select
              value={formData.strainType}
              onChange={(e) => setFormData({ ...formData, strainType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            >
              {strainTypes.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Strain Name</label>
            <input
              type="text"
              value={formData.strainName}
              onChange={(e) => setFormData({ ...formData, strainName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="Blue Dream"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">SKU</label>
            <input
              type="text"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">THC %</label>
            <input
              type="number"
              step="0.1"
              value={formData.thcPercent}
              onChange={(e) => setFormData({ ...formData, thcPercent: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="24.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">CBD %</label>
            <input
              type="number"
              step="0.1"
              value={formData.cbdPercent}
              onChange={(e) => setFormData({ ...formData, cbdPercent: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="0.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="35.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Cost Price ($)</label>
            <input
              type="number"
              step="0.01"
              value={formData.costPrice}
              onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="18.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Stock Quantity</label>
            <input
              type="number"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Unit</label>
            <select
              value={formData.unit}
              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
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
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Product Image</label>
            <div className="flex items-center gap-3">
              {formData.imageUrl ? (
                <img src={formData.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 dark:border-slate-700" />
              ) : (
                <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs dark:border-slate-700">No image</div>
              )}
              <label className={`px-3 py-2 rounded-lg font-medium cursor-pointer text-sm ${uploadingImage ? 'bg-gray-100 text-gray-400 pointer-events-none' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                {uploadingImage ? 'Uploading…' : (formData.imageUrl ? 'Replace' : 'Upload image')}
                <input
                  type="file" accept="image/*" className="hidden" disabled={uploadingImage}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }}
                />
              </label>
              {formData.imageUrl && !uploadingImage && (
                <button type="button" onClick={() => setFormData({ ...formData, imageUrl: '' })} className="text-sm text-red-600 hover:underline">Remove</button>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">JPEG, PNG, WebP, GIF or AVIF · up to 8 MB</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => setModalOpen(false)}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium dark:text-slate-200"
          >
            Cancel
          </button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating...' : 'Create Product'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
