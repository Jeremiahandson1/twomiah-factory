import { useEffect, useState } from 'react'
import { CreditCard, CheckCircle2, Copy } from 'lucide-react'
import api, { PaymentStatus } from '../services/api'
import { useToast } from '../contexts/ToastContext'

// What the merchant pastes for each provider (all stored encrypted per-tenant).
// `pub` is the second credential — optional for Stripe, required for Square/PayPal.
const PROVIDER_FIELDS: Record<string, {
  secret: string; secretPh: string; pub: string; pubPh: string; pubRequired: boolean; webhook: string; webhookPh: string
}> = {
  stripe: { secret: 'Secret key', secretPh: 'sk_test_… or sk_live_…', pub: 'Publishable key (optional)', pubPh: 'pk_test_…', pubRequired: false, webhook: 'Webhook signing secret', webhookPh: 'whsec_…' },
  square: { secret: 'Access token', secretPh: 'EAAA… (Square access token)', pub: 'Location ID', pubPh: 'L… (your Square location)', pubRequired: true, webhook: 'Webhook signature key', webhookPh: 'From your Square webhook subscription' },
  paypal: { secret: 'Client secret', secretPh: 'PayPal app client secret', pub: 'Client ID', pubPh: 'PayPal app client ID', pubRequired: true, webhook: 'Webhook ID', webhookPh: 'WH-… (PayPal webhook id)' },
}

export default function PaymentsPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ provider: 'stripe', mode: 'test', secretKey: '', publishableKey: '', webhookSecret: '' })
  const [saving, setSaving] = useState(false)
  const f = PROVIDER_FIELDS[form.provider] || PROVIDER_FIELDS.stripe

  const load = () => api.getPaymentStatus().then(setStatus).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const connect = async () => {
    setSaving(true)
    try {
      const res: any = await api.connectPayment(form)
      if (res?.webhookConfigured) toast('Connected \u2014 payment notifications set up automatically')
      else toast('Connected, but payment notifications need attention: ' + (res?.webhookNote || 'no webhook configured') + '. Orders still confirm on the customer\u2019s receipt page.', 'error')
      setForm({ ...form, secretKey: '', webhookSecret: '' })
      load()
    } catch (e: any) { toast(e?.message || 'Could not connect', 'error') } finally { setSaving(false) }
  }
  const disconnect = async () => {
    if (!confirm('Disconnect payments? Your store will stop accepting orders.')) return
    await api.disconnectPayment(); toast('Disconnected'); load()
  }
  const copyWebhook = () => { if (status?.webhookUrl) { navigator.clipboard.writeText(status.webhookUrl); toast('Webhook URL copied') } }

  if (loading) return <PageSpinner />
  const connected = status?.config?.connected

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Payments</h1>

      {connected ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-green-600 font-medium"><CheckCircle2 className="h-5 w-5" /> Connected</div>
          <div className="mt-3 text-sm text-gray-600 space-y-1">
            <div>Provider: <span className="font-medium capitalize">{status?.config?.provider}</span></div>
            <div>Mode: <span className="font-medium capitalize">{status?.config?.mode}</span>{status?.config?.mode === 'test' && ' (no real charges)'}</div>
            <div>Payment notifications: {status?.config?.hasWebhookSecret ? 'active' : <span className="text-yellow-600">not set up &mdash; orders confirm on the customer&apos;s receipt page instead</span>}</div>
          </div>
          <button onClick={disconnect} className="btn-danger mt-4 text-xs">Disconnect</button>
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-gray-500"><CreditCard className="h-5 w-5" /> Not connected — your store can't accept orders yet.</div>
        </div>
      )}

      {/* Connect form */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Connect your {form.provider} account</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Provider</label>
            <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="stripe">Stripe</option>
              <option value="square">Square</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">{f.secret}</label>
          <input className="input" type="password" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} placeholder={f.secretPh} />
          <p className="text-xs text-gray-400 mt-1">Stored encrypted. Never shown again or sent to your storefront.</p>
        </div>
        <div>
          <label className="label">{f.pub}</label>
          <input className="input" value={form.publishableKey} onChange={(e) => setForm({ ...form, publishableKey: e.target.value })} placeholder={f.pubPh} />
        </div>
        <p className="text-xs text-gray-500">We{"'"}ll set up payment notifications (the webhook) in your {form.provider} account automatically when you connect.</p>
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Advanced: configure the webhook yourself</summary>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1">Point your webhook at:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-gray-50 border px-3 py-2 text-xs break-all">{status?.webhookUrl}</code>
                <button onClick={copyWebhook} className="btn-secondary text-xs"><Copy className="h-3 w-3" /> Copy</button>
              </div>
            </div>
            <div>
              <label className="label">{f.webhook}</label>
              <input className="input" type="password" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder={f.webhookPh} />
              <p className="text-xs text-gray-400 mt-1">Leave blank to let us create the webhook for you.</p>
            </div>
          </div>
        </details>
        <button onClick={connect} className="btn-primary" disabled={saving || !form.secretKey || (f.pubRequired && !form.publishableKey)}>{saving ? 'Verifying…' : connected ? 'Update keys' : 'Connect'}</button>
      </div>
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
