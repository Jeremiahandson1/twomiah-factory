// src/components/Login.tsx
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const Login = ({ onLogin }: { onLogin?: (token: string, user: any) => void }) => {
  const { login, completeMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // services/sessionFetch.ts sends a session that could not be refreshed here, with ?expired=1, so the person is told
  // why they are signing in again rather than seeing a page of empty lists.
  const [expired] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('expired') === '1');

  // The code step. Sign-in answers a session, or { mfaRequired, challengeId } — the same sign-in waiting for six digits,
  // so it replaces the form rather than sitting beside it, and the password is never asked for twice. The same step as
  // the fleet's shared LoginPage (packages/tenant-ui/src/auth/LoginPage.tsx).
  const [challenge, setChallenge] = useState<{ id: string; recovery: boolean } | null>(null);
  const [code, setCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(email.trim().toLowerCase(), password);
      if (data?.mfaRequired) {
        setChallenge({ id: String(data.challengeId), recovery: data.recoveryCodesAvailable === true });
        setCode('');
        return;
      }
      // Legacy callback for backward compat (App.tsx MainApp)
      if (onLogin) onLogin(data.accessToken, data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e) => {
    e.preventDefault();
    if (!challenge) return;
    setError('');
    setLoading(true);
    try {
      const data = await completeMfa(challenge.id, code.trim());
      if (onLogin) onLogin(data.accessToken, data.user);
    } catch (err: any) {
      // 401 is a wrong code: try again here. Anything else (spent, expired, five tries) means the request is over —
      // back to the password, with the server's own sentence saying why.
      if (err?.status !== 401) { setChallenge(null); setPassword(''); }
      setError(err?.message || 'That code was not accepted');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const startAgain = () => { setChallenge(null); setCode(''); setPassword(''); setError(''); };

  if (challenge) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1>{"{{COMPANY_NAME}}"}</h1>
          <p>One more step: enter the six-digit code from your authenticator app{challenge.recovery ? ', or one of your recovery codes' : ''}.</p>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <form onSubmit={handleCode}>
            <div className="form-group">
              <label htmlFor="login-code">Code</label>
              <input
                id="login-code"
                type="text"
                name="one-time-code"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                style={{ fontFamily: 'monospace', letterSpacing: '0.2em' }}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading || !code.trim()}>
              {loading ? 'Checking...' : 'Finish signing in'}
            </button>
          </form>

          {/* A way back, because a wrong account is the other reason somebody is stuck here. */}
          <p style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.85rem' }}>
            <button
              type="button"
              onClick={startAgain}
              style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', padding: 0 }}
            >
              Start again
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>{"{{COMPANY_NAME}}"}</h1>
        <p>Sign in to your account</p>

        {expired && !error && <div className="alert alert-info" role="status">Your session ended. Please sign in again to pick up where you left off.</div>}
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '1.1rem',
                  lineHeight: 1,
                  color: '#9CA3AF',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.85rem' }}>
          <button
            type="button"
            onClick={() => setShowForgot(v => !v)}
            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline', padding: 0 }}
          >
            Forgot password?
          </button>
        </p>
        {showForgot && (
          <p style={{ textAlign: 'center', fontSize: '0.82rem', color: '#6B7280', margin: '0.25rem 0 0' }}>
            Ask your agency administrator to reset it from <strong>Settings › Users &amp; Access</strong>.
          </p>
        )}

        <p className="login-footer">
          HIPAA-compliant system. Authorized personnel only.
        </p>
      </div>
    </div>
  );
};

export default Login;
