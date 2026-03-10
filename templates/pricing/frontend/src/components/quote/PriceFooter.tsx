import React from 'react';

interface PriceFooterProps {
  lineCount: number;
  subtotal: number;
  discount?: number;
  total: number;
  onAddProduct: () => void;
  onPresent: () => void;
  canPresent: boolean;
}

export default function PriceFooter({
  lineCount,
  subtotal,
  discount,
  total,
  onAddProduct,
  onPresent,
  canPresent,
}: PriceFooterProps) {
  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 text-white shadow-2xl border-t border-gray-700">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        {/* Left: totals */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Lines</p>
            <p className="text-2xl font-bold">{lineCount}</p>
          </div>
          <div className="w-px h-10 bg-gray-700" />
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Subtotal</p>
            <p className="text-lg font-semibold">{fmt(subtotal)}</p>
          </div>
          {discount && discount > 0 ? (
            <>
              <div className="w-px h-10 bg-gray-700" />
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Discount</p>
                <p className="text-lg font-semibold text-green-400">-{fmt(discount)}</p>
              </div>
            </>
          ) : null}
          <div className="w-px h-10 bg-gray-700" />
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total</p>
            <p className="text-3xl font-bold">{fmt(total)}</p>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onAddProduct}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-white font-semibold rounded-xl transition-colors min-h-[48px]"
          >
            + Add Product
          </button>
          <button
            type="button"
            onClick={onPresent}
            disabled={!canPresent}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold rounded-xl transition-colors min-h-[48px] text-lg"
          >
            Present to Customer
          </button>
        </div>
      </div>
    </div>
  );
}
