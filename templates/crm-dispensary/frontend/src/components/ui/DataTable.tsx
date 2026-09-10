import { useState } from 'react';
import type { ReactNode, ComponentType, ButtonHTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight, Search, Filter, MoreVertical, Edit, Trash2, Eye } from 'lucide-react';

// Prop types for the shared table/header/button. These were untyped destructured params,
// which TypeScript reads as "every prop is required" — so every <DataTable> / <PageHeader> /
// <Button> call site that omitted an optional prop was a type error (~100 across the app).
export interface DataTableColumn<Row = any> {
  key: string;
  label?: ReactNode;
  className?: string;
  cellClassName?: string;
  render?: (value: any, row: Row) => ReactNode;
}
export interface DataTableAction<Row = any> {
  label: ReactNode;
  onClick: (row: Row) => void;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}
export interface DataTablePagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
export interface DataTableProps<Row = any> {
  data?: Row[];
  columns?: DataTableColumn<Row>[];
  loading?: boolean;
  pagination?: DataTablePagination | null;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: Row) => void;
  actions?: DataTableAction<Row>[];
  emptyMessage?: ReactNode;
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  searchValue?: string;
  error?: string | boolean | null;
  onRetry?: () => void;
}

export function DataTable<Row extends { id?: any } = any>({
  data = [],
  columns = [],
  loading = false,
  pagination = null,
  onPageChange,
  onRowClick,
  actions,
  emptyMessage = 'No data found',
  searchPlaceholder = 'Search...',
  onSearch,
  searchValue = '',
  error = null,
  onRetry,
}: DataTableProps<Row>) {
  const [openMenu, setOpenMenu] = useState<any>(null);
  // Anchor the row action menu with fixed positioning so it escapes the card's
  // overflow-hidden / overflow-x-auto clipping (S21).
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden dark:bg-slate-900">
      {/* Search bar */}
      {onSearch && (
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-900">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider ${col.className || ''}`}
                >
                  {col.label}
                </th>
              ))}
              {actions && <th className="px-4 py-3 w-12"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-12 text-center">
                  <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                </td>
              </tr>
            ) : error ? (
              // Distinguish a failed load (500/network) from a genuinely empty
              // list so a broken fetch doesn't masquerade as "no data".
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-12 text-center">
                  <p className="text-sm text-red-600 mb-3">{typeof error === 'string' && error ? error : 'Something went wrong loading this list.'}</p>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr
                  key={row.id || rowIdx}
                  className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.cellClassName || ''}`}>
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (openMenu === row.id) { setOpenMenu(null); return; }
                            const r = e.currentTarget.getBoundingClientRect();
                            const width = 144;
                            const estHeight = (actions.length * 40) + 8;
                            const top = (r.bottom + estHeight > window.innerHeight) ? Math.max(8, r.top - estHeight) : r.bottom + 4;
                            const left = Math.max(8, r.right - width);
                            setMenuPos({ top, left });
                            setOpenMenu(row.id);
                          }}
                          className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-100 hover:border-gray-300 text-gray-500 hover:text-gray-700 transition-colors dark:border-slate-700 dark:text-slate-400"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-500 dark:text-slate-400" />
                        </button>
                        {openMenu === row.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                            <div
                              className="fixed w-36 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 dark:bg-slate-900 dark:border-slate-700"
                              style={{ top: menuPos.top, left: menuPos.left }}
                            >
                              {actions.map((action, idx) => (
                                <button
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenu(null);
                                    action.onClick(row);
                                  }}
                                  className={`w-full px-4 py-2 text-sm text-left flex items-center gap-2 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 ${action.className || ''}`}
                                >
                                  {action.icon && <action.icon className="w-4 h-4" />}
                                  {action.label}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 dark:text-slate-400">
              Page {pagination.page} of {pagination.pages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status, statusColors }: { status: string; statusColors?: Record<string, string> }) {
  const colors: Record<string, string> = statusColors || {
    draft: 'bg-gray-100 text-gray-700',
    pending: 'bg-yellow-100 text-yellow-700',
    active: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-blue-100 text-blue-700',
    scheduled: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    paid: 'bg-green-100 text-green-700',
    approved: 'bg-green-100 text-green-700',
    sent: 'bg-blue-100 text-blue-700',
    rejected: 'bg-red-100 text-red-700',
    overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-red-100 text-red-700',
    open: 'bg-yellow-100 text-yellow-700',
    closed: 'bg-gray-100 text-gray-700',
  };

  const colorClass = colors[status] || 'bg-gray-100 text-gray-700';
  const label = status?.replace(/_/g, ' ');

  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize ${colorClass}`}>
      {label}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="text-gray-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | string;
  size?: 'sm' | 'md' | 'lg' | string;
}
export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-orange-500 hover:bg-orange-600 text-white',
    secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    ghost: 'hover:bg-gray-100 text-gray-700',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
