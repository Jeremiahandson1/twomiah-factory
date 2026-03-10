import React, { useState } from 'react';

type Tier = 'good' | 'better' | 'best';
type PriceColumn = 'retail' | 'yr1' | 'day30' | 'today';

interface TierMaterial {
  name: string;
  features: string[];
  costPerUnit: number;
  manufacturer: string;
  productLine: string;
  warrantyYears: number;
}

interface AddonLine {
  id: string;
  name: string;
  price: number;
  pricingType: string;
}

interface EstimateLine {
  id: string;
  productName: string;
  category: string;
  measurement: number;
  measurementUnit: string;
  wasteFactor: number;
  effectiveMeasurement: number;
  pitch: string | null;
  pitchMultiplier: number;
  tiers: Record<Tier, TierMaterial>;
  addons: AddonLine[];
  prices: Record<Tier, {
    materialsCost: number;
    laborCost: number;
    addonsCost: number;
    retailPrice: number;
    yr1Price: number;
    day30Price: number;
    todayPrice: number;
  }>;
}

interface Props {
  lines: EstimateLine[];
  role: 'rep' | 'manager' | 'admin';
  selectedTier: Tier;
  onTierChange: (tier: Tier) => void;
  revealedColumns: PriceColumn[];
  onExportPdf?: () => void;
}

const UNIT_LABELS: Record<string, string> = {
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  squares: 'squares',
  count: 'units',
};

const TIER_LABELS: Record<Tier, { label: string; color: string; bg: string; border: string }> = {
  good: { label: 'Good', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-500' },
  better: { label: 'Better', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-500' },
  best: { label: 'Best', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-500' },
};

const PRICE_COL_LABELS: Record<PriceColumn, string> = {
  retail: 'Retail',
  yr1: '1-Year',
  day30: '30-Day',
  today: 'Today',
};

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getPriceForColumn(prices: EstimateLine['prices'][Tier], col: PriceColumn): number {
  switch (col) {
    case 'retail': return prices.retailPrice;
    case 'yr1': return prices.yr1Price;
    case 'day30': return prices.day30Price;
    case 'today': return prices.todayPrice;
  }
}

export default function EstimateBreakdown({
  lines,
  role,
  selectedTier,
  onTierChange,
  revealedColumns,
  onExportPdf,
}: Props) {
  const [swipeStart, setSwipeStart] = useState<number | null>(null);
  const tiers: Tier[] = ['good', 'better', 'best'];
  const isManager = role === 'manager' || role === 'admin';

  const handleSwipeStart = (x: number) => setSwipeStart(x);
  const handleSwipeEnd = (x: number) => {
    if (swipeStart === null) return;
    const diff = x - swipeStart;
    const idx = tiers.indexOf(selectedTier);
    if (diff < -50 && idx < 2) onTierChange(tiers[idx + 1]);
    if (diff > 50 && idx > 0) onTierChange(tiers[idx - 1]);
    setSwipeStart(null);
  };

  const grandTotals = tiers.reduce((acc, tier) => {
    acc[tier] = lines.reduce(
      (sums, line) => {
        const p = line.prices[tier];
        return {
          materials: sums.materials + p.materialsCost,
          labor: sums.labor + p.laborCost,
          addons: sums.addons + p.addonsCost,
          retail: sums.retail + p.retailPrice,
          yr1: sums.yr1 + p.yr1Price,
          day30: sums.day30 + p.day30Price,
          today: sums.today + p.todayPrice,
        };
      },
      { materials: 0, labor: 0, addons: 0, retail: 0, yr1: 0, day30: 0, today: 0 }
    );
    return acc;
  }, {} as Record<Tier, { materials: number; labor: number; addons: number; retail: number; yr1: number; day30: number; today: number }>);

  const totals = grandTotals[selectedTier];
  const unit = UNIT_LABELS;

  return (
    <div className="space-y-6">
      {/* Tier Selector */}
      <div
        className="flex rounded-xl overflow-hidden border-2 border-gray-200"
        onTouchStart={e => handleSwipeStart(e.touches[0].clientX)}
        onTouchEnd={e => handleSwipeEnd(e.changedTouches[0].clientX)}
      >
        {tiers.map(tier => {
          const t = TIER_LABELS[tier];
          const active = selectedTier === tier;
          return (
            <button
              key={tier}
              onClick={() => onTierChange(tier)}
              className={`flex-1 h-[56px] text-lg font-bold transition-all
                ${active
                  ? `${t.bg} ${t.color} border-b-4 ${t.border}`
                  : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Line Items */}
      <div className="space-y-4">
        {lines.map(line => {
          const prices = line.prices[selectedTier];
          const tierMat = line.tiers[selectedTier];
          const wastePercent = Math.round((line.wasteFactor - 1) * 100);
          const unitLabel = unit[line.measurementUnit] || line.measurementUnit;

          return (
            <div key={line.id} className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h4 className="font-bold text-lg text-gray-900">{line.productName}</h4>
                <p className="text-sm text-gray-500 mt-0.5">
                  {line.measurement.toLocaleString()} {unitLabel}
                  {wastePercent > 0 && (
                    <span> (+ {wastePercent}% waste = {Math.round(line.measurement * line.wasteFactor).toLocaleString()} {unitLabel})</span>
                  )}
                </p>
                {line.pitch && (
                  <p className="text-sm text-gray-500">
                    {line.pitch} pitch ({line.pitchMultiplier.toFixed(2)}x)
                  </p>
                )}
              </div>

              <div className="px-5 py-4 space-y-3">
                {/* Material info */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{tierMat.name}</p>
                    <p className="text-sm text-gray-500">
                      {tierMat.manufacturer} - {tierMat.productLine}
                    </p>
                    {tierMat.warrantyYears > 0 && (
                      <p className="text-sm text-gray-500">{tierMat.warrantyYears}-year warranty</p>
                    )}
                    {tierMat.features.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {tierMat.features.map((f, i) => (
                          <span key={i} className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Cost breakdown (manager only) */}
                {isManager && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Materials</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(prices.materialsCost)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Labor</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(prices.laborCost)}</span>
                    </div>
                    {prices.addonsCost > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Add-ons</span>
                        <span className="font-semibold text-gray-900">{formatCurrency(prices.addonsCost)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Addons */}
                {line.addons.length > 0 && (
                  <div className="space-y-1">
                    {line.addons.map(addon => (
                      <div key={addon.id} className="flex justify-between text-sm">
                        <span className="text-gray-600">+ {addon.name}</span>
                        <span className="font-medium text-gray-700">{formatCurrency(addon.price)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Price columns */}
                <div className="pt-3 border-t border-gray-100">
                  <div className="grid grid-cols-4 gap-2">
                    {(['retail', 'yr1', 'day30', 'today'] as PriceColumn[]).map(col => {
                      const revealed = revealedColumns.includes(col);
                      const price = getPriceForColumn(prices, col);
                      return (
                        <div key={col} className="text-center">
                          <p className="text-xs text-gray-500 mb-1">{PRICE_COL_LABELS[col]}</p>
                          {revealed ? (
                            <p className={`text-base font-bold ${col === 'today' ? 'text-green-700' : 'text-gray-900'}`}>
                              {formatCurrency(price)}
                            </p>
                          ) : (
                            <div className="h-6 bg-gray-200 rounded-md animate-pulse" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Grand Total */}
      <div className="bg-white rounded-2xl border-2 border-gray-900 overflow-hidden">
        <div className="px-5 py-4 bg-gray-900">
          <h3 className="text-xl font-bold text-white">Grand Total — {TIER_LABELS[selectedTier].label}</h3>
        </div>
        <div className="px-5 py-5 space-y-3">
          {isManager && (
            <>
              <div className="flex justify-between text-base">
                <span className="text-gray-600">Materials Total</span>
                <span className="font-bold text-gray-900">{formatCurrency(totals.materials)}</span>
              </div>
              <div className="flex justify-between text-base">
                <span className="text-gray-600">Labor Total</span>
                <span className="font-bold text-gray-900">{formatCurrency(totals.labor)}</span>
              </div>
              {totals.addons > 0 && (
                <div className="flex justify-between text-base">
                  <span className="text-gray-600">Add-ons Total</span>
                  <span className="font-bold text-gray-900">{formatCurrency(totals.addons)}</span>
                </div>
              )}
              <div className="flex justify-between text-base border-t border-gray-200 pt-3">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-bold text-gray-900">
                  {formatCurrency(totals.materials + totals.labor + totals.addons)}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-3" />
            </>
          )}

          {/* Price columns for grand total */}
          <div className="grid grid-cols-4 gap-3">
            {(['retail', 'yr1', 'day30', 'today'] as PriceColumn[]).map(col => {
              const revealed = revealedColumns.includes(col);
              const price = col === 'retail' ? totals.retail
                : col === 'yr1' ? totals.yr1
                : col === 'day30' ? totals.day30
                : totals.today;
              return (
                <div key={col} className="text-center">
                  <p className="text-sm text-gray-500 mb-1">{PRICE_COL_LABELS[col]}</p>
                  {revealed ? (
                    <p className={`text-xl font-bold ${col === 'today' ? 'text-green-700' : 'text-gray-900'}`}>
                      {formatCurrency(price)}
                    </p>
                  ) : (
                    <div className="h-7 bg-gray-200 rounded-md animate-pulse" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Export PDF */}
      {onExportPdf && (
        <button
          onClick={onExportPdf}
          className="w-full h-[56px] bg-gray-100 hover:bg-gray-200 active:bg-gray-300
                     text-gray-700 text-lg font-semibold rounded-xl border-2 border-gray-300
                     transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export PDF
        </button>
      )}
    </div>
  );
}
