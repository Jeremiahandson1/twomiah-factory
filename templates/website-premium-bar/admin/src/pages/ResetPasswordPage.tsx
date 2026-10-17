import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) setError('No reset token in the link. Request a new reset email.')
  }, [token])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (next.length < 10) { setError('Password must be at least 10 characters.'); return }
    if (!/[A-Za-z]/.test(next) || !/[\d\W_]/.test(next)) { setError('Mix letters with at least one number or symbol.'); return }
    if (next !== confirm) { setError("Passwords don't match."); return }
    setSubmitting(true)
    try {
      await api.post('/api/admin/password/reset', { token, newPassword: next })
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err: any) {
      setError(err?.message || 'Reset failed')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="h-full grid place-items-center bg-brand-deep p-6">
      <div className="w-full max-w-md card card-padding">
        <h1 className="text-2xl text-ink mb-1">Choose a new password</h1>
        <p className="text-sm text-muted mb-6">At least 10 characters, mixing letters with a number or symbol.</p>
        {done ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-3">
              Password updated. Redirecting to sign in…
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">New password</label>
              <input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} className="input" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Confirm new password</label>
              <input type="password" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" />
            </div>
            {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={submitting || !token} className="btn-primary btn-lg w-full disabled:opacity-50">
              {submitting ? 'Updating…' : 'Set new password'}
            </button>
            <Link to="/login" className="block text-center text-sm text-muted hover:text-ink">← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  )
}
