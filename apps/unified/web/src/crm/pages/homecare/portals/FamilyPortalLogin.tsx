// The family portal's sign-in, separate from the staff sign-in and the client portal. Moved from
// templates/crm-homecare/frontend/src/components/portal/FamilyPortalLogin.tsx.
//
// Server: POST /api/family-portal/login { email, password } (server/crm/homecare/portals/familyPortal.ts) → { token,
// user: the family member (id, clientId, name, relationship, email, phone, isActive, isPrimaryContact, canViewSchedule,
// canViewCarePlan, canViewMedications, canMessage, lastLogin, …) }; refused 401 "Invalid credentials".
import { useState, type FormEvent } from 'react'
import { agencyNameFromPage, publicCall } from './portalHttp'
import type { FamilyMember } from './FamilyPortal'

export default function FamilyPortalLogin({ onLogin }: { onLogin: (token: string, user: FamilyMember) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const agency = agencyNameFromPage()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await publicCall<{ token: string; user: FamilyMember }>('POST', '/api/family-portal/login', { email: email.trim().toLowerCase(), password })
      if (!r.ok) throw new Error(r.error || `Error ${r.status}`)
      onLogin(r.data.token, r.data.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '2.5rem' }}>👨‍👩‍👧</span>
        </div>
        <h1>{agency}</h1>
        <p>Home Care — Family Portal</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>

          <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In to Family Portal'}
          </button>
        </form>

        <p className="login-footer" style={{ marginTop: '16px', fontSize: '0.8rem' }}>
          Are you a client?{' '}
          <a href="/portal" style={{ color: 'var(--hc-blue-ink)' }}>Client portal</a>
          {' · '}
          <a href="/login" style={{ color: 'var(--hc-blue-ink)' }}>Staff login</a>
        </p>

        <p className="login-footer">HIPAA-compliant. Authorized family members only.</p>
      </div>
    </div>
  )
}
