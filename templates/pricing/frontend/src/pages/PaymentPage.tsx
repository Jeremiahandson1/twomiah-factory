import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';

interface QuoteSummary {
  id: string;
  customerName: string;
  customerEmail: string;
  products: Array<{ name: string; tier: string; price: number; quantity: number }>;
  totalPrice: number;
  depositAmount: number;
  depositPercent: number;
}

interface FinancingResult {
  status: 'pending' | 'approved' | 'declined';
  lender?: string;
  apr?: number;
  termMonths?: number;
  monthlyPayment?: number;
  approvedAmount?: number;
}

type PaymentStep = 'options' | 'financing' | 'card' | 'receipt';

export default function PaymentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [quote, setQuote] = useState<QuoteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState<PaymentStep>('options');
  const [financing, setFinancing] = useState<FinancingResult | null>(null);
  const [applyingFinancing, setApplyingFinancing] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get(`/api/quotes/${id}/payment`);
        setQuote(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load payment details');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleApplyFinancing() {
    setApplyingFinancing(true);
    setError('');
    try {
      const result = await api.post(`/api/financing/apply`, { quoteId: id });
      setFinancing(result);
      setStep('financing');
    } catch (err: any) {
      setError(err.message || 'Financing application failed');
    } finally {
      setApplyingFinancing(false);
    }
  }

  async function handlePayDeposit() {
    setPaymentProcessing(true);
    setError('');
    try {
      await api.post(`/api/quotes/${id}/pay-deposit`, { method: 'card' });
      setStep('receipt');
    } catch (err: any) {
      setError(err.message || 'Payment processing failed');
    } finally {
      setPaymentProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-lg p-8 text-center max-w-md">
          <p className="text-red-600 font-medium">{error || 'Quote not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Quote Summary Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Payment</h1>
            <span className="text-sm text-gray-500">Quote #{quote.id.slice(0, 8)}</span>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-500 mb-1">Customer</p>
            <p className="font-semibold text-gray-900">{quote.customerName}</p>
            <p className="text-sm text-gray-600">{quote.customerEmail}</p>
          </div>

          <div className="space-y-2 mb-4">
            {quote.products.map((p, i) => (
              <div key={i} className="flex justify-between items-center py-1.5">
                <span className="text-gray-700">
                  {p.name} {p.tier && `(${p.tier})`} {p.quantity > 1 && `x${p.quantity}`}
                </span>
                <span className="font-semibold">${p.price.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div className="border-t-2 border-gray-200 pt-3 flex justify-between items-center">
            <span className="text-lg font-bold text-gray-900">Total</span>
            <span className="text-xl font-black text-gray-900">${quote.totalPrice.toLocaleString()}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Payment Options */}
        {step === 'options' && (
          <div className="space-y-4">
            <div className="bg-blue-600 rounded-xl shadow-lg p-6 text-white">
              <p className="text-sm font-medium text-blue-200 mb-1">Deposit Due Today</p>
              <p className="text-4xl font-black mb-1">${quote.depositAmount.toLocaleString()}</p>
              <p className="text-blue-200 text-sm">{quote.depositPercent}% of total</p>
            </div>

            <button
              onClick={handleApplyFinancing}
              disabled={applyingFinancing}
              className="w-full bg-white rounded-xl shadow-lg p-6 text-left hover:bg-gray-50 transition-colors border-2 border-transparent hover:border-blue-300 min-h-[80px]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Apply for Financing</h3>
                  <p className="text-gray-600 text-sm mt-1">Check available monthly payment options</p>
                </div>
                {applyingFinancing ? (
                  <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </div>
            </button>

            <button
              onClick={() => setStep('card')}
              className="w-full bg-white rounded-xl shadow-lg p-6 text-left hover:bg-gray-50 transition-colors border-2 border-transparent hover:border-green-300 min-h-[80px]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Pay Deposit by Card</h3>
                  <p className="text-gray-600 text-sm mt-1">Visa, Mastercard, Amex accepted</p>
                </div>
                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
            </button>
          </div>
        )}

        {/* Financing Results */}
        {step === 'financing' && financing && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            {financing.status === 'pending' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">Application Processing</h2>
                <p className="text-gray-600">We're reviewing your financing application...</p>
              </div>
            )}

            {financing.status === 'approved' && (
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-green-700">Approved!</h2>
                    <p className="text-sm text-gray-500">via {financing.lender}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Approved Amount</p>
                    <p className="text-xl font-bold text-gray-900">${financing.approvedAmount?.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">APR</p>
                    <p className="text-xl font-bold text-gray-900">{financing.apr}%</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Term</p>
                    <p className="text-xl font-bold text-gray-900">{financing.termMonths} months</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <p className="text-sm text-blue-600">Monthly Payment</p>
                    <p className="text-xl font-black text-blue-700">${financing.monthlyPayment?.toLocaleString()}/mo</p>
                  </div>
                </div>

                <button
                  onClick={() => setStep('receipt')}
                  className="w-full py-4 bg-green-600 text-white text-lg font-bold rounded-xl hover:bg-green-700 transition-colors min-h-[56px]"
                >
                  Accept Financing Terms
                </button>
              </div>
            )}

            {financing.status === 'declined' && (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Let's Talk About Payment Options</h2>
                <p className="text-gray-600 mb-6 max-w-md mx-auto">
                  The financing application wasn't approved this time, but we have other flexible payment
                  options available. Let's discuss what works best for you.
                </p>
                <button
                  onClick={() => setStep('options')}
                  className="px-8 py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[56px]"
                >
                  View Other Options
                </button>
              </div>
            )}

            {financing.status !== 'declined' && (
              <button
                onClick={() => setStep('options')}
                className="w-full mt-4 py-3 text-gray-600 font-semibold hover:text-gray-900 transition-colors min-h-[48px]"
              >
                Back to Payment Options
              </button>
            )}
          </div>
        )}

        {/* Card Payment */}
        {step === 'card' && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Pay Deposit by Card</h2>

            <div className="bg-blue-50 rounded-lg p-4 mb-6 flex items-center justify-between">
              <span className="font-medium text-blue-900">Amount to Pay</span>
              <span className="text-2xl font-black text-blue-700">${quote.depositAmount.toLocaleString()}</span>
            </div>

            {/* Card form placeholder */}
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 mb-6 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              <p className="text-gray-500 font-medium">Card payment integration</p>
              <p className="text-gray-400 text-sm mt-1">Stripe Elements will be embedded here</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('options')}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Back
              </button>
              <button
                onClick={handlePayDeposit}
                disabled={paymentProcessing}
                className="flex-1 py-4 bg-green-600 text-white text-lg font-bold rounded-xl hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                {paymentProcessing ? 'Processing...' : `Pay $${quote.depositAmount.toLocaleString()}`}
              </button>
            </div>
          </div>
        )}

        {/* Receipt */}
        {step === 'receipt' && (
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-3">Payment Received!</h2>
            <p className="text-lg text-gray-600 mb-6">
              Deposit of <strong>${quote.depositAmount.toLocaleString()}</strong> has been processed successfully.
            </p>

            <div className="bg-gray-50 rounded-xl p-5 mb-6 text-left max-w-md mx-auto">
              <h3 className="font-bold text-gray-900 mb-3">Receipt Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="font-semibold">{quote.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Deposit Amount</span>
                  <span className="font-semibold">${quote.depositAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Remaining Balance</span>
                  <span className="font-semibold">${(quote.totalPrice - quote.depositAmount).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 max-w-md mx-auto">
              <p className="text-blue-800 text-sm font-medium">
                Commission record has been created for this sale.
              </p>
            </div>

            <button
              onClick={() => navigate('/quotes')}
              className="w-full max-w-md py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[56px]"
            >
              Back to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
