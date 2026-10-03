import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, pinLogin, completeMfa, error } = useAuth();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  /**
   * PIN SIGN-IN. (T37)
   *
   * POST /api/auth/pin-login has been live and validating on every dispensary tenant with nothing in
   * this frontend mentioning a PIN — so a budtender could neither set one nor tap in with one, and
   * the uniqueness rule, the lockout rules and the "a failed PIN increments nobody" fix from T57 had
   * no way to be reached by a person at all.
   *
   * It feeds the SAME code step as the password: /pin-login asks the same gate and opens the same
   * challenge, because a PIN is a convenience at the counter and not a way around somebody's second
   * factor.
   */
  const [mode, setMode] = useState('password');
  const [pin, setPin] = useState('');

  // The second step, when the account has two-factor on. Null until the password is accepted and
  // the server asks for a code. (T49 H4 — there was no step here at all, so the recovery codes the
  // product generates had nowhere to be typed.)
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLocalError('');

    try {
      const result = await login(formData.email.toLowerCase().trim(), formData.password);
      // The password was right and it is not enough. Ask for the code instead of going in.
      if (result?.mfaRequired) { setChallenge(result); return; }
      navigate('/');
    } catch (err) {
      setLocalError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLocalError('');
    try {
      const result = await pinLogin(pin);
      if (result?.mfaRequired) { setChallenge(result); return; }
      navigate('/');
    } catch (err) {
      // The PIN field is cleared on a miss — the next person at the till should not inherit
      // somebody's half-typed digits — but the screen stays on PIN so they can simply try again.
      setLocalError(err.message || 'That PIN was not accepted');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLocalError('');
    try {
      await completeMfa(challenge.challengeId, code.trim());
      navigate('/');
    } catch (err) {
      // The code field keeps its place: a mistyped code should not send anyone back to the
      // password, and a challenge that has genuinely expired says so and does.
      setLocalError(err.message || 'That code was not accepted');
      setCode('');
      if (/expired|no longer valid/i.test(String(err.message || ''))) setChallenge(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center py-12 px-4 dark:bg-slate-800">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">{"{{COMPANY_NAME}}"}</h1>
          <p className="mt-2 text-gray-600 dark:text-slate-400">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8 dark:bg-slate-900">
          {(localError || error) && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm dark:text-red-400 dark:bg-red-950/40">
              {localError || error}
            </div>
          )}

          {/* Two-factor: the code step. Shown only once the server has asked for one. (T49 H4) */}
          {challenge ? (
            <form onSubmit={handleCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">
                  {challenge.methods?.includes('totp') ? 'Authenticator code' : 'Verification code'}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  inputMode="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 tracking-widest dark:border-slate-700 dark:text-slate-100"
                  placeholder="123456"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  {challenge.recoveryCodesAvailable
                    ? 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-orange-600 text-white py-2 px-4 rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {loading ? 'Checking…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => { setChallenge(null); setCode(''); setLocalError(''); }}
                className="w-full text-sm text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Use a different account
              </button>
            </form>
          ) : mode === 'pin' ? (
            /* The counter's way in: digits only, no email. (T37) */
            <form onSubmit={handlePin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Your PIN</label>
                <input
                  type="password"
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 text-center text-2xl tracking-[0.5em] dark:border-slate-700 dark:text-slate-100"
                  placeholder="••••"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  Four to eight digits. Set yours under Settings › Security once you are signed in.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || pin.length < 4}
                className="w-full py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Checking…' : 'Sign in with PIN'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('password'); setPin(''); setLocalError(''); }}
                className="w-full text-sm text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Use email and password
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
              <input
                type="email"
                required
                autoCapitalize="none"
                autoCorrect="off"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Password</label>
              <input
                type="password"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          )}

          {/* The way to the PIN, offered only on the password step: at the code step the account is
              already chosen, and on the PIN step the way back is inside that form. */}
          {!challenge && mode === 'password' && (
          <div className="mt-6 pt-5 border-t border-gray-200 text-center dark:border-slate-700">
            <button
              type="button"
              onClick={() => { setMode('pin'); setLocalError(''); }}
              className="w-full py-2 px-4 border border-orange-300 text-orange-700 font-medium rounded-lg hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/30"
            >
              Sign in with a PIN
            </button>
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">For getting back to the till between customers.</p>
          </div>
          )}

          {/* Nothing to forget yet at the code step — the password is already behind them. And a
              password reset is not the way out of a forgotten PIN; signing in properly is. */}
          {!challenge && mode === 'password' && (
          <div className="mt-6 text-center text-sm">
            <Link to="/forgot-password" className="text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 font-medium dark:text-slate-400">
              Forgot password?
            </Link>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
