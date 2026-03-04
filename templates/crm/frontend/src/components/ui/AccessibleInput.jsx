import { forwardRef, useId } from 'react';
import { AlertCircle } from 'lucide-react';

const AccessibleInput = forwardRef(({
  label,
  error,
  helperText,
  required = false,
  type = 'text',
  className = '',
  containerClassName = '',
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
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
        {LeftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
            <LeftIcon className="w-5 h-5" />
          </div>
        )}
        
        <input
          ref={ref}
          id={id}
          type={type}
          required={required}
          aria-required={required}
          aria-invalid={hasError}
          aria-describedby={[
            hasError ? errorId : null,
            helperText ? helperId : null,
          ].filter(Boolean).join(' ') || undefined}
          className={`
            w-full px-3 py-2 border rounded-lg
            transition-colors duration-200
            focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500
            disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
            ${LeftIcon ? 'pl-10' : ''}
            ${RightIcon || hasError ? 'pr-10' : ''}
            ${hasError ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300'}
            ${className}
          `}
          {...props}
        />
        
        {(RightIcon || hasError) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true">
            {hasError ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : RightIcon ? (
              <RightIcon className="w-5 h-5 text-gray-400" />
            ) : null}
          </div>
        )}
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

AccessibleInput.displayName = 'AccessibleInput';

export default AccessibleInput;
