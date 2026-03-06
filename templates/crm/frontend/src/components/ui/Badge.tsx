import React from 'react';
import clsx from 'clsx';

const variants = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  default: 'bg-slate-700 text-slate-300',
};

export function Badge({ children, variant = 'default', className, dot }) {
  return (
    <span className={clsx('badge', variants[variant], className)}>
      {dot && (
        <span className={clsx(
          'w-1.5 h-1.5 rounded-full mr-1.5',
          variant === 'success' && 'bg-emerald-400',
          variant === 'warning' && 'bg-amber-400',
          variant === 'danger' && 'bg-red-400',
          variant === 'info' && 'bg-blue-400',
          variant === 'default' && 'bg-slate-400',
        )} />
      )}
      {children}
    </span>
  );
}

// Status badge with predefined mappings
const statusMap = {
  // Job/Project statuses
  draft: { label: 'Draft', variant: 'default' },
  pending: { label: 'Pending', variant: 'warning' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  in_progress: { label: 'In Progress', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  on_hold: { label: 'On Hold', variant: 'warning' },
  
  // Quote statuses
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  expired: { label: 'Expired', variant: 'default' },
  
  // Invoice statuses
  paid: { label: 'Paid', variant: 'success' },
  overdue: { label: 'Overdue', variant: 'danger' },
  partial: { label: 'Partial', variant: 'warning' },
  
  // RFI statuses
  open: { label: 'Open', variant: 'warning' },
  responded: { label: 'Responded', variant: 'info' },
  closed: { label: 'Closed', variant: 'success' },
  
  // Contact types
  client: { label: 'Client', variant: 'info' },
  subcontractor: { label: 'Subcontractor', variant: 'warning' },
  vendor: { label: 'Vendor', variant: 'default' },
  lead: { label: 'Lead', variant: 'success' },
};

export function StatusBadge({ status, className }) {
  const config = statusMap[status] || { label: status, variant: 'default' };
  return (
    <Badge variant={config.variant} className={className} dot>
      {config.label}
    </Badge>
  );
}
