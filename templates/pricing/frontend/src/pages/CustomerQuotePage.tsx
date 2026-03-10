import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import SignaturePad from '../components/signature/SignaturePad';

interface CustomerQuoteData {
  id: string;
  companyName: string;
  companyLogo?: string;
  customerName: string;
  repName: string;
  repPhone?: string;
  repEmail?: string;
  products: Array<{
    name: string;
    tier: string;
    tierLabel: string;
    addons: Array<{ name: string; price: number }>;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  totalPrice: number;
  monthlyEstimate?: number;
  expiresAt?: string;
  inflationData?: Array<{ year: number; cost: number }>;
  tierExplanations?: Record<string, string>;
  status: string;
}

export default function CustomerQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [quote, setQuote] = useState<CustomerQuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSignature, setShowSignature] = useState(false);
  const [customerSignature, setCustomerSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [readySubmitted, setReadySubmitted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get(`/api/quotes/customer/${token}`);
        setQuote(data);
      } catch (err: any) {
        setError(err.message || 'This quote link is invalid or has expired.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const expiryCountdown = useMemo(() => {
    if (!quote?.expiresAt) return null;
    const expires = new Date(quote.expiresAt);
    const now = new Date();
    const diff = expires.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} remaining`;
    return `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  }, [quote?.expiresAt]);

  async function handleReadyToMove() {
    try {
      await api.post(`/api/quotes/customer/${token}/ready`, {});
      setReadySubmitted(true);
    } catch {
      // Silently handle
    }
  }

  async function handleRemoteSign() {
    if (!customerSignature) return;
    setSubmitting(true);
    try {
      await api.post(`/api/quotes/customer/${token}/sign`, {
        customerSignatureSvg: customerSignature,
        deviceFingerprint: JSON.stringify({
          userAgent: navigator.userAgent,
          screenWidth: screen.width,
          screenHeight: screen.height,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Quote Unavailable</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!quote) return null;

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Signature Received!</h2>
          <p className="text-gray-600">
            Thank you, {quote.customerName}. Your representative will be in touch with next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header / Branding */}
      <div className="bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          {quote.companyLogo ? (
            <img src={quote.companyLogo} alt={quote.companyName} className="h-10 object-contain" />
          ) : (
            <h1 className="text-xl font-bold text-gray-900">{quote.companyName}</h1>
          )}
          {expiryCountdown && (
            <span
              className={`text-sm font-semibold px-3 py-1.5 rounded-full ${
                expiryCountdown === 'Expired'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {expiryCountdown}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Greeting */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">
            Hi {quote.customerName},
          </h2>
          <p className="text-gray-600">
            Here's your personalized quote from {quote.repName} at {quote.companyName}.
          </p>
        </div>

        {/* Products */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Your Quote</h3>

          <div className="space-y-4">
            {quote.products.map((product, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="font-bold text-gray-900 text-lg">{product.name}</h4>
                    <span className="inline-block mt-1 px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                      {product.tierLabel}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-gray-900">${product.lineTotal.toLocaleString()}</p>
                    {product.quantity > 1 && (
                      <p className="text-sm text-gray-500">${product.unitPrice.toLocaleString()} x {product.quantity}</p>
                    )}
                  </div>
                </div>

                {product.addons.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="text-sm font-medium text-gray-500 mb-1">Includes:</p>
                    <div className="space-y-1">
                      {product.addons.map((addon, j) => (
                        <div key={j} className="flex justify-between text-sm">
                          <span className="text-gray-600">{addon.name}</span>
                          {addon.price > 0 && (
                            <span className="text-gray-700 font-medium">+${addon.price.toLocaleString()}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="mt-6 border-t-2 border-gray-200 pt-4">
            <div className="flex justify-between items-center">
              <span className="text-xl font-bold text-gray-900">Total Investment</span>
              <span className="text-3xl font-black text-blue-600">${quote.totalPrice.toLocaleString()}</span>
            </div>
            {quote.monthlyEstimate && (
              <p className="text-right text-sm text-gray-500 mt-1">
                Est. ${quote.monthlyEstimate.toLocaleString()}/mo with financing
              </p>
            )}
          </div>
        </div>

        {/* Tier Explanations */}
        {quote.tierExplanations && Object.keys(quote.tierExplanations).length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">About Your Pricing</h3>
            <div className="space-y-4">
              {Object.entries(quote.tierExplanations).map(([tier, explanation]) => (
                <div key={tier} className="border-l-4 border-blue-400 pl-4">
                  <h4 className="font-bold text-gray-800 mb-1">{tier}</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">{explanation}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Inflation Chart */}
        {quote.inflationData && quote.inflationData.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Cost Over Time</h3>
            <p className="text-sm text-gray-600 mb-4">
              Based on industry inflation trends, here's how the cost of this project changes over time.
            </p>
            <div className="space-y-2">
              {quote.inflationData.map((point, i) => {
                const maxCost = Math.max(...quote.inflationData!.map((d) => d.cost));
                const pct = (point.cost / maxCost) * 100;
                const isFirst = i === 0;
                return (
                  <div key={point.year} className="flex items-center gap-3">
                    <span className="w-12 text-sm font-semibold text-gray-600 text-right">{point.year}</span>
                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                      <div
                        className={`h-full rounded-lg transition-all ${
                          isFirst ? 'bg-green-500' : 'bg-red-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={`w-24 text-sm font-bold text-right ${isFirst ? 'text-green-700' : 'text-red-600'}`}>
                      ${point.cost.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contact Info */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-3">Your Representative</h3>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-xl font-bold text-blue-600">
                {quote.repName.split(' ').map((n) => n[0]).join('')}
              </span>
            </div>
            <div>
              <p className="font-bold text-gray-900">{quote.repName}</p>
              {quote.repPhone && <p className="text-sm text-gray-600">{quote.repPhone}</p>}
              {quote.repEmail && <p className="text-sm text-gray-600">{quote.repEmail}</p>}
            </div>
          </div>
        </div>

        {/* CTA */}
        {!readySubmitted && !showSignature && expiryCountdown !== 'Expired' && (
          <div className="space-y-3 mb-6">
            <button
              onClick={handleReadyToMove}
              className="w-full py-5 bg-green-600 text-white text-xl font-black rounded-xl hover:bg-green-700 transition-colors shadow-lg min-h-[64px]"
            >
              I'm Ready to Move Forward
            </button>
            <button
              onClick={() => setShowSignature(true)}
              className="w-full py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[56px]"
            >
              Sign Contract Remotely
            </button>
          </div>
        )}

        {readySubmitted && !showSignature && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-green-800 mb-1">We've Notified Your Rep!</h3>
            <p className="text-green-700 text-sm">
              {quote.repName} will reach out to you shortly to discuss next steps.
            </p>
            <button
              onClick={() => setShowSignature(true)}
              className="mt-4 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[48px]"
            >
              Or Sign Contract Now
            </button>
          </div>
        )}

        {/* Remote Signature */}
        {showSignature && (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Sign Contract</h3>
            <SignaturePad
              onEnd={(svg) => setCustomerSignature(svg)}
              label="Your signature"
            />
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSignature(false)}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoteSign}
                disabled={!customerSignature || submitting}
                className="flex-1 py-4 bg-green-600 text-white text-lg font-bold rounded-xl hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                {submitting ? 'Submitting...' : 'Submit Signature'}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-6 text-sm text-gray-400">
          <p>Powered by {quote.companyName}</p>
        </div>
      </div>
    </div>
  );
}
