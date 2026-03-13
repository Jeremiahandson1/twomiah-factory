import React, { useState, useEffect } from 'react';
import {
  Loader2, Check, ExternalLink, ToggleLeft, ToggleRight,
  MessageSquare, Mail, CreditCard, BookOpen, AlertCircle, RefreshCw,
  Phone, Copy, Send
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [integrations, setIntegrations] = useState({
    quickbooks: { connected: false, companyName: null, lastSync: null, syncEnabled: false },
    stripe: { connected: false, accountId: null, chargesEnabled: false },
    sms: { enabled: false, usage: 0 },
    email: { enabled: false, usage: 0 },
  });
  const [testPhone, setTestPhone] = useState('');

  useEffect(() => {
    loadIntegrations();
  }, []);

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  });

  const loadIntegrations = async () => {
    try {
      const response = await fetch(`${API_URL}/api/integrations/status`, {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
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
      const response = await fetch(`${API_URL}/api/integrations/quickbooks/auth-url`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      setError('Failed to start QuickBooks connection');
    }
  };

  const handleQuickBooksDisconnect = async () => {
    if (!confirm('Disconnect QuickBooks? Your data will stop syncing.')) return;
    
    setSaving('quickbooks');
    try {
      await fetch(`${API_URL}/api/integrations/quickbooks/disconnect`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
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
      const response = await fetch(`${API_URL}/api/integrations/stripe/connect-url`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (data.connectUrl) {
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
      await fetch(`${API_URL}/api/integrations/stripe/disconnect`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
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
      const response = await fetch(`${API_URL}/api/integrations/${service}/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !integrations[service].enabled }),
      });
      
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error);
      
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

  const handleAutoSyncToggle = async () => {
    setSaving('autosync');
    try {
      const newVal = !integrations.quickbooks.syncEnabled;
      await fetch(`${API_URL}/api/quickbooks/auto-sync`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: newVal }),
      });
      setIntegrations(prev => ({
        ...prev,
        quickbooks: { ...prev.quickbooks, syncEnabled: newVal },
      }));
      setSuccess(`Auto-sync ${newVal ? 'enabled' : 'disabled'}`);
    } catch (err) {
      setError('Failed to update auto-sync');
    } finally {
      setSaving(null);
    }
  };

  const handleTestSms = async () => {
    if (!testPhone.trim()) { setError('Enter a phone number'); return; }
    setSaving('testsms');
    try {
      await fetch(`${API_URL}/api/sms/test`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ to: testPhone }),
      });
      setSuccess('Test SMS sent');
      setTestPhone('');
    } catch (err) {
      setError('Failed to send test SMS');
    } finally {
      setSaving(null);
    }
  };

  const copyWebhookUrl = () => {
    const url = `${window.location.origin}/api/sms/webhook/incoming`;
    navigator.clipboard.writeText(url);
    setSuccess('Webhook URL copied');
  };

  const handleSyncNow = async () => {
    setSaving('sync');
    try {
      await fetch(`${API_URL}/api/integrations/quickbooks/sync`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Integrations</h1>
      <p className="text-gray-500 mb-6">Connect your accounts to sync data and enable features.</p>

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
        {/* QuickBooks */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">QuickBooks</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Sync invoices, expenses, and customers with your books.
                </p>
                {integrations.quickbooks.connected && (
                  <div className="mt-2 text-sm">
                    <p className="text-green-600 font-medium">
                      ✓ Connected to {integrations.quickbooks.companyName}
                    </p>
                    {integrations.quickbooks.lastSync && (
                      <p className="text-gray-500">
                        Last synced: {new Date(integrations.quickbooks.lastSync).toLocaleString()}
                      </p>
                    )}
                    <label className="flex items-center gap-2 mt-2 cursor-pointer">
                      <button
                        onClick={handleAutoSyncToggle}
                        disabled={saving === 'autosync'}
                        className="flex items-center"
                      >
                        {saving === 'autosync' ? (
                          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
                        ) : integrations.quickbooks.syncEnabled ? (
                          <ToggleRight className="w-8 h-8 text-green-500" />
                        ) : (
                          <ToggleLeft className="w-8 h-8 text-gray-300" />
                        )}
                      </button>
                      <span className="text-gray-600">Sync invoices automatically when marked paid</span>
                    </label>
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
                    className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1"
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
                    className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={handleQuickBooksConnect}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2"
                >
                  Connect QuickBooks
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stripe */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Stripe Payments</h3>
                <p className="text-sm text-gray-500 mt-1">
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
                  className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
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
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">SMS Notifications</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Send text updates to customers and crew members.
                </p>
                {integrations.sms.enabled && (
                  <p className="mt-2 text-sm text-gray-600">
                    Usage this month: <span className="font-medium">{integrations.sms.usage} messages</span>
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => handleToggle('sms')}
              disabled={saving === 'sms'}
              className="flex items-center"
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

        {/* Twilio SMS Settings */}
        {integrations.sms.enabled && (
          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                <Phone className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">Twilio Settings</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Configure your Twilio account for two-way texting.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Incoming Webhook URL</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-gray-50 px-3 py-2 rounded-lg border text-gray-700 truncate">
                        {window.location.origin}/api/sms/webhook/incoming
                      </code>
                      <button
                        onClick={copyWebhookUrl}
                        className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                        title="Copy URL"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Paste this into your Twilio phone number's webhook settings.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Send Test SMS</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="tel"
                        placeholder="+1 (555) 123-4567"
                        value={testPhone}
                        onChange={(e) => setTestPhone(e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                      />
                      <button
                        onClick={handleTestSms}
                        disabled={saving === 'testsms'}
                        className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 flex items-center gap-1"
                      >
                        {saving === 'testsms' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Test
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Email */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                <Mail className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Email</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Send invoices, quotes, and reminders via email.
                </p>
                {integrations.email.enabled && (
                  <p className="mt-2 text-sm text-gray-600">
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
      <div className="mt-6 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-600">
          <strong>SMS & Email Usage:</strong> Your plan includes 500 SMS and 2,000 emails per month. 
          Additional messages are billed at $0.02/SMS and $0.001/email.
        </p>
      </div>
    </div>
  );
}
