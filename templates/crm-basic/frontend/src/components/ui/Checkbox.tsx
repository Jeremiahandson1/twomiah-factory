import React from 'react';
import clsx from 'clsx';
import { Check } from 'lucide-react';

export function Checkbox({ 
  checked, 
  onChange, 
  label, 
  description,
  disabled,
  className 
}) {
  return (
    <label className={clsx(
      'flex items-start gap-3 cursor-pointer group',
      disabled && 'opacity-50 cursor-not-allowed',
      className
    )}>
      <div className="relative flex-shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />
        <div className={clsx(
          'w-5 h-5 rounded border-2 transition-all duration-200',
          'flex items-center justify-center',
          checked 
            ? 'bg-brand-500 border-brand-500' 
            : 'bg-slate-800 border-slate-600 group-hover:border-slate-500'
        )}>
          {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
        </div>
      </div>
      {(label || description) && (
        <div className="flex-1">
          {label && (
            <span className="text-sm font-medium text-slate-200 group-hover:text-white">
              {label}
            </span>
          )}
          {description && (
            <p className="text-sm text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
      )}
    </label>
  );
}

export function Toggle({ 
  checked, 
  onChange, 
  label, 
  description,
  disabled,
  size = 'md',
  className 
}) {
  const sizes = {
    sm: { track: 'w-8 h-4', thumb: 'w-3 h-3', translate: 'translate-x-4' },
    md: { track: 'w-11 h-6', thumb: 'w-5 h-5', translate: 'translate-x-5' },
    lg: { track: 'w-14 h-7', thumb: 'w-6 h-6', translate: 'translate-x-7' },
  };

  const s = sizes[size];

  return (
    <label className={clsx(
      'flex items-center gap-3 cursor-pointer',
      disabled && 'opacity-50 cursor-not-allowed',
      className
    )}>
      <div className="relative flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />
        <div className={clsx(
          s.track,
          'rounded-full transition-colors duration-200',
          checked ? 'bg-brand-500' : 'bg-slate-700'
        )} />
        <div className={clsx(
          s.thumb,
          'absolute top-0.5 left-0.5 bg-white rounded-full shadow transition-transform duration-200',
          checked && s.translate
        )} />
      </div>
      {(label || description) && (
        <div>
          {label && <span className="text-sm font-medium text-slate-200">{label}</span>}
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
      )}
    </label>
  );
}
