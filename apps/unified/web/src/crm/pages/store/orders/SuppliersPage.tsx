// Moved from templates/crm-store/frontend/src/pages/SuppliersPage.tsx — the dropship supplier at /crm/suppliers:
// connect Printful or CJ once, and paid orders forward themselves with tracking flowing back.
//
// Changes from the template:
//   · the calls are the unified server's (server/crm/store/orders/suppliers.ts): GET /api/admin/suppliers and POST
//     …/connect answer as before ({ config } / { config, webhookConfigured, trackingNote }); POST …/disconnect answers
//     { success: true } (was { ok }); POST …/auto-forward { success, autoForward } (was { ok, autoForward }); a refused
//     connect is { error, code, fields } and its sentence is shown;
//   · Disconnect and the auto-forward switch had no error handling (a refusal was an unhandled rejection and the toast
//     still claimed it worked); both now say what the server said, and the switch is held while it saves;
//   · connecting Printful sent accountEmail: '' — which the server's schema refuses as an invalid email — so every
//     Printful connect was a 400 "Invalid supplier credentials"; the email is sent only for CJ, which needs it;
//   · a failed load says so (PageError) instead of reading "No supplier connected";
//   · Disconnect asks through the app's confirm dialog (was native confirm());
//   · the connect form's two-column row stacks at phone width; every ink has its dark partner.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Truck } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useKnownPermission, useToast } from '../../../../shared'

interface SupplierStatus { config: { provider: string; mode: string; connected: boolean; autoForward: boolean } | null }

const PROVIDER_FIELDS: Record<string, { name: string; keyLabel: string; keyPh: string; needsEmail: boolean; blurb: string }> = {
  printful: {
    name: 'Printful', keyLabel: 'Printful API token', keyPh: 'Printful → Settings → Stores → API',
    needsEmail: false,
    blurb: 'Print-on-demand. Link each variant to your Printful sync variant; test mode creates draft orders (nothing is charged or produced).',
  },
  cj: {
    name: 'CJ Dropshipping', keyLabel: 'CJ API key', keyPh: 'CJ → My CJ → Authorization → API',
    needsEmail: true,
    blurb: 'General-goods dropshipping (AliExpress-style). Link variants by CJ vid; tracking syncs on an hourly check.',
  },
}

export default function SuppliersPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<SupplierStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ provider: 'printful', mode: 'test', apiKey: '', accountEmail: '' })
  const [saving, setSaving] = useState(false)
  const [switching, setSwitching] = useState(false)
  const f = PROVIDER_FIELDS[form.provider] || PROVIDER_FIELDS.printful

  // The supplier connection is the owner's (integrations:update). The menu hides this page from everyone else; reached
  // by its address, it says so instead of a form every button of which is refused.
  const mayManage = useKnownPermission('integrations:update')

  const load = useCallback(async () => {
    try {
      setStatus(await api.get('/api/admin/suppliers') as SupplierStatus)
      setError('')
    } catch (e) {
      setError(errorText(e, "Couldn't load the supplier connection"))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (mayManage === true) void load()
    else if (mayManage === false) setLoading(false)
  }, [mayManage, load])

  const connect = async () => {
    setSaving(true)
    try {
      const body = { provider: form.provider, mode: form.mode, apiKey: form.apiKey, ...(f.needsEmail ? { accountEmail: form.accountEmail } : {}) }
      const res = await api.post('/api/admin/suppliers/connect', body) as { webhookConfigured?: boolean; trackingNote?: string | null }
      if (res?.webhookConfigured) toast.success('Supplier connected — shipment notifications set up automatically')
      else toast.success(`Supplier connected. ${res?.trackingNote || ''}`.trim())
      setForm((prev) => ({ ...prev, apiKey: '' }))
      void load()
    } catch (e) { toast.error(errorText(e, 'Could not connect')) } finally { setSaving(false) }
  }
  const disconnect = async () => {
    if (!(await confirm('Disconnect the supplier? Paid orders will stop auto-forwarding.', { title: 'Disconnect supplier', confirmText: 'Disconnect' }))) return
    try {
      await api.post('/api/admin/suppliers/disconnect')
      toast.success('Disconnected')
      void load()
    } catch (e) { toast.error(errorText(e, 'Could not disconnect')) }
  }
  const toggleAuto = async (enabled: boolean) => {
    setSwitching(true)
    try {
      await api.post('/api/admin/suppliers/auto-forward', { enabled })
      toast.success(enabled ? 'Orders will forward automatically when paid' : 'Auto-forward off — forward orders from the order page')
      void load()
    } catch (e) { toast.error(errorText(e, 'Could not change auto-forward')) } finally { setSwitching(false) }
  }

  if (mayManage === false) return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-3">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Suppliers</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400">The supplier connection is managed by the store owner.</p>
    </div>
  )
  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-orange-500 dark:border-slate-700 dark:border-t-orange-400" /></div>
  const connected = !!status?.config?.connected

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Dropshipping: when a customer pays, we place the matching order at your supplier with their address, and tracking flows back to the customer automatically.</p>
        </div>
      </div>

      <PageError message={error} />

      {connected ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-green-700 font-medium dark:text-green-300"><CheckCircle2 className="h-5 w-5" /> Connected</div>
          <div className="mt-3 text-sm text-gray-600 space-y-1 dark:text-slate-300">
            <div>Supplier: <span className="font-medium">{PROVIDER_FIELDS[status?.config?.provider || '']?.name || status?.config?.provider}</span></div>
            <div>Mode: <span className="font-medium capitalize">{status?.config?.mode}</span>{status?.config?.mode === 'test' && ' (orders stay as unconfirmed drafts)'}</div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
            <input type="checkbox" checked={!!status?.config?.autoForward} disabled={switching} onChange={(e) => toggleAuto(e.target.checked)} />
            Forward paid orders to the supplier automatically
          </label>
          <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Only orders where every item is linked to a supplier item are forwarded — everything else stays manual.</p>
          <button onClick={disconnect} className="btn btn-danger mt-4 px-3 py-1.5 text-xs">Disconnect</button>
        </div>
      ) : !error ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-gray-600 dark:text-slate-300"><Truck className="h-5 w-5 shrink-0" /> No supplier connected — orders are fulfilled manually.</div>
        </div>
      ) : null}

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Connect your {f.name} account</h2>
        <p className="text-xs text-gray-500 dark:text-slate-400">{f.blurb}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sup-provider">Supplier</label>
            <select id="sup-provider" className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="printful">Printful (print-on-demand)</option>
              <option value="cj">CJ Dropshipping</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sup-mode">Mode</label>
            <select id="sup-mode" className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
        {f.needsEmail && (
          <div>
            <label className="label" htmlFor="sup-email">CJ account email</label>
            <input id="sup-email" className="input" type="email" value={form.accountEmail} onChange={(e) => setForm({ ...form, accountEmail: e.target.value })} placeholder="you@example.com" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="sup-key">{f.keyLabel}</label>
          <input id="sup-key" className="input" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={f.keyPh} />
          <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Stored encrypted. We&apos;ll set up shipment notifications automatically where the supplier supports it.</p>
        </div>
        <button onClick={connect} className="btn btn-primary" disabled={saving || !form.apiKey || (f.needsEmail && !form.accountEmail)}>{saving ? 'Verifying…' : connected ? 'Update connection' : 'Connect'}</button>
      </div>

      <div className="card p-5 text-sm text-gray-600 dark:text-slate-300">
        <h2 className="font-semibold text-gray-900 mb-2 dark:text-slate-100">Next step</h2>
        Link each product variant to its supplier item on the product page — orders only forward when every item in them is linked.
      </div>
    </div>
  )
}
