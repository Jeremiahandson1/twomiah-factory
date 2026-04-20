import React, { useState, useEffect } from 'react'

// First-class settings page vendored into each tenant.
// Add / rename / remove / toggle routing mode for email aliases on the
// tenant's connected domain. Works standalone in Settings; can also be
// embedded by the onboarding wizard in Phase 3 final cut.
//
// No-domain state: renders a callout pointing to the Email Domain page.

interface Alias {
  id: string
  localPart: string
  routingMode: 'forward' | 'crm'
  forwardTo: string | null
  enabled: boolean
}

interface CompanyInfo {
  domain?: string | null
  email?: string | null
}

function getToken(): string {
  try { return localStorage.getItem('token') || '' } catch { return '' }
}

function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

export function EmailAliasesPage(): React.ReactElement {
  const [aliases, setAliases] = useState<Alias[]>([])
  const [company, setCompany] = useState<CompanyInfo>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [newAlias, setNewAlias] = useState({ localPart: '', routingMode: 'forward' as 'forward' | 'crm', forwardTo: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const [aRes, cRes] = await Promise.all([
        fetch('/api/email-aliases', { headers: authHeaders() }),
        fetch('/api/company', { headers: authHeaders() }),
      ])
      if (!aRes.ok) throw new Error('Failed to load aliases: ' + aRes.status)
      const aData = await aRes.json()
      setAliases(aData.aliases || [])
      if (cRes.ok) {
        const cData = await cRes.json()
        setCompany({ domain: cData?.domain || cData?.company?.domain || null, email: cData?.email || cData?.company?.email || null })
        if (!newAlias.forwardTo && cData?.email) setNewAlias(prev => ({ ...prev, forwardTo: cData.email }))
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function addAlias() {
    setError('')
    try {
      const res = await fetch('/api/email-aliases', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(newAlias),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Create failed'); return }
      setAliases(prev => [...prev, data.alias])
      setNewAlias({ localPart: '', routingMode: 'forward', forwardTo: company.email || '' })
      setAdding(false)
    } catch (err: any) { setError(err.message) }
  }

  async function updateAlias(id: string, patch: Partial<Alias>) {
    setError('')
    try {
      const res = await fetch('/api/email-aliases/' + id, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Update failed'); return }
      setAliases(prev => prev.map(a => a.id === id ? data.alias : a))
    } catch (err: any) { setError(err.message) }
  }

  async function deleteAlias(id: string) {
    if (!confirm('Delete this alias? Forwarding will stop immediately.')) return
    setError('')
    try {
      const res = await fetch('/api/email-aliases/' + id, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) { const data = await res.json().catch(() => ({})); setError(data.error || 'Delete failed'); return }
      setAliases(prev => prev.filter(a => a.id !== id))
    } catch (err: any) { setError(err.message) }
  }

  const domain = company.domain

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">Email Addresses</h1>
      <p className="text-sm text-gray-500 mb-6">Create branded email addresses on your domain. Each one can forward to wherever you read email, or route replies into the CRM as conversation threads.</p>

      {!domain && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-6">
          <div className="font-semibold text-yellow-900 mb-1">Connect a domain first</div>
          <div className="text-sm text-yellow-800">Email aliases require a domain. Go to <strong>Settings → Email Domain</strong> to connect one.</div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      {!loading && (
        <div className="space-y-3">
          {aliases.length === 0 && !adding && (
            <div className="text-sm text-gray-500 italic py-6 text-center border border-dashed border-gray-300 rounded-md">No email addresses yet.</div>
          )}

          {aliases.map(a => (
            <AliasRow key={a.id} alias={a} domain={domain} onUpdate={patch => updateAlias(a.id, patch)} onDelete={() => deleteAlias(a.id)} />
          ))}

          {adding && domain && (
            <div className="border border-gray-300 rounded-md p-4 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Address</label>
                  <div className="flex items-center">
                    <input type="text" placeholder="support" value={newAlias.localPart} onChange={e => setNewAlias(v => ({ ...v, localPart: e.target.value.trim().toLowerCase() }))} className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md text-sm" />
                    <span className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-sm text-gray-600">@{domain}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Mode</label>
                  <select value={newAlias.routingMode} onChange={e => setNewAlias(v => ({ ...v, routingMode: e.target.value as any }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="forward">Forward to external email</option>
                    <option value="crm">Route into CRM</option>
                  </select>
                </div>
              </div>
              {newAlias.routingMode === 'forward' && (
                <div className="mb-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Forward to</label>
                  <input type="email" placeholder="you@yourbusiness.com" value={newAlias.forwardTo} onChange={e => setNewAlias(v => ({ ...v, forwardTo: e.target.value.trim() }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={addAlias} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-md text-sm font-semibold">Create</button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-sm">Cancel</button>
              </div>
            </div>
          )}

          {!adding && domain && (
            <button onClick={() => setAdding(true)} className="w-full py-3 border border-dashed border-gray-300 text-gray-600 rounded-md text-sm hover:bg-gray-50">+ Add email address</button>
          )}
        </div>
      )}
    </div>
  )
}

function AliasRow({ alias, domain, onUpdate, onDelete }: { alias: Alias; domain: string | null | undefined; onUpdate: (patch: Partial<Alias>) => void; onDelete: () => void }) {
  const [editingForward, setEditingForward] = useState(false)
  const [forwardDraft, setForwardDraft] = useState(alias.forwardTo || '')

  return (
    <div className="border border-gray-200 rounded-md p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{alias.localPart}{domain ? '@' + domain : ''}</div>
        <div className="text-xs text-gray-500">
          {alias.routingMode === 'forward'
            ? (editingForward
                ? <span className="inline-flex items-center gap-2">
                    <input type="email" value={forwardDraft} onChange={e => setForwardDraft(e.target.value)} className="px-2 py-0.5 border border-gray-300 rounded text-xs" />
                    <button onClick={() => { onUpdate({ forwardTo: forwardDraft }); setEditingForward(false) }} className="text-xs text-orange-600">Save</button>
                    <button onClick={() => { setForwardDraft(alias.forwardTo || ''); setEditingForward(false) }} className="text-xs text-gray-400">Cancel</button>
                  </span>
                : <>Forwards to <strong>{alias.forwardTo || '—'}</strong>{' '}<button onClick={() => setEditingForward(true)} className="underline text-gray-500 hover:text-gray-700">change</button></>)
            : <>Routes into CRM conversations</>}
        </div>
      </div>
      <select value={alias.routingMode} onChange={e => onUpdate({ routingMode: e.target.value as any })} className="px-2 py-1 border border-gray-300 rounded text-xs">
        <option value="forward">Forward</option>
        <option value="crm">CRM</option>
      </select>
      <label className="inline-flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={alias.enabled} onChange={e => onUpdate({ enabled: e.target.checked })} />
        Enabled
      </label>
      <button onClick={onDelete} className="text-xs text-red-600 hover:text-red-800">Delete</button>
    </div>
  )
}
