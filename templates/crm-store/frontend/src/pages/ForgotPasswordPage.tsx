import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Store } from 'lucide-react'
import api from '../services/api'

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.forgotPassword(email)
    } finally {
      // Always show the same confirmation — never reveal whether the email exists.
      setSent(true)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6 text-xl font-bold text-gray-900">
          <Store className="h-6 w-6 text-primary-500" /> {companyName}
        </div>
        {sent ? (
          <div className="card p-6 space-y-3">
            <h1 className="text-lg font-semibold text-gray-900">Check your email</h1>
            <p className="text-sm text-gray-500">
              If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a link to set a new
              password. The link expires in 1 hour.
            </p>
            <Link to="/login" className="text-sm text-primary-600 hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Forgot password</h1>
              <p className="text-sm text-gray-500">Enter your admin email and we&rsquo;ll send a reset link</p>
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <Link to="/login" className="block text-center text-sm text-gray-500 hover:underline">Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  )
}
