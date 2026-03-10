import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

interface EstimateData {
  id: string;
  customerName: string;
  lines: {
    productName: string;
    features: string[];
    retailPrice: number;
    yr1Price: number;
    day30Price: number;
    todayPrice: number;
  }[];
  totals: {
    retailPrice: number;
    yr1Price: number;
    day30Price: number;
    todayPrice: number;
  };
  tier: string;
}

type Screen =
  | 'inclusions'
  | 'apart'
  | 'inflation'
  | 'yr1-reveal'
  | 'day30-reveal'
  | 'today-explain'
  | 'today-reveal'
  | 'financing'
  | 'close';

const SCREENS: Screen[] = [
  'inclusions',
  'apart',
  'inflation',
  'yr1-reveal',
  'day30-reveal',
  'today-explain',
  'today-reveal',
  'financing',
  'close',
];

const SCREEN_TITLES: Record<Screen, string> = {
  inclusions: 'What\'s Included',
  apart: 'What Sets Us Apart',
  inflation: 'Why Act Now',
  'yr1-reveal': '1-Year Price',
  'day30-reveal': '30-Day Price',
  'today-explain': 'Buy Today',
  'today-reveal': 'Today\'s Price',
  financing: 'Financing Options',
  close: 'Your Options',
};

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function EstimatorPresentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentScreen, setCurrentScreen] = useState(0);
  const [showRepPanel, setShowRepPanel] = useState(false);
  const [adjustment, setAdjustment] = useState(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCountRef = useRef(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/api/estimator/estimates/${id}`);
        setEstimate(res.data);
        await api.put(`/api/estimator/estimates/${id}/status`, { status: 'presented' });
      } catch (err) {
        console.error('Failed to load estimate', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // 3-finger tap detection for RepAdjustPanel
  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 3) {
      tapCountRef.current += 1;
      if (tapCountRef.current >= 1) {
        setShowRepPanel(true);
        tapCountRef.current = 0;
      }
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0;
      }, 500);
    }
  }, []);

  const goNext = () => {
    if (currentScreen < SCREENS.length - 1) {
      setCurrentScreen(prev => prev + 1);
    }
  };

  const goPrev = () => {
    if (currentScreen > 0) {
      setCurrentScreen(prev => prev - 1);
    }
  };

  const screen = SCREENS[currentScreen];
  const progress = ((currentScreen + 1) / SCREENS.length) * 100;

  const applyAdjustment = (price: number) => price + adjustment;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-xl text-gray-400">Estimate not found</p>
      </div>
    );
  }

  const renderScreen = () => {
    switch (screen) {
      case 'inclusions':
        return (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">What's Included</h2>
            <p className="text-lg text-gray-300">Your {estimate.tier} tier estimate includes:</p>
            <div className="space-y-4">
              {estimate.lines.map((line, i) => (
                <div key={i} className="bg-white/10 backdrop-blur rounded-2xl p-5">
                  <h3 className="text-xl font-bold text-white mb-3">{line.productName}</h3>
                  {line.features.length > 0 && (
                    <ul className="space-y-2">
                      {line.features.map((f, j) => (
                        <li key={j} className="flex items-start gap-3 text-gray-200">
                          <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 'apart':
        return (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">What Sets Us Apart</h2>
            <div className="space-y-4">
              {[
                { icon: '🛡️', title: 'Industry-Leading Warranty', desc: 'We stand behind every installation with comprehensive coverage.' },
                { icon: '👷', title: 'Certified Installers', desc: 'Our crews are factory-certified and background-checked.' },
                { icon: '📋', title: 'Transparent Pricing', desc: 'No hidden fees. What you see is what you pay.' },
                { icon: '⭐', title: '5-Star Reviews', desc: 'Thousands of satisfied customers in your area.' },
                { icon: '🏠', title: 'Premium Materials', desc: 'We only use top-tier products from trusted manufacturers.' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4 bg-white/10 backdrop-blur rounded-2xl p-5">
                  <span className="text-3xl">{item.icon}</span>
                  <div>
                    <h3 className="text-lg font-bold text-white">{item.title}</h3>
                    <p className="text-gray-300 mt-1">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'inflation':
        return (
          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-white">Why Act Now</h2>
            <p className="text-lg text-gray-300">
              Material costs have increased significantly over the past few years and are projected to continue rising.
            </p>
            {/* Inflation chart placeholder - reuse InflationChart component */}
            <div className="bg-white/10 backdrop-blur rounded-2xl p-6">
              <div className="space-y-4">
                <div className="flex items-end gap-3 h-48">
                  {[
                    { year: '2021', pct: 40 },
                    { year: '2022', pct: 60 },
                    { year: '2023', pct: 72 },
                    { year: '2024', pct: 85 },
                    { year: '2025', pct: 93 },
                    { year: '2026', pct: 100 },
                  ].map((bar, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <div
                        className="w-full bg-gradient-to-t from-red-500 to-orange-400 rounded-t-lg transition-all duration-700"
                        style={{ height: `${bar.pct}%` }}
                      />
                      <span className="text-xs text-gray-400">{bar.year}</span>
                    </div>
                  ))}
                </div>
                <p className="text-center text-sm text-gray-400">Material Cost Index (Relative)</p>
              </div>
            </div>
            <p className="text-lg text-yellow-400 font-semibold text-center">
              Locking in today's price protects you from future increases.
            </p>
          </div>
        );

      case 'yr1-reveal':
        return (
          <div className="flex flex-col items-center justify-center space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">1-Year Price</h2>
            <p className="text-lg text-gray-300 text-center">
              This price is valid for one full year from today.
            </p>
            <div className="bg-white/10 backdrop-blur rounded-3xl p-8 text-center">
              <p className="text-6xl font-bold text-white">
                {formatCurrency(applyAdjustment(estimate.totals.yr1Price))}
              </p>
              <p className="text-gray-400 mt-3 text-lg">Valid for 12 months</p>
            </div>
          </div>
        );

      case 'day30-reveal':
        return (
          <div className="flex flex-col items-center justify-center space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">30-Day Price</h2>
            <p className="text-lg text-gray-300 text-center">
              Commit within the next 30 days and save.
            </p>
            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-5 text-center">
                <p className="text-sm text-gray-400">1-Year Price</p>
                <p className="text-2xl text-gray-500 line-through">
                  {formatCurrency(applyAdjustment(estimate.totals.yr1Price))}
                </p>
              </div>
              <div className="bg-white/10 backdrop-blur rounded-3xl p-8 text-center border-2 border-blue-500">
                <p className="text-6xl font-bold text-white">
                  {formatCurrency(applyAdjustment(estimate.totals.day30Price))}
                </p>
                <p className="text-blue-400 mt-3 text-lg font-semibold">
                  Save {formatCurrency(estimate.totals.yr1Price - estimate.totals.day30Price)}
                </p>
              </div>
            </div>
          </div>
        );

      case 'today-explain':
        return (
          <div className="space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">Why Buy Today?</h2>
            <div className="space-y-4">
              {[
                'Lock in the absolute lowest price available',
                'Schedule your preferred installation date first',
                'Avoid future material cost increases',
                'Begin the permitting process immediately',
                'No additional trips or follow-up needed',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-4 bg-white/10 backdrop-blur rounded-2xl p-5">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-lg text-gray-200">{item}</p>
                </div>
              ))}
            </div>
          </div>
        );

      case 'today-reveal':
        return (
          <div className="flex flex-col items-center justify-center space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">Today's Price</h2>
            <div className="space-y-3 w-full max-w-md">
              <div className="flex justify-between bg-white/5 rounded-xl p-4">
                <span className="text-gray-400">1-Year</span>
                <span className="text-gray-500 line-through">{formatCurrency(applyAdjustment(estimate.totals.yr1Price))}</span>
              </div>
              <div className="flex justify-between bg-white/5 rounded-xl p-4">
                <span className="text-gray-400">30-Day</span>
                <span className="text-gray-500 line-through">{formatCurrency(applyAdjustment(estimate.totals.day30Price))}</span>
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 backdrop-blur
                            rounded-3xl p-8 text-center border-2 border-green-500 w-full max-w-md">
              <p className="text-sm text-green-400 font-semibold mb-2">BUY TODAY</p>
              <p className="text-6xl font-bold text-white">
                {formatCurrency(applyAdjustment(estimate.totals.todayPrice))}
              </p>
              <p className="text-green-400 mt-3 text-lg font-semibold">
                Save {formatCurrency(estimate.totals.yr1Price - estimate.totals.todayPrice)} from 1-year price
              </p>
            </div>
          </div>
        );

      case 'financing':
        return (
          <div className="space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">Financing Options</h2>
            <p className="text-lg text-gray-300 text-center">
              Make your project affordable with flexible payment plans.
            </p>
            <div className="space-y-4">
              {[
                {
                  title: 'Same-As-Cash',
                  term: '18 months',
                  desc: 'No interest if paid in full within 18 months.',
                  monthly: applyAdjustment(estimate.totals.todayPrice) / 18,
                },
                {
                  title: 'Low Monthly',
                  term: '120 months',
                  desc: 'Extended payment plan with low monthly payments.',
                  monthly: (applyAdjustment(estimate.totals.todayPrice) * 1.08) / 120,
                },
                {
                  title: 'Reduced Rate',
                  term: '60 months',
                  desc: 'Competitive rate with moderate monthly payments.',
                  monthly: (applyAdjustment(estimate.totals.todayPrice) * 1.05) / 60,
                },
              ].map((plan, i) => (
                <div key={i} className="bg-white/10 backdrop-blur rounded-2xl p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-white">{plan.title}</h3>
                      <p className="text-sm text-gray-400">{plan.term}</p>
                      <p className="text-gray-300 mt-1 text-sm">{plan.desc}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-white">
                        {formatCurrency(plan.monthly)}
                      </p>
                      <p className="text-sm text-gray-400">/month</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'close':
        return (
          <div className="space-y-8">
            <h2 className="text-3xl font-bold text-white text-center">Your Options</h2>
            <div className="space-y-4">
              <button
                onClick={() => navigate(`/estimator/${id}/sign`)}
                className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800
                           text-white rounded-2xl p-6 text-left transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-green-200 font-semibold">BEST VALUE</p>
                    <p className="text-2xl font-bold mt-1">Buy Today</p>
                    <p className="text-green-200 mt-1">Sign now and lock in your price</p>
                  </div>
                  <p className="text-3xl font-bold">{formatCurrency(applyAdjustment(estimate.totals.todayPrice))}</p>
                </div>
              </button>

              <div className="bg-white/10 backdrop-blur rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xl font-bold text-white">30-Day Price</p>
                    <p className="text-gray-300 mt-1">Decide within 30 days</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{formatCurrency(applyAdjustment(estimate.totals.day30Price))}</p>
                </div>
              </div>

              <div className="bg-white/5 rounded-2xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xl font-bold text-gray-400">1-Year Price</p>
                    <p className="text-gray-500 mt-1">Valid for 12 months</p>
                  </div>
                  <p className="text-2xl font-bold text-gray-400">{formatCurrency(applyAdjustment(estimate.totals.yr1Price))}</p>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div
      className="min-h-screen bg-gray-900 flex flex-col"
      onTouchStart={handleTouch}
    >
      {/* Progress Bar */}
      <div className="h-1.5 bg-gray-800">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {currentScreen + 1} / {SCREENS.length}
        </p>
        <p className="text-sm text-gray-500 font-medium">
          {SCREEN_TITLES[screen]}
        </p>
        <button
          onClick={() => navigate(`/estimator/${id}`)}
          className="min-w-[48px] min-h-[48px] flex items-center justify-center
                     text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-4 overflow-y-auto">
        <div className="max-w-xl mx-auto">
          {renderScreen()}
        </div>
      </div>

      {/* Navigation */}
      <div className="px-6 py-5 flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={currentScreen === 0}
          className="min-w-[48px] min-h-[48px] px-6 rounded-xl font-semibold
                     text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
        >
          Back
        </button>
        {currentScreen < SCREENS.length - 1 && (
          <button
            onClick={goNext}
            className="min-w-[48px] min-h-[56px] px-8 bg-blue-600 hover:bg-blue-700
                       active:bg-blue-800 text-white text-lg font-bold rounded-xl
                       shadow-lg transition-colors"
          >
            Next
          </button>
        )}
      </div>

      {/* Rep Adjust Panel */}
      {showRepPanel && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
             onClick={() => setShowRepPanel(false)}>
          <div
            className="bg-gray-800 rounded-t-3xl w-full max-w-lg p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Price Adjustment</h3>
              <button
                onClick={() => setShowRepPanel(false)}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-gray-400"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Adjust total by amount ($)</label>
              <input
                type="number"
                inputMode="numeric"
                value={adjustment || ''}
                onChange={e => setAdjustment(Number(e.target.value) || 0)}
                placeholder="0"
                className="w-full h-[56px] px-4 text-xl font-bold rounded-xl bg-gray-700 border-2
                           border-gray-600 text-white text-center outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[-500, -250, -100, 100, 250, 500].map(amt => (
                <button
                  key={amt}
                  onClick={() => setAdjustment(prev => prev + amt)}
                  className={`h-[48px] rounded-xl font-semibold text-sm transition-colors
                    ${amt < 0
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                >
                  {amt > 0 ? '+' : ''}{formatCurrency(amt)}
                </button>
              ))}
            </div>

            <button
              onClick={() => setAdjustment(0)}
              className="w-full h-[48px] bg-gray-700 text-gray-300 rounded-xl font-semibold
                         hover:bg-gray-600 transition-colors"
            >
              Reset to Original
            </button>

            <button
              onClick={() => setShowRepPanel(false)}
              className="w-full h-[56px] bg-blue-600 text-white rounded-xl font-bold text-lg
                         hover:bg-blue-700 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
