import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Loader2, ArrowRight } from 'lucide-react';

export default function PortalLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'email' | 'pin'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter your email address'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Account not found');
      }
      setStep('pin');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) { setError('Enter your PIN'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/portal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Invalid PIN');
      }
      const data = await res.json();
      localStorage.setItem('portalToken', data.token);
      navigate('/portal/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Home className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Customer Portal</h1>
          <p className="text-gray-400 text-sm mt-1">Track your roofing project</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl border border-gray-700">
          {step === 'email' ? (
            <form onSubmit={handleSubmitEmail}>
              <label className="text-xs text-gray-400 block mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="your@email.com"
                autoFocus
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500"
              />
              {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {loading ? 'Checking...' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmitPin}>
              <p className="text-gray-400 text-sm mb-4">
                We sent a PIN to <span className="text-white font-medium">{email}</span>
              </p>
              <label className="text-xs text-gray-400 block mb-1.5">Enter PIN</label>
              <input
                type="text"
                value={pin}
                onChange={(e) => { setPin(e.target.value); setError(''); }}
                placeholder="123456"
                autoFocus
                maxLength={6}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-500 text-sm text-center tracking-[0.3em] text-lg font-mono focus:outline-none focus:border-blue-500"
              />
              {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-4 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? 'Verifying...' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setPin(''); setError(''); }}
                className="w-full mt-2 py-2 text-gray-400 text-sm hover:text-gray-300"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
