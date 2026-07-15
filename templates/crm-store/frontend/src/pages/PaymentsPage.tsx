import { useEffect, useState } from 'react'
import { CreditCard, CheckCircle2, Copy } from 'lucide-react'
import api, { PaymentStatus } from '../services/api'
import { useToast } from '../contexts/ToastContext'

export default function PaymentsPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ provider: 'stripe', mode: 'test', secretKey: '', publishableKey: '', webhookSecret: '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.getPaymentStatus().then(setStatus).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const connect = async () => {
    setSaving(true)
    try {
      await api.connectPayment(form)
      toast('Payment account connected')
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
            <div>Webhook secret: {status?.config?.hasWebhookSecret ? 'set' : <span className="text-yellow-600">not set — orders won&apos;t auto-confirm</span>}</div>
          </div>
          <button onClick={disconnect} className="btn-danger mt-4 text-xs">Disconnect</button>
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-gray-500"><CreditCard className="h-5 w-5" /> Not connected — your store can't accept orders yet.</div>
        </div>
      )}

      {/* Webhook URL */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900">1. Add this webhook in your provider dashboard</h2>
        <p className="text-sm text-gray-500 mt-1 mb-2">Create a webhook for the <code>checkout.session.completed</code> event pointing to:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-gray-50 border px-3 py-2 text-xs break-all">{status?.webhookUrl}</code>
          <button onClick={copyWebhook} className="btn-secondary text-xs"><Copy className="h-3 w-3" /> Copy</button>
        </div>
      </div>

      {/* Connect form */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">2. Enter your {form.provider} keys</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Provider</label>
            <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="stripe">Stripe</option>
              <option value="square" disabled>Square (soon)</option>
              <option value="paypal" disabled>PayPal (soon)</option>
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
          <label className="label">Secret key</label>
          <input className="input" type="password" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} placeholder="sk_test_… or sk_live_…" />
          <p className="text-xs text-gray-400 mt-1">Stored encrypted. Never shown again or sent to your storefront.</p>
        </div>
        <div>
          <label className="label">Publishable key <span className="text-gray-400">(optional)</span></label>
          <input className="input" value={form.publishableKey} onChange={(e) => setForm({ ...form, publishableKey: e.target.value })} placeholder="pk_test_…" />
        </div>
        <div>
          <label className="label">Webhook signing secret</label>
          <input className="input" type="password" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder="whsec_…" />
          <p className="text-xs text-gray-400 mt-1">From the webhook you created in step 1. Required for orders to auto-confirm.</p>
        </div>
        <button onClick={connect} className="btn-primary" disabled={saving || !form.secretKey}>{saving ? 'Verifying…' : connected ? 'Update keys' : 'Connect'}</button>
      </div>
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
