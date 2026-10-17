import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, ApiError } from '../api/client'

export function LoginPage() {
  const { login, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // 2FA challenge state
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const redirectAfterLogin = () => {
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/pages'
    navigate(from, { replace: true })
  }

  const onPasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await login(email, password)
      if (result.requires2fa) {
        setChallengeId(result.challengeId)
      } else {
        redirectAfterLogin()
      }
    } catch (err: any) {
      setError(err?.message || 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  const on2faSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/api/admin/login/2fa', { challengeId, code: code.trim() })
      await refresh()
      redirectAfterLogin()
    } catch (err: any) {
      if (err instanceof ApiError && err.details?.challengeId) {
        setChallengeId(err.details.challengeId)
      }
      setError(err?.message || 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full grid place-items-center bg-brand-deep p-6">
      <div className="w-full max-w-md card card-padding">
        {!challengeId ? (
          <>
            <h1 className="text-2xl text-ink mb-1">Sign in</h1>
            <p className="text-sm text-muted mb-6">Premium-contractor admin</p>
            <form onSubmit={onPasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Email</label>
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Password</label>
                <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
              </div>
              {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              <button type="submit" disabled={submitting} className="btn-primary btn-lg w-full disabled:opacity-50">
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="text-center">
                <Link to="/forgot-password" className="text-sm text-muted hover:text-ink">Forgot your password?</Link>
              </div>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl text-ink mb-1">Verify it's you</h1>
            <p className="text-sm text-muted mb-6">Open your authenticator app and enter the 6-digit code, or use a recovery code.</p>
            <form onSubmit={on2faSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Code</label>
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="input font-mono tracking-widest text-lg"
                  placeholder="123456"
                />
              </div>
              {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              <button type="submit" disabled={submitting} className="btn-primary btn-lg w-full disabled:opacity-50">
                {submitting ? 'Verifying…' : 'Verify'}
              </button>
              <button type="button" onClick={() => { setChallengeId(null); setCode(''); setError(null) }} className="block w-full text-center text-sm text-muted hover:text-ink">
                ← Back to sign in
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
