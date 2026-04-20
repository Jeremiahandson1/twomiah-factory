import React, { useState } from 'react'

// Optional — admin can invite team members now or skip. Posts to
// /api/team/invite which exists in every CRM template. Skip is always
// available; team can be added anytime from Settings.

function getToken(): string { try { return localStorage.getItem('token') || '' } catch { return '' } }
function authHeaders() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() } }

interface Invite { email: string; role: string }

export function TeamInvitesStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }): React.ReactElement {
  const [invites, setInvites] = useState<Invite[]>([{ email: '', role: 'user' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(i: number, patch: Partial<Invite>) {
    setInvites(arr => arr.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }
  function addRow() { setInvites(a => [...a, { email: '', role: 'user' }]) }
  function removeRow(i: number) { setInvites(a => a.filter((_, idx) => idx !== i)) }

  async function saveAndContinue() {
    setSaving(true); setError('')
    try {
      const valid = invites.filter(inv => inv.email.includes('@'))
      for (const inv of valid) {
        // Tolerate 409 (already exists) — this step should be idempotent on re-run
        const res = await fetch('/api/team/invite', { method: 'POST', headers: authHeaders(), body: JSON.stringify(inv) })
        if (!res.ok && res.status !== 409) {
          const data = await res.json().catch(() => ({}))
          console.warn('[Onboarding] invite failed for', inv.email, data.error)
        }
      }
      onNext()
    } catch (err: any) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Invite your team</h2>
      <p className="text-sm text-gray-500 mb-6">Skip if it's just you for now — you can invite people from Settings anytime.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      <div className="space-y-2 mb-4">
        {invites.map((inv, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="email" value={inv.email} onChange={e => update(i, { email: e.target.value.trim() })} placeholder="teammate@yourbusiness.com" className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
            <select value={inv.role} onChange={e => update(i, { role: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-md text-sm">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            {invites.length > 1 && <button onClick={() => removeRow(i)} className="text-xs text-red-600">Remove</button>}
          </div>
        ))}
      </div>

      <button onClick={addRow} className="text-sm text-orange-600 hover:text-orange-700 mb-6">+ Add another</button>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm">Back</button>
        <div className="flex gap-2">
          <button onClick={onNext} disabled={saving} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm">Skip</button>
          <button onClick={saveAndContinue} disabled={saving} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
            {saving ? 'Sending…' : 'Send invites'}
          </button>
        </div>
      </div>
    </div>
  )
}
