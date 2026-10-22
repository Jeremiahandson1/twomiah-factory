// The client portal's sign-in, separate from the staff sign-in, with its forgot-password form. Moved from
// templates/crm-homecare/frontend/src/components/portal/PortalLogin.tsx.
//
// Server (server/crm/homecare/portals/clientPortal.ts): POST /api/portal/login { email, password } → { token, client:
// { id, firstName, lastName, email } }, refused 401 (wrong / not set up) or 423 (locked after five wrong passwords);
// POST /api/portal/forgot-password { email } → { success, message } (the same sentence whether or not the email has a
// login).
import { useState, type FormEvent } from 'react'
import { agencyNameFromPage, publicCall } from './portalHttp'
import { PasswordInput } from '../../../../shared'

export interface PortalLoginClient { id: string; firstName: string; lastName: string; email?: string }

const linkButton = { background: 'none', border: 'none', color: 'var(--hcp-navy)', cursor: 'pointer', fontSize: '0.88rem', textDecoration: 'underline' } as const

export default function PortalLogin({ onLogin }: { onLogin: (token: string, client: PortalLoginClient) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [message, setMessage] = useState('')
  const agency = agencyNameFromPage()

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const r = await publicCall<{ message?: string }>('POST', '/api/portal/forgot-password', { email: email.trim().toLowerCase() })
      if (!r.ok) throw new Error(r.error || `Error ${r.status}`)
      setMessage(r.data.message || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await publicCall<{ token: string; client: PortalLoginClient }>('POST', '/api/portal/login', { email: email.trim().toLowerCase(), password })
      if (!r.ok) {
        if (r.status === 423) throw new Error('Account temporarily locked. Please try again in 15 minutes.')
        throw new Error(r.error || `Error ${r.status}`)
      }
      onLogin(r.data.token, r.data.client)
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
          <span style={{ fontSize: '2.5rem' }}>🏠</span>
        </div>
        <h1>{agency}</h1>
        <p>Home Care — Client Portal</p>

        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {mode === 'login' && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>

            <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In to Portal'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }} style={linkButton}>
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword}>
            <p style={{ color: 'var(--hc-ink-soft)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <div className="form-group">
              <label htmlFor="forgot-email">Email Address</label>
              <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" required />
            </div>

            <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button type="button" onClick={() => { setMode('login'); setError(''); setMessage('') }} style={linkButton}>
                Back to Sign In
              </button>
            </div>
          </form>
        )}

        <p className="login-footer" style={{ marginTop: '16px', fontSize: '0.8rem' }}>
          Are you a staff member?{' '}
          <a href="/login" style={{ color: 'var(--hc-blue-ink)' }}>Staff login →</a>
          {' · '}
          <a href="/family" style={{ color: 'var(--hc-blue-ink)' }}>Family portal</a>
        </p>

        <p className="login-footer">HIPAA-compliant. Authorized clients only.</p>
      </div>
    </div>
  )
}
