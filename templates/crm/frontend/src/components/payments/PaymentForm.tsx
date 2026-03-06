import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { CreditCard, Lock, Loader2, Check, AlertCircle } from 'lucide-react';
import api from '../../services/api';

// Initialize Stripe outside component to avoid recreating on render
let stripePromise = null;

const getStripe = async () => {
  if (!stripePromise) {
    const { publishableKey } = await api.get('/stripe/config');
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

/**
 * Payment Form Wrapper
 * 
 * Usage:
 *   <PaymentForm 
 *     invoiceId="abc123" 
 *     amount={1500.00} 
 *     onSuccess={() => reload()} 
 *   />
 */
export default function PaymentForm({ invoiceId, amount, onSuccess, onCancel, portalToken }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stripe, setStripe] = useState(null);

  useEffect(() => {
    initPayment();
  }, [invoiceId, amount]);

  const initPayment = async () => {
    try {
      // Load Stripe
      const stripeInstance = await getStripe();
      setStripe(stripeInstance);

      // Create payment intent
      const endpoint = portalToken ? '/stripe/portal/payment-intent' : '/stripe/payment-intent';
      const payload = { invoiceId, amount };
      if (portalToken) payload.portalToken = portalToken;

      const { clientSecret } = await api.post(endpoint, payload);
      setClientSecret(clientSecret);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to initialize payment');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Preparing payment...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-3">
        <AlertCircle className="w-5 h-5" />
        <span>{error}</span>
      </div>
    );
  }

  if (!clientSecret || !stripe) {
    return null;
  }

  const options = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#f97316',
        colorBackground: '#ffffff',
        colorText: '#1f2937',
        colorDanger: '#dc2626',
        fontFamily: 'Inter, system-ui, sans-serif',
        borderRadius: '8px',
      },
    },
  };

  return (
    <Elements stripe={stripe} options={options}>
      <CheckoutForm 
        amount={amount} 
        onSuccess={onSuccess} 
        onCancel={onCancel} 
      />
    </Elements>
  );
}

/**
 * Inner checkout form with Stripe Elements
 */
function CheckoutForm({ amount, onSuccess, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message);
      setProcessing(false);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setProcessing(false);
      return;
    }

    if (paymentIntent.status === 'succeeded') {
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
      }, 2000);
    }

    setProcessing(false);
  };

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Payment Successful!</h3>
        <p className="text-gray-500">Thank you for your payment.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Amount display */}
      {amount && (
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-500">Payment Amount</p>
          <p className="text-3xl font-bold text-gray-900">${Number(amount).toLocaleString()}</p>
        </div>
      )}

      {/* Payment element */}
      <div className="bg-white rounded-lg border p-4">
        <PaymentElement 
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Security note */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Lock className="w-3 h-3" />
        <span>Your payment info is encrypted and secure</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-900"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!stripe || processing}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              Pay ${Number(amount).toLocaleString()}
            </>
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * Payment Modal
 */
export function PaymentModal({ isOpen, onClose, invoiceId, amount, onSuccess, portalToken }) {
  if (!isOpen) return null;

  const handleSuccess = () => {
    onSuccess?.();
    setTimeout(onClose, 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Make Payment</h2>
          <PaymentForm
            invoiceId={invoiceId}
            amount={amount}
            onSuccess={handleSuccess}
            onCancel={onClose}
            portalToken={portalToken}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Simple Pay Button that opens checkout
 */
export function PayButton({ invoiceId, amount, label = 'Pay Now', className = '' }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const { url } = await api.post('/stripe/checkout-session', { invoiceId });
      window.location.href = url;
    } catch (error) {
      alert('Failed to start checkout: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <CreditCard className="w-4 h-4" />
      )}
      {label}
    </button>
  );
}

/**
 * Payment Link Generator
 */
export function PaymentLinkButton({ invoiceId, onGenerated }) {
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { url } = await api.post('/stripe/payment-link', { invoiceId });
      onGenerated?.(url);
      // Copy to clipboard
      navigator.clipboard.writeText(url);
      alert('Payment link copied to clipboard!');
    } catch (error) {
      alert('Failed to generate payment link: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-900"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
      Generate Payment Link
    </button>
  );
}
