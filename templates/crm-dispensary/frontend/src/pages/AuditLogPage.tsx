import { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Filter, Calendar, User, ChevronDown } from 'lucide-react';
import api from '../services/api';
import { formatDateTime } from '../utils/date';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

/**
 * THE FILTER LISTS COME FROM THE SERVER, not from here. (T41)
 *
 * This file used to carry a hard-coded list of fifteen composite values — 'order_created',
 * 'product_updated', 'inventory_adjusted', 'cash_opened', 'void', 'settings_changed' and the rest.
 * The audit log does not store anything of the kind: it stores `action` ('create', 'update',
 * 'delete', 'status_change', 'export', 'payment', 'login', …) and `entity` ('order', 'product',
 * 'batch', 'contact', … about 110 of them) in two separate columns. So every option in that
 * dropdown matched zero rows, and picking any of them emptied the screen — reported as "Audit Log
 * filters return nothing".
 *
 * Re-writing the list by hand is exactly how it came to be wrong, and the entity vocabulary grows
 * with every module that logs anything. So the page now asks GET /api/audit/filters what is
 * actually in this company's log and builds both dropdowns from the answer. A filter built from the
 * data cannot drift from the data.
 */

/** 'status_change' → 'Status change', 'kiosk_age_denied' → 'Kiosk age denied'. */
const humanise = (v: string) =>
  v.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

/**
 * Colour by what the action DID, keyed on the values that are really stored. The old map was keyed
 * on the same invented composites as the filter, so every badge fell through to grey.
 */
const actionColors: Record<string, string> = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  status_change: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  payment: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  export: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  role_change: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  login: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200',
  logout: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200',
  login_failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  kiosk_age_denied: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
  kiosk_limit_denied: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
};

export default function AuditLogPage() {
  const { isManager, can, company } = useAuth();
  /**
   * ONE CLOCK FOR THE WHOLE SHOP. (T41)
   *
   *   "an order stores store time and the audit entry shows browser time"
   *
   * Every other screen that prints an instant uses formatDateTime(value, storeTz) — Orders, the
   * order detail, Cash, the EOD report, the offline queue — because a dispensary reconciles its day
   * against the till, and the till runs on the shop's clock. This page used
   * `new Date(createdAt).toLocaleString()`, the BROWSER's zone. So the same sale read 14:32 on the
   * order and 19:32 in the audit log for anyone whose laptop was not in the shop's timezone, and
   * nobody could line up an event with the sale it belongs to.
   *
   * The stored value was never wrong: both are the same UTC instant. Only this page rendered it
   * against a different clock.
   */
  const storeTz = (company as any)?.timeZone as string | undefined;
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);

  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  /** What this company's log can be filtered by, from GET /api/audit/filters. */
  const [options, setOptions] = useState<{ actions: { value: string; count: number }[]; entities: { value: string; count: number }[] }>({ actions: [], entities: [] });
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    loadUsers();
    // re-run once the permission list lands, or the filter stays empty for someone who may see it
  }, [can('users:read')]);

  const loadUsers = async () => {
    // The roster is behind users:read, which a manager does not hold — they get team:read. Asking
    // anyway produced a 403 and a red "Failed to load users:" in the console on a page that had
    // otherwise loaded fine, and left the filter silently empty with nothing to explain it. Ask only
    // when the answer can be yes, and let the filter hide itself below. (T42 L2)
    if (!can('users:read')) return;
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
      if (entityFilter) params.entity = entityFilter;
      if (userFilter) params.userId = userFilter;
      // startDate/endDate, which is what the endpoint reads. These went as dateFrom/dateTo, which
      // it ignored, so narrowing to a date range returned the whole log. The server now accepts
      // both spellings as well, but the screen should send the real names. (T41)
      if (dateFrom) params.startDate = dateFrom;
      if (dateTo) params.endDate = dateTo;
      if (search) params.search = search;
      const data = await api.get('/api/audit', params);
      setLogs(Array.isArray(data) ? data : data?.data || []);
      setPagination(data?.pagination || null);
    } catch (err) {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter, userFilter, dateFrom, dateTo, search]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // The filter vocabulary, once. Everyone who can open this page can read it — it is the same
  // manager+ gate the log itself is behind — so there is no permission to check first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/audit/filters');
        if (!cancelled) {
          setOptions({
            actions: Array.isArray(data?.actions) ? data.actions : [],
            entities: Array.isArray(data?.entities) ? data.entities : [],
          });
        }
      } catch {
        // A log with no rows yet, or a tenant that has not been re-deployed: leave the dropdowns at
        // "All", which filters nothing and shows everything, rather than blocking the page.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [actionFilter, entityFilter, userFilter, dateFrom, dateTo, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <Shield className="w-6 h-6 text-green-700 dark:text-green-300" />
          Audit Log
        </h1>
        <p className="text-gray-600 dark:text-slate-400">Track all system activity and compliance events</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 dark:bg-slate-900">
        {/* One column fewer when the roster is not readable, so the row does not leave a gap where
            a control used to be. (T42 L2) */}
        {/* One more column than before: What happened and What it happened to are two columns in
            the log, so they are two controls here. (T41) */}
        <div className={`grid gap-3 ${can('users:read') ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            aria-label="Filter by action"
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800"
          >
            <option value="">All actions</option>
            {options.actions.map(a => (
              <option key={a.value} value={a.value}>{humanise(a.value)} ({a.count})</option>
            ))}
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            aria-label="Filter by record type"
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800"
          >
            <option value="">All records</option>
            {options.entities.map(e => (
              <option key={e.value} value={e.value}>{humanise(e.value)} ({e.count})</option>
            ))}
          </select>
          {can('users:read') && (
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            >
              <option value="">All Users</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            placeholder="To"
          />
        </div>
      </div>

      {/* Log Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto dark:bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log: any, idx: number) => (
                <tr key={log.id || idx} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap dark:text-slate-200">
                    {log.createdAt ? formatDateTime(log.createdAt, storeTz) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center dark:bg-slate-700 dark:text-slate-100">
                        <User className="w-3 h-3 text-gray-500 dark:text-slate-400" />
                      </div>
                      <span className="text-sm text-gray-900 dark:text-slate-100">{log.userName || log.userEmail || 'System'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      actionColors[log.action] || 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                    }`}>
                      {(log.action || 'unknown').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-md truncate dark:text-slate-200">
                    {log.description || log.details || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono dark:text-slate-400">
                    {log.ipAddress || '—'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">
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
            <p className="text-sm text-gray-500 dark:text-slate-400">
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
