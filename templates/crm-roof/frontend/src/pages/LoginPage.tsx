import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, type MfaChallenge } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login, completeMfa } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Two-factor: the password was right and the account has an authenticator, so a code is owed. (Launch list, 10/17)
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null)
  const [code, setCode] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const owed = await login(email, password)
      if (owed) { setChallenge(owed); setCode(''); return }
      navigate('/crm')
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault()
    if (!challenge) return
    setError('')
    setLoading(true)
    try {
      await completeMfa(challenge.challengeId, code)
      navigate('/crm')
    } catch (err: any) {
      setError(err.message || 'That code did not work')
      // An expired or spent challenge cannot be finished — back to the password, which opens a fresh one.
      if (err.restart) { setChallenge(null); setPassword('') }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 dark:bg-slate-800">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md dark:bg-slate-900">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{"{{COMPANY_NAME}}"}</h1>
          <p className="text-gray-500 mt-1 dark:text-slate-400">Sign in to your account</p>
        </div>

        {challenge ? (
          <form onSubmit={handleCode} className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">One more step</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
                {challenge.message || 'Enter the code from your authenticator app to finish signing in.'}
                {challenge.recoveryCodesAvailable ? ' No phone? Use one of your recovery codes.' : ''}
              </p>
            </div>
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 dark:text-red-300 dark:bg-red-950/40 dark:border-red-900">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="login-code" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Code</label>
              <input
                id="login-code"
                value={code}
                onChange={e => setCode(e.target.value)}
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent dark:border-slate-700"
                placeholder="123456"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Checking...' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setChallenge(null); setCode(''); setError(''); setPassword('') }}
              className="w-full text-sm text-gray-600 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 dark:text-red-400 dark:bg-red-950/40">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent dark:border-slate-700"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent dark:border-slate-700"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-2.5 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          <p className="text-center text-sm mt-4">
            <Link to="/forgot-password" className="text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 dark:text-slate-400">Forgot password?</Link>
          </p>
        </form>
        )}
      </div>
    </div>
  )
}
