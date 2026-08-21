import React from 'react';
import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div className={clsx('card', className)} {...props}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function CardHeader({ children, className, title, subtitle, action }: CardHeaderProps) {
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

interface CardBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function CardBody({ children, className }: CardBodyProps) {
  return <div className={clsx('card-body', className)}>{children}</div>;
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, trend, trendUp, className }: StatCardProps) {
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
              {trendUp ? '\u2191' : '\u2193'} {trend}
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
