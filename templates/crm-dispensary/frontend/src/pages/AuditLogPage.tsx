import { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Filter, Calendar, User, ChevronDown } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const actionTypes = [
  { value: '', label: 'All Actions' },
  { value: 'order_created', label: 'Order Created' },
  { value: 'order_refunded', label: 'Order Refunded' },
  { value: 'order_cancelled', label: 'Order Cancelled' },
  { value: 'product_created', label: 'Product Created' },
  { value: 'product_updated', label: 'Product Updated' },
  { value: 'product_deleted', label: 'Product Deleted' },
  { value: 'inventory_adjusted', label: 'Inventory Adjusted' },
  { value: 'customer_created', label: 'Customer Created' },
  { value: 'customer_updated', label: 'Customer Updated' },
  { value: 'cash_opened', label: 'Cash Drawer Opened' },
  { value: 'cash_closed', label: 'Cash Drawer Closed' },
  { value: 'discount_applied', label: 'Discount Applied' },
  { value: 'void', label: 'Void' },
  { value: 'login', label: 'Login' },
  { value: 'settings_changed', label: 'Settings Changed' },
];

const actionColors: Record<string, string> = {
  order_created: 'bg-green-100 text-green-700',
  order_refunded: 'bg-red-100 text-red-700',
  order_cancelled: 'bg-red-100 text-red-700',
  product_created: 'bg-blue-100 text-blue-700',
  product_updated: 'bg-blue-100 text-blue-700',
  product_deleted: 'bg-red-100 text-red-700',
  inventory_adjusted: 'bg-amber-100 text-amber-700',
  customer_created: 'bg-purple-100 text-purple-700',
  cash_opened: 'bg-green-100 text-green-700',
  cash_closed: 'bg-gray-100 text-gray-700',
  discount_applied: 'bg-indigo-100 text-indigo-700',
  void: 'bg-red-100 text-red-700',
  login: 'bg-gray-100 text-gray-600',
};

export default function AuditLogPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);

  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await api.get('/api/company/users');
      setUsers(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 50 };
      if (actionFilter) params.action = actionFilter;
      if (userFilter) params.userId = userFilter;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search) params.search = search;
      const data = await api.get('/api/audit', params);
      setLogs(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, userFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    setPage(1);
  }, [actionFilter, userFilter, dateFrom, dateTo, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-green-600" />
          Audit Log
        </h1>
        <p className="text-gray-600">Track all system activity and compliance events</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="grid md:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
          >
            {actionTypes.map(a => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
          >
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
            placeholder="To"
          />
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log: any, idx: number) => (
                <tr key={log.id || idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                        <User className="w-3 h-3 text-gray-500" />
                      </div>
                      <span className="text-sm text-gray-900">{log.userName || log.userEmail || 'System'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      actionColors[log.action] || 'bg-gray-100 text-gray-600'
                    }`}>
                      {(log.action || 'unknown').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-md truncate">
                    {log.description || log.details || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                    {log.ipAddress || '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                    <Shield className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    No audit log entries found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} entries)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="px-3 py-1 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
