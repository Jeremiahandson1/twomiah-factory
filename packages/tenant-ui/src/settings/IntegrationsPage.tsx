// Settings → Integrations — ONE page for every CRM (vendored into each template as ../shared).
// QuickBooks connect/sync/auto-sync, Stripe Connect, the company's own Twilio account (+ test text, webhook URL),
// texting/email toggles, DNS guide and per-vertical lead-source guides. Talks to the shared /api/integrations,
// /api/quickbooks and /api/sms routes. Before: four versions — the fieldservice/landscaping one was untyped and
// had no Twilio form; the crm-family one lacked the auto-sync toggle, the test text and the webhook URL.
import React, { useState, useEffect } from 'react'
import {
  Loader2, Check, ExternalLink, ToggleLeft, ToggleRight, MessageSquare, Mail, CreditCard, BookOpen, AlertCircle,
  RefreshCw, Globe, ChevronRight, Phone, Search, Eye, EyeOff, Copy, Send,
} from 'lucide-react'
import type { SettingsApi, IntegrationsConfig, LeadSourceGuide } from './integrationsTypes'
import { leadSourceGuides } from '../leads/types'

// The guides are the SAME vocabulary the Lead Sources page offers (one list per vertical — the template derives
// config.leadSources from its leadsConfig). Before: a second, hand-written list here pointed users at a
// "Lead Inbox > Settings > Inbound Webhook" screen that does not exist.
export const DEFAULT_LEAD_SOURCES: LeadSourceGuide[] = leadSourceGuides()

interface Status {
  quickbooks: { connected: boolean; configured?: boolean; companyName: string | null; lastSync: string | null; syncEnabled?: boolean }
  stripe: { connected: boolean; accountId: string | null; chargesEnabled: boolean; configured?: boolean }
  sms: { enabled: boolean; usage: number }
  email: { enabled: boolean; usage: number }
  twilio: { configured: boolean; ownAccount?: boolean; phoneNumber: string | null }
}
const EMPTY: Status = {
  // configured is left undefined until the status lands — only an explicit false means "this server has
  // no QuickBooks credentials", so the card never flashes "not available" while it is still loading.
  quickbooks: { connected: false, companyName: null, lastSync: null, syncEnabled: false },
  stripe: { connected: false, accountId: null, chargesEnabled: false },
  sms: { enabled: false, usage: 0 }, email: { enabled: false, usage: 0 },
  twilio: { configured: false, phoneNumber: null },
}
const errMsg = (e: unknown, fallback: string) => (e as Error)?.message || fallback

export function IntegrationsPage({ api, config }: { api: SettingsApi; config?: IntegrationsConfig }) {
  const copy = { quickbooks: 'Sync invoices, expenses, and customers with your books.', sms: 'Send text updates to customers and crew members.', email: 'Send invoices, quotes, and reminders via email.', intro: 'Connect your accounts, set up lead sources, and configure your domain.', ...(config?.copy || {}) }
  const leadSources = config?.leadSources || DEFAULT_LEAD_SOURCES
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null)
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', phoneNumber: '' })
  const [showTwilioToken, setShowTwilioToken] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [status, setStatus] = useState<Status>(EMPTY)
  const flash = (msg: string) => { setSuccess(msg); setError('') }
  const fail = (msg: string) => { setError(msg); setSuccess('') }

  const load = async () => {
    try {
      // Through the api client so a lapsed access token refreshes+retries instead of 401'ing to a permanent "not connected".
      const data = await api.get('/api/integrations/status')
      if (data && typeof data === 'object') {
        setStatus((prev) => ({ quickbooks: { ...prev.quickbooks, ...data.quickbooks }, stripe: { ...prev.stripe, ...data.stripe }, sms: { ...prev.sms, ...data.sms }, email: { ...prev.email, ...data.email }, twilio: { ...prev.twilio, ...data.twilio } }))
        if (data.twilio?.phoneNumber) setTwilioForm((f) => ({ ...f, phoneNumber: data.twilio.phoneNumber }))
      }
    } catch (e) { fail(errMsg(e, 'Failed to load integrations')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const run = async (key: string, fn: () => Promise<void>, fallback: string) => {
    setSaving(key); setError('')
    try { await fn() } catch (e) { fail(errMsg(e, fallback)) } finally { setSaving(null) }
  }

  const qbConnect = () => run('qb-connect', async () => { const d = await api.get('/api/integrations/quickbooks/auth-url'); const url = d?.authUrl || d?.url; if (url) window.location.href = url; else throw new Error('QuickBooks did not return a sign-in link') }, 'Failed to start QuickBooks connection')
  const qbDisconnect = () => { if (!confirm('Disconnect QuickBooks? Your data will stop syncing.')) return; run('quickbooks', async () => { await api.post('/api/integrations/quickbooks/disconnect'); setStatus((s) => ({ ...s, quickbooks: { ...EMPTY.quickbooks } })); flash('QuickBooks disconnected') }, 'Failed to disconnect QuickBooks') }
  const qbSync = () => run('sync', async () => { await api.post('/api/integrations/quickbooks/sync'); flash('Sync started'); load() }, 'Sync failed')
  const qbAutoSync = () => run('autosync', async () => { const next = !status.quickbooks.syncEnabled; await api.post('/api/quickbooks/auto-sync', { enabled: next }); setStatus((s) => ({ ...s, quickbooks: { ...s.quickbooks, syncEnabled: next } })); flash(`Auto-sync ${next ? 'enabled' : 'disabled'}`) }, 'Failed to update auto-sync')
  const stripeConnect = () => run('stripe-connect', async () => { const d = await api.get('/api/integrations/stripe/connect-url'); if (d?.connectUrl) window.location.href = d.connectUrl; else throw new Error('Stripe did not return an onboarding link') }, 'Failed to start Stripe connection')
  const stripeDisconnect = () => { if (!confirm("Disconnect Stripe? You won't be able to accept payments.")) return; run('stripe', async () => { await api.post('/api/integrations/stripe/disconnect'); setStatus((s) => ({ ...s, stripe: { ...EMPTY.stripe } })); flash('Stripe disconnected') }, 'Failed to disconnect Stripe') }
  const toggle = (service: 'sms' | 'email') => run(service, async () => { const next = !status[service].enabled; await api.post(`/api/integrations/${service}/toggle`, { enabled: next }); setStatus((s) => ({ ...s, [service]: { ...s[service], enabled: next } })); flash(`${service === 'sms' ? 'Texting' : 'Email'} ${next ? 'enabled' : 'disabled'}`) }, `Failed to update ${service}`)
  const twilioSave = () => {
    if (!twilioForm.accountSid || !twilioForm.authToken || !twilioForm.phoneNumber) { fail('All Twilio fields are required'); return }
    run('twilio', async () => { const d = await api.post('/api/integrations/twilio/configure', twilioForm); setStatus((s) => ({ ...s, twilio: { configured: true, ownAccount: true, phoneNumber: d?.phoneNumber || twilioForm.phoneNumber } })); setTwilioForm((f) => ({ ...f, accountSid: '', authToken: '' })); flash('Twilio configured') }, 'Failed to save Twilio settings')
  }
  const twilioDisconnect = () => { if (!confirm('Remove your Twilio account? Texting falls back to the platform number if one is configured.')) return; run('twilio-off', async () => { await api.post('/api/integrations/twilio/disconnect'); await load(); flash('Twilio account removed') }, 'Failed to remove Twilio account') }
  const testSms = () => { if (!testPhone.trim()) { fail('Enter a phone number'); return } run('testsms', async () => { await api.post('/api/sms/test', { to: testPhone }); setTestPhone(''); flash('Test text sent') }, 'Failed to send the test text') }
  const copyWebhookUrl = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/api/sms/webhook/incoming`); flash('Webhook URL copied') } catch { fail('Could not copy — the URL is shown below the button') } }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Integrations</h1>
      <p className="text-gray-500 dark:text-slate-400 mb-6">{copy.intro}</p>

      {error && <div role="alert" className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center gap-2"><AlertCircle className="w-5 h-5 flex-shrink-0" />{error}<button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-red-300">&times;</button></div>}
      {success && <div role="status" className="mb-6 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg flex items-center gap-2"><Check className="w-5 h-5 flex-shrink-0" />{success}<button onClick={() => setSuccess('')} className="ml-auto text-green-500 hover:text-green-700 dark:hover:text-green-300">&times;</button></div>}

      <div className="space-y-4">
        <SectionLabel label="Domain" />
        <GuideCard icon={<Globe className="w-6 h-6 text-sky-600" />} iconBg="bg-sky-100 dark:bg-sky-500/20" title="Custom Domain (DNS)" description="Point your domain to your CRM so customers see your brand." expanded={expandedGuide === 'dns'} onToggle={() => setExpandedGuide(expandedGuide === 'dns' ? null : 'dns')}
          steps={['Log into your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)', 'Go to DNS settings for your domain', 'Add a CNAME record pointing your subdomain (e.g. crm.yourdomain.com) to your CRM URL shown above', 'Save changes — DNS propagation can take up to 24 hours', 'Once propagated, your CRM will be accessible at your custom domain']} />

        <SectionLabel label="Accounting" />
        <Card icon={<BookOpen className="w-6 h-6 text-green-600 dark:text-green-400" />} iconBg="bg-green-100 dark:bg-green-500/20" title="QuickBooks" description={copy.quickbooks}
          body={status.quickbooks.configured === false ? (
            // The server has no QuickBooks credentials, so "Connect QuickBooks" cannot work: it answered
            // 503 "not enabled for this CRM yet" AFTER the click. The status endpoint has always carried
            // "configured" for exactly this and the card ignored it, so the one fact needed was already
            // on the page. Say it first, and offer the remedy the 503 names. (Salon T27 N15)
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Not available on your account yet. Email <a href="mailto:support@twomiah.com" className="text-blue-600 dark:text-blue-400 hover:underline">support@twomiah.com</a> and we will switch it on.</p>
          ) : status.quickbooks.connected && (
            <div className="mt-2 text-sm space-y-1">
              <p className="text-green-600 dark:text-green-400 font-medium">Connected{status.quickbooks.companyName ? ` to ${status.quickbooks.companyName}` : ''}</p>
              {status.quickbooks.lastSync && <p className="text-gray-500 dark:text-slate-400">Last synced: {new Date(status.quickbooks.lastSync).toLocaleString()}</p>}
              <button onClick={qbAutoSync} disabled={saving === 'autosync'} className="flex items-center gap-2 text-gray-700 dark:text-slate-300" data-testid="qb-autosync">
                {saving === 'autosync' ? <Loader2 className="w-8 h-8 text-gray-400 animate-spin" /> : status.quickbooks.syncEnabled ? <ToggleRight className="w-8 h-8 text-green-500" /> : <ToggleLeft className="w-8 h-8 text-gray-300 dark:text-slate-600" />}
                <span className="text-sm">Auto-sync new invoices and customers</span>
              </button>
            </div>
          )}
          actions={status.quickbooks.configured === false ? null : status.quickbooks.connected ? (<>
            <button onClick={qbSync} disabled={saving === 'sync'} className="px-3 py-2 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1">{saving === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Sync Now</button>
            <button onClick={qbDisconnect} disabled={saving === 'quickbooks'} className="px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">Disconnect</button>
          </>) : (
            <button onClick={qbConnect} disabled={saving === 'qb-connect'} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">Connect QuickBooks<ExternalLink className="w-4 h-4" /></button>
          )} />

        <SectionLabel label="Payments" />
        <Card icon={<CreditCard className="w-6 h-6 text-purple-600 dark:text-purple-400" />} iconBg="bg-purple-100 dark:bg-purple-500/20" title="Stripe Payments" description="Accept credit card payments from customers."
          body={status.stripe.connected && (
            <div className="mt-2 text-sm">
              {status.stripe.chargesEnabled ? <p className="text-green-600 dark:text-green-400 font-medium">Ready to accept payments</p>
                : <div className="flex items-center gap-3 flex-wrap"><p className="text-yellow-600 dark:text-yellow-400 font-medium">Setup incomplete — Stripe still needs a few details before payments can be accepted.</p><button onClick={stripeConnect} className="text-sm text-purple-600 hover:underline">Finish setup</button></div>}
            </div>
          )}
          actions={status.stripe.connected
            ? <button onClick={stripeDisconnect} disabled={saving === 'stripe'} className="px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">Disconnect</button>
            : <button onClick={stripeConnect} disabled={saving === 'stripe-connect'} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2">Connect Stripe<ExternalLink className="w-4 h-4" /></button>} />

        <SectionLabel label="Communication" />
        <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 rounded-xl flex items-center justify-center flex-shrink-0"><Phone className="w-6 h-6 text-red-600 dark:text-red-400" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div><h3 className="font-semibold text-gray-900 dark:text-white">Twilio (Two-Way Texting)</h3><p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Send and receive SMS with customers directly from your CRM.</p></div>
                {status.twilio.configured && <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2 py-1 rounded-full whitespace-nowrap">{status.twilio.ownAccount ? 'Your account' : 'Platform number'}</span>}
              </div>
              {status.twilio.ownAccount ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-green-600 dark:text-green-400">Phone: {status.twilio.phoneNumber}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+15551234567" aria-label="Test text recipient" className="px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white w-44" />
                    <button onClick={testSms} disabled={saving === 'testsms'} className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1">{saving === 'testsms' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send test text</button>
                    <button onClick={copyWebhookUrl} className="px-3 py-2 text-sm text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1"><Copy className="w-4 h-4" />Copy webhook URL</button>
                    <button onClick={twilioDisconnect} disabled={saving === 'twilio-off'} className="px-3 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg">Remove</button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 break-all">Set this as the number's messaging webhook in Twilio: {typeof window !== 'undefined' ? `${window.location.origin}/api/sms/webhook/incoming` : '/api/sms/webhook/incoming'}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {status.twilio.configured && <p className="text-sm text-gray-600 dark:text-slate-300">Texting currently uses the platform number{status.twilio.phoneNumber ? ` ${status.twilio.phoneNumber}` : ''}. Add your own Twilio account to text from your number.</p>}
                  <p className="text-xs text-gray-500 dark:text-slate-400">Don't have Twilio? <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">Create a free account</a></p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Account SID</label><input type="text" value={twilioForm.accountSid} onChange={(e) => setTwilioForm((f) => ({ ...f, accountSid: e.target.value }))} placeholder="ACxxxxxxxxxx" className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white" /></div>
                    <div><label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Auth Token</label>
                      <div className="relative"><input type={showTwilioToken ? 'text' : 'password'} value={twilioForm.authToken} onChange={(e) => setTwilioForm((f) => ({ ...f, authToken: e.target.value }))} placeholder="Your auth token" className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white pr-9" />
                        <button type="button" onClick={() => setShowTwilioToken(!showTwilioToken)} aria-label={showTwilioToken ? 'Hide token' : 'Show token'} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-slate-400">{showTwilioToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div></div>
                  </div>
                  <div><label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Twilio Phone Number</label><input type="tel" value={twilioForm.phoneNumber} onChange={(e) => setTwilioForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="+15551234567" className="w-full px-3 py-2 text-sm border dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white sm:max-w-xs" /></div>
                  <button onClick={twilioSave} disabled={saving === 'twilio'} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 flex items-center gap-2">{saving === 'twilio' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Save Twilio Config</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <ToggleCard icon={<MessageSquare className="w-6 h-6 text-blue-600 dark:text-blue-400" />} iconBg="bg-blue-100 dark:bg-blue-500/20" title="SMS Notifications" description={copy.sms} enabled={status.sms.enabled} usage={`${status.sms.usage} messages`} busy={saving === 'sms'} onToggle={() => toggle('sms')} onColor="text-blue-500" />
        <ToggleCard icon={<Mail className="w-6 h-6 text-orange-600 dark:text-orange-400" />} iconBg="bg-orange-100 dark:bg-orange-500/20" title="Email" description={copy.email} enabled={status.email.enabled} usage={`${status.email.usage} emails`} busy={saving === 'email'} onToggle={() => toggle('email')} onColor="text-orange-500" />

        <SectionLabel label="Lead Sources" />
        {leadSources.map((g) => (
          <GuideCard key={g.id} icon={<Search className={`w-6 h-6 ${TONE[g.tone || 'emerald'].icon}`} />} iconBg={TONE[g.tone || 'emerald'].bg} title={g.title} description={g.description} expanded={expandedGuide === g.id} onToggle={() => setExpandedGuide(expandedGuide === g.id ? null : g.id)} steps={g.steps} />
        ))}
      </div>

      <div className="mt-6 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
        <p className="text-sm text-gray-600 dark:text-slate-400"><strong>Texting &amp; email usage:</strong> texts are billed at cost from a prepaid wallet you top up in Settings › Billing; transactional email is included. Nothing is sent when the wallet is empty.</p>
      </div>
    </div>
  )
}

const TONE: Record<string, { icon: string; bg: string }> = {
  emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-500/20' }, blue: { icon: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-500/20' },
  indigo: { icon: 'text-indigo-600', bg: 'bg-indigo-100 dark:bg-indigo-500/20' }, pink: { icon: 'text-pink-600', bg: 'bg-pink-100 dark:bg-pink-500/20' }, sky: { icon: 'text-sky-600', bg: 'bg-sky-100 dark:bg-sky-500/20' },
}

function SectionLabel({ label }: { label: string }) {
  return <h2 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider pt-4 first:pt-0">{label}</h2>
}
function Card({ icon, iconBg, title, description, body, actions }: { icon: React.ReactNode; iconBg: string; title: string; description: string; body?: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>{icon}</div>
          <div className="min-w-0"><h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3><p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{description}</p>{body}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      </div>
    </div>
  )
}
function ToggleCard({ icon, iconBg, title, description, enabled, usage, busy, onToggle, onColor }: { icon: React.ReactNode; iconBg: string; title: string; description: string; enabled: boolean; usage: string; busy: boolean; onToggle: () => void; onColor: string }) {
  return (
    <Card icon={icon} iconBg={iconBg} title={title} description={description}
      body={enabled && <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">Usage this month: <span className="font-medium">{usage}</span></p>}
      actions={<button onClick={onToggle} disabled={busy} className="flex items-center" aria-pressed={enabled} aria-label={`${title} ${enabled ? 'on' : 'off'}`}>{busy ? <Loader2 className="w-10 h-10 text-gray-400 animate-spin" /> : enabled ? <ToggleRight className={`w-10 h-10 ${onColor}`} /> : <ToggleLeft className="w-10 h-10 text-gray-300 dark:text-slate-600" />}</button>} />
  )
}
function GuideCard({ icon, iconBg, title, description, expanded, onToggle, steps }: { icon: React.ReactNode; iconBg: string; title: string; description: string; expanded: boolean; onToggle: () => void; steps: string[] }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border dark:border-slate-700 overflow-hidden transition-all ${expanded ? 'ring-2 ring-orange-200 dark:ring-orange-500/30' : ''}`}>
      <button onClick={onToggle} className="w-full flex items-center gap-4 p-6 text-left" aria-expanded={expanded}>
        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>{icon}</div>
        <div className="flex-1 min-w-0"><h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3><p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{description}</p></div>
        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="px-6 pb-6 border-t dark:border-slate-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mt-4 mb-3">How to set up:</h4>
          <ol className="space-y-2">{steps.map((step, idx) => (
            <li key={idx} className="flex items-start gap-3 text-sm text-gray-600 dark:text-slate-400"><span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center flex-shrink-0 text-xs font-semibold mt-0.5">{idx + 1}</span>{step}</li>
          ))}</ol>
        </div>
      )}
    </div>
  )
}
