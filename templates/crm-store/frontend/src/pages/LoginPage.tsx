import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Store } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const companyName = import.meta.env.VITE_COMPANY_NAME || 'Store'

export default function LoginPage() {
  const { login, completeMfa } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /**
   * The code step. Sign-in answers a session, or `mfaRequired` with a challenge id — the same sign-in waiting for six
   * digits, so it replaces the form rather than sitting beside it, and the password is never asked for twice. The same
   * step as the fleet's shared LoginPage (packages/tenant-ui/src/auth/LoginPage.tsx).
   */
  const [challenge, setChallenge] = useState<{ id: string; recovery: boolean } | null>(null)
  const [code, setCode] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const r = await login(email, password)
      if (r?.mfaRequired) { setChallenge({ id: r.challengeId, recovery: r.recoveryCodesAvailable === true }); setCode(''); return }
      navigate('/')
    } catch (err: any) {
      setError(err?.message || 'Login failed')
    } finally { setBusy(false) }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!challenge) return
    setError(''); setBusy(true)
    try {
      await completeMfa(challenge.id, code.trim())
      navigate('/')
    } catch (err: any) {
      // 401 is a wrong code: try again here. Anything else (spent, expired, five tries) means the request is over —
      // back to the password, with the server's own sentence saying why.
      if (err?.status !== 401) { setChallenge(null); setPassword('') }
      setError(err?.message || 'That code was not accepted')
      setCode('')
    } finally { setBusy(false) }
  }

  const startAgain = () => { setChallenge(null); setCode(''); setPassword(''); setError('') }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 dark:bg-slate-800 dark:text-slate-100">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6 text-xl font-bold text-gray-900 dark:text-slate-100">
          <Store className="h-6 w-6 text-primary-500 dark:text-primary-300" /> {companyName}
        </div>
        {challenge ? (
          <form onSubmit={submitCode} className="card p-6 space-y-4">
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100">One more step</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Enter the six-digit code from your authenticator app{challenge.recovery ? ', or one of your recovery codes' : ''}.
              </p>
            </div>
            {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:text-red-400 dark:bg-red-950/40">{error}</div>}
            <div>
              <label className="label" htmlFor="login-code">Code</label>
              <input id="login-code" className="input font-mono tracking-widest" type="text" name="one-time-code" inputMode="text"
                autoComplete="one-time-code" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoFocus required
                value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            <button className="btn-primary w-full" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Finish signing in'}</button>
            {/* A way back, because a wrong account is the other reason somebody is stuck here. */}
            <button type="button" onClick={startAgain} className="block w-full text-center text-sm text-gray-500 hover:underline dark:text-slate-400">Start again</button>
          </form>
        ) : (
        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Store admin</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Sign in to manage your store</p>
          </div>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:text-red-400 dark:bg-red-950/40">{error}</div>}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <Link to="/forgot-password" className="block text-center text-sm text-gray-500 hover:underline dark:text-slate-400">Forgot password?</Link>
        </form>
        )}
      </div>
    </div>
  )
}
