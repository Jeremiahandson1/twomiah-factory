import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setSubmitting(true)
    try {
      await api.post('/api/admin/password/forgot', { email })
      setSent(true)
    } catch (err: any) {
      setError(err?.message || 'Request failed')
    } finally { setSubmitting(false) }
  }

  return (
    <div className="h-full grid place-items-center bg-brand-deep p-6">
      <div className="w-full max-w-md card card-padding">
        <h1 className="text-2xl text-ink mb-1">Reset password</h1>
        <p className="text-sm text-muted mb-6">Enter the email on your account. We'll send you a one-hour reset link.</p>
        {sent ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-3">
              If that email is on file, a reset link is on its way. Check your inbox (and spam) within a minute or two.
            </div>
            <Link to="/login" className="block text-center text-sm text-muted hover:text-ink">← Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1.5">Email</label>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" autoFocus />
            </div>
            {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={submitting} className="btn-primary btn-lg w-full disabled:opacity-50">
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <Link to="/login" className="block text-center text-sm text-muted hover:text-ink">← Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  )
}
