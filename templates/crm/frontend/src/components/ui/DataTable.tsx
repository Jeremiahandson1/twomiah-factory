import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Search, Filter, MoreVertical, Edit, Trash2, Eye, LucideIcon } from 'lucide-react';

interface DataTableColumn<T = Record<string, unknown>> {
  key: string;
  label: string;
  className?: string;
  cellClassName?: string;
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface DataTableAction<T = Record<string, unknown>> {
  label: string;
  icon?: LucideIcon;
  className?: string;
  onClick: (row: T) => void;
  show?: (row: T) => boolean;
}

interface DataTablePagination {
  page: number;
  pages?: number;
  totalPages?: number;
  limit: number;
  total: number;
}

interface DataTableProps<T = Record<string, unknown>> {
  data?: T[];
  columns?: DataTableColumn<T>[];
  loading?: boolean;
  pagination?: DataTablePagination | null;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  actions?: DataTableAction<T>[];
  emptyMessage?: string;
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  searchValue?: string;
}

export function DataTable<T extends Record<string, unknown> = Record<string, unknown>>({
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
}: DataTableProps<T>) {
  const [openMenu, setOpenMenu] = useState<string | number | null>(null);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm overflow-hidden">
      {/* Search bar */}
      {onSearch && (
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-slate-800 border-b dark:border-slate-700">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wider ${col.className || ''}`}
                >
                  {col.label}
                </th>
              ))}
              {actions && <th className="px-4 py-3 w-12"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-12 text-center">
                  <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
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
                  key={(row as Record<string, unknown>).id as string | number || rowIdx}
                  className={`hover:bg-gray-50 dark:hover:bg-slate-800 ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 text-gray-700 dark:text-slate-300 ${col.cellClassName || ''}`}>
                      {col.render ? col.render((row as Record<string, unknown>)[col.key], row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.stopPropagation();
                            const rowId = (row as Record<string, unknown>).id as string | number;
                            setOpenMenu(openMenu === rowId ? null : rowId);
                          }}
                          className="p-1.5 rounded-md border border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 hover:border-gray-300 text-gray-500 dark:text-slate-400 hover:text-gray-700 transition-colors"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-500" />
                        </button>
                        {openMenu === (row as Record<string, unknown>).id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                            <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-slate-800 rounded-lg shadow-lg border dark:border-slate-700 z-20 py-1">
                              {actions.map((action, idx) => (
                                <button
                                  key={idx}
                                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                    e.stopPropagation();
                                    setOpenMenu(null);
                                    action.onClick(row);
                                  }}
                                  className={`w-full px-4 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-300 ${action.className || ''}`}
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
      {pagination && (pagination.pages || pagination.totalPages || 0) > 1 && onPageChange && (
        <div className="px-4 py-3 border-t dark:border-slate-700 flex items-center justify-between">
          <p className="text-sm text-gray-600 dark:text-slate-400">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-600 dark:text-slate-400">
              Page {pagination.page} of {pagination.pages || pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= (pagination.pages || pagination.totalPages || 0)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StatusBadgeProps {
  status: string;
  statusColors?: Record<string, string>;
}

export function StatusBadge({ status, statusColors }: StatusBadgeProps) {
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

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {subtitle && <p className="text-gray-600 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const dtButtonVariants: Record<string, string> = {
  primary: 'bg-orange-500 hover:bg-orange-600 text-white',
  secondary: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
  danger: 'bg-red-500 hover:bg-red-600 text-white',
  ghost: 'hover:bg-gray-100 text-gray-700',
};

const dtButtonSizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2',
  lg: 'px-6 py-3 text-lg',
};

interface DTButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  variant?: string;
  size?: string;
  className?: string;
}

export function Button({ children, variant = 'primary', size = 'md', className = '', ...props }: DTButtonProps) {
  return (
    <button
      className={`font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${dtButtonVariants[variant] || ''} ${dtButtonSizes[size] || ''} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
