// Tracking numbers from Twomiah (feature call_tracking_numbers, not ready) — ServiceTitan's built-in tracking numbers, so a
// business needs no CallRail account. A number per place it advertises, each ringing the business's own line; the calls show
// on Call Tracking with where they came from. $3 a month a number; the calls at cost from the texting wallet. The first number
// goes through a checkout (Stripe brings the owner back here with ?number=paid); after that a number is bought at once.
// Server: crm/comms/trackingLines.ts (and the Factory's services/callTrackingNumbers.ts).
import { useEffect, useState } from 'react'
import { Phone, Loader2 } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import { api } from '../../api'
import { useToast, useConfirm, usePermissions } from '../../shared'

interface Line { id: string; phoneNumber: string; forwardTo: string | null; name: string | null }
const pretty = (p: string | null) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p || '' }

export default function TrackingLines() {
  const toast = useToast()
  const confirm = useConfirm()
  const { can } = usePermissions()
  const mayBuy = can('calltracking:create')
  const mayRelease = can('calltracking:update')
  /** connected: false — this app has no link to the Twomiah account (the demo): numbers are listed, none can be bought here. */
  const [data, setData] = useState<{ connected?: boolean; monthlyCents: number | null; subscribed: boolean; numbers: Line[] } | null>(null)
  const [failed, setFailed] = useState('')
  const [form, setForm] = useState({ label: '', forwardTo: '', areaCode: '' })
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/api/calltracking-lines').then((r: any) => { setData(r); setFailed('') }).catch((e: any) => setFailed(e?.message || 'Your numbers could not be loaded'))
  useEffect(() => {
    load()
    try {
      const q = new URLSearchParams(window.location.search).get('number')
      if (q === 'paid') toast.success('Paid — your number is being set up. It shows here in a minute.')
      if (q === 'cancelled') toast.error('No number was bought.')
    } catch { /* no address bar */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const buy = async () => {
    setBusy(true)
    try {
      const r: any = await api.post('/api/calltracking-lines', { label: form.label, forwardTo: form.forwardTo, areaCode: form.areaCode })
      if (r?.checkoutUrl) { window.location.href = r.checkoutUrl; return }
      toast.success(`${pretty(r?.number?.phoneNumber)} is yours — it rings ${pretty(r?.number?.forwardTo)}`)
      setForm({ label: '', forwardTo: form.forwardTo, areaCode: form.areaCode })
      await load()
    } catch (e: any) { toast.error(e?.message || 'The number could not be bought') } finally { setBusy(false) }
  }
  const release = async (l: Line) => {
    if (!(await confirm(`Calls to ${pretty(l.phoneNumber)} stop ringing you, and the number can't be had back.`, { title: 'Give this number back?', confirmText: 'Give it back' }))) return
    try { await api.post(`/api/calltracking-lines/${l.id}/release`, {}); toast.success('Number given back'); await load() } catch (e: any) { toast.error(e?.message || 'The number could not be given back') }
  }

  const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  return (
    <div className="bg-white rounded-xl border p-6 space-y-4 dark:bg-slate-900 dark:border-slate-700" data-testid="tracking-lines">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Phone className="w-4 h-4" />Tracking numbers from us</h2>
        <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
          A local number for each place you advertise — every call rings your own phone, and shows here with where it came from. No CallRail account needed.
          {data && data.monthlyCents != null ? ` ${money(data.monthlyCents / 100)} a month a number; the calls at cost from your texting wallet (about 2¢ a minute).` : ''}
        </p>
      </div>
      {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{failed}</p>}
      {!data && !failed && <p className="text-sm text-gray-500 dark:text-slate-400"><Loader2 className="inline w-4 h-4 animate-spin" /> Loading…</p>}
      {data && data.numbers.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {data.numbers.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-gray-900 dark:text-slate-100"><span className="font-semibold">{pretty(l.phoneNumber)}</span> · {l.name} · rings {pretty(l.forwardTo)}</span>
              {mayRelease && <button type="button" onClick={() => release(l)} className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-950/40">Give back</button>}
            </li>
          ))}
        </ul>
      )}
      {data && data.connected === false && (
        <p className="text-sm text-gray-600 dark:text-slate-400">Numbers are bought through your Twomiah account, so they can't be bought from here.</p>
      )}
      {data && data.connected !== false && mayBuy && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-gray-800 dark:text-slate-200">What it's for
            <input className={input} value={form.label} maxLength={60} placeholder="Google Ads" onChange={(e) => { const label = e.target.value; setForm((f) => ({ ...f, label })) }} />
          </label>
          <label className="text-sm text-gray-800 dark:text-slate-200">Ring this number
            <input className={input} value={form.forwardTo} inputMode="tel" placeholder="(715) 555-0100" onChange={(e) => { const forwardTo = e.target.value; setForm((f) => ({ ...f, forwardTo })) }} />
          </label>
          <label className="text-sm text-gray-800 dark:text-slate-200">Area code (optional)
            <input className={input} value={form.areaCode} inputMode="numeric" maxLength={3} placeholder="715" onChange={(e) => { const areaCode = e.target.value.replace(/\D/g, ''); setForm((f) => ({ ...f, areaCode })) }} />
          </label>
          <div className="sm:col-span-3">
            <button type="button" disabled={busy} onClick={buy} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}{data.subscribed || data.monthlyCents == null ? 'Get a number' : `Get a number — ${money(data.monthlyCents / 100)} a month`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
