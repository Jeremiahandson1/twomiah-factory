import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  Loader2, Check, ExternalLink, ToggleLeft, ToggleRight,
  MessageSquare, Mail, CreditCard, BookOpen, AlertCircle, RefreshCw, KeyRound, Copy
} from 'lucide-react';

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [integrations, setIntegrations] = useState({
    quickbooks: { connected: false, companyName: null, lastSync: null },
    stripe: { connected: false, accountId: null, chargesEnabled: false },
    sms: { enabled: false, usage: 0 },
    email: { enabled: false, usage: 0 },
  });

  // Turning a paid module on or off is an admin or owner decision; the API agrees. (T45 M20)
  const { isAdmin: canChangeModules } = useAuth();
  const [apiKey, setApiKey] = useState({ configured: false, maskedKey: null });
  const [newApiKey, setNewApiKey] = useState('');

  useEffect(() => {
    loadIntegrations();
    loadApiKey();
  }, []);

  const loadIntegrations = async () => {
    try {
      const data = await api.get('/api/integrations/status') as any;
      {
        if (data && typeof data === 'object') {
          setIntegrations(prev => ({
            quickbooks: { ...prev.quickbooks, ...data.quickbooks },
            stripe: { ...prev.stripe, ...data.stripe },
            sms: { ...prev.sms, ...data.sms },
            email: { ...prev.email, ...data.email },
          }));
        }
      }
    } catch (err) {
      setError('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickBooksConnect = async () => {
    try {
      const data = await api.get('/api/integrations/quickbooks/auth-url') as any;
      if (data?.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      // The server answers { configured: false, authUrl: null } when QuickBooks has no client id
      // on the platform. The button did nothing at all with that — no message, no error, nothing
      // moved — so it read as broken software rather than a feature that is not switched on yet.
      // (T45 M4)
      setError(data?.message || 'QuickBooks is not set up on this platform yet. Get in touch and we will switch it on for your shop.');
    } catch (err) {
      setError('Failed to start QuickBooks connection');
    }
  };

  const handleQuickBooksDisconnect = async () => {
    if (!confirm('Disconnect QuickBooks? Your data will stop syncing.')) return;
    
    setSaving('quickbooks');
    try {
      await api.post('/api/integrations/quickbooks/disconnect');
      setIntegrations(prev => ({
        ...prev,
        quickbooks: { connected: false, companyName: null, lastSync: null },
      }));
      setSuccess('QuickBooks disconnected');
    } catch (err) {
      setError('Failed to disconnect QuickBooks');
    } finally {
      setSaving(null);
    }
  };

  const handleStripeConnect = async () => {
    try {
      const data = await api.get('/api/integrations/stripe/connect-url') as any;
      if (data?.connectUrl) {
        window.location.href = data.connectUrl;
      }
    } catch (err) {
      setError('Failed to start Stripe connection');
    }
  };

  const handleStripeDisconnect = async () => {
    if (!confirm('Disconnect Stripe? You won\'t be able to accept payments.')) return;
    
    setSaving('stripe');
    try {
      await api.post('/api/integrations/stripe/disconnect');
      setIntegrations(prev => ({
        ...prev,
        stripe: { connected: false, accountId: null, chargesEnabled: false },
      }));
      setSuccess('Stripe disconnected');
    } catch (err) {
      setError('Failed to disconnect Stripe');
    } finally {
      setSaving(null);
    }
  };

  const handleToggle = async (service) => {
    setSaving(service);
    setError('');
    
    try {
      await api.post(`/api/integrations/${service}/toggle`, { enabled: !integrations[service].enabled });

      setIntegrations(prev => ({
        ...prev,
        [service]: { ...prev[service], enabled: !prev[service].enabled },
      }));
      setSuccess(`${service === 'sms' ? 'SMS' : 'Email'} ${integrations[service].enabled ? 'disabled' : 'enabled'}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  };

  // The documented POS API (POST /sale, /customer, /inventory-sync) authenticates with a key held
  // on the company record - and no screen in the product ever created one, so the whole API was
  // unusable. This panel is where a key comes from. (T45 H22)
  const loadApiKey = async () => {
    try {
      const data = await api.get('/api/integrations/api-key') as any;
      setApiKey({ configured: !!data?.configured, maskedKey: data?.maskedKey || null });
    } catch {
      // A manager can see this page but not the key; leave the panel in its 'no key' state.
    }
  };

  const handleRotateApiKey = async () => {
    if (apiKey.configured && !confirm('Replace the current API key? Anything using the old key stops working immediately.')) return;
    setSaving('apiKey');
    try {
      const data = await api.post('/api/integrations/api-key/rotate') as any;
      setNewApiKey(data?.key || '');
      setApiKey({ configured: true, maskedKey: data?.maskedKey || null });
      setSuccess('API key created. Copy it now - it is shown once.');
    } catch (err) {
      setError(err.message || 'Failed to create an API key');
    } finally {
      setSaving(null);
    }
  };

  const handleSyncNow = async () => {
    setSaving('sync');
    try {
      await api.post('/api/integrations/quickbooks/sync');
      setSuccess('Sync started');
      loadIntegrations();
    } catch (err) {
      setError('Sync failed');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">Integrations</h1>
      <p className="text-gray-500 mb-6 dark:text-slate-400">Connect your accounts to sync data and enable features.</p>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          {success}
        </div>
      )}

      <div className="space-y-4">
        {/* POS / Integration API key */}
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                <KeyRound className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">POS API key</h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  For an outside point-of-sale system to send sales, customers and stock counts in.
                  Send it as the <span className="font-mono">X-API-Key</span> header.
                </p>
                {apiKey.configured && !newApiKey && (
                  <p className="mt-2 text-sm text-gray-700 font-mono dark:text-slate-200">{apiKey.maskedKey}</p>
                )}
                {!apiKey.configured && !newApiKey && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">No key yet.</p>
                )}
              </div>
            </div>
            <button
              onClick={handleRotateApiKey}
              disabled={saving === 'apiKey'}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
            >
              {saving === 'apiKey' ? 'Working...' : apiKey.configured ? 'Replace key' : 'Create key'}
            </button>
          </div>
          {newApiKey && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-950 dark:border-amber-800">
              <p className="text-sm text-amber-800 mb-2 dark:text-amber-200">
                Copy this now. It is shown once and cannot be read back.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white border rounded text-sm font-mono break-all text-gray-900 dark:bg-slate-950 dark:text-slate-100 dark:border-slate-700">{newApiKey}</code>
                <button
                  onClick={() => { navigator.clipboard?.writeText(newApiKey); setSuccess('API key copied'); }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"
                  title="Copy"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* QuickBooks */}
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">QuickBooks</h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  {/* "invoices" is contractor wording. A dispensary's books take its daily sales,
                      its purchase orders and its customers. (T45 M4) */}
                  Send your daily sales, purchases and customers through to your books.
                </p>
                {integrations.quickbooks.connected && (
                  <div className="mt-2 text-sm">
                    <p className="text-green-600 font-medium">
                      ✓ Connected to {integrations.quickbooks.companyName}
                    </p>
                    {integrations.quickbooks.lastSync && (
                      <p className="text-gray-500 dark:text-slate-400">
                        Last synced: {new Date(integrations.quickbooks.lastSync).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {integrations.quickbooks.connected ? (
                <>
                  <button
                    onClick={handleSyncNow}
                    disabled={saving === 'sync'}
                    className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1 dark:text-slate-400"
                  >
                    {saving === 'sync' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4" />
                    )}
                    Sync Now
                  </button>
                  <button
                    onClick={handleQuickBooksDisconnect}
                    disabled={saving === 'quickbooks'}
                    className="px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={handleQuickBooksConnect}
                  className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 flex items-center gap-2"
                >
                  Connect QuickBooks
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stripe */}
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">Stripe Payments</h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  Accept credit card payments from customers.
                </p>
                {integrations.stripe.connected && (
                  <div className="mt-2 text-sm">
                    {integrations.stripe.chargesEnabled ? (
                      <p className="text-green-600 font-medium">✓ Ready to accept payments</p>
                    ) : (
                      <p className="text-yellow-600 font-medium">⚠ Setup incomplete - check Stripe dashboard</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div>
              {integrations.stripe.connected ? (
                <button
                  onClick={handleStripeDisconnect}
                  disabled={saving === 'stripe'}
                  className="px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleStripeConnect}
                  className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2"
                >
                  Connect Stripe
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* SMS */}
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">SMS Notifications</h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  {/* "crew members" is contractor wording that came across with the template. A
                      dispensary has budtenders and it texts customers. (T45 M4) */}
                  Text your customers when an order is ready, and remind them about deals.
                </p>
                {/* The allowance line said "500 messages a month", which contradicts Billing —
                    messaging is a prepaid wallet, not an inclusive bundle. Point at the one place
                    that knows the balance rather than restate it here. (T45 M4) */}
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  Messages are paid from your prepaid messaging wallet — top it up under Billing.
                </p>
                {integrations.sms.enabled && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    Usage this month: <span className="font-medium">{integrations.sms.usage} messages</span>
                  </p>
                )}
              </div>
            </div>
            {/* Switching SMS on commits the shop to spending its messaging wallet. The server takes
                it at admin, so the control is disabled rather than 403ing under a manager's hand.
                (T45 M20) */}
            <button
              onClick={() => handleToggle('sms')}
              disabled={saving === 'sms' || !canChangeModules}
              title={canChangeModules ? undefined : 'Switching SMS on or off is an admin or owner job'}
              className="flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving === 'sms' ? (
                <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
              ) : integrations.sms.enabled ? (
                <ToggleRight className="w-10 h-10 text-blue-500" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-gray-300" />
              )}
            </button>
          </div>
        </div>

        {/* Email */}
        <div className="bg-white rounded-xl border p-6 dark:bg-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                <Mail className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">Email</h3>
                <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
                  Send invoices, quotes, and reminders via email.
                </p>
                {integrations.email.enabled && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    Usage this month: <span className="font-medium">{integrations.email.usage} emails</span>
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => handleToggle('email')}
              disabled={saving === 'email'}
              className="flex items-center"
            >
              {saving === 'email' ? (
                <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
              ) : integrations.email.enabled ? (
                <ToggleRight className="w-10 h-10 text-orange-500" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-gray-300" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Usage Note */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
        <p className="text-sm text-gray-600 dark:text-slate-400">
          <strong>SMS & Email Usage:</strong> Your plan includes 500 SMS and 2,000 emails per month. 
          Additional messages are billed at $0.02/SMS and $0.001/email.
        </p>
      </div>
    </div>
  );
}
