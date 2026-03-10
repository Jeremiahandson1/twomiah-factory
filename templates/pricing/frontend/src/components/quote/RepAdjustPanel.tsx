import React, { useState } from 'react';
import { api } from '../../services/api';

interface RepAdjustPanelProps {
  quoteId: string;
  currentPrice: number;
  maxDiscountPercent: number;
  open: boolean;
  onClose: () => void;
  onApplied: (newPrice: number) => void;
}

export default function RepAdjustPanel({
  quoteId,
  currentPrice,
  maxDiscountPercent,
  open,
  onClose,
  onApplied,
}: RepAdjustPanelProps) {
  const [mode, setMode] = useState<'price' | 'percent'>('percent');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [newPrice, setNewPrice] = useState(currentPrice);
  const [reason, setReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const effectiveNewPrice = mode === 'percent'
    ? currentPrice * (1 - discountPercent / 100)
    : newPrice;

  const effectiveDiscount = mode === 'percent'
    ? discountPercent
    : ((currentPrice - newPrice) / currentPrice) * 100;

  const needsManagerPin = effectiveDiscount > maxDiscountPercent;

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const handleApply = async () => {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    if (needsManagerPin && !managerPin.trim()) {
      setError('Manager PIN is required for this discount level');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/api/quotes/${quoteId}/adjust-price`, {
        new_price: Math.round(effectiveNewPrice * 100) / 100,
        discount_percent: Math.round(effectiveDiscount * 100) / 100,
        reason,
        manager_pin: needsManagerPin ? managerPin : undefined,
      });
      onApplied(effectiveNewPrice);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to apply adjustment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-[70] transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Price Adjustment</h2>
            <button
              type="button"
              onClick={onClose}
              className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Current price */}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm text-gray-500 font-medium">Current Price</p>
              <p className="text-3xl font-bold text-gray-900">{fmt(currentPrice)}</p>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('percent')}
                className={`flex-1 py-3 rounded-xl font-semibold transition-colors min-h-[48px] ${
                  mode === 'percent'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                % Discount
              </button>
              <button
                type="button"
                onClick={() => setMode('price')}
                className={`flex-1 py-3 rounded-xl font-semibold transition-colors min-h-[48px] ${
                  mode === 'price'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                New Price
              </button>
            </div>

            {/* Input */}
            {mode === 'percent' ? (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Discount %</label>
                <input
                  type="number"
                  value={discountPercent || ''}
                  onChange={(e) => setDiscountPercent(parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500"
                  min={0}
                  max={100}
                  step={0.5}
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">New Price</label>
                <input
                  type="number"
                  value={newPrice || ''}
                  onChange={(e) => setNewPrice(parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-4 text-2xl font-bold border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500"
                  min={0}
                  step={1}
                />
              </div>
            )}

            {/* Guardrail indicator */}
            <div className={`rounded-xl p-4 ${effectiveDiscount > maxDiscountPercent ? 'bg-red-50 border-2 border-red-300' : 'bg-green-50 border-2 border-green-300'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">Max Discount Allowed</span>
                <span className="text-lg font-bold">{maxDiscountPercent}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 mt-2">
                <div
                  className={`h-3 rounded-full transition-all ${
                    effectiveDiscount > maxDiscountPercent ? 'bg-red-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, (effectiveDiscount / Math.max(maxDiscountPercent, 1)) * 100)}%` }}
                />
              </div>
              <p className="text-sm mt-1 font-semibold">
                Your discount: {effectiveDiscount.toFixed(1)}%
                {effectiveDiscount > maxDiscountPercent && (
                  <span className="text-red-600 ml-2">Exceeds limit - Manager PIN required</span>
                )}
              </p>
            </div>

            {/* New price preview */}
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-sm text-blue-600 font-medium">New Price</p>
              <p className="text-3xl font-bold text-blue-800">{fmt(effectiveNewPrice)}</p>
              <p className="text-sm text-blue-600">
                Saving customer {fmt(currentPrice - effectiveNewPrice)}
              </p>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 min-h-[100px] resize-none"
                placeholder="Why is this adjustment needed?"
              />
            </div>

            {/* Manager PIN */}
            {needsManagerPin && (
              <div>
                <label className="block text-sm font-semibold text-red-700 mb-1">
                  Manager PIN <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  className="w-full px-4 py-4 text-2xl font-bold border-2 border-red-300 rounded-xl focus:outline-none focus:border-red-500 text-center tracking-[0.5em]"
                  maxLength={6}
                  placeholder="------"
                />
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-100 text-red-800 rounded-xl text-base font-medium">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200">
            <button
              type="button"
              onClick={handleApply}
              disabled={submitting}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400 text-white font-bold text-lg rounded-xl transition-colors min-h-[56px]"
            >
              {submitting ? 'Applying...' : 'Apply Adjustment'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
