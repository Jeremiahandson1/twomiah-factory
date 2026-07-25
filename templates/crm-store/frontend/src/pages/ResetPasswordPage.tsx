import { useState, FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Store } from 'lucide-react'
import api from '../services/api'

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setBusy(true)
    try {
      await api.resetPassword(token, password)
      setDone(true)
    } catch (err: any) {
      setError(err?.message || 'Reset failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6 text-xl font-bold text-gray-900">
          <Store className="h-6 w-6 text-primary-500" /> {companyName}
        </div>
        {done ? (
          <div className="card p-6 space-y-3">
            <h1 className="text-lg font-semibold text-gray-900">Password updated</h1>
            <p className="text-sm text-gray-500">Your new password is set. Sign in to continue.</p>
            <Link to="/login" className="btn-primary block text-center">Sign in</Link>
          </div>
        ) : !token ? (
          <div className="card p-6 space-y-3">
            <h1 className="text-lg font-semibold text-gray-900">Invalid link</h1>
            <p className="text-sm text-gray-500">This reset link is missing its token. Request a new one.</p>
            <Link to="/forgot-password" className="text-sm text-primary-600 hover:underline">Request a new link</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Set a new password</h1>
              <p className="text-sm text-gray-500">Minimum 8 characters</p>
            </div>
            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <div>
              <label className="label">New password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
