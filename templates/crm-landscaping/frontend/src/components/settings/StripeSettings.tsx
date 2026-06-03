import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  CreditCard, Link2, Unlink, Check, X, AlertCircle, Loader2,
  DollarSign, ExternalLink, Shield
} from 'lucide-react';
import api from '../../services/api';

export default function StripeSettings() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    loadStatus();

    // Check for callback params
    const success = searchParams.get('success');
    const refresh = searchParams.get('refresh');
    
    if (success === 'true') {
      setMessage({ type: 'success', text: 'Stripe account connected successfully!' });
    } else if (refresh === 'true') {
      setMessage({ type: 'info', text: 'Please complete your Stripe onboarding.' });
    }
  }, [searchParams]);

  const loadStatus = async () => {
    try {
      const statusRes = await api.get('/stripe/account-status');
      setStatus(statusRes);
    } catch (error) {
      console.error('Failed to load Stripe status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const { url } = await api.post('/stripe/onboarding');
      window.location.href = url;
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to start onboarding' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const isFullySetup = status?.connected && status?.chargesEnabled && status?.payoutsEnabled;

  return (
    <div className="space-y-6">
      {/* Message */}
      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-3 ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 
          message.type === 'error' ? 'bg-red-50 text-red-800' :
          'bg-blue-50 text-blue-800'
        }`}>
          {message.type === 'success' ? <Check className="w-5 h-5" /> : 
           message.type === 'error' ? <AlertCircle className="w-5 h-5" /> :
           <AlertCircle className="w-5 h-5" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Connection Status */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Stripe Payments</h2>
              <p className="text-gray-500">
                {isFullySetup ? 'Ready to accept payments' : 
                 status?.connected ? 'Setup incomplete' : 'Not connected'}
              </p>
            </div>
          </div>

          {!status?.connected ? (
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              <Link2 className="w-4 h-4" />
              Connect Stripe
            </button>
          ) : !isFullySetup ? (
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
            >
              Complete Setup
            </button>
          ) : (
            <div className="flex items-center gap-2 text-green-600">
              <Check className="w-5 h-5" />
              <span className="font-medium">Active</span>
            </div>
          )}
        </div>

        {/* Status details */}
        {status?.connected && (
          <div className="mt-6 pt-6 border-t grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatusItem 
              label="Accept Payments" 
              enabled={status.chargesEnabled} 
            />
            <StatusItem 
              label="Receive Payouts" 
              enabled={status.payoutsEnabled} 
            />
            <StatusItem 
              label="Details Submitted" 
              enabled={status.detailsSubmitted} 
            />
          </div>
        )}

        {/* Pending requirements */}
        {status?.connected && status?.requirements?.currently_due?.length > 0 && (
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
            <p className="text-sm font-medium text-yellow-800 mb-2">
              Action Required
            </p>
            <p className="text-sm text-yellow-700">
              Please complete your Stripe setup to start accepting payments.
            </p>
            <button
              onClick={handleConnect}
              className="mt-2 text-sm text-yellow-800 underline"
            >
              Complete Setup →
            </button>
          </div>
        )}
      </div>

      {/* Features */}
      {isFullySetup && (
        <div className="bg-white rounded-xl border p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Payment Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureItem 
              icon={CreditCard}
              title="Invoice Payments"
              description="Customers can pay invoices directly with credit card"
            />
            <FeatureItem 
              icon={Link2}
              title="Payment Links"
              description="Generate shareable payment links for invoices"
            />
            <FeatureItem 
              icon={Shield}
              title="Secure Checkout"
              description="PCI-compliant payment processing"
            />
            <FeatureItem 
              icon={DollarSign}
              title="Automatic Recording"
              description="Payments are automatically recorded in {{COMPANY_NAME}}"
            />
          </div>
        </div>
      )}

      {/* Setup guide when not connected */}
      {!status?.connected && (
        <div className="bg-purple-50 rounded-xl p-6">
          <h3 className="font-semibold text-purple-900 mb-2">Accept Online Payments</h3>
          <p className="text-purple-800 mb-4">
            Connect your Stripe account to accept credit card payments on your invoices.
          </p>
          <ul className="space-y-2 text-sm text-purple-700">
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Customers pay directly from invoice emails or portal
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Payments automatically marked in {{COMPANY_NAME}}
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              Funds deposited to your bank account
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              2.9% + 30¢ per transaction (Stripe's standard rate)
            </li>
          </ul>
        </div>
      )}

      {/* Stripe Dashboard Link */}
      {isFullySetup && (
        <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Stripe Dashboard</p>
            <p className="text-sm text-gray-500">View transactions, payouts, and settings</p>
          </div>
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-purple-600 hover:text-purple-700"
          >
            Open Dashboard
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}
    </div>
  );
}

function StatusItem({ label, enabled }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-500' : 'bg-yellow-500'}`} />
      <span className="text-sm text-gray-600">{label}</span>
      {enabled ? (
        <Check className="w-4 h-4 text-green-500" />
      ) : (
        <AlertCircle className="w-4 h-4 text-yellow-500" />
      )}
    </div>
  );
}

function FeatureItem({ icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
      <div className="p-2 bg-purple-100 rounded-lg">
        <Icon className="w-4 h-4 text-purple-600" />
      </div>
      <div>
        <p className="font-medium text-gray-900">{title}</p>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </div>
  );
}
