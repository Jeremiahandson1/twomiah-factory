import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '../lib/authToken'

type User = { userId: string; email: string; role: string; companyId: string }
// primaryColor and logo have been on the company row all along — /api/auth/me returns them and Settings →
// Company sets them — this type just never named them, so anything in roof that wanted the tenant's brand
// could not reach it without a cast. Optional, because a company that has never set one has neither.
type Company = { id: string; name: string; enabledFeatures: string[]; settings: any; primaryColor?: string | null; logo?: string | null }
/**
 * `permissions` — what this person may actually do. (T41)
 *
 * crm-roof forks this context instead of using the shared one, and it never carried the permission
 * list, so nothing in the roofing client could ask "may they?" — which is why every write button on
 * every roofing screen was offered to a staff seat the API then refused. /api/auth/me and /login
 * both answer with it now (routes/auth.ts).
 *
 * The shared PermissionsProvider reads exactly `{ user, permissions }` off its auth context, so
 * naming it the same way here is what lets App.tsx mount it and `useMayWrite` start answering.
 */
type AuthState = { user: User | null; company: Company | null; permissions: string[] | null; token: string | null; login: (email: string, password: string) => Promise<void>; logout: () => void; hasFeature: (featureId: string) => boolean }

const AuthContext = createContext<AuthState>(null as any)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccessToken() || null)
  const [user, setUser] = useState<User | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  // null until /me (or a login) answers. The shared usePermissions treats an empty list as "not
  // known yet" and useMayWrite then OFFERS the control, so a page is never wrongly read-only while
  // this is in flight.
  const [permissions, setPermissions] = useState<string[] | null>(null)

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
    const rt = getRefreshToken()
    if (!rt) return false
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      })
      if (!res.ok) return false
      const data = await res.json()
      setTokens(data.accessToken, data.refreshToken)
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
      if (Array.isArray(data.permissions)) setPermissions(data.permissions)
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
    setTokens(data.accessToken, data.refreshToken)
    setToken(data.accessToken)
    // Straight off the login response, so the first render after signing in already knows. Waiting
    // for /me would leave one round trip in which every gated control reads as refused.
    if (Array.isArray(data.permissions)) setPermissions(data.permissions)
  }

  function logout() {
    clearTokens()
    setToken(null)
    setUser(null)
    setCompany(null)
    setPermissions(null)
  }

  const hasFeature = (featureId: string): boolean => {
    return company?.enabledFeatures?.includes(featureId) ?? false
  }

  return <AuthContext.Provider value={{ user, company, permissions, token, login, logout, hasFeature }}>{children}</AuthContext.Provider>
}
