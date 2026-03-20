import React, { useState, useEffect } from 'react';
import {
  Loader2, Check, ExternalLink, ToggleLeft, ToggleRight,
  MessageSquare, Mail, CreditCard, BookOpen, AlertCircle, RefreshCw,
  Globe, ChevronRight, Phone, Link2, Search, Eye, EyeOff,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function IntegrationsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', phoneNumber: '' });
  const [showTwilioToken, setShowTwilioToken] = useState(false);
  const [integrations, setIntegrations] = useState({
    quickbooks: { connected: false, companyName: null, lastSync: null },
    stripe: { connected: false, accountId: null, chargesEnabled: false },
    sms: { enabled: false, usage: 0 },
    email: { enabled: false, usage: 0 },
    twilio: { configured: false, phoneNumber: null },
  });

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
            twilio: { ...prev.twilio, ...data.twilio },
          }));
          if (data.twilio?.phoneNumber) {
            setTwilioForm(prev => ({ ...prev, phoneNumber: data.twilio.phoneNumber }));
          }
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

  const handleToggle = async (service: string) => {
    setSaving(service);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/integrations/${service}/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !integrations[service as keyof typeof integrations]?.enabled }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setIntegrations(prev => ({
        ...prev,
        [service]: { ...prev[service as keyof typeof prev], enabled: !(prev[service as keyof typeof prev] as any)?.enabled },
      }));
      setSuccess(`${service === 'sms' ? 'SMS' : 'Email'} ${(integrations[service as keyof typeof integrations] as any)?.enabled ? 'disabled' : 'enabled'}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
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

  const handleTwilioSave = async () => {
    if (!twilioForm.accountSid || !twilioForm.authToken || !twilioForm.phoneNumber) {
      setError('All Twilio fields are required');
      return;
    }
    setSaving('twilio');
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/integrations/twilio/configure`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(twilioForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save Twilio config');
      setIntegrations(prev => ({ ...prev, twilio: { configured: true, phoneNumber: twilioForm.phoneNumber } }));
      setSuccess('Twilio configured successfully');
      setTwilioForm(prev => ({ ...prev, accountSid: '', authToken: '' }));
    } catch (err: any) {
      setError(err.message);
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Integrations</h1>
      <p className="text-gray-500 dark:text-slate-400 mb-6">Connect your accounts, set up lead sources, and configure your domain.</p>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">&times;</button>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5 flex-shrink-0" />
          {success}
          <button onClick={() => setSuccess('')} className="ml-auto text-green-500 hover:text-green-700">&times;</button>
        </div>
      )}

      <div className="space-y-4">

        {/* ─── DNS / Domain Setup ──────────────────────────────────────── */}
        <SectionLabel label="Domain" />
        <GuideCard
          icon={<Globe className="w-6 h-6 text-sky-600" />}
          iconBg="bg-sky-100 dark:bg-sky-500/20"
          title="Custom Domain (DNS)"
          description="Point your domain to your CRM so customers see your brand."
          expanded={expandedGuide === 'dns'}
          onToggle={() => setExpandedGuide(expandedGuide === 'dns' ? null : 'dns')}
          steps={[
            'Log into your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)',
            'Go to DNS settings for your domain',
            'Add a CNAME record pointing your subdomain (e.g. crm.yourdomain.com) to your CRM URL shown above',
            'Save changes — DNS propagation can take up to 24 hours',
            'Once propagated, your CRM will be accessible at your custom domain',
          ]}
        />

        {/* ─── Accounting ─────────────────────────────────────────────── */}
        <SectionLabel label="Accounting" />

        {/* QuickBooks */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-500/20 rounded-xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">QuickBooks</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  Sync invoices, expenses, and customers with your books.
                </p>
                {integrations.quickbooks.connected && (
                  <div className="mt-2 text-sm">
                    <p className="text-green-600 dark:text-green-400 font-medium">
                      Connected to {integrations.quickbooks.companyName}
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
                    className="px-3 py-2 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1"
                  >
                    {saving === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Sync Now
                  </button>
                  <button
                    onClick={handleQuickBooksDisconnect}
                    disabled={saving === 'quickbooks'}
                    className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
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

        {/* ─── Payments ───────────────────────────────────────────────── */}
        <SectionLabel label="Payments" />

        {/* Stripe */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-500/20 rounded-xl flex items-center justify-center">
                <CreditCard className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Stripe Payments</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  Accept credit card payments from customers.
                </p>
                {integrations.stripe.connected && (
                  <div className="mt-2 text-sm">
                    {integrations.stripe.chargesEnabled ? (
                      <p className="text-green-600 dark:text-green-400 font-medium">Ready to accept payments</p>
                    ) : (
                      <p className="text-yellow-600 dark:text-yellow-400 font-medium">Setup incomplete — check Stripe dashboard</p>
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
                  className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
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

        {/* ─── Communication ──────────────────────────────────────────── */}
        <SectionLabel label="Communication" />

        {/* Twilio */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-xl flex items-center justify-center">
              <Phone className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Twilio (Two-Way Texting)</h3>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Send and receive SMS with customers directly from your CRM.
                  </p>
                </div>
                {integrations.twilio?.configured && (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2 py-1 rounded-full">Connected</span>
                )}
              </div>
              {integrations.twilio?.configured ? (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                  Phone: {integrations.twilio.phoneNumber}
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    Don't have Twilio? <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">Create a free account</a>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Account SID</label>
                      <input
                        type="text"
                        value={twilioForm.accountSid}
                        onChange={e => setTwilioForm(prev => ({ ...prev, accountSid: e.target.value }))}
                        placeholder="ACxxxxxxxxxx"
                        className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Auth Token</label>
                      <div className="relative">
                        <input
                          type={showTwilioToken ? 'text' : 'password'}
                          value={twilioForm.authToken}
                          onChange={e => setTwilioForm(prev => ({ ...prev, authToken: e.target.value }))}
                          placeholder="Your auth token"
                          className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white pr-9"
                        />
                        <button onClick={() => setShowTwilioToken(!showTwilioToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                          {showTwilioToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Twilio Phone Number</label>
                    <input
                      type="tel"
                      value={twilioForm.phoneNumber}
                      onChange={e => setTwilioForm(prev => ({ ...prev, phoneNumber: e.target.value }))}
                      placeholder="+15551234567"
                      className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white sm:max-w-xs"
                    />
                  </div>
                  <button
                    onClick={handleTwilioSave}
                    disabled={saving === 'twilio'}
                    className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-2"
                  >
                    {saving === 'twilio' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save Twilio Config
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SMS Toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-500/20 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">SMS Notifications</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  Send text updates to customers and crew members.
                </p>
                {integrations.sms.enabled && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    Usage this month: <span className="font-medium">{integrations.sms.usage} messages</span>
                  </p>
                )}
              </div>
            </div>
            <button onClick={() => handleToggle('sms')} disabled={saving === 'sms'} className="flex items-center">
              {saving === 'sms' ? (
                <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
              ) : integrations.sms.enabled ? (
                <ToggleRight className="w-10 h-10 text-blue-500" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-gray-300 dark:text-slate-600" />
              )}
            </button>
          </div>
        </div>

        {/* Email Toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-100 dark:bg-orange-500/20 rounded-xl flex items-center justify-center">
                <Mail className="w-6 h-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Email</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  Send invoices, quotes, and reminders via email.
                </p>
                {integrations.email.enabled && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                    Usage this month: <span className="font-medium">{integrations.email.usage} emails</span>
                  </p>
                )}
              </div>
            </div>
            <button onClick={() => handleToggle('email')} disabled={saving === 'email'} className="flex items-center">
              {saving === 'email' ? (
                <Loader2 className="w-10 h-10 text-gray-400 animate-spin" />
              ) : integrations.email.enabled ? (
                <ToggleRight className="w-10 h-10 text-orange-500" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-gray-300 dark:text-slate-600" />
              )}
            </button>
          </div>
        </div>

        {/* ─── Lead Sources ───────────────────────────────────────────── */}
        <SectionLabel label="Lead Sources" />

        <GuideCard
          icon={<Search className="w-6 h-6 text-emerald-600" />}
          iconBg="bg-emerald-100 dark:bg-emerald-500/20"
          title="Angi's List / HomeAdvisor"
          description="Automatically pull leads from Angi into your CRM lead inbox."
          expanded={expandedGuide === 'angi'}
          onToggle={() => setExpandedGuide(expandedGuide === 'angi' ? null : 'angi')}
          steps={[
            'Log into your Angi Pro account at pro.angi.com',
            'Go to Settings > Integrations or API access',
            'Generate an API key or enable lead forwarding to your CRM webhook',
            'Copy the webhook URL from your CRM (Lead Inbox > Settings > Inbound Webhook)',
            'New leads will automatically flow into your Lead Inbox',
          ]}
        />

        <GuideCard
          icon={<Search className="w-6 h-6 text-blue-600" />}
          iconBg="bg-blue-100 dark:bg-blue-500/20"
          title="Thumbtack"
          description="Pull Thumbtack leads directly into your CRM."
          expanded={expandedGuide === 'thumbtack'}
          onToggle={() => setExpandedGuide(expandedGuide === 'thumbtack' ? null : 'thumbtack')}
          steps={[
            'Log into your Thumbtack Pro account',
            'Go to your profile settings and look for integrations or lead forwarding',
            'Set up email forwarding to your CRM inbound email address',
            'Or use Zapier to connect Thumbtack to your CRM webhook',
            'Leads will appear in your Lead Inbox automatically',
          ]}
        />

        <GuideCard
          icon={<Search className="w-6 h-6 text-indigo-600" />}
          iconBg="bg-indigo-100 dark:bg-indigo-500/20"
          title="Google Local Services Ads"
          description="Import Google LSA leads into your CRM automatically."
          expanded={expandedGuide === 'google_lsa'}
          onToggle={() => setExpandedGuide(expandedGuide === 'google_lsa' ? null : 'google_lsa')}
          steps={[
            'Go to your Google Local Services Ads dashboard',
            'Navigate to Settings > Lead delivery',
            'Enable webhook or email lead delivery',
            'Enter your CRM webhook URL or inbound email address',
            'New LSA leads will appear in your Lead Inbox',
          ]}
        />
      </div>

      {/* Usage Note */}
      <div className="mt-6 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
        <p className="text-sm text-gray-600 dark:text-slate-400">
          <strong>SMS & Email Usage:</strong> Your plan includes 500 SMS and 2,000 emails per month.
          Additional messages are billed at $0.02/SMS and $0.001/email.
        </p>
      </div>
    </div>
  );
}

/* ─── Reusable Components ──────────────────────────────────────────────────── */

function SectionLabel({ label }: { label: string }) {
  return (
    <h2 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider pt-4 first:pt-0">{label}</h2>
  );
}

function GuideCard({
  icon, iconBg, title, description, expanded, onToggle, steps,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  expanded: boolean;
  onToggle: () => void;
  steps: string[];
}) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden transition-all ${expanded ? 'ring-2 ring-orange-200 dark:ring-orange-500/30' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-6 text-left">
        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{description}</p>
        </div>
        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t dark:border-slate-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mt-4 mb-3">How to set up:</h4>
          <ol className="space-y-2">
            {steps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm text-gray-600 dark:text-slate-400">
                <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center flex-shrink-0 text-xs font-semibold mt-0.5">
                  {idx + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
