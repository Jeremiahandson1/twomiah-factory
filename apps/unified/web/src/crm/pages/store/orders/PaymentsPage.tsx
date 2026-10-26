// Moved from templates/crm-store/frontend/src/pages/PaymentsPage.tsx — the merchant's own payment processor at
// /crm/payments: which one is connected and in which mode, and (for the owner) connecting, replacing or disconnecting
// their Stripe, Square or PayPal keys.
//
// Changes from the template:
//   · the calls are the unified server's (server/crm/store/checkout/paymentRoutes.ts): GET /api/admin/payments and
//     POST …/connect answer as before ({ config, webhookUrl } / { config, webhookConfigured, webhookNote }); POST
//     …/disconnect answers { success: true } (was { ok: true }); a refused connect is { error, code, fields } and its
//     sentence is shown;
//   · a failed load says so (PageError) — the template swallowed it and read "Not connected", telling a shop that takes
//     orders that it could not;
//   · Disconnect asks through the app's confirm dialog (was native confirm()) and handles a refusal (the template's had
//     no catch: a refused disconnect still toasted "Disconnected"); Copy handles a browser that refuses the clipboard;
//   · the form's heading names the provider as it is written ("Connect your Stripe account", was "stripe");
//   · the connect form's two-column rows stack at phone width; the hover and border colours gained their dark partners
//     (the Advanced summary's hover, the webhook URL box's border).
//   · Stripe is the business's CONNECTED account, as everywhere else in the app (owner's decision, 2026-10-26): the
//     Stripe card offers the same two buttons as Settings › Integrations ("I already have a Stripe account" / "Create a
//     new Stripe account" — the same endpoints, so the same flow, returning to Settings › Integrations), and shows the
//     connection's state. No Stripe secret key is ever pasted; the key form is Square's and PayPal's. A store still on
//     Stripe keys pasted before is told, prominently, to connect instead (they work until it does).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Copy, CreditCard, ExternalLink } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'

interface PaymentStatus {
  config: { provider: string; via?: 'connect' | 'keys'; mode: string; publishableKey: string | null; connected: boolean; hasWebhookSecret: boolean; updatedAt: string | null } | null
  /** A store on Stripe keys pasted before Connect: they work until the owner connects Stripe. */
  stripeKeysToReplace?: boolean
  webhookUrl: string
}
/** Settings › Integrations' Stripe state (GET /api/integrations/status .stripe) — the same card's facts. */
interface StripeConnectState { connected: boolean; chargesEnabled: boolean; configured?: boolean; linked?: boolean; linkAvailable?: boolean }

// What the merchant pastes for each key-based provider (all stored encrypted per company). Stripe is not one: it is
// connected, never pasted. `pub` is the second credential, required for both.
const PROVIDER_FIELDS: Record<string, {
  label: string; secret: string; secretPh: string; pub: string; pubPh: string; pubRequired: boolean; webhook: string; webhookPh: string
}> = {
  square: { label: 'Square', secret: 'Access token', secretPh: 'EAAA… (Square access token)', pub: 'Location ID', pubPh: 'L… (your Square location)', pubRequired: true, webhook: 'Webhook signature key', webhookPh: 'From your Square webhook subscription' },
  paypal: { label: 'PayPal', secret: 'Client secret', secretPh: 'PayPal app client secret', pub: 'Client ID', pubPh: 'PayPal app client ID', pubRequired: true, webhook: 'Webhook ID', webhookPh: 'WH-… (PayPal webhook id)' },
}

export default function PaymentsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  // Connecting or disconnecting the processor is payments:update on the server (POST /api/admin/payments/connect and
  // /disconnect) — the owner's; a shop has no admin seat. Disconnecting stops the store taking orders at all, so the
  // controls say who may do it rather than handing anyone a 403 after they typed keys.
  const mayConnect = useMayWrite('payments:update')
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ provider: 'square', mode: 'test', secretKey: '', publishableKey: '', webhookSecret: '' })
  const [saving, setSaving] = useState(false)
  const [stripe, setStripe] = useState<StripeConnectState | null>(null)
  const [starting, setStarting] = useState<'link' | 'create' | null>(null)
  const f = PROVIDER_FIELDS[form.provider] || PROVIDER_FIELDS.square

  // The form starts on whatever IS connected: with Square connected it still read "Connect your stripe account" (E2E
  // Run 2) — and reconnecting from it would have sent Square's keys as Stripe's.
  const load = useCallback(async () => {
    try {
      const s = await api.get('/api/admin/payments') as PaymentStatus
      setStatus(s)
      setError('')
      const p = s?.config?.provider, m = s?.config?.mode
      if (p && PROVIDER_FIELDS[p]) setForm((prev) => ({ ...prev, provider: p, ...(m ? { mode: m } : {}) }))
    } catch (e) {
      setError(errorText(e, "Couldn't load the payment settings"))
    } finally {
      setLoading(false)
    }
    // Stripe's side, as Settings › Integrations reads it — the owner's read, so only a seat that may connect asks (no
    // refused request from another seat). Unanswered → the card offers Connect plainly.
    if (mayConnect) {
      try { setStripe(((await api.get('/api/integrations/status')) as { stripe?: StripeConnectState })?.stripe ?? null) } catch { setStripe(null) }
    }
  }, [mayConnect])
  useEffect(() => { void load() }, [load])

  // The same two ways in as Settings › Integrations, by the same endpoints: Stripe sends the owner back there after.
  const stripeStart = async (way: 'link' | 'create') => {
    setStarting(way)
    try {
      if (way === 'link') {
        const d = await api.get('/api/integrations/stripe/link-url') as { linkUrl?: string }
        if (!d?.linkUrl) throw new Error('Stripe did not return a sign-in link')
        window.location.href = d.linkUrl
      } else {
        const d = await api.get('/api/integrations/stripe/connect-url') as { connectUrl?: string }
        if (!d?.connectUrl) throw new Error('Stripe did not return an onboarding link')
        window.location.href = d.connectUrl
      }
    } catch (e) {
      toast.error(errorText(e, way === 'link' ? 'Failed to start the Stripe sign-in' : 'Failed to start Stripe connection'))
      setStarting(null)
    }
  }

  const connect = async () => {
    setSaving(true)
    try {
      const res = await api.post('/api/admin/payments/connect', form) as { webhookConfigured?: boolean; webhookNote?: string | null }
      if (res?.webhookConfigured) toast.success('Connected — payment notifications set up automatically')
      else toast.warning(`Connected, but payment notifications need attention: ${res?.webhookNote || 'no webhook configured'}. Orders still confirm on the customer’s receipt page.`)
      setForm((prev) => ({ ...prev, secretKey: '', webhookSecret: '' }))
      void load()
    } catch (e) { toast.error(errorText(e, 'Could not connect')) } finally { setSaving(false) }
  }
  const disconnect = async () => {
    if (!(await confirm('Disconnect payments? Your store will stop accepting orders.', { title: 'Disconnect payments', confirmText: 'Disconnect' }))) return
    try {
      await api.post('/api/admin/payments/disconnect')
      toast.success('Disconnected')
      void load()
    } catch (e) { toast.error(errorText(e, 'Could not disconnect')) }
  }
  const copyWebhook = async () => {
    if (!status?.webhookUrl) return
    try { await navigator.clipboard.writeText(status.webhookUrl); toast.success('Webhook URL copied') } catch { toast.error('Your browser would not copy it — select the address and copy it by hand.') }
  }

  if (loading) return <PageSpinner />
  const connected = !!status?.config?.connected
  const viaConnect = status?.config?.via === 'connect'
  const keysProvider = connected && status?.config?.provider !== 'stripe' ? (PROVIDER_FIELDS[status?.config?.provider || '']?.label || status?.config?.provider) : null

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Payments</h1>
      </div>

      <PageError message={error} />

      {/* A store on Stripe keys pasted before Connect: still taking orders, but the owner is asked to connect instead. */}
      {mayConnect && status?.stripeKeysToReplace && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" /> Reconnect Stripe</div>
          <p className="mt-1">Your store takes Stripe payments with keys pasted here before. Connect your Stripe account below instead — the keys keep working until you do, and are not used after.</p>
        </div>
      )}

      {connected ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-green-700 font-medium dark:text-green-300"><CheckCircle2 className="h-5 w-5" /> Connected</div>
          <div className="mt-3 text-sm text-gray-600 space-y-1 dark:text-slate-300">
            <div>Provider: <span className="font-medium capitalize">{status?.config?.provider}</span>{viaConnect && ' — your connected Stripe account'}</div>
            <div>Mode: <span className="font-medium capitalize">{status?.config?.mode}</span>{status?.config?.mode === 'test' && ' (no real charges)'}</div>
            <div>Payment notifications: {status?.config?.hasWebhookSecret ? 'active' : <span className="text-amber-800 dark:text-amber-300">not set up — orders confirm on the customer&apos;s receipt page instead</span>}</div>
            {viaConnect && stripe && stripe.connected && !stripe.chargesEnabled && <div className="text-amber-800 dark:text-amber-300">Stripe still needs a few details before it can take cards — finish them in <Link className="underline" to="/crm/settings/integrations">Settings › Integrations</Link>.</div>}
          </div>
          {/* A connected account is the business's, shared with its invoices: it is disconnected where it was connected. */}
          {mayConnect && (viaConnect
            ? <p className="mt-4 text-xs text-gray-600 dark:text-slate-300">To disconnect Stripe, open <Link className="underline" to="/crm/settings/integrations">Settings › Integrations</Link>.</p>
            : <button onClick={disconnect} className="btn btn-danger mt-4 px-3 py-1.5 text-xs">Disconnect</button>)}
        </div>
      ) : !error ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-gray-600 dark:text-slate-300"><CreditCard className="h-5 w-5 shrink-0" /> Not connected — your store can't accept orders yet.</div>
        </div>
      ) : null}

      {/* Connect form — the owner's only. A seat without payments:update was handed key fields it could fill in and a
          Connect that never enabled (Store QA T3, manager); there is nothing in a blank key form to read, so it says who
          connects the processor instead, as the Shipping page does for the carrier. */}
      {!mayConnect && (
        <p className="text-sm text-gray-500 dark:text-slate-400">Only the store owner can connect or change the payment processor.</p>
      )}
      {/* Stripe: connected, never pasted — the same two buttons (and endpoints) as Settings › Integrations. */}
      {mayConnect && !viaConnect && (
        <div className="card p-5 space-y-3" data-testid="stripe-connect-card">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Take cards with Stripe</h2>
          {stripe?.configured === false ? (
            <p className="text-sm text-gray-600 dark:text-slate-300">Card payments through Stripe are not set up for this account yet. Email support@twomiah.com and we will switch them on.</p>
          ) : stripe?.connected ? (
            <p className="text-sm text-gray-600 dark:text-slate-300">
              Your Stripe account is connected{stripe.chargesEnabled ? '' : ', but Stripe still needs a few details before it can take cards'} — see <Link className="underline" to="/crm/settings/integrations">Settings › Integrations</Link>.
              {keysProvider && ` Your store takes payments through ${keysProvider} now; disconnect ${keysProvider} above to take them through Stripe instead.`}
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-slate-300">The money goes into your own Stripe account, and Stripe takes its card fee. There is no key to copy — you sign in to Stripe and allow the connection.{keysProvider && ` Your store takes payments through ${keysProvider} now; disconnect it above to take them through Stripe instead.`}</p>
              <div className="flex flex-col sm:flex-row gap-2">
                {stripe?.linkAvailable && (
                  <button onClick={() => void stripeStart('link')} disabled={starting !== null} data-testid="store-stripe-link" className="btn btn-primary justify-center">I already have a Stripe account <ExternalLink className="h-4 w-4" /></button>
                )}
                <button onClick={() => void stripeStart('create')} disabled={starting !== null} data-testid="store-stripe-create" className={`btn ${stripe?.linkAvailable ? 'btn-secondary' : 'btn-primary'} justify-center`}>{stripe?.linkAvailable ? 'Create a new Stripe account' : 'Connect Stripe'} <ExternalLink className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Stripe brings you back to Settings › Integrations when you are done. It is the same Stripe account your invoices use.</p>
            </>
          )}
        </div>
      )}

      {mayConnect && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Or connect your {f.label} account</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="pay-provider">Provider</label>
              <select id="pay-provider" className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                <option value="square">Square</option>
                <option value="paypal">PayPal</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pay-mode">Mode</label>
              <select id="pay-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pay-secret">{f.secret}</label>
            <input id="pay-secret" className="input" type="password" autoComplete="off" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} placeholder={f.secretPh} />
            <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Stored encrypted. Never shown again or sent to your storefront.</p>
          </div>
          <div>
            <label className="label" htmlFor="pay-pub">{f.pub}</label>
            <input id="pay-pub" className="input" value={form.publishableKey} onChange={(e) => setForm({ ...form, publishableKey: e.target.value })} placeholder={f.pubPh} />
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">We&apos;ll set up payment notifications (the webhook) in your {f.label} account automatically when you connect.</p>
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100">Advanced: configure the webhook yourself</summary>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1 dark:text-slate-400">Point your webhook at:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 min-w-0 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 break-all dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">{status?.webhookUrl}</code>
                  <button onClick={copyWebhook} className="btn btn-secondary px-3 py-1.5 text-xs"><Copy className="h-3 w-3" /> Copy</button>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="pay-webhook">{f.webhook}</label>
                <input id="pay-webhook" className="input" type="password" autoComplete="off" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder={f.webhookPh} />
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Leave blank to let us create the webhook for you.</p>
              </div>
            </div>
          </details>
          <button onClick={connect} className="btn btn-primary" disabled={saving || !form.secretKey || (f.pubRequired && !form.publishableKey)}>{saving ? 'Verifying…' : status?.config?.provider === form.provider && connected ? 'Update keys' : 'Connect'}</button>
        </div>
      )}
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
}
