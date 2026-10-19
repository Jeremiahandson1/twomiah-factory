// Moved from templates/crm-store/frontend/src/pages/ShippingPage.tsx — the carrier account for buying labels at
// /crm/shipping: connect EasyPost once, with the ship-from address and the default parcel, then buy a label from any
// order.
//
// Changes from the template:
//   · the calls are the unified server's (server/crm/store/orders/shipping.ts): GET /api/admin/shipping/config answers
//     as before; POST /config answers { success, connected } (was { ok, connected }) and DELETE /config
//     { success, connected: false }; a refused save is { error, code, fields } and its sentence is shown;
//   · "Update carrier settings" with the key box left blank was enabled, and the server — which needs the API key on
//     every save (connectSchema: apiKey, at least 8 characters) — refused it: the key is never sent back, so changing the
//     address or the parcel of a connected account always failed. The button now waits for the key, and the box says
//     to enter it again to save changes;
//   · a failed load says so (PageError) instead of a toast over an empty form; Disconnect asks through the app's confirm
//     dialog (was native confirm());
//   · City is required before saving, as the server requires it (the template let it be blank and showed the 400);
//   · the default parcel's note no longer says it can be changed per order: no order screen or route takes a parcel;
//   · the API key box is a password box (the template showed the key in clear on screen);
//   · the connected banner and the header wrap at phone width; every ink has its dark partner.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Truck } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import type { Address } from './lib'

interface Parcel { lengthIn: number; widthIn: number; heightIn: number; weightOz: number }
interface ShippingConfig { connected: boolean; provider: string | null; mode?: string; defaultParcel: Parcel; fromAddress: Address | null }

/** EasyPost refuses a shorter key (server connectSchema: apiKey min 8). */
const MIN_KEY = 8

export default function ShippingPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const [cfg, setCfg] = useState<ShippingConfig | null>(null)
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<'test' | 'live'>('test')
  const [from, setFrom] = useState({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US', phone: '' })
  const [parcel, setParcel] = useState({ lengthIn: '10', widthIn: '8', heightIn: '4', weightOz: '16' })
  const [saving, setSaving] = useState(false)
  // The carrier account is the manager's (shipping:configure). Staff buy labels from the order page.
  const mayConfigure = useMayWrite('shipping:configure')

  const load = useCallback(async () => {
    try {
      const c = await api.get('/api/admin/shipping/config') as ShippingConfig
      setCfg(c)
      setError('')
      if (c.fromAddress) {
        const a = c.fromAddress
        setFrom({ name: a.name || '', line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', state: a.state || '', postalCode: a.postalCode || '', country: a.country || 'US', phone: a.phone || '' })
      }
      // The API stores these as numbers; the fields hold text while they are being edited, so they are normalised on
      // the way in rather than letting a number sit in a string field.
      if (c.defaultParcel) setParcel({
        lengthIn: String(c.defaultParcel.lengthIn ?? ''),
        widthIn: String(c.defaultParcel.widthIn ?? ''),
        heightIn: String(c.defaultParcel.heightIn ?? ''),
        weightOz: String(c.defaultParcel.weightOz ?? ''),
      })
      if (c.mode === 'live' || c.mode === 'test') setMode(c.mode)
    } catch (e) {
      setError(errorText(e, "Couldn't load the shipping settings"))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const connect = async () => {
    setSaving(true)
    try {
      await api.post('/api/admin/shipping/config', {
        provider: 'easypost',
        apiKey: apiKey.trim(),
        mode,
        fromAddress: { ...from, name: from.name || undefined, line2: from.line2 || undefined, state: from.state || undefined, phone: from.phone || undefined },
        // the fields hold text while they are typed; parcel dimensions become numbers here, once
        defaultParcel: { lengthIn: Number(parcel.lengthIn) || 0, widthIn: Number(parcel.widthIn) || 0, heightIn: Number(parcel.heightIn) || 0, weightOz: Number(parcel.weightOz) || 0 },
      })
      setApiKey('')
      toast.success(cfg?.connected ? 'Carrier settings saved' : 'Carrier connected')
      void load()
    } catch (e) {
      toast.error(errorText(e, 'Could not connect'))
    } finally {
      setSaving(false)
    }
  }

  const disconnect = async () => {
    if (!(await confirm('Disconnect the carrier? You can still enter tracking numbers by hand.', { title: 'Disconnect carrier', confirmText: 'Disconnect' }))) return
    try {
      await api.delete('/api/admin/shipping/config')
      toast.success('Disconnected')
      void load()
    } catch (e) {
      toast.error(errorText(e, 'Could not disconnect'))
    }
  }

  const keyOk = apiKey.trim().length >= MIN_KEY
  const box = (label: string, value: string, set: (v: string) => void, id: string, wide = false) => (
    <div className={wide ? 'sm:col-span-2' : ''}><label className="label" htmlFor={id}>{label}</label><input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} /></div>
  )

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Shipping labels</h1>
          <p className="text-gray-500 dark:text-slate-400">Connect a carrier account to buy and print labels straight from an order.</p>
        </div>
      </div>

      <PageError message={error} />

      {cfg?.connected && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" /> Connected to <span className="capitalize">{cfg.provider}</span> ({cfg.mode})</span>
          {mayConfigure && <button onClick={disconnect} className="btn btn-secondary">Disconnect</button>}
        </div>
      )}
      {cfg && !cfg.connected && !mayConfigure && (
        <p className="text-sm text-gray-600 dark:text-slate-300">No carrier account is connected, so tracking numbers are entered by hand on each order.</p>
      )}

      {!mayConfigure && (
        <p className="text-sm text-gray-500 dark:text-slate-400">The carrier account is set up by a manager or the owner. Labels are bought from each order.</p>
      )}

      {mayConfigure && !error && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Truck className="h-4 w-4" /> EasyPost</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            One account covers USPS, UPS and FedEx. Test mode gives real label URLs without buying postage.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ship-key">API key</label>
              <input id="ship-key" className="input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg?.connected ? 'Saved — enter it again to save changes' : 'EasyPost → API Keys'} />
            </div>
            <div>
              <label className="label" htmlFor="ship-mode">Mode</label>
              <select id="ship-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')}>
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
            </div>
          </div>

          <h3 className="font-medium text-gray-900 pt-2 dark:text-slate-100">Ship from</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {box('Name', from.name, (v) => setFrom({ ...from, name: v }), 'ship-name')}
            {box('Phone', from.phone, (v) => setFrom({ ...from, phone: v }), 'ship-phone')}
            {box('Address', from.line1, (v) => setFrom({ ...from, line1: v }), 'ship-line1', true)}
            {box('Address line 2', from.line2, (v) => setFrom({ ...from, line2: v }), 'ship-line2', true)}
            {box('City', from.city, (v) => setFrom({ ...from, city: v }), 'ship-city')}
            {box('State', from.state, (v) => setFrom({ ...from, state: v }), 'ship-state')}
            {box('Postal code', from.postalCode, (v) => setFrom({ ...from, postalCode: v }), 'ship-postal')}
            {box('Country', from.country, (v) => setFrom({ ...from, country: v }), 'ship-country')}
          </div>

          <h3 className="font-medium text-gray-900 pt-2 dark:text-slate-100">Default parcel</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">Used for quotes and labels.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className="label" htmlFor="ship-l">Length (in)</label><input id="ship-l" type="number" className="input" value={parcel.lengthIn} onChange={(e) => setParcel({ ...parcel, lengthIn: e.target.value })} /></div>
            <div><label className="label" htmlFor="ship-w">Width (in)</label><input id="ship-w" type="number" className="input" value={parcel.widthIn} onChange={(e) => setParcel({ ...parcel, widthIn: e.target.value })} /></div>
            <div><label className="label" htmlFor="ship-h">Height (in)</label><input id="ship-h" type="number" className="input" value={parcel.heightIn} onChange={(e) => setParcel({ ...parcel, heightIn: e.target.value })} /></div>
            <div><label className="label" htmlFor="ship-oz">Weight (oz)</label><input id="ship-oz" type="number" className="input" value={parcel.weightOz} onChange={(e) => setParcel({ ...parcel, weightOz: e.target.value })} /></div>
          </div>

          {!keyOk && cfg?.connected && <p className="text-xs text-gray-500 dark:text-slate-400">The API key is never shown again: enter it to save any change here.</p>}
          <button onClick={connect} disabled={saving || !keyOk || !from.line1 || !from.city || !from.postalCode || !from.country} className="btn btn-primary">
            {saving ? 'Saving…' : cfg?.connected ? 'Update carrier settings' : 'Connect carrier'}
          </button>
        </div>
      )}
    </div>
  )
}
