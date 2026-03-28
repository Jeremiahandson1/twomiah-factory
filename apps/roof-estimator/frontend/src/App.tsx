import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import LandingPage from './pages/LandingPage'
import ReportPage from './pages/ReportPage'
import ReportsListPage from './pages/ReportsListPage'

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

interface AuthState {
  token: string | null
  tenant: any | null
  user: any | null
}

const AuthContext = createContext<{
  auth: AuthState
  login: (email: string, password: string) => Promise<void>
  signup: (companyName: string, email: string, password: string) => Promise<void>
  logout: () => void
}>({} as any)

export function useAuth() { return useContext(AuthContext) }

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = localStorage.getItem('re_token')
    const tenant = localStorage.getItem('re_tenant')
    return { token, tenant: tenant ? JSON.parse(tenant) : null, user: null }
  })

  useEffect(() => {
    if (auth.token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${auth.token}` } })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => setAuth(prev => ({ ...prev, user: data.user, tenant: data.tenant })))
        .catch(() => { localStorage.removeItem('re_token'); setAuth({ token: null, tenant: null, user: null }) })
    }
  }, [auth.token])

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Login failed')
    const data = await res.json()
    localStorage.setItem('re_token', data.token)
    localStorage.setItem('re_tenant', JSON.stringify(data.tenant))
    setAuth({ token: data.token, tenant: data.tenant, user: data.user })
  }

  const signup = async (companyName: string, email: string, password: string) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, email, password }),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Signup failed')
    const data = await res.json()
    localStorage.setItem('re_token', data.token)
    localStorage.setItem('re_tenant', JSON.stringify(data.tenant))
    setAuth({ token: data.token, tenant: data.tenant, user: data.user })
  }

  const logout = () => {
    localStorage.removeItem('re_token')
    localStorage.removeItem('re_tenant')
    setAuth({ token: null, tenant: null, user: null })
  }

  return (
    <AuthContext.Provider value={{ auth, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/reports" element={<ProtectedRoute><ReportsListPage /></ProtectedRoute>} />
          <Route path="/reports/new" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { auth } = useAuth()
  if (!auth.token) return <Navigate to="/" replace />
  return <>{children}</>
}
