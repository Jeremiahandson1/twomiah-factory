import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Eye, RotateCcw, ShoppingCart } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader } from '../components/ui/DataTable';

const statusTabs = [
  { value: '', label: 'All', param: '' },
  { value: 'type:walk_in', label: 'Walk-in', param: 'type' },
  { value: 'type:delivery', label: 'Delivery', param: 'type' },
  { value: 'status:completed', label: 'Completed', param: 'status' },
  { value: 'status:cancelled', label: 'Cancelled', param: 'status' },
  { value: 'status:refunded', label: 'Refunded', param: 'status' },
];

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-700',
  walk_in: 'bg-emerald-100 text-emerald-700',
  delivery: 'bg-purple-100 text-purple-700',
  online: 'bg-indigo-100 text-indigo-700',
};

export default function OrdersPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) {
        const [filterType, filterValue] = statusFilter.split(':');
        if (filterType === 'type') params.type = filterValue;
        else if (filterType === 'status') params.status = filterValue;
      }
      const data = await api.get('/api/orders', params);
      setOrders(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const columns = [
    {
      key: 'orderNumber',
      label: 'Order #',
      render: (val: string, row: any) => (
        <span className="font-medium text-gray-900">#{val || row.id?.slice(0, 8)}</span>
      ),
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (val: string) => <span className="text-gray-700">{val || 'Walk-in'}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      render: (val: string) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[val] || 'bg-gray-100 text-gray-600'}`}>
          {(val || 'walk_in').replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'itemCount',
      label: 'Items',
      render: (val: number, row: any) => (
        <span className="text-gray-700">{val || row.items?.length || 0}</span>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      render: (val: number) => (
        <span className="font-medium text-gray-900">${Number(val || 0).toFixed(2)}</span>
      ),
    },
    {
      key: 'paymentMethod',
      label: 'Payment',
      render: (val: string) => (
        <span className="capitalize text-gray-600 text-sm">{val || '—'}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: string) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[val] || 'bg-gray-100 text-gray-600'}`}>
          {(val || 'pending').replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (val: string) => (
        <span className="text-gray-500 text-sm">
          {val ? new Date(val).toLocaleDateString() : '—'}
        </span>
      ),
    },
  ];

  const actions = [
    {
      label: 'View',
      icon: Eye,
      onClick: (row: any) => navigate(`/crm/orders/${row.id}`),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Order history and management"
        action={
          <button
            onClick={() => navigate('/crm/orders/new')}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium flex items-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" /> New Sale
          </button>
        }
      />

      {/* Status Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {statusTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
              statusFilter === tab.value
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
          />
        </div>
      </div>

      <DataTable
        data={orders}
        columns={columns}
        loading={loading}
        pagination={pagination}
        onPageChange={setPage}
        onRowClick={(row: any) => navigate(`/crm/orders/${row.id}`)}
        actions={actions}
        emptyMessage="No orders found"
      />
    </div>
  );
}
