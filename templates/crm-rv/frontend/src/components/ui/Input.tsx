import React from 'react';
import clsx from 'clsx';
import { LucideIcon } from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  className?: string;
  icon?: LucideIcon;
}

export function Input({
  label,
  error,
  className,
  icon: Icon,
  ...props
}: InputProps) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
        )}
        <input
          className={clsx(
            'input',
            Icon && 'pl-11',
            error && 'border-red-500 focus:ring-red-500'
          )}
          {...props}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  className?: string;
  rows?: number;
}

export function Textarea({
  label,
  error,
  className,
  rows = 4,
  ...props
}: TextareaProps) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <textarea
        rows={rows}
        className={clsx(
          'input resize-none',
          error && 'border-red-500 focus:ring-red-500'
        )}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  className?: string;
  options?: SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  error,
  className,
  options = [],
  placeholder,
  ...props
}: SelectProps) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      <select
        className={clsx(
          'input appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%236b7280\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'%3E%3C/path%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[right_0.75rem_center] bg-no-repeat pr-10',
          error && 'border-red-500 focus:ring-red-500'
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}
