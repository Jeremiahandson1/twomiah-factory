import React, { useState, useEffect } from 'react'

// One-click Leave Twomiah + 30-day grace countdown + reactivate.
// Calls are proxied through the tenant backend; X-Factory-Key auth happens
// server-side so tenant frontends never see factory credentials.

interface OffboardStatus {
  status: string
  offboardStartedAt: string | null
  offboardGraceEndsAt: string | null
  domain?: string | null
  domainRegistrar?: string | null
}

function getToken(): string {
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

export function AccountOffboardPage(): React.ReactElement {
  const [status, setStatus] = useState<OffboardStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/account/offboard/status', { headers: authHeaders() })
      if (!res.ok) throw new Error('Status check failed: ' + res.status)
      setStatus(await res.json())
    } catch (err: any) { setError(err.message) }
    setLoading(false)
  }

  async function startOffboard() {
    setWorking(true); setError('')
    try {
      const res = await fetch('/api/account/offboard', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Offboard failed'); setWorking(false); return }
      setSuccessMsg('Offboarding started. Check your email for the grace-period details.')
      setConfirming(false)
      await load()
    } catch (err: any) { setError(err.message) }
    setWorking(false)
  }

  async function reactivate() {
    if (!confirm('Reactivate your account? This cancels the offboarding process.')) return
    setWorking(true); setError(''); setSuccessMsg('')
    try {
      const res = await fetch('/api/account/reactivate', { method: 'POST', headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Reactivate failed'); setWorking(false); return }
      setSuccessMsg('Your account has been reactivated.')
      await load()
    } catch (err: any) { setError(err.message) }
    setWorking(false)
  }

  const isOffboarding = !!status?.offboardStartedAt
  const graceEnd = status?.offboardGraceEndsAt ? new Date(status.offboardGraceEndsAt) : null
  const graceExpired = graceEnd ? graceEnd.getTime() < Date.now() : false
  const daysRemaining = graceEnd ? Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Leave Twomiah</h1>
      <p className="text-sm text-gray-500 mb-6">If Twomiah isn't working for your business, we'll offboard you cleanly. You keep your data, you keep your domain, and the door stays open if you ever want to come back.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}
      {successMsg && <div className="bg-green-50 border border-green-200 rounded-md p-3 mb-4 text-sm text-green-700">{successMsg}</div>}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && isOffboarding && graceEnd && (
        <div className="border border-yellow-300 rounded-md p-5 bg-yellow-50 mb-6">
          <div className="font-semibold text-yellow-900 mb-2">Offboarding in progress</div>
          <p className="text-sm text-yellow-900 mb-3">
            Your 30-day grace period {graceExpired ? 'has ended' : 'ends on'} <strong>{graceEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>
            {!graceExpired && <> — <strong>{daysRemaining} day{daysRemaining === 1 ? '' : 's'} remaining</strong>.</>}
          </p>
          <ul className="text-sm text-yellow-900 space-y-1 mb-4 pl-5 list-disc">
            <li>Your subscription is cancelled at the end of the current billing period.</li>
            {status?.domainRegistrar === 'namecheap' && <li>Your domain has been unlocked. Check your email for the EPP transfer code.</li>}
            <li>Your CRM, website, and data stay live through the grace period.</li>
            <li>After the grace period, services are decommissioned. You can still recover your data before then.</li>
          </ul>
          {!graceExpired && (
            <button onClick={reactivate} disabled={working} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
              {working ? 'Reactivating…' : 'Change my mind — reactivate'}
            </button>
          )}
        </div>
      )}

      {!loading && !isOffboarding && !confirming && (
        <div className="border border-gray-200 rounded-md p-5">
          <h2 className="font-semibold mb-2">Before you go</h2>
          <ul className="text-sm text-gray-700 space-y-2 pl-5 list-disc mb-4">
            <li><strong>30-day grace period</strong> — everything stays live so you can change your mind.</li>
            <li><strong>Data export</strong> — we'll email you CSV + JSON of every contact, job, quote, invoice, and document.</li>
            <li><strong>Clean domain handoff</strong> — if you bought your domain through us, we unlock it and send the transfer auth code.</li>
            <li><strong>No hostage fees</strong> — cancellation is at the end of the current billing period; no penalties.</li>
          </ul>
          <button onClick={() => setConfirming(true)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-semibold">
            Start offboarding
          </button>
        </div>
      )}

      {!loading && !isOffboarding && confirming && (
        <div className="border border-red-300 rounded-md p-5 bg-red-50">
          <h2 className="font-semibold text-red-900 mb-2">Confirm offboarding</h2>
          <p className="text-sm text-red-900 mb-4">Clicking below triggers: subscription cancellation at period-end, domain unlock (if we bought it for you), and starts the 30-day grace window. You can reactivate any time until the grace ends.</p>
          <div className="flex gap-2">
            <button onClick={startOffboard} disabled={working} className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
              {working ? 'Working…' : 'Yes, offboard my account'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={working} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
