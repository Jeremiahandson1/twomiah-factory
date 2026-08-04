import { useEffect, useState } from 'react'
import { Truck, CheckCircle2 } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

// Dropship supplier connection — mirrors PaymentsPage. Connect once; paid
// orders forward themselves and tracking flows back automatically.

const PROVIDER_FIELDS: Record<string, { keyLabel: string; keyPh: string; needsEmail: boolean; blurb: string }> = {
  printful: {
    keyLabel: 'Printful API token', keyPh: 'Printful → Settings → Stores → API',
    needsEmail: false,
    blurb: 'Print-on-demand. Link each variant to your Printful sync variant; test mode creates draft orders (nothing is charged or produced).',
  },
  cj: {
    keyLabel: 'CJ API key', keyPh: 'CJ → My CJ → Authorization → API',
    needsEmail: true,
    blurb: 'General-goods dropshipping (AliExpress-style). Link variants by CJ vid; tracking syncs on an hourly check.',
  },
}

export default function SuppliersPage() {
  const { toast } = useToast()
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ provider: 'printful', mode: 'test', apiKey: '', accountEmail: '' })
  const [saving, setSaving] = useState(false)
  const f = PROVIDER_FIELDS[form.provider] || PROVIDER_FIELDS.printful

  const load = () => api.getSupplierStatus().then(setStatus).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const connect = async () => {
    setSaving(true)
    try {
      const res: any = await api.connectSupplier(form)
      if (res?.webhookConfigured) toast('Supplier connected — shipment notifications set up automatically')
      else toast('Supplier connected. ' + (res?.trackingNote || ''))
      setForm({ ...form, apiKey: '' })
      load()
    } catch (e: any) { toast(e?.message || 'Could not connect', 'error') } finally { setSaving(false) }
  }
  const disconnect = async () => {
    if (!confirm('Disconnect the supplier? Paid orders will stop auto-forwarding.')) return
    await api.disconnectSupplier(); toast('Disconnected'); load()
  }
  const toggleAuto = async (enabled: boolean) => {
    await api.setSupplierAutoForward(enabled)
    toast(enabled ? 'Orders will forward automatically when paid' : 'Auto-forward off — forward orders from the order page')
    load()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
  const connected = status?.config?.connected

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
      <p className="text-sm text-gray-500 -mt-4">Dropshipping: when a customer pays, we place the matching order at your supplier with their address, and tracking flows back to the customer automatically.</p>

      {connected ? (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-green-600 font-medium"><CheckCircle2 className="h-5 w-5" /> Connected</div>
          <div className="mt-3 text-sm text-gray-600 space-y-1">
            <div>Supplier: <span className="font-medium capitalize">{status?.config?.provider}</span></div>
            <div>Mode: <span className="font-medium capitalize">{status?.config?.mode}</span>{status?.config?.mode === 'test' && ' (orders stay as unconfirmed drafts)'}</div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!status?.config?.autoForward} onChange={(e) => toggleAuto(e.target.checked)} />
            Forward paid orders to the supplier automatically
          </label>
          <p className="text-xs text-gray-400 mt-1">Only orders where every item is linked to a supplier item are forwarded — everything else stays manual.</p>
          <button onClick={disconnect} className="btn-danger mt-4 text-xs">Disconnect</button>
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-center gap-2 text-gray-500"><Truck className="h-5 w-5" /> No supplier connected — orders are fulfilled manually.</div>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Connect your {form.provider === 'cj' ? 'CJ Dropshipping' : 'Printful'} account</h2>
        <p className="text-xs text-gray-500">{f.blurb}</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Supplier</label>
            <select className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              <option value="printful">Printful (print-on-demand)</option>
              <option value="cj">CJ Dropshipping</option>
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
        {f.needsEmail && (
          <div>
            <label className="label">CJ account email</label>
            <input className="input" value={form.accountEmail} onChange={(e) => setForm({ ...form, accountEmail: e.target.value })} placeholder="you@example.com" />
          </div>
        )}
        <div>
          <label className="label">{f.keyLabel}</label>
          <input className="input" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={f.keyPh} />
          <p className="text-xs text-gray-400 mt-1">Stored encrypted. We&apos;ll set up shipment notifications automatically where the supplier supports it.</p>
        </div>
        <button onClick={connect} className="btn-primary" disabled={saving || !form.apiKey || (f.needsEmail && !form.accountEmail)}>{saving ? 'Verifying…' : connected ? 'Update connection' : 'Connect'}</button>
      </div>

      <div className="card p-5 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900 mb-2">Next step</h2>
        Link each product variant to its supplier item on the product page — orders only forward when every item in them is linked.
      </div>
    </div>
  )
}
