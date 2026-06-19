import React from 'react';
import clsx from 'clsx';

export function Table({ children, className }) {
  return (
    <div className="table-container">
      <table className={clsx('table', className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }) {
  return <thead>{children}</thead>;
}

export function TableBody({ children }) {
  return <tbody>{children}</tbody>;
}

export function TableRow({ children, className, onClick }) {
  return (
    <tr 
      className={clsx(onClick && 'cursor-pointer', className)} 
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function TableHeader({ children, className, ...props }) {
  return (
    <th className={className} {...props}>
      {children}
    </th>
  );
}

export function TableCell({ children, className, ...props }) {
  return (
    <td className={className} {...props}>
      {children}
    </td>
  );
}

// Empty state component
export function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action 
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && (
        <div className="p-4 bg-slate-800 rounded-full mb-4">
          <Icon className="w-8 h-8 text-slate-500" />
        </div>
      )}
      <h3 className="text-lg font-medium text-white mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-slate-400 max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  );
}

// Pagination component
export function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange 
}) {
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="btn btn-ghost px-3 py-1.5 text-sm disabled:opacity-30"
      >
        Previous
      </button>
      {pages.map((page) => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={clsx(
            'w-8 h-8 rounded-lg text-sm font-medium transition-colors',
            page === currentPage 
              ? 'bg-brand-500 text-white' 
              : 'text-slate-400 hover:bg-slate-800'
          )}
        >
          {page}
        </button>
      ))}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="btn btn-ghost px-3 py-1.5 text-sm disabled:opacity-30"
      >
        Next
      </button>
    </div>
  );
}
