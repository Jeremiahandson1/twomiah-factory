import React, { useRef } from 'react';

type Tier = 'best' | 'better' | 'good';

interface TierPrices {
  good: number;
  better: number;
  best: number;
}

interface TierSelectorProps {
  prices: TierPrices;
  selected: Tier;
  onChange: (tier: Tier) => void;
}

const TIER_CONFIG: { key: Tier; label: string; badge?: string }[] = [
  { key: 'best', label: 'Best', badge: 'Recommended' },
  { key: 'better', label: 'Better' },
  { key: 'good', label: 'Good' },
];

export default function TierSelector({ prices, selected, onChange }: TierSelectorProps) {
  const touchStartX = useRef<number | null>(null);
  const currentIndex = TIER_CONFIG.findIndex((t) => t.key === selected);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    const threshold = 50;
    if (Math.abs(diff) > threshold) {
      if (diff < 0 && currentIndex < TIER_CONFIG.length - 1) {
        onChange(TIER_CONFIG[currentIndex + 1].key);
      } else if (diff > 0 && currentIndex > 0) {
        onChange(TIER_CONFIG[currentIndex - 1].key);
      }
    }
    touchStartX.current = null;
  };

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  return (
    <div
      className="grid grid-cols-3 gap-3"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {TIER_CONFIG.map((tier) => {
        const isActive = selected === tier.key;
        return (
          <button
            key={tier.key}
            type="button"
            onClick={() => onChange(tier.key)}
            className={`relative flex flex-col items-center justify-center p-4 rounded-xl border-3 transition-all min-h-[100px] active:scale-95 ${
              isActive
                ? 'border-blue-600 bg-blue-50 shadow-lg ring-2 ring-blue-200'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            {tier.badge && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 text-xs font-bold bg-blue-600 text-white rounded-full whitespace-nowrap">
                {tier.badge}
              </span>
            )}
            <span
              className={`text-sm font-semibold uppercase tracking-wide ${
                isActive ? 'text-blue-700' : 'text-gray-500'
              }`}
            >
              {tier.label}
            </span>
            <span
              className={`text-2xl font-bold mt-1 ${
                isActive ? 'text-blue-800' : 'text-gray-800'
              }`}
            >
              {fmt(prices[tier.key])}
            </span>
          </button>
        );
      })}
    </div>
  );
}
