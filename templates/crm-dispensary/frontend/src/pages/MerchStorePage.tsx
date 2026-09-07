import { useState, useEffect, useCallback } from 'react';
import { formatDate } from '../utils/date';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Package, Eye, Plus } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

// Merch = the 'accessory' product category (branded goods sold online).
const MERCH_CATEGORY = 'accessory';

export default function MerchStorePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', sku: '', price: '', stockQuantity: '', description: '' });

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25, category: MERCH_CATEGORY };
      if (search) params.search = search;
      const data = await api.get('/api/products', params);
      setProducts(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      toast.error('Failed to load merch products');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25, type: 'online' };
      if (search) params.search = search;
      const data = await api.get('/api/orders', params);
      setOrders(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      console.error('Failed to load merch orders:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    if (tab === 'products') loadProducts();
    else loadOrders();
  }, [tab, loadProducts, loadOrders]);

  const openCreate = () => {
    setForm({ name: '', sku: '', price: '', stockQuantity: '', description: '' });
    setModalOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    const price = parseFloat(form.price);
    if (isNaN(price) || price < 0) { toast.error('Enter a valid price'); return; }
    setSaving(true);
    try {
      await api.post('/api/products', {
        name: form.name.trim(),
        category: MERCH_CATEGORY,
        price,
        sku: form.sku.trim() || undefined,
        stockQuantity: form.stockQuantity ? parseInt(form.stockQuantity, 10) : 0,
        description: form.description.trim() || undefined,
      });
      toast.success('Merch product created');
      setModalOpen(false);
      setTab('products');
      loadProducts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create product');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, tab]);

  const productColumns = [
    {
      key: 'name',
      label: 'Product',
      render: (val: string, row: any) => (
        <div className="flex items-center gap-3">
          {row.imageUrl ? (
            <img src={row.imageUrl} alt={val} className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center dark:bg-slate-800">
              <ShoppingBag className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900 dark:text-slate-100">{val}</p>
            {row.sku && <p className="text-xs text-gray-500 dark:text-slate-400">SKU: {row.sku}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      label: 'Price',
      render: (val: number) => <span className="font-medium text-gray-900 dark:text-slate-100">${Number(val || 0).toFixed(2)}</span>,
    },
    {
      key: 'stockQuantity',
      label: 'Stock',
      render: (val: number) => (
        <span className={`font-medium ${val <= 0 ? 'text-red-600' : val <= 10 ? 'text-amber-600' : 'text-green-600'}`}>
          {val ?? 0}
        </span>
      ),
    },
    {
      key: 'soldCount',
      label: 'Sold',
      render: (val: number) => <span className="text-gray-700 dark:text-slate-200">{val || 0}</span>,
    },
  ];

  const orderColumns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: (val: string, row: any) => <span className="font-medium text-gray-900 dark:text-slate-100">#{val || row.id?.slice(0, 8)}</span>,
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (val: string) => <span className="text-gray-700 dark:text-slate-200">{val || 'Guest'}</span>,
    },
    {
      key: 'itemCount',
      label: 'Items',
      render: (val: number) => <span className="text-gray-700 dark:text-slate-200">{val || 0}</span>,
    },
    {
      key: 'total',
      label: 'Total',
      render: (val: number) => <span className="font-medium text-gray-900 dark:text-slate-100">${Number(val || 0).toFixed(2)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: string) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
          val === 'shipped' ? 'bg-blue-100 text-blue-700' :
          val === 'delivered' ? 'bg-green-100 text-green-700' :
          val === 'cancelled' ? 'bg-red-100 text-red-700' :
          'bg-yellow-100 text-yellow-700'
        }`}>
          {val || 'pending'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (val: string) => <span className="text-gray-500 text-sm dark:text-slate-400">{val ? formatDate(val) : '—'}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Merch Store"
        subtitle="Branded merchandise management"
        action={
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2 inline" />
            Add Product
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setTab('products')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'products' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Package className="w-4 h-4" /> Products
        </button>
        <button
          onClick={() => setTab('orders')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'orders' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShoppingBag className="w-4 h-4" /> Online Orders
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={tab === 'products' ? 'Search merch...' : 'Search orders...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
          />
        </div>
      </div>

      {tab === 'products' ? (
        <DataTable
          data={products}
          columns={productColumns}
          loading={loading}
          pagination={pagination}
          onPageChange={setPage}
          onRowClick={(row: any) => navigate(`/crm/products/${row.id}`)}
          emptyMessage="No merch products found"
        />
      ) : (
        <DataTable
          data={orders}
          columns={orderColumns}
          loading={loading}
          pagination={pagination}
          onPageChange={setPage}
          emptyMessage="No online orders found"
        />
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add Merch Product" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500" placeholder="Branded T-Shirt" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Price *</label>
              <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500" placeholder="24.99" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Stock</label>
              <input type="number" min="0" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500" placeholder="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">SKU</label>
            <input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500" placeholder="MERCH-001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-green-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creating...' : 'Add Product'}</Button>
        </div>
      </Modal>
    </div>
  );
}
