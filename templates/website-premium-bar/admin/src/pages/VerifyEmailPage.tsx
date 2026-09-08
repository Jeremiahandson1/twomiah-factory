import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setStatus('error'); setError('Missing verification token.'); return }
    api.post('/api/admin/verify-email/confirm', { token })
      .then(() => setStatus('ok'))
      .catch((e) => { setStatus('error'); setError(e?.message || 'Verification failed') })
  }, [token])

  return (
    <div className="h-full grid place-items-center bg-brand-deep p-6">
      <div className="w-full max-w-md card card-padding text-center">
        {status === 'pending' && <p className="text-muted">Verifying…</p>}
        {status === 'ok' && (
          <>
            <h1 className="text-2xl text-ink mb-2">Email confirmed</h1>
            <p className="text-sm text-muted mb-6">Thanks. You can close this tab, or sign in below.</p>
            <Link to="/login" className="btn-primary btn-md inline-block">Sign in</Link>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl text-ink mb-2">Couldn't verify</h1>
            <p className="text-sm text-muted mb-6">{error}</p>
            <Link to="/login" className="btn-primary btn-md inline-block">Sign in</Link>
          </>
        )}
      </div>
    </div>
  )
}
