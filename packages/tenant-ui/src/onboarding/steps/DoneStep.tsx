import React, { useState } from 'react'

// Final step — marks companies.onboarding_completed_at so the tenant's
// root router stops redirecting here. Calls /api/company/complete-onboarding
// (added as a tiny endpoint alongside the existing company route).

function getToken(): string { try { return localStorage.getItem('token') || '' } catch { return '' } }
function authHeaders() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() } }

export function DoneStep({ onComplete }: { onComplete: () => void }): React.ReactElement {
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')

  async function finish() {
    setFinishing(true); setError('')
    try {
      const res = await fetch('/api/onboarding/complete', { method: 'POST', headers: authHeaders() })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not finish') }
      onComplete()
    } catch (err: any) { setError(err.message); setFinishing(false) }
  }

  return (
    <div className="text-center">
      <div className="w-16 h-16 rounded-full bg-green-500 text-white mx-auto flex items-center justify-center text-3xl mb-4">✓</div>
      <h2 className="text-2xl font-bold mb-2">You're set up</h2>
      <p className="text-sm text-gray-600 mb-6">Your CRM is ready. You can tune anything later in Settings.</p>

      {error && <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700 text-left">{error}</div>}

      <button onClick={finish} disabled={finishing} className="px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-400 text-white rounded-md text-base font-semibold">
        {finishing ? 'Finishing…' : 'Go to my dashboard'}
      </button>
    </div>
  )
}
