import React, { useState } from 'react';
import { ChevronDown, ChevronUp, MoreVertical, LucideIcon } from 'lucide-react';
import { useIsMobile } from '../../hooks/useMediaQuery';

interface ResponsiveTableColumn<T = Record<string, unknown>> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
}

interface ResponsiveTableAction<T = Record<string, unknown>> {
  label: string;
  icon?: LucideIcon;
  className?: string;
  onClick: (row: T) => void;
}

interface ResponsiveTableProps<T = Record<string, unknown>> {
  data?: T[];
  columns?: ResponsiveTableColumn<T>[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  actions?: ResponsiveTableAction<T>[];
  emptyMessage?: string;
  mobileRender?: (row: T) => React.ReactNode;
}

export function ResponsiveTable<T extends Record<string, unknown> = Record<string, unknown>>({
  data = [],
  columns = [],
  loading = false,
  onRowClick,
  actions = [],
  emptyMessage = 'No data found',
  mobileRender,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [openMenu, setOpenMenu] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  // Mobile card view
  if (isMobile) {
    return (
      <div className="divide-y" role="list">
        {data.map((row, idx) => (
          <div
            key={(row as Record<string, unknown>).id as string | number || idx}
            className="p-4 hover:bg-gray-50 active:bg-gray-100"
            role="listitem"
          >
            {mobileRender ? (
              mobileRender(row)
            ) : (
              <div>
                {/* Primary info */}
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {columns.slice(0, 2).map((col) => (
                      <div key={col.key}>
                        {col.key === columns[0].key ? (
                          <p className="font-medium text-gray-900 truncate">
                            {col.render ? col.render((row as Record<string, unknown>)[col.key], row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-500">
                            {col.render ? col.render((row as Record<string, unknown>)[col.key], row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Actions menu */}
                  {actions.length > 0 && (
                    <div className="relative ml-2">
                      <button
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          setOpenMenu(openMenu === idx ? null : idx);
                        }}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        aria-label="Actions"
                      >
                        <MoreVertical className="w-5 h-5 text-gray-400" />
                      </button>

                      {openMenu === idx && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setOpenMenu(null)}
                          />
                          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border z-20 py-1">
                            {actions.map((action, i) => (
                              <button
                                key={i}
                                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                  e.stopPropagation();
                                  action.onClick(row);
                                  setOpenMenu(null);
                                }}
                                className={`
                                  w-full px-4 py-2 text-left text-sm flex items-center gap-2
                                  hover:bg-gray-50 ${action.className || ''}
                                `}
                              >
                                {action.icon && <action.icon className="w-4 h-4" />}
                                {action.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable details */}
                {columns.length > 2 && (
                  <>
                    <button
                      onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                      className="mt-2 text-sm text-gray-500 flex items-center gap-1"
                    >
                      {expandedRow === idx ? 'Less' : 'More'}
                      {expandedRow === idx ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>

                    {expandedRow === idx && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        {columns.slice(2).map((col) => (
                          <div key={col.key} className="flex justify-between text-sm">
                            <span className="text-gray-500">{col.label}</span>
                            <span className="font-medium">
                              {col.render ? col.render((row as Record<string, unknown>)[col.key], row) : ((row as Record<string, unknown>)[col.key] as React.ReactNode) || '-'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Desktop table view
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
              >
                {col.label}
              </th>
            ))}
            {actions.length > 0 && (
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((row, idx) => (
            <tr
              key={(row as Record<string, unknown>).id as string | number || idx}
              onClick={() => onRowClick?.(row)}
              className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-sm text-gray-900">
                  {col.render ? col.render((row as Record<string, unknown>)[col.key], row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                </td>
              ))}
              {actions.length > 0 && (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                          e.stopPropagation();
                          action.onClick(row);
                        }}
                        className={`p-1.5 rounded hover:bg-gray-100 ${action.className || ''}`}
                        title={action.label}
                      >
                        {action.icon && <action.icon className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default ResponsiveTable;
