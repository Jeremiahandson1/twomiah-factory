import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';
import InflationChart from '../components/present/InflationChart';
import PriceReveal from '../components/present/PriceReveal';
import RepAdjustPanel from '../components/quote/RepAdjustPanel';

/* ─── Types ─── */

interface QuotePresentation {
  id: string;
  customer_name: string;
  product_name: string;
  product_image_url?: string;
  inclusions: string[];
  warranty_info: string;
  features: string[];
  credibility_content: string;
  resource_items: { type: 'image' | 'video'; url: string; title: string }[];
  prices: {
    yr1: number;
    day30: number;
    today: number;
  };
  total: number;
  max_discount_percent: number;
  settings: {
    inflation_framing_text?: string;
    yr1_explanation?: string;
    day30_explanation?: string;
    today_explanation?: string;
    financing_explanation?: string;
  };
}

const TOTAL_SCREENS = 9;

export default function PresentModePage() {
  const { id: quoteId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<QuotePresentation | null>(null);
  const [currentScreen, setCurrentScreen] = useState(1);
  const [featureIndex, setFeatureIndex] = useState(0);
  const [selectedTerm, setSelectedTerm] = useState(60);
  const [adjustPanelOpen, setAdjustPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load presentation data
  useEffect(() => {
    if (!quoteId) return;
    const load = async () => {
      try {
        const res = await api.get(`/api/quotes/${quoteId}/present`);
        setData(res.data);
      } catch (err) {
        console.error('Failed to load presentation', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [quoteId]);

  // Fullscreen + landscape lock
  useEffect(() => {
    try {
      document.documentElement.requestFullscreen?.();
    } catch {}
    try {
      (screen.orientation as any)?.lock?.('landscape');
    } catch {}
    return () => {
      try { document.exitFullscreen?.(); } catch {}
      try { (screen.orientation as any)?.unlock?.(); } catch {}
    };
  }, []);

  // 3-finger tap for adjust panel
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        setAdjustPanelOpen(true);
      }
    };
    document.addEventListener('touchstart', handler, { passive: false });
    return () => document.removeEventListener('touchstart', handler);
  }, []);

  const advanceScreen = useCallback(() => {
    // On screen 1, advance features first
    if (currentScreen === 1 && data && featureIndex < data.features.length) {
      setFeatureIndex((prev) => prev + 1);
      return;
    }
    if (currentScreen < TOTAL_SCREENS) {
      setCurrentScreen((prev) => prev + 1);
      setFeatureIndex(0);
    }
  }, [currentScreen, featureIndex, data]);

  const goBack = () => {
    if (currentScreen > 1) {
      setCurrentScreen((prev) => prev - 1);
      setFeatureIndex(0);
    }
  };

  const fmt = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center text-white text-2xl">
        Failed to load presentation data
      </div>
    );
  }

  const monthlyPayment = Math.round(data.prices.today / selectedTerm);

  /* ─── Screen renderers ─── */

  const renderScreen = () => {
    switch (currentScreen) {
      /* SCREEN 1 - Inclusions */
      case 1:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12 text-center">
            {data.product_image_url && (
              <img
                src={data.product_image_url}
                alt={data.product_name}
                className="w-64 h-48 object-cover rounded-2xl mb-8 shadow-2xl"
              />
            )}
            <h1 className="text-5xl font-black text-white mb-8">{data.product_name}</h1>

            <div className="grid grid-cols-2 gap-4 max-w-3xl w-full">
              {data.features.slice(0, featureIndex).map((feat, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl px-5 py-4 animate-[fadeSlideUp_0.4s_ease-out]"
                >
                  <svg className="w-6 h-6 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-lg text-white font-medium">{feat}</span>
                </div>
              ))}
            </div>

            {featureIndex >= data.features.length && (
              <div className="mt-8 bg-white/10 backdrop-blur rounded-xl px-8 py-4 animate-[fadeSlideUp_0.4s_ease-out]">
                <p className="text-lg text-white/80">{data.warranty_info}</p>
              </div>
            )}

            {featureIndex < data.features.length && (
              <p className="absolute bottom-20 text-white/40 text-base">Tap to reveal next feature</p>
            )}
          </div>
        );

      /* SCREEN 2 - What Sets Us Apart */
      case 2:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <h2 className="text-5xl font-black text-white mb-10">What Sets Us Apart</h2>
            <p className="text-xl text-white/80 max-w-3xl text-center leading-relaxed mb-10">
              {data.credibility_content}
            </p>
            {data.resource_items.length > 0 && (
              <div className="flex gap-6 flex-wrap justify-center">
                {data.resource_items.map((item, i) => (
                  <div key={i} className="w-60 rounded-2xl overflow-hidden bg-white/10 backdrop-blur">
                    {item.type === 'image' ? (
                      <img src={item.url} alt={item.title} className="w-full h-36 object-cover" />
                    ) : (
                      <video src={item.url} className="w-full h-36 object-cover" controls />
                    )}
                    <p className="p-3 text-sm text-white font-medium">{item.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      /* SCREEN 3 - The Honest Conversation */
      case 3:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <h2 className="text-4xl font-black text-white mb-2">Let me show you something real</h2>
            <p className="text-lg text-white/60 mb-8">
              {data.settings.inflation_framing_text || 'The cost of home improvement has changed dramatically.'}
            </p>
            <div className="w-full max-w-4xl">
              <InflationChart />
            </div>
          </div>
        );

      /* SCREEN 4 - 1 Year Price */
      case 4:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <PriceReveal
              price={data.prices.yr1}
              label="1-Year Price"
              explanationText={data.settings.yr1_explanation || 'Based on projected material and labor costs over the next 12 months, this is what this project would cost a year from now.'}
            />
          </div>
        );

      /* SCREEN 5 - 30 Day Price */
      case 5:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <PriceReveal
              price={data.prices.day30}
              label="30-Day Price"
              comparisonPrice={data.prices.yr1}
              comparisonLabel="1-Year Price"
              explanationText={data.settings.day30_explanation || 'By scheduling within the next 30 days, we can lock in current material pricing and plan our crew schedule efficiently.'}
            />
          </div>
        );

      /* SCREEN 6 - Buy Today Explanation */
      case 6:
        return (
          <div className="flex flex-col items-center justify-center h-full px-16">
            <p className="text-3xl text-white font-medium leading-relaxed max-w-4xl text-center">
              {data.settings.today_explanation ||
                "We're busier than we've ever been and we're proud of that \u2014 it means our customers trust us. But every return trip to a home costs us time we could spend on someone else's project. That's the one cost we can't control. So for customers who know we're the right company and this is the right product for their home \u2014 we reward that decision with a savings. There's no pressure here. Take all the time you need. But if you're ready today, we pass that savings on to you because it saves us money too."}
            </p>
          </div>
        );

      /* SCREEN 7 - Buy Today Price */
      case 7:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <PriceReveal
              price={data.prices.today}
              label="Today's Price"
              comparisonPrice={data.prices.yr1}
              comparisonLabel="1-Year Price"
              accentColor="text-green-400"
            />
            <div className="mt-6 flex gap-4">
              <div className="px-6 py-3 bg-green-500/20 rounded-full">
                <p className="text-lg font-bold text-green-300">
                  Save {fmt(data.prices.yr1 - data.prices.today)} vs 1-Year
                </p>
              </div>
              <div className="px-6 py-3 bg-green-500/20 rounded-full">
                <p className="text-lg font-bold text-green-300">
                  Save {fmt(data.prices.day30 - data.prices.today)} vs 30-Day
                </p>
              </div>
            </div>
            <p className="mt-6 text-xl text-white/60">
              As low as {fmt(Math.round(data.prices.today / 60))}/mo with financing
            </p>
          </div>
        );

      /* SCREEN 8 - Financing */
      case 8: {
        const terms = [12, 24, 60, 120];
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <h2 className="text-4xl font-black text-white mb-3">
              Here's what that looks like per month
            </h2>
            <p className="text-lg text-white/60 mb-10">
              {data.settings.financing_explanation || 'Simple monthly payments that fit your budget.'}
            </p>

            <div className="flex gap-4 mb-10">
              {terms.map((term) => (
                <button
                  key={term}
                  onClick={(e) => { e.stopPropagation(); setSelectedTerm(term); }}
                  className={`px-8 py-4 rounded-xl font-bold text-lg transition-all min-h-[56px] ${
                    selectedTerm === term
                      ? 'bg-blue-600 text-white shadow-lg scale-105'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {term} mo
                </button>
              ))}
            </div>

            <div className="text-center">
              <p className="text-white/60 text-xl mb-2">Monthly Payment</p>
              <p className="text-7xl font-black text-white">{fmt(monthlyPayment)}</p>
              <p className="text-white/40 text-base mt-2">/month for {selectedTerm} months</p>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/quote/${quoteId}/financing`); }}
              className="mt-10 px-12 py-5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xl font-bold rounded-2xl transition-colors min-h-[60px]"
            >
              Apply Now
            </button>
          </div>
        );
      }

      /* SCREEN 9 - Close */
      case 9:
        return (
          <div className="flex flex-col items-center justify-center h-full px-12">
            <h2 className="text-4xl font-black text-white mb-12">
              Which works better for you?
            </h2>

            <div className="flex gap-6 mb-8">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseSelection('day30');
                }}
                className="flex flex-col items-center px-12 py-8 bg-white/10 hover:bg-white/20 backdrop-blur rounded-2xl border-2 border-white/20 transition-all min-w-[240px] active:scale-95"
              >
                <span className="text-lg text-white/60 font-medium mb-2">30-Day Price</span>
                <span className="text-4xl font-black text-white">{fmt(data.prices.day30)}</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseSelection('today');
                }}
                className="flex flex-col items-center px-12 py-8 bg-green-600/30 hover:bg-green-600/40 backdrop-blur rounded-2xl border-2 border-green-400/60 transition-all min-w-[240px] active:scale-95 ring-2 ring-green-400/30"
              >
                <span className="text-lg text-green-300 font-medium mb-2">Today's Price</span>
                <span className="text-5xl font-black text-green-300">{fmt(data.prices.today)}</span>
              </button>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCloseSelection('think');
              }}
              className="text-white/40 hover:text-white/60 text-base font-medium underline transition-colors py-4 min-h-[48px]"
            >
              I'd like to think about it
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  const [showThinkPanel, setShowThinkPanel] = useState(false);

  const handleCloseSelection = async (choice: 'day30' | 'today' | 'think') => {
    if (choice === 'think') {
      setShowThinkPanel(true);
      try {
        await api.post(`/api/quotes/${quoteId}/status`, { status: 'pending_followup' });
      } catch {}
      return;
    }
    try {
      await api.post(`/api/quotes/${quoteId}/status`, {
        status: 'accepted',
        selected_price: choice,
      });
    } catch {}
    navigate(`/quote/${quoteId}/sign`);
  };

  const handleSendLink = async () => {
    try {
      await api.post(`/api/quotes/${quoteId}/send-link`);
    } catch {}
    navigate(`/quotes`);
  };

  return (
    <div
      className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 overflow-hidden select-none"
      onClick={advanceScreen}
    >
      {/* Screen content */}
      <div className="w-full h-full">
        {renderScreen()}
      </div>

      {/* Navigation hint - left edge */}
      {currentScreen > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goBack(); }}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-12 h-24 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-r-xl transition-colors"
        >
          <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Progress dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2">
        {Array.from({ length: TOTAL_SCREENS }, (_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full transition-all ${
              i + 1 === currentScreen
                ? 'bg-white scale-125'
                : i + 1 < currentScreen
                ? 'bg-white/50'
                : 'bg-white/20'
            }`}
          />
        ))}
      </div>

      {/* Exit button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          try { document.exitFullscreen?.(); } catch {}
          navigate(`/quote/${quoteId}`);
        }}
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Think about it panel */}
      {showThinkPanel && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-800 rounded-3xl p-10 max-w-lg text-center shadow-2xl">
            <h3 className="text-3xl font-bold text-white mb-4">No problem at all</h3>
            <p className="text-lg text-white/70 mb-8">
              Would you like us to send you a link to review the quote at your convenience?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleSendLink}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl transition-colors min-h-[56px]"
              >
                Send Quote Link
              </button>
              <button
                onClick={() => navigate(`/quotes`)}
                className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-medium text-lg rounded-xl transition-colors min-h-[56px]"
              >
                Done for Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rep Adjust Panel (3-finger tap) */}
      <RepAdjustPanel
        quoteId={quoteId || ''}
        currentPrice={data.prices.today}
        maxDiscountPercent={data.max_discount_percent || 15}
        open={adjustPanelOpen}
        onClose={() => setAdjustPanelOpen(false)}
        onApplied={(newPrice) => {
          setData((prev) => prev ? {
            ...prev,
            prices: { ...prev.prices, today: newPrice },
          } : prev);
        }}
      />

      <style>{`
        @keyframes fadeSlideUp {
          0% { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
