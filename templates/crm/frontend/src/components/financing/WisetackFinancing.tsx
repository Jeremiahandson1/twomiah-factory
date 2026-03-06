import { useState, useEffect } from 'react';
import { 
  DollarSign, Calculator, CreditCard, CheckCircle, Clock,
  XCircle, ExternalLink, Loader2, AlertCircle, Percent,
  Calendar, TrendingUp, Zap
} from 'lucide-react';
import api from '../../services/api';

/**
 * Financing Options Display
 * 
 * Shows available financing options with monthly payment calculations
 */
export function FinancingOptions({ amount, onApply }) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTerm, setSelectedTerm] = useState(36);

  useEffect(() => {
    if (amount) {
      loadOptions();
    }
  }, [amount]);

  const loadOptions = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/wisetack/options?amount=${amount}`);
      setOptions(data);
    } catch (error) {
      console.error('Failed to load financing options:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
          <CreditCard className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Flexible Financing Available</h3>
          <p className="text-sm text-gray-600">Low monthly payments, quick approval</p>
        </div>
      </div>

      {/* Options Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {options.map((option) => (
          <button
            key={option.termMonths}
            onClick={() => setSelectedTerm(option.termMonths)}
            className={`p-3 rounded-lg text-center transition-all ${
              selectedTerm === option.termMonths
                ? 'bg-green-500 text-white shadow-lg scale-105'
                : 'bg-white hover:bg-gray-50 border'
            }`}
          >
            <p className="text-2xl font-bold">
              ${option.monthlyPayment.toFixed(0)}
            </p>
            <p className="text-xs opacity-75">/month</p>
            <p className="text-xs mt-1">
              {option.termMonths} months
              {option.apr > 0 ? ` @ ${option.apr}%` : ' @ 0%'}
            </p>
          </button>
        ))}
      </div>

      {/* Selected Option Details */}
      {selectedTerm && (
        <div className="bg-white rounded-lg p-4 mb-4">
          {(() => {
            const selected = options.find(o => o.termMonths === selectedTerm);
            if (!selected) return null;
            
            return (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-gray-500">Monthly Payment</p>
                  <p className="text-xl font-bold text-green-600">
                    ${selected.monthlyPayment.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">APR</p>
                  <p className="text-xl font-bold text-gray-900">
                    {selected.apr}%
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Cost</p>
                  <p className="text-xl font-bold text-gray-900">
                    ${selected.totalCost.toFixed(2)}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Apply Button */}
      <button
        onClick={onApply}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"
      >
        <Zap className="w-5 h-5" />
        Apply for Financing - Takes 60 seconds
      </button>

      <p className="text-xs text-center text-gray-500 mt-3">
        No impact to credit score for pre-qualification. Powered by Wisetack.
      </p>
    </div>
  );
}

/**
 * Financing Application Modal
 */
export function FinancingApplicationModal({ 
  amount, 
  quoteId, 
  invoiceId, 
  contactId, 
  onClose, 
  onSuccess 
}) {
  const [step, setStep] = useState('form'); // form, loading, success, error
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
  });
  const [application, setApplication] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStep('loading');
    setError(null);

    try {
      const result = await api.post('/wisetack/applications', {
        quoteId,
        invoiceId,
        contactId,
        amount,
        customerInfo: form,
      });

      setApplication(result);
      setStep('success');
      onSuccess?.(result);
    } catch (err) {
      setError(err.message || 'Failed to create application');
      setStep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CreditCard className="w-6 h-6 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Apply for Financing</h2>
            <p className="text-gray-500">
              ${amount.toLocaleString()} • Quick pre-qualification
            </p>
          </div>

          {/* Form Step */}
          {step === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    maxLength={2}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input
                    type="text"
                    value={form.zip}
                    onChange={(e) => setForm({ ...form, zip: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    maxLength={5}
                    required
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  Check My Rate
                </button>
              </div>

              <p className="text-xs text-center text-gray-500">
                Checking your rate won't affect your credit score.
              </p>
            </form>
          )}

          {/* Loading Step */}
          {step === 'loading' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 animate-spin text-green-500 mx-auto mb-4" />
              <p className="text-gray-600">Processing your application...</p>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && application && (
            <div className="text-center py-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Application Created!</h3>
              <p className="text-gray-600 mb-6">
                Complete your application to see your financing options.
              </p>
              
              <a
                href={application.applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600"
              >
                Complete Application
                <ExternalLink className="w-4 h-4" />
              </a>

              <button
                onClick={onClose}
                className="w-full mt-3 px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                I'll complete this later
              </button>
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="text-center py-4">
              <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h3>
              <p className="text-red-600 mb-6">{error}</p>
              
              <button
                onClick={() => setStep('form')}
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Financing Application Status Card
 */
export function FinancingStatusCard({ applicationId }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatus();
  }, [applicationId]);

  const loadStatus = async () => {
    try {
      const data = await api.get(`/wisetack/applications/${applicationId}`);
      setStatus(data);
    } catch (error) {
      console.error('Failed to load status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse bg-gray-100 h-24 rounded-lg" />;
  }

  if (!status) return null;

  const statusConfig = {
    pending: { icon: Clock, color: 'yellow', label: 'Pending Review' },
    approved: { icon: CheckCircle, color: 'green', label: 'Approved' },
    declined: { icon: XCircle, color: 'red', label: 'Declined' },
    funded: { icon: DollarSign, color: 'green', label: 'Funded' },
    expired: { icon: AlertCircle, color: 'gray', label: 'Expired' },
  };

  const config = statusConfig[status.status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <div className={`bg-${config.color}-50 rounded-lg p-4 border border-${config.color}-200`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-6 h-6 text-${config.color}-600`} />
        <div className="flex-1">
          <p className="font-medium text-gray-900">{config.label}</p>
          {status.approvedAmount && (
            <p className="text-sm text-gray-600">
              Approved for ${status.approvedAmount.toLocaleString()}
            </p>
          )}
          {status.monthlyPayment && (
            <p className="text-sm text-gray-600">
              ${status.monthlyPayment}/mo for {status.termMonths} months @ {status.apr}% APR
            </p>
          )}
        </div>
        {status.applicationUrl && status.status === 'pending' && (
          <a
            href={status.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-white border rounded-lg text-sm hover:bg-gray-50"
          >
            Complete
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Wisetack Settings/Connection Component
 */
export function WisetackSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const data = await api.get('/wisetack/status');
      setStatus(data);
    } catch (error) {
      console.error('Failed to load status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authUrl } = await api.post('/wisetack/connect', {
        returnUrl: `${window.location.origin}/settings/integrations?wisetack=callback`,
      });
      window.location.href = authUrl;
    } catch (error) {
      alert('Failed to connect: ' + error.message);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect from Wisetack? This will disable financing for your customers.')) {
      return;
    }

    try {
      await api.post('/wisetack/disconnect');
      loadStatus();
    } catch (error) {
      alert('Failed to disconnect');
    }
  };

  if (loading) {
    return <div className="animate-pulse bg-gray-100 h-32 rounded-xl" />;
  }

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
          <CreditCard className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Wisetack Consumer Financing</h3>
          <p className="text-sm text-gray-500">Let customers pay over time with 0% APR options</p>
        </div>
      </div>

      {status?.connected ? (
        <>
          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg mb-4">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-green-700 font-medium">Connected</span>
            <span className="text-sm text-green-600 ml-auto">
              Since {new Date(status.connectedAt).toLocaleDateString()}
            </span>
          </div>

          <div className="space-y-3 text-sm text-gray-600">
            <p>✓ Financing options appear on quotes and invoices</p>
            <p>✓ Customers can apply in 60 seconds</p>
            <p>✓ Get paid within 1-2 business days</p>
          </div>

          <button
            onClick={handleDisconnect}
            className="mt-4 text-sm text-red-600 hover:text-red-700"
          >
            Disconnect Wisetack
          </button>
        </>
      ) : (
        <>
          <div className="space-y-3 text-sm text-gray-600 mb-4">
            <p>• Offer 0% financing to close bigger jobs</p>
            <p>• Increase average ticket size by 30%+</p>
            <p>• You get paid in full, customer pays over time</p>
            <p>• No credit check to see options</p>
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
          >
            {connecting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Zap className="w-5 h-5" />
            )}
            Connect Wisetack
          </button>
        </>
      )}
    </div>
  );
}

export default {
  FinancingOptions,
  FinancingApplicationModal,
  FinancingStatusCard,
  WisetackSettings,
};
