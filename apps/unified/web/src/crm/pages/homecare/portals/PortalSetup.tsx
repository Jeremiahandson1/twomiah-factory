// An invite (or forgot-password) link's page: /portal/setup?token=…, where the person sets their portal password.
// Moved from templates/crm-homecare/frontend/src/components/portal/PortalSetup.tsx.
//
// Server: POST /api/portal/set-password { token, password } → { success, message } (server/crm/homecare/portals/
// clientPortal.ts); refused 400 for a short password or a used / expired link.
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { agencyNameFromPage, publicCall } from './portalHttp'
import { PasswordInput } from '../../../../shared'

export default function PortalSetup() {
  const { search } = useLocation()
  const token = new URLSearchParams(search).get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const agency = agencyNameFromPage()

  useEffect(() => {
    if (!token) setError('Invalid invite link. Please contact your care coordinator.')
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setLoading(true)
    try {
      const r = await publicCall('POST', '/api/portal/set-password', { token, password })
      if (!r.ok) throw new Error(r.error || 'Setup failed')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>✅</div>
          <h2>You're all set!</h2>
          <p style={{ color: 'var(--hc-ink-soft)', marginBottom: '24px' }}>
            Your portal account is ready. You can now sign in to view your care schedule and more.
          </p>
          <a href="/portal" className="hc-btn hc-btn-primary hc-btn-block">Go to Portal Login</a>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '2.5rem' }}>🔐</span>
        </div>
        <h1>Set Your Password</h1>
        <p>Create a password for your {agency ? `${agency} ` : ''}portal.</p>

        {error && <div className="alert alert-error">{error}</div>}

        {token && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="password">New Password</label>
              <PasswordInput id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 characters" required />
            </div>

            <div className="form-group">
              <label htmlFor="confirm">Confirm Password</label>
              <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" required />
            </div>

            <button type="submit" className="hc-btn hc-btn-primary hc-btn-block" disabled={loading}>
              {loading ? 'Setting password...' : 'Set Password & Activate Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
