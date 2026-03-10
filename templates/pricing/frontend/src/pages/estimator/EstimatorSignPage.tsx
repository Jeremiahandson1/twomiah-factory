import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

type Step = 'rescission' | 'review' | 'customer-sign' | 'rep-sign' | 'confirmation';

const STEPS: Step[] = ['rescission', 'review', 'customer-sign', 'rep-sign', 'confirmation'];
const STEP_LABELS: Record<Step, string> = {
  rescission: 'Rescission Notice',
  review: 'Contract Review',
  'customer-sign': 'Customer Signature',
  'rep-sign': 'Rep Signature',
  confirmation: 'Confirmation',
};

interface EstimateData {
  id: string;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  tier: string;
  lines: {
    productName: string;
    measurement: number;
    measurementUnit: string;
    todayPrice: number;
  }[];
  totals: {
    todayPrice: number;
  };
}

function formatCurrency(amount: number): string {
  return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDeviceFingerprint(): string {
  const { userAgent, language, platform } = navigator;
  const screen = `${window.screen.width}x${window.screen.height}`;
  return btoa(`${userAgent}|${language}|${platform}|${screen}`).slice(0, 40);
}

export default function EstimatorSignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [rescissionAcknowledged, setRescissionAcknowledged] = useState(false);
  const [customerSig, setCustomerSig] = useState<string | null>(null);
  const [repSig, setRepSig] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const customerCanvasRef = useRef<HTMLCanvasElement>(null);
  const repCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/api/estimator/estimates/${id}`);
        setEstimate(res.data);
      } catch (err) {
        console.error('Failed to load estimate', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const step = STEPS[currentStep];

  const initCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  useEffect(() => {
    if (step === 'customer-sign') {
      setTimeout(() => initCanvas(customerCanvasRef.current), 100);
    } else if (step === 'rep-sign') {
      setTimeout(() => initCanvas(repCanvasRef.current), 100);
    }
  }, [step]);

  const getPos = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    e.preventDefault();
    drawingRef.current = true;
    lastPointRef.current = getPos(e, canvas);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent, canvas: HTMLCanvasElement) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    if (!ctx || !lastPointRef.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPointRef.current = pos;
  };

  const endDraw = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const clearCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const canvasToSvg = (canvas: HTMLCanvasElement | null): string | null => {
    if (!canvas) return null;
    // Export as data URL (simplified; production would trace paths to SVG)
    return canvas.toDataURL('image/png');
  };

  const handleCustomerSign = () => {
    const sig = canvasToSvg(customerCanvasRef.current);
    if (!sig) return;
    setCustomerSig(sig);
    setCurrentStep(prev => prev + 1);
  };

  const handleRepSign = () => {
    const sig = canvasToSvg(repCanvasRef.current);
    if (!sig) return;
    setRepSig(sig);
    handleSubmit(sig);
  };

  const handleSubmit = async (repSignature: string) => {
    if (!customerSig || !estimate) return;
    setSubmitting(true);
    try {
      await api.post(`/api/estimator/estimates/${id}/sign`, {
        customerSignature: customerSig,
        repSignature: repSignature,
        rescissionAcknowledged: true,
        ip: 'client', // Server determines actual IP
        deviceFingerprint: getDeviceFingerprint(),
        signedAt: new Date().toISOString(),
      });
      setSubmitted(true);
      setCurrentStep(STEPS.length - 1);
    } catch (err) {
      console.error('Failed to submit signature', err);
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = () => {
    if (step === 'rescission' && !rescissionAcknowledged) return;
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-xl text-gray-500">Estimate not found</p>
      </div>
    );
  }

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Progress */}
      <div className="h-1.5 bg-gray-200">
        <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Step indicator */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {currentStep > 0 && !submitted && (
            <button
              onClick={() => setCurrentStep(prev => prev - 1)}
              className="min-w-[48px] min-h-[48px] flex items-center justify-center rounded-xl
                         hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <p className="text-sm text-gray-500">Step {currentStep + 1} of {STEPS.length}</p>
            <h2 className="text-xl font-bold text-gray-900">{STEP_LABELS[step]}</h2>
          </div>
        </div>
        {!submitted && (
          <button
            onClick={() => navigate(`/estimator/${id}`)}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center text-gray-500
                       hover:text-gray-700 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {step === 'rescission' && (
            <div className="space-y-6">
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-yellow-900 mb-3">Notice of Right to Cancel</h3>
                <div className="text-yellow-800 space-y-3 text-base leading-relaxed">
                  <p>
                    You, the buyer, may cancel this transaction at any time prior to midnight of the
                    third business day after the date of this transaction. See the attached notice of
                    cancellation form for an explanation of this right.
                  </p>
                  <p>
                    To cancel this transaction, mail or deliver a signed and dated copy of the
                    cancellation notice, or any other written notice to the seller at the address shown
                    on the contract, no later than midnight of the third business day after you signed
                    the contract.
                  </p>
                  <p>
                    If you cancel, any property traded in, any payments made by you under the contract
                    or sale, and any negotiable instrument executed by you will be returned within 10
                    business days following receipt by the seller of your cancellation notice.
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setRescissionAcknowledged(true);
                  goNext();
                }}
                className={`w-full h-[56px] rounded-xl text-lg font-bold transition-colors flex items-center justify-center gap-3
                  ${rescissionAcknowledged
                    ? 'bg-green-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'}`}
              >
                {rescissionAcknowledged ? (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Acknowledged
                  </>
                ) : (
                  'I Acknowledge This Notice'
                )}
              </button>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border-2 border-gray-200 overflow-hidden">
                <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900">Contract Summary</h3>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Customer</p>
                      <p className="font-semibold text-gray-900">{estimate.customerName}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Phone</p>
                      <p className="font-semibold text-gray-900">{estimate.phone}</p>
                    </div>
                    {estimate.email && (
                      <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <p className="font-semibold text-gray-900">{estimate.email}</p>
                      </div>
                    )}
                    {estimate.address && (
                      <div>
                        <p className="text-sm text-gray-500">Address</p>
                        <p className="font-semibold text-gray-900">
                          {estimate.address}{estimate.state ? `, ${estimate.state}` : ''}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-gray-500">Tier</p>
                      <p className="font-semibold text-gray-900 capitalize">{estimate.tier}</p>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <h4 className="font-bold text-gray-900 mb-3">Line Items</h4>
                    <div className="space-y-3">
                      {estimate.lines.map((line, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                          <div>
                            <p className="font-semibold text-gray-900">{line.productName}</p>
                            <p className="text-sm text-gray-500">
                              {line.measurement.toLocaleString()} {line.measurementUnit.replace('_', ' ')}
                            </p>
                          </div>
                          <p className="font-bold text-gray-900">{formatCurrency(line.todayPrice)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t-2 border-gray-900 pt-4 flex items-center justify-between">
                    <p className="text-xl font-bold text-gray-900">Total</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(estimate.totals.todayPrice)}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={goNext}
                className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                           text-white text-lg font-bold rounded-xl shadow-lg transition-colors"
              >
                Proceed to Signature
              </button>
            </div>
          )}

          {step === 'customer-sign' && (
            <div className="space-y-6">
              <p className="text-lg text-gray-600">
                {estimate.customerName}, please sign below to confirm your agreement.
              </p>

              <div className="bg-white rounded-2xl border-2 border-gray-300 overflow-hidden">
                <canvas
                  ref={customerCanvasRef}
                  className="w-full h-[250px] touch-none cursor-crosshair"
                  onMouseDown={e => startDraw(e, customerCanvasRef.current!)}
                  onMouseMove={e => draw(e, customerCanvasRef.current!)}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={e => startDraw(e, customerCanvasRef.current!)}
                  onTouchMove={e => draw(e, customerCanvasRef.current!)}
                  onTouchEnd={endDraw}
                />
                <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between">
                  <p className="text-sm text-gray-400">Sign above</p>
                  <button
                    onClick={() => clearCanvas(customerCanvasRef.current)}
                    className="min-h-[48px] px-4 text-sm text-red-600 font-semibold hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <button
                onClick={handleCustomerSign}
                className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                           text-white text-lg font-bold rounded-xl shadow-lg transition-colors"
              >
                Accept & Continue
              </button>
            </div>
          )}

          {step === 'rep-sign' && (
            <div className="space-y-6">
              <p className="text-lg text-gray-600">
                Sales representative, please sign below to confirm.
              </p>

              <div className="bg-white rounded-2xl border-2 border-gray-300 overflow-hidden">
                <canvas
                  ref={repCanvasRef}
                  className="w-full h-[250px] touch-none cursor-crosshair"
                  onMouseDown={e => startDraw(e, repCanvasRef.current!)}
                  onMouseMove={e => draw(e, repCanvasRef.current!)}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={e => startDraw(e, repCanvasRef.current!)}
                  onTouchMove={e => draw(e, repCanvasRef.current!)}
                  onTouchEnd={endDraw}
                />
                <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between">
                  <p className="text-sm text-gray-400">Sign above</p>
                  <button
                    onClick={() => clearCanvas(repCanvasRef.current)}
                    className="min-h-[48px] px-4 text-sm text-red-600 font-semibold hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <button
                onClick={handleRepSign}
                disabled={submitting}
                className="w-full h-[56px] bg-green-600 hover:bg-green-700 active:bg-green-800
                           disabled:bg-green-400 disabled:cursor-not-allowed
                           text-white text-lg font-bold rounded-xl shadow-lg transition-colors
                           flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting...
                  </>
                ) : (
                  'Submit Signatures'
                )}
              </button>
            </div>
          )}

          {step === 'confirmation' && submitted && (
            <div className="text-center space-y-6 py-8">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-gray-900">Contract Signed!</h2>
              <p className="text-lg text-gray-500">
                The estimate for {estimate.customerName} has been signed successfully.
              </p>
              <p className="text-gray-500">
                Total: <span className="font-bold text-gray-900">{formatCurrency(estimate.totals.todayPrice)}</span>
              </p>

              <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 text-left">
                <p className="font-semibold text-blue-900">Rescission Period</p>
                <p className="text-blue-700 mt-1">
                  The customer has 3 business days to cancel this contract.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => navigate('/estimator/new')}
                  className="flex-1 h-[56px] bg-gray-100 hover:bg-gray-200 text-gray-700
                             text-lg font-semibold rounded-xl transition-colors"
                >
                  New Estimate
                </button>
                <button
                  onClick={() => navigate('/estimator')}
                  className="flex-1 h-[56px] bg-blue-600 hover:bg-blue-700 text-white
                             text-lg font-bold rounded-xl transition-colors"
                >
                  All Estimates
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
