import React, { useState, useEffect } from 'react'

// Settings → Billing — READ-ONLY. Plans are sold, changed and cancelled by the Twomiah Factory
// (Stripe lives there). This page shows the subscription the Factory reports for this tenant and
// hands the admin off to the Factory's Stripe billing portal for anything that changes money.
// Calls are proxied through the tenant backend (GET /api/billing/subscription,
// POST /api/billing/portal-link); the Factory key never reaches the browser.

interface Subscription {
  plan: string | null
  planName: string | null
  product: 'crm' | 'website' | null
  monthlyAmount: number | null
  billingCycle: string | null
  billingType: string | null
  status: 'active' | 'trialing' | 'past_due' | 'canceled'
  billingStatus: string | null
  nextBillingDate: string | null
  trialEndsAt: string | null
  seats: number | null
  hasStripeCustomer: boolean
  syncedAt: string
}
interface MessagingStatus {
  configured: boolean
  enabled: boolean
  aiEnabled: boolean
  walletCents: number
  enableMonthlyCents: number | null
  error?: string
}
interface BillingResponse {
  subscription: Subscription | null
  source: 'factory' | 'cache' | 'unavailable'
  seatsUsed: number
  seatLimit: number | null
  supportEmail: string
}

function getToken(): string {
  try { return localStorage.getItem('token') || localStorage.getItem('accessToken') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}
const money = (n: number | null) => (n == null ? null : '$' + (Number.isInteger(n) ? n.toString() : n.toFixed(2)))
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null)

const STATUS: Record<Subscription['status'], { label: string; cls: string }> = {
  active:   { label: 'Active',    cls: 'bg-green-100 text-green-800' },
  trialing: { label: 'Trial',     cls: 'bg-blue-100 text-blue-800' },
  past_due: { label: 'Past due',  cls: 'bg-amber-100 text-amber-800' },
  canceled: { label: 'Canceled',  cls: 'bg-red-100 text-red-800' },
}

export function BillingPage({ smsBilling = false }: { smsBilling?: boolean }): React.ReactElement {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState(false)
  const [msg, setMsg] = useState<MessagingStatus | null>(null)
  const [openingSms, setOpeningSms] = useState(false)

  useEffect(() => { load(); loadMessaging() }, [])

  // Texting / AI usage is a separate prepaid wallet billed by Twomiah at cost. Shown whenever the
  // tenant is wired to the Factory so an empty wallet is visible here, not discovered as a failed text.
  async function loadMessaging() {
    try {
      const res = await fetch('/api/messaging-billing/status', { headers: authHeaders() })
      const body = await res.json().catch(() => null)
      if (res.ok && body && body.configured) setMsg(body)
    } catch { /* card simply stays hidden */ }
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/billing/subscription', { headers: authHeaders() })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not load billing')
      setData(body)
    } catch (e: any) {
      setError(e.message || 'Could not load billing')
    } finally {
      setLoading(false)
    }
  }

  async function openPortal() {
    setOpening(true); setNotice(''); setError('')
    try {
      const res = await fetch('/api/billing/portal-link', { method: 'POST', headers: authHeaders() })
      const body = await res.json().catch(() => ({}))
      if (body.url) { window.location.href = body.url; return }
      setNotice(body.reason === 'no_stripe_customer'
        ? 'There is no card on file with Twomiah for this account yet. Email ' + (data?.supportEmail || 'support@twomiah.com') + ' and we will set billing up for you.'
        : (body.error || 'Could not open the billing portal right now.'))
    } catch (e: any) {
      setError(e.message || 'Could not open the billing portal')
    } finally {
      setOpening(false)
    }
  }

  async function openSmsBilling() {
    setOpeningSms(true); setNotice('')
    try {
      const res = await fetch('/api/messaging-billing/portal-link', { headers: authHeaders() })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) window.open(body.url, '_blank'); else setNotice(body.error || 'Could not open texting billing')
    } catch { setNotice('Could not open texting billing') }
    finally { setOpeningSms(false) }
  }

  const sub = data?.subscription || null
  const status = sub ? STATUS[sub.status] : null
  const seatLimit = data?.seatLimit ?? null
  const seatsUsed = data?.seatsUsed ?? 0
  const seatPct = seatLimit ? Math.min(100, Math.round((seatsUsed / seatLimit) * 100)) : 0
  const price = sub ? money(sub.monthlyAmount) : null

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Billing</h1>
      <p className="text-sm text-gray-500 mb-6">
        Your plan is billed by Twomiah. Change plan, update your card or download invoices in the billing portal — this page just shows where things stand.
      </p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4 text-sm text-yellow-800">{notice}</div>}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && !sub && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Billing details are managed by Twomiah</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            We could not load your subscription right now. Nothing is wrong with your account — email{' '}
            <a className="underline" href={'mailto:' + (data?.supportEmail || 'support@twomiah.com')}>{data?.supportEmail || 'support@twomiah.com'}</a> for anything billing-related.
          </p>
        </div>
      )}

      {!loading && sub && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-400">Current plan</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-slate-100">{sub.planName || 'Twomiah CRM'}</div>
                <div className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {price ? <>{price} <span className="text-gray-400">/ {sub.billingCycle === 'annual' || sub.billingCycle === 'yearly' ? 'year' : 'month'}</span></> : sub.billingType === 'one_time' ? 'Lifetime license' : 'Included'}
                  {sub.seats ? <> · up to {sub.seats} users</> : null}
                </div>
              </div>
              {status && <span className={'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ' + status.cls}>{status.label}</span>}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 text-sm">
              <div>
                <dt className="text-gray-400">{sub.status === 'trialing' ? 'Trial ends' : 'Next billing date'}</dt>
                <dd className="font-medium text-gray-900 dark:text-slate-100">{date(sub.status === 'trialing' ? sub.trialEndsAt : sub.nextBillingDate) || '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Billing</dt>
                <dd className="font-medium text-gray-900 dark:text-slate-100">{sub.billingType === 'one_time' ? 'One-time' : sub.billingCycle === 'annual' || sub.billingCycle === 'yearly' ? 'Annual' : 'Monthly'}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Last updated</dt>
                <dd className="font-medium text-gray-900 dark:text-slate-100">{date(sub.syncedAt) || '—'}{data?.source === 'cache' ? ' (cached)' : ''}</dd>
              </div>
            </dl>

            {sub.status === 'past_due' && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">Your last payment did not go through. Update your card in the billing portal to keep the account active.</div>
            )}
            {sub.status === 'canceled' && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">This subscription is not active. Reactivate it in the billing portal or email support.</div>
            )}

            <div className="flex flex-wrap gap-3 mt-6">
              <button onClick={openPortal} disabled={opening} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                {opening ? 'Opening…' : 'Manage billing'}
              </button>
              <a href="mailto:support@twomiah.com" className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:text-gray-900 dark:text-slate-300">Contact support</a>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Team seats</h2>
              <span className="text-sm text-gray-500 dark:text-slate-400">{seatsUsed}{seatLimit ? ' of ' + seatLimit : ''} active {seatsUsed === 1 ? 'user' : 'users'}</span>
            </div>
            {seatLimit ? (
              <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                <div className={'h-2 rounded-full ' + (seatPct >= 100 ? 'bg-red-500' : seatPct >= 80 ? 'bg-amber-500' : 'bg-green-500')} style={{ width: seatPct + '%' }} />
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-slate-400">No seat limit on this plan.</p>
            )}
            <p className="text-xs text-gray-400 mt-3">Deactivating a user in Settings › Users frees a seat. Need more seats? Move up a plan in the billing portal.</p>
          </div>

          {(msg || smsBilling) && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-semibold text-gray-900 dark:text-slate-100">Texting &amp; AI usage</h2>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Texts and AI replies are billed at cost from a prepaid wallet, separate from your plan.</p>
                </div>
                {msg && (
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-gray-400">Wallet balance</div>
                    <div className={'text-2xl font-bold ' + (msg.enabled && msg.walletCents <= 0 ? 'text-red-600' : 'text-gray-900 dark:text-slate-100')}>${(msg.walletCents / 100).toFixed(2)}</div>
                  </div>
                )}
              </div>
              {msg && !msg.enabled && (
                <div className="mt-4 bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300">Texting is not enabled for this account yet. Enable it and fund the wallet in the texting billing page.</div>
              )}
              {msg && msg.enabled && msg.walletCents <= 0 && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">Your texting wallet is empty — reminders and replies will not send until you add funds.</div>
              )}
              {msg?.error && <div className="mt-4 text-sm text-amber-700">Could not reach billing right now: {msg.error}</div>}
              <div className="flex flex-wrap gap-3 mt-6">
                <button onClick={openSmsBilling} disabled={openingSms} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
                  {openingSms ? 'Opening…' : msg && msg.enabled ? 'Add funds / manage texting' : 'Enable texting'}
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-slate-900 dark:border-slate-700">
            <h2 className="font-semibold text-gray-900 dark:text-slate-100 mb-1">Features</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">Every feature is included in your plan. Switch modules on or off in <a className="underline" href="/crm/settings/features">Settings › Features</a>.</p>
          </div>
        </div>
      )}
    </div>
  )
}
