import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ordered: 'bg-blue-100 text-blue-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MaterialsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [supplierFilter, setSupplierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [suppliers, setSuppliers] = useState<string[]>([]);

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (supplierFilter) params.set('supplier', supplierFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`/api/material-orders?${params}`, { headers });
      const data = await res.json();
      const items = Array.isArray(data) ? data : data.data || [];
      setOrders(items);
      setTotal(data.pagination?.total || data.total || items.length);

      // Extract unique suppliers
      const uniqueSuppliers = [...new Set(items.map((o: any) => o.supplier).filter(Boolean))] as string[];
      setSuppliers((prev) => {
        const all = [...new Set([...prev, ...uniqueSuppliers])];
        return all;
      });
    } catch {
      toast.error('Failed to load material orders');
    } finally {
      setLoading(false);
    }
  }, [page, supplierFilter, statusFilter, dateFrom, dateTo, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [supplierFilter, statusFilter, dateFrom, dateTo]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Material Orders</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} orders</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Suppliers</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Statuses</option>
            {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}
          </select>
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <span>From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <span>To</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm" />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Job #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Order Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Delivery Date</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No material orders found</td></tr>
                ) : (
                  orders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => order.jobId && navigate(`/crm/jobs/${order.jobId}`)}
                      className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">
                        {order.jobNumber || (order.jobId ? `ROOF-${String(order.jobId).padStart(4, '0')}` : '—')}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{order.supplier || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[order.status] || 'bg-gray-100 text-gray-600'}`}>
                          {formatStatus(order.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {order.orderDate ? new Date(order.orderDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {order.totalCost != null ? `$${Number(order.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
