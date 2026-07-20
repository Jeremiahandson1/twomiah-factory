import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { Wallet, Zap, Plus, Power, CheckCircle, AlertTriangle } from 'lucide-react'

// Messaging (SMS) usage billing: the $10/mo enable line + the prepaid at-cost
// wallet (A2P registration, monthly campaign, per-message segments draw it down).
// Talks to the factory /customers/:id/messaging routes.

type Ledger = {
  id: string; kind: 'credit' | 'debit'; amount_cents: number
  reason: string; balance_after_cents: number; created_at: string
}
type MessagingState = {
  enabled: boolean; enabledAt: string | null; walletCents: number
  enableMonthlyCents: number; ledger: Ledger[]
}
type Props = {
  tenantId: string
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const INPUT = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500'
const money = (cents: number) => (cents < 0 ? '-$' : '$') + (Math.abs(cents) / 100).toFixed(2)

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

const REASON_LABEL: Record<string, string> = {
  topup: 'Top-up', a2p_registration: 'A2P registration', monthly_campaign: 'Monthly campaign fee', sms_segment: 'SMS segments',
}

export default function MessagingBilling({ tenantId, showToast }: Props) {
  const [state, setState] = useState<MessagingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [topupDollars, setTopupDollars] = useState('20')

  useEffect(() => { load() }, [tenantId])

  async function load() {
    setLoading(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/messaging', {
        headers: { Authorization: 'Bearer ' + t },
      })
      if (res.ok) setState(await res.json())
    } catch { /* leave null */ }
    setLoading(false)
  }

  // POST helper that either redirects to a returned Stripe URL or reloads.
  async function post(path: string, body?: any, opts: { redirect?: boolean } = {}) {
    setBusy(true)
    try {
      const t = await token()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(data.error || 'Request failed', 'error'); return }
      if (opts.redirect && data.url) { window.location.href = data.url; return }
      showToast('Done')
      load()
    } catch { showToast('Request failed', 'error') }
    finally { setBusy(false) }
  }

  const enabled = !!state?.enabled
  const wallet = state?.walletCents ?? 0
  const enableFee = state?.enableMonthlyCents ?? 1000

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <Zap size={16} className="text-orange-400" /> Messaging Billing
        </h2>
        {enabled ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-green-400 bg-green-400/10 border-green-400/30">
            <CheckCircle size={12} />Enabled · {money(enableFee)}/mo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-gray-400 bg-gray-400/10 border-gray-400/30">
            Not enabled
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : !enabled ? (
        <div>
          <p className="text-sm text-gray-400 mb-4">
            Enable SMS for this tenant — <span className="text-gray-200">{money(enableFee)}/mo</span> flat, plus texting &amp; A2P
            registration billed <span className="text-gray-200">at cost</span> from a prepaid wallet.
          </p>
          <button onClick={() => post('/messaging/enable', undefined, { redirect: true })} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
            <Power size={14} />Enable messaging ({money(enableFee)}/mo)
          </button>
        </div>
      ) : (
        <>
          {/* Wallet */}
          <div className="mb-4 p-4 bg-gray-800/60 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400 flex items-center gap-2"><Wallet size={14} /> Wallet balance</span>
              <span className={'text-lg font-semibold ' + (wallet < 0 ? 'text-red-400' : 'text-white')}>{money(wallet)}</span>
            </div>
            {wallet < 0 && (
              <div className="mt-2 flex items-start gap-2 text-xs text-red-400">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Negative balance — Twilio costs are owed. Top up to clear it and unblock A2P actions.
              </div>
            )}
          </div>

          {/* Top up */}
          <div className="flex items-end gap-2 mb-4">
            <div className="flex-1 max-w-[160px]">
              <label className="block text-xs text-gray-400 mb-1">Add funds (USD)</label>
              <input className={INPUT} type="number" min="5" max="500" value={topupDollars} onChange={e => setTopupDollars(e.target.value)} />
            </div>
            <button
              onClick={() => post('/messaging/wallet/topup', { amountCents: Math.round(parseFloat(topupDollars) * 100) }, { redirect: true })}
              disabled={busy || !(parseFloat(topupDollars) >= 5)}
              className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors flex items-center gap-1.5">
              <Plus size={14} />Add funds
            </button>
          </div>

          {/* Ledger */}
          {state && state.ledger.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="py-1 pr-2 font-medium">Date</th>
                    <th className="py-1 pr-2 font-medium">Item</th>
                    <th className="py-1 pr-2 font-medium text-right">Amount</th>
                    <th className="py-1 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {state.ledger.map(l => (
                    <tr key={l.id} className="border-t border-gray-800">
                      <td className="py-1.5 pr-2 text-gray-400">{new Date(l.created_at).toLocaleDateString()}</td>
                      <td className="py-1.5 pr-2 text-gray-300">{REASON_LABEL[l.reason] || l.reason}</td>
                      <td className={'py-1.5 pr-2 text-right ' + (l.kind === 'credit' ? 'text-green-400' : 'text-gray-300')}>
                        {l.kind === 'credit' ? '+' : '−'}{money(l.amount_cents).replace('-', '')}
                      </td>
                      <td className="py-1.5 text-right text-gray-400">{money(l.balance_after_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Disable */}
          <div className="mt-4 pt-3 border-t border-gray-800">
            <button onClick={() => { if (confirm('Disable messaging? The $10/mo line is cancelled at period end.')) post('/messaging/disable') }} disabled={busy}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors">
              Disable messaging
            </button>
          </div>
        </>
      )}
    </div>
  )
}
