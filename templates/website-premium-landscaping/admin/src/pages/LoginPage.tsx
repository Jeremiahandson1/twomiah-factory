import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/pages'
      navigate(from, { replace: true })
    } catch (err: any) {
      setError(err?.message || 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full grid place-items-center bg-brand-deep p-6">
      <div className="w-full max-w-md card card-padding">
        <h1 className="text-2xl text-ink mb-1">Sign in</h1>
        <p className="text-sm text-muted mb-6">Premium-contractor admin</p>
        <form onSubmit={onSubmit} className="space-y-4">
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
        </form>
      </div>
    </div>
  )
}
