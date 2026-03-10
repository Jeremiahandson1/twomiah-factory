import React from 'react';

interface Addon {
  id: string;
  name: string;
  price: number;
  price_type: 'flat' | 'per_unit';
  image_url?: string;
  required?: boolean;
  depends_on?: string;
}

interface AddonCardProps {
  addon: Addon;
  active: boolean;
  quantity: number;
  disabled?: boolean;
  onToggle: () => void;
  onQuantityChange: (qty: number) => void;
}

export default function AddonCard({
  addon,
  active,
  quantity,
  disabled = false,
  onToggle,
  onQuantityChange,
}: AddonCardProps) {
  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

  return (
    <div
      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
        disabled
          ? 'opacity-50 pointer-events-none border-gray-200 bg-gray-50'
          : active
          ? 'border-blue-600 bg-blue-50 shadow-md'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      {/* Required badge */}
      {addon.required && (
        <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-full uppercase">
          Required
        </span>
      )}

      {/* Image / placeholder */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full"
        disabled={disabled || addon.required}
      >
        {addon.image_url ? (
          <div className="w-full h-16 bg-gray-100">
            <img src={addon.image_url} alt={addon.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-full h-16 bg-gray-100 flex items-center justify-center">
            <span className="text-2xl text-gray-300">&#9632;</span>
          </div>
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-gray-800 leading-tight">{addon.name}</p>
          <p className="text-sm font-bold text-gray-600 mt-1">
            {fmt(addon.price)}
            {addon.price_type === 'per_unit' && (
              <span className="text-xs font-normal text-gray-400"> /unit</span>
            )}
          </p>
        </div>
      </button>

      {/* Quantity controls for per_unit addons when active */}
      {active && addon.price_type === 'per_unit' && (
        <div className="flex items-center justify-center gap-0 px-3 pb-3">
          <button
            type="button"
            onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
            className="flex items-center justify-center w-10 h-10 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 rounded-l-lg text-lg font-bold text-gray-700"
          >
            &minus;
          </button>
          <span className="flex items-center justify-center w-12 h-10 bg-white border-t border-b border-gray-200 text-lg font-bold text-gray-800">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => onQuantityChange(quantity + 1)}
            className="flex items-center justify-center w-10 h-10 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 rounded-r-lg text-lg font-bold text-gray-700"
          >
            +
          </button>
        </div>
      )}

      {/* Active check indicator */}
      {active && (
        <div className="absolute top-2 left-2 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}
