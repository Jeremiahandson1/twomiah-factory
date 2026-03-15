import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Package, Eye, Plus } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';

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

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25, category: 'merch' };
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
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900">{val}</p>
            {row.sku && <p className="text-xs text-gray-500">SKU: {row.sku}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      label: 'Price',
      render: (val: number) => <span className="font-medium text-gray-900">${Number(val || 0).toFixed(2)}</span>,
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
      render: (val: number) => <span className="text-gray-700">{val || 0}</span>,
    },
  ];

  const orderColumns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: (val: string, row: any) => <span className="font-medium text-gray-900">#{val || row.id?.slice(0, 8)}</span>,
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (val: string) => <span className="text-gray-700">{val || 'Guest'}</span>,
    },
    {
      key: 'itemCount',
      label: 'Items',
      render: (val: number) => <span className="text-gray-700">{val || 0}</span>,
    },
    {
      key: 'total',
      label: 'Total',
      render: (val: number) => <span className="font-medium text-gray-900">${Number(val || 0).toFixed(2)}</span>,
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
      render: (val: string) => <span className="text-gray-500 text-sm">{val ? new Date(val).toLocaleDateString() : '—'}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Merch Store"
        subtitle="Branded merchandise management"
        action={
          <Button onClick={() => navigate('/crm/products')}>
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
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
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
    </div>
  );
}
