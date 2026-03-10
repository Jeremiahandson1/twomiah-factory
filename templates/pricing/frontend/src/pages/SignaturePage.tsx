import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import SignaturePad from '../components/signature/SignaturePad';

interface QuoteData {
  id: string;
  customerName: string;
  contractHtml: string;
  contractTemplateId: string;
  rescissionDays: number;
  products: Array<{
    name: string;
    tier: string;
    price: number;
    quantity: number;
  }>;
  totalPrice: number;
}

type Step = 'rescission' | 'contract' | 'customer-sig' | 'rep-sig' | 'confirmation';

const STEPS: Step[] = ['rescission', 'contract', 'customer-sig', 'rep-sig', 'confirmation'];

export default function SignaturePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('rescission');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [rescissionAcknowledged, setRescissionAcknowledged] = useState(false);
  const [contractRead, setContractRead] = useState(false);
  const [customerSignatureSvg, setCustomerSignatureSvg] = useState('');
  const [repSignatureSvg, setRepSignatureSvg] = useState('');

  useEffect(() => {
    async function fetchQuote() {
      try {
        const data = await api.get(`/api/quotes/${id}/signing`);
        setQuote(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load quote');
      } finally {
        setLoading(false);
      }
    }
    fetchQuote();
  }, [id]);

  const currentStepIndex = STEPS.indexOf(step);

  function goNext() {
    if (currentStepIndex < STEPS.length - 1) {
      setStep(STEPS[currentStepIndex + 1]);
    }
  }

  function goBack() {
    if (currentStepIndex > 0) {
      setStep(STEPS[currentStepIndex - 1]);
    }
  }

  function getDeviceFingerprint(): string {
    return JSON.stringify({
      userAgent: navigator.userAgent,
      screenWidth: screen.width,
      screenHeight: screen.height,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
    });
  }

  async function handleSubmitSignatures() {
    if (!quote) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post(`/api/quotes/${id}/sign`, {
        customerSignatureSvg,
        repSignatureSvg,
        contractTemplateId: quote.contractTemplateId,
        deviceFingerprint: getDeviceFingerprint(),
      });
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to submit signatures');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-gray-600">Loading contract...</p>
        </div>
      </div>
    );
  }

  if (error && !quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const stepIndicator = (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              i <= currentStepIndex
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-8 h-1 mx-1 rounded ${
                i < currentStepIndex ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        {stepIndicator}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Step 1: Right of Rescission */}
        {step === 'rescission' && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <div className="bg-yellow-50 border-2 border-yellow-400 rounded-xl p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-yellow-400 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-7 h-7 text-yellow-900" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-black text-gray-900 mb-4">
                    NOTICE OF RIGHT TO CANCEL
                  </h1>
                  <p className="text-xl md:text-2xl font-bold text-gray-800 leading-relaxed">
                    You have the right to cancel this contract within{' '}
                    <span className="text-red-600 underline">{quote.rescissionDays} days</span>{' '}
                    of signing without penalty.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-5 mb-6 text-gray-700 leading-relaxed">
              <p className="mb-3">
                Under your state's Right of Rescission law, you may cancel this contract for any reason
                within <strong>{quote.rescissionDays} business days</strong> from the date you sign.
              </p>
              <p className="mb-3">
                To cancel, you must provide written notice to the seller. If you cancel, any payments
                made will be returned within 10 business days.
              </p>
              <p>
                This is your legal right and it cannot be waived.
              </p>
            </div>

            <label className="flex items-start gap-4 p-4 bg-blue-50 rounded-xl cursor-pointer border-2 border-transparent hover:border-blue-300 transition-colors mb-6">
              <input
                type="checkbox"
                checked={rescissionAcknowledged}
                onChange={(e) => setRescissionAcknowledged(e.target.checked)}
                className="w-7 h-7 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5 flex-shrink-0"
              />
              <span className="text-lg font-semibold text-gray-800">
                I acknowledge that I have been informed of my right to cancel this contract
                within {quote.rescissionDays} days of signing.
              </span>
            </label>

            <button
              onClick={goNext}
              disabled={!rescissionAcknowledged}
              className="w-full py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
            >
              Continue to Contract Review
            </button>
          </div>
        )}

        {/* Step 2: Contract Review */}
        {step === 'contract' && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Contract Review</h2>

            <div className="border-2 border-gray-200 rounded-xl p-5 mb-6 max-h-[50vh] overflow-y-auto">
              <div
                className="prose prose-lg max-w-none"
                dangerouslySetInnerHTML={{ __html: quote.contractHtml }}
              />
            </div>

            <div className="bg-gray-50 rounded-xl p-5 mb-6">
              <h3 className="font-bold text-gray-900 mb-3">Quote Summary</h3>
              <div className="space-y-2">
                {quote.products.map((p, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-200 last:border-0">
                    <div>
                      <span className="font-semibold text-gray-800">{p.name}</span>
                      {p.tier && <span className="ml-2 text-sm text-gray-500">({p.tier})</span>}
                      {p.quantity > 1 && <span className="ml-2 text-sm text-gray-500">x{p.quantity}</span>}
                    </div>
                    <span className="font-bold text-gray-900">${p.price.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300">
                  <span className="text-lg font-bold text-gray-900">Total</span>
                  <span className="text-xl font-black text-blue-600">${quote.totalPrice.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <label className="flex items-start gap-4 p-4 bg-blue-50 rounded-xl cursor-pointer border-2 border-transparent hover:border-blue-300 transition-colors mb-6">
              <input
                type="checkbox"
                checked={contractRead}
                onChange={(e) => setContractRead(e.target.checked)}
                className="w-7 h-7 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5 flex-shrink-0"
              />
              <span className="text-lg font-semibold text-gray-800">
                I have read the contract in full and agree to all terms and conditions.
              </span>
            </label>

            <div className="flex gap-3">
              <button
                onClick={goBack}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Back
              </button>
              <button
                onClick={goNext}
                disabled={!contractRead}
                className="flex-1 py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                Sign Contract
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Customer Signature */}
        {step === 'customer-sig' && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Customer Signature</h2>
            <p className="text-gray-600 mb-6">
              <strong>{quote.customerName}</strong>, please sign below to acknowledge your agreement.
            </p>

            <SignaturePad
              onEnd={(svg) => setCustomerSignatureSvg(svg)}
              label="Customer signs here"
            />

            <div className="flex gap-3 mt-6">
              <button
                onClick={goBack}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Back
              </button>
              <button
                onClick={goNext}
                disabled={!customerSignatureSvg}
                className="flex-1 py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                Continue to Rep Signature
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Rep Signature */}
        {step === 'rep-sig' && (
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Sales Representative Signature</h2>
            <p className="text-gray-600 mb-6">
              Representative, please sign below to confirm this agreement.
            </p>

            <SignaturePad
              onEnd={(svg) => setRepSignatureSvg(svg)}
              label="Representative signs here"
            />

            <div className="flex gap-3 mt-6">
              <button
                onClick={goBack}
                className="flex-1 py-4 bg-gray-200 text-gray-700 text-lg font-bold rounded-xl hover:bg-gray-300 transition-colors min-h-[56px]"
              >
                Back
              </button>
              <button
                onClick={handleSubmitSignatures}
                disabled={!repSignatureSvg || submitting}
                className="flex-1 py-4 bg-green-600 text-white text-lg font-bold rounded-xl hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors min-h-[56px]"
              >
                {submitting ? 'Submitting...' : 'Submit Signatures'}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Confirmation */}
        {step === 'confirmation' && (
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-3">Contract Signed Successfully</h2>
            <p className="text-lg text-gray-600 mb-8 max-w-md mx-auto">
              Thank you, {quote.customerName}. Your signed contract has been recorded
              and a copy will be sent to your email.
            </p>

            <div className="bg-gray-50 rounded-xl p-6 mb-8 text-left max-w-md mx-auto">
              <h3 className="font-bold text-gray-900 mb-3">Next Steps</h3>
              <ul className="space-y-2 text-gray-700">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">1</span>
                  <span>You'll receive a copy of the signed contract via email.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">2</span>
                  <span>Process the deposit payment to secure your order.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">3</span>
                  <span>Our team will contact you to schedule your installation.</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => navigate(`/quotes/${id}/payment`)}
              className="w-full max-w-md py-4 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 transition-colors min-h-[56px]"
            >
              Proceed to Payment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
