import { useEffect, useState } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { Globe, RefreshCw, AlertTriangle, Link2 } from 'lucide-react'

// A company's domain, as billing sees it (10/14). Domains are charged AT COST PLUS THE STRIPE FEE — Namecheap's live
// price, never a markup — and a domain we registered is billed for its renewal 30 days before it expires, then renewed
// once paid (api services/domainRenewal.ts). This panel shows where that stands, and lets staff buy a domain for a
// company that has none: a checkout link for the customer to pay, or registered now on our account.

type State = {
  domain: string | null; registeredByUs: boolean; registrar: string | null; expiresAt: string | null
  hasStripeCustomer: boolean; supportedTld: boolean | null
  liveRenewalCostCents: number | null; renewalChargeCents: number | null; priceSetByHand: boolean
  openInvoiceId: string | null; renewalError: string | null
}
type Props = { tenantId: string; showToast: (msg: string, type?: 'success' | 'error') => void; onChanged: () => void }

const INPUT = 'px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500'
const money = (c: number | null) => (c == null ? '—' : '$' + (c / 100).toFixed(2))
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, data: { error: 'Not signed in' } }
  const res = await fetch(API + '/api/v1/factory/customers/' + path, {
    method, headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

export default function DomainBilling({ tenantId, showToast, onChanged }: Props) {
  const [s, setS] = useState<State | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [years, setYears] = useState(1)
  const [who, setWho] = useState<'customer' | 'ours'>('customer')
  const [link, setLink] = useState<{ url: string; amountCents: number } | null>(null)
  const [price, setPrice] = useState('')

  const load = async () => {
    const r = await call('GET', tenantId + '/domain/billing')
    if (r.ok) { setS(r.data); setLoadError('') } else setLoadError(r.data?.error || 'Could not load the domain')
  }
  useEffect(() => { load() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<{ ok: boolean; data: any }>, okMsg: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.ok) { showToast(okMsg); await load(); onChanged() } else showToast(r.data?.error || 'That did not work', 'error')
    return r
  }

  const register = async () => {
    setLink(null)
    const r = await act(() => call('POST', tenantId + '/domain/register', { domain: newDomain.trim().toLowerCase(), years, billing: who }),
      who === 'customer' ? 'Checkout link created — send it to the customer' : 'Domain registered on our account')
    if (r.ok && r.data?.url) setLink({ url: r.data.url, amountCents: r.data.amountCents })
  }

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-800 p-6">
      <h2 className="text-white font-semibold mb-1 flex items-center gap-2"><Globe size={16} className="text-blue-400" />Domain billing</h2>
      <p className="text-xs text-gray-400 mb-4">Charged at cost plus the card fee — Namecheap's live price, no markup. Renewals are billed 30 days before expiry and renewed once paid.</p>
      {loadError && <p className="text-sm text-red-400">{loadError}</p>}
      {!s && !loadError && <p className="text-sm text-gray-400">Loading…</p>}

      {s && !s.domain && (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">No domain yet. Register one for this company:</p>
          <div className="flex flex-wrap gap-2">
            <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="theirbusiness.com" className={INPUT + ' flex-1 min-w-[12rem]'} />
            <select value={years} onChange={(e) => setYears(Number(e.target.value))} className={INPUT}>
              {[1, 2, 3, 5, 10].map((y) => <option key={y} value={y}>{y} year{y > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <fieldset className="text-sm text-gray-300 space-y-1">
            <label className="flex items-start gap-2"><input type="radio" name="who" className="mt-1" checked={who === 'customer'} onChange={() => setWho('customer')} /><span>The customer pays — make a checkout link to send them. It is registered the moment they pay.</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="who" className="mt-1" checked={who === 'ours'} onChange={() => setWho('ours')} /><span>Register it now on our account — for a company we bill ourselves. Nothing is charged to them here.</span></label>
          </fieldset>
          <button onClick={register} disabled={busy || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(newDomain.trim())} className="px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50">
            {busy ? 'Working…' : who === 'customer' ? 'Create checkout link' : 'Register now'}
          </button>
          {link && (
            <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/10 text-sm text-gray-200">
              <div className="flex items-center gap-2 mb-1"><Link2 size={14} />Checkout for {money(link.amountCents)} — send this to the customer:</div>
              <div className="flex gap-2"><input readOnly value={link.url} className={INPUT + ' flex-1 text-xs'} onFocus={(e) => e.currentTarget.select()} />
                <button onClick={() => { navigator.clipboard.writeText(link.url).catch(() => {}); showToast('Link copied') }} className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg">Copy</button></div>
            </div>
          )}
        </div>
      )}

      {s && s.domain && (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-gray-400">Domain</dt><dd className="text-white">{s.domain}</dd>
            <dt className="text-gray-400">Registered by</dt><dd className="text-white">{s.registeredByUs ? 'Us (Namecheap)' : s.registrar === 'byod' ? 'The customer' : 'Unknown'}</dd>
            {s.registeredByUs && (<>
              <dt className="text-gray-400">Expires</dt><dd className="text-white">{day(s.expiresAt)}</dd>
              <dt className="text-gray-400">Namecheap renewal</dt><dd className="text-white">{money(s.liveRenewalCostCents)}{s.liveRenewalCostCents == null ? ' (unavailable right now)' : ''}</dd>
              <dt className="text-gray-400">We charge</dt><dd className="text-white">{money(s.renewalChargeCents)}{s.priceSetByHand ? ' (set by hand)' : ' (at cost + card fee)'}</dd>
              <dt className="text-gray-400">Renewal invoice</dt><dd className="text-white">{s.openInvoiceId ? 'Open — ' + s.openInvoiceId : 'None open'}</dd>
            </>)}
          </dl>

          {s.registeredByUs && !s.expiresAt && <p className="text-amber-300">The expiry date is unknown, so this domain's renewal is not being billed. Sync it from Namecheap.</p>}
          {s.registeredByUs && !s.hasStripeCustomer && <p className="text-amber-300">This company has no Stripe customer, so its renewal cannot be charged — staff will be emailed when it comes due.</p>}
          {!s.registeredByUs && <p className="text-gray-400">Not registered by us — the customer renews it with their own registrar, and we do not bill it. If it is actually on our Namecheap account, sync it.</p>}
          {s.renewalError && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <div className="flex-1"><div className="font-medium">Renewal needs attention</div><div className="text-xs mt-1">{s.renewalError}</div></div>
              <button onClick={() => act(() => call('PATCH', tenantId + '/domain/billing', { clearError: true }), 'Cleared — the next daily run will try again')} disabled={busy} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded">Mark handled</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => act(() => call('POST', tenantId + '/domain/billing/sync'), 'Expiry read from Namecheap')} disabled={busy} className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50"><RefreshCw size={14} />Sync from Namecheap</button>
            {s.registeredByUs && (<>
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Set renewal $ by hand" className={INPUT + ' w-44 text-xs'} />
              <button onClick={() => { const cents = Math.round(Number(price) * 100); act(() => call('PATCH', tenantId + '/domain/billing', { priceCents: cents }), 'Renewal price set'); setPrice('') }} disabled={busy || !(Number(price) >= 0.5)} className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50">Set</button>
              {s.priceSetByHand && <button onClick={() => act(() => call('PATCH', tenantId + '/domain/billing', { priceCents: null }), 'Back to at cost + card fee')} disabled={busy} className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg">Use at cost again</button>}
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}
