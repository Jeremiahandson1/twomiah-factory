import { useEffect, useState } from 'react'
import { Truck, CheckCircle2 } from 'lucide-react'
import api, { type ShippingConfig } from '../services/api'
import { useToast } from '../contexts/ToastContext'

// Carrier account for buying labels. Mirrors PaymentsPage/SuppliersPage:
// connect once, then buy a label from any order.
export default function ShippingPage() {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<ShippingConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'test' | 'live'>('test')
  const [from, setFrom] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US', phone: '' })
  const [parcel, setParcel] = useState({ lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 16 })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const c = await api.shippingConfig()
      setCfg(c)
      if (c.fromAddress) setFrom({ name: '', line2: '', phone: '', ...(c.fromAddress as any) })
      if (c.defaultParcel) setParcel(c.defaultParcel)
      if (c.mode === 'live' || c.mode === 'test') setMode(c.mode)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not load shipping settings', 'error')
    }
  }

  useEffect(() => { void load() }, [])

  const connect = async () => {
    setSaving(true)
    try {
      await api.connectShipping({
        provider: 'easypost',
        apiKey,
        mode,
        fromAddress: { ...from, line2: from.line2 || undefined, phone: from.phone || undefined },
        defaultParcel: parcel,
      })
      setApiKey('')
      toast('Carrier connected')
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not connect', 'error')
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Disconnect the carrier? You can still enter tracking numbers by hand.')) return
    try {
      await api.disconnectShipping()
      toast('Disconnected')
      void load()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not disconnect', 'error')
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Shipping labels</h1>
        <p className="text-gray-500">Connect a carrier account to buy and print labels straight from an order.</p>
      </div>

      {cfg?.connected && (
        <div className="card p-4 flex items-center justify-between">
          <span className="flex items-center gap-2 text-green-700"><CheckCircle2 className="h-4 w-4" /> Connected to {cfg.provider} ({cfg.mode})</span>
          <button onClick={disconnect} className="btn-secondary">Disconnect</button>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Truck className="h-4 w-4" /> EasyPost</h2>
        <p className="text-sm text-gray-500">
          One account covers USPS, UPS and FedEx. Test mode gives real label URLs without buying postage.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">API key</label>
            <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={cfg?.connected ? 'Saved — enter a new key to replace it' : 'EasyPost → API Keys'} />
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>

        <h3 className="font-medium text-gray-900 pt-2">Ship from</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="label">Name</label><input className="input" value={from.name} onChange={(e) => setFrom({ ...from, name: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input" value={from.phone} onChange={(e) => setFrom({ ...from, phone: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={from.line1} onChange={(e) => setFrom({ ...from, line1: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Address line 2</label><input className="input" value={from.line2} onChange={(e) => setFrom({ ...from, line2: e.target.value })} /></div>
          <div><label className="label">City</label><input className="input" value={from.city} onChange={(e) => setFrom({ ...from, city: e.target.value })} /></div>
          <div><label className="label">State</label><input className="input" value={from.state} onChange={(e) => setFrom({ ...from, state: e.target.value })} /></div>
          <div><label className="label">Postal code</label><input className="input" value={from.postalCode} onChange={(e) => setFrom({ ...from, postalCode: e.target.value })} /></div>
          <div><label className="label">Country</label><input className="input" value={from.country} onChange={(e) => setFrom({ ...from, country: e.target.value })} /></div>
        </div>

        <h3 className="font-medium text-gray-900 pt-2">Default parcel</h3>
        <p className="text-sm text-gray-500">Used for quotes and labels unless you change it later per order.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Length (in)</label><input type="number" className="input" value={parcel.lengthIn} onChange={(e) => setParcel({ ...parcel, lengthIn: Number(e.target.value) })} /></div>
          <div><label className="label">Width (in)</label><input type="number" className="input" value={parcel.widthIn} onChange={(e) => setParcel({ ...parcel, widthIn: Number(e.target.value) })} /></div>
          <div><label className="label">Height (in)</label><input type="number" className="input" value={parcel.heightIn} onChange={(e) => setParcel({ ...parcel, heightIn: Number(e.target.value) })} /></div>
          <div><label className="label">Weight (oz)</label><input type="number" className="input" value={parcel.weightOz} onChange={(e) => setParcel({ ...parcel, weightOz: Number(e.target.value) })} /></div>
        </div>

        <button onClick={connect} disabled={saving || (!apiKey && !cfg?.connected) || !from.line1 || !from.postalCode} className="btn-primary">
          {saving ? 'Saving…' : cfg?.connected ? 'Update carrier settings' : 'Connect carrier'}
        </button>
      </div>
    </div>
  )
}
