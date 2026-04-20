import React, { useState, useEffect } from 'react'

// Shows the company info the factory captured at signup. Admin can edit
// inline (hits /api/company PUT) or accept as-is. Intentionally minimal —
// full company settings are at Settings → Company.

interface Company {
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  website?: string | null
}

function getToken(): string {
  try { return localStorage.getItem('token') || '' } catch { return '' }
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() }
}

export function CompanyConfirmStep({ onNext }: { onNext: () => void }): React.ReactElement {
  const [company, setCompany] = useState<Company | null>(null)
  const [editing, setEditing] = useState<Partial<Company>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/company', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setCompany(d); setEditing({ name: d.name, phone: d.phone, address: d.address, city: d.city, state: d.state, zip: d.zip, website: d.website }) })
      .catch(e => setError(e.message))
  }, [])

  async function saveAndContinue() {
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/company', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(editing) })
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Save failed') }
      onNext()
    } catch (err: any) { setError(err.message) }
    setSaving(false)
  }

  if (!company) return <div className="text-sm text-gray-500">Loading company info…</div>

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Confirm your business details</h2>
      <p className="text-sm text-gray-500 mb-6">These show up on invoices, quotes, and your public site. Edit anything that isn't right.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Field label="Company name" value={editing.name || ''} onChange={v => setEditing(e => ({ ...e, name: v }))} />
        <Field label="Phone" value={editing.phone || ''} onChange={v => setEditing(e => ({ ...e, phone: v }))} />
        <Field label="Website" value={editing.website || ''} onChange={v => setEditing(e => ({ ...e, website: v }))} />
        <Field label="Address" value={editing.address || ''} onChange={v => setEditing(e => ({ ...e, address: v }))} />
        <Field label="City" value={editing.city || ''} onChange={v => setEditing(e => ({ ...e, city: v }))} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="State" value={editing.state || ''} onChange={v => setEditing(e => ({ ...e, state: v }))} />
          <Field label="ZIP" value={editing.zip || ''} onChange={v => setEditing(e => ({ ...e, zip: v }))} />
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={saveAndContinue} disabled={saving} className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-sm font-semibold">
          {saving ? 'Saving…' : 'Save & Continue'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
    </div>
  )
}
