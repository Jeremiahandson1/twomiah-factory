import { forwardRef, useId } from 'react';
import { ChevronDown, AlertCircle } from 'lucide-react';

const AccessibleSelect = forwardRef(({
  label,
  error,
  helperText,
  required = false,
  options = [],
  placeholder = 'Select...',
  className = '',
  containerClassName = '',
  ...props
}, ref) => {
  const id = useId();
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  const hasError = Boolean(error);

  return (
    <div className={containerClassName}>
      {label && (
        <label 
          htmlFor={id}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
          {required && <span className="sr-only">(required)</span>}
        </label>
      )}
      
      <div className="relative">
        <select
          ref={ref}
          id={id}
          required={required}
          aria-required={required}
          aria-invalid={hasError}
          aria-describedby={[
            hasError ? errorId : null,
            helperText ? helperId : null,
          ].filter(Boolean).join(' ') || undefined}
          className={`
            w-full px-3 py-2 pr-10 border rounded-lg appearance-none
            transition-colors duration-200
            focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
            ${hasError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300'}
            ${className}
          `}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
          {hasError ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {hasError && (
        <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      
      {helperText && !hasError && (
        <p id={helperId} className="mt-1 text-sm text-gray-500">
          {helperText}
        </p>
      )}
    </div>
  );
});

AccessibleSelect.displayName = 'AccessibleSelect';

export default AccessibleSelect;
