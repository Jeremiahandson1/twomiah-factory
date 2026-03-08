import React from 'react';
import clsx from 'clsx';

export function Card({ children, className, ...props }) {
  return (
    <div className={clsx('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className, title, subtitle, action }) {
  if (title || subtitle || action) {
    return (
      <div className={clsx('card-header flex items-center justify-between', className)}>
        <div>
          {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
          {subtitle && <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
    );
  }
  return <div className={clsx('card-header', className)}>{children}</div>;
}

export function CardBody({ children, className }) {
  return <div className={clsx('card-body', className)}>{children}</div>;
}

export function StatCard({ label, value, icon: Icon, trend, trendUp, className }) {
  return (
    <Card className={clsx('p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="stat-value">{value}</p>
          <p className="stat-label">{label}</p>
          {trend && (
            <p className={clsx(
              'text-xs mt-2',
              trendUp ? 'text-emerald-400' : 'text-red-400'
            )}>
              {trendUp ? '↑' : '↓'} {trend}
            </p>
          )}
        </div>
        {Icon && (
          <div className="p-2 bg-brand-500/10 rounded-lg">
            <Icon className="w-6 h-6 text-brand-400" />
          </div>
        )}
      </div>
    </Card>
  );
}
