import React, { useState } from 'react'
import { getAliasDefaultsForProduct } from '../../config/emailDefaults'

// Pre-checks vertical-specific defaults (support/admin + per-vertical extras).
// All default to forward mode pointing at the admin's signup email. Tenant
// can fine-tune in Settings later.

interface Props {
  productId: string
  onBack: () => void
  onNext: () => void
  // The email the admin just typed/corrected earlier in onboarding. Step 1's edits aren't
  // persisted until the wizard completes, so falling back to the server's company.email
  // showed a stale address here. Prefer this live value. (VET-23)
  defaultForwardTo?: string
}

function getToken(): string { try { return localStorage.getItem('token') || localStorage.getItem('accessToken') || '' } catch { return '' } }
function authHeaders() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() } }

// Persist the step's inputs so leaving and returning (Back → forward) doesn't
// wipe them. Scoped to the product so different onboardings don't collide.
function ss(key: string, product: string): string { try { return sessionStorage.getItem(`onb_${product}_${key}`) || '' } catch { return '' } }
function ssSet(key: string, product: string, val: string) { try { sessionStorage.setItem(`onb_${product}_${key}`, val) } catch {} }

export function EmailAliasesStep({ productId, onBack, onNext, defaultForwardTo }: Props): React.ReactElement {
  const defaults = getAliasDefaultsForProduct(productId)
  const [checked, setChecked] = useState<Set<string>>(() => {
    const saved = ss('checked', productId)
    return saved ? new Set(JSON.parse(saved)) : new Set(defaults)
  })
  const [extraAliases, setExtraAliases] = useState<string[]>(() => {
    const saved = ss('extra', productId)
    return saved ? JSON.parse(saved) : []
  })
  const [newAlias, setNewAlias] = useState('')
  const [forwardTo, setForwardTo] = useState<string>(() => ss('forwardTo', productId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Persist inputs on change.
  React.useEffect(() => { ssSet('forwardTo', productId, forwardTo) }, [forwardTo, productId])
  React.useEffect(() => { ssSet('extra', productId, JSON.stringify(extraAliases)) }, [extraAliases, productId])
  React.useEffect(() => { ssSet('checked', productId, JSON.stringify([...checked])) }, [checked, productId])

  // Pre-fill forward-to. Prefer the address the admin just entered in step 1 (which isn't
  // persisted yet) over the server's stored company.email, which is stale here. (VET-23)
  React.useEffect(() => {
    if (forwardTo) return
    if (defaultForwardTo && defaultForwardTo.trim()) { setForwardTo(defaultForwardTo.trim()); return }
    fetch('/api/company', { headers: authHeaders() }).then(r => r.json()).then(d => {
      if (d?.email && !forwardTo) setForwardTo(d.email)
    }).catch(() => {})
  }, [])

  async function saveAndContinue() {
    setSaving(true); setError('')
    try {
      // Distinguish an empty field from a malformed one so the message is useful.
      if (!forwardTo.trim()) throw new Error('Enter a forwarding email')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardTo.trim())) throw new Error('Enter a valid email address (e.g. you@yourbusiness.com)')
      const allAliases = [...checked, ...extraAliases]
      // POST each alias sequentially — order doesn't matter, errors on one don't block others
      const results = await Promise.allSettled(allAliases.map(localPart =>
        fetch('/api/email-aliases', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ localPart, routingMode: 'forward', forwardTo, enabled: true }),
        }).then(async r => { if (!r.ok && r.status !== 409) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Failed: ' + localPart) } })
      ))
      const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      if (failed.length && failed.length === allAliases.length) {
        // Surface the actual server error rather than guessing a cause (a 401
        // was being reported as "no domain connected yet").
        throw new Error(failed[0]?.reason?.message || 'Could not save the aliases. Please try again.')
      }
      onNext()
    } catch (err: any) { setError(err.message) }
    setSaving(false)
  }

  function toggleAlias(local: string) {
    const copy = new Set(checked)
    if (copy.has(local)) copy.delete(local); else copy.add(local)
    setChecked(copy)
  }

  function addExtra() {
    const v = newAlias.trim().toLowerCase()
    if (!v) return
    if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(v)) { setError('Invalid alias format'); return }
    if (checked.has(v) || extraAliases.includes(v)) { setError('Alias already in list'); return }
    setExtraAliases(a => [...a, v])
    setNewAlias('')
    setError('')
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Email addresses</h2>
      <p className="text-sm text-gray-500 mb-6">We've pre-checked the most common ones for your business type. All forward to your email below by default — you can split them out per-alias later in Settings.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Forward all messages to</label>
        <input type="email" value={forwardTo} onChange={e => setForwardTo(e.target.value.trim())} placeholder="you@yourbusiness.com" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
      </div>

      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Pre-checked addresses</div>
        <div className="grid grid-cols-2 gap-2">
          {defaults.map(local => (
            <label key={local} className="flex items-center gap-2 text-sm p-2 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={checked.has(local)} onChange={() => toggleAlias(local)} />
              <span className="font-mono">{local}@</span>
            </label>
          ))}
        </div>
      </div>

      {extraAliases.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Additional</div>
          <div className="grid grid-cols-2 gap-2">
            {extraAliases.map(local => (
              <div key={local} className="flex items-center gap-2 text-sm p-2 border border-gray-200 rounded bg-gray-50">
                <span>✓</span><span className="font-mono">{local}@</span>
                <button onClick={() => setExtraAliases(a => a.filter(x => x !== local))} className="ml-auto text-xs text-gray-400 hover:text-red-600">remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6 flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Add another</label>
          <input type="text" value={newAlias} onChange={e => { setNewAlias(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }} placeholder="billing" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
        </div>
        <button onClick={addExtra} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-md text-sm">Add</button>
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm">Back</button>
        <button onClick={saveAndContinue} disabled={saving} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}
