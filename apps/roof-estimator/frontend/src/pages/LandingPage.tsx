import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { MapPin, Zap, BarChart3, Box, ArrowRight, Eye, EyeOff } from 'lucide-react'

export default function LandingPage() {
  const { auth, login, signup, logout } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'signup'>('signup')
  const [form, setForm] = useState({ companyName: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (mode === 'signup') {
        await signup(form.companyName, form.email, form.password)
      } else {
        await login(form.email, form.password)
      }
      navigate('/reports/new')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // If already logged in, show dashboard link
  if (auth.token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="text-xl font-bold">Roof Estimator</div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{auth.tenant?.companyName}</span>
            <button onClick={() => navigate('/reports')} className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700">
              My Reports
            </button>
            <button onClick={() => navigate('/reports/new')} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              New Report
            </button>
            <button onClick={logout} className="text-sm text-gray-400 hover:text-white">Logout</button>
          </div>
        </nav>
        <Hero onGetStarted={() => navigate('/reports/new')} />
        <Features />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
        <div className="text-xl font-bold">Roof Estimator</div>
        <div className="flex items-center gap-3 text-sm">
          <button onClick={() => setMode('login')} className="text-gray-400 hover:text-white">Log In</button>
          <button onClick={() => setMode('signup')} className="px-4 py-2 bg-orange-600 rounded-lg hover:bg-orange-700 font-medium">Sign Up Free</button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-12 grid lg:grid-cols-2 gap-16 items-center">
        {/* Left: Hero */}
        <div>
          <h1 className="text-5xl font-extrabold leading-tight mb-6">
            Professional Roof Reports
            <span className="block text-orange-500">In Seconds</span>
          </h1>
          <p className="text-lg text-gray-300 mb-8 leading-relaxed">
            Enter an address. Get accurate roof measurements, satellite imagery,
            AI-detected condition scores, and a professional PDF report — instantly.
          </p>
          <div className="flex flex-col gap-3 text-sm text-gray-400">
            <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-orange-500" /> Satellite + LiDAR elevation analysis</div>
            <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-500" /> Ridge, valley, hip, rake, eave measurements</div>
            <div className="flex items-center gap-2"><Box className="w-4 h-4 text-purple-500" /> Interactive 3D roof visualization</div>
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-green-500" /> Works for any US address</div>
          </div>
        </div>

        {/* Right: Auth form */}
        <div className="bg-gray-800/80 backdrop-blur border border-gray-700 rounded-2xl p-8">
          <h2 className="text-2xl font-bold mb-2">{mode === 'signup' ? 'Get Started Free' : 'Welcome Back'}</h2>
          <p className="text-gray-400 text-sm mb-6">
            {mode === 'signup' ? '5 free reports per month. No credit card required.' : 'Log in to your account.'}
          </p>

          {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Company Name</label>
                <input type="text" value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                  placeholder="Acme Roofing" required className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@company.com" required className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Min 6 characters" required minLength={6} className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 pr-12" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3.5 text-gray-500 hover:text-gray-300">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors">
              {loading ? 'Loading...' : mode === 'signup' ? 'Create Account' : 'Log In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-500">
            {mode === 'signup' ? (
              <>Already have an account? <button onClick={() => setMode('login')} className="text-orange-500 hover:underline">Log in</button></>
            ) : (
              <>Need an account? <button onClick={() => setMode('signup')} className="text-orange-500 hover:underline">Sign up free</button></>
            )}
          </div>
        </div>
      </div>

      <Features />
    </div>
  )
}

function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center">
      <h1 className="text-5xl font-extrabold leading-tight mb-6">
        Professional Roof Reports
        <span className="block text-orange-500">In Seconds</span>
      </h1>
      <p className="text-lg text-gray-300 mb-8 max-w-2xl mx-auto">
        Enter an address. Get accurate roof measurements, satellite imagery, and a professional PDF report.
      </p>
      <button onClick={onGetStarted}
        className="px-8 py-4 bg-orange-600 text-white text-lg font-semibold rounded-xl hover:bg-orange-700 transition-colors inline-flex items-center gap-2">
        Generate a Report <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  )
}

function Features() {
  const features = [
    { icon: <MapPin className="w-6 h-6" />, title: 'Satellite Imagery', desc: 'High-resolution aerial imagery from Google Solar API with optional Nearmap 5cm upgrade.', color: 'text-blue-400' },
    { icon: <Zap className="w-6 h-6" />, title: 'AI Roof Detection', desc: 'One-click AI segmentation detects roof planes, ridges, valleys, and edges automatically.', color: 'text-yellow-400' },
    { icon: <BarChart3 className="w-6 h-6" />, title: 'Accurate Measurements', desc: 'Ridge, valley, hip, rake, eave linear footage. Waste factor. Ice & water shield calculations.', color: 'text-green-400' },
    { icon: <Box className="w-6 h-6" />, title: '3D Visualization', desc: 'Interactive 3D roof model built from LiDAR elevation data. Rotate, zoom, and inspect.', color: 'text-purple-400' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-16">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map(f => (
          <div key={f.title} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className={`${f.color} mb-3`}>{f.icon}</div>
            <h3 className="text-white font-semibold mb-2">{f.title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
