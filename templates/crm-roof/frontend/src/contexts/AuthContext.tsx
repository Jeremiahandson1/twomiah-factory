import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type User = { userId: string; email: string; role: string; companyId: string }
type Company = { id: string; name: string; enabledFeatures: string[]; settings: any }
type AuthState = { user: User | null; company: Company | null; token: string | null; login: (email: string, password: string) => Promise<void>; logout: () => void; hasFeature: (featureId: string) => boolean }

const AuthContext = createContext<AuthState>(null as any)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)

  useEffect(() => {
    if (token) fetchMe()
  }, [token])

  // Keep the access token alive. It expires after 15 minutes; most pages call
  // the API with a raw fetch using the token from this context, so if it lapses
  // every save silently 401s until a full reload. Refresh once on mount and then
  // every 12 minutes so the token — and every consumer reading it — stays valid.
  useEffect(() => {
    if (!token) return
    refreshAccessToken()
    const iv = setInterval(() => { refreshAccessToken() }, 12 * 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshAccessToken(): Promise<boolean> {
    const rt = localStorage.getItem('refreshToken')
    if (!rt) return false
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      })
      if (!res.ok) return false
      const data = await res.json()
      localStorage.setItem('token', data.accessToken)
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken)
      setToken(data.accessToken)
      return true
    } catch { return false }
  }

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 401) {
        // Token expired — try one refresh before giving up, so a lapsed session
        // recovers instead of bouncing to /login.
        const ok = await refreshAccessToken()
        if (!ok) logout()
        return
      }
      // Only 401 means "not authenticated". A slow/failed load (network error or
      // a 5xx) must NOT log the user out — that was booting valid sessions to the
      // sign-in screen on the first slow request.
      if (!res.ok) return
      const data = await res.json()
      setUser(data.user)
      setCompany(data.company)
    } catch {
      // Network error — keep the session; the next call or refresh recovers.
    }
  }

  async function login(email: string, password: string) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Login failed') }
    const data = await res.json()
    localStorage.setItem('token', data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
    setToken(data.accessToken)
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    setToken(null)
    setUser(null)
    setCompany(null)
  }

  const hasFeature = (featureId: string): boolean => {
    return company?.enabledFeatures?.includes(featureId) ?? false
  }

  return <AuthContext.Provider value={{ user, company, token, login, logout, hasFeature }}>{children}</AuthContext.Provider>
}
