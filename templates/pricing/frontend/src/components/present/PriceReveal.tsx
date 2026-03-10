import React, { useState } from 'react';

interface PriceRevealProps {
  price: number;
  label: string;
  comparisonPrice?: number;
  comparisonLabel?: string;
  explanationText?: string;
  accentColor?: string;
}

export default function PriceReveal({
  price,
  label,
  comparisonPrice,
  comparisonLabel,
  explanationText,
  accentColor = 'text-white',
}: PriceRevealProps) {
  const [revealed, setRevealed] = useState(false);

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const savings = comparisonPrice ? comparisonPrice - price : 0;

  return (
    <div
      className="flex flex-col items-center justify-center cursor-pointer select-none"
      onClick={() => { if (!revealed) setRevealed(true); }}
    >
      {!revealed ? (
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="w-20 h-20 rounded-full border-4 border-white/40 flex items-center justify-center">
            <svg className="w-10 h-10 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <p className="text-2xl font-semibold text-white/70">Tap to reveal</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 animate-[scaleIn_0.5s_ease-out]">
          <p className="text-xl font-medium text-white/70 uppercase tracking-wider">{label}</p>
          <p className={`text-7xl font-black ${accentColor} drop-shadow-lg`}>
            {fmt(price)}
          </p>
          {comparisonPrice && comparisonPrice > price && (
            <div className="mt-2 px-6 py-2 bg-green-500/20 rounded-full">
              <p className="text-xl font-bold text-green-300">
                Save {fmt(savings)} {comparisonLabel ? `vs ${comparisonLabel}` : ''}
              </p>
            </div>
          )}
          {explanationText && (
            <p className="mt-4 text-lg text-white/70 max-w-xl text-center leading-relaxed">
              {explanationText}
            </p>
          )}
        </div>
      )}

      <style>{`
        @keyframes scaleIn {
          0% { opacity: 0; transform: scale(0.7); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
