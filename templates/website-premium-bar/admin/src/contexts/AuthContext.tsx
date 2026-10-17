import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'

interface User {
  id: string
  email: string
  name?: string
  role: 'admin' | 'editor'
  emailVerified?: boolean
  totpEnabled?: boolean
  recoveryCodesRemaining?: number
}

type LoginResult =
  | { requires2fa: false }
  | { requires2fa: true; challengeId: string }

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount we don't know if we're logged in (the cookie is httpOnly,
  // so JS can't peek at it). Ask the server — /me is a fast indexed
  // lookup, and a 401 is the unauthenticated case.
  useEffect(() => {
    api.get<{ user: User }>('/api/admin/me')
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const res = await api.post<{ user?: User; requires2fa?: boolean; challengeId?: string }>('/api/admin/login', { email, password })
    if (res.requires2fa && res.challengeId) return { requires2fa: true, challengeId: res.challengeId }
    if (res.user) setUser(res.user)
    return { requires2fa: false }
  }

  const refresh = async () => {
    const { user } = await api.get<{ user: User }>('/api/admin/me')
    setUser(user)
  }

  const logout = async () => {
    try { await api.post('/api/admin/logout') } catch { /* ignore — we're clearing local state regardless */ }
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
