import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Store } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err: any) {
      setError(err?.message || 'Login failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6 text-xl font-bold text-gray-900">
          <Store className="h-6 w-6 text-primary-500" /> {companyName}
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Store admin</h1>
            <p className="text-sm text-gray-500">Sign in to manage your store</p>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <Link to="/forgot-password" className="block text-center text-sm text-gray-500 hover:underline">Forgot password?</Link>
        </form>
      </div>
    </div>
  )
}
