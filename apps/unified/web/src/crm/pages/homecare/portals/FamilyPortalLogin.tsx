// The family portal's sign-in, separate from the staff sign-in and the client portal. Moved from
// templates/crm-homecare/frontend/src/components/portal/FamilyPortalLogin.tsx.
//
// Server: POST /api/family-portal/login { email, password } (server/crm/homecare/portals/familyPortal.ts) → { token,
// user: the family member (id, clientId, name, relationship, email, phone, isActive, isPrimaryContact, canViewSchedule,
// canViewCarePlan, canViewMedications, canMessage, lastLogin, …) }; refused 401 "Invalid credentials".
import { useEffect, useState, type FormEvent } from 'react'
import { agencyNameFromPage, publicCall } from './portalHttp'
import type { FamilyMember } from './FamilyPortal'
import { PasswordInput } from '../../../../shared'

export default function FamilyPortalLogin({ onLogin }: { onLogin: (token: string, user: FamilyMember) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const agency = agencyNameFromPage()
  // care_family_comms: "Forgot password?" appears only when the agency has it, and a link from the email (?reset=…) opens the new-password form.
  const [canForgot, setCanForgot] = useState(false)
  const [mode, setMode] = useState<'signin' | 'forgot' | 'reset'>('signin')
  const [notice, setNotice] = useState('')
  const resetToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('reset') : null
  useEffect(() => {
    publicCall<{ forgotPassword?: boolean }>('GET', '/api/family-portal/options').then((r) => { if (r.ok) setCanForgot(!!r.data?.forgotPassword) }).catch(() => {})
    if (resetToken) setMode('reset')
  }, [resetToken])

  const forgot = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const r = await publicCall<{ message?: string }>('POST', '/api/family-portal/forgot-password', { email: email.trim().toLowerCase() })
      if (!r.ok) throw new Error(r.error || `Error ${r.status}`)
      setNotice(r.data?.message || 'If that email has an account, we have sent a link.'); setMode('signin')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) }
  }
  const reset = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const r = await publicCall<{ message?: string }>('POST', '/api/family-portal/reset-password', { token: resetToken, password })
      if (!r.ok) throw new Error(r.error || `Error ${r.status}`)
      setNotice(r.data?.message || 'Your password has been changed.'); setPassword(''); setMode('signin')
      window.history.replaceState(null, '', window.location.pathname)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setLoading(false) }
  }

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
        {notice && <div className="alert alert-success" role="status">{notice}</div>}

        {mode === 'forgot' && (
          <form onSubmit={forgot}>
            <div className="form-group">
              <label htmlFor="forgot-email">Your email address</label>
              <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
            </div>
            <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>{loading ? 'Sending...' : 'Send me a link'}</button>
            <p className="login-footer"><a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); setError('') }}>Back to sign in</a></p>
          </form>
        )}
        {mode === 'reset' && (
          <form onSubmit={reset}>
            <div className="form-group">
              <label htmlFor="new-password">Choose a new password (at least 8 characters)</label>
              <PasswordInput id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            </div>
            <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>{loading ? 'Saving...' : 'Save new password'}</button>
          </form>
        )}

        {mode === 'signin' && <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>

          <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In to Family Portal'}
          </button>
          {canForgot && <p className="login-footer"><a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); setError(''); setNotice('') }}>Forgot your password?</a></p>}
        </form>}

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
